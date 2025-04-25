/* globals
CONFIG,
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
import { PointsViewpoint } from "../PointsViewpoint.js";
import { VisionTriangle } from "../VisionPolygon.js";
import { Settings } from "../../settings.js";

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
  percentVisible(viewer, target, { viewerLocation, targetLocation, ...opts } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
    return this._percentRedPixels();
  }

  async percentVisibleAsync(viewer, target, { viewerLocation, targetLocation, ...opts } = {}) {
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