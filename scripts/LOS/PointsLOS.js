/* globals
canvas,
CONST,
PIXI
*/
"use strict";

import { squaresUnderToken, hexesUnderToken } from "./shapes_under_token.js";
import { AlternativeLOS } from "./AlternativeLOS.js";

// Base folder
import { Settings, SETTINGS } from "../settings.js";
import { insetPoints } from "./util.js";

// Geometry folder
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";

/* Testing
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
api = game.modules.get("tokenvisibility").api;
PointsLOS = api.PointsLOS;
rangeTestPointsForToken = api.range.rangeTestPointsForToken

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;

// Range test

testPoints = rangeTestPointsForToken(target);
tests.forEach(pt => Draw.point(pt, { radius: 1 }))

visionOrigin = Point3d.fromPointSource(viewer.vision);
Draw.point(visionOrigin, { color: Draw.COLORS.blue })

radius = viewer.getLightRadius(60); // mode.range
radius2 = radius * radius;

// Duplicate below so that the if test does not need to be inside the loop.
testPoints.map(pt => {
  const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
  const inRange = dist2 <= radius2;
  Draw.point(pt, { alpha: 1, radius: 3, color: inRange ? Draw.COLORS.green : Draw.COLORS.red });
  return inRange;
});

Draw.clearDrawings()

// LOS test
calc = new PointsLOS(viewer, target)
calc.hasLOS()

targetPoints = calc._constructTargetPoints();
targetPoints[0].forEach(pt => Draw.point(pt, { radius: 1 }))
targetPointsArray = targetPoints


let minBlocked = 1;
let minTargetPoints; // Debugging
debug = calc.config.debug;

targetPoints = targetPointsArray[0]

for ( const targetPoints of targetPointsArray ) {
  const percentBlocked = calc._testPointToPoints(targetPoints);

  // We can escape early if this is completely visible.
  if ( !percentBlocked ) {
    if ( debug ) calc._drawPointToPoints(targetPoints, { width: 2 });
    return 0;
  }

  if ( debug ) {
    calc._drawPointToPoints(targetPoints, { alpha: 0.1 });
    if ( percentBlocked < minBlocked ) minTargetPoints = targetPoints;
  }

  minBlocked = Math.min(minBlocked, percentBlocked);
}


if ( debug ) calc._drawPointToPoints(minTargetPoints, { width: 2 });
return minBlocked;


*/

/**
 * Estimate line-of-sight between a source and a token using different point-to-point methods.
 */
export class PointsLOS extends AlternativeLOS {
  static ALGORITHM = {
    CENTER_CENTER: "los-center-to-center",
    CENTER_CORNERS_TARGET: "los-center-to-target-corners",
    CORNER_CORNERS_TARGET: "los-corner-to-target-corners",
    CENTER_CORNERS_GRID: "los-center-to-target-grid-corners",
    CORNER_CORNERS_GRID: "los-corner-to-target-grid-corners",
    CENTER_CUBE: "los-points-center-to-cube",
    CUBE_CUBE: "los-points-cube-to-cube"
  };

  static ALGORITHM_METHOD = {
    points_center_to_center: "centerToCenter",
    points_center_to_corners: "centerToTargetCorners",
    points_corners_to_corners: "cornerToTargetCorners",
    points_center_to_corners_grid: "centerToTargetGridCorners",
    points_corner_to_corners_grid: "cornerToTargetGridCorners",
    points_center_to_cube: "centerToCube",
    points_cube_to_cube: "cubeToCube"
  };

  /**
   * @typedef {PointsLOSConfig}  Configuration settings for this class.
   * @type {AlternativeLOSConfig}
   * @property {CONST.WALL_RESTRICTION_TYPES} type    Type of source (light, sight, etc.)
   * @property {boolean} wallsBlock                   Can walls block in this test?
   * @property {boolean} tilesBlock                   Can tiles block in this test?
   * @property {boolean} deadTokensBlock              Can dead tokens block in this test?
   * @property {boolean} liveTokensBlock              Can live tokens block in this test?
   * @property {boolean} proneTokensBlock             Can prone tokens block in this test?
   * @property {boolean} debug                        Enable debug visualizations.
   *
   * Added by this subclass:
   * @property {SETTINGS.POINT_TYPE} pointAlgorithm   The type of point-based algorithm to apply to target
   * @property {number} inset                         How much to inset target points from target border
   * @property {boolean} grid                         True if treating points separately for each grid space
   * @property {boolean} points3d                     Use top/bottom target elevation when enabled
   */

  /**
   * @param {Point3d|Token|VisionSource} viewer       Object from which to determine line-of-sight
   *   If more than token center is required, then this must be a Token or VisionSource
   * @param {Token} target                            Object to test for visibility
   * @param {AlternativeLOSConfig} [config]
   */
  constructor(viewer, target, config) {
    super(viewer, target, config);
    this.#configure(config);
  }

  #configure(config = {}) {
    if ( config.pointAlgorithm ) this.#pointAlgorithm = config.pointAlgorithm;
    if ( config.inset ) this.#inset = config.inset;
    if ( config.points3d ) this.#points3d = config.points3d;
  }

  _clearCache() {
    super._clearCache();
    this.#targetPoints = undefined;
  }

  #pointAlgorithm = Settings.get(SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS);

  #inset = Settings.get(SETTINGS.LOS.TARGET.POINT_OPTIONS.INSET);

  #points3d = Settings.get(SETTINGS.LOS.TARGET.POINT_OPTIONS.POINTS3D);

  get pointAlgorithm() { return this.#pointAlgorithm; }

  get inset() { return this.#inset; }

  get points3d() { return this.#points3d; }

  set pointAlgorithm(value) {
    if ( value === this.#pointAlgorithm ) return;
    this.#pointAlgorithm = value;
    this.#targetPoints = undefined;
  }

  set inset(value) {
    if ( value === this.#inset ) return;
    this.#inset = value;
    this.#targetPoints = undefined;
  }

  set points3d(value) {
    if ( value === this.#points3d ) return;
    this.#points3d = value;
    this.#targetPoints = undefined;
  }

  #targetPoints;

  get targetPoints() {
    return this.#targetPoints
      || (this.#targetPoints = this._constructTargetPoints());
  }

  /**
   * Determine percentage of the token visible using the class methodology.
   * @returns {number}
   */
  percentVisible() { return this._simpleVisibilityTest() ?? (1 - this.applyPercentageTest()); }

  applyPercentageTest() {
    return this._testTargetPoints(this.targetPoints);
  }

  /**
   * Convenience method that uses settings of this calculator to construct viewer points.
   * @param {Token} viewer    Will be taken from config.visionSource; otherwise must be provided
   * @returns {Points3d[]|undefined} Undefined if viewer cannot be ascertained
   */
  constructViewerPoints(viewer) {
    viewer ??= this.config.visionSource?.object;
    if ( !viewer ) return undefined;

    const { pointAlgorithm, inset } = this;
    return this.constructor.constructTokenPoints(viewer, { pointAlgorithm, inset });
  }

  /**
   * Similar to _constructViewerPoints but with a complication:
   * - Grid. When set, points are constructed per grid space covered by the token.
   */
  _constructTargetPoints() {
    const target = this.target;
    const { pointAlgorithm, inset, points3d } = this;
    const cfg = { pointAlgorithm, inset };

    if ( this.config.largeTarget ) {
      // Construct points for each target subshape, defined by grid spaces under the target.
      const targetShapes = this.constructor.constrainedGridShapesUnderToken(target);
      const targetPointsArray = targetShapes.map(targetShape => {
        cfg.tokenShape = targetShape;
        const targetPoints = this.constructor.constructTokenPoints(target, cfg);
        if ( points3d ) return this.constructor.elevatePoints(target, targetPoints);
        return targetPoints;
      });
      return targetPointsArray;
    }

    // Construct points under this constrained token border.
    const targetPoints = this.constructor.constructTokenPoints(target, cfg);
    if ( this.points3d ) return [this.constructor.elevatePoints(target, targetPoints)];
    return [targetPoints];
  }

  static constructTokenPoints(token, { tokenShape, pointAlgorithm, inset } = {}) {
    pointAlgorithm ??= Settings.get(SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS);
    inset ??= Settings.get(SETTINGS.LOS.TARGET.POINT_OPTIONS.INSET);
    tokenShape ??= token.constrainedTokenBorder;

    const TYPES = SETTINGS.POINT_TYPES;
    const center = Point3d.fromTokenCenter(token);

    const tokenPoints = [];
    if ( pointAlgorithm === TYPES.CENTER
        || pointAlgorithm === TYPES.FIVE
        || pointAlgorithm === TYPES.NINE ) tokenPoints.push(center);

    if ( pointAlgorithm === TYPES.CENTER ) return tokenPoints;

    const cornerPoints = this.getCorners(tokenShape, center.z);

    // Inset by 1 pixel or inset percentage;
    insetPoints(cornerPoints, center, inset);
    tokenPoints.push(...cornerPoints);
    if ( pointAlgorithm === TYPES.FOUR
      || pointAlgorithm === TYPES.FIVE ) return tokenPoints;

    // Add in the midpoints between corners.
    const ln = cornerPoints.length;
    let prevPt = cornerPoints.at(-1);
    for ( let i = 0; i < ln; i += 1 ) {
      // Don't need to inset b/c the corners already are.
      const currPt = cornerPoints[i];
      tokenPoints.push(Point3d.midPoint(prevPt, currPt));
      prevPt = currPt;
    }
    return tokenPoints;
  }

  /**
   * Adds points to the provided points array that represent the
   * top and bottom of the token.
   * If top and bottom are equal, it just returns the points.
   */
  static elevatePoints(token, pts) {
    const { topZ, bottomZ } = token;
    if ( topZ.almostEqual(bottomZ) ) return pts;
    pts.forEach(pt => {
      const topPt = pt.clone();
      const bottomPt = pt.clone();
      topPt.z = topZ;
      bottomPt.z = bottomZ;
      pts.push(topPt, bottomPt);
    });
    return pts;
  }

  /**
   * Test an array of token points against an array of target points.
   * Each tokenPoint will be tested against every array of targetPoints.
   * @param {Point3d[]} tokenPoints           Array of viewer points.
   * @param {Point3d[][]} targetPointsArray   Array of array of target points to test.
   * @returns {number} Minimum percent blocked for the token points
   */
  _testTargetPoints(targetPointsArray) {
    let minBlocked = 1;
    for ( const targetPoints of targetPointsArray ) {
      const percentBlocked = this._testPointToPoints(targetPoints);

      // We can escape early if this is completely visible.
      if ( !percentBlocked ) return 0;
      minBlocked = Math.min(minBlocked, percentBlocked);
    }
    return minBlocked;
  }

  /**
   * Helper that tests collisions between a given point and a target points.
   * @param {Point3d} tokenPoint        Point on the token to use.
   * @param {Point3d[]} targetPoints    Array of points on the target to test
   * @returns {number} Percent points blocked
   */
  _testPointToPoints(targetPoints) {
    const viewerPoint = this.viewerPoint;
    const visibleTargetShape = this.config.visibleTargetShape;
    let numPointsBlocked = 0;
    const ln = targetPoints.length;
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const outsideVisibleShape = visibleTargetShape
        && !visibleTargetShape.contains(targetPoint.x, targetPoint.y);

      numPointsBlocked += ( outsideVisibleShape
        || this._hasTokenCollision(viewerPoint, targetPoint)
        || this._hasWallCollision(viewerPoint, targetPoint)
        || this._hasTileCollision(viewerPoint, targetPoint) );
    }
    return numPointsBlocked / ln;
  }

  /**
   * Helper that constructs 3d points for the points of a token shape (rectangle or polygon).
   * Uses the elevation provided as the z-value.
   * @param {PIXI.Polygon|PIXI.Rectangle} tokenShape
   * @param {number} elevation
   * @returns {Point3d[]} Array of corner points.
   */
  static _getTokenCorners(tokenShape, elevation) {
    if ( tokenShape instanceof PIXI.Rectangle ) {
      // Token unconstrained by walls.
      // Use corners 1 pixel in to ensure collisions if there is an adjacent wall.
      tokenShape.pad(-1);
      return [
        new Point3d(tokenShape.left, tokenShape.top, elevation),
        new Point3d(tokenShape.right, tokenShape.top, elevation),
        new Point3d(tokenShape.right, tokenShape.bottom, elevation),
        new Point3d(tokenShape.left, tokenShape.bottom, elevation)
      ];
    }

    // Constrained is polygon. Only use corners of polygon
    // Scale down polygon to avoid adjacent walls.
    const padShape = tokenShape.pad(-2, { scalingFactor: 100 });
    return [...padShape.iteratePoints({close: false})].map(pt => new Point3d(pt.x, pt.y, elevation));
  }

  /**
   * Get polygons representing all grids under a token.
   * If token is constrained, overlap the constrained polygon on the grid shapes.
   * @param {Token} token
   * @return {PIXI.Polygon[]|PIXI.Rectangle[]|null}
   */
  static constrainedGridShapesUnderToken(token) {
    const gridShapes = this.gridShapesUnderToken(token);
    const constrained = token.constrainedTokenBorder;

    // Token unconstrained by walls.
    if ( constrained instanceof PIXI.Rectangle ) return gridShapes;

    // For each gridShape, intersect against the constrained shape
    const constrainedGridShapes = [];
    const constrainedPath = ClipperPaths.fromPolygons([constrained]);
    for ( let gridShape of gridShapes ) {
      if ( gridShape instanceof PIXI.Rectangle ) gridShape = gridShape.toPolygon();

      const constrainedGridShape = constrainedPath.intersectPolygon(gridShape).simplify();
      if ( !constrainedGridShape || constrainedGridShape.points.length < 6 ) continue;
      constrainedGridShapes.push(constrainedGridShape);
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
      console.error("gridShapesUnderTarget called on gridless scene!");
      return token.bounds;
    }
    return canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squaresUnderToken(token) : hexesUnderToken(token);
  }

  // ----- NOTE: Debugging methods ----- //

  /**
   * For debugging.
   * Draw debugging objects on the main canvas.
   * @param {boolean} hasLOS    Is there line-of-sight to this target?
   */
  _drawCanvasDebug(hasLOS = true) {
    super._drawCanvasDebug(hasLOS);
    this._drawTargetPointsArray(this.targetPoints);
  }

  /**
   * For debugging.
   * Draw all the points.
   * Mirrors _testTargetPoints
   */
  _drawTargetPointsArray(targetPointsArray) {
    let minBlocked = 1;
    let minTargetPoints = []; // Debugging
    for ( const targetPoints of targetPointsArray ) {
      const percentBlocked = this._testPointToPoints(targetPoints);

      // We can escape early if this is completely visible.
      if ( !percentBlocked ) {
        minTargetPoints = targetPoints;
        break;
      }

      this._drawPointToPoints(targetPoints, { alpha: 0.1 });
      if ( percentBlocked < minBlocked ) minTargetPoints = targetPoints;
      minBlocked = Math.min(minBlocked, percentBlocked);
    }
    this._drawPointToPoints(minTargetPoints, { width: 2 });
  }


  /**
   * For debugging.
   * Color lines from point to points as yellow, red, or green depending on collisions.
   * @param {Point3d[]} targetPoints    Array of points on the target to test
   */
  _drawPointToPoints(targetPoints, { alpha = 1, width = 1 } = {}) {
    const draw = new Draw(Settings.DEBUG_LOS);
    const viewerPoint = this.viewerPoint;
    const visibleTargetShape = this.config.visibleTargetShape;
    const ln = targetPoints.length;
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const outsideVisibleShape = visibleTargetShape
        && !visibleTargetShape.contains(targetPoint.x, targetPoint.y);

      const tokenCollision = this._hasTokenCollision(viewerPoint, targetPoint);
      const edgeCollision = this._hasWallCollision(viewerPoint, targetPoint)
        || this._hasTileCollision(viewerPoint, targetPoint);

      let color;
      if ( outsideVisibleShape ) color = Draw.COLORS.gray;
      else if ( tokenCollision && !edgeCollision ) color = Draw.COLORS.yellow;
      else if ( edgeCollision ) color = Draw.COLORS.red;
      else color = Draw.COLORS.green;

      draw.segment({ A: viewerPoint, B: targetPoint }, { alpha, width, color });
    }
  }
}
