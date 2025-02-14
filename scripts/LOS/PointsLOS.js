/* globals
canvas,
CONST,
PIXI
*/
"use strict";

import { squaresUnderToken, hexesUnderToken } from "./shapes_under_token.js";
import { AlternativeLOS } from "./AlternativeLOS.js";
import { testWallsForIntersections } from "./PointSourcePolygon.js";
import {
  lineIntersectionQuadrilateral3d,
  lineSegmentIntersectsQuadrilateral3d } from "./util.js";

// Geometry folder
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";

// Base folder
import { Settings } from "../settings.js";

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
   * @property {POINT_TYPE} pointAlgorithm            The type of point-based algorithm to apply to target
   * @property {number} inset                         How much to inset target points from target border
   * @property {boolean} grid                         True if treating points separately for each grid space
   * @property {boolean} points3d                     Use top/bottom target elevation when enabled
   */

  _initializeConfiguration(config = {}) {
    const POINT_OPTIONS = Settings.KEYS.LOS.TARGET.POINT_OPTIONS;
    config.numTargetPoints ??= Settings.get(POINT_OPTIONS.NUM_POINTS) ?? this.constructor.POINT_TYPES.CENTER;
    config.targetInset ??= Settings.get(POINT_OPTIONS.INSET) ?? 0.75;
    config.points3d ??= Settings.get(POINT_OPTIONS.POINTS3D) ?? false
    super._initializeConfiguration(config);
  }

  _clearCache() {
    super._clearCache();
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
  _percentVisible() { return (1 - this._testTargetPoints(this.targetPoints)); }

  /**
   * @param {Token} target
   * @param {object} [opts={}]  Passed to _constructTokenPoints
   * @returns {Point3d[]}
   */
  static constructTargetPoints(target, opts = {}) {
    opts.pointAlgorithm ??= this.POINT_TYPES.CENTER;
    opts.inset ??= 0.75;
    opts.tokenShape ??= target.constrainedTokenBorder;
    return this._constructTokenPoints(target, opts);
  }

  /**
   * Similar to _constructViewerPoints but with a complication:
   * - Grid. When set, points are constructed per grid space covered by the token.
   */
  _constructTargetPoints() {
    const { target } = this;
    const pointAlgorithm = this.getConfiguration("numTargetPoints");
    const inset = this.getConfiguration("targetInset");
    const points3d = this.getConfiguration("points3d");
    const cfg = { pointAlgorithm, inset };

    if ( this.getConfiguration("numTargetPoints") === this.constructor.POINT_TYPES.TWO
      || this.getConfiguration("numTargetPoints") === this.constructor.POINT_TYPES.THREE ) {
      cfg.isTarget = true;
      cfg.viewerPoint = this.viewerPoint;
    }

    if ( this.useLargeTarget ) {
      // Construct points for each target subshape, defined by grid spaces under the target.
      const targetShapes = this.constructor.constrainedGridShapesUnderToken(target);

      // Issue #8: possible for targetShapes to be undefined or not an array??
      if ( targetShapes && targetShapes.length ) {
        const targetPointsArray = targetShapes.map(targetShape => {
          cfg.tokenShape = targetShape;
          const targetPoints = this.constructor._constructTokenPoints(target, cfg);
          if ( points3d ) return this.constructor.elevatePoints(target, targetPoints);
          return targetPoints;
        });
        return targetPointsArray;
      }
    }

    // Construct points under this constrained token border.
    cfg.tokenShape = target.constrainedTokenBorder;
    const targetPoints = this.constructor._constructTokenPoints(target, cfg);
    if ( points3d ) return [this.constructor.elevatePoints(target, targetPoints)];
    return [targetPoints];
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
    const visibleTargetShape = this.visibleTargetShape;
    let numPointsBlocked = 0;
    const ln = targetPoints.length;
    const debugDraw = this.config.debug ? this.debugDraw : undefined;
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const outsideVisibleShape = visibleTargetShape
        && !visibleTargetShape.contains(targetPoint.x, targetPoint.y);

      if ( this.config.debug ) {
        let color;
        const tokenCollision = this._hasTokenCollision(viewerPoint, targetPoint);
        const edgeCollision = this._hasWallCollision(viewerPoint, targetPoint)
          || this._hasTileCollision(viewerPoint, targetPoint);

        if ( outsideVisibleShape ) color = Draw.COLORS.gray;
        else if ( tokenCollision && !edgeCollision ) color = Draw.COLORS.yellow;
        else if ( edgeCollision ) color = Draw.COLORS.red;
        else color = Draw.COLORS.green;
        debugDraw.segment({ A: viewerPoint, B: targetPoint }, { alpha: 0.1, width: 1, color });
      }

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
      // Console.error("gridShapesUnderTarget called on gridless scene!");
      return [token.bounds];
    }
    return canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squaresUnderToken(token) : hexesUnderToken(token);
  }

  // ----- NOTE: Collisions ----- //

  /**
   * Does the ray between two points collide with an object within the vision triangle?
   * @param {Point3d} startPt      Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if an object blocks this ray
   */
  _hasCollision(startPt, endPt) {
    return this._hasWallCollision(startPt, endPt)
      || this._hasTileCollision(startPt, endPt)
      || this._hasTokenCollision(startPt, endPt);
  }

  /**
   * Does the ray between two points collide with a wall within the vision triangle?
   * @param {Point3d} startPt      Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if a wall blocks this ray
   */
  _hasWallCollision(startPt, endPt) {
    if ( !this.config.wallsBlock ) return false;
    const walls = [...this.blockingObjects.walls, ...this.blockingObjects.terrainWalls];
    return testWallsForIntersections(startPt, endPt, walls, "any", this.config.type);
  }

  /**
   * Does the ray between two points collide with a tile within the vision triangle?
   * @param {Point3d} startPt       Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if a tile blocks this ray
   */
  _hasTileCollision(startPt, endPt) {
    if ( !this.config.tilesBlock ) return false;

    // Ignore non-overhead tiles
    // Use blockingObjects b/c more limited and we can modify it if necessary.
    // const collisionTest = (o, _rect) => o.t.document.overhead;
    // const tiles = canvas.tiles.quadtree.getObjects(ray.bounds, { collisionTest });
    // TODO: Need more nuanced understanding of overhead tiles and what should block.
    const tiles = this.blockingObjects.tiles.filter(t =>
      t.document.elevation >= t.document.parent?.foregroundElevation);

    // Because tiles are parallel to the XY plane, we need not test ones obviously above or below.
    const maxE = Math.max(startPt.z, endPt.z);
    const minE = Math.min(startPt.z, endPt.z);

    // Precalculate
    const rayVector = endPt.subtract(startPt);
    const zeroMin = 1e-08;
    const oneMax = 1 + 1e-08;

    for ( const tile of tiles ) {
      if ( this.config.type === "light" && tile.document.flags?.levels?.noCollision ) continue;

      const { x, y, width, height, elevation } = tile.document;
      const elevationZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);

      if ( elevationZ < minE || elevationZ > maxE ) continue;

      const r0 = new Point3d(x, y, elevationZ);
      const r1 = new Point3d(x + width, y, elevationZ);
      const r2 = new Point3d(x + width, y + height, elevationZ);
      const r3 = new Point3d(x, y + height, elevationZ);

      // Need to test the tile intersection point for transparency (Levels holes).
      // Otherwise, could just use lineSegmentIntersectsQuadrilateral3d
      const t = lineIntersectionQuadrilateral3d(startPt, rayVector, r0, r1, r2, r3);
      if ( t === null || t < zeroMin || t > oneMax ) continue;
      const ix = new Point3d();
      startPt.add(rayVector.multiplyScalar(t, ix), ix);
      if ( !tile.mesh?.containsCanvasPoint(ix.x, ix.y, 0.99 + 1e-06) ) continue; // Transparent, so no collision.

      return true;
    }
    return false;
  }

  /**
   * Does the ray between two points collide with a token within the vision triangle?
   * @param {Point3d} startPt       Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if a token blocks this ray
   */
  _hasTokenCollision(startPt, endPt) {
    const { liveTokensBlock, deadTokensBlock } = this.config;
    if ( !(liveTokensBlock || deadTokensBlock) ) return false;


    // Use blockingObjects b/c more limited and we can modify it if necessary.
    // Filter out the viewer and target token
    // const collisionTest = o => !(o.t.bounds.contains(startPt.x, startPt.y) || o.t.bounds.contains(endPt.x, endPt.y));
    // const ray = new Ray(startPt, endPt);
    // let tokens = canvas.tokens.quadtree.getObjects(ray.bounds, { collisionTest });
    let tokens = this.blockingObjects.tokens.filter(t =>
      t.constrainedTokenBorder.lineSegmentIntersects(startPt, endPt, { inside: true }));

    // Filter out the viewer and target token
    tokens.delete(this.viewer);
    tokens.delete(this.target);

    // Build full- or half-height startPts3d from tokens
    const tokenPts = this._buildTokenPoints(tokens);

    // Set viewing position and test token sides for collisions
    for ( const pts of tokenPts ) {
      const sides = pts._viewableFaces(startPt);
      for ( const side of sides ) {
        if ( lineSegmentIntersectsQuadrilateral3d(startPt, endPt,
          side.points[0],
          side.points[1],
          side.points[2],
          side.points[3]) ) return true;
      }
    }
    return false;
  }


  // ----- NOTE: Debugging methods ----- //

  /**
   * For debugging.
   * Draw debugging objects on the main canvas.
   */
  _drawCanvasDebug() {
    this.config.debug = true;
    super._drawCanvasDebug();

    // this._drawTargetPointsArray(this.targetPoints);
  }

  clearDebug() {
    super.clearDebug();
    this.config.debug = false;
  }

}
