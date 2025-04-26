/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";
import { RenderObstacles } from "../WebGPU/RenderObstacles.js";
import { WebGPUDevice } from "../WebGPU/WebGPU.js";
import { AsyncQueue } from "../WebGPU/AsyncQueue.js";
import { WebGPUSumRedPixels } from "../WebGPU/SumPixels.js";
import { AbstractViewerLOS } from "../AbstractViewerLOS.js";
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { VisionTriangle } from "../VisionPolygon.js";
import { Settings } from "../../settings.js";

import { PointsViewpoint } from "../PointsViewpoint.js";

// ??
import { Area3dWebGL2Viewpoint } from "../Area3dWebGL2Viewpoint.js";
import { Grid3dGeometry, GEOMETRY_ID } from "../Placeable3dGeometry.js";
import { Placeable3dShader, Tile3dShader } from "../Placeable3dShader.js";
import { sumRedPixels, sumRedObstaclesPixels } from "../util.js";
import { Point3d } from "../../geometry/3d/Point3d.js";

// PIXI
import { MODULE_ID } from "../../const.js";
import { Camera } from "../WebGPU/Camera.js";


// Geometric
import { Draw } from "../../geometry/Draw.js";
import { ClipperPaths } from "../../geometry/ClipperPaths.js";
import { minMaxPolygonCoordinates } from "../util.js";
import { Grid3dTriangles  } from "../PlaceableTriangles.js";

const RADIANS_90 = Math.toRadians(90);

/* Percent visible calculator

Track percent visibility for tokens.
Caches values based on the viewer, viewer location, target, target location.
- Cache is tied to the placeable updates.
*/

class PercentVisibleCalculatorAbstract {

  /** @type {number} */
  static TERRAIN_THRESHOLD = 255 * 0.75;

  /** @type {string} */
  senseType = "sight";

  constructor({ senseType = "sight" } = {}) {
    this.senseType = senseType;
  }

  async initialize() { return; }

  // ----- NOTE: Visibility testing ----- //

  /**
   * Determine percent visible based on 3d view or return cached value.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {object} [opts]
   * @param {Point3d} [opts.viewerLocation]   Where the camera is located
   * @param {Point3d} [opts.targetLocation]   Where the camera is looking to in 3d space
   * @returns {number}
   */
  percentVisible(viewer, target, { viewerLocation, targetLocation, ..._opts } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
    return this._percentRedPixels();
  }

  async percentVisibleAsync(viewer, target, { viewerLocation, targetLocation, ..._opts } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
    return this._percentRedPixelsAsync();
  }

  /**
   * Do any preparatory calculations for determining the percent visible.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @override
   */
  _calculatePercentVisible(_viewer, _target, _viewerLocation, _targetLocation) { return; }

  /**
   * Determine the percentage red pixels for the current view.
   * @returns {number}
   * @override
   */
  _percentRedPixels() { console.error("PercentVisibleCalculator|Must be overriden by child class.") }

  async _percentRedPixelsAsync() { return this._percentRedPixels(); }

  destroy() { return; }
}

/**
 * Handle points algorithm.
 */
export class PointsPercentVisibleCalculator extends PercentVisibleCalculatorAbstract {
  /** @type {ViewpointConfig} */
  config = {};

  visionTriangle;

  /** @type {Points3d[][]} */
  targetPoints = [];

  async initialize() {
    this.config = this.initializeConfig();
  }

  _calculatePercentVisible(viewer, target, viewerLocation, _targetLocation) {
    this.viewpoint = viewerLocation;
    this.visibleTargetShape = this._calculateVisibleTargetShape(target);
    this.visionTriangle = VisionTriangle.build(viewerLocation, target);
    this.filterPotentiallyBlockingTriangles(viewer, viewerLocation, target);
    this.targetPoints = this.constructTargetPoints(target);
  }

  _percentRedPixels() {
    return (1 - this._testTargetPoints(this.targetPoints, this.viewpoint, this.visibleTargetShape));
  }

  /* ----- NOTE: Target points ----- */

  /**
   * Sets configuration to the current settings.
   * @param {ViewpointConfig} [cfg]
   * @returns {ViewpointConfig}
   */
  initializeConfig(cfg = {}) {
    // Configs specific to the Points algorithm.
    const POINT_OPTIONS = Settings.KEYS.LOS.TARGET.POINT_OPTIONS;
    cfg.pointAlgorithm ??= Settings.get(POINT_OPTIONS.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER;
    cfg.targetInset ??= Settings.get(POINT_OPTIONS.INSET) ?? 0.75;
    cfg.points3d ??= Settings.get(POINT_OPTIONS.POINTS3D) ?? false;
    cfg.largeTarget ??= Settings.get(Settings.KEYS.LOS.TARGET.LARGE);
    cfg.useLitTargetShape ??= true;

    // Blocking canvas objects.
    cfg.blocking ??= {};
    cfg.blocking.walls ??= true;
    cfg.blocking.tiles ??= true;

    // Blocking tokens.
    cfg.blocking.tokens ??= {};
    cfg.blocking.tokens.dead ??= Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK);
    cfg.blocking.tokens.live ??= Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK);
    cfg.blocking.tokens.prone ??= Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK);

    return cfg;
  }

  /*
   * Similar to _constructViewerPoints but with a complication:
   * - Grid. When set, points are constructed per grid space covered by the token.
   * @param {Token} target
   * @returns {Points3d[][]}
   */
  constructTargetPoints(target) {
    const { pointAlgorithm, targetInset, points3d, largeTarget } = this.config;
    const cfg = { pointAlgorithm, inset: targetInset, viewpoint: this.viewpoint };

    if ( largeTarget ) {
      // Construct points for each target subshape, defined by grid spaces under the target.
      const targetShapes = PointsViewpoint.constrainedGridShapesUnderToken(target);

      // Issue #8: possible for targetShapes to be undefined or not an array??
      if ( targetShapes && targetShapes.length ) {
        const targetPointsArray = targetShapes.map(targetShape => {
          cfg.tokenShape = targetShape;
          const targetPoints = AbstractViewpoint.constructTokenPoints(target, cfg);
          if ( points3d ) return PointsViewpoint.elevatePoints(target, targetPoints);
          return targetPoints;
        });
        return targetPointsArray;
      }
    }

    // Construct points under this constrained token border.
    cfg.tokenShape = target.constrainedTokenBorder;
    const targetPoints = AbstractViewpoint.constructTokenPoints(target, cfg);
    if ( points3d ) return [PointsViewpoint.elevatePoints(target, targetPoints)];
    return [targetPoints];
  }

  /* ----- NOTE: Collision testing ----- */

  /** @param {Triangle[]} */
  triangles = [];

  terrainTriangles = [];

  /**
   * Filter the triangles that might block the viewer from the target.
   */
  filterPotentiallyBlockingTriangles(viewer, viewerLocation, target) {
    this.triangles.length = 0;
    this.terrainTriangles.length = 0;
    const blockingObjects = AbstractViewpoint.findBlockingObjects(viewerLocation, target,
      { viewer, senseType: this.senseType, blockingOpts: this.config.blocking });

    const { terrainWalls, tiles, tokens, walls } = blockingObjects;
    for ( const terrainWall of terrainWalls ) {
      const triangles = AbstractViewpoint.filterPlaceableTrianglesByViewpoint(terrainWall, viewerLocation);
      this.terrainTriangles.push(...triangles);
    }
    for ( const placeable of [...tiles, ...tokens, ...walls] ) {
      const triangles = AbstractViewpoint.filterPlaceableTrianglesByViewpoint(placeable, viewerLocation);
      this.triangles.push(...triangles);
    }
  }

  /* ----- NOTE: Visibility testing ----- */


  _calculateVisibleTargetShape(target) {
    return this.config.useLitTargetShape
      ? AbstractViewerLOS.constructLitTargetShape(target) : target.constrainedTokenBorder;
  }

  /**
   * Test an array of token points against an array of target points.
   * Each tokenPoint will be tested against every array of targetPoints.
   * @param {Point3d[][]} targetPointsArray   Array of array of target points to test.
   * @returns {number} Minimum percent blocked for the token points
   */
  _testTargetPoints(targetPointsArray, viewpoint, visibleTargetShape) {
    targetPointsArray ??= this.targetPoints;
    visibleTargetShape ??= this.visibleTargetShape;
    let minBlocked = 1;
    if ( this.config.debug ) this.debugPoints.length = 0;
    for ( const targetPoints of targetPointsArray ) {
      const percentBlocked = this._testPointToPoints(targetPoints, viewpoint, visibleTargetShape);

      // We can escape early if this is completely visible.
      if ( !percentBlocked ) return 0;
      minBlocked = Math.min(minBlocked, percentBlocked);
    }
    return minBlocked;
  }

  debugPoints = [];

  /**
   * Helper that tests collisions between a given point and a target points.
   * @param {Point3d} tokenPoint        Point on the token to use.
   * @param {Point3d[]} targetPoints    Array of points on the target to test
   * @returns {number} Percent points blocked
   */
  _testPointToPoints(targetPoints, viewpoint, visibleTargetShape) {
    let numPointsBlocked = 0;
    const ln = targetPoints.length;
    // const debugDraw = this.viewerLOS.config.debugDraw;
    let debugPoints = [];
    if ( this.config.debug ) this.debugPoints.push(debugPoints);
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const outsideVisibleShape = visibleTargetShape
        && !visibleTargetShape.contains(targetPoint.x, targetPoint.y);
      if ( outsideVisibleShape ) continue;

      // For the intersection test, 0 can be treated as no intersection b/c we don't need
      // intersections at the origin.
      // Note: cannot use Point3d._tmp with intersection.
      // TODO: Does intersection return t values if the intersection is outside the viewpoint --> target?
      let nCollisions = 0;
      let hasCollision = this.triangles.some(tri => tri.intersection(viewpoint, targetPoint.subtract(viewpoint)))
        || this.terrainTriangles.some(tri => {
        nCollisions += Boolean(tri.intersection(viewpoint, targetPoint.subtract(viewpoint)));
        return nCollisions >= 2;
      });
      numPointsBlocked += hasCollision;

      if ( this.config.debug ) {
        debugPoints = { A: viewpoint, B: targetPoint, hasCollision };
//         const color = hasCollision ? Draw.COLORS.red : Draw.COLORS.green;
//         debugDraw.segment({ A: viewpoint, B: targetPoint }, { alpha: 0.5, width: 1, color });
//         console.log(`Drawing segment ${viewpoint.x},${viewpoint.y} -> ${targetPoint.x},${targetPoint.y} with color ${color}.`);
      }
    }
    return numPointsBlocked / ln;
  }
}

export class Area3dWebGL2VisibleCalculator extends PercentVisibleCalculatorAbstract {
  /** @type {number} */
  static WIDTH = 128;

  /** @type {number} */
  static HEIGHT = 128;

  _tileShaders = new Map();

  /**
   * Sets configuration to the current settings.
   * @param {ViewpointConfig} [cfg]
   * @returns {ViewpointConfig}
   */
  initializeConfig(cfg = {}) {
    // Configs specific to the Points algorithm.
    const POINT_OPTIONS = Settings.KEYS.LOS.TARGET.POINT_OPTIONS;
    cfg.pointAlgorithm ??= Settings.get(POINT_OPTIONS.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER;
    cfg.targetInset ??= Settings.get(POINT_OPTIONS.INSET) ?? 0.75;
    cfg.points3d ??= Settings.get(POINT_OPTIONS.POINTS3D) ?? false;
    cfg.largeTarget ??= Settings.get(Settings.KEYS.LOS.TARGET.LARGE);
    cfg.useLitTargetShape ??= true;

    // Blocking canvas objects.
    cfg.blocking ??= {};
    cfg.blocking.walls ??= true;
    cfg.blocking.tiles ??= true;

    // Blocking tokens.
    cfg.blocking.tokens ??= {};
    cfg.blocking.tokens.dead ??= Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK);
    cfg.blocking.tokens.live ??= Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK);
    cfg.blocking.tokens.prone ??= Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK);

    return cfg;
  }

  /** @type {PIXI.RenderTexture} */
  #renderTexture;

  get renderTexture() {
    if ( !this.#renderTexture || this.#renderTexture.destroyed ) {
      this.#renderTexture = PIXI.RenderTexture.create(this.constructor.renderTextureConfiguration);
      this.#renderTexture.framebuffer.enableDepth();
    }
    return this.#renderTexture;
  }

  static renderTextureConfiguration = {
    resolution: 1,
    scaleMode: PIXI.SCALE_MODES.NEAREST,
    multisample: PIXI.MSAA_QUALITY.NONE,
    alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
    width: this.WIDTH,
    height: this.HEIGHT,
  };

  /** @type {PIXI.Container} */
  #obstacleContainer;

  get obstacleContainer() {
    if ( !this.#obstacleContainer
      || this.#obstacleContainer.destroyed ) this.#obstacleContainer = new PIXI.Container();
    return this.#obstacleContainer;
  }

  shaders = {};

  _initializeShaders() {
    const shaders = [
      "target",
      "obstacle",
      "terrainWall"
    ];

    for ( const shaderName of shaders ) {
      this.shaders[shaderName] = Placeable3dShader.create(Point3d._tmp, Point3d._tmp);
    }

    // Set color for each shader.
    this.shaders.target.setColor(1, 0, 0, 1); // Red
    this.shaders.obstacle.setColor(0, 0, 1, 1);  // Blue
    this.shaders.terrainWall.setColor(0, 0, 1, 0.5); // Blue, half-alpha
  }

  frustrum = {
    near: 1,
    far: null,
    fov: RADIANS_90,
  };

  /**
   * Calculate the relevant frustrum properties for this viewer and target.
   * We want the target token to be completely within the viewable frustrum but
   * take up as much as the frustrum frame as possible, while limiting the size of the frame.
   */
  _constructFrustrum() {
    const viewerAngle = Math.toRadians(this.viewer.vision?.data?.angle) || Math.PI * 2;

    // Determine the optimal fov given the distance.
    // https://docs.unity3d.com/Manual/FrustumSizeAtDistance.html
    // Use near instead of far to ensure frame at start of token is large enough.
    const { diagonal, nearDistance } = this._calculateTargetDistance3dProperties();
    let angleRad = 2 * Math.atan(diagonal * (0.5 / nearDistance));
    angleRad = Math.min(angleRad, viewerAngle);
    angleRad ??= RADIANS_90;
    this.frustrum.fov = this.frustrum.fov || angleRad;// + RADIANS_1;

    // Far distance is distance to the furthest point of the target.
    // this.#frustrum.far = this.#frustrumFar || farDistance;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within the viewer token.
    // (If the viewer point is on the edge, we want basically everything.)
    // this.frustrum.near = this.frustrumNear;
    // if ( !this.frustrum.near ) this.frustrum.near ||= 1;
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
    const targetShader = shaders.target;
    const { near, far, fov } = this.frustrum;
    targetShader._initializeLookAtMatrix(this.viewpoint, this.targetLocation);

    targetShader._initializePerspectiveMatrix(fov, 1, near, far);
    return Area3dWebGL2Viewpoint.buildMesh(this.target[GEOMETRY_ID].geometry, targetShader);
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
    const buildMesh = Area3dWebGL2Viewpoint.buildMesh;
    const { near, far, fov } = frustrum;
    const obstacleShader = shaders.obstacle;
    obstacleShader._initializeLookAtMatrix(viewpoint, this.targetLocation);
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
    const buildMesh = Area3dWebGL2Viewpoint.buildMesh;
    const { viewpoint, frustrum } = this;
    const targetCenter = this.targetLocation;
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

  _buildTileShader(fov, near, far, tile) {
    const targetCenter = this.targetLocation;
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

  async initialize() {
    this.config = this.initializeConfig();
    this._initializeShaders();
  }

  /**
   * Do any preparatory calculations for determining the percent visible.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @override
   */
  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.viewer = viewer;
    this.target = target;
    this.viewpoint = viewerLocation;
    this.targetLocation = targetLocation;
//     for ( const shader of Object.values(this.shaders) ) {
//       shader._initializeLookAtMatrix(viewerLocation, targetLocation);
//       shader._calculatePerspectiveMatrix();
//     }

    this.blockingObjects = AbstractViewpoint.findBlockingObjects(viewerLocation, target,
      { viewer, senseType: this.senseType, blockingOpts: this.config.blocking });

    const { renderTexture, shaders } = this;
    const renderer = canvas.app.renderer;
    if ( this.useLargeTarget ) {
      const gridCubeGeometry = new Grid3dGeometry(target);
      gridCubeGeometry.updateObjectPoints(); // Necessary if just created?
      gridCubeGeometry.updateVertices();     // Necessary if just created?

      const gridCubeMesh = Area3dWebGL2Viewpoint.buildMesh(this.gridCubeGeometry, shaders.target);
      renderer.render(gridCubeMesh, { renderTexture, clear: true });
      this.gridCubeCache = renderer.extract._rawPixels(renderTexture);
    }

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

  /**
   * Determine the percentage red pixels for the current view.
   * @returns {number}
   * @override
   */
  _percentRedPixels() {
    const sumGridCube = (this.useLargeTarget ? sumRedPixels(this.gridCubeCache) : 0) || Number.POSITIVE_INFINITY;
    const sumTarget = sumRedPixels(this.targetCache);
    const obstacleSum = this.blockingObjects.terrainWalls.size ? sumRedObstaclesPixels : sumRedPixels;
    const sumWithObstacles = obstacleSum(this.obstacleCache);
    const denom = Math.min(sumGridCube, sumTarget);
    return sumWithObstacles / denom;
  }

  destroy() {
    if ( this.#renderTexture ) this.#renderTexture = this.#renderTexture.destroy();
    if ( this.#obstacleContainer ) this.#obstacleContainer = this.#obstacleContainer.destroy();
    this._tileShaders.forEach(s => s.destroy());
    this._tileShaders.clear();
  }

}

export class Area3dGeometricVisibleCalculator extends PercentVisibleCalculatorAbstract {
  /** @type {Camera} */
  camera = new Camera({ glType: "webGL2", perspectiveType: "perspective" });

  /**
   * Scaling factor used with Clipper
   */
  static SCALING_FACTOR = 100;

  /**
   * Sets configuration to the current settings.
   * @param {ViewpointConfig} [cfg]
   * @returns {ViewpointConfig}
   */
  initializeConfig(cfg = {}) {
    // Configs specific to the Points algorithm.
    const POINT_OPTIONS = Settings.KEYS.LOS.TARGET.POINT_OPTIONS;
    cfg.pointAlgorithm ??= Settings.get(POINT_OPTIONS.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER;
    cfg.targetInset ??= Settings.get(POINT_OPTIONS.INSET) ?? 0.75;
    cfg.points3d ??= Settings.get(POINT_OPTIONS.POINTS3D) ?? false;
    cfg.largeTarget ??= Settings.get(Settings.KEYS.LOS.TARGET.LARGE);
    cfg.useLitTargetShape ??= true;

    // Blocking canvas objects.
    cfg.blocking ??= {};
    cfg.blocking.walls ??= true;
    cfg.blocking.tiles ??= true;

    // Blocking tokens.
    cfg.blocking.tokens ??= {};
    cfg.blocking.tokens.dead ??= Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK);
    cfg.blocking.tokens.live ??= Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK);
    cfg.blocking.tokens.prone ??= Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK);

    return cfg;
  }

  async initialize() {
    this.config = this.initializeConfig();
  }

  viewer;

  target;

  viewpoint;

  targetLocation;

  targetArea = 0;

  obscuredArea = 0;

  gridSquareArea = 0;

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.viewer = viewer;
    this.target = target;
    this.viewpoint = viewerLocation;
    this.targetLocation = targetLocation;

    this.camera.cameraPosition = this.viewpoint;
    this.camera.targetPosition = this.viewerLOS.targetCenter;
    this.camera.setTargetTokenFrustrum(this.viewerLOS.target);

    this.blockingObjects = AbstractViewpoint.findBlockingObjects(viewerLocation, target,
      { viewer, senseType: this.senseType, blockingOpts: this.config.blocking });

    const res = this._obscuredArea();
    this.targetArea = res.targetArea;
    this.obscuredArea = res.obscuredArea;

    if ( this.config.largeTarget ) this.gridSquareArea = this._gridSquareArea();
  }


  /**
   * Determine the percentage red pixels for the current view.
   * @returns {number}
   * @override
   */
  _percentRedPixels() {
    if ( this.config.largeTarget ) this.targetArea = Math.min(this.gridSquareArea || 100_000, this.targetArea);

    // Round the percent seen so that near-zero areas are 0.
    // Because of trimming walls near the vision triangle, a small amount of token area can poke through
    const percentSeen = this.targetArea ? this.obscuredArea / this.targetArea : 0;
    if ( percentSeen.almostEqual(0, 1e-02) ) return 0;
    return percentSeen;
  }

  /**
   * Construct 2d perspective projection of each blocking points object.
   * Combine them into a single array of blocking polygons.
   * For each visible side of the target, build the 2d perspective polygon for that side.
   * Take the difference between that side and the blocking polygons to determine the
   * visible portion of that side.
   * @returns {object} { obscuredSides: PIXI.Polygon[], sidePolys: PIXI.Polygon[]}
   *   sidePolys: The sides of the target, in 2d perspective.
   *   obscuredSides: The unobscured portions of the sidePolys
   */
  _obscuredArea() {
    const { walls, tokens, tiles, terrainWalls } = this.blockingObjects;
    if ( !(walls.size || tokens.size || tiles.size || terrainWalls.size) ) return { targetArea: 1, obscuredArea: 0 };

    // Construct polygons representing the perspective view of the target and blocking objects.
    const { targetPolys, blockingPolys, blockingTerrainPolys } = this._constructPerspectivePolygons();

    // TODO: union, combine, joinPaths, or add? Use clean?

//     const targetPaths = ClipperPaths.fromPolygons(targetPolys, { scalingFactor })
//       .union()
//       .clean();
//     const blockingTerrainPaths = ClipperPaths.fromPolygons(blockingTerrainPolys, { scalingFactor })
//       .union()
//       .clean();
//     const blockingPaths = ClipperPaths.fromPolygons(blockingPolys, { scalingFactor })
//       .union()
//       .clean();

    // Use Clipper to calculate area of the polygon shapes.
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const targetPaths = ClipperPaths.fromPolygons(targetPolys, { scalingFactor });
    const blockingTerrainPaths = this._combineTerrainPaths(blockingTerrainPolys);
    let blockingPaths = ClipperPaths.fromPolygons(blockingPolys, { scalingFactor });
    if ( blockingTerrainPaths && !blockingTerrainPaths.area.almostEqual(0) ) {
      blockingPaths = blockingPaths.add(blockingTerrainPaths).combine();
    }

    // Construct the obscured shape by taking the difference between the target polygons and
    // the blocking polygons.
    const targetArea = Math.abs(targetPaths.area);
    if ( targetArea.almostEqual(0) ) return { targetArea, obscuredArea: 0 };

    const diff = blockingPaths.diffPaths(targetPaths); // TODO: Correct order?
    return { targetArea, obscuredArea: Math.abs(diff.area) };
  }

   _combineTerrainPaths(blockingTerrainPolys) {
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const blockingTerrainPaths = new ClipperPaths()

    // The intersection of each two terrain polygons forms a blocking path.
    // Only need to test each combination once.
    const nBlockingPolys = blockingTerrainPolys.length;
    if ( nBlockingPolys < 2 ) return null;
    for ( let i = 0; i < nBlockingPolys; i += 1 ) {
      const iPath = ClipperPaths.fromPolygons(blockingTerrainPolys.slice(i, i + 1), { scalingFactor });
      for ( let j = i + 1; j < nBlockingPolys; j += 1 ) {
        const newPath = iPath.intersectPolygon(blockingTerrainPolys[j]);
        if ( newPath.area.almostEqual(0) ) continue; // Skip very small intersections.
        blockingTerrainPaths.add(newPath);
      }
    }

    if ( !blockingTerrainPaths.paths.length ) return null;
    return blockingTerrainPaths.combine();
  }

  _blockingTerrainPolys;

  _blockingPolys;

  _targetPolys;

  _gridPolys;

  /**
   * Construct polygons that are used to form the 2d perspective.
   */
  _constructPerspectivePolygons() {
    const { walls, tokens, tiles, terrainWalls } = this.blockingObjects;

    // Construct polygons representing the perspective view of the target and blocking objects.
    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;
    const targetPolys = this._lookAtObjectWithPerspective(this.viewerLOS.target, lookAtM, perspectiveM);

    const blockingPolys = this._blockingPolys = [...walls, ...tiles, ...tokens].flatMap(obj =>
      this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));

    const blockingTerrainPolys = this._blockingTerrainPolys = [...terrainWalls].flatMap(obj =>
       this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));

    return { targetPolys, blockingPolys, blockingTerrainPolys };
  }

  _lookAtObject(object, lookAtM) {
    return this._filterPlaceableTrianglesByViewpoint(object)
      .map(tri => tri.transform(lookAtM).toPolygon());
  }

  _lookAtObjectWithPerspective(object, lookAtM, perspectiveM) {
    return this._filterPlaceableTrianglesByViewpoint(object)
      .map(tri => tri
        .transform(lookAtM)
        .transform(perspectiveM)
        .toPolygon());
  }

  /** @type {AbstractPolygonTriangles[]} */
  static get grid3dShape() { return Grid3dTriangles.trianglesForGridShape(); }

  /**
   * Area of a basic grid square to use for the area estimate when dealing with large tokens.
   * @returns {number}
   */
  _gridSquareArea(lookAtM, perspectiveM) {
     const gridPolys = this._gridPolys = this._gridPolygons(lookAtM, perspectiveM);
     const gridPaths = ClipperPaths.fromPolygons(gridPolys, {scalingFactor: this.constructor.SCALING_FACTOR});
     gridPaths.combine().clean();
     return gridPaths.area;
  }

  _gridPolygons(lookAtM, perspectiveM) {
     const target = this.viewerLOS.target;
     const { x, y } = target.center;
     const z = target.bottomZ + (target.topZ - target.bottomZ);
     const gridTris = Grid3dTriangles.trianglesForGridShape();
     const translateM = CONFIG.GeometryLib.MatrixFlat.translation(x, y, z);
     return gridTris
       .filter(tri => tri.isFacing(this.viewpoint))
       .map(tri => tri
         .transform(translateM)
         .transform(lookAtM)
         .transform(perspectiveM)
         .toPolygon());
  }

  /* ----- NOTE: Debugging methods ----- */

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(drawTool, _renderer) {
    // Recalculate the 3d objects.
    const { targetPolys, blockingPolys, blockingTerrainPolys } = this._constructPerspectivePolygons();
    const colors = Draw.COLORS;

    // Scale the target graphics to fit in the view window.
    const { xMinMax, yMinMax } = minMaxPolygonCoordinates(this._targetPolys);
    const maxCoord = 200;
    const scale = Math.min(1,
      maxCoord / xMinMax.max,
      -maxCoord / xMinMax.min,
      maxCoord / yMinMax.max,
      -maxCoord / yMinMax.min
    );
    drawTool.g.scale = new PIXI.Point(scale, scale);

    // TODO: Do the target polys need to be translated back to 0,0?
    // Draw the target in 3d, centered on 0,0
    targetPolys.forEach(poly => drawTool.shape(poly, { color: colors.orange, fill: colors.lightred, fillAlpha: 0.5 }));

    // Draw the grid shape.
    if ( this.viewerLOS.config.largeTarget ) this._gridPolys.forEach(poly =>
      drawTool.shape(poly, { color: colors.lightorange, fillAlpha: 0.4 }));

    // Draw the detected objects in 3d, centered on 0,0
    blockingPolys.forEach(poly => drawTool.shape(poly, { color: colors.blue, fill: colors.lightblue, fillAlpha: 0.5 }));
    blockingTerrainPolys.forEach(poly => drawTool.shape(poly, { color: colors.green, fill: colors.lightgreen, fillAlpha: 0.5 }));
  }
}

export class Area3dPIXIVisibleCalculator extends PercentVisibleCalculatorAbstract {
  /** @type {number} */
  static WIDTH = 128;

  /** @type {number} */
  static HEIGHT = 128;

  /**
   * Sets configuration to the current settings.
   * @param {ViewpointConfig} [cfg]
   * @returns {ViewpointConfig}
   */
  initializeConfig(cfg = {}) {
    // Configs specific to the Points algorithm.
    const POINT_OPTIONS = Settings.KEYS.LOS.TARGET.POINT_OPTIONS;
    cfg.pointAlgorithm ??= Settings.get(POINT_OPTIONS.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER;
    cfg.targetInset ??= Settings.get(POINT_OPTIONS.INSET) ?? 0.75;
    cfg.points3d ??= Settings.get(POINT_OPTIONS.POINTS3D) ?? false;
    cfg.largeTarget ??= Settings.get(Settings.KEYS.LOS.TARGET.LARGE);
    cfg.useLitTargetShape ??= true;

    // Blocking canvas objects.
    cfg.blocking ??= {};
    cfg.blocking.walls ??= true;
    cfg.blocking.tiles ??= true;

    // Blocking tokens.
    cfg.blocking.tokens ??= {};
    cfg.blocking.tokens.dead ??= Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK);
    cfg.blocking.tokens.live ??= Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK);
    cfg.blocking.tokens.prone ??= Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK);

    return cfg;
  }

  /** @type {PIXI.RenderTexture} */
  #renderTexture;

  get renderTexture() {
    if ( !this.#renderTexture || this.#renderTexture.destroyed ) {
      this.#renderTexture = PIXI.RenderTexture.create(this.constructor.renderTextureConfiguration);
      this.#renderTexture.framebuffer.enableDepth();
    }
    return this.#renderTexture;
  }

  static renderTextureConfiguration = {
    resolution: 1,
    scaleMode: PIXI.SCALE_MODES.NEAREST,
    multisample: PIXI.MSAA_QUALITY.NONE,
    alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
    width: this.WIDTH,
    height: this.HEIGHT,
  };

  camera = new Camera({ glType: "webGL2" });

  #renderTarget(renderer, renderTexture, clear = true) {
    const isTarget = true;
    const ID = "atvPIXIHandler";
    const h = this.target[MODULE_ID][ID];
    const { perspectiveMatrix, lookAtMatrix } = this.camera;
    h.lookAtPerspective(perspectiveMatrix, lookAtMatrix, isTarget);
    renderer.render(h.mesh, { renderTexture, clear });
  }

  /**
   * Render the opaque blocking walls and token shapes to the render texture.
   * @param {PIXI.Renderer} renderer
   * @param {PIXI.RenderTexture} renderTexture
   * @param {PIXI.Shader[]} shaders
   */
  #renderOpaqueObstacles(renderer, renderTexture) {
    // Walls/Tokens
    const blockingObjects = this.blockingObjects;
    const nTokens = blockingObjects.tokens.size;
    const nWalls = blockingObjects.walls.size;
    if ( !(nTokens || nWalls) ) return;

    const ID = "atvPIXIHandler";
    const { perspectiveMatrix, lookAtMatrix } = this.camera;
    const isTerrain = false;
    for ( const wall of blockingObjects.walls ) {
      const h = wall[MODULE_ID][ID];
      h.lookAtPerspective(perspectiveMatrix, lookAtMatrix, isTerrain);
      renderer.render(h.mesh, { renderTexture, clear: false }); // Render sequentially so mesh can be reused.
    }

    const isTarget = false;
    for ( const token of blockingObjects.tokens ) {
      const h = token[MODULE_ID][ID];
      h.lookAtPerspective(perspectiveMatrix, lookAtMatrix, isTarget);
      renderer.render(h.mesh, { renderTexture, clear: false }); // Render sequentially so mesh can be reused.
    }
  }

  /**
   * Render the obstacles with transparency: tiles and terrain walls.
   * So that transparency works with depth, render furthest to closest from the viewer.
   * @param {PIXI.Renderer} renderer
   * @param {PIXI.RenderTexture} renderTexture
   * @param {PIXI.Shader[]} shaders
   */
  #renderTransparentObstacles(renderer, renderTexture) {
    const ID = "atvPIXIHandler";
    let blockingObjects = this.blockingObjects;
    const nTerrainWalls = blockingObjects.terrainWalls.size;
    const nTiles = blockingObjects.tiles.size;
    if ( !(nTerrainWalls || nTiles) ) return;

    // Build mesh from each obstacle and
    // measure distance along ray from viewer point to target center.
    const toSort = [];
    const rayDir = this.targetLocation.subtract(this.viewpoint);
    const isTerrain = true;
    for ( const terrainWall of blockingObjects.terrainWalls ) {
      const plane = CONFIG.GeometryLib.threeD.Plane.fromWall(terrainWall);
      const ix = plane.rayIntersection(this.viewpoint, rayDir);
      if ( ix <= 0 ) continue;
      toSort.push({ ix, h: terrainWall[MODULE_ID][ID] });
    }

    for ( const tile of blockingObjects.tiles ) {
      const plane = new CONFIG.GeometryLib.threeD.Plane(new CONFIG.GeometryLib.threeD.Point3d(0, 0, tile.elevationZ))
      const ix = plane.rayIntersection(this.viewpoint, rayDir);
      if ( ix <= 0 ) continue;
      toSort.push({ ix, h: tile[MODULE_ID][ID] });
    }

    // Sort and render each in turn
    toSort.sort((a, b) => b.ix - a.ix);
    const { perspectiveMatrix, lookAtMatrix } = this.camera;
    for ( const obj of toSort ) {
      obj.h.lookAtPerspective(perspectiveMatrix, lookAtMatrix, isTerrain);
      renderer.render(obj.h.mesh, { renderTexture, clear: false });
    }
  }

  async initialize() {
    this.config = this.initializeConfig();
  }

  /**
   * Do any preparatory calculations for determining the percent visible.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @override
   */
  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.viewer = viewer;
    this.target = target;
    this.viewpoint = viewerLocation;
    this.targetLocation = targetLocation;
    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustrum(target);

    this.blockingObjects = AbstractViewpoint.findBlockingObjects(viewerLocation, target,
      { viewer, senseType: this.senseType, blockingOpts: this.config.blocking });

    const { renderTexture, shaders } = this;
    const renderer = canvas.app.renderer;
    if ( this.useLargeTarget ) {
      const gridCubeGeometry = new Grid3dGeometry(target);
      gridCubeGeometry.updateObjectPoints(); // Necessary if just created?
      gridCubeGeometry.updateVertices();     // Necessary if just created?

      const gridCubeMesh = Area3dWebGL2Viewpoint.buildMesh(this.gridCubeGeometry, shaders.target);
      renderer.render(gridCubeMesh, { renderTexture, clear: true });
      this.gridCubeCache = renderer.extract._rawPixels(renderTexture);
    }

    // Build target mesh to measure the target viewable area.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    this.#renderTarget(renderer, renderTexture);
    this.targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);

    // Render obstacles. Render opaque first.
    this.#renderOpaqueObstacles(renderer, renderTexture);
    this.#renderTransparentObstacles(renderer, renderTexture);

    // Calculate target area remaining after obstacles.
    this.obstacleCache = renderer.extract._rawPixels(renderTexture);
  }

  /**
   * Determine the percentage red pixels for the current view.
   * @returns {number}
   * @override
   */
  _percentRedPixels() {
    const sumGridCube = (this.useLargeTarget ? sumRedPixels(this.gridCubeCache) : 0) || Number.POSITIVE_INFINITY;
    const sumTarget = sumRedPixels(this.targetCache);
    const obstacleSum = this.blockingObjects.terrainWalls.size ? sumRedObstaclesPixels : sumRedPixels;
    const sumWithObstacles = obstacleSum(this.obstacleCache);
    const denom = Math.min(sumGridCube, sumTarget);
    return sumWithObstacles / denom;
  }

  destroy() {
    if ( this.#renderTexture ) this.#renderTexture = this.#renderTexture.destroy();
  }

}



/**
 * Handles classes that use RenderObstacles to draw a 3d view of the scene from the viewer perspective.
 */
export class PercentVisibleRenderCalculatorAbstract extends PercentVisibleCalculatorAbstract {
  /** @type {number} */
  static WIDTH = 128;

  /** @type {number} */
  static HEIGHT = 128;

  /** @type {RenderObstaclesWebGL2|RenderObstacles} */
  renderObstacles;

  async initialize() {
    await this.renderObstacles.initialize();
  }

  percentVisible(...args) {
    this.renderObstacles.prerender();
    return super.percentVisible(...args);
  }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
  }

  destroy() {
    if ( this.renderObstacles ) this.renderObstacles.destroy();
  }
}

export class PercentVisibleCalculatorWebGL2 extends PercentVisibleRenderCalculatorAbstract {
  /** @type {Uint8Array} */
  bufferData;

  /** @type {OffscreenCanvas} */
  static glCanvas;

  /** @type {WebGL2Context} */
  gl;

  constructor(opts) {
    super(opts);
    const { WIDTH, HEIGHT } = this.constructor;
    this.constructor.glCanvas ??= new OffscreenCanvas(WIDTH, HEIGHT);
    const gl = this.gl = this.constructor.glCanvas.getContext("webgl2");
    this.renderObstacles = new RenderObstaclesWebGL2({ gl, senseType: this.senseType });
    this.bufferData = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    super._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
  }

  _percentRedPixels() {
    const gl = this.gl;
    this.gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferData);
    const pixels = this.bufferData;
    const terrainThreshold = this.constructor.TERRAIN_THRESHOLD;
    let countRed = 0;
    let countRedBlocked = 0;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const hasR = Boolean(r === 255);

      countRed += hasR;
      countRedBlocked += hasR * (Boolean(b === 255) || Boolean(g > terrainThreshold))
    }
    return (countRed - countRedBlocked) / countRed;
  }
}

export class PercentVisibleCalculatorWebGPU extends PercentVisibleCalculatorWebGL2 {

  /** @type {OffScreenCanvas} */
  static gpuCanvas;

  /** @type {GPUCanvasContext} */
  gpuCtx;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.renderObstacles = new RenderObstacles(device,
      { senseType: this.senseType, width: this.constructor.WIDTH, height: this.constructor.HEIGHT });

    this.constructor.gpuCanvas ??= new OffscreenCanvas(this.constructor.WIDTH, this.constructor.HEIGHT);
    this.gpuCtx = this.constructor.gpuCanvas.getContext("webgpu");
    this.gpuCtx.configure({
      device,
      format: WebGPUDevice.presentationFormat,
      alphamode: "premultiplied", // Instead of "opaque"
    });
  }

  async initialize() {
    await super.initialize();
    this.renderObstacles.setRenderTextureToCanvas(this.constructor.gpuCanvas);
  }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    // Same as PercentVisibleCalculatorAbstract.prototype._calculatePercentVisible
    // Skip the PercentVisibleCalculatorWebGL2 parent class.
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
  }

  /**
   * Must first render to the gpuCanvas.
   * Then call this to retrieve the pixel data.
   */
  _percentRedPixels() {
    const gl = this.gl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.constructor.gpuCanvas);
    return super._percentRedPixels();
  }
}

export class PercentVisibleCalculatorWebGPUAsync extends PercentVisibleRenderCalculatorAbstract {
  /** @type {WebGPUSumRedPixels} */
  sumPixels;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.renderObstacles = new RenderObstacles(device,
      { senseType: this.senseType, width: this.constructor.WIDTH, height: this.constructor.HEIGHT })
    this.sumPixels = new WebGPUSumRedPixels(device);
    this.queue = new AsyncQueue();
  }

  async initialize() {
    await super.initialize();
    await this.sumPixels.initialize();
    this.renderObstacles.setRenderTextureToInternalTexture()
  }

  async _percentRedPixelsAsync() {
    const res = await this.sumPixels.compute(this.renderObstacles.renderTexture);
    return (res.red - res.redBlocked) / res.red;
  }

  _percentRedPixels() {
    const res = this.sumPixels.computeSync(this.renderObstacles.renderTexture);
    return (res.red - res.redBlocked) / res.red;
  }
}