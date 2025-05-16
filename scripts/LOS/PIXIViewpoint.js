/* globals
canvas,
CONFIG,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// PlaceablePoints folder

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { sumRedPixels, sumRedObstaclesPixels } from "./util.js";
import { PercentVisibleRenderCalculatorAbstract } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerArea3dPIXI } from "./DebugVisibilityViewer.js";
import { NULL_SET } from "./util.js";

// GLSL
import { Grid3dGeometry, GEOMETRY_ID } from "./Placeable3dGeometry.js";
import { Placeable3dShader, Tile3dShader } from "./Placeable3dShader.js";

// Geometry
import { Point3d } from "../geometry/3d/Point3d.js";

// WebGL
import { Camera } from "./WebGPU/Camera.js";

// Debug

export class PIXIViewpoint extends AbstractViewpoint {
  static get calcClass() { return PercentVisibleCalculatorPIXI; }

  _draw3dDebug(drawTool, renderer, container, { width, height } = {}) {
    container.removeChild(this.debugSprite); // Does nothing if sprite not already there.
    container.addChild(this.debugSprite);

    // Use the popout renderer
    this.calculator._calculatePercentVisible(this.viewer, this.target, this.viewpoint, this.targetLocation, renderer);
    this.debugSprite.width = width * 4;
    this.debugSprite.height = height * 4;
  }

  /** @type {PIXI.Sprite} */
  #debugSprite;

  get debugSprite() {
    if ( !this.#debugSprite || this.#debugSprite.destroyed ) {
      const s = this.#debugSprite = PIXI.Sprite.from(this.calculator.renderTexture);
      s.scale = new PIXI.Point(1, -1); // Flip y-axis.
      s.anchor = new PIXI.Point(0.5, 0.5); // Centered on the debug window.
    }
    return this.#debugSprite;
  }
}

export class PercentVisibleCalculatorPIXI extends PercentVisibleRenderCalculatorAbstract {
  static get viewpointClass() { return PIXIViewpoint; }

  /** @type {Camera} */
  camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective",
    up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
    mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
  });

  _tileShaders = new Map();

  constructor(cfg = {}) {
    cfg.width ||= CONFIG[MODULE_ID].renderTextureSize || 128;
    cfg.height ||= CONFIG[MODULE_ID].renderTextureSize || 128;
    super(cfg);
  }

  /**
   * Sets configuration to the current settings.
   * @param {ViewpointConfig} [cfg]
   * @returns {ViewpointConfig}
   */
//   initializeConfig(cfg = {}) {
//     // Configs specific to the Points algorithm.
//     const POINT_OPTIONS = Settings.KEYS.LOS.TARGET.POINT_OPTIONS;
//     cfg.pointAlgorithm ??= Settings.get(POINT_OPTIONS.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER;
//     cfg.targetInset ??= Settings.get(POINT_OPTIONS.INSET) ?? 0.75;
//     cfg.points3d ??= Settings.get(POINT_OPTIONS.POINTS3D) ?? false;
//     cfg.largeTarget ??= Settings.get(Settings.KEYS.LOS.TARGET.LARGE);
//     cfg.useLitTargetShape ??= true;
//
//     // Blocking canvas objects.
//     cfg.blocking ??= {};
//     cfg.blocking.walls ??= true;
//     cfg.blocking.tiles ??= true;
//
//     // Blocking tokens.
//     cfg.blocking.tokens ??= {};
//     cfg.blocking.tokens.dead ??= Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK);
//     cfg.blocking.tokens.live ??= Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK);
//     cfg.blocking.tokens.prone ??= Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK);
//
//     return cfg;
//   }

  /** @type {PIXI.RenderTexture} */
  #renderTexture;

  get renderTexture() {
    if ( !this.#renderTexture || this.#renderTexture.destroyed ) {
      const renderCfg = this.constructor.renderTextureConfiguration;
      renderCfg.width = this.config.width;
      renderCfg.height = this.config.height;
      this.#renderTexture = PIXI.RenderTexture.create(renderCfg);
      this.#renderTexture.framebuffer.enableDepth();
    }
    return this.#renderTexture;
  }

  static get renderTextureConfiguration(){
    return {
      resolution: 1,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
      width: CONFIG[MODULE_ID].renderTextureSize || 128,
      height: CONFIG[MODULE_ID].renderTextureSize || 128,
    };
  }

  /** @type {PIXI.Container} */
  #obstacleContainer;

  get obstacleContainer() {
    if ( !this.#obstacleContainer
      || this.#obstacleContainer.destroyed ) this.#obstacleContainer = new PIXI.Container();
    return this.#obstacleContainer;
  }

  shaders = {};

  _initializeShaders() {
    const shaders = {
      target: [1, 0, 0, 1], // Red
      obstacle: [0, 0, 1, 1], // Blue
      terrainWall: [0, 0, 1, 0.5], // Blue, half-alpha
    };

    for ( const [shaderName, uColor] of Object.entries(shaders) ) {
      this.shaders[shaderName] = Placeable3dShader.create(this.camera, { uColor });
    }
  }

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
  }

  _calculateTargetDistance3dProperties() {
    const { viewpoint } = this;

    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const { topZ, bottomZ, bounds } = this.target;
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

    const diagonal = CONFIG.GeometryLib.threeD.Point3d.distanceBetween(tokenBoundaryPoints.TTL, tokenBoundaryPoints.BBR);
    const nearDistance = distMinMax.min;
    return { diagonal, nearDistance };
  }

  #buildTargetMesh(shaders) {
    // TODO: Option to draw lit target instead of constrained.
    const targetShader = shaders.target;
    return this.constructor.buildMesh(this.target[GEOMETRY_ID].geometry, targetShader);
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

    const { obstacleContainer } = this;
    const obstacleShader = shaders.obstacle;
    for ( const obj of otherBlocking ) {
      const mesh = this.constructor.buildMesh(obj[GEOMETRY_ID].geometry, obstacleShader);
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
    const { viewpoint } = this;
    const targetCenter = this.targetLocation;
    const rayDir = targetCenter.subtract(viewpoint);
    const meshes = [];
    if ( nTerrainWalls ) {
      const terrainWallShader = shaders.terrainWall;
      blockingObjects.terrainWalls.forEach(wall => {
        const mesh = this.constructor.buildMesh(wall[GEOMETRY_ID].geometry, terrainWallShader);
        const plane = CONFIG.GeometryLib.threeD.Plane.fromWall(wall);
        mesh._atvIx = plane.rayIntersection(viewpoint, rayDir);
        if ( mesh._atvIx > 0 ) meshes.push(mesh);
        else mesh.destroy();
      });
    }

    if ( nTiles ) {
      blockingObjects.tiles.forEach(tile => {
        const tileShader = tileMethod(tile);
        const mesh = this.constructor.buildMesh(tile[GEOMETRY_ID].geometry, tileShader);
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

  _buildTileShader(tile) {
    if ( !this._tileShaders.has(tile) ) {
      const shader = Tile3dShader.create(this.camera,
        { uColor: [0, 0, 1, 1], uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
      this._tileShaders.set(tile, shader);
    }
    const shader = this._tileShaders.get(tile);
    shader.update();
    return shader;
  }

  async initialize() {
    this._initializeShaders();
  }

  blockingObjects = {
    tiles: NULL_SET,
    tokens: NULL_SET,
    walls: NULL_SET,
    terrainWalls: NULL_SET,
  };

  /**
   * Do any preparatory calculations for determining the percent visible.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @override
   */
  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    // TODO: Do we ever need another renderer?
    const renderer = canvas.app.renderer;
    this.viewer = viewer;
    this.target = target;
    this.viewpoint = viewerLocation;
    this.targetLocation = targetLocation;

    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustum(target);

    Object.values(this.shaders).forEach(shader => shader.update());

    this.blockingObjects = AbstractViewpoint.findBlockingObjects(viewerLocation, target,
      { viewer, senseType: this.config.senseType, blockingOpts: this.config.blocking });

    const { renderTexture, shaders } = this;

    // Build target mesh to measure the target viewable area.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    this.#renderTarget(renderer, renderTexture, shaders);
    this.targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);

    // Render obstacles. Render opaque first.
    this.#renderOpaqueObstacles(renderer, renderTexture, shaders);
    this.#renderTransparentObstacles(renderer, renderTexture, shaders, this._buildTileShader.bind(this));

    // Calculate target area remaining after obstacles.
    this.obstacleCache = renderer.extract._rawPixels(renderTexture);
  }

  static buildMesh(geometry, shader) {
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.state.depthTest = true;
    mesh.state.culling = true;
    mesh.state.clockwiseFrontFace = true;
    mesh.state.depthMask = true;
    return mesh;
  }

  /**
   * Constrained target area, counting both lit and unlit portions of the target.
   * Used to determine the total area (denominator) when useLitTarget config is set.
   * @returns {number}
   */
  _constrainedTargetArea() {
    const renderer = canvas.app.renderer;
    const { renderTexture, shaders } = this;

    this.#renderTarget(renderer, renderTexture, shaders);
    const cache = canvas.app.renderer.extract._rawPixels(renderTexture);
    return sumRedPixels(cache);
  }

  _gridShapeArea() {
    // TODO: Do we ever need another renderer?
    const renderer = canvas.app.renderer;
    const { renderTexture, shaders } = this;

    const gridCubeGeometry = new Grid3dGeometry(this.target);
    gridCubeGeometry.updateObjectPoints(); // Necessary if just created?
    gridCubeGeometry.updateVertices();     // Necessary if just created?

    const gridCubeMesh = this.constructor.buildMesh(this.gridCubeGeometry, shaders.target);
    renderer.render(gridCubeMesh, { renderTexture, clear: true });
    const gridCubeCache = renderer.extract._rawPixels(renderTexture);
    return sumRedPixels(gridCubeCache);
  }

  _viewableTargetArea() {
    const obstacleSum = this.blockingObjects.terrainWalls.size ? sumRedObstaclesPixels : sumRedPixels;
    return obstacleSum(this.obstacleCache);
  }

  _totalTargetArea() { return sumRedPixels(this.targetCache); }

  destroy() {
    if ( this.#renderTexture ) this.#renderTexture = this.#renderTexture.destroy();
    if ( this.#obstacleContainer ) this.#obstacleContainer = this.#obstacleContainer.destroy();
    this._tileShaders.forEach(s => s.destroy());
    this._tileShaders.clear();
  }
}

export class DebugVisibilityViewerPIXI extends DebugVisibilityViewerArea3dPIXI {
  static viewpointClass = PIXIViewpoint;

  algorithm = Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL2;
}
