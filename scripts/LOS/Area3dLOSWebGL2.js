/* globals
canvas,
CONFIG,
PIXI
*/
"use strict";

import { Area3dLOS } from "./Area3dLOS.js";
import { AREA3D_POPOUTS } from "./Area3dPopout.js"; // Debugging pop-up

// GLSL
import { Grid3dGeometry } from "./Placeable3dGeometry.js";
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./Placeable3dShader.js";

// Geometry folder
import { Point3d } from "../geometry/3d/Point3d.js";

// Base folder
import { MODULE_ID } from "../const.js";

const RADIANS_90 = Math.toRadians(90);

// Containers, Sprites, RenderTexture.baseTexture have a destroyed property.
// Geometry is probably destroyed if it has a null index buffer.

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
    this.#targetDistance3dProperties.initialized = false;

    // Target may have been changed.
    if ( this.#gridCubeGeometry ) this.#gridCubeGeometry.object = this.target;
  }

  /**
   * For WebGL, it currently uses the full token border, not the constrained target border,
   * to construct the shape.
   * To ensure all blocking walls are captured, must use the same border for the vision
   * polygon.
   */
//   get visionPolygon() {
//     if ( !this._visionPolygon ) {
//       this._visionPolygon = this.constructor.visionPolygon(this.viewerPoint, this.target, this.target.bounds);
//       this._visionPolygon._edges = [...this._visionPolygon.iterateEdges()];
//       this._visionPolygon._bounds = this._visionPolygon.getBounds();
//     }
//     return this._visionPolygon;
//   }

  /** @type {object} */
  #targetDistance3dProperties = {
    diagonal: 0,
    farDistance: 0,
    nearDistance: 0,
    initialized: false
  };

  get targetDistance3dProperties() {
    if ( !this.#targetDistance3dProperties.initialized ) this._calculateTargetDistance3dProperties();
    return this.#targetDistance3dProperties;
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
    if ( !this.config.useDebugShaders ) return this.shaders;
    if ( !this.#debugShaders ) this._initializeDebugShaders();
    return this.#debugShaders;
  }

  _initializeShaders() {
    this.#shaders = {};
    const shaders = [
      "target",
      "obstacle",
      "terrainWall"
    ];

    for ( const shaderName of shaders ) {
      this.#shaders[shaderName] = Placeable3dShader.create(this.viewerPoint, this.targetCenter);
    }

    // Set color for each shader.
    this.#shaders.target.setColor(1, 0, 0, 1); // Red
    this.#shaders.obstacle.setColor(0, 0, 1, 1);  // Blue
    this.#shaders.terrainWall.setColor(0, 0, 1, 0.5); // Blue, half-alpha
  }

  _initializeDebugShaders() {
    this.#debugShaders = {};
    const shaders = [
      "target",
      "obstacle",
      "terrainWall"
    ];

    for ( const shaderName of shaders ) {
      this.#debugShaders[shaderName] = Placeable3dDebugShader.create(this.viewerPoint, this.targetCenter);
    }
  }

  /**
   * Geometry used to estimate the visible area of a grid cube in perspective for use with
   * largeTarget.
   */
  #gridCubeGeometry;

  get gridCubeGeometry() {
    // If not yet defined or destroyed.
    if ( !this.#gridCubeGeometry || !this.#gridCubeGeometry.indexBuffer ) {
      this.#gridCubeGeometry = new Grid3dGeometry(this.target);
    }

    // Update the positioning based on target.
    this.#gridCubeGeometry.updateObjectPoints();
    this.#gridCubeGeometry.updateVertices();
    return this.#gridCubeGeometry;
  }

  /**
   * Describes the viewing frustum used by the shaders to view the target.
   */
  #frustrum = {
    near: 1,
    far: null,
    fov: RADIANS_90,
    initialized: false
  };

  get frustrum() {
    if ( !this.#frustrum.initialized ) this.#constructFrustrum();
    return this.#frustrum;
  }

  _calculateTargetDistance3dProperties() {
    const { viewerPoint, target } = this;
    const props = this.#targetDistance3dProperties;

    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const { topZ, bottomZ, bounds } = target;
    const tokenBoundaryPts = [
      new Point3d(bounds.left, bounds.top, topZ),
      new Point3d(bounds.right, bounds.top, topZ),
      new Point3d(bounds.right, bounds.bottom, topZ),
      new Point3d(bounds.left, bounds.bottom, topZ),

      new Point3d(bounds.left, bounds.top, bottomZ),
      new Point3d(bounds.right, bounds.top, bottomZ),
      new Point3d(bounds.right, bounds.bottom, bottomZ),
      new Point3d(bounds.left, bounds.bottom, bottomZ)
    ];

    const distances = tokenBoundaryPts.map(pt => Point3d.distanceBetween(viewerPoint, pt));
    const distMinMax = Math.minMax(...distances);

    props.farDistance = distMinMax.max;
    props.nearDistance = distMinMax.min;
    props.diagonal = Point3d.distanceBetween(tokenBoundaryPts[0], tokenBoundaryPts[6]);
    props.initialized = true;
  }


  /**
   * Calculate the relevant frustrum properties for this viewer and target.
   * We want the target token to be completely within the viewable frustrum but
   * take up as much as the frustrum frame as possible, while limiting the size of the frame.
   */
  #constructFrustrum() {
    const viewerAngle = Math.toRadians(this.viewer.vision?.data?.angle) || Math.PI * 2;

    // Determine the optimal fov given the distance.
    // https://docs.unity3d.com/Manual/FrustumSizeAtDistance.html
    // Use near instead of far to ensure frame at start of token is large enough.
    const { diagonal, farDistance, nearDistance } = this.targetDistance3dProperties;
    let angleRad = 2 * Math.atan(diagonal * (0.5 / nearDistance));
    angleRad = Math.min(angleRad, viewerAngle);
    angleRad ??= RADIANS_90;
    this.#frustrum.fov = this.#frustrumFOV || angleRad;// + RADIANS_1;

    // Far distance is distance to the furthest point of the target.
    //this.#frustrum.far = this.#frustrumFar || farDistance;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    this.#frustrum.near = this.#frustrumNear || canvas.dimensions.size * 0.5;

    this.#frustrum.initialized = true;
  }

  #frustrumNear;

  set frustrumNear(value) {
    this.#frustrumNear = value;
    this._clearCache();
  }

  #frustrumFOV;

  set frustrumFOV(value) {
    this.#frustrumFOV = value;
    this._clearCache();
  }

  #frustrumFar;

  set frustrumFar(value) {
    this.#frustrumFar = value;
    this._clearCache();
  }

  static frustrumBase(fov, dist) {
    const A = RADIANS_90 - (fov * 0.5);
    return (dist / Math.tan(A)) * 2;
  }

  static buildMesh(geometry, shader) {
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.state.depthTest = true;
    mesh.state.culling = true;
    mesh.state.clockwiseFrontFace = true;
    return mesh;
  }

  _buildTileShader(fov, near, far, tile) {
    if ( !this._tileShaders.has(tile) ) {
      const shader = Tile3dShader.create(this.viewerPoint, this.targetCenter,
        { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
      shader.setColor(0, 0, 1, 1); // Blue
      this._tileShaders.set(tile, shader);
    }

    const shader = this._tileShaders.get(tile);
    shader._initializeLookAtMatrix(this.viewerPoint, this.targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    return shader;
  }

  _buildTileDebugShader(fov, near, far, tile) {
    if ( !this.config.useDebugShaders ) return this._buildTileShader(fov, near, far, tile);
    if ( !this._tileDebugShaders.has(tile) ) {
      const shader = Tile3dDebugShader.create(this.viewerPoint, this.targetCenter,
        { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
      this._tileDebugShaders.set(tile, shader);
    }

    const shader = this._tileDebugShaders.get(tile);
    shader._initializeLookAtMatrix(this.viewerPoint, this.targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    return shader;
  }

  // Textures and containers used by webGL2 method.
  #destroyed = false;

  destroy() {
    if ( this.#destroyed ) return;

    // Destroy all shaders and render texture
    if ( this.#shaders ) Object.values(this.#shaders).forEach(s => s.destroy());
    if ( this.#debugShaders ) Object.values(this.#debugShaders).forEach(s => s.destroy());
    this._tileShaders.forEach(s => s.destroy());
    this._tileDebugShaders.forEach(s => s.destroy());
    this._tileShaders.clear();
    this._tileDebugShaders.clear();

    this.#renderTexture?.destroy();
    this.#obstacleContainer?.destroy();
    this.#gridCubeGeometry?.destroy();

    this.#debugRenderTexture?.destroy();
    this.#debugObstacleContainer?.destroy();

    this.#debugSprite?.destroy();

    // Note that everything is destroyed to avoid errors if called again.
    this.#destroyed = true;
  }

  /** @type {PIXI.RenderTexture} */
  #renderTexture;

  get renderTexture() {
    if ( !this.#renderTexture || this.#renderTexture.baseTexture.destroyed ) {
      const cfg = this._renderTextureConfiguration();
      this.#renderTexture = PIXI.RenderTexture.create(cfg);
    }
    return this.#renderTexture;
  }

  /** @type {PIXI.RenderTexture} */
  #debugRenderTexture;

  get debugRenderTexture() {
    if ( !this.#debugRenderTexture || this.#debugRenderTexture.baseTexture.destroyed ) {
      const cfg = this._renderTextureConfiguration();
      cfg.width = 400;
      cfg.height = 400;
      this.#debugRenderTexture = PIXI.RenderTexture.create(cfg);
    }
    return this.#debugRenderTexture;
  }

  _renderTextureConfiguration() {
    const { renderTextureResolution, renderTextureSize } = CONFIG[MODULE_ID];
    return {
      resolution: renderTextureResolution,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      alphaMode: PIXI.NO_PREMULTIPLIED_ALPHA,
      width: renderTextureSize,
      height: renderTextureSize
    };
  }

  /** @type {PIXI.Container} */
  #obstacleContainer;

  get obstacleContainer() {
    if ( !this.#obstacleContainer
      || this.#obstacleContainer.destroyed ) this.#obstacleContainer = new PIXI.Container();
    return this.#obstacleContainer;
  }

  /** @type {PIXI.Container} */
  #debugObstacleContainer;

  get debugObstacleContainer() {
    if ( !this.#debugObstacleContainer
      || this.#debugObstacleContainer.destroyed ) this.#debugObstacleContainer = new PIXI.Container();
    return this.#debugObstacleContainer;
  }

  /** @type {PIXI.Sprite} */
  #debugSprite;

  get debugSprite() {
    if ( !this.#debugSprite || this.#debugSprite.destroyed ) {
      const s = this.#debugSprite = PIXI.Sprite.from(this.debugRenderTexture);
      s.scale = new PIXI.Point(1, -1); // Flip y-axis.
      s.anchor = new PIXI.Point(0.5, 0.5); // Centered on the debug window.
    }
    return this.#debugSprite;
  }


  percentVisible() {
    // Debug: console.debug(`percentVisible|${this.viewer.name}👀 => ${this.target.name}🎯`);
    const percentVisible = this._simpleVisibilityTest();
    if ( typeof percentVisible !== "undefined" ) return percentVisible;

    performance.mark("startWebGL2");
    const { renderTexture, shaders, blockingObjects, obstacleContainer } = this;
    const { sumRedPixels, sumRedObstaclesPixels } = this.constructor;

    // Build target mesh to measure the target viewable area.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    performance.mark("targetMesh");
    const targetMesh = this.#buildTargetMesh(shaders);

    // If largeTarget is enabled, use the visible area of a grid cube to be 100% visible.
    // #buildTargetMesh already initialized the shader matrices.
    let sumGridCube = 100_000;
    if ( this.config.largeTarget ) {
      const gridCubeMesh = this.constructor.buildMesh(this.gridCubeGeometry, shaders.target);
      canvas.app.renderer.render(gridCubeMesh, { renderTexture, clear: true });
      const gridCubeCache = canvas.app.renderer.extract._rawPixels(renderTexture);
      sumGridCube = sumRedPixels(gridCubeCache) || 100_000;
      gridCubeMesh.destroy();
    }

    // Build mesh of all obstacles in viewable triangle.
    performance.mark("obstacleMesh");
    this.#buildObstacleContainer(obstacleContainer, shaders, this._buildTileShader.bind(this));

    performance.mark("renderTargetMesh");
    canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });

    // Calculate visible area of the target.
    performance.mark("targetCache");
    const targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumTarget = sumRedPixels(targetCache);

    performance.mark("renderObstacleMesh");
    canvas.app.renderer.render(obstacleContainer, { renderTexture, clear: false });

    // Calculate target area remaining after obstacles.
    performance.mark("obstacleCache");
    const obstacleSum = blockingObjects.terrainWalls.size ? sumRedObstaclesPixels : sumRedPixels;
    const obstacleCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumWithObstacles = obstacleSum(obstacleCache);

    performance.mark("endWebGL2");
    const children = obstacleContainer.removeChildren();
    children.forEach(c => c.destroy());

    // The grid area can be less than target area if the target is smaller than a grid.
    // Example: target may not be 1 unit high or may only be half a grid wide.
    const denom = Math.min(sumGridCube, sumTarget);
    // console.debug(`${this.viewer.name} viewing ${this.target.name}:
    // Seen: ${sumWithObstacles}; Full Target: ${sumTarget}; Grid: ${sumGridCube}.
    // ${Math.round(sumWithObstacles/sumTarget * 100 * 10) / 10}% |
    // ${Math.round(sumWithObstacles/sumGridCube * 100 * 10)/ 10}%`)

    return sumWithObstacles / denom;
  }

  // ----- NOTE: Debugging methods ----- //
  get popout() { return AREA3D_POPOUTS.webGL2; }

  _draw3dDebug() {
    // For the moment, repeat webGL2 percent visible process so that shaders with
    // colors to differentiate sides can be used.
    // Avoids using a bunch of "if" statements in JS or in GLSL to accomplish this.
    const app = this.popout.app?.pixiApp;
    const stage = app?.stage;
    if ( !stage ) return;
    stage.removeChildren();

    // Debug: console.debug(`_draw3dDebug|${this.viewer.name}👀 => ${this.target.name}🎯`);
    const { debugShaders, debugObstacleContainer, debugSprite, debugRenderTexture } = this;

    const targetMesh = this.#buildTargetMesh(debugShaders);
    this.#buildObstacleContainer(debugObstacleContainer, debugShaders, this._buildTileDebugShader.bind(this));
    app.renderer.render(targetMesh, { renderTexture: debugRenderTexture, clear: true });
    app.renderer.render(debugObstacleContainer, { renderTexture: debugRenderTexture, clear: false });
    stage.addChild(debugSprite);

    targetMesh.destroy();
    debugObstacleContainer.removeChildren().forEach(c => c.destroy());

    // For testing the mesh directly:
    // stage.addChild(targetMesh);
    // stage.addChild(c);

    // Temporarily render the texture for debugging.
    // if ( !this.renderSprite || this.renderSprite.destroyed ) {
    //  this.renderSprite ??= PIXI.Sprite.from(this._renderTexture);
    //  this.renderSprite.scale = new PIXI.Point(1, -1); // Flip y-axis.
    //  canvas.stage.addChild(this.renderSprite);
    // }
  }

  #buildTargetMesh(shaders) {
    const targetShader = shaders.target;
    const { near, far, fov } = this.frustrum;
    targetShader._initializeLookAtMatrix(this.viewerPoint, this.targetCenter);
    targetShader._initializePerspectiveMatrix(fov, 1, near, far);
    return this.constructor.buildMesh(this.target[MODULE_ID].geomHandler.geometry, targetShader);
  }

  #buildObstacleContainer(container, shaders, tileMethod) {
    const { viewerPoint, targetCenter, frustrum, blockingObjects } = this;
    const buildMesh = this.constructor.buildMesh;
    const { near, far, fov } = frustrum;

    // Limited angle walls
    if ( blockingObjects.terrainWalls.size ) {
      const terrainWallShader = shaders.terrainWall;
      terrainWallShader._initializeLookAtMatrix(viewerPoint, targetCenter);
      terrainWallShader._initializePerspectiveMatrix(fov, 1, near, far);
      for ( const terrainWall of blockingObjects.terrainWalls ) {
        const mesh = buildMesh(terrainWall[MODULE_ID].geomHandler.geometry, terrainWallShader);
        container.addChild(mesh);
      }
    }

    // Walls/Tokens
    const otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
    if ( otherBlocking.size ) {
      const obstacleShader = shaders.obstacle;
      obstacleShader._initializeLookAtMatrix(viewerPoint, targetCenter);
      obstacleShader._initializePerspectiveMatrix(fov, 1, near, far);
      for ( const obj of otherBlocking ) {
        const mesh = buildMesh(obj[MODULE_ID].geomHandler.geometry, obstacleShader);
        container.addChild(mesh);
      }
    }

    // Tiles
    if ( blockingObjects.tiles.size ) {
      for ( const tile of blockingObjects.tiles ) {
        const tileShader = tileMethod(fov, near, far, tile);
        const mesh = buildMesh(tile[MODULE_ID].geomHandler.geometry, tileShader);
        container.addChild(mesh);
      }
    }
  }
}
