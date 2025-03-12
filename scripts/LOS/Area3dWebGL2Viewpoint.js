/* globals
canvas,
CONFIG,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";

// PlaceablePoints folder

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { sumRedPixels, sumRedObstaclesPixels } from "./util.js";

// GLSL
import { Grid3dGeometry, GEOMETRY_ID } from "./Placeable3dGeometry.js";
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./Placeable3dShader.js";

// Geometry
import { Point3d } from "../geometry/3d/Point3d.js";

// Debug

const RADIANS_90 = Math.toRadians(90);

export class Area3dWebGL2Viewpoint extends AbstractViewpoint {

  _tileShaders = new Map();

  _tileDebugShaders = new Map();

  clearCache() {
    super.clearCache();
    if ( this.#gridCubeGeometry ) this.#gridCubeGeometry.object = this.viewerLOS.target;

    // Affected by both viewer and target.
    this.#frustrum.initialized = false;
    this.#targetDistance3dProperties.initialized = false;
  }

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

    const targetCenter = this.viewerLOS.targetCenter;
    for ( const shaderName of shaders ) {
      this.#shaders[shaderName] = Placeable3dShader.create(this.viewpoint, targetCenter);
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

    const targetCenter = this.viewerLOS.targetCenter;
    for ( const shaderName of shaders ) {
      this.#debugShaders[shaderName] = Placeable3dDebugShader.create(this.viewpoint, targetCenter);
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
      this.#gridCubeGeometry = new Grid3dGeometry(this.viewerLOS.target);
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

  /** @type {Point3d[]} */
  static #tokenBoundaryPoints = {
    // Top
    TTL: new Point3d(),
    TTR: new Point3d(),
    TBR: new Point3d(),
    TBL: new Point3d(),

    // Bottom
    BTL: new Point3d(),
    BTR: new Point3d(),
    BBR: new Point3d(),
    BBL: new Point3d()
  };

  _calculateTargetDistance3dProperties() {
    const { viewpoint } = this;

    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const { topZ, bottomZ, bounds } = this.viewerLOS.target;
    const tokenBoundaryPoints = this.constructor.#tokenBoundaryPoints;

    // Top
    tokenBoundaryPoints.TTL.set(bounds.left, bounds.top, topZ);
    tokenBoundaryPoints.TTR.set(bounds.right, bounds.top, topZ);
    tokenBoundaryPoints.TBR.set(bounds.right, bounds.bottom, topZ);
    tokenBoundaryPoints.TBL.set(bounds.left, bounds.bottom, topZ);

    // Bottom
    tokenBoundaryPoints.BTL.set(bounds.left, bounds.top, bottomZ);
    tokenBoundaryPoints.BTR.set(bounds.right, bounds.top, bottomZ);
    tokenBoundaryPoints.BBR.set(bounds.right, bounds.bottom, bottomZ);
    tokenBoundaryPoints.BBL.set(bounds.left, bounds.bottom, bottomZ);

    const distances = Object.values(tokenBoundaryPoints).map(pt => CONFIG.GeometryLib.threeD.Point3d.distanceBetween(viewpoint, pt));
    const distMinMax = Math.minMax(...distances);

    const props = this.#targetDistance3dProperties;
    props.farDistance = distMinMax.max;
    props.nearDistance = distMinMax.min;
    props.diagonal = CONFIG.GeometryLib.threeD.Point3d.distanceBetween(tokenBoundaryPoints.TTL, tokenBoundaryPoints.BBR);
    props.initialized = true;
  }


  /**
   * Calculate the relevant frustrum properties for this viewer and target.
   * We want the target token to be completely within the viewable frustrum but
   * take up as much as the frustrum frame as possible, while limiting the size of the frame.
   */
  #constructFrustrum() {
    const viewerAngle = Math.toRadians(this.viewerLOS.viewer.vision?.data?.angle) || Math.PI * 2;

    // Determine the optimal fov given the distance.
    // https://docs.unity3d.com/Manual/FrustumSizeAtDistance.html
    // Use near instead of far to ensure frame at start of token is large enough.
    const { diagonal, nearDistance } = this.targetDistance3dProperties;
    let angleRad = 2 * Math.atan(diagonal * (0.5 / nearDistance));
    angleRad = Math.min(angleRad, viewerAngle);
    angleRad ??= RADIANS_90;
    this.#frustrum.fov = this.#frustrumFOV || angleRad;// + RADIANS_1;

    // Far distance is distance to the furthest point of the target.
    // this.#frustrum.far = this.#frustrumFar || farDistance;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within the viewer token.
    // (If the viewer point is on the edge, we want basically everything.)
    this.#frustrum.near = this.#frustrumNear;
    if ( !this.#frustrum.near ) this.#frustrum.near ||= 1;
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
    mesh.state.depthMask = true;
    return mesh;
  }

  _buildTileShader(fov, near, far, tile) {
    const targetCenter = this.viewerLOS.targetCenter;
    if ( !this._tileShaders.has(tile) ) {
      const shader = Tile3dShader.create(this.viewpoint, targetCenter,
        { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
      shader.setColor(0, 0, 1, 1); // Blue
      this._tileShaders.set(tile, shader);
    }

    const shader = this._tileShaders.get(tile);
    shader._initializeLookAtMatrix(this.viewpoint, targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    return shader;
  }

  _buildTileDebugShader(fov, near, far, tile) {
    const targetCenter = this.viewerLOS.targetCenter;
    if ( !this._tileDebugShaders.has(tile) ) {
      const shader = Tile3dDebugShader.create(this.viewpoint, targetCenter,
        { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
      this._tileDebugShaders.set(tile, shader);
    }

    const shader = this._tileDebugShaders.get(tile);
    shader._initializeLookAtMatrix(this.viewpoint, targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    return shader;
  }

  // Textures and containers used by webGL2 method.
  #destroyed = false;

  destroy() {
    super.destroy();
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
    if ( !this.#renderTexture || this.#renderTexture.destroyed ) {
      const cfg = this._renderTextureConfiguration();
      this.#renderTexture = PIXI.RenderTexture.create(cfg);
      this.#renderTexture.framebuffer.enableDepth();
    }
    return this.#renderTexture;
  }

  /** @type {PIXI.RenderTexture} */
  #debugRenderTexture;

  get debugRenderTexture() {
    if ( !this.#debugRenderTexture || this.#debugRenderTexture.destroyed ) {
      const cfg = this._renderTextureConfiguration();
      cfg.width = 400;
      cfg.height = 400;
      this.#debugRenderTexture = PIXI.RenderTexture.create(cfg);
      this.#debugRenderTexture.framebuffer.enableDepth();
    }
    return this.#debugRenderTexture;
  }

  _renderTextureConfiguration() {
    const { renderTextureResolution, renderTextureSize } = CONFIG[MODULE_ID];
    return {
      resolution: renderTextureResolution,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
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


  _percentVisible() {
    performance.mark("startWebGL2");
    const { renderTexture, shaders, blockingObjects } = this;
    const renderer = canvas.app.renderer;

    // If largeTarget is enabled, use the visible area of a grid cube to be 100% visible.
    // #buildTargetMesh already initialized the shader matrices.
    let sumGridCube = Number.POSITIVE_INFINITY;
    if ( this.useLargeTarget ) {
      const gridCubeMesh = this.constructor.buildMesh(this.gridCubeGeometry, shaders.target);
      renderer.render(gridCubeMesh, { renderTexture, clear: true });
      const gridCubeCache = renderer.extract._rawPixels(renderTexture);
      sumGridCube = sumRedPixels(gridCubeCache) || Number.POSITIVE_INFINITY;
      gridCubeMesh.destroy();
    }

    // Build target mesh to measure the target viewable area.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    performance.mark("renderTarget");
    this.#renderTarget(renderer, renderTexture, shaders);

    // Calculate visible area of the target.
    performance.mark("targetCache");
    const targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumTarget = sumRedPixels(targetCache);

    // Render obstacles. Render opaque first.
    performance.mark("obstacleMesh");
    this.#renderOpaqueObstacles(renderer, renderTexture, shaders);
    this.#renderTransparentObstacles(renderer, renderTexture, shaders, this._buildTileShader.bind(this));

    // Calculate target area remaining after obstacles.
    performance.mark("obstacleCache");
    const obstacleSum = blockingObjects.terrainWalls.size ? sumRedObstaclesPixels : sumRedPixels;
    const obstacleCache = renderer.extract._rawPixels(renderTexture);
    const sumWithObstacles = obstacleSum(obstacleCache);

    // Cleanup and calculate final percentage visible.
    const denom = Math.min(sumGridCube, sumTarget);
    performance.mark("endWebGL2");
    return sumWithObstacles / denom;
  }

  #renderTarget(renderer, renderTexture, shaders, clear = true) {
    const targetMesh = this.#buildTargetMesh(shaders);
    renderer.render(targetMesh, { renderTexture, clear });
  }

  /**
   * Render the opaque blocking walls and token shapes to the render texture.
   * @param {PIXI.Renderer} renderer
   * @param {PIXI.RenderTexture} renderTexture
   * @param {PIXI.Shader[]} shaders
   */
  #renderOpaqueObstacles(renderer, renderTexture, shaders) {
    // Walls/Tokens
    const blockingObjects = this.blockingObjects;
    const otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
    if ( !otherBlocking.size ) return;

    const { viewpoint, frustrum, obstacleContainer } = this;
    const buildMesh = this.constructor.buildMesh;
    const { near, far, fov } = frustrum;
    const obstacleShader = shaders.obstacle;
    obstacleShader._initializeLookAtMatrix(viewpoint, this.viewerLOS.targetCenter);
    obstacleShader._initializePerspectiveMatrix(fov, 1, near, far);
    for ( const obj of otherBlocking ) {
      const mesh = buildMesh(obj[GEOMETRY_ID].geometry, obstacleShader);
      obstacleContainer.addChild(mesh);
    }

    renderer.render(obstacleContainer, { renderTexture, clear: false });
    const children = obstacleContainer.removeChildren();
    children.forEach(c => c.destroy());
  }

  /**
   * Render the obstacles with transparency: tiles and terrain walls.
   * So that transparency works with depth, render furthest to closest from the viewer.
   * @param {PIXI.Renderer} renderer
   * @param {PIXI.RenderTexture} renderTexture
   * @param {PIXI.Shader[]} shaders
   */
  #renderTransparentObstacles(renderer, renderTexture, shaders, tileMethod) {
    let blockingObjects = this.blockingObjects;
    const nTerrainWalls = blockingObjects.terrainWalls.size;
    const nTiles = blockingObjects.tiles.size;
    if ( !nTerrainWalls && !nTiles ) return;

    // Build mesh from each obstacle and
    // measure distance along ray from viewer point to target center.
    const buildMesh = this.constructor.buildMesh;
    const { viewpoint, frustrum } = this;
    const targetCenter = this.viewerLOS.targetCenter;
    const rayDir = targetCenter.subtract(viewpoint);
    const { near, far, fov } = frustrum;
    const meshes = [];
    if ( nTerrainWalls ) {
      const terrainWallShader = shaders.terrainWall;
      terrainWallShader._initializeLookAtMatrix(viewpoint, targetCenter);
      terrainWallShader._initializePerspectiveMatrix(fov, 1, near, far);
      blockingObjects.terrainWalls.forEach(wall => {
        const mesh = buildMesh(wall[GEOMETRY_ID].geometry, terrainWallShader);
        const plane = CONFIG.GeometryLib.threeD.Plane.fromWall(wall);
        mesh._atvIx = plane.rayIntersection(viewpoint, rayDir);
        if ( mesh._atvIx > 0 ) meshes.push(mesh);
        else mesh.destroy();
      });
    }

    if ( nTiles ) {
      blockingObjects.tiles.forEach(tile => {
        const tileShader = tileMethod(fov, near, far, tile);
        const mesh = buildMesh(tile[GEOMETRY_ID].geometry, tileShader);
        const plane = new CONFIG.GeometryLib.threeD.Plane(new CONFIG.GeometryLib.threeD.Point3d(0, 0, tile.elevationZ));
        mesh._atvIx = plane.rayIntersection(viewpoint, rayDir);
        if ( mesh._atvIx > 0 ) meshes.push(mesh);
        else mesh.destroy();
      });
    }

    // Sort meshes and render each in turn
    meshes.sort((a, b) => b._atvIx - a._atvIx);
    for ( const mesh of meshes ) renderer.render(mesh, { renderTexture, clear: false });
    meshes.forEach(mesh => mesh.destroy());
  }



  // ----- NOTE: Debugging methods ----- //

  _draw3dDebug() {
    const renderer = this.popout.pixiApp.renderer;
    // Testing: renderer.state.setDepthTest = true;

    const { debugShaders, debugRenderTexture } = this;

    // Build target mesh to measure the target viewable area.
    this.#renderTarget(renderer, debugRenderTexture, debugShaders);

    // Render obstacles. Render opaque first.
    this.#renderOpaqueObstacles(renderer, debugRenderTexture, debugShaders);
    this.#renderTransparentObstacles(renderer, debugRenderTexture, debugShaders, this._buildTileDebugShader.bind(this));
  }

  openDebugPopout() {
    this.viewerLOS._addChildToPopout(this.debugSprite);
  }

  #buildTargetMesh(shaders) {
    const targetShader = shaders.target;
    const { near, far, fov } = this.frustrum;
    targetShader._initializeLookAtMatrix(this.viewpoint, this.viewerLOS.targetCenter);

    targetShader._initializePerspectiveMatrix(fov, 1, near, far);
    return this.constructor.buildMesh(this.viewerLOS.target[GEOMETRY_ID].geometry, targetShader);
  }
}