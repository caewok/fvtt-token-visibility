/* globals
canvas,
CONST,
foundry,
glMatrix,
PIXI
Ray,
Token,
VisionSource
*/
"use strict";

import { Area3dLOS } from "./Area3dLOS.js";
import { AREA3D_POPOUTS } from "./Area3dPopout.js"; // Debugging pop-up

// webGL2
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./Placeable3dShader.js";


// PlaceablePoints folder
import { TokenPoints3d } from "./PlaceablesPoints/TokenPoints3d.js";
import { WallPoints3d } from "./PlaceablesPoints/WallPoints3d.js";
import { PixelCache } from "./PixelCache.js";

// Base folder
import { Settings, SETTINGS } from "../settings.js";

// Geometry folder
import { Draw } from "../geometry/Draw.js"; // For debugging
import { ClipperPaths } from "../geometry/ClipperPaths.js";
import { Matrix } from "../geometry/Matrix.js";
import { Point3d } from "../geometry/3d/Point3d.js";

const RADIANS_90 = Math.toRadians(90);
const RADIANS_1 = Math.toRadians(1);
const mat4 = glMatrix.mat4;

export class Area3dLOSWebGL2 extends Area3dLOS {
  static frustrumBase(fov, dist) {
    const A = RADIANS_90 - (fov * 0.5);
    return (dist / Math.tan(A)) * 2;
  }

  static buildMesh(obj, shader) {
    const mesh = new PIXI.Mesh(obj.tokenvisibility.geometry, shader);
    mesh.state.depthTest = true;
    mesh.state.culling = true;
    mesh.state.clockwiseFrontFace = true;
    return mesh;
  }

  _buildShader(fov, near, far, color) {
    const shader = Placeable3dShader.create(this.viewerPoint, this.targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
    shader.setColor(color.r, color.g, color.b, color.a);
    return shader;
  }

  _buildTileShader(fov, near, far, color, tile) {
    const shader = Tile3dShader.create(this.viewerPoint, this.targetCenter,
      { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
    shader.setColor(color.r, color.g, color.b, color.a);
    return shader;
  }

  _buildDebugShader(fov, near, far, color) {
    const shader = Placeable3dDebugShader.create(this.viewerPoint, this.targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
    shader.setColor(color.r, color.g, color.b, color.a);
    return shader;
  }

  _buildTileDebugShader(fov, near, far, color, tile) {
    const shader = Tile3dDebugShader.create(this.viewerPoint, this.targetCenter,
      { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
    shader.setColor(color.r, color.g, color.b, color.a);
    return shader;
  }

  // Textures and containers used by webGL2 method.
  _meshContainer = new PIXI.Container();


  _targetRT = PIXI.RenderTexture.create({scaleMode: PIXI.SCALE_MODES.NEAREST});

  _obstacleRT = PIXI.RenderTexture.create({scaleMode: PIXI.SCALE_MODES.NEAREST});

  _targetDebugRT = PIXI.RenderTexture.create({scaleMode: PIXI.SCALE_MODES.NEAREST});

  _obstacleDebugRT = PIXI.RenderTexture.create({scaleMode: PIXI.SCALE_MODES.NEAREST});

  _meshContainer = new PIXI.Container();

  _meshDebugContainer = new PIXI.Container();

  #destroyed = false;

  destroy() {
    if ( this.#destroyed ) return;
    this._targetRT.destroy();
    this._obstacleRT.destroy();
    this._targetDebugRT.destroy();
    this._obstacleDebugRT.destroy();
    this._meshContainer.destroy(true);
    this._meshDebugContainer.destroy(true);
    this.#destroyed = true;
  }

  percentVisible() {
    const percentVisible = this._simpleVisibilityTest();
    if ( typeof percentVisible !== "undefined" ) return percentVisible;

    // If no blocking objects, line-of-sight is assumed true.
    performance.mark("Start_webGL2");
    const target = this.target;
    const blockingObjects = this.blockingObjects;
    if ( !(blockingObjects.tokens.size
        || blockingObjects.walls.size
        || blockingObjects.tiles.size
        || blockingObjects.terrainWalls.size > 1) ) return 1;

    // We want the target token to be within the viewable frustrum.
    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const targetBoundaryPts = target.bounds.viewablePoints(this.viewerPoint);

    // Angle is between the two segments from the origin.
    // TODO: Handle limited angle vision.
    const angleRad = PIXI.Point.angleBetween(targetBoundaryPts[0], this.viewerPoint, targetBoundaryPts[1]);
    const fov = angleRad + RADIANS_1;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    const near = canvas.dimensions.size * 0.5;

    // Far distance is distance to the center of the target plus 1/2 the diagonal.
    const { w, h } = target;
    const diagDist = Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2)) * 0.5;
    const dist = Point3d.distanceBetween(this.viewerPoint, this.targetCenter) + diagDist;
    const far = Math.ceil(dist);

    // Create texture
    const frustrumBase = Math.ceil(this.constructor.frustrumBase(fov, far));
    const texConfig = {
      resolution: 1,
      width: frustrumBase,
      height: frustrumBase,
      scaleMode: PIXI.SCALE_MODES.NEAREST
    };

    // TODO: Keep and clear instead of destroying the render texture.
    performance.mark("create_renderTexture");
    const renderTexture = this.renderTexture = PIXI.RenderTexture.create(texConfig);
    performance.mark("targetmesh");

    // Create shaders, mesh, draw to texture.
    const buildMesh = this.constructor.buildMesh;
    const CACHE_RESOLUTION = 1.0;

    // 1 for the target, in red
    const targetShader = this._buildShader(fov, near, far, { r: 1, g: 0, b: 0, a: 1 });
    const targetMesh = buildMesh(target, targetShader);

    // Render target and calculate its visible area alone.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    performance.mark("renderTargetMesh");
    canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });

    performance.mark("targetCache_start");
    const targetCache = this.targetCache = PixelCache.fromTexture(renderTexture,
      { resolution: CACHE_RESOLUTION, channel: 0 });
    const sumTarget = targetCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);
    performance.mark("obstaclemesh");

    // TODO: Fix garbage handling; destroy the shaders and meshes.

    // 1 for the terrain walls
    if ( blockingObjects.terrainWalls.size ) {
      // Can we set alpha to 0.5 and add overlapping walls to get to 1.0 blue?
      // Or multiply, so 0.7 * 0.7 = 0.49?
      // Or set to green and then process with pixel cache?
      // Then process the pixel cache to ignore blue alpha?
      // For the moment, draw with blue alpha
      const terrainWallShader = this._buildShader(fov, near, far, { r: 0, g: 0, b: 1, a: 0.5 });
      for ( const terrainWall of blockingObjects.terrainWalls ) {
        const mesh = buildMesh(terrainWall, terrainWallShader);
        canvas.app.renderer.render(mesh, { renderTexture, clear: false });
      }
    }

    // 1 for the walls/tokens, in blue
    const otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
    if ( otherBlocking.size ) {
      const wallShader = this._buildShader(fov, near, far, { r: 0, g: 0, b: 1, a: 1 });
      for ( const obj of otherBlocking ) {
        const mesh = buildMesh(obj, wallShader);
        canvas.app.renderer.render(mesh, { renderTexture, clear: false });
      }
    }

    // 1 for the tiles
    if ( blockingObjects.tiles.size ) {
      for ( const tile of blockingObjects.tiles ) {
        const tileShader = this._buildTileShader(fov, near, far, { r: 0, g: 0, b: 1, a: 1 }, tile);
        const mesh = buildMesh(tile, tileShader);
        canvas.app.renderer.render(mesh, { renderTexture, clear: false });
      }
    }

    // Calculate area remaining.
    // TODO: Handle terrain walls.
    performance.mark("obstacleCache");
    const obstacleCache = this.obstacleCache = PixelCache.fromTexture(renderTexture,
      { resolution: CACHE_RESOLUTION, channel: 0 });
    const sumWithObstacles = obstacleCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);
    performance.mark("end_webGL2");

    if ( this.debug ) this.drawWebGL2Debug();

    return sumWithObstacles / sumTarget;
  }

  // ----- NOTE: Debugging methods ----- //
  get popout() { return AREA3D_POPOUTS.webGL2; }

  /**
   * For debugging.
   * Draw debugging objects (typically, 3d view of the target) in a pop-up window.
   * Must be extended by subclasses. This version pops up a blank window.
   */
  async _draw3dDebug() {
    await super._draw3dDebug();
    this._drawWebGL2Debug();
  }

  _drawWebGL2Debug() {
    // For the moment, repeat webGL2 percent visible process so that shaders with
    // colors to differentiate sides can be used.
    // Avoids using a bunch of "if" statements in JS or in GLSL to accomplish this.
    const stage = AREA3D_POPOUTS.webGL2.app.pixiApp.stage;
    const popoutApp = AREA3D_POPOUTS.webGL2.app.pixiApp;

    // For now, remove render texture and add new one.
    const sprites = stage.children.filter(c => c instanceof PIXI.Sprite);
    sprites.forEach(s => stage.removeChild(s));
    sprites.forEach(s => s.destroy());

    // If no blocking objects, line-of-sight is assumed true.
    const target = this.target;
    const blockingObjects = this.blockingObjects;
    if ( !(blockingObjects.tokens.size
        || blockingObjects.walls.size
        || blockingObjects.tiles.size
        || blockingObjects.terrainWalls.size > 1) ) return 1;

    // We want the target token to be within the viewable frustrum.
    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const targetBoundaryPts = target.bounds.viewablePoints(this.viewerPoint);

    // Angle is between the two segments from the origin.
    // TODO: Handle limited angle vision.
    const angleRad = PIXI.Point.angleBetween(targetBoundaryPts[0], this.viewerPoint, targetBoundaryPts[1]);
    const fov = angleRad + RADIANS_1;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    const near = canvas.dimensions.size * 0.5;

    // Far distance is distance to the center of the target plus 1/2 the diagonal.
    const { w, h } = target;
    const diagDist = Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2)) * 0.5;
    const dist = Point3d.distanceBetween(this.viewerPoint, this.targetCenter) + diagDist;
    const far = Math.ceil(dist);

    // Create texture
    const frustrumBase = Math.ceil(this.constructor.frustrumBase(fov, far));
    const texConfig = {
      resolution: 1,
      width: frustrumBase,
      height: frustrumBase,
      scaleMode: PIXI.SCALE_MODES.NEAREST
    };

    // TODO: Keep and clear instead of destroying the render texture.
    const renderTexture = this.renderTextureDebug = PIXI.RenderTexture.create(texConfig);

    // Create shaders, mesh, draw to texture.
    const buildMesh = this.constructor.buildMesh;

    // Unused:
    // const CACHE_RESOLUTION = 1.0;

    // 1 for the target, in red
    const targetShader = this._buildDebugShader(fov, near, far, { r: 1, g: 0, b: 0, a: 1 });
    const targetMesh = buildMesh(target, targetShader);

    // Render target and calculate its visible area alone.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });

    // Unused:
    // const targetCache = this.targetCache = PixelCache.fromTexture(renderTexture,
    //   { resolution: CACHE_RESOLUTION, channel: 0 });
    // const sumTarget = targetCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);

    // TODO: Fix garbage handling; destroy the shaders and meshes.

    // 1 for the terrain walls
    if ( blockingObjects.terrainWalls.size ) {
      // Can we set alpha to 0.5 and add overlapping walls to get to 1.0 blue?
      // Or multiply, so 0.7 * 0.7 = 0.49?
      // Or set to green and then process with pixel cache?
      // Then process the pixel cache to ignore blue alpha?
      // For the moment, draw with blue alpha
      const terrainWallShader = this._buildDebugShader(fov, near, far, { r: 0, g: 0, b: 1, a: 0.5 });
      for ( const terrainWall of blockingObjects.terrainWalls ) {
        const mesh = buildMesh(terrainWall, terrainWallShader);
        canvas.app.renderer.render(mesh, { renderTexture, clear: false });
      }
    }

    // 1 for the walls/tokens, in blue
    const otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
    if ( otherBlocking.size ) {
      const wallShader = this._buildDebugShader(fov, near, far, { r: 0, g: 0, b: 1, a: 1 });
      for ( const obj of otherBlocking ) {
        const mesh = buildMesh(obj, wallShader);
        canvas.app.renderer.render(mesh, { renderTexture, clear: false });
      }
    }

    // 1 for the tiles
    if ( blockingObjects.tiles.size ) {
      for ( const tile of blockingObjects.tiles ) {
        const tileShader = this._buildTileDebugShader(fov, near, far, { r: 0, g: 0, b: 1, a: 1 }, tile);
        const mesh = buildMesh(tile, tileShader);
        canvas.app.renderer.render(mesh, { renderTexture, clear: false });
      }
    }

    const s = new PIXI.Sprite(renderTexture);
    stage.addChild(s);

    // Calculate area remaining.
    // TODO: Handle terrain walls.
    // Unused:
    //     const obstacleCache = this.obstacleCache = PixelCache.fromTexture(renderTexture,
    //       { resolution: CACHE_RESOLUTION, channel: 0 });
    //     const sumWithObstacles = obstacleCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);
    //     return sumWithObstacles / sumTarget;
  }

}
