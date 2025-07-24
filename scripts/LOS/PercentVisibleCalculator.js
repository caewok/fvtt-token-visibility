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

/* Percent visible calculator

Calculate percent visibility for a token viewer looking at a target token.

*/

export class PercentVisibleCalculatorAbstract {

  static COUNT_LABELS = {
    TOTAL: 0,
    OBSCURED: 1,
    BRIGHT: 2,
    DIM: 3,
    DARK: 4,
  };

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
    testLighting: false,
    senseType: "sight",  /** @type {CONST.WALL_RESTRICTION_TYPES} */
    sourceType: "lighting", // If calculating lit target area, which source type is detected by the sense type as "lighting" the target. (sound, light)
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

  set config(cfg = {}) { foundry.utils.mergeObject(this._config, cfg, { inplace: true}) }

  async initialize() {
    this.occlusionTester._config = this._config; // Sync the configs.
  }


  // ----- NOTE: Area calculation ----- //

  // Following all use the metric of the given algorithm.
  // For example, points would use the number of totalt points as the "targetArea".

  /**
   * Area of the target assuming nothing obscures it. Used as the denominator for percentage calcs.
   * @type {number}
   */
  get totalTargetArea() { return this.counts[TOTAL]; }

  /**
   * Area of a single grid square (or target sized 1/1). Used as the denominator for percentage calcs
   * when large token option is enabled.
   * @type {number}
   */
  get largeTargetArea() {
    const { width, height } = this.target.document;
    return this.counts[TOTAL] / (width * height);
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
   * Area of the target not obscured by obstacles.
   * Target area should equal this with blocking turned off.
   * @type {number}
   */
  get unobscuredArea() { return this.counts[TOTAL] - this.counts[OBSCURED]; }

  /**
   * Area of the target that is not obscured from the viewer and under dim light.
   * To get total dim, run the algorithm with blocking disabled.
   * @type {number}
   */
  get dimArea() { return this.counts[DIM]; }

  /**
   * Area of the target that is not obscured from the viewer and under bright light.
   * To get total bright, run the algorithm with blocking disabled.
   * @type {number}
   */
  get brightArea() { return this.counts[BRIGHT]; }

  /**
   * Area of the target that is not obscured from the viewer and under no (e.g., dark) light.
   * To get total dark, run the algorithm with blocking disabled.
   * @type {number}
   */
  get darkArea() { return this.counts[DARK]; }

  // Percentages: Various rounding errors can cause target to peek through; round when close to 0, 1.

  /**
   * Percent of the target that is visible and illuminated by bright light.
   * @type {number}
   */
  get percentVisibleBright() { return approximateClamp(this.brightArea / this.targetArea, 0, 1, 1e-02); }

  /**
   * Percent of the target that is visible and illuminated by dim light *only*.
   * @type {number}
   */
  get percentVisibleDim() { return approximateClamp(this.dimArea / this.targetArea, 0, 1, 1e-02); }

  /**
   * Percent of the target that is visible.
   * If testLighting config set, percent under some light (bright or dim). Otherwise, percent unobscured.
   * @type {number}
   */
  get percentVisible() {
   return this.config.testLighting
     ? this.percentVisibleDim
     : this.percentUnobscured;
  }

  /**
   * Percent of the target that is visible, ignoring lighting.
   * Should equal percentVisible with config.useLitToken set to false.
   * @type {number}
   */
  get percentUnobscured() { return approximateClamp(this.unobscuredArea / this.largeTargetArea, 0, 1, 1e-02);  }


  // ----- NOTE: Visibility testing ----- //

  occlusionTester = new ObstacleOcclusionTest();

  viewer;

  target;

  get targetBorder() { return CONFIG[MODULE_ID].constrainTokens ? this.target.constrainedTokenBorder: this.target.tokenBorder; }

  viewpoint = new CONFIG.GeometryLib.threeD.Point3d();

  targetLocation = new CONFIG.GeometryLib.threeD.Point3d();

  _tokenShapeType = "tokenBorder"; // constrainedTokenBorder, litTokenBorder, brightLitTokenBorder

  get targetShape() { return this.target[this._tokenShapeType]; }

  counts = new Float32Array(Object.keys(this.constructor.COUNT_LABELS).length);

  initializeCalculations() {
    this.initializeLightTesting();
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

  _testLightingForPoint;

  initializeLightTesting() {
    this._testLightingForPoint = () => null; // Default: ignore.
    if ( this.config.testLighting ) {
      if ( this.config.sourceType === "lighting" ) this._testLightingForPoint = this._testLightingOcclusionForPoint.bind(this);
      else if ( this.config.sourceType === "sounds" ) this._testLightingForPoint = this._testSoundOcclusionForPoint.bind(this);
    }
  }

  calculate() {
    this.counts.fill(0);
    this._tokenShapeType = CONFIG[MODULE_ID].constrainTokens ? "constrainedTokenBorder" : "tokenBorder";
    this.initializeCalculations();
    this._calculate();

    if ( this.config.testLighting && CONFIG[MODULE_ID].litToken === CONFIG[MODULE_ID].litTokenOptions.CONSTRAIN ) {
      // Calculate without lighting, then with lit (dim) border, then with lit (bright) border
      const oldDebug = this.config.debug;
      this.config = { testLighting: false, debug: false };
      const tmpCounts = new this.counts.constructor(this.counts.length);
      tmpCounts[TOTAL] = this.counts[TOTAL];
      tmpCounts[OBSCURED] = this.counts[OBSCURED];

      this._tokenShapeType = "litTokenBorder";
      this._calculate();
      tmpCounts[DIM] = this.counts[TOTAL] - this.counts[OBSCURED];

      this._tokenShapeType = "brightLitTokenBorder";
      this._calculate();
      tmpCounts[BRIGHT] = this.counts[TOTAL] - this.counts[OBSCURED];

      this.counts.set(tmpCounts);
      this.config = { testLighting: true, debug: oldDebug };
    }
  }

  // async calculate(); // TODO: Implement if necessary; mimic calculate method but with await this._calculate.

  foundryLitTokenTest() {
    const cfg = {
      tokenShape: this.targetBorder,
      pointAlgorithm: Settings.KEYS.POINT_TYPES.NINE,
      inset: .25,
      viewpoint: this.viewpoint
    };
    const targetPoints = AbstractViewpoint.constructTokenPoints(this.target, cfg);

    let dim = 0;
    let bright = 0;
    for ( const pt of targetPoints ) {
      for ( const src of canvas[this.config.sourceType].placeables ) {
        if ( src.lightSource.shape.contains(pt.x, pt.y) ) {
          dim += 1;
          if ( PIXI.Point.distanceSquaredBetween(pt, src.lightSource) < (src.brightRadius ** 2)) bright += 1;
        }
      }
    }
    return {
      dim: dim / targetPoints.length,
      bright: bright / targetPoints.length,
    }
  }

  #rayDirection = new CONFIG.GeometryLib.threeD.Point3d();

  _testLightingOcclusionForPoint(targetPoint, debugObject = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const srcOrigin = Point3d._tmp;
    let isBright = false;
    let isDim = false;
    for ( const src of canvas.lighting.placeables ) {
      if ( !src.lightSource.active ) continue;

      Point3d.fromPointSource(src, srcOrigin);
      // if ( face && !face.isFacing(srcOrigin) ) continue; // On opposite side of the triangle from the camera.

      const dist2 = Point3d.distanceSquaredBetween(targetPoint, srcOrigin);
      if ( dist2 > (src.dimRadius ** 2) ) continue; // Not within source dim radius.

      // If blocked, not bright or dim.
      // TODO: Don't test tokens for blocking the light or set a config option somewhere.
      // Probably means not syncing the configs for the occlusion testers.
      targetPoint.subtract(srcOrigin, this.#rayDirection); // NOTE: Modifies rayDirection, so only use after the viewer ray has been tested.
      if ( this.occlusionTesters.get(src)._rayIsOccluded(this.#rayDirection) ) continue;

      // TODO: handle light/sound attenuation from threshold walls.
      isBright ||= (dist2 <= (src.brightRadius ** 2));
      isDim ||= isBright || (dist2 <= (src.dimRadius ** 2));
      if ( isBright ) break; // Once we know a fragment is bright, we should know the rest.
    }

    debugObject.isDim = isDim;
    debugObject.isBright = isBright;
    this.counts[BRIGHT] += isBright;
    this.counts[DIM] += isDim;
    this.counts[DARK] += !(isDim || isBright);
    return { isBright, isDim };
  }

  _testSoundOcclusionForPoint(targetPoint, debugObject = {}, face) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const srcOrigin = Point3d._tmp;
    let isDim = false;
    for ( const src of canvas.sounds.placeables ) {
      if ( !src.source.active ) continue;

      Point3d.fromPointSource(src, srcOrigin);
      if ( face && !face.isFacing(srcOrigin) ) continue; // On opposite side of the triangle from the camera.

      const dist2 = Point3d.distanceSquaredBetween(targetPoint, srcOrigin);
      if ( dist2 > (src.radius ** 2) ) continue; // Not within source dim radius.

      // If blocked, not bright or dim.
      // TODO: Don't test tokens for blocking the light or set a config option somewhere.
      // Probably means not syncing the configs for the occlusion testers.
      targetPoint.subtract(srcOrigin, this.#rayDirection); // NOTE: Modifies rayDirection, so only use after the viewer ray has been tested.
      if ( this.occlusionTesters.get(src)._rayIsOccluded(this.#rayDirection) ) continue;

      // TODO: handle light/sound attenuation from threshold walls.
      isDim = true;
      break;
    }

    debugObject.isDim = isDim;
    this.counts[DIM] += isDim;
    this.counts[DARK] += !isDim;
    return { isDim };
  }

  destroy() { return; }
}

const {
  TOTAL,
  OBSCURED,
  BRIGHT,
  DIM,
  DARK,
} = PercentVisibleCalculatorAbstract.COUNT_LABELS;
