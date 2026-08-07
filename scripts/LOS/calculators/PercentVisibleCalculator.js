/* globals
canvas,
CONFIG,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../../geometry/const.js";
import { approximateClamp } from "../util.js";
import { NULL_SET } from "../../geometry/util.js";
import { ObstacleOcclusionTest } from "../../geometry/ObstacleOcclusionTest.js";
import { Point3d } from "../../geometry/3d/Point3d.js";
import { Camera } from "../Camera.js";
import { Frustum } from "../../geometry/3d/Frustum.js";
import { Draw } from "../../geometry/Draw.js";
import { ConfigHandler } from "../../geometry/ConfigHandler.js";

/**
 * @typedef {object} TokenBlockingConfig    Whether tokens block LOS
 * @property {boolean} dead                 Do dead tokens block?
 * @property {boolean} live                 Do live tokens block?
 * @property {boolean} prone                Do prone tokens block?
 */

/**
 * @typedef {object} BlockingConfig     Whether different objects block LOS
 * @property {boolean} walls                Do walls block?
 * @property {boolean} tiles                Do tiles block?
 * @property {TokenBlockingConfig} tokens   Do tokens block?
 */

/**
 * @typedef {object} CalculatorConfig    Configuration settings passed to viewpoints
 * @property {BlockingConfig} blocking                    Do various canvas objects block?
 * @property {boolean} largeTarget                        Use special handling for targets larger than grid square
 * @property {CONST.WALL_RESTRICTION_TYPES} senseType     Type of source (light, sight, etc.)
 * @property {boolean} testLighting            Should the illuminated target shape be used?
 */


/**
 * Stores the result from the percent visible calculator.
 * Takes the result and can return certain characteristics, such as percent visible.
 * Can combine 2+ results.
 */
export class PercentVisibleResult {

  static VISIBILITY = {
    FULL: 1,
    NONE: 0,
    MEASURED: -1,
  };

  target;

  data = {};

  visibility = this.constructor.VISIBILITY.MEASURED;

  config = {
    largeTarget: false,
  };

  logData() { }

  makeFullyNotVisible() { this.visibility = this.constructor.VISIBILITY.NONE; return this; }

  makeFullyVisible() { this.visibility = this.constructor.VISIBILITY.FULL; return this; }

  clone() {
    const out = new this();
    out.config = structuredClone(this.config);
    Object.assign(out.data, structuredClone(this.data));
    out.visibility = this.visibility;
    return out;
  }

  // ----- NOTE: "Area" calculation ----- //

  /* "Area"
   Can be number of points, area of face(s), or some other area or volume calculation.
   Key is it must be consistent for the given algorithm.
  */

  /**
   * Area of the target assuming nothing obscures it. Used as the denominator for percentage calcs.
   * @type {number}
   */
  get totalTargetArea() {
    const { width, height } = this.target.document;
    return width * height;
  }

  /**
   * Area of a single grid square (or target sized 1/1). Used as the denominator for percentage calcs
   * when large token option is enabled.
   * @type {number}
   */
  get largeTargetArea() {
    const { width, height } = this.target.document;
    return this.totalTargetArea / (width * height);
  }

  /**
   * Area of the target accounting for large target area config.
   * @type {number}
   */
  get targetArea() {
    if ( this._config.largeTarget ) return Math.min(this.totalTargetArea, this.largeTargetArea);
    return this.totalTargetArea;
  }

  /**
   * Area of the target that is visible.
   * @type {number}
   */
  get visibleArea() { return this.targetArea; }

  get percentVisible() {
    if ( ~this.visibility ) return this.visibility;
    return approximateClamp(this.visibleArea / this.targetArea, 0, 1, 1e-02);
  }

  /**
   * Blend this result with another result, taking the maximum values at each test location.
   * Used to treat viewpoints as "eyes" in which 2+ viewpoints are combined to view an object.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMaximize(other) {
    const { FULL, NONE } = this.constructor.VISIBILITY;

    // If this type is full, maximize will be full.
    if ( this.visibility === FULL ) return this.clone();

    // If this data type is empty, maximize will be the other.
    if ( this.visibility === NONE ) return other.clone();

    // This data type is custom. Check if the other is full or empty.
    if ( other.visibility === FULL ) return other.clone();
    if ( other.visibility === NONE ) return this.clone();

    return null; // Must be handled by subclass.
  }

  blendMinimize(other) {
    const { FULL, NONE } = this.constructor.VISIBILITY;

    // If both are full, minimize will be full.
    if ( this.visibility === FULL && other.visibility === FULL ) return this.clone();

    // If this data type is empty, minimize will be empty.
    if ( this.visibility === NONE ) return this.clone();
    if ( other.visibility === NONE ) return other.clone();

    // One or both are CUSTOM; handle with subclass.
    return null;
  }

  static max(...results) {
    let out = results.pop();
    for ( const result of results ) {
      if ( result.percentVisible > out.percentVisible ) out = result;
    }
    return out;
  }

  static min(...results) {
    let out = results.pop();
    for ( const result of results ) {
      if ( result.percentVisible < out.percentVisible ) out = result;
    }
    return out;
  }
}

/* Percent visible calculator
 * Calculate percent visibility for a token viewer, light, or sound looking at a target token.
 *
 * When constructed, stores a default configuration as modified by the constructor input ("permanent config").
 * Config can be temporarily overridden and reset. Calling `calculate` resets and takes optional temp config.
 */
export class PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisibleResult;

  /** @type {CalculatorConfig} */
  config = new ConfigHandler({
    radius: Number.POSITIVE_INFINITY,
    tokenShapeType: "tokenBorder", // constrainedTokenBorder, litTokenBorder, brightLitTokenBorder
    largeTarget: false,
    debug: false,
  });

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  get senseType() {
    return this.occlusionTester._config.senseType || "sight";
  }

  // ----- NOTE: Basic property getters / setters ---- //

  /** @type {GeometricPrimitive} */
  #targetShape;

  get targetShape() { return this.#targetShape; }

  set targetShape(value) {
    this.#targetShape = value;
    this.targetLocation = value.center;
  }

  /**
   * Viewpoint can be set by user or defaults to the center of the viewer shape.
   * @type {Point3d}
   */
  viewpoint = new Point3d();

  // Synonym.
  get rayOrigin() { return this.viewpoint; }

  /**
   * Target location can be set by user or defaults to the center of the target shape.
   * @type {Point3d}
   */
  targetLocation = new Point3d();

  occlusionTester;

  // ----- NOTE: Initialization ----- //

  async initialize() { }

  /**
   * Set the view for the camera and the occlusion tester.
   * Optionally set relevant properties.
   * NOTE: Occlusion tester viewer and target must be set elsewhere.
   * @param {object} [opts]
   * @param {GeometricPrimitive} [opts.viewerShape]
   * @param {GeometricPrimitive} [opts.targetShape]
   * @param {Point3d} [opts.viewpoint]
   * @param {Point3d} [opts.targetLocation]
   * @param {ObstacleOcclusionTest} [opts.occlusionTester]
   */
  setView({ targetShape, viewpoint, targetLocation, occlusionTester } = {}) {
    // console.debug("PercentVisibleCalculator|initializeView");
    if ( target ) this.target = target;
    if ( viewpoint ) this.viewpoint = viewpoint;
    if ( targetLocation ) this.targetLocation = targetLocation;
    if ( targetShape ) this.targetShape = targetShape;
    if ( occlusionTester ) this.occlusionTester = occlusionTester;

    const camera = this.camera;
    camera.cameraPosition = this.viewpoint;
    camera.targetPosition = this.targetLocation;
    camera.setFrustumForAABB3d(this.targetShape.aabb);
    this.occlusionTester.frustum ??= new Frustum();
    camera.toCanvasFrustum(this.occlusionTester.frustum);
    this.occlusionTester.update();
  }

  // ----- NOTE: Camera ----- //

  /** @type {Camera} */
  #camera;

  get camera() {
    return this.#camera || (this.#camera = new Camera({
      glType: "webGL2",
      perspectiveType: "perspective",
      up: new Point3d(0, 0, -1),
      mirrorMDiag: new Point3d(1, 1, 1),
    }));
  }

  // ----- NOTE: Visibility testing ----- //

  /** @type {ObstacleOcclusionTest} */
  occlusionTester;

  percentVisible() { return this.calculate().percentVisible; }

  _createResult() {
    const res = new this.constructor.resultClass();
    res.largeTarget = this.config.largeTarget;
    return res;
  }

  /**
   * Return the visibility result for the current calculator state.
   * Use setView to set state or set individually.
   * Also depends on config.
   * @param {CalculatorConfig} cfg
   * @returns {PercentVisibleResult}
   */
  calculate() {
    this.setView();
    return this._calculate();
  }

  _calculate() {
    // console.debug("PercentVisibleCalculator|_calculate");
    // By default, test if viewpoint --> target center is within the vision radius and return full or no visibility.
    const result = this._createResult();
    const isVisible = Point3d.distanceSquaredBetween(this.viewpoint, this.targetLocation) <= this.radius ** 2;
    return isVisible ? result.makeFullyVisible() : result.makeFullyNotVisible();
  }

  // ----- NOTE: Lighting test ----- //

  // TODO: Update for GeometricPrimitives

  static LIGHTING_TEST_TYPES = {
    DARK: 0,
    DIM: 1,
    BRIGHT: 2,
  };

  setLightingTest(type) {
    const { TYPES } = this.constructor.LIGHTING_TEST_TYPES;
    let tokenShapeType;
    switch ( type ) {
      case TYPES.DIM: tokenShapeType = "litTokenBorder"; break;
      case TYPES.BRIGHT: tokenShapeType = "brightLitTokenBorder"; break;
      default: tokenShapeType = CONFIG[GEOMETRY_LIB_ID].CONFIG.constrainTokens ? "constrainedTokenBorder" : "tokenBorder";
    }
    this.config = { tokenShapeType };
  }

  /**
   * Using the available algorithm, test whether the target w/o/r/t other viewers is
   * in darkness, dim, or bright light based on threshold settings.
   */
  calculateLightingTypeForTarget() {
    // TODO: Fix for use with GeometricPrimitives.

    const oldConfig = this.config;
    const oldBlockingConfig = this.occlusionTester.config;
    const oldViewer = this.viewer;
    const oldViewpoint = this.viewpoint.clone();
    this.config = {
      senseType: "light",
      radius: Number.POSITIVE_INFINITY,
      largeTarget: false,
      walls: true,
      tiles: true,
      regions: true,
      levels: {
        foreground: true,
        background: true,
      },
      tokens: {
        dead: true,
        live: true,
        prone: true,
      },
    };
    this.setLightingTest(this.constructor.LIGHTING_TEST_TYPES.NONE);
    let dimResult = new this.constructor.resultClass(this);
    let brightResult = new this.constructor.resultClass(this);
    for ( const src of canvas.lighting.placeables ) {
      this.viewer = src;

      Point3d.fromPointSource(src, this.viewpoint);
      this.config = { radius: src.radius };
      this.calculate();
      dimResult = dimResult.blendMaximums(this.lastResult);

      this.config = { radius: src.brightRadius };
      this.calculate()
      brightResult = brightResult.blendMaximums(this.lastResult);
    }

    this.config = oldConfig;
    this.occlusionTester.config = oldBlockingConfig;
    this.viewer = oldViewer;
    this.viewpoint = oldViewpoint;
    return { dim: dimResult, bright: brightResult };
  }

  /* ----- NOTE: Debug ----- */

  /**
   * For debugging.
   * Draw various debug guides on the canvas.
   * @param {Draw} draw
   */
  _drawCanvasDebug(result, debugDraw) {
    // this._drawLineOfSight(debugDraw);

    // Draw the viewer vision radius to the token, accounting for 3d distance.
    // Use Pythagorean to get the 2d radius = sqrt(radius3d^2 - deltaZ^2)
    const visionRadius = this.radius;
    const vp = this.viewpoint;
    const deltaZ = Math.abs(vp.z - this.targetLocation.z);
    if ( deltaZ < visionRadius && isFinite(visionRadius) ) {
      const radius2d = Math.sqrt(visionRadius ** 2 - deltaZ ** 2);
      debugDraw ??= draw;
      debugDraw.shape(new PIXI.Circle(vp.x, vp.y, radius2d), { fill: Draw.COLORS.white, fillAlpha: 0.1 });
    }

    // Draw obstacle outlines.
    this.occlusionTester._drawDetectedObjects(debugDraw);

    // Draw frustum shape between viewer and target.
    this.occlusionTester._drawFrustum(debugDraw);
  }

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight(draw) { draw.segment({ A: this.viewpoint, B: this.targetLocation }, { alpha: 0.5 }); }

  destroy() { return; }
}


