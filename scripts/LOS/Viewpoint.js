/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Geometry
import { Point3d } from "../geometry/3d/Point3d.js";
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
    this.setFromPoint(viewpoint);
  }

  /**
   * Store the offset from the viewer center, in world orietation.
   */
  setFromPoint(viewpoint) {
    viewpoint.subtract(viewerLOS.viewerShape.center, this.viewpointOffset);
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
    return lastResult;
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
