/* globals
ClipperLib,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import {  MODULE_ID } from "../const.js";

/**
 * The viewable area between viewer and target.
 * Typically, this is a triangle, but if viewed head-on, it will be a triangle
 * with the portion of the target between viewer and target center added on.
 */
export class VisionPolygon extends PIXI.Polygon {
  /**
   * @typedef {object} VPElevation
   * @property {number} min
   * @property {number} max
   */

  /** @type {VPElevation} */
  elevation = {
    min: Number.NEGATIVE_INFINITY,
    max: Number.POSITIVE_INFINITY
  };

  /**
   * Convert array of points to a vision polygon.
   * @param {PIXI.Point[]|number[]} points
   * @returns {VisionPolygon}
   */
  static fromPoints(points, viewpoint, target) {
    const vp = new VisionPolygon(points);
    vp.elevation.min = this.elevationMin(viewpoint, target);
    vp.elevation.max = this.elevationMax(viewpoint, target);

    // Cache for speed??
    // vp._edges = [...vp.iterateEdges()];
    vp._bounds = vp.getBounds();
    return vp;
  }

  /**
   * Convert a regular polygon to a vision polygon.
   * @param {PIXI.Polygon} poly
   * @returns {VisionPolygon}
   */
  static fromPolygon(poly, viewpoint, target) {
    return this.fromPoints(poly.points, viewpoint, target);
  }

  /**
   * Determine the minimum and maximum elevations for a given viewpoint and target.
   * @param {Point3d} viewpoint
   * @param {Token} target
   * @returns {number}
   */
  static elevationMin(viewpoint, target) {
    return Math.min(
      viewpoint?.z ?? Number.NEGATIVE_INFINITY,
      target?.bottomZ ?? Number.NEGATIVE_INFINITY
    );
  }
  static elevationMax(viewpoint, target) {
    return Math.max(
      viewpoint?.z ?? Number.POSITIVE_INFINITY,
      target?.topZ ?? Number.POSITIVE_INFINITY
    );
  }

  /**
   * Vision Polygon for the view point --> target.
   * From the given token location, get the edge-most viewable points of the target.
   * Construct a triangle between the two target points and the token center.
   * If viewing head-on (only two key points), the portion of the target between
   * viewer and target center (typically, a rectangle) is added on to the triangle.
   * @param {PIXI.Point|Point3d} viewpoint
   * @param {Token} target
   * @param {PIXI.Polygon|PIXI.Rectangle} targetBorder
   * @returns {VisionPolygon}
   */
  static build(viewpoint, target, targetBorder) {
    targetBorder ??= target.constrainedTokenBorder;
    const keyPoints = targetBorder.viewablePoints(viewpoint, { outermostOnly: false }) ?? [];
    let out;
    switch ( keyPoints.length ) {
      case 0:
      case 1:
        out = targetBorder.toPolygon().points;
        break;
      case 2: {
        const k0 = keyPoints[0];
        const k1 = keyPoints[1];
        const center = target.center;

        // Build a rectangle between center and key points.
        // Intersect against the targetBorder
        const X = Math.minMax(k0.x, k1.x, center.x);
        const Y = Math.minMax(k0.y, k1.y, center.y);
        const rect = new PIXI.Rectangle(X.min, Y.min, X.max - X.min, Y.max - Y.min);
        const intersect = targetBorder instanceof PIXI.Rectangle ? rect : rect.intersectPolygon(targetBorder);

        // Union the triangle with this border
        const triangle = new PIXI.Polygon([viewpoint, k0, k1]);

        // WA requires a polygon with a positive orientation.
        if ( !triangle.isPositive ) triangle.reverseOrientation();
        out = intersect.intersectPolygon(triangle, { clipType: ClipperLib.ClipType.ctUnion }).points;
        break;
      }
      default:
        out = [viewpoint, keyPoints[0], keyPoints.at(-1)];
    }
    out = this.fromPoints(out, viewpoint, target);
    if ( !out.isClockwise ) out.reverseOrientation();
    return out;
  }

  /**
   * Filter walls in the scene by a triangle representing the view from viewingPoint to some
   * token (or other two points). Only considers 2d top-down view.
   * @param {Set<Wall>}
   * @return {Set<Wall>}
   */
  filterWalls(walls) {
    const viewpoint = this.iteratePoints().next().value;

    // Filter by the precise triangle cone.
    return walls.filter(wall => {
      if ( wall.isOpen ) return false;

      // Ignore one-directional walls facing away from the viewpoint.
      if ( wall.document.dir
        && (wall.edge.orientPoint(viewpoint) === wall.document.dir) ) return false;

      // Ignore walls that are not within the elevation vision rectangle.
      let { top, bottom } = wall.edge.elevationLibGeometry.a;
      top ??= Number.POSITIVE_INFINITY;
      bottom ??= Number.NEGATIVE_INFINITY;
      if ( wall.top < this.elevation.min || wall.bottom > this.elevation.max ) return false;

      const { a, b } = wall.edge;
      if ( this.contains(a.x, a.y) || this.contains(b.x, b.y) ) return true;
      return this.iterateEdges().some(e => foundry.utils.lineSegmentIntersects(a, b, e.A, e.B));
    });
  }

  /**
   * Filter tiles in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * @param {Set<Tile>}
   * @return {Set<Tile>}
   */
  filterTiles(tiles) {
    // Filter by the precise triangle shape
    // Also filter by overhead tiles
    const alphaThreshold = CONFIG[MODULE_ID].alphaThreshold;
    return tiles.filter(tile => {
      const tileE = tile.document.elevation;

      // Only overhead tiles count for blocking vision
      // TODO: Need more nuanced understanding of overhead tiles and what should block.
      if ( tileE < tile.document.parent?.foregroundElevation ) return false;

      // Ignore tiles that are not within the elevation vision rectangle.
      if ( tileE < this.elevation.min || tileE > this.elevation.max ) return false;

      // Use the alpha bounding box. This might be a polygon if the tile is rotated.
      const tBounds = tile.evPixelCache.getThresholdCanvasBoundingBox(alphaThreshold);
      const tCenter = tBounds.center;
      if ( this.contains(tCenter.x, tCenter.y) ) return true;
      return this.iterateEdges().some(e => tBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
  }

  /**
   * Filter tokens in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * Excludes the target and the visionSource token. If no visionSource, excludes any
   * token under the viewer point.
   * @param {Set<Token>}
   * @return {Set<Token>}
   */
  filterTokens(tokens) {
    return tokens.filter(token => {
      // Ignore tokens not within the elevation vision rectangle.
      if ( token.topE < this.elevation.min || token.bottomE > this.elevation.max ) return false;

      // Even for constrained tokens, the token center should remain within the token border.
      const tCenter = token.center;
      if ( this.contains(tCenter.x, tCenter.y) ) return true;

      // Full test of token border.
      const tBounds = token.bounds;
      return this.iterateEdges().some(e => tBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
  }
}
