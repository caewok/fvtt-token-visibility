/* globals
canvas,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { Settings } from "../../settings.js";

// LOS folder
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { ViewerLOS } from "../ViewerLOS.js";
import { DebugVisibilityViewerArea3dPIXI } from "../DebugVisibilityViewer.js";
import { SmallBitSet } from "../SmallBitSet.js";
import { FastBitSet } from "../FastBitSet/FastBitSet.js";
import { squaresUnderToken, hexesUnderToken } from "../shapes_under_token.js";

// Placeable tracking


// Geometry
import { Point3d } from "../../geometry/3d/Point3d.js";
import { Draw } from "../../geometry/Draw.js";

/*
Points algorithm also can use area and threshold.
Number of points tested is the total area; points without collision represent % viewable area.

Dim and bright lighting test options:
1. Point is within litTokenBorder
2. Point not obscured from light and within light radius

*/

/*
Points lattice:
1. Internal points (inset from surface corners, edges) comparable to FoundryVTT 9-point default.
2. Face points.

No handling of large targets. Those are handled by ViewpointLOS, which determines the primitive shape
to give to the given calculator.

Percent visible = counted points / total points

*/

export class PercentVisiblePointsResultAbstract extends PercentVisibleResult {

  data = {
    potentiallyVisible: new FastBitSet(),
    unobscured: new FastBitSet(),
  };

  logData() {
    console.log(`${this.data.potentiallyVisible.cardinality} potentially visible and ${this.data.unobscured.cardinality} unobscured. ${this.data.totalPoints} total points.`);
  }

  clone() {
    const out = super.clone();
    out.data.unobscured = this.data.unobscured.clone();
    out.data.potentiallyVisible = this.data.potentiallyVisible.clone();
    // totalPoints already cloned by super.
    return out;
  }

  get totalTargetArea() { return this.data.potentiallyVisible.cardinality; }

  get visibleArea() { return this.data.unobscured.cardinality; }

  /**
   * Blend this result with another result, taking the maximum values at each test location.
   * Used to treat viewpoints as "eyes" in which 2+ viewpoints are combined to view an object.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMaximize(other) {
    let out = super.blendMaximize(other);
    if ( out ) return out;
    out = this.clone();
    out.data.unobscured = this.data.unobscured.union(other.data.unobscured);
    out.data.potentiallyVisible = this.data.potentiallyVisible.union(other.data.potentiallyVisible);
    out.data.numPoints = Math.max(this.data.numPoints, other.data.numPoints);
    return out;
  }

  /**
   * Blend this result with another result, taking the minimum values at each test location.
   * Used to screen out viewpoints, such as with light meter testing of dim or bright non-occluded points.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMinimize(other) {
    let out = super.blendMaximize(other);
    if ( out ) return out;
    out = this.clone();
    out.data.unobscured = this.data.unobscured.intersection(other.data.unobscured);
    out.data.potentiallyVisible = this.data.potentiallyVisible.intersection(other.data.potentiallyVisible);
    out.data.numPoints = Math.min(this.data.numPoints, other.data.numPoints);
    return out;
  }
}

/**
 * @typedef {object} PointsCalculatorConfig
 * ...{CalculatorConfig}
 * @property {number} [targetPointIndex=1]  	    					Points configuration for the target
 * @property {number} [targetInset=0.75]                    Offset target points from target border
 */

/**
 * Handle points algorithm.
 */
export class PercentVisibleCalculatorPointsAbstract extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisiblePointsResultAbstract;

  _calculate() {
    // console.debug("PointsCalculator|_calculate");
    return this._testPoints();
  }

  _testPoints() {
    const result = this._createResult();
    const { unobscured, potentiallyVisible } = result.data;
    const radius2 = this.config.radius ** 2;
    let i = -1;
    for ( const pt of this.iterateTargetPoints() ) {
      potentiallyVisible.add(i);

      if ( this.pointOutsideRange(pt, radius2) || this.pointIsOccluded(pt) ) continue;
      unobscured.add(i);
    }
    return result;
  }

  /* ----- NOTE: Target points ----- */

  /** @yield {Point3d} */
  *iterateTargetPoints() {
    yield* this.targetShape.iterateFacePoints();
  }

  /**
   * Preliminary test to exclude points that should count as part of the visibility calculation
   * but can be immediately rejected. For example, due to distance from viewer.
   * @returns {boolean} True if not within range.
   */
  pointOutsideRange(pt, radius2 = this.config.radius ** 2) {
    return Point3d.distanceSquaredBetween(this.viewpoint, pt) > radius2;
  }

  /**
   * Given a point in 3d space (presumably on a token face), test for occlusion between it and viewpoint.
   * @param {Point3d} pt
   * @returns {boolean} True if occluded.
   */
  pointIsOccluded(pt) {
    // Is it occluded from the camera/viewer?
    return this.occlusionTester.segmentIsOccluded(this.viewpoint, pt);
  }

  // ----- NOTE: Debug ----- //

  _drawCanvasDebug(result, debugDraw) {
    super._drawCanvasDebug(result, debugDraw);
    this._drawDebugPoints(result, debugDraw);
  }

  _drawDebugPoints(result, debugDraw) {
    const colors = Draw.COLORS;
    const { unobscured, potentiallyVisible } = result.data;
    const vp = this.viewpoint;
    const segment = { a: vp, b: null };
    let i = -1;
    for ( const pt of this.iterateTargetPoints() ) {
      i += 1;
      segment.b = pt;
      const isVisible = potentiallyVisible.has(i);
      const isUnobscured = unobscured.has(i);
      const color = isVisible && isUnobscured ? colors.blue
        : isVisible ? colors.red
          :  colors.orange; // Not tested b/c not w/in radius or otherwise not part of shape.
      const opts = { color };
      if ( !isVisible ) {
        opts.dashLength = 10;
        opts.gapLength = 10;
      }
      debugDraw.segment(segment, { color });
    }
  }

  /**
   * Transform a 3d point to a 2d perspective for point of view of viewpoint.
   * @param {Point3d} pt
   * @returns {PIXI.Point|null} pt or null if the point is positive z after look at transform.
   */
  _applyPerspectiveToPoint(pt) {
    this.camera.lookAtMatrix.multiplyPoint3d(pt, pt);
    if ( pt.z >= 0 ) return null;
    this.camera.perspectiveMatrix.multiplyPoint3d(pt, pt);
    return pt;
  }

  _applyPerspectiveToPolygon(poly) {
    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;
    poly = poly.transform(lookAtM).clipZ();
    poly.transform(perspectiveM, poly);
    return poly.isValid ? poly : null;
  }

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(result, draw, { width = 100, height = 100 } = []) {
    const mult = PIXI.Point.tmp.set(width, height);
    const a = PIXI.Point.tmp;
    const opts = {
      color: Draw.COLORS.blue,
      radius: 2,
      alpha: 0.5,
    };

    this.setView(); // In case the camera has been moved.

    // Draw the border for reference.
    const viewpoint = this.viewpoint
    const drawOpts = { draw, color: Draw.COLORS.black, alpha: 0.5, fill: null }
    for ( const face of this.targetShape.iterateFaces()) {
      if ( !face.isFacing(viewpoint) ) {
        drawOpts.alpha = 0.3;
        drawOpts.color = Draw.COLORS.gray;
      } else {
        drawOpts.color = Draw.COLORS.black;
        drawOpts.alpha = 0.8;
      }
      const perspPoly = this._applyPerspectiveToPolygon(face);
      if ( !perspPoly ) continue;
      perspPoly.scale({ x: width, y: height}).draw2d(drawOpts);
    }

    // Draw the token points.
    const { unobscured, potentiallyVisible } = result.data;
    let i = -1;
    for ( const pt of this.iterateTargetPoints() ) {
      i += 1;
      if ( !potentiallyVisible.has(i) ) continue;

      using res = this._applyPerspectiveToPoint(pt.clone());
      if ( !res ) continue;

      opts.color = unobscured.has(i) ? Draw.COLORS.blue : Draw.COLORS.red;
      draw.point(res.multiply(mult, a), opts);
    }

    mult.release();
    a.release();
  }
}

export class PercentVisiblePointsResult extends PercentVisiblePointsResultAbstract {

  data = {
    unobscured: new SmallBitSet(),
    potentiallyVisible: new SmallBitSet(),
  };

  // TODO: Handle multiple areas (e.g., for large targets) in the Viewpoint class.
}


export class PercentVisibleCalculatorPoints extends PercentVisibleCalculatorPointsAbstract {

  /** @type {class<PercentVisibleResult>} */
  static resultClass = PercentVisiblePointsResult

  constructor() {
    super();

    // Add specific configuration.
    this.config.add({
      targetPointIndex: 1, // Center only
      targetInset: 0.75,
    })
  }

  /**
   * Build a set of 3d points on a given token shape, dependent on settings and shape.
   * @yield {Point3d}
   */
  *iterateTargetPoints() {
    const cfg = {
      pointKey: this.config.targetPointIndex,
      insetPercentage: this.config.targetInset,
    };
    const dir = this.targetLocation.subtract(this.viewpoint);
    yield* ViewerLOS.constructTokenPoints(this.targetShape, dir, cfg);
  }

  /**
   * Get polygons representing all grids under a token.
   * @param {Token} token
   * @return {PIXI.Polygon[]|PIXI.Rectangle[]|null}
   */
  static gridShapesUnderToken(token) {
    if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) return [token.tokenBorder];
    return canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squaresUnderToken(token) : hexesUnderToken(token);
  }
 }


export class DebugVisibilityViewerPoints extends DebugVisibilityViewerArea3dPIXI {
  algorithm = Settings.KEYS.LOS.TARGET.TYPES.POINTS;

  /** @type {Token[]} */
//   get viewers() { return canvas.tokens.controlled; }

  /** @type {Token[]} */
//   get targets() { return game.user.targets.values(); }

  /**
   * Triggered whenever a token is refreshed.
   * @param {Token} token
   * @param {RenderFlags} flags
   */
//   onRefreshToken(token, flags) {
//     if ( !(this.viewers.some(viewer => viewer === token)
//         || this.targets.some(target => target === token)) ) return;
//     if ( !(flags.refreshPosition
//         || flags.refreshElevation
//         || flags.refreshSize ) ) return;
//     this.render();
//   }
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
calc.viewpoint = Point3d.fromTokenCenter(calc.viewer)
calc.targetLocation = Point3d.fromTokenCenter(calc.target)
calc.calculate()

debugViewer = api.buildDebugViewer(api.debugViewers.points)
await debugViewer.initialize();
debugViewer.render();

atv = randal.tokenvisibility.visibility
atv.percentVisibilityToToken(zanna)

SmallBitSet = api.SmallBitSet


*/

