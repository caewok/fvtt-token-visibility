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
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerAbstract } from "./DebugVisibilityViewer.js";
import { BitSet } from "./BitSet/bitset.mjs";

/*
Points algorithm also can use area and threshold.
Number of points tested is the total area; points without collision represent % viewable area.

Dim and bright lighting test options:
1. Point is within litTokenBorder
2. Point not obscured from light and within light radius

*/


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


export class PercentVisiblePointsResult extends PercentVisibleResult {

  constructor({ numPoints, ...opts } = {}) {
    super(opts);
    numPoints ??= 1;
    this.config = { numPoints };
    this.data = BitSet.empty(numPoints);
  }

  get totalTargetArea() { return this.config.numPoints; }

  // Handled by the calculator, which combines multiple results.
  get largeTargetArea() { return this.totalTargetArea; }

  get visibleArea() { return this.data.cardinality; }

  blendMaximums(result) {
    const out = this.clone();
    out.data = this.data.or(result.data);
    return out;
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
      this.lastResult = this._testPointToPoints(targetPoints);
      return;
    }

    const tmpCounts = new Uint8Array(this.constructor.COUNT_LABELS.length);
    let currentPercent = 0;
    for ( const targetShape of targetShapes ) {
      const targetPoints = this.constructTargetPoints(targetShape);
      const result = this._testPointToPoints(targetPoints);
      this.lastResult = PercentVisiblePointsResult.max(this.lastResult, result);
      
      // If we have hit 100%, we are done.
      if ( this.lastResult.percentVisible >= 1 ) break;
    }
  }

  /* ----- NOTE: Target points ----- */

  /**
   * Build a set of 3d points on a given token shape, dependent on settings and shape.
   * @param {PIXI.Polygon} tokenShape
   * @returns {Point3d[]}
   */
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

  /**
   * Test which target points are occluded and return the result.
   * @param {Point3d[]}
   * @returns {PercentVisiblePointsResult}
   */
  _testPointToPoints(targetPoints) {
    const result = this.lastResult.clone();
    result.data.clear();
    
    const numPoints = targetPoints.length;
    const debugPoints = this.debugPoints;
    for ( let i = 0; i < numPoints; i += 1 ) {
      const targetPoint = targetPoints[i];
      targetPoint.subtract(this.viewpoint, this.#rayDirection);
      const isOccluded = this.occlusionTester._rayIsOccluded(this.#rayDirection);
      result.data.set(i, isOccluded);
      const debugObject = { A: this.viewpoint, B: targetPoint, isOccluded };
      debugPoints[i] = debugObject;
    }
    return result;
  }
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

/* Testing
api = game.modules.get("tokenvisibility").api
BitSet = api.BitSet
bs = BitSet.Empty(27)



*/
