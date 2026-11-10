/* globals
CONFIG,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { GeometricPrimitive } from "../geometry/placeable_geometry/GeometricPrimitive.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { SmallBitSet } from "./SmallBitSet.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 */
export class Viewpoint {
  /** @type {ViewerLOS} */
  viewerLOS;

  /** @type {Point3d} */
  viewpointOffset = new Point3d();

  /**
   * @param {ViewerLOS} viewerLOS      The viewer that controls this "eye"; handles most of the config
   * @param {Point3d} viewpoint        The location of the eye; this will be translated to be relative to the viewer
   */
  constructor(viewerLOS, viewpoint) {
    this.viewerLOS = viewerLOS;
    this.setFromPoint(viewpoint);
  }

  /**
   * Store the offset from the viewer center, in world orietation.
   */
  setFromPoint(viewpoint) {
    viewpoint.subtract(this.viewerLOS.viewerShape.center, this.viewpointOffset);
  }

  /** @type {Point3d} */
  #viewpoint = new Point3d();

  /**
   * Calculate this viewpoint based on the viewerLOS viewer center.
   * @type {Point3d}
   */
  get viewpoint() {
    return this.viewpointOffset.add(this.viewerLOS.viewerShape.center, this.#viewpoint);
  }

  // ----- NOTE: References back to the viewerLOS ----- //

  /** @type {Token} */
  get target() { return this.viewerLOS.target; }

  /** @type {PercentVisibileCalculatorAbstract} */
  get calculator() { return this.viewerLOS.calculator; }

  /** @type {ObstacleOcclusionTest} */
  get occlusionTester() { return this.viewerLOS.calculator.occlusionTester; }

  // ----- NOTE: Visibility Percentages ----- //

  /** @type {PercentVisibleResult} */
  lastResult;

  get percentVisible() { return this.lastResult?.percentVisible || 0; }

  calculate() {
    const calc = this.calculator;
    calc.viewpoint = this.viewpoint;
    this.lastResult = calc.calculate();
    return this.lastResult;
  }

  // ----- NOTE: Points Handler ----- //

  static POINT_INDICES = GeometricPrimitive.POINT_INDICES;

  /** @type {number<cosine units>} */
  static SIDE_HYSTERESIS = 0.02; // About 1.5º near a 45º tie.

  /** @type {string[]} */
  static CATEGORIES = ["FACING", "MID", "BACK"];

  /**
   * The side of the token that faces the other token. This is the side whose outward normal
   * (center → edge midpoint) is closest to dir.
   * @param {InternalPoints} ip
   * @param {{x:number,y:number}} dir    Direction from this token toward the other token
   * @param {number|null} [previous]     Last choice; kept unless another side is clearly better
   * @returns {number} Index into ip.middle.sides.
   */
  static findFacingSide(ip, dir, previous = null) {
    const c = ip.center;
    const sides = ip.middle.sides;
    const len = Math.hypot(dir.x, dir.y);
    const ux = len > 1e-08 ? dir.x / len : 0;   // Overlapping tokens: arbitrary but fixed.
    const uy = len > 1e-08 ? dir.y / len : 1;
    const score = i => {
      const vx = sides[i].x - c.x;
      const vy = sides[i].y - c.y;
      return ((vx * ux) + (vy * uy)) / (Math.hypot(vx, vy) || 1);
    };
    let best = 0;
    let bestScore = score(0);
    for ( let i = 1; i < sides.length; i += 1 ) {
      const s = score(i);
      if ( s > bestScore + 1e-06 ) { best = i; bestScore = s; } // Ties: lowest index.
    }
    if ( previous != null && previous < sides.length
      && score(previous) >= bestScore - this.SIDE_HYSTERESIS ) return previous;
    return best;
  }

  /**
   * Partition corner and side indices into facing / mid / back. Counts never depend on the angle.
   * @param {InternalPoints} ip
   * @param {number} facingSide
   */
  static classifyPoints(ip, facingSide) {
    const c = ip.center;
    const corners = ip.middle.corners;
    const sides = ip.middle.sides;
    const unit = pt => {
      const vx = pt.x - c.x;
      const vy = pt.y - c.y;
      const len = Math.hypot(vx, vy) || 1;
      return [vx / len, vy / len];
    };

    // Back side: the side most opposed to the facing side.
    const [fx, fy] = unit(sides[facingSide]);
    let backSide = -1;
    let minCos = Infinity;
    sides.forEach((s, i) => {
      if ( i === facingSide ) return;
      const [x, y] = unit(s);
      const cos = (x * fx) + (y * fy);
      if ( cos < minCos - 1e-06 ) { minCos = cos; backSide = i; }
    });

    // The two corners nearest a side's midpoint belong to that side.
    const cornersOf = (side, exclude = []) => corners
      .map((p, i) => ({ i, d: ((p.x - side.x) ** 2) + ((p.y - side.y) ** 2) }))
      .filter(o => !exclude.includes(o.i))
      .sort((a, b) => (a.d - b.d) || (a.i - b.i))
      .slice(0, 2)
      .map(o => o.i)
      .sort((a, b) => a - b);

    const facingCorners = cornersOf(sides[facingSide]);
    const backCorners = cornersOf(sides[backSide], facingCorners);
    const rest = (n, ...used) => [...Array(n).keys()].filter(i => !used.flat().includes(i));

    return {
      corners: { facing: facingCorners, back: backCorners, mid: rest(corners.length, facingCorners, backCorners) },
      sides: { facing: [facingSide], back: [backSide], mid: rest(sides.length, facingSide, backSide) },
    };
  }

  /**
   * Build points for a given token.
   * @param {Token|GeometricPrimitive} tokenShape
   * @param {PIXI.Point|Point3d} dir                From this token toward the other token
   *                                                - viewer: toward target
   *                                                - target: toward the viewer
   * @param {object} [opts]
   * @param {number|BitSet} [opts.pointKey=1]
   * @param {ViewpointInsets} [opts.insets]
   * @param {number} [opts.facingSide]              Precomputed (with hysteresis) by the caller
   * @returns {Point3d[]} Order: per elevation (top, mid, bottom): center, corners, sides
   */
  static constructTokenPoints(tokenShape, dir, { pointKey = 1, insets, facingSide } = {}) {
    insets ??= { sides: 0, top: 0, bottom: 0 };
    insets.sides ??= 0;
    insets.top ??= 0;
    insets.bottom ??= 0;

    if ( tokenShape instanceof foundry.canvas.placeables.Token ) {
      // Constrained or full.
      const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.tokens.geomForPlaceable(tokenShape).calculated;
      tokenShape = geom.shapes[0]; // Currently only 1 shape per token.
    }

    const bs = pointKey instanceof SmallBitSet ? pointKey : SmallBitSet.fromNumber(pointKey);
    const PI = this.POINT_INDICES;
    const CATS = this.CATEGORIES;
    const cornerCats = CATS.filter(k => bs.hasIndex(PI.CORNERS[k]));
    const sideCats = CATS.filter(k => bs.hasIndex(PI.SIDES[k]));



    // Classify shape points into corners or sides.
    const ip = tokenShape.internalPoints;
    const cornerIdx = [];
    const sideIdx = [];
    if ( cornerCats.length || sideCats.length ) {
      const cls = this.classifyPoints(ip, facingSide ?? this.findFacingSide(ip, dir));
      for ( const k of cornerCats ) cornerIdx.push(...cls.corners[k.toLowerCase()]);
      for ( const k of sideCats ) sideIdx.push(...cls.sides[k.toLowerCase()]);
    }

    // Center is the fallback, so an elevation-only or empty selection still yields viewpoints.
    // Also reverts to center if the chosen indices yield no points. E.g., mid corners with a square token.
    const useCenter = bs.hasIndex(PI.CENTER) || !(cornerIdx.length || sideIdx.length);

    // Elevate points.
    const elevations = [
      [PI.ELEVATION.TOP, ip.top, insets.top],
      [PI.ELEVATION.MID, ip.middle, 0],
      [PI.ELEVATION.BOTTOM, ip.bottom, insets.bottom],
    ].filter(([idx]) => bs.hasIndex(idx));
    if ( !elevations.length ) elevations.push([PI.ELEVATION.MID, ip.middle, 0]);

    const c = ip.center;
    const place = (src, zInset, z) => {
      const pt = src.clone();
      if ( z !== undefined ) pt.z = z;
      pt.x += (c.x - pt.x) * insets.sides;       // 0 means no inset.
      pt.y += (c.y - pt.y) * insets.sides;
      pt.z += (c.z - pt.z) * zInset;           // Top moves down, bottom moves up, mid unchanged.
      return pt;
    };

    const out = [];
    for ( const [, ring, zInset] of elevations ) {
      if ( useCenter ) out.push(place(c, zInset, ring.corners[0].z));
      for ( const i of cornerIdx ) out.push(place(ring.corners[i], zInset));
      for ( const i of sideIdx ) out.push(place(ring.sides[i], zInset));
    }
    return out;
  }

  /* ----- NOTE: Debug ----- */

  /**
   * Draw viewpoint debugging on the canvas.
   * @param {Draw} debugDraw
   */
  _drawCanvasDebug(debugDraw) {
    this.calculator.viewpoint = this.viewpoint;
    const result = this.calculator.calculate();
    this.calculator._drawCanvasDebug(result, debugDraw);
  }

  _draw3dDebug(debugDraw, opts = {}) { // Opts incl width, height
    this.calculator.viewpoint = this.viewpoint;
    const result = this.calculator.calculate();
    this.calculator._draw3dDebug(result, debugDraw, opts);
  }

  _drawLOS(targetLocation, draw, opts = {}) {
    opts.alpha = 0.5;
    opts.color = Draw.COLORS.orange; // Viewpoint did not count.
    opts.dashLength = 10;
    opts.gapLength = 10;

    const lastResult = this.lastResult;
    if ( lastResult ) {
      switch ( lastResult.visibility ) {
        case lastResult.constructor.VISIBILITY.NONE:
          opts.color = Draw.COLORS.red;
          break;
        case lastResult.constructor.VISIBILITY.FULL:
          opts.color = Draw.COLORS.green;
          break;
        case lastResult.constructor.VISIBILITY.MEASURED:
          opts.dashLength = 0;
          opts.gapLength = 0;
          opts.color = this.percentVisible === 0 ? Draw.COLORS.red
            : this.percentVisible < this.viewerLOS.config.threshold ? Draw.COLORS.orange : Draw.COLORS.green;
          break;
      }
    }
    this._drawLOSSegment(targetLocation, draw, opts);
  }

  _drawLOSSegment(targetLocation, draw, opts = {}) {
    draw.segment({ a: this.viewpoint, b: targetLocation }, opts);
  }
}

/*
Example: token provides 75% cover.
If without that token, you would have 50% cover but with that token, it is 100% cover, drops to 75%.

Example: token1 provides 0% cover, token2 provides 50% cover
Drop token1.

Example: Wall cover 40%. Token1 covers 50%. Token2 covers 60%. Wall is in middle.
T1 max is 50%. T2 max is 75%.
Wall: |   ----   |
T1:   |-----     |
T2:   |    ------|

With both tokens: 100% cover
Without both tokens: 40% cover
Without token1: 70% cover
Without token2: 70% cover

60% (100 - 40) of cover provided by tokens.
Of that 60%, T1 and T2 split evenly: 70% / 70%.
New formula: .4 + .6 * (.5 * .5 + .5 * .75) = .775

Example: Wall cover 40%. Token1 covers 50%. Token2 covers 60%. Wall is in middle.
T1 max is 50%. T2 max is 75%.
Wall: |   ----   |
T1:   |-----     |
T2:   |------    |

With both tokens: 70% cover
Without both tokens: 40% cover
Without token1: 70% cover
Without token2: 70% cover

30% (70 - 40) of cover provided by the tokens.
Of that 30%, T1 and T2 split evenly: 70% / 70%.
New formula: .40 + .30 * (.5 * .5 + .5 * .75) = .5875

Example: Wall cover 40%. Token1 covers 10%. Token2 covers 20%. Wall is in middle.
T1 max is 50%. T2 max is 75%.
Wall: |   ----   |
T1:   |-         |
T2:   |   --     |

With both tokens: 50% cover
Without both tokens: 40% cover
Without token1: 40% cover
Without token2: 50% cover

10% (50 - 40) of cover provided by the tokens.
Of that 10%, T1 provides 10% (50 - 40) and T2 provides 0% (50 - 50)
New formula: .40 + .10 * (1 * .5 + 0 * .75) = .45
*/
