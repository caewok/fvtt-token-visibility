/* globals
canvas,
CONFIG,
game,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { PercentVisibleCalculatorAbstract } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerAbstract } from "./DebugVisibilityViewer.js";

/*
Points algorithm also can use area and threshold.
Number of points tested is the total area; points without collision represent % viewable area.

Dim and bright lighting test options:
1. Point is within litTokenBorder
2. Point not obscured from light and within light radius

*/


const {
  TOTAL,
  OBSCURED,
  DIM,
//   BRIGHT,
//   DARK,
} = PercentVisibleCalculatorAbstract.COUNT_LABELS;


/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class PointsViewpoint extends AbstractViewpoint {
  static get calcClass() { return PercentVisibleCalculatorPoints; }

  /** @type {PIXI.Graphics} */
  #debugGraphics;

  get debugGraphics() {
    if ( !this.#debugGraphics || this.#debugGraphics.destroyed ) this.#debugGraphics = new PIXI.Graphics();
    return this.#debugGraphics;
  }

  /** @type {Draw} */
  #debugDraw;

  get debugDraw() {
    const Draw = CONFIG.GeometryLib.Draw;
    if ( !this.#debugDraw
      || !this.#debugGraphics
      || this.#debugGraphics.destroyed ) this.#debugDraw = new Draw(this.debugGraphics);
    return this.#debugDraw || (this.#debugDraw = new Draw(this.debugGraphics));
  }

  _drawCanvasDebug(debugDraw) {
    super._drawCanvasDebug(debugDraw);
    this._drawDebugPoints(debugDraw);
  }

  _drawDebugPoints(draw) {
    const colors = CONFIG.GeometryLib.Draw.COLORS;
    const width =  this.percentVisible > this.viewerLOS.threshold ? 2 : 1;
    for ( const debugPoint of this.calculator.debugPoints ) {
      const color = debugPoint.isOccluded ? colors.red : colors.green;
      const alpha = debugPoint.isBright ? 0.8 : debugPoint.isDim ? 0.5 : 0.2;
      draw.segment(debugPoint, { alpha, width, color });
    }
  }

  destroy() {
    if ( this.#debugGraphics && !this.#debugGraphics.destroyed ) this.#debugGraphics.destroy();
    this.#debugGraphics = undefined;
    super.destroy();
  }
}

/**
 * Handle points algorithm.
 */
export class PercentVisibleCalculatorPoints extends PercentVisibleCalculatorAbstract {

  static get viewpointClass() { return PointsViewpoint; }

  static defaultConfiguration = {
    ...PercentVisibleCalculatorAbstract.defaultConfiguration,
    pointAlgorithm: "points-center",
    targetInset: 0.75,
    points3d: false,
  }

  /** @type {Points3d[][]} */
  targetPoints = [];

  counts = new Uint8Array(Object.keys(this.constructor.COUNT_LABELS).length);

  // Use separate lighting occlusion testers b/c it will change viewpoints a lot.
  /** @type {WeakMap<PointSource, ObstacleOcclusionTest>} */
  occlusionTesters = new WeakMap();

  #rayDirection = new CONFIG.GeometryLib.threeD.Point3d();

  // Points handles large target slightly differently. See _testLargeTarget.
  get largeTargetArea() { return this.counts[TOTAL]; }

  _calculate() {
    this.debugPoints.length = 0;
    if ( this.config.largeTarget ) this._testLargeTarget();
    else {
      const targetPoints = this.constructTargetPoints();
      this._testPointToPoints(targetPoints);
    }
  }

  _testLargeTarget() {
    // Construct points for each target subshape, defined by grid spaces under the target.
    const targetShapes = this.constructor.constrainedGridShapesUnderToken(this.tokenShape);
    if ( !targetShapes.length ) {
      console.warn(`${MODULE_ID}|${this.constructor.name}|Target shapes for large target not working.`);
      const targetPoints = this.constructTargetPoints();
      this._testPointToPoints(targetPoints);
      return;
    }

    const tmpCounts = new Uint8Array(this.constructor.COUNT_LABELS.length);
    let currentPercent = 0;
    for ( const targetShape of targetShapes ) {
      const targetPoints = this.constructTargetPoints(targetShape);
      this._testPointToPoints(targetPoints);

      // If no lighting, look for maximum percent unoccluded,
      // If lighting, look for maximum percent dim.
      // Keeping in mind that denominator (number of target points) could change between iterations.
      const numerator = this.config.testLighting ? this.counts[DIM] : (this.counts[TOTAL] - this.counts[OBSCURED]);
      const newPercent = numerator / this.counts[TOTAL];
      if ( newPercent > currentPercent ) {
        tmpCounts.set(this.counts);
        currentPercent = newPercent;
      }
      if ( newPercent >= 1 ) break;
    }
    this.counts.set(tmpCounts);
  }

  /* ----- NOTE: Target points ----- */


  constructTargetPoints(tokenShape) {
    const target = this.target;
    const { pointAlgorithm, targetInset, points3d } = this.config;
    const cfg = { pointAlgorithm, inset: targetInset, viewpoint: this.viewpoint };
    cfg.tokenShape = tokenShape ?? this.tokenShape
    const targetPoints = AbstractViewpoint.constructTokenPoints(target, cfg);
    return points3d ? PointsViewpoint.elevatePoints(target, targetPoints) : targetPoints;
  }



  /* ----- NOTE: Visibility testing ----- */


  debugPoints = [];

  _testPointToPoints(targetPoints) {
    this.counts.fill(0);
    const numPoints = targetPoints.length;
    this.counts[TOTAL] = numPoints;
    const debugPoints = this.debugPoints;
    for ( let i = 0; i < numPoints; i += 1 ) {
      const targetPoint = targetPoints[i];
      targetPoint.subtract(this.viewpoint, this.#rayDirection);
      const isOccluded = this.occlusionTester._rayIsOccluded(this.#rayDirection);
      this.counts[OBSCURED] += isOccluded;

      const debugObject = { A: this.viewpoint, B: targetPoint, isOccluded, isDim: null, isBright: null };
      debugPoints[i] = debugObject;
      if ( !isOccluded ) this._testLightingForPoint(targetPoint, debugObject);
    }
  }


  /**
   * Use the target's lit shape to determine if the point is lit.
   */
//   _testLightingContainmentForPoint(targetPoint, debugObject = {}) {
//     // TODO: Add option to test sound sources by switching this.config.sourceType.
//     // Requires new border calcs: soundTokenBorder
//
//     const isDim = this.target.litTokenBorder
//       ? this.target.litTokenBorder.contains(targetPoint.x, targetPoint.y) : false;
//     const isBright = isDim
//       && (this.target.brightLitTokenBorder
//         ? this.target.brightLitTokenBorder.contains(targetPoint.x, targetPoint.y) : false);
//     debugObject.isDim = isDim;
//     debugObject.isBright = isBright;
//     this.counts[BRIGHT] += isBright;
//     this.counts[DIM] += isDim;
//     this.counts[DARK] += !(isDim || isBright);
//   }


}


export class DebugVisibilityViewerPoints extends DebugVisibilityViewerAbstract {
  static viewpointClass = PointsViewpoint;

  /** @type {Token[]} */
  get viewers() { return canvas.tokens.controlled; }

  /** @type {Token[]} */
  get targets() { return game.user.targets.values(); }

  /**
   * Triggered whenever a token is refreshed.
   * @param {Token} token
   * @param {RenderFlags} flags
   */
  onRefreshToken(token, flags) {
    if ( !(this.viewers.some(viewer => viewer === token)
        || this.targets.some(target => target === token)) ) return;
    if ( !(flags.refreshPosition
        || flags.refreshElevation
        || flags.refreshSize ) ) return;
    this.render();
  }
}
