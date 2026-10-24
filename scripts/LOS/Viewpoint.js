/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { Point3d } from "../geometry/3d/Point3d.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { Draw } from "../geometry/Draw.js";

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

    // Use the viewer shape center to calculate the difference.
    // Because the viewpoint comes from viewerShape.internalPoints, which could be the center.
    // vp - ctr = diff
    // vp = diff + ctr
    viewpoint.subtract(viewerLOS.viewerShape.center, this.viewpointOffset);
  }

  /** @type {Point3d} */
  #viewpoint = new Point3d();

  /** @type {MatrixFloat32} */
  get rotationMatrix() { return this.viewerLOS.rotationMatrix; }

  /**
   * Calculate this viewpoint based on the viewerLOS viewer center.
   * @type {Point3d}
   */
  get viewpoint() {
    // If simply at the center, return that value.
    const offset = this.viewpointOffset;
    const ctr = this.viewerLOS.viewerShape.center;
    if ( !(offset.x || offset.y || offset.z) ) return offset.add(ctr, this.#viewpoint);
    return this.rotationMatrix.multiplyPoint3d(offset, this.#viewpoint)
      .add(ctr, this.#viewpoint);
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
    if ( this.passesSimpleVisibilityTest(this.viewpoint) ) {
      this.lastResult ??= this.calculator._createResult();
      this.lastResult.makeFullyVisible();
    } else this.lastResult = this._calculate();
    return this.lastResult;
  }

  targetOverlapsViewpoint(viewpoint) {
    const tokenShapeType = CONFIG[GEOMETRY_LIB_ID].CONFIG.constrainTokens ? "constrainedTokenBorder" : "tokenBorder";
    const bounds = this.target[tokenShapeType];
    if ( !bounds.contains(viewpoint.x, viewpoint.y) ) return false;
    return viewpoint.z.between(this.target.bottomZ, this.target.topZ);
  }

  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} target
   * @returns {0|1|undefined} 1.0 for visible; Undefined if obstacles present or target intersects the vision rays.
   */
  passesSimpleVisibilityTest(viewpoint) {
    const target = this.target;

    // Treat the scene background as fully blocking, so basement tokens don't pop-up unexpectedly.
    const backgroundElevation = canvas.scene.flags?.levels?.backgroundElevation || 0;
    if ( (viewpoint.z > backgroundElevation && target.topZ < backgroundElevation)
      || (viewpoint.z < backgroundElevation && target.bottomZ > backgroundElevation) ) return true;
    return this.targetOverlapsViewpoint(viewpoint);
  }

  /* ----- NOTE: Debug ----- */

  /**
   * Draw viewpoint debugging on the canvas.
   * @param {Draw} debugDraw
   */
  _drawCanvasDebug(debugDraw) {
    const result = this.calculator.calculate();
    this.calculator._drawCanvasDebug(result, debugDraw);
  }

  _draw3dDebug(debugDraw, opts = {}) { // opts incl width, height
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
      switch ( lastResult.type ) {
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
            : this.percentVisible < this.viewerLOS.threshold ? Draw.COLORS.orange : Draw.COLORS.green;
          break;
      }
    }
    this._drawLOSSegment(targetLocation, draw, opts);
  }

  _drawLOSSegment(targetLocation, draw, opts = {}) {
    draw.segment({ a: this.viewpoint, b: targetLocation }, opts)
  }

  // ----- NOTE: Partially blocking obstacles ----- //

  /**
   * Obstacles that may be marked partially opaque.
   * Tiles and levels currently excluded b/c those are handled via textures.
   * @type {string[]}
   */
  static TRANSPARENT_OBSTACLE_TYPES = ["tokens", "walls", "regions"];

  static WALL_TYPES = ["walls", "terrainWalls", "proximateWalls", "reverseProximateWalls"];

  /**
   * Calculate percent visible for this viewpoint, accounting for transparent obstacles, if any.
   * @returns {PercentVisibleResult}
   */
  _calculate() {
    const calc = this.calculator;
    calc.viewpoint = this.viewpoint;
    const { partial, nonBlocking } = this._partiallyBlockingObstacles();
    this._removeObstacles(nonBlocking);

    let result = this.calculator._createResult();
    let percentVisible = 1;
    try {
      // Temporarily drop obstacles that grant no cover
      result = calc.calculate();
      percentVisible = result.percentVisible;
      if ( partial.length ) percentVisible = this._calculatePartialOpacity(partial, result.percentVisible);

    } finally {
      // Always add back obstacles.
      this._addObstacles(nonBlocking);
    }

    result ||= this.calculator._createResult().makeFullyVisible();
    result.percentVisible = percentVisible;
    return result;
  }


  /**
   * Opacity level of an obstacle.
   * @param {Token|Wall|Region} obstacle
   * @returns number
   *    1: fully opaque (default).
   *    0: fully transparent.
   */
  _obstacleOpacity(obstacle) {
    const restrictionType = this.occlusionTester.config.senseType || "sight";
    return obstacle.opacity(restrictionType);
  }

  /**
   * Locate all partially blocking and non-blocking obstacles.
   * @returns {object}
   *   - @prop {{obstacle, opacity}[]} partial       Obstacles granting only partial cover
   *   - @prop {{obstacle, opacity}[]} nonBlocking   Obstacles granting no cover
   */
  _partiallyBlockingObstacles() {
    const obstacles = this.occlusionTester.obstacleGeometries;
    const partial = [];
    const nonBlocking = [];
    for ( const type of this.constructor.TRANSPARENT_OBSTACLE_TYPES ) {
      const subtypes = type === "walls" ? this.constructor.WALL_TYPES : [type];
      for ( const subtype of subtypes ) {
        const set = obstacles[subtype];
        if ( !set ) continue;
        for ( const obstacle of set ) {
          const opacity = this._obstacleOpacity(obstacle);
          if ( opacity >= 1 ) continue;
          const entry = { obstacle, subtype, opacity };
          if ( opacity <= 0 ) nonBlocking.push(entry);
          else partial.push(entry);
        }
      }
    }
    return { partial, nonBlocking };
  }

  /**
   * Remove obstacles from the tester.
   * @param {{obstacle, subtype}[]} entries
   */
  _removeObstacles(entries) {
    const obstacles = this.occlusionTester.obstacleGeometries;
    for ( const { obstacle, subtype } of entries ) obstacles[subtype].delete(obstacle);
  }

  /**
   * Add obstacles to the tester.
   * @param {{obstacle, subtype}[]} entries
   */
  _addObstacles(entries) {
    const obstacles = this.occlusionTester.obstacleGeometries;
    for ( const { obstacle, subtype } of entries ) obstacles[subtype].add(obstacle);
  }

  /**
   * Calculate when some obstacles are transparent.
   * Each obstacle's contribution to the total visibility is measured by removing it in turn,
   * then the contributions are prorated.
   *
   * Let V_all= all visibility with every obstacle opaque, and V_none be visibility with transparent obstacles
   * removed. Then lost = V_none - V_all is the visibility the partial obstacles take away.
   * Each obstacle's share is its marginal contribution, V_minusOne - V_all, normalized across obstacles.
   * V = V_none - lost x ∑ share_i x opacity_i.
   *
   * @param {{obstacle, subtype, opacity}} partial        Partially blocking obstacles
   * @param {number} visibleAll                           Visibility treating all obstacles as solid (except fully transparent)
   * @returns {number} Percent between 0 and 1—the total visibility.
   */
  _calculatePartialOpacity(partial, visibleAll) {
    const calc = this.calculator;
    let visibleNone;
    const contributions = [];

    try {
      // Visibility with only the solid obstacles.
      this._removeObstacles(partial);
      visibleNone = calc._calculate().percentVisible; // Call _calculate directly to avoid resetting the obstacle tester.

      // Add back all transparent obstacles.
      this._addObstacles(partial);

      // Partial obstacles block nothing, so there is nothing to prorate.
      if ( visibleNone <= visibleAll ) return visibleAll;

      // Marginal contribution of each obstacle: How much visibility returns when it alone is removed.
      for ( const entry of partial ) {
        this._removeObstacles([entry]);
        const visibleMinusOne = calc._calculate().percentVisible;
        this._addObstacles([entry]);
        contributions.push(Math.max(visibleMinusOne - visibleAll, 0));
      }

    } finally {
      // Ensure full set is restored regardless of errors.
      this._addObstacles(partial);
    }

    // Prorate each obstacle's share of the visibility by its opacity.
    const lost = visibleNone - visibleAll;
    const n = partial.length;
    const denom = contributions.reduce((sum, x) => sum + x, 0);
    let weighted = 0;
    for ( let i = 0; i < n; i += 1 ) {
      // If no obstacle contributes individually (e.g., they fully overlap), split evenly.
      const share = denom ? contributions[i] / denom : 1 / n;
      weighted += share * (partial[i].opacity);
    }
    return Math.clamp(visibleNone - (weighted * lost), 0, 1);
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