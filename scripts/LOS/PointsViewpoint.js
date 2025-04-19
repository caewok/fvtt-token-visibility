/* globals
CONFIG,
CONST,
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { Settings } from "../settings.js";

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { squaresUnderToken, hexesUnderToken } from "./shapes_under_token.js";

// Debug
import { Draw } from "../geometry/Draw.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class PointsViewpoint extends AbstractViewpoint {
  /**
   * Sets configuration to the current settings.
   * @param {ViewpointConfig} [cfg]
   * @returns {ViewpointConfig}
   */
  initializeConfig(cfg = {}) {
    // Configs specific to the Points algorithm.
    const POINT_OPTIONS = Settings.KEYS.LOS.TARGET.POINT_OPTIONS;
    cfg.pointAlgorithm ??= Settings.get(POINT_OPTIONS.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER;
    cfg.targetInset ??= Settings.get(POINT_OPTIONS.INSET) ?? 0.75;
    cfg.points3d ??= Settings.get(POINT_OPTIONS.POINTS3D) ?? false;
    return super.initializeConfig(cfg);
  }

  /* ----- NOTE: Visibility testing ----- */

  /**
   * Determine percentage of the token visible using the class methodology.
   * @returns {number}
   */
  _percentVisible() {
    this.filterPotentiallyBlockingTriangles();
    const targetPoints = this.constructTargetPoints();
    return (1 - this._testTargetPoints(targetPoints));
  }

  /**
   * Test an array of token points against an array of target points.
   * Each tokenPoint will be tested against every array of targetPoints.
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
    const viewpoint = this.viewpoint;
    const visibleTargetShape = this.viewerLOS.visibleTargetShape;
    let numPointsBlocked = 0;
    const ln = targetPoints.length;
    const debugDraw = this.viewerLOS.config.debugDraw;
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const outsideVisibleShape = visibleTargetShape
        && !visibleTargetShape.contains(targetPoint.x, targetPoint.y);
      if ( outsideVisibleShape ) continue;

      // For the intersection test, 0 can be treated as no intersection b/c we don't need
      // intersections at the origin.
      // Note: cannot use Point3d._tmp with intersection.
      // TODO: Does intersection return t values if the intersection is outside the viewpoint --> target?
      let nCollisions = 0;
      let hasCollision = this.triangles.some(tri => tri.intersection(viewpoint, targetPoint.subtract(viewpoint)))
        || this.terrainTriangles.some(tri => {
        nCollisions += Boolean(tri.intersection(viewpoint, targetPoint.subtract(viewpoint)));
        return nCollisions >= 2;
      });
      numPointsBlocked += hasCollision;

      if ( this.viewerLOS.config.debug ) {
        const color = hasCollision ? Draw.COLORS.red : Draw.COLORS.green;
        debugDraw.segment({ A: viewpoint, B: targetPoint }, { alpha: 0.5, width: 1, color });
        console.log(`Drawing segment ${viewpoint.x},${viewpoint.y} -> ${targetPoint.x},${targetPoint.y} with color ${color}.`);
      }
    }
    return numPointsBlocked / ln;
  }

  /* ----- NOTE: Target points ----- */

  /*
   * Similar to _constructViewerPoints but with a complication:
   * - Grid. When set, points are constructed per grid space covered by the token.
   * @param {Token} target
   * @returns {Points3d[][]}
   */
  constructTargetPoints() {
    const target = this.viewerLOS.target;
    const { pointAlgorithm, targetInset, points3d } = this.config;
    const cfg = { pointAlgorithm, inset: targetInset, viewpoint: this.viewpoint };

    if ( this.viewerLOS.config.largeTarget ) {
      // Construct points for each target subshape, defined by grid spaces under the target.
      const targetShapes = this.constructor.constrainedGridShapesUnderToken(target);

      // Issue #8: possible for targetShapes to be undefined or not an array??
      if ( targetShapes && targetShapes.length ) {
        const targetPointsArray = targetShapes.map(targetShape => {
          cfg.tokenShape = targetShape;
          const targetPoints = this.constructor.constructTokenPoints(target, cfg);
          if ( points3d ) return this.constructor.elevatePoints(target, targetPoints);
          return targetPoints;
        });
        return targetPointsArray;
      }
    }

    // Construct points under this constrained token border.
    cfg.tokenShape = target.constrainedTokenBorder;
    const targetPoints = this.constructor.constructTokenPoints(target, cfg);
    if ( points3d ) return [this.constructor.elevatePoints(target, targetPoints)];
    return [targetPoints];
  }

  /* ----- NOTE: Collision testing ----- */

  /** @param {Triangle[]} */
  triangles = [];

  terrainTriangles = [];

  /**
   * Filter the triangles that might block the viewer from the target.
   */
  filterPotentiallyBlockingTriangles() {
    this.triangles.length = 0;
    this.terrainTriangles.length = 0;
    const { terrainWalls, tiles, tokens, walls } = this.blockingObjects;
    for ( const terrainWall of terrainWalls ) {
      const triangles = this._filterPlaceableTrianglesByViewpoint(terrainWall);
      this.terrainTriangles.push(...triangles);
    }
    for ( const placeable of [...tiles, ...tokens, ...walls] ) {
      const triangles = this._filterPlaceableTrianglesByViewpoint(placeable);
      this.triangles.push(...triangles);
    }
  }

  /* ----- NOTE: Static methods ----- */

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
    const constrainedPath = CONFIG.GeometryLib.ClipperPaths.fromPolygons([constrained]);
    for ( let gridShape of gridShapes ) {
      if ( gridShape instanceof PIXI.Rectangle ) gridShape = gridShape.toPolygon();

      const constrainedGridShape = constrainedPath.intersectPolygon(gridShape).simplify();
      if ( !constrainedGridShape
        || ((constrainedGridShape instanceof PIXI.Polygon)
         && (constrainedGridShape.points.length < 6)) ) continue;
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

}