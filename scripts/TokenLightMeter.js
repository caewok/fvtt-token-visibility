/* globals
canvas,
CONFIG,
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { Sphere } from "./geometry/3d/Sphere.js";
import { FastBitSet } from "./LOS/FastBitSet/FastBitSet.js";
import { MatrixFlat } from "./geometry/MatrixFlat.js";
import { Plane } from "./geometry/3d/Plane.js";
import { PercentVisibleCalculatorPoints } from "./LOS/calculators/PointsCalculator.js";

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

export const ATVTokenLightMeterID = "lightMeter";

export class TokenLightMeter {

  /** @type {string} */
  static ID = ATVTokenLightMeterID;

  /** @type {Token} */
  token;

  /** @type {Point3d[]} */
  unitPoints = [];

  /** @type {Point3d[]} */
  get tokenPoints() { return this.token[MODULE_ID].sphericalGeometry.tokenSpherePoints; }

  /** @type {object<BitSet>} */
  data = {
    bright: new FastBitSet(),
    dim: new FastBitSet(),
  };

  /** @type {number} */
  get numPoints() { return this.tokenPoints.length; }

  get percentBright() { return this.data.bright.cardinality / this.numPoints; }

  get percentDim() { return this.data.dim.cardinality / this.numPoints; }

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

  // Two calc options:
  // 1. Points calculator, using a 3d set of points.
  // 2. Per-Pixel calculator, using spherical points.
  // TODO: Face point options and non-point options possible, except probably spherical non-point.

  constructor(token) {
    token[MODULE_ID] ??= {};
    token[MODULE_ID][this.constructor.ID] = this;

    this.token = token;

    // Set up a points calculator.
    // Blocking walls and regions; tokens don't block.
    this.calc = new PercentVisibleCalculatorPoints({
      senseType: "sight",
      blocking: {
        tokens: {
          dead: false,
          live: false,
          prone: false,
        },
      },
      tokenShapeType: "constrainedTokenBorder",
    });
  }

  #scaleM = MatrixFlat.identity(4, 4);

  #translateM = MatrixFlat.identity(4, 4);

  #transformM = MatrixFlat.identity(4, 4);

  /**
   * For each point on the token, run the points algorithm to determine bright/dim/dark.
   */
  updateLights(lights) {
    lights ??= canvas.lighting.placeables;
    this.data.dim.clear();
    this.data.bright.clear();
    this.calc.initializeView({ target: this.token });
    let viewable;
    const { UNLIT, DIM, BRIGHT } = CONST.LIGHTING_LEVELS

    for ( const light of lights ) {
      this.calc.initializeView({ viewer: light });
      if ( CONFIG[MODULE_ID].lightMeterObscureType !== BRIGHT ) viewable = this._viewableSphereIndices(this.calc.viewpoint);

      // Test bright radius.
      this.calc.config = { radius: light.brightRadius };
      this.calc._calculateForPoints([this.tokenPoints]);
      let brightRes = this.calc.lastResult.data;
      switch( CONFIG[MODULE_ID].lightMeterObscureType ) {
        case UNLIT: // Don't count any points on the dark side of the token.
        case DIM: // Points on dark side of token can only contribute to dim score.
          brightRes = brightRes.and(viewable);
          break;
        case BRIGHT: break; // Points on both sides of token sphere can count as bright.
      }
      this.data.bright = this.data.bright.or(brightRes);

      // Test dim radius.
      this.calc.config = { radius: light.dimRadius };
      this.calc._calculateForPoints([this.tokenPoints]);
      let dimRes = this.calc.lastResult.data;
      switch( CONFIG[MODULE_ID].lightMeterObscureType ) {
        case UNLIT: // Don't count any points on the dark side of the token.
          dimRes = dimRes.and(viewable);
          break;
        case DIM: // Points on dark side of token can only contribute to dim score.
        case BRIGHT: break; // Points on both sides of token sphere can count as bright.
      }
      this.data.dim = this.data.dim.or(dimRes);
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
    this.calc.initializeView({ target: this.token, viewpoint });
    this.calc.config = { radius: Number.POSITIVE_INFINITY };

    // Test the sphere points visible from the viewpoint.
    const visible = this._viewableSphereIndices(viewpoint);
    const visTokenPoints = visible.maskArray(this.tokenPoints);
    const res = this.calc._calculateForPoints([visTokenPoints]);

    // For points that are not obscured, mark bright and dim.
    let bright = maskBitSet(visible, this.data.bright);
    let dim = maskBitSet(visible, this.data.dim);
    bright = bright.and(res.data);
    dim = dim.and(res.data);

    const n = visible.cardinality;
    bright = bright.cardinality / n;
    dim = dim.cardinality / n;
    return { bright, dim };
  }

  /**
   * Indices for points on the spherical target token representation that are viewable
   * from the viewpoint, only considering the spherical shape as blocking.
   * @param {Point3d} [viewpoint]
   * @returns {BitSet}
   */
  _viewableSphereIndices(viewpoint) {
    const visible = new FastBitSet();
    const viewplane = this.viewplane;
    const viewSide = Math.sign(viewplane.whichSide(viewpoint));
    this.tokenPoints.forEach((pt, idx) => {
      if ( Math.sign(viewplane.whichSide(pt)) === viewSide ) visible.add(idx);
    });
    return visible;
  }

  _obscuredSphereIndices(viewpoint) {
    return this._viewableSphereIndices(viewpoint).flip(); // Flips in place, versus "not" which creates new set.
  }

  get viewplane() {
    const center = Point3d.fromTokenCenter(this.token);
    const dirHorizontal = this.viewpoint.subtract(center);
    const dirB = Point3d.tmp.set(-dirHorizontal.y, dirHorizontal.x, center.z);
    const perpB = center.add(dirB);
    const dirC = dirHorizontal.cross(dirB);
    const perpC = center.add(dirC)
    return Plane.fromPoints(center, perpB, perpC)
  }
}


/**
 * For a given bitset, return a smaller bitset that holds only the elements specified by these indices.
 * @param {BitSet} data
 * @param {BitSet} mask
 * @returns {BitSet}
 */
function maskBitSet(data, mask) {
  const arr = mask.toArray();
  const bs = new FastBitSet();
  let j = 0;
  arr.forEach(elem => {
    if ( data.has(elem) ) bs.add(j);
    j++;
  });
  return bs;
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