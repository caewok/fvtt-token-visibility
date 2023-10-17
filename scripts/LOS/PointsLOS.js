/* globals
canvas,
CONST,
PIXI,
Token,
VisionSource
*/
"use strict";

import { Point3d } from "./geometry/3d/Point3d.js";
import { Draw } from "./geometry/Draw.js";
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { AlternativeLOS } from "./AlternativeLOS.js";
import { squaresUnderToken, hexesUnderToken } from "./LOS/shapes_under_token.js";

/**
 * Estimate line-of-sight between a source and a token using different point-to-point methods.
 */
export class PointsLOS extends AlternativeLOS {

  static ALGORITHM = {
    CENTER_CENTER: "points_center_to_center",
    CENTER_CORNERS: "points_center_to_corners",
    CORNER_CORNERS: "points_corners_to_corners",
    CENTER_CORNERS_GRID: "points_center_to_corners_grid",
    CORNER_CORNERS_GRID: "points_corner_to_corners_grid",
    CENTER_CUBE: "points_center_to_cube",
    CUBE_CUBE: "points_cube_to_cube"
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
   * Token that represents the viewer.
   * @type {Token}
   */
  viewerToken;

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
   * @property {PointsLOS.ALGORITHM}                  The type of point-based algorithm to apply.
   */
  config = {};

  /**
   * @param {Point3d|Token|VisionSource} viewer       Object from which to determine line-of-sight
   *   If more than token center is required, then this must be a Token or VisionSource
   * @param {Token} target                            Object to test for visibility
   * @param {AlternativeLOSConfig} config
   */
  constructor(viewer, target, config) {
    let viewerToken;
    if ( viewer instanceof Token ) {
      viewerToken = viewer;
      viewer = Point3d.fromTokenCenter(viewerToken);
    }
    if ( viewer instanceof VisionSource ) {
      viewerToken = viewer.object;
      viewer = Point3d.fromTokenCenter(viewerToken);
    }
    super(viewer, target, config);
    this.viewerToken = viewerToken;
    this.#configure(config);
  }

  #configure(config) {
    const cfg = this.config;
    cfg.algorithm = config.algorithm ?? this.constructor.ALGORITHM.CENTER_CENTER;
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
   * @param {number} [threshold]    Percentage to be met to be considered visible
   * @returns {boolean}
   */
  hasLOS(threshold) {
    const percentVisible = this.percentVisible();
    if ( percentVisible.almostEqual(0) ) return false;
    return this.percentVisible > threshold || percentVisible.almostEqual(threshold);
  }

  /**
   * Determine percentage of the token visible using the class methodology.
   * @returns {number}
   */
  percentVisible() {
    return (1 - this.applyPercentageTest());
  }

  applyPercentageTest() {
    const fnName = this.constructor.ALGORITHM_METHOD[this.config.algorithm];
    return this[fnName]();
  }

  // ----- NOTE: Algorithm methods ----- //

  /**
   * Test line-of-sight from viewer point to target center.
   * @returns {number}    1 if visible, 0 if blocked.
   */
  centerToCenter() {
    const targetPoints = [Point3d.fromTokenCenter(this.target)];
    return this._testTokenTargetPoints([this.viewerCenter], [targetPoints]);
  }

  /**
   * Test line-of-sight from viewer point to the corners of the target.
   * It is assumed that "center" is at the losHeight elevation, and corners are
   * at the mean height of the token.
   * @returns {number}
   */
  centerToTargetCorners() {
    const { target, targetAvgElevationZ, viewerCenter } = this;
    const targetPoints = this.constructor._getTokenCorners(target.constrainedTokenBorder, targetAvgElevationZ);
    return this._testTokenTargetPoints([viewerCenter], [targetPoints]);
  }

  /**
   * Test line-of-sight based on corner-to-corners test. This is a simpler version of the DMG dnd5e test for cover.
   * Runs a collision test on all corners of the target, and takes the best one
   * from the perspective of the viewer token.
   * @returns {COVER_TYPE}
   */
  cornerToTargetCorners() {
    const tokenCorners = this._getCorners(this.viewer.constrainedTokenBorder, this.viewer.topZ);
    const targetPoints = this._getCorners(this.target.constrainedTokenBorder, this.targetAvgElevationZ);
    return this._testTokenTargetPoints(tokenCorners, [targetPoints]);
  }

  /**
   * Test line-of-sight based on center-to-corners test. This is a simpler version of the DMG dnd5e test.
   * If the token covers multiple squares, this version selects the token square with the least percent blocked.
   * It is assumed that "center" is at the losHeight elevation, and corners are
   * at the mean height of the token.
   * @returns {COVER_TYPE}
   */
  centerToTargetGridCorners() {
    const targetShapes = this.constructor.constrainedGridShapesUnderToken(this.target);
    const targetElevation = this.targetAvgElevationZ;
    const targetPointsArray = targetShapes.map(targetShape => this._getCorners(targetShape, targetElevation));
    return this._testTokenTargetPoints([this.viewerCenter], targetPointsArray);
  }

  /**
   * Test cover based on corner-to-corners test. This is a simpler version of the DMG dnd5e test.
   * Runs a collision test on all corners of the token, and takes the best one
   * from the perspective of the token (the corner that provides least cover).
   * @returns {COVER_TYPE}
   */
  cornerToTargetGridCorners() {
    const tokenCorners = this._getCorners(this.viewer.constrainedTokenBorder, this.viewer.topZ);
    const targetShapes = this.constructor.constrainedGridShapesUnderToken(this.target);
    const targetElevation = this.targetAvgElevationZ;
    const targetPointsArray = targetShapes.map(targetShape => this._getCorners(targetShape, targetElevation));
    return this._testTokenTargetPoints(tokenCorners, targetPointsArray);
  }

  /**
   * Test cover based on center to cube test.
   * If target has a defined height, test the corners of the cube target.
   * Otherwise, call coverCenterToCorners.
   * @returns {COVER_TYPE}
   */
  centerToCube() {
    if ( !this.targetHeight ) return this.centerToTargetCorners();

    const targetShape = this.target.constrainedTokenBorder;
    const targetPoints = [
      ...this._getCorners(targetShape, this.target.topZ),
      ...this._getCorners(targetShape, this.target.bottomZ)];

    return this._testTokenTargetPoints([this.viewerCenter], [targetPoints]);
  }

  /**
   * Test cover based on cube to cube test.
   * If target has a defined height, test the corners of the cube target.
   * Otherwise, call coverCornerToCorners.
   * @returns {COVER_TYPE}
   */
  cubeToCube() {
    if ( !this.targetHeight ) return this.centerToTargetCorners();

    const tokenCorners = this._getCorners(this.viewer.constrainedTokenBorder, this.viewer.topZ);
    const targetShape = this.target.constrainedTokenBorder;
    const targetPoints = [
      ...this._getCorners(targetShape, this.target.topZ),
      ...this._getCorners(targetShape, this.target.bottomZ)];

    return this._testTokenTargetPoints(tokenCorners, [targetPoints]);
  }

  /**
   * Test an array of token points against an array of target points.
   * Each tokenPoint will be tested against every array of targetPoints.
   * @param {Point3d[]} tokenPoints           Array of viewer points.
   * @param {Point3d[][]} targetPointsArray   Array of array of target points to test.
   * @returns {number} Minimum percent blocked for the token points
   */
  _testTokenTargetPoints(tokenPoints, targetPointsArray) {
    let minBlocked = 1;
    const minPointData = { tokenPoint: undefined, targetPoints: undefined }; // Debugging
    for ( const tokenPoint of tokenPoints ) {
      for ( const targetPoints of targetPointsArray ) {
        const percentBlocked = this._testPointToPoints(tokenPoint, targetPoints);

        // We can escape early if this is completely visible.
        if ( !percentBlocked ) {
          if ( this.debug ) this._drawPointToPoints(tokenPoint, targetPoints, { width: 2 });
          return 0;
        }

        if ( this.debug ) {
          this._drawPointToPoints(tokenPoint, targetPoints, { alpha: 0.1 });
          if ( percentBlocked < minBlocked ) {
            minPointData.tokenPoint = tokenPoint;
            minPointData.targetPoints = targetPoints;
          }
        }

        minBlocked = Math.min(minBlocked, percentBlocked);
        if ( this.debug ) this._drawPointToPoints(tokenPoint, targetPoints, { alpha: 0.1 });
      }
    }

    if ( this.debug ) this._drawPointToPoints(minPointData.tokenPoint, minPointData.targetPoints, { width: 2 });
    return minBlocked;
  }

  /**
   * Helper that tests collisions between a given point and a target points.
   * @param {Point3d} tokenPoint        Point on the token to use.
   * @param {Point3d[]} targetPoints    Array of points on the target to test
   * @returns {number} Percent points blocked
   */
  _testPointToPoints(tokenPoint, targetPoints) {
    let numPointsBlocked = 0;
    const ln = targetPoints.length;
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      numPointsBlocked += (this._hasTokenCollision(tokenPoint, targetPoint)
        || this._hasWallCollision(tokenPoint, targetPoint)
        || this._hasTileCollision(tokenPoint, targetPoint));
    }
    return numPointsBlocked / ln;
  }

  /**
   * For debugging.
   * Color lines from point to points as yellow, red, or green depending on collisions.
   * @param {Point3d} tokenPoint        Point on the token to use.
   * @param {Point3d[]} targetPoints    Array of points on the target to test
   */
  _drawPointToPoints(tokenPoint, targetPoints, { alpha = 1, width = 1 } = {}) {
    const ln = targetPoints.length;
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const tokenCollision = this._hasTokenCollision(tokenPoint, targetPoint);
      const edgeCollision = this._hasWallCollision(tokenPoint, targetPoint)
        || this._hasTileCollision(tokenPoint, targetPoint);

      const color = (tokenCollision && !edgeCollision) ? Draw.COLORS.yellow
        : edgeCollision ? Draw.COLORS.red : Draw.COLORS.green;

      Draw.segment({ A: tokenPoint, B: targetPoint }, { alpha, width, color });
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

