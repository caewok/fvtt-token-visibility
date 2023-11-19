/* globals
canvas,
glMatrix,
PIXI
*/
"use strict";

import { Area3dLOS } from "./Area3dLOS.js";
import { AREA3D_POPOUTS } from "./Area3dPopout.js"; // Debugging pop-up

// webGL2
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./Placeable3dShader.js";


// PlaceablePoints folder
// import { PixelCache } from "./PixelCache.js";


// Geometry folder
import { Point3d } from "../geometry/3d/Point3d.js";

const RADIANS_90 = Math.toRadians(90);
const RADIANS_1 = Math.toRadians(1);
const mat4 = glMatrix.mat4;

export class Area3dLOSWebGL2 extends Area3dLOS {

  _tileShaders = new Map();

  _tileDebugShaders = new Map();

  constructor(viewer, target, config) {
    super(viewer, target, config);
    this.config.useDebugShaders ??= true;
  }

  _clearCache() {
    super._clearCache();
    this.#frustrum.initialized = false;
  }

  /** @type {object} */
  #shaders;

  /** @type {object} */
  #debugShaders;

  get shaders() {
    if ( !this.#shaders ) this._initializeShaders();
    return this.#shaders;
  }

  get debugShaders() {
    if ( !this.#debugShaders ) this._initializeShaders();
    if ( this.config.useDebugShaders ) return this.#debugShaders;
    return this.#shaders;
  }

  _initializeShaders() {
    this.#shaders = {};
    this.#debugShaders = {};

    const shaders = [
      "target",
      "obstacle",
      "terrainWall"
    ];

    // const axes = [1, 1, 1];
    const axes = [-1, 1, 1];  // Mirror along the y axis.
    for ( const shaderName of shaders ) {
      const shader = this.#shaders[shaderName] = Placeable3dShader.create(this.viewerPoint, this.targetCenter);
      const debugShader = this.#debugShaders[shaderName] = Placeable3dDebugShader.create(this.viewerPoint, this.targetCenter);
      mat4.fromScaling(shader.uniforms.uOffsetMatrix, axes);
      mat4.fromScaling(debugShader.uniforms.uOffsetMatrix, axes);
    }

    // Set color for each shader.
    this.#shaders.target.setColor(1, 0, 0, 1); // Red
    this.#shaders.obstacle.setColor(0, 0, 1, 1);  // Blue
    this.#shaders.terrainWall.setColor(0, 0, 1, 0.5); // Blue, half-alpha
  }

  _initializeDebugShaders() {

  }

  /**
   * Describes the viewing frustum used by the shaders to view the target.
   */
  #frustrum = {
    near: 0.1,
    far: 1000,
    fov: RADIANS_90,
    frame: new PIXI.Rectangle(),
    initialized: false
  };

  get frustrum() {
    if ( !this.#frustrum.initialized ) this.#constructFrustrum();
    return this.#frustrum;
  }

  #constructFrustrum() {
    const { viewerPoint, target, targetCenter } = this;

    // We want the target token to be within the viewable frustrum.
    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const targetBoundaryPts = target.bounds.viewablePoints(viewerPoint);

    // Angle is between the two segments from the origin.
    // TODO: Handle limited angle vision.
    const angleRad = PIXI.Point.angleBetween(targetBoundaryPts[0], viewerPoint, targetBoundaryPts[1]);
    const fov = this.#frustrum.fov = angleRad + RADIANS_1;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    this.#frustrum.near = canvas.dimensions.size * 0.5;

    // Far distance is distance to the center of the target plus 1/2 the diagonal.
    const { w, h } = target;
    const diagDist = Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2)) * 0.5;
    const dist = Point3d.distanceBetween(viewerPoint, targetCenter) + diagDist;
    const far = this.#frustrum.far = Math.ceil(dist);

    // Build the frame
    const frustrumBase = Math.ceil(this.constructor.frustrumBase(fov, far));
    const frustrumBase_1_2 = frustrumBase * 0.5;

    const frame = this.#frustrum.frame;
    frame.x = -frustrumBase_1_2;
    frame.y = -frustrumBase_1_2;
    frame.width = frustrumBase;
    frame.height = frustrumBase;
    this.#frustrum.initialized = true;
  }

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

  _buildTileShader(fov, near, far, tile) {
    if ( !this._tileShaders.has(tile) ) {
      const shader = Tile3dShader.create(this.viewerPoint, this.targetCenter,
      { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
      mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
      shader.setColor(0, 0, 1, 1); // Blue
      this._tileShaders.set(tile, shader);
    }

    const shader = this._tileShaders.get(tile);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    return shader;
  }

  _buildTileDebugShader(fov, near, far, tile) {
    if ( !this.config.useDebugShaders ) return this._buildTileShader(fov, near, far, tile);
    if ( !this._tileDebugShaders.has(tile) ) {
      const shader = Tile3dDebugShader.create(this.viewerPoint, this.targetCenter,
        { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
      mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
      this._tileDebugShaders.set(tile, shader);
    }

    const shader = this._tileDebugShaders.get(tile);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    return shader;
  }

  // Textures and containers used by webGL2 method.
  _obstacleContainer = new PIXI.Container();

  _renderTexture = PIXI.RenderTexture.create({
    resolution: 1,
    scaleMode: PIXI.SCALE_MODES.NEAREST,
    multisample: PIXI.MSAA_QUALITY.NONE,
    alphaMode: PIXI.NO_PREMULTIPLIED_ALPHA
  });

  #destroyed = false;

  destroy() {
    if ( this.#destroyed ) return;

    // Destroy this first before handling the shaders.
    this._obstacleContainer.destroy(true);

    // Destroy all shaders and render texture
    // Unclear why, but the `forEach` approach is not working (never returns)
    Object.values(this.#shaders).forEach(s => s.destroy());
    Object.values(this.#debugShaders).forEach(s => s.destroy());
    this._tileShaders.forEach(s => s.destroy());
    this._tileDebugShaders.forEach(s => s.destroy());
    this._tileShaders.clear();
    this._tileDebugShaders.clear();
    this._renderTexture.destroy();

    // Note that everything is destroyed to avoid errors if called again.
    this.#destroyed = true;
  }

  percentVisible() {
    const percentVisible = this._simpleVisibilityTest();
    if ( typeof percentVisible !== "undefined" ) return percentVisible;

    performance.mark("startWebGL2");
    const obstacleContainer = this._obstacleContainer;
    const renderTexture = this._renderTexture;
    const shaders = this.shaders;

    // If no blocking objects, line-of-sight is assumed true.

    const target = this.target;
    const blockingObjects = this.blockingObjects;
    const { near, far, fov, frame } = this.frustrum;

    renderTexture.resize(frame.width, frame.height, true);

    performance.mark("targetMesh");

    // Create shaders, mesh, draw to texture.
    // TODO: Store and update shaders instead of creating.
    const buildMesh = this.constructor.buildMesh;

    // 1 for the target, in red
    const targetShader = shaders.target;
    targetShader._initializePerspectiveMatrix(fov, 1, near, far);
    const targetMesh = buildMesh(target, targetShader);
    // obstacleContainer.addChild(targetMesh);

    // Render target and calculate its visible area alone.
    // TODO: This will always calculate the full area, even if a wall intersects the target.


    performance.mark("obstacleMesh");

    // TODO: Fix garbage handling; destroy the shaders and meshes.

    // 1 for the terrain walls
    if ( blockingObjects.terrainWalls.size ) {
      // Can we set alpha to 0.5 and add overlapping walls to get to 1.0 blue?
      // Or multiply, so 0.7 * 0.7 = 0.49?
      // Or set to green and then process with pixel cache?
      // Then process the pixel cache to ignore blue alpha?
      // For the moment, draw with blue alpha
      const terrainWallShader = shaders.terrainWall;
      terrainWallShader._initializePerspectiveMatrix(fov, 1, near, far);
      for ( const terrainWall of blockingObjects.terrainWalls ) {
        const mesh = buildMesh(terrainWall, terrainWallShader);
        obstacleContainer.addChild(mesh);
      }
    }

    // 1 for the walls/tokens, in blue
    const otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
    if ( otherBlocking.size ) {
      const obstacleShader = shaders.obstacle;
      obstacleShader._initializePerspectiveMatrix(fov, 1, near, far);
      for ( const obj of otherBlocking ) {
        const mesh = buildMesh(obj, obstacleShader);
        obstacleContainer.addChild(mesh);
      }
    }

    // 1 for the tiles
    if ( blockingObjects.tiles.size ) {
      for ( const tile of blockingObjects.tiles ) {
        const tileShader = this._buildTileShader(fov, near, far, tile);
        const mesh = buildMesh(tile, tileShader);
        obstacleContainer.addChild(mesh);
      }
    }

    const sumRedPixels = function(targetCache) {
      const pixels = targetCache.pixels;
      const nPixels = pixels.length;
      let sumTarget = 0;
      for ( let i = 0; i < nPixels; i += 4 ) sumTarget += Boolean(targetCache.pixels[i]);
      return sumTarget;
    };

    const sumRedObstaclesPixels = function(targetCache) {
      const pixels = targetCache.pixels;
      const nPixels = pixels.length;
      let sumTarget = 0;
      for ( let i = 0; i < nPixels; i += 4 ) {
        const px = pixels[i];
        if ( px < 128 ) continue;
        sumTarget += Boolean(targetCache.pixels[i]);
      }
      return sumTarget;
    };
    const obstacleSum = blockingObjects.terrainWalls.size ? sumRedObstaclesPixels : sumRedPixels;

    performance.mark("renderTargetMesh");
    canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });

    performance.mark("targetCache");
    const targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumTarget = sumRedPixels(targetCache);

//     const targetCache = PixelCache.fromTexture(renderTexture,
//       { channel: 0, arrayClass: Uint8Array });
//     const sumTarget = targetCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);


    performance.mark("renderObstacleMesh");
    canvas.app.renderer.render(obstacleContainer, { renderTexture, clear: false });

    // Calculate area remaining.
    // TODO: Handle terrain walls.
    performance.mark("obstacleCache");
//     const obstacleCache = PixelCache.fromTexture(renderTexture,
//       { frame, channel: 0, arrayClass: Uint8Array });
//     const sumWithObstacles = obstacleCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);

    const obstacleCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumWithObstacles = obstacleSum(obstacleCache);

    performance.mark("endWebGL2");

    const children = obstacleContainer.removeChildren();
    children.forEach(c => c.destroy());

    return sumWithObstacles / sumTarget;
  }

  // ----- NOTE: Debugging methods ----- //
  get popout() { return AREA3D_POPOUTS.webGL2; }

  _draw3dDebug() {
    // For the moment, repeat webGL2 percent visible process so that shaders with
    // colors to differentiate sides can be used.
    // Avoids using a bunch of "if" statements in JS or in GLSL to accomplish this.
    const stage = AREA3D_POPOUTS.webGL2.app?.pixiApp?.stage;
    if ( !stage ) return;

    const children = stage.removeChildren();
    children.forEach(c => c.destroy());

    // If no blocking objects, line-of-sight is assumed true.
    const target = this.target;
    const blockingObjects = this.blockingObjects;
    const { near, far, fov } = this.frustrum;

    // Create shaders, mesh, draw to texture.
    const buildMesh = this.constructor.buildMesh;

    // 1 for the target, in red
    const shaders = this.debugShaders;
    const targetShader = shaders.target;
    targetShader._initializePerspectiveMatrix(fov, 1, near, far);
    const targetMesh = buildMesh(target, targetShader);
    stage.addChild(targetMesh);

    // Render target and calculate its visible area alone.
    // TODO: This will always calculate the full area, even if a wall intersects the target.

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
      const terrainWallShader = shaders.terrainWall;
      terrainWallShader._initializePerspectiveMatrix(fov, 1, near, far);
      for ( const terrainWall of blockingObjects.terrainWalls ) {
        const mesh = buildMesh(terrainWall, terrainWallShader);
        stage.addChild(mesh);
      }
    }

    // 1 for the walls/tokens, in blue
    const otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
    if ( otherBlocking.size ) {
      const obstacleShader = shaders.obstacle;
      obstacleShader._initializePerspectiveMatrix(fov, 1, near, far);
      for ( const obj of otherBlocking ) {
        const mesh = buildMesh(obj, obstacleShader);
        stage.addChild(mesh);
      }
    }

    // 1 for the tiles
    if ( blockingObjects.tiles.size ) {
      for ( const tile of blockingObjects.tiles ) {
        const tileShader = this._buildTileDebugShader(fov, near, far, tile);
        const mesh = buildMesh(tile, tileShader);
        stage.addChild(mesh);
      }
    }
  }

}
