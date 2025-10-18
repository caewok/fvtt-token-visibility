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
import { BitSet } from "./LOS/BitSet/bitset.mjs";
import { MatrixFlat } from "./geometry/MatrixFlat.js";
import { PercentVisibleCalculatorPoints } from "./LOS/PointsViewpoint.js";
import { applyConsecutively } from "./LOS/util.js";

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

  /** @type {Token} */
  token;
  
  /** @type {Point3d[]} */
  unitPoints = [];
  
  /** @type {Point3d[]} */
  tokenPoints = [];
  
  /** @type {object<BitSet>} */
  data = {
    bright: null,
    dim: null,
  };
  
  /** @type {number} */
  get numPoints() { return this.unitPoints.length; }
  
  set numPoints(n) {
    this.tokenPoints.forEach(pt => pt.release());
    this.tokenPoints.length = 0;
    this.unitPoints.forEach(pt => pt.release());
    this.unitPoints = Sphere.pointsLattice(n);
    this.data.bright = BitSet.Empty(n);
    this.data.dim = BitSet.Empty(n);
  }
  
  get percentBright() { return this.data.bright.cardinality() / this.numPoints; }
  
  get percentDim() { return this.data.dim.cardinality() / this.numPoints; }

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
  
  constructor(token, { numPoints = 20 } = {}) {
    this.token = token;
    this.numPoints = numPoints;
    
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
    
    this.calc.initializeView({ target: this.token });
  }
  
  #scaleM = MatrixFlat.identity(4, 4);
  
  #translateM = MatrixFlat.identity(4, 4);
  
  #transformM = MatrixFlat.identity(4, 4);
  
  /**
   * For each point on the token, run the points algorithm to determine bright/dim/dark.
   */
  updateLights(lights) {
    lights ??= canvas.lighting.placeables;
    this.data.dim = BitSet.Empty(this.numPoints);
    this.data.bright = BitSet.Empty(this.numPoints);
    this.calc.initializeView({ target: this.token });
    let viewable;
    const { UNLIT, DIM, BRIGHT } = CONST.LIGHTING_LEVELS
    
    for ( const light of lights ) {
      this.calc.initializeView({ viewer: light });  
      if ( CONFIG[MODULE_ID].lightMeterObscureType !== BRIGHT ) viewable = this._viewableSphereIndices();
      
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
  
  /**
   * Translate and scale the unit sphere points to match the token position and size.
   */
  updateTokenPoints() {
    // TODO: Does this still work if creating ellipsoids, with distinct h, w, z?
    const { w, h } = this.token;
    const v = this.token.topZ - this.token.bottomZ;
    const s = Math.max(w, h, v) * 0.5; // Want the radius, not the diameter. 
    const center = Point3d.fromTokenCenter(this.token);
    
    // Update the transform matrix.
    MatrixFlat.scale(s, s, s, this.#scaleM);
    MatrixFlat.translation(center.x, center.y, center.z, this.#translateM);
    this.#scaleM.multiply4x4(this.#translateM, this.#transformM);
    
    // Update the token points.
    const { tokenPoints, unitPoints } = this;
    tokenPoints.length = unitPoints.length;
    unitPoints.forEach((pt, i) => tokenPoints[i] = this.#transformM.multiplyPoint3d(pt));  
  }
    
  calculateLightFromViewpoint(viewpoint) {
    this.updateLights();
    this.updateTokenPoints();
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
    const visTokenPoints = filterArrayByBitSet(this.tokenPoints, visible);
    const res = this.calc._calculateForPoints([visTokenPoints]);
    
    // For points that are not obscured, mark bright and dim.
    let bright = maskBitSet(this.data.bright, visible);
    let dim = maskBitSet(this.data.dim, visible);
    bright = bright.and(res.data);
    dim = dim.and(res.data);
    
    const n = visible.cardinality();
    bright = bright.cardinality() / n;
    dim = dim.cardinality() / n;
    return { bright, dim };
  }
  
  /** 
   * Indices for points on the spherical target token representation that are viewable
   * from the viewpoint, only considering the spherical shape as blocking.
   * @param {Point3d} [viewpoint]
   * @returns {BitSet}
   */
  _viewableSphereIndices(viewpoint) {
    viewpoint ??= this.viewpoint;
    const center = Point3d.fromTokenCenter(this.token);
    const visible = BitSet.Empty(this.numPoints);
    this.tokenPoints.forEach((pt, idx) => {
      const a2 = Point3d.distanceSquaredBetween(center, pt);
      const b2 = Point3d.distanceSquaredBetween(center, viewpoint);
      const c2 = Point3d.distanceSquaredBetween(pt, viewpoint);
      visible.set(idx, (a2 + b2) >= c2);
    });
    return visible;
  }
  
  _obscuredSphereIndices(viewpoint) {
    return this._viewableSphereIndices(viewpoint).flip(); // Flips in place, versus "not" which creates new set.
  }
}

/**
 * For a given array, return a smaller array that holds the elements specified by a bit set.
 * @param {*[]} arr
 * @param {BitSet} indices
 * @returns {*[]}
 */
function filterArrayByBitSet(arr, indices) {
  const newArr = [];
  applyConsecutively(indices.toArray(), (start, length) => newArr.push(...arr.slice(start, start + length)));
  return newArr;
}

/**
 * For a given array of indices, create a bit set from those indices.
 * Assumes each index represents a 1 in the bit set.
 * @param {number[]} indices
 * @returns {BitSet}
 */

function bitSetFromArrayIndices(indices) {
  const bs = new BitSet()
  applyConsecutively(indices, (start, length) => bs.setRange(start, start + length - 1, 1));
  return bs;
}

/**
 * For a given bitset, return a smaller bitset that holds only the elements specified by indices.
 * @param {BitSet} data
 * @param {BitSet} indices
 * @returns {BitSet}
 */
function maskBitSet(data, indices) {
  const arr = indices.toArray();
  const bs = new BitSet();
  let j = 0;
  for ( const i of arr ) bs.set(j++, data.get(i));
  return bs;
}

/* Test
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw
Sphere = CONFIG.GeometryLib.threeD.Sphere
MatrixFlat = CONFIG.GeometryLib.MatrixFlat

api = game.modules.get("tokenvisibility").api
BitSet = api.BitSet
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





*/