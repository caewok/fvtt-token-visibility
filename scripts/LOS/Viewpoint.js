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

  // ----- NOTE: Visibility Percentages ----- //

  /** @type {PercentVisibleResult} */
  lastResult;

  get percentVisible() { return this.lastResult?.percentVisible || 0; }

  calculate() {
    const vp = this.viewpoint;
    if ( this.passesSimpleVisibilityTest(vp) ) {
      this.lastResult ??= this.calculator._createResult();
      this.lastResult.makeFullyVisible();
    } else {
      this.calculator.viewpoint = vp;
      this.lastResult = this.calculator.calculate();
    }
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
}
