/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { approximateClamp } from "./util.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";
import { Settings } from "../settings.js";
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { Point3d } from "../geometry/3d/Point3d.js";


/**
 * Stores the result from the percent visible calculator.
 * Takes the result and can return certain characteristics, such as percent visible.
 * Can combine 2+ results.
 */
export class PercentVisibleResult {
  viewer;

  target;

  viewerLocation = new Point3d();

  targetLocation = new Point3d();

  data;

  _config = {
    largeTarget: false,
  };

  get config() { return structuredClone(this._config); }

  set config(cfg = {}) { foundry.utils.mergeObject(this._config, cfg, { inplace: true, insertKeys: false }); }

  constructor({ viewer, target, viewerLocation, targetLocation  } = {}) {
    this.viewer = viewer;
    this.target = target;
    if ( viewerLocation ) this.viewerLocation.copyFrom(viewerLocation);
    if ( targetLocation ) this.targetLocation.copyFrom(targetLocation);
  }

  clone() {
    const out = new this.constructor(this);
    out.config = this.config;
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

  blendMaximums(_result) {}

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
    tokenShapeType = "tokenBorder"; // constrainedTokenBorder, litTokenBorder, brightLitTokenBorder
    radius: Number.POSITIVE_INFINITY,
    senseType: "sight",  /** @type {CONST.WALL_RESTRICTION_TYPES} */
    debug: false,
    largeTarget: false,
  };

  constructor(cfg = {}) {
    // Set default configuration first and then override with passed-through values.
    this.config = this.constructor.defaultConfiguration;
    this.config = cfg;
  }

  _config = {};

  get config() { return structuredClone(this._config); }

  set config(cfg = {}) { foundry.utils.mergeObject(this._config, cfg, { inplace: true, insertKeys: false }); }

  async initialize() {
    this.occlusionTester._config = this._config; // Sync the configs.
  }


  // ----- NOTE: Visibility testing ----- //

  occlusionTester = new ObstacleOcclusionTest();

  viewer;

  target;

  get targetBorder() { return CONFIG[MODULE_ID].constrainTokens ? this.target.constrainedTokenBorder: this.target.tokenBorder; }

  viewpoint = new CONFIG.GeometryLib.threeD.Point3d();

  targetLocation = new CONFIG.GeometryLib.threeD.Point3d();

  get targetShape() { return this.target[this.config.tokenShapeType]; }
  
  get percentVisible() {
    if ( !this.lastResult ) this.calculate();
    return this.lastResult.percentVisible;
  }

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

  /** @type {PercentVisibleResult} */
  lastResult;

  initializeCalculations() {
    this.lastResult = new this.constructor.resultClass(this);
    lastResult.config = this._config; // Can skip the clone getter here.
    this.initializeOcclusionTesting();
  }

  initializeOcclusionTesting() {
    this.occlusionTester._initialize(this.viewpoint, this.target);
    if ( this.occlusionTesters ) {
      for ( const src of canvas[this.config.sourceType].placeables ) {
        let tester;
        if ( !this.occlusionTesters.has(src) ) {
          tester = new ObstacleOcclusionTest();
          tester._config = this._config; // Link so changes to config are reflected in the tester.
          this.occlusionTesters.set(src, tester);
        }

        // Setup the occlusion tester so the faster internal method can be used.
        tester ??= this.occlusionTesters.get(src);
        tester._initialize(this.viewpoint, this.target);
      }
    }
  }

  calculate() {
    this.initializeCalculations();
    this._calculate();
  }

  /**
   * Using the available algorithm, test whether the target w/o/r/t other viewers is
   * in darkness, dim, or bright light based on threshold settings.
   */
  calculateLightingTypeForTarget() {
    const dimThreshold = 0.5; // At least 50% of target area is in dim or bright light.
    const brightThreshold = 0.5; // At least 50% of target area is in bright light.

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
    let result = new this.constructor.resultClass(this);
    for ( const src of canvas.lighting.placeables ) {
      this.viewer = src;
      this.viewerLocation.copyFrom(Point3d.fromPointSource(src));
      this.calculate();
      result = result.blendMaximums(this.lastResult);
    }

    this.config = oldConfig;
    this.viewer = oldViewer;
    this.viewpoint.copyFrom(oldViewpoint);
    return result;
  }

  // async calculate(); // TODO: Implement if necessary; mimic calculate method but with await this._calculate.

  destroy() { return; }
}

