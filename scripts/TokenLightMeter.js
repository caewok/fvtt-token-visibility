/* globals
canvas,
CONFIG,
CONST,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TRACKER_IDS } from "./const.js";
import { FastBitSet } from "./LOS/FastBitSet/FastBitSet.js";
import { buildOcclusionTester, buildLOSCalculator } from "./LOSCalculator.js";
import { ViewerLOS } from "./LOS/ViewerLOS.js";
import { SmallBitSet } from "./LOS/SmallBitSet.js";

/*
Spherical approach

1. Point creation
Evenly distribute points around a sphere representing the token.

2. Viewable points
From viewpoint, point on sphere is blocked based on angle of the center point.
Equivalently, test a^2 + b^2 > c^2 (vs < or =)

          p
     c   /
     |  /
     | /
     |/
     v

 ∠vcp > 90º --> p is behind.
 ∠vcp = 90º --> p is at sphere horizon
 ∠vcp < 90º --> p is in front

 c|p ^ 2 + c|v ^ 2 > p|v ^ 2 --> p is in front. (The p|v line grows shorter as p moves in front of c relative to v.)

 3. Testing
 Use points algorithm to test --> modify algorithm to accept defined points
 Test viewable points against each light; record maximum.
 For non-viewable points: either ignore as dark, or test light range and set as dim or (optionally) bright based on light

 Store map of point indices and point coordinates on unit sphere. Translate + scale based on token position and size
 Store 1 or 2 bitmaps based on point index and whether point is dark|dim|bright.

 % dim or % bright of total points --> whether token is in dark|dim|bright
 % dim or % bright from viewer perspective --> whether token is in dark|dim|bright relative to token

 4. Extensions (TODO)
 - Create edge map between sphere points
 - Allow for light dispersal to adjacent sphere points
 - Record light intensity based on light range. Possibly record bright as 100% regardless of range, then decrease after.
 - Disperse light based on intensities
*/


export class TokenLightMeter {

  /** @type {string} */
  static ID = TRACKER_IDS.LIGHT_METER;

  static #calc;

  static DEFAULT_BLOCKING_CONFIG = {
    senseType: "light",
  };

  static DEFAULT_CALCULATOR_CONFIG = {
    largeTarget: false,
    sourceType: "lighting",
    tokenShapeType: "constrainedTokenBorder",
    targetInset: 0,
    targetPointIndex: SmallBitSet.fromIndices([
        ViewerLOS.POINT_INDICES.CORNERS.FACING,
        ViewerLOS.POINT_INDICES.CORNERS.MID,
        ViewerLOS.POINT_INDICES.CORNERS.BACK,
        ViewerLOS.POINT_INDICES.SIDES.FACING,
        ViewerLOS.POINT_INDICES.SIDES.MID,
        ViewerLOS.POINT_INDICES.SIDES.BACK,
        ViewerLOS.POINT_INDICES.D3.BOTTOM,
        ViewerLOS.POINT_INDICES.D3.MID,
        ViewerLOS.POINT_INDICES.D3.TOP]).word, // Everything but the center.
  };

  static get calculator() {
    if ( !this.#calc || this.calcChanged() ) {
      if ( this.#calc ) this.#calc.destroy();

      const ot = buildOcclusionTester(this.DEFAULT_BLOCKING_CONFIG);
      ot.config.senseType = "light";

      this.#calc = buildLOSCalculator({ occlusionTEster: ot, ...this.DEFAULT_CALCULATOR_CONFIG });

      // TODO: Change token shape to spherical for the calculation?
      // Or find a way to make this work with all shapes?
    }
    return this.#calc;
  }

  static calcChanged() {
    const cfgs = CONFIG[MODULE_ID].lightMeter;
    if ( !(this.#calc instanceof cfgs.calculatorClass) ) return true;

    const calcCfg = this.#calc.config;
    // if ( cfgs.useTokenSphere !== calcCfg.spherical ) return true;
    if ( cfgs.targetPointIndex !== calcCfg.targetPointIndex ) return true;
    return false;
  }

  /** @type {Token} */
  token;

  /** @type {object<BitSet>} */
  data = {
    bright: new FastBitSet(),
    dim: new FastBitSet(),
  };

  // Two calc options:
  // 1. Points calculator.
  // 2. Per-Pixel calculator.
  // TODO: Face point options and non-point options possible, except probably spherical non-point.
  constructor(token) {
    token[MODULE_ID] ??= {};
    token[MODULE_ID][this.constructor.ID] = this;
    this.token = token;
  }

  /** @type {number} */
  get percentBright() { return this.data.bright.percentVisible; }

  get percentDim() { return this.data.dim.percentVisible; }

  /**
   * Determine whether the token is in bright/dim/dark light.
   * @type {CONST.LIGHTING_LEVELS}
   */
  get lightingType() {
    const TYPES = CONST.LIGHTING_LEVELS;
    if ( this.percentBright > CONFIG[MODULE_ID].lightMeter.brightCutoff ) return TYPES.BRIGHT;
    else if ( this.percentDim > CONFIG[MODULE_ID].lightMeter.dimCutoff ) return TYPES.DIM;
    else return TYPES.UNLIT;
  }

  /** @type {Point3d} */
  get viewpoint() { return this.constructor.calc.viewpoint; }

  set viewpoint(value) { this.constructor.calc.viewpoint.copyFrom(value); }

  /**
   * For each point on the token, run the points algorithm to determine bright/dim/dark.
   * @param {PointLightSource[]} [lights]     If not provided, will test all light sources on canvas except Global.
   */
  updateLights(lights) {

    lights ??= canvas.effects.lightSources
    lights = lights.filter(l => !(l instanceof foundry.canvas.sources.GlobalLightSource));
    const calc = this.constructor.calculator;
    calc.initializeView({ target: this.token });
    this.data.dim = calc._createResult().makeFullyNotVisible();
    this.data.bright = calc._createResult().makeFullyNotVisible();

    // Test each light's view of the target token.
    const { UNLIT, DIM, BRIGHT } = CONST.LIGHTING_LEVELS;
    const obscureType = CONFIG[MODULE_ID].lightMeter.obscureType;
    const cfg = { radius: Number.POSITIVE_INFINITY, testSurfaceVisibility: true };
    for ( const light of lights ) {
      calc.initializeView({ viewer: light });

      // Test bright radius.
      if ( light.data.bright ) {
        cfg.radius = light.data.bright;
        switch( obscureType ) {
          case UNLIT:                                         // Don't count any points on the dark side of the token.
          case DIM: cfg.testSurfaceVisibility = true; break;  // Points on dark side of token can only contribute to dim score.
          case BRIGHT: cfg.testSurfaceVisibility = false;     // Points all sides can count as bright.
        }
        calc.config = cfg;
        const brightResult = calc.calculate();
        this.data.bright = this.data.bright.blendMaximize(brightResult);
      }

      // Test dim radius.
      cfg.radius = light.data.dim;
      switch( obscureType ) {
        case UNLIT: cfg.testSurfaceVisibility = true; break;  // Don't count any points on the dark side of the token.
        case DIM:                                             // Points on dark side of token can only contribute to dim score.
        case BRIGHT: cfg.testSurfaceVisibility = false;       // Points on both sides of token sphere can count as bright.
      }
      calc.config = cfg;
      const dimResult = calc.calculate();
      this.data.dim = this.data.dim.blendMaximize(dimResult);
    }
  }

  calculateLightFromViewpoint(viewpoint) {
    this.updateLights();
    const { bright, dim } = this._calculateLightFromViewpoint(viewpoint);

    const TYPES = CONST.LIGHTING_LEVELS;
    if ( bright.percentVisible > CONFIG[MODULE_ID].lightMeter.brightCutoff ) return TYPES.BRIGHT;
    else if ( dim.percentVisible > CONFIG[MODULE_ID].lightMeter.dimCutoff ) return TYPES.DIM;
    else return TYPES.UNLIT;
  }

  /**
   * Determine light bright/dim from given viewpoint.
   * @param {Point3d} viewpoint
   * @param {}
   */
  _calculateLightFromViewpoint(viewpoint) {
    // Get the visibility of the points from the viewpoint.
    viewpoint ??= this.viewpoint;
    const calc = this.constructor.calculator;
    calc.initializeView({ target: this.token, viewpoint });
    calc.config = { radius: Number.POSITIVE_INFINITY, testSurfaceVisibility: true };

    // Test the points visible from the viewpoint.
    const result = calc.calculate();
    return {
      bright: result.blendMinimize(this.data.bright),
      dim: result.blendMinimize(this.data.dim),
    };
  }
}
