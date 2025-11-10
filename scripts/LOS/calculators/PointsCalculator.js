/* globals
canvas,
CONFIG,
CONST,
game,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";

// LOS folder
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { ViewerLOS } from "../ViewerLOS.js";
import { DebugVisibilityViewerAbstract } from "../DebugVisibilityViewer.js";
import { SmallBitSet } from "../SmallBitSet.js";
import { squaresUnderToken, hexesUnderToken } from "../shapes_under_token.js";

// Geometry
import { Point3d } from "../../geometry/3d/Point3d.js";

/*
Points algorithm also can use area and threshold.
Number of points tested is the total area; points without collision represent % viewable area.

Dim and bright lighting test options:
1. Point is within litTokenBorder
2. Point not obscured from light and within light radius

*/

export class PercentVisiblePointsResult extends PercentVisibleResult {

  _config = {
    ...this._config,
    numPoints: 1,
  };

  data = new SmallBitSet();

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
    out.data.or(this.data).or(other.data);
    return out;
  }

  makeFullyVisible() {
    this.data.fillToIndex(this._config.numPoints - 1);
    super.makeFullyVisible();
  }

  makeFullyNotVisible() {
    this.data.clear();
    super.makeFullyNotVisible();
  }
}

/**
 * @typedef {object} PointsCalculatorConfig
 * ...{CalculatorConfig}
 * @property {number} [targetPointIndex=1]  	    					Points configuration for the target
 * @property {number} [targetInset=0.75]                    Offset target points from target border
 * @property {number} [radius=Infinity]                     Distance at which visibility stops
 */

/**
 * Handle points algorithm.
 */
export class PercentVisibleCalculatorPoints extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisiblePointsResult;

  static defaultConfiguration = {
    ...PercentVisibleCalculatorAbstract.defaultConfiguration,
    targetPointIndex: 1, // Center only
    targetInset: 0.75,
    radius: Number.POSITIVE_INFINITY,
  }

  /** @type {Points3d[][]} */
  targetPoints = [];

  get numPoints() { return ViewerLOS.numViewpointsForIndex(this.config.targetPointIndex); }

  get config() { return super.config; } // Must call parent to avoid having no getter here.

  set config(cfg = {}) {
    if ( Object.hasOwn(cfg, "targetPointIndex")
      && cfg.targetPointIndex instanceof SmallBitSet ) cfg.targetPointIndex = cfg.targetPointIndex.word;
    super.config = cfg;
  }

  #rayDirection = new CONFIG.GeometryLib.threeD.Point3d();

  _calculate() {
    const targetShapes = this.config.largeTarget // Construct points for each target subshape, defined by grid spaces under the target.
      ? this.constructor.constrainedGridShapesUnderToken(this.target) : [this.target.constrainedTokenBorder];
    if ( !targetShapes.length ) targetShapes.push(this.targetShape);

    const targetPointsForShapes = targetShapes.map(shape => this.constructTargetPoints(shape));
    return this._calculateForPoints(targetPointsForShapes);
  }

  _calculateForPoints(points) {
    this.lastResult = PercentVisiblePointsResult.fromCalculator(this, { numPoints: this.numPoints });
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
    const { targetPointIndex, targetInset } = this.config;
    const cfg = {
      pointKey: targetPointIndex,
      inset: targetInset,
      viewpoint: this.viewpoint,
      tokenShape: tokenShape ?? this.tokenShape
    };
    return ViewerLOS.constructTokenPoints(target, cfg);
  }

  /* ----- NOTE: Visibility testing ----- */

  debugPoints = [];

  /**
   * Test which target points are occluded and return the result.
   * @param {Point3d[]}
   * @returns {PercentVisiblePointsResult}
   */
  _testPointToPoints(targetPoints) {
    this.occlusionTester._initialize({ rayOrigin: this.viewpoint, viewer: this.viewer, target: this.target });
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

  /**
   * Get polygons representing all grids under a token.
   * If token is constrained, overlap the constrained polygon on the grid shapes.
   * @param {Token} token
   * @return {PIXI.Polygon[]|PIXI.Rectangle[]|null}
   */
  static constrainedGridShapesUnderToken(token, tokenShape) {
    tokenShape ??= token.constrainedTokenBorder;
    const gridShapes = this.gridShapesUnderToken(token);

    // Token unconstrained by walls.
    if ( token.tokenBorder.equals(tokenShape) ) return gridShapes;

    // For each gridShape, intersect against the constrained shape
    const constrainedGridShapes = [];
    const constrainedPath = CONFIG[MODULE_ID].ClipperPaths.fromPolygons([tokenShape]);
    for ( let gridShape of gridShapes ) {
      if ( gridShape instanceof PIXI.Rectangle ) gridShape = gridShape.toPolygon();

      const constrainedGridShape = constrainedPath.intersectPolygon(gridShape).simplify();
      if ( constrainedGridShape instanceof CONFIG[MODULE_ID].ClipperPaths ) {
        // Ignore holes.
        const polys = constrainedGridShape.toPolygons().filter(poly => !poly.isHole && poly.points.length >= 6);
        if ( polys.length ) constrainedGridShapes.push(...polys);
      } else if ( constrainedGridShape instanceof PIXI.Polygon && constrainedGridShape.points.length >= 6 ) {
        constrainedGridShapes.push(constrainedGridShape);
      } else if ( constrainedGridShape instanceof PIXI.Rectangle ) {
        constrainedGridShapes.push(constrainedGridShape);
      }
    }

    return constrainedGridShapes;
  }

    /**
   * Get polygons representing all grids under a token.
   * @param {Token} token
   * @return {PIXI.Polygon[]|PIXI.Rectangle[]|null}
   */
  static gridShapesUnderToken(token) {
    if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) {
      // console.error("gridShapesUnderTarget called on gridless scene!");
      return [token.bounds];
    }
    return canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squaresUnderToken(token) : hexesUnderToken(token);
  }

  // ----- NOTE: Debug ----- //

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
    // const width = this.percentVisible > this.viewerLOS.threshold ? 2 : 1;
    for ( const debugPoint of this.debugPoints ) {
      const color = debugPoint.isOccluded ? colors.red : colors.green;
      const alpha = debugPoint.isBright ? 0.8 : debugPoint.isDim ? 0.5 : 0.2;
      draw.segment(debugPoint, { alpha, color });
    }
  }

  destroy() {
    if ( this.#debugGraphics && !this.#debugGraphics.destroyed ) this.#debugGraphics.destroy();
    this.#debugGraphics = undefined;
    super.destroy();
  }

}




export class DebugVisibilityViewerPoints extends DebugVisibilityViewerAbstract {

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
calc.calculate()

debugViewer = api.buildDebugViewer(api.debugViewers.points)
await debugViewer.initialize();
debugViewer.render();

atv = randal.tokenvisibility.visibility
atv.percentVisibilityToToken(zanna)

SmallBitSet = api.SmallBitSet


*/

