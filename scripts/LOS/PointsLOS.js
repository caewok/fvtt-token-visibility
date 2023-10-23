/* globals
canvas,
CONST,
PIXI
*/
"use strict";

import { squaresUnderToken, hexesUnderToken } from "./shapes_under_token.js";
import { AlternativeLOS } from "./AlternativeLOS.js";

// Base folder
import { SETTINGS, getSetting, DEBUG_GRAPHICS } from "../settings.js";
import { insetPoints } from "../util.js";

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
    const cfg = this.config;
    cfg.pointAlgorithm = config.pointAlgorithm ?? getSetting(SETTINGS.LOS.POINT_OPTIONS.NUM_POINTS);
    cfg.inset = config.inset ?? getSetting(SETTINGS.LOS.POINT_OPTIONS.INSET);
    cfg.grid = config.grid ?? getSetting(SETTINGS.LOS.LARGE_TARGET);
    cfg.points3d = config.points3d;
  }

  // ----- NOTE: Getters ----- //

  /** @type {Point3d} */
  get viewerCenter() { return this.viewer; } // Alias

  /**
   * Point halfway between target bottom and target top.
   * @type {number}
   */
  get targetAvgElevationZ() {
    const { bottomZ, topZ } = this.target;
    const height = (topZ - bottomZ) || 1; // So token always has a minimum height.
    return bottomZ + (height * 0.5);
  }

  // ------ NOTE: Primary methods to be overridden by subclass ----- //

  /**
   * Determine whether a viewer has line-of-sight to a target based on meeting a threshold.
   * LOS is based on the number of points visible from the viewer position.
   * @param {number} [threshold]    Percentage visible points required
   * @returns {boolean}
   */
  hasLOS(threshold) {
    const percentVisible = this.percentVisible();
    if ( percentVisible.almostEqual(0) ) return false;
    return percentVisible > threshold || percentVisible.almostEqual(threshold);
  }

  /**
   * Determine percentage of the token visible using the class methodology.
   * @returns {number}
   */
  percentVisible() {
    const percent = 1 - this.applyPercentageTest();
    if ( this.config.debug ) console.debug(`PointsLOS|${this.target.name} is ${Math.round(percent * 100)}% visible.`);
    return percent;
  }

  applyPercentageTest() {
    const targetPoints = this._constructTargetPoints();
    return this._testTargetPoints(targetPoints);
  }

  /**
   * Build the viewer points based on configuration settings.
   * Essentially, we can use the viewer center, viewer corners, and/or viewer midpoints between corners.
   * @param {Token} viewer
   * @returns {Points3d[]}
   */
  static constructViewerPoints(viewer, { pointAlgorithm, inset } = {}) {
    pointAlgorithm ??= getSetting(SETTINGS.LOS.VIEWER.NUM_POINTS);
    inset ??= getSetting(SETTINGS.LOS.VIEWER.INSET);
    return this.constructTokenPoints(
      pointAlgorithm,
      viewer.constrainedTokenBorder,
      viewer.topZ,
      inset,
      viewer.center);
  }

  /**
   * Similar to _constructViewerPoints but with a complication:
   * - Grid. When set, points are constructed per grid space covered by the token.
   */
  _constructTargetPoints() {
    const targetElevation = this.targetAvgElevationZ;
    const cfg = this.config;

    if ( cfg.grid ) {
      // Construct points for each target subshape, defined by grid spaces under the target.
      const targetShapes = this.constructor.constrainedGridShapesUnderToken(this.target);
      const targetPointsArray = targetShapes.map(targetShape => this.constructor.constructTokenPoints(
        cfg.pointAlgorithm,
        targetShape,
        targetElevation,
        cfg.inset));
      return targetPointsArray;
    }

    // Construct points under this constrained token border.
    const targetPoints = this.constructor.constructTokenPoints(
      cfg.pointAlgorithm,
      this.target.constrainedTokenBorder,
      targetElevation,
      cfg.target.inset);

    return [targetPoints];
  }

  static constructTokenPoints(pointAlgorithm, tokenShape, tokenZ, insetPercentage, tokenCenter) {
    const TYPES = SETTINGS.POINT_TYPES;
    if ( !tokenShape.contains(tokenCenter) ) tokenCenter = tokenShape.center;
    const center = new Point3d();
    center.copyFrom(tokenCenter ?? tokenShape.center);

    let tokenPoints = [];
    if ( pointAlgorithm === TYPES.CENTER
        || pointAlgorithm === TYPES.FIVE
        || pointAlgorithm === TYPES.NINE ) tokenPoints.push(center);

    if ( pointAlgorithm === TYPES.CENTER ) return tokenPoints;

    const cornerPoints = this.getCorners(tokenShape, tokenZ);

    // Inset by 1 pixel or inset percentage;
    insetPoints(cornerPoints, center, insetPercentage);
    tokenPoints.push(...cornerPoints);
    if ( pointAlgorithm === TYPES.FOUR || pointAlgorithm === TYPES.EIGHT ) return tokenPoints;

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
  _elevatePoints(token, pts) {
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
    let minTargetPoints = []; // Debugging
    const debug = this.config.debug;
    for ( const targetPoints of targetPointsArray ) {
      const percentBlocked = this._testPointToPoints(targetPoints);

      // We can escape early if this is completely visible.
      if ( !percentBlocked ) {
        if ( debug ) this._drawPointToPoints(targetPoints, { width: 2 });
        return 0;
      }

      if ( debug ) {
        this._drawPointToPoints(targetPoints, { alpha: 0.1 });
        if ( percentBlocked < minBlocked ) minTargetPoints = targetPoints;
      }

      minBlocked = Math.min(minBlocked, percentBlocked);
    }


    if ( debug ) this._drawPointToPoints(minTargetPoints, { width: 2 });
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
    const visibleTokenShape = this.config.visibleTokenShape;
    let numPointsBlocked = 0;
    const ln = targetPoints.length;
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const outsideVisibleShape = visibleTokenShape
        && !visibleTokenShape.contains(targetPoint.x, targetPoint.y)

      numPointsBlocked += ( outsideVisibleShape
        || this._hasTokenCollision(viewerPoint, targetPoint)
        || this._hasWallCollision(viewerPoint, targetPoint)
        || this._hasTileCollision(viewerPoint, targetPoint) );
    }
    return numPointsBlocked / ln;
  }

  /**
   * For debugging.
   * Color lines from point to points as yellow, red, or green depending on collisions.
   * @param {Point3d[]} targetPoints    Array of points on the target to test
   */
  _drawPointToPoints(targetPoints, { alpha = 1, width = 1 } = {}) {
    const draw = new Draw(DEBUG_GRAPHICS.LOS);
    const viewerPoint = this.viewerPoint;
    const ln = targetPoints.length;
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const tokenCollision = this._hasTokenCollision(viewerPoint, targetPoint);
      const edgeCollision = this._hasWallCollision(viewerPoint, targetPoint)
        || this._hasTileCollision(viewerPoint, targetPoint);

      const color = (tokenCollision && !edgeCollision) ? Draw.COLORS.yellow
        : edgeCollision ? Draw.COLORS.red : Draw.COLORS.green;

      draw.segment({ A: viewerPoint, B: targetPoint }, { alpha, width, color });
    }
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

}

