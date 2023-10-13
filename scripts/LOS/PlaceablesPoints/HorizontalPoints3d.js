/* globals
PIXI,
foundry,
CONFIG
*/
"use strict";

import { PlanePoints3d } from "./PlanePoints3d.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";

/**
 * Points oriented horizontally on the canvas.
 * Basically a polygon, but this.points holds Points3d with z values all equal.
 */
export class HorizontalPoints3d extends PlanePoints3d {
  /**
   * Construct horizontal points from a PIXI rectangle
   * @param {PIXI.Rectangle} r    Rectangle to convert to points
   * @param {object} [options]    Options that affect what part of token is used
   * @param {string} [options.elevation]  Elevation to use for the face. Defaults to 0.
   * @param {object} [options.object]     Object to pass to constructor, if not rectangle.
   * @returns {HorizontalPoints3d}
   */
  static fromPIXIRectangle(r, { elevation = 0, object = r } = {}) {
    const points = [
      new Point3d(r.x, r.y, elevation),
      new Point3d(r.x + r.width, r.y, elevation),
      new Point3d(r.x + r.width, r.y + r.height, elevation),
      new Point3d(r.x, r.y + r.height, elevation)
    ];

    return new this(object, points);
  }

  /**
   * Construct horizontal points from top or bottom of token
   * @param {Token} token   Token to use
   * @param {object} [options]    Options that affect what part of token is used
   * @param {string} [options.elevation]      Elevation to use for the face. Defaults to token.topZ.
   * @param {boolean} [options.constrained]   If true, use the constrained border
   */
  static fromToken(token, { elevation = token.topZ, constrained = false } = {}) {
    const border = constrained ? token.constrained : token.bounds;
    if ( border instanceof PIXI.Rectangle ) return this.fromPIXIRectangle(border, { elevation, object: token});
    return new this(token, [...border.iteratePoints({close: false})]);
  }

  /**
   * Construct horizontal points from a polygon
   * @param {PIXI.Polygon} poly   Polygon to convert to points
   * @param {object} [options]    Options that affect what part of token is used
   * @param {string} [options.elevation]  Elevation to use. Defaults to 0.
   * @param {object} [options.object]     Object to pass to constructor, if not polygon.
   */
  static fromPolygon(poly, { elevation = 0, object = poly } = {}) {
    const pts = [...poly.iteratePoints({close: false})];
    const nPts = pts.length;
    const points = new Array(nPts);
    for ( let i = 0; i < nPts; i += 1 ) {
      const pt = pts[i];
      points[i] = new Point3d(pt.x, pt.y, elevation);
    }
    return new this(object, points);
  }

  /**
   * Convert to a polygon
   * @returns {PIXI.Polygon}
   */
  toPolygon() { return new PIXI.Polygon(this.points); }

  /**
   * Convert to PIXI shape: rectangle if 4 points in line, polygon otherwise.
   * This will drop the elevation dimension.
   * @return {PIXI.Polygon|PIXI.Rectangle}
   */
  toPIXIShape() {
    const points = this.points;

    if ( points.length === 4 ) {
      const A = points[0];
      const B = points[1];
      const C = points[2];
      const D = points[3];
      const minX = Math.min(A.x, B.x, C.x, D.x);
      const minY = Math.min(A.y, B.y, C.y, D.y);
      const maxX = Math.max(A.x, B.x, C.x, D.x);
      const maxY = Math.max(A.y, B.y, C.y, D.y);

      // If any point is not minX/maxX and minY/maxY, we don't have a PIXI.Rectangle.
      if ( (A.x === minX || A.x === maxX) && (A.y === minY || A.y === maxY)
        && (B.x === minX || B.x === maxX) && (B.y === minY || B.y === maxY)
        && (C.x === minX || C.x === maxX) && (C.y === minY || C.y === maxY)
        && (D.x === minX || D.x === maxX) && (D.y === minY || D.y === maxY) ) {
        return new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY);
      }
    }
    return new PIXI.Polygon(points);
  }

  /** @type {number} */
  get z() { return this.points[0].z; }

  /**
   * Are these points within a horizontal 2d triangle?
   * Points on the edge do not count as within.
   * @param {PIXI.Polygon} poly   Polygon to test
   * @param {object} [options]    Options that affect the calculation
   * @param {object[]} [options.edges]            Optional array of edges for the triangle
   * @param {boolean} [options.useBottomPoints]   If true, use bottom points instead of top
   * @returns {boolean}
   */
  isWithin2dConvexPolygon(poly, { edges } = {}) {
    const { lineSegmentCrosses, isOnSegment } = CONFIG.GeometryLib.utils;

    // Need to walk around the edges in clockwise order.
    if ( !poly.isClockwise ) {
      poly.reverseOrientation();
      edges = poly.iterateEdges({ close: true });
    } else edges ??= poly.iterateEdges({ close: true });

    const thisEdges = this.iterateEdges();

    for ( const thisEdge of thisEdges ) {
      const A = thisEdge.A;
      const B = thisEdge.B;

      let aCW = true;
      let bCW = true;
      let aOnSegment = false;
      let bOnSegment = false;
      let aEndpoint = false;
      let bEndpoint = false;
      for ( const edge of edges ) {
        // If A|B crosses the edge, we are done
        if ( lineSegmentCrosses(edge.A, edge.B, A, B) ) return true;

        // If A and B are on separate segments and are not both endpoints,
        // A|B cuts the polygon in two.
        if ( !aOnSegment || !bOnSegment ) {
          const aIsOn = isOnSegment(edge.A, edge.B, A, 1e-08);  // Epsilon default 1e-08
          const bIsOn = isOnSegment(edge.A, edge.B, B, 1e-08);

          if ( aIsOn ^ bIsOn ) {
            if ( aIsOn ) aOnSegment = true;
            if ( bIsOn ) bOnSegment = true;
          }
        }

        // For a point to be contained in a convex polygon, it must be strictly clockwise to every edge.
        let oA = foundry.utils.orient2dFast(edge.A, edge.B, A);
        if ( oA.almostEqual(0) ) oA = 0;
        aCW &&= oA < 0;

        let oB = foundry.utils.orient2dFast(edge.A, edge.B, B);
        if ( oB.almostEqual(0) ) oB = 0;
        bCW &&= oB < 0;

        // If A and B are collinear to this edge, not within a *convex* polygon (part of the same edge)
        if ( !oA && !oB ) {
          // Collinear, so either A|B and edge overlap or they are one after the other.
          if ( !aOnSegment && !bOnSegment && !isOnSegment(A, B, edge.A, 1e-08) && !isOnSegment(A, B, edge.B) ) continue;
          return true; // They overlap.
        }

        // Track whether A or b are near equivalent to endpoints of the polygon.
        aEndpoint ||= edge.A.almostEqual(A);
        bEndpoint ||= edge.B.almostEqual(B);
      }

      // If both are on separate segments and not both endpoints, A|B cuts the polygon in half
      if ( aOnSegment && bOnSegment && !(aEndpoint && bEndpoint) ) return true;

      // If either or both are within the polygon, A|B is within
      if ( (aCW && bCW) || (aCW ^ bCW) ) return true;
    }
    return false;
  }

  /**
   * Does the wall potentially block the viewer from the target
   * @param {Point3d} viewerLoc   Coordinates of viewer
   * @param {Token} target        Target token
   * @param {object} targetPts    Optional Point3d.fromToken() result for the target
   * @returns {boolean}
   */
  potentiallyBlocksToken(viewerLoc, target, targetPts) {
    const z = this.z;
    targetPts ??= Point3d.fromToken(target);
    viewerLoc.z ??= 0;

    // Check the z dimension: must be between viewer and target
    if ( viewerLoc.z < z && targetPts.top.z < z ) return false;
    if ( viewerLoc.z > z && targetPts.bottom.z > z ) return false;

    // Test each edge to see if it lies between viewer and target
    const edgesIter = this.iterateEdges();
    let viewerCW = true;
    let targetCW = true;
    for ( const edge of edgesIter ) {
      const oABviewer = foundry.utils.orient2dFast(edge.A, edge.B, viewerLoc);
      const oABtarget = foundry.utils.orient2dFast(edge.A, edge.B, target.center);

      // If viewer and target on opposite sides, then it potentially blocks
      if ( (oABviewer * oABtarget) < 0 ) return true;

      viewerCW &&= oABviewer < 0;
      targetCW &&= oABtarget < 0;
    }

    // If viewer or target is always clockwise, then it potentially blocks
    if ( viewerCW || targetCW ) return true;
    return false;
  }

  /**
   * Split the horizontal points if they intersect a token shape.
   * The split is as follows:
   * - intersect of the token shape and horizontal points is one split
   * - outside the token shape, the horizontal points are divided by
   *   drawing a line from each point to the nearest token shape vertex inside the horizontal shape.
   *   These form triangles or trapezoids, each of which is a single split.
   * (Similar to DeLauney triangulation, but simpler.)
   * @param {Token} target          Token to test for intersecting walls
   * @returns {object}
   */
  splitAtTokenIntersections(target) {
    const splits = {
      inside: null,
      outside: [],
      full: null
    };
    const elevation = this.z;

    if ( target.topZ < elevation
      || target.bottomZ > elevation ) {
      splits.full = this;
      return splits;
    }

    // Use intersect to get portions of this plane that are inside the target
    const thisShape = this.toPIXIShape();
    const targetShape = target.constrainedTokenBorder;

    // We can shortcut the calculation if both are PIXI.Rectangles
    if ( thisShape instanceof PIXI.Rectangle && targetShape instanceof PIXI.Rectangle ) {
      splits.inside = thisShape.intersection(targetShape);
      splits.inside = splits.inside.toPolygon();
      if ( !splits.inside.width || !splits.inside.height ) {
        splits.outside = [this];
        splits.inside = null;
        return splits;
      }
      splits.outside = thisShape.difference(targetShape).thisDiff;
      splits.outside = splits.outside.map(rect => rect.toPolygon());

    } else {
      // Determine which token vertices are inside the horizontal shape.
      const res = triangulatePolygonAgainstOther(thisShape.toPolygon(), targetShape.toPolygon());
      splits.outside = res.diff ?? [];
      splits.inside = res.intersect;
    }

    if ( splits.inside && splits.inside.points.length > 6 ) {
      splits.inside = HorizontalPoints3d.fromPolygon(splits.inside, { elevation });
    } else splits.inside = null;

    splits.outside = splits.outside.filter(poly => poly.points.length >= 6);
    splits.outside = splits.outside.map(poly => HorizontalPoints3d.fromPolygon(poly, { elevation }));
    return splits;
  }

  /**
   * Helper method to test for splits and return only those needed for the particular
   * visibility setup.
   * @param {Token} target                    Token to test for intersecting walls
   * @param {PIXI.Polygon} viewableTriangle   Polygon triangle to test
   * @param {object} [options]                Options that affect the test.
   * @param {object[]} [options.edges]        Array of edges for the triangle, {A: Point, B: Point}.
   * @param {}
   */
  _getVisibleSplits(target, viewableTriangle, { edges } = {}) {
    // Triangle must be clockwise so we pass edges in the correct orientation to isWithin2dConvexPolygon.
    if ( !viewableTriangle.isClockwise ) {
      viewableTriangle.reverseOrientation();
      edges = [...viewableTriangle.iterateEdges()];
    } else edges ??= [...viewableTriangle.iterateEdges()];

    // If the shape intersects the target token, break shape into parts.
    const splits = this.splitAtTokenIntersections(target);
    if ( splits.full ) return [splits.full];

    // Drop any outside splits that are not within the 2d triangle
    splits.outside = splits.outside.filter(pts => pts.isWithin2dConvexPolygon(viewableTriangle, { edges }));

    // If the inside split is blocking, keep it
    const out = [];
    if ( splits.inside && splits.inside.isWithin2dConvexPolygon(viewableTriangle, { edges }) ) out.push(splits.inside);

    out.push(...splits.outside);

    return out;
  }

  /**
   * Draw the shape on the 2d canvas
   */
  draw(drawingOptions = {}) {
    const drawTool = drawingOptions.drawTool ?? new Draw();
    const convert = CONFIG.GeometryLib.utils.pixelsToGridUnits;
    drawTool.shape(this.toPolygon());
    this.points.forEach(pt => {
      drawTool.point(pt, drawingOptions);
      drawTool.labelPoint(pt, `${convert(pt.z)}`);
    });
  }
}

/**
 * Triangulate a polygon based on how a second polygon overlaps it.
 * Leave the intersect of the two alone.
 * Using the difference between the first and second polygon, divide the first's difference
 * into triangles connected to the second.
 * @param {PIXI.Polygon} primary
 * @param {PIXI.Polygon} other
 * @returns {object} Object with {intersect: {PIXI.Polygon|null}, diff: {PIXI.Polygon[]|null}}
 */
function triangulatePolygonAgainstOther(primary, other) {
  const out = { intersect: null, diff: null };

  // If no intersect, then no division required.
  const intersect = primary.intersectPolygon(other);
  if ( !intersect.points.length ) return out;
  out.intersect = intersect;

  const primaryPath = ClipperPaths.fromPolygons([primary]);
  const diffPaths = primaryPath.diffPolygon(other);
  if ( diffPaths.paths.length === 0 ) return out;

  // Triangulate the difference polygon
  out.diff = diffPaths.earcut().toPolygons();
  return out;
}
