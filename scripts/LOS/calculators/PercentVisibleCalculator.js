/* globals
canvas,
CONFIG,
foundry,
Token,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { approximateClamp } from "../util.js";
import { ObstacleOcclusionTest } from "../ObstacleOcclusionTest.js";
import { Point3d } from "../../geometry/3d/Point3d.js";


/**
 * Stores the result from the percent visible calculator.
 * Takes the result and can return certain characteristics, such as percent visible.
 * Can combine 2+ results.
 */
export class PercentVisibleResult {
  target;

  data = {};

  _config = {
    largeTarget: false,
  };

  get config() { return structuredClone(this._config); }

  set config(cfg = {}) { foundry.utils.mergeObject(this._config, cfg, { inplace: true, insertKeys: false }); }

  constructor(target, opts = {}) {
    this.target = target;
    this.config = opts;
  }

  static fromCalculator(calc, opts = {}) {
    opts.largeTarget ??= calc.config.largeTarget;
    return new this(calc.target, opts );
  }

  clone() {
    const out = new this.constructor(this.target, this.config);
    Object.assign(out.data, this.data);
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
    if ( this.config.largeTarget ) return Math.min(this.totalTargetArea, this.largeTargetArea);
    return this.totalTargetArea;
  }

  /**
   * Area of the target that is visible.
   * @type {number}
   */
  get visibleArea() { return this.targetArea; }

  get percentVisible() {
    return approximateClamp(this.visibleArea / this.targetArea, 0, 1, 1e-02);
  }

  /**
   * Blend this result with another result, taking the maximum values at each test location.
   * Used to treat viewpoints as "eyes" in which 2+ viewpoints are combined to view an object.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMaximize(_other) { return this.clone(); }

  static max(...results) {
    let out = results[0];
    for ( const result of results ) {
      if ( result.percentVisible > out.percentVisible ) out = result;
    }
    return out;
  }

  static min(...results) {
    let out = results[0];
    for ( const result of results ) {
      if ( result.percentVisible < out.percentVisible ) out = result;
    }
    return out;
  }
}

/* Percent visible calculator

Calculate percent visibility for a token viewer, light, or sound looking at a target token.

*/
export class PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisibleResult;

  static defaultConfiguration = {
    blocking: {
      walls: true,
      tiles: true,
      regions: true,
      tokens: {
        dead: true,
        live: true,
        prone: true,
      }
    },
    tokenShapeType: "tokenBorder", // constrainedTokenBorder, litTokenBorder, brightLitTokenBorder
    senseType: "sight",  /** @type {CONST.WALL_RESTRICTION_TYPES} */
    debug: false,
    largeTarget: false,
  };

  constructor(cfg = {}) {
    // Set default configuration first and then override with passed-through values.
    this._config = structuredClone(this.constructor.defaultConfiguration);
    this.config = cfg;
    this.occlusionTester._config = this._config; // Sync the configs.
  }

  _config = {};

  get config() { return structuredClone(this._config); }

  set config(cfg = {}) { foundry.utils.mergeObject(this._config, cfg, { inplace: true, insertKeys: false }); }
  
  // ----- NOTE: Basic property getters / setters ---- //
  
  /** 
   * Track if initialization must be redone prior to calculation.
   * @type {boolean}
   */
  #dirty = true;
  
  get dirty() { return this.#dirty; }
  
  set dirty(value) { this.#dirty ||= value; }
  
  /** @type {Token} */
  #viewer;
  
  get viewer() { return this.#viewer; }
  
  set viewer(value) {
    if ( this.#viewer === value ) return;
    this.#dirty = true;
    this.#viewer = value;
    
    // Default the viewpoint to the center of the token.
    const method = value instanceof Token ? "fromTokenCenter" : "fromPointSource";
    Point3d[method](value, this.#viewpoint);
  }
  
  /** @type {Token} */
  #target;
  
  get target() { return this.#target; }
  
  set target(value) { 
    if ( this.#target === value ) return;
    this.#dirty = true;
    this.#target = value;
    
    // Default the target location to the center of the token.
    Point3d.fromTokenCenter(value, this.targetLocation);
  }
  
  /** @type {Point3d} */
  #viewpoint = new Point3d();
  
  get viewpoint() { return this.#viewpoint; }
  
  get rayOrigin() { return this.#viewpoint; }
  
  set viewpoint(value) {
    if ( this.#viewpoint.equals(value) ) return;
    this.#dirty = true;
    this.#viewpoint.copyFrom(value);
  }
  
  targetLocation = new Point3d();
  
  /**
   * Utility method to set all relevant viewing characteristics at once.
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {Point3d} [opts.viewpoint]
   * @param {Point3d} [opts.targetLocation]
   */
  initializeView({ viewer, target, viewpoint, targetLocation } = {}) {
    if ( viewer ) this.viewer = viewer;
    if ( target ) this.target = target;
    if ( viewpoint ) this.viewpoint = viewpoint;
    if ( targetLocation ) this.targetLocation.copyFrom(targetLocation);
  }
  
  get targetBorder() { return CONFIG[MODULE_ID].constrainTokens ? this.target.constrainedTokenBorder: this.target.tokenBorder; }
  
  get targetShape() { return this.target[this.config.tokenShapeType]; }
  
  _clean() {
    this.occlusionTester._initialize(this); // Params: rayOrigin, viewer, target.
    this.#dirty = false;
  }
  

  // ----- NOTE: Visibility testing ----- //

  occlusionTester = new ObstacleOcclusionTest();

  percentVisible() { return this.calculate().percentVisible; }
  
  static LIGHTING_TEST_TYPES = {
    DARK: 0,
    DIM: 1,
    BRIGHT: 2,
  };

  setLightingTest(type) {
    const { TYPES } = this.constructor.LIGHTING_TEST_TYPES;
    switch ( type ) {
      case TYPES.DIM: this.config.tokenShapeType = "litTokenBorder"; break;
      case TYPES.BRIGHT: this.config.tokenShapeType = "brightLitTokenBorder"; break;
      default: this.config.tokenShapeType = CONFIG[MODULE_ID].constrainTokens ? "constrainedTokenBorder" : "tokenBorder";
    }
  }

  /**
   * Return the visibility result for the current calculator state.
   * Use _initializeView to set state or set individually.
   * Also depends on config.
   * @returns {PercentVisibleResult}
   */
  calculate() {
    if ( this.#dirty ) this._clean();
    return this._calculate();
  }
  
  _calculate() { 
    return this.constructor.resultClass.fromCalculator(this);
  }

  /**
   * Using the available algorithm, test whether the target w/o/r/t other viewers is
   * in darkness, dim, or bright light based on threshold settings.
   */
  calculateLightingTypeForTarget() {
    const oldConfig = this.config;
    const oldViewer = this.viewer;
    const oldViewpoint = this.viewpoint.clone();
    this.config = {
      blocking: {
        walls: true,
        tiles: true,
        regions: true,
        tokens: {
          dead: true,
          live: true,
          prone: true,
        }
      },
      radius: Number.POSITIVE_INFINITY,
      senseType: "light",  /** @type {CONST.WALL_RESTRICTION_TYPES} */
      debug: false,
      largeTarget: false,
    }
    this.setLightingTest(this.constructor.LIGHTING_TEST_TYPES.NONE);
    let dimResult = new this.constructor.resultClass(this);
    let brightResult = new this.constructor.resultClass(this);
    for ( const src of canvas.lighting.placeables ) {
      this.viewer = src;
      this._clean();
      
      Point3d.fromPointSource(src, this.#viewpoint);
      this.config = { radius: src.radius };
      let lastResult = this.calculate();
      dimResult = dimResult.blendMaximums(lastResult);
      
      this.config = { radius: src.brightRadius };
      lastResult = this.calculate()
      brightResult = brightResult.blendMaximums(lastResult);
    }

    this.config = oldConfig;
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
  _drawCanvasDebug(debugDraw) {
    this._drawLineOfSight(debugDraw);
    this.occlusionTester._drawDetectedObjects(debugDraw);
    this.occlusionTester._drawFrustum(debugDraw);
  }
  
  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight(draw) { draw.segment({ A: this.viewpoint, B: this.targetLocation }); }
  
  destroy() { return; }
}


