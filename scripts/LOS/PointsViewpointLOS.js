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
import { AbstractViewpointLOS } from "./AbstractViewpointLOS.js";
import { squaresUnderToken, hexesUnderToken } from "./shapes_under_token.js";
import { testWallsForIntersections } from "./PointSourcePolygon.js";
import {
  lineIntersectionQuadrilateral3d,
  lineSegmentIntersectsQuadrilateral3d } from "./util.js";

// Debug
import { Draw } from "../geometry/Draw.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class PointsViewpointLOS extends AbstractViewpointLOS {
  /**
   * Sets configuration to the current settings.
   * @param {ViewpointLOSConfig} [cfg]
   * @returns {ViewpointLOSConfig}
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
  _percentVisible(target) {
    const targetPoints = this.constructTargetPoints(target);
    this.findBlockingObjects(target); // TODO: Cache this.
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
    const debugDraw = this.viewerLOS.config.debug ? this.debugDraw : undefined;
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const outsideVisibleShape = visibleTargetShape
        && !visibleTargetShape.contains(targetPoint.x, targetPoint.y);

      if ( this.viewerLOS.config.debug ) {
        let color;
        const tokenCollision = this._hasTokenCollision(viewpoint, targetPoint);
        const edgeCollision = this._hasWallCollision(viewpoint, targetPoint)
          || this._hasTileCollision(viewpoint, targetPoint);

        if ( outsideVisibleShape ) color = Draw.COLORS.gray;
        else if ( tokenCollision && !edgeCollision ) color = Draw.COLORS.yellow;
        else if ( edgeCollision ) color = Draw.COLORS.red;
        else color = Draw.COLORS.green;
        debugDraw.segment({ A: viewpoint, B: targetPoint }, { alpha: 0.1, width: 1, color });
      }

      numPointsBlocked += ( outsideVisibleShape
        || this._hasTokenCollision(viewpoint, targetPoint)
        || this._hasWallCollision(viewpoint, targetPoint)
        || this._hasTileCollision(viewpoint, targetPoint) );
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
  constructTargetPoints(target) {
    const { pointAlgorithm, targetInset, points3d } = this.config;
    const cfg = { pointAlgorithm, inset: targetInset, viewpoint: this.viewpoint };

    if ( this.useLargeTarget ) {
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

  // TODO: Use a separate class and triangles to test collisions of various objects.

  /**
   * Does the ray between two points collide with a wall within the vision triangle?
   * @param {Point3d} startPt      Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if a wall blocks this ray
   */
  _hasWallCollision(startPt, endPt) {
    if ( !this.viewerLOS.config.wallsBlock ) return false;
    const walls = [...this.blockingObjects.walls, ...this.blockingObjects.terrainWalls];
    return testWallsForIntersections(startPt, endPt, walls, "any", this.viewerLOS.config.type);
  }

  /**
   * Does the ray between two points collide with a tile within the vision triangle?
   * @param {Point3d} startPt       Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if a tile blocks this ray
   */
  _hasTileCollision(startPt, endPt) {
    if ( !this.viewerLOS.config.tilesBlock ) return false;
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;

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
      if ( this.viewerLOS.config.type === "light" && tile.document.flags?.levels?.noCollision ) continue;

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
    const { liveTokensBlock, deadTokensBlock } = this.viewerLOS.config;
    if ( !(liveTokensBlock || deadTokensBlock) ) return false;


    // Use blockingObjects b/c more limited and we can modify it if necessary.
    // Filter out the viewer and target token
    // const collisionTest = o => !(o.t.bounds.contains(startPt.x, startPt.y) || o.t.bounds.contains(endPt.x, endPt.y));
    // const ray = new Ray(startPt, endPt);
    // let tokens = canvas.tokens.quadtree.getObjects(ray.bounds, { collisionTest });
    let tokens = this.blockingObjects.tokens.filter(t =>
      t.constrainedTokenBorder.lineSegmentIntersects(startPt, endPt, { inside: true }));

    // Filter out the viewer and target token
    tokens.delete(this.viewerLOS.viewer);
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