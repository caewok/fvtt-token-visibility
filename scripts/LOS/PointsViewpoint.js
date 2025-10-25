/* globals
canvas,
CONFIG,
game,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerAbstract } from "./DebugVisibilityViewer.js";
import { BitSet } from "./BitSet/BitSet.js";
import { Point3d } from "../geometry/3d/Point3d.js";

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

  _config = {
    ...this._config,
    numPoints: 1,
  };

  data = new BitSet();

  constructor(target, opts) {
    super(target, opts);
    this.data = BitSet.empty(this._config.numPoints);
  }

  get totalTargetArea() { return this._config.numPoints; }

  // Handled by the calculator, which combines multiple results.
  get largeTargetArea() { return this.totalTargetArea; }

  get visibleArea() { return this.data.cardinality; }

  /**
   * Blend this result with another result, taking the maximum values at each test location.
   * Used to treat viewpoints as "eyes" in which 2+ viewpoints are combined to view an object.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMaximize(other) {
    const out = new this.constructor(this.target, this.config);
    out.data = this.data.or(other.data);
    return out;
  }
}


/**
 * Handle points algorithm.
 */
export class PercentVisibleCalculatorPoints extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisiblePointsResult;

  static viewpointClass = PointsViewpoint;

  // static get viewpointClass() { return PointsViewpoint; }

  static defaultConfiguration = {
    ...PercentVisibleCalculatorAbstract.defaultConfiguration,
    pointAlgorithm: "points-center",
    targetInset: 0.75,
    points3d: false,
    radius: Number.POSITIVE_INFINITY,
  }

  /** @type {Points3d[][]} */
  targetPoints = [];

  #rayDirection = new CONFIG.GeometryLib.threeD.Point3d();

  _calculate() {
    const targetShapes = this.config.largeTarget // Construct points for each target subshape, defined by grid spaces under the target.
      ? this.constructor.constrainedGridShapesUnderToken(this.tokenShape) : [this.targetShape];
    if ( !targetShapes.length ) targetShapes.push(this.targetShape);

    const targetPointsForShapes = targetShapes.map(shape => this.constructTargetPoints(shape));
    return this._calculateForPoints(targetPointsForShapes);
  }
  
  _calculateForPoints(points) {
    const numPoints = points.reduce((acc, curr) => Math.max(acc, curr.length), 0);
    this.lastResult = PercentVisiblePointsResult.fromCalculator(this, { numPoints });
    for ( let i = 0, iMax = points.length; i < iMax; i += 1 ) {
      const targetPoints = points[i];
      const result = this._testPointToPoints(targetPoints);
      this.lastResult = PercentVisiblePointsResult.max(this.lastResult, result);

      // If we have hit 100%, we are done.
      if ( this.lastResult.percentVisible >= 1 ) break;
    }
    return this.lastResult;
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
    this.occlusionTester._initialize(this.viewpoint, this.target);  
    const result = this.lastResult.clone();
    result.data.clear();

    const dist2 = this.config.radius ** 2;
    const numPoints = targetPoints.length;
    const debugPoints = this.debugPoints;
    for ( let i = 0; i < numPoints; i += 1 ) {
      const targetPoint = targetPoints[i];
      const isOccluded = Point3d.distanceSquaredBetween(this.viewpoint, targetPoint) > dist2
        || this.occlusionTester._rayIsOccluded(targetPoint.subtract(this.viewpoint, this.#rayDirection));
      result.data.set(i, !isOccluded);
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

/*
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw
api = game.modules.get("tokenvisibility").api
PercentVisibleCalculatorPoints = api.calcs.points
zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")
randal = canvas.tokens.placeables.find(t => t.name === "Randal")


calc = new PercentVisibleCalculatorPoints()
calc.viewer = randal
calc.target = zanna
calc.viewpoint.copyFrom(Point3d.fromTokenCenter(calc.viewer))
calc.targetLocation.copyFrom(Point3d.fromTokenCenter(calc.target))

res = calc.calculate()

debugViewer = api.buildDebugViewer(api.debugViewers.points)
await debugViewer.initialize();
debugViewer.render();



*/

