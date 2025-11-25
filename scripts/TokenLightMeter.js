/* globals
canvas,
CONFIG,
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TRACKER_IDS } from "./const.js";
import { FastBitSet } from "./LOS/FastBitSet/FastBitSet.js";

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

  static defaultConfiguration = {
    blocking: {
      walls: true,
      tiles: true,
      regions: true,
      tokens: {
        dead: false,
        live: false,
        prone: false,
      },
    },
    tokenShapeType: "constrainedTokenBorder",
    senseType: "sight",
    largeTarget: false,
    radius: null,
    testSurfaceVisibility: true,
    spherical: false,
    targetPointIndex: 1022,  // Everything but center.
    targetInset: 0,
  }

  static get calculator() {
    if ( !this.#calc || this.calcChanged() ) {
      const calcCfg = structuredClone(this.defaultConfiguration);
      const cfgs = CONFIG[MODULE_ID].lightMeter;
      if ( this.#calc ) this.#calc.destroy();
      calcCfg.spherical = cfgs.useTokenSphere;
      calcCfg.targetPointIndex = cfgs.targetPointIndex;
      this.#calc = new cfgs.calculatorClass(calcCfg);
    }
    return this.#calc;
  }

  static calcChanged() {
    const cfgs = CONFIG[MODULE_ID].lightMeter;
    if ( !(this.#calc instanceof cfgs.calculatorClass) ) return true;

    const calcCfg = this.#calc.config;
    if ( cfgs.useTokenSphere !== calcCfg.spherical ) return true;
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
    if ( this.percentBright > CONFIG[MODULE_ID].brightCutoff ) return TYPES.BRIGHT;
    else if ( this.percentDim > CONFIG[MODULE_ID].dimCutoff ) return TYPES.DIM;
    else return TYPES.UNLIT;
  }

  /** @type {Point3d} */
  get viewpoint() { return this.calc.viewpoint; }

  set viewpoint(value) { this.calc.viewpoint.copyFrom(value); }

  /**
   * For each point on the token, run the points algorithm to determine bright/dim/dark.
   */
  updateLights(lights) {
    lights ??= canvas.lighting.placeables;
    const calc = this.constructor.calculator;
    calc.initializeView({ target: this.token });
    this.data.dim = calc._createResult().makeFullyNotVisible();
    this.data.bright = calc._createResult().makeFullyNotVisible();

    // Test each light's view of the target token.
    const { UNLIT, DIM, BRIGHT } = CONST.LIGHTING_LEVELS
    const obscureType = CONFIG[MODULE_ID].lightMeter.obscureType;
    const cfg = { radius: Number.POSITIVE_INFINITY, testSurfaceVisibility: true };
    for ( const light of lights ) {
      calc.initializeView({ viewer: light });

      // Test bright radius.
      cfg.radius = light.brightRadius;
      switch( obscureType ) {
        case UNLIT:                                         // Don't count any points on the dark side of the token.
        case DIM: cfg.testSurfaceVisibility = true; break;  // Points on dark side of token can only contribute to dim score.
        case BRIGHT: cfg.testSurfaceVisibility = false;     // Points all sides can count as bright.
      }
      calc.config = cfg;
      const brightResult = calc.calculate();
      this.data.bright = this.data.bright.blendMaximize(brightResult);

      // Test dim radius.
      cfg.radius = light.dimRadius;
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
    return this._calculateLightFromViewpoint(viewpoint);
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


/* Test
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw
Sphere = CONFIG.GeometryLib.threeD.Sphere
MatrixFlat = CONFIG.GeometryLib.MatrixFlat

api = game.modules.get("tokenvisibility").api
FastBitSet = api.FastBitSet
PercentVisibleCalculatorPoints = api.calcs.points.prototype.constructor
TokenLightMeter = api.TokenLightMeter

target = canvas.tokens.placeables.find(t => t.name === "Randal")
viewer = canvas.tokens.placeables.find(t => t.name === "Zanna")

lm = new TokenLightMeter(target)
lm.updateTokenPoints()
lm.updateLights()
lm.tokenPoints.forEach(pt => Draw.point(pt, { radius: 1}))
lm.percentBright
lm.percentDim

lm.viewpoint = Point3d.fromTokenCenter(viewer)
lm.calculateLightFromViewpoint()

// [10] new FastBitSet("1010");
// [3] new FastBitSet("0011")


*/