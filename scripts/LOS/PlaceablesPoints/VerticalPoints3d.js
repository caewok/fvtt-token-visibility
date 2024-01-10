/* globals
PIXI,
foundry,
duplicate,
CONFIG
*/
"use strict";

import { PlanePoints3d } from "./PlanePoints3d.js";

// Geometry folder
import { Point3d } from "../../geometry/3d/Point3d.js";
import { Draw } from "../../geometry/Draw.js";

/**
 * 4 points oriented vertically on the canvas
 */
export class VerticalPoints3d extends PlanePoints3d {

  /** @type {Point3d} */
  get topA() { return this.points[0]; }

  /** @type {Point3d} */
  get topB() { return this.points[1]; }

  /** @type {Point3d} */
  get bottomB() { return this.points[2]; }

  /** @type {Point3d} */
  get bottomA() { return this.points[3]; }

  /**
   * Are the top points within a horizontal 2d convex polygon?
   * Points merely on the edge do not count as within.
   * If it shares a full edge, that counts.
   * @param {PIXI.Polygon} poly   Polygon to test
   * @param {object} [options]    Options that affect the calculation
   * @param {object[]} [options.edges]            Optional array of edges for the triangle
   * @param {boolean} [options.useBottomPoints]   If true, use bottom points instead of top
   * @returns {boolean}
   */
  isWithin2dConvexPolygon(poly, { edges, useBottomPoints = false } = {}) {
    const { lineSegmentCrosses, isOnSegment } = CONFIG.GeometryLib.utils;

    // Need to walk around the edges in clockwise order.
    if ( !poly.isClockwise ) {
      poly.reverseOrientation();
      edges = poly.iterateEdges({ close: true });
    } else edges ??= poly.iterateEdges({ close: true });

    const A = useBottomPoints ? this.bottomA : this.topA;
    const B = useBottomPoints ? this.bottomB : this.topB;

    // A|B is within the polygon if:
    // 1. A|B intersects a polygon edge but A and B are not collinear to the edge
    // 2. A or B are strictly clockwise to every edge (means A or B are inside)
    // 3. A|B intersect two polygon edges where A and B are collinear to the two edges respectively.
    // 4. A and B are nearly endpoints

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
        // if ( !aOnSegment && !bOnSegment && !isOnSegment(A, B, edge.A, 1e-08) && !isOnSegment(A, B, edge.B) ) return false;
        // return true; // They overlap.
        return false;
      }

      // Track whether A or b are near equivalent to endpoints of the polygon.
      aEndpoint ||= edge.A.almostEqual(A);
      bEndpoint ||= edge.B.almostEqual(B);
    }

    // If both are on separate segments and not both endpoints, A|B cuts the polygon in half
    if ( aOnSegment && bOnSegment && !(aEndpoint && bEndpoint) ) return true;

    // If either or both are within the polygon, A|B is within
    if ( (aCW && bCW) || (aCW ^ bCW) ) return true;

    return false;
  }

  /**
   * Does the A --> B wall potentially block the viewer point from the target token
   * @param {Point3d} viewerLoc     Coordinates of viewer
   * @param {Token} target          Target token
   * @param {object} targetPts  Optional Point3d.fromToken() result for the target
   * @returns {boolean}
   */
  potentiallyBlocksToken(viewerLoc, target, targetPts) {
    const { topA, topB, bottomA } = this;
    targetPts ??= Point3d.fromToken(target);
    viewerLoc.z ??= 0;

    // Check the z dimension: must be between viewer and target
    if ( viewerLoc.z < bottomA.z && targetPts.top.z < bottomA.z ) return false;
    if ( viewerLoc.z > topA.z && targetPts.bottom.z > topA.z ) return false;

    // Check whether the line that comprises the wall is between viewer and target
    const oViewer = foundry.utils.orient2dFast(topA, topB, viewerLoc);
    const oTarget = foundry.utils.orient2dFast(topA, topB, targetPts.top);
    return (oViewer * oTarget) < 0;
  }

  /**
   * Split the vertical points if they intersect a token shape.
   * Returns object representing portions of the wall
   * @param {Token} target          Token to test for intersecting walls
   * @param {object} [options]      Options that affect the calculation
   * @param {Point3d|Point2d} [options.viewerLoc] 3d or 2d coordinate of viewer location.
   *   If provided, used to extend the token size to account for perspective.
   *   As a result, when viewer is provided, the side walls will not block from behind.
   * @returns {object} Object with WallPoints3d|null for top, bottom, left, right, middle
   */
  splitAtTokenIntersections(target, { viewerLoc } = {}) {
    const splits = {
      top: null,
      middle: null,
      bottom: null,
      sideA: null,
      sideB: null,
      full: null
    };
    const { topA, topB, bottomA } = this;
    const targetBorder = target.constrainedTokenBorder;
    if ( !targetBorder.lineSegmentIntersects(topA, topB, { inside: true }) ) {
      splits.full = this;
      return splits;
    }

    // First, split top and bottom
    const { bottomZ, topZ } = target;
    const { object, points } = this;
    const pTop = new this.constructor(object, duplicate(points));
    const pBottom = new this.constructor(object, duplicate(points));
    const pMiddle = new this.constructor(object, duplicate(points));

    pTop.bottomA.z = pTop.bottomB.z = topZ;
    pBottom.topA.z = pBottom.topB.z = bottomZ;

    // If the wall does not cover the entirety of the token, keep only the part of the wall that does.
    pMiddle.topA.z = pMiddle.topB.z = Math.min(topZ, topA.z);
    pMiddle.bottomA.z = pMiddle.bottomB.z = Math.max(bottomZ, bottomA.z);

    // Test whether A and B are inside the token border
    const Acontained = targetBorder.contains(topA.x, topA.y);
    const Bcontained = targetBorder.contains(topB.x, topB.y);

    // Find where the wall intersects the token border, if at all
    const ixs = !Acontained || !Bcontained ? targetBorder.segmentIntersections(topA, topB) : [];
    const numIxs = ixs.length;

    let ixsA;
    let ixsB;
    if ( numIxs === 2 ) [ixsA, ixsB] = ixs[0].t0 < ixs[1].t0 ? [ixs[0], ixs[1]] : [ixs[1], ixs[0]];
    else if ( numIxs === 1 ) ixsA = ixsB = ixs[0];

    // Change borders to fit perspective, so that middle is blocking token but sides are not.
    // Intersect of viewerLoc --> keyPoint and wall becomes the new intersection
    if ( viewerLoc && numIxs ) {
      const keyPoints = targetBorder.viewablePoints(viewerLoc, { outermostOnly: true });
      if ( keyPoints && keyPoints.length === 2 ) {
        const ix0 = foundry.utils.lineLineIntersection(topA, topB, viewerLoc, keyPoints[0]);
        const ix1 = foundry.utils.lineLineIntersection(topA, topB, viewerLoc, keyPoints[1]);

        // Possible but unlikely that either ix0 or ix1 is null
        if ( ix0 && ix1 ) {
          const [keyIxA, keyIxB] = ix0.t0 < ix1.t0 ? [ix0, ix1] : [ix1, ix0];

          // Only use the key intersections if they are on the wall segment.
          if ( keyIxA.t0.between(0, 1) ) ixsA = keyIxA;
          if ( keyIxB.t0.between(0, 1) ) ixsB = keyIxB;
        }
      }
    }

    if ( !Acontained && ixsA ) {
      // A endpoint is outside token. Cut wall at the A --> ix point.
      const pA = new this.constructor(object, duplicate(points));
      const { x, y } = ixsA;
      pA.topB.x = pA.bottomB.x = x;
      pA.topB.y = pA.bottomB.y = y;

      pTop.topA.x = pTop.bottomA.x = x;
      pTop.topA.y = pTop.bottomA.y = y;

      pBottom.topA.x = pBottom.bottomA.x = x;
      pBottom.topA.y = pBottom.bottomA.y = y;

      pMiddle.topA.x = pMiddle.bottomA.x = x;
      pMiddle.topA.y = pMiddle.bottomA.y = y;

      if ( PIXI.Point.distanceSquaredBetween(pA.topA, pA.topB) > 1e-08
        && pA.topA.z > (pA.bottomA.z + 1e-08) ) splits.sideA = pA;
    }

    if ( !Bcontained && ixsB ) {
      // B endpoint is outside token. Cut wall at the B --> ix point
      const pB = new this.constructor(object, duplicate(points));
      const { x, y } = ixsB;
      pB.topA.x = pB.bottomA.x = x;
      pB.topA.y = pB.bottomA.y = y;

      pTop.topB.x = pTop.bottomB.x = x;
      pTop.topB.y = pTop.bottomB.y = y;

      pBottom.topB.x = pBottom.bottomB.x = x;
      pBottom.topB.y = pBottom.bottomB.y = y;

      pMiddle.topB.x = pMiddle.bottomB.x = x;
      pMiddle.topB.y = pMiddle.bottomB.y = y;

      if ( PIXI.Point.distanceSquaredBetween(pB.topA, pB.topB) > 1e-08
        && pB.topA.z > (pB.bottomA.z + 1e-08) ) splits.sideB = pB;
    }

    if ( pTop.topA.z > (pTop.bottomA.z + 1e-08) ) splits.top = pTop;
    if ( pBottom.topA.z > (pBottom.bottomA.z + 1e-08) ) splits.bottom = pBottom;
    if ( pMiddle.topA.z > (pMiddle.bottomA.z + 1e-08) ) splits.middle = pMiddle;
    return splits;
  }

  /**
   * Helper method to test for splits and return only those needed for the particular
   * visibility setup.
   * @param {Token} target                    Token to test for intersecting walls
   * @param {PIXI.Polygon} viewableTriangle   Polygon triangle to test
   * @param {object} [options]                Options that affect the test.
   * @param {object[]} [options.edges]        Array of edges for the triangle, {A: Point, B: Point}.
    * @param {Point3d} [options.viewerLoc]    Coordinates of viewer
   * @param {}
   */
  _getVisibleSplits(target, viewableTriangle, { edges, viewerLoc } = {}) {
    // Triangle must be clockwise so we pass edges in the correct orientation to isWithin2dConvexPolygon.
    if ( !viewableTriangle.isClockwise ) {
      viewableTriangle.reverseOrientation();
      edges = [...viewableTriangle.iterateEdges()];
    } else edges ??= [...viewableTriangle.iterateEdges()];

    // If the shape intersects the target token, break shape into parts.
    const splits = this.splitAtTokenIntersections(target, { viewerLoc });
    if ( splits.full ) {
      return splits.full.isWithin2dConvexPolygon(viewableTriangle, { edges }) ? [splits.full] : [];
    }

    // Add only splits within the 2d triangle
    // Potentially blocks is faster, so test that first
    const targetPts = Point3d.fromToken(target);
    for ( const position of ["top", "bottom", "sideA", "sideB", "middle"] ) {
      if ( !splits[position] ) continue;
      if ( !splits[position].potentiallyBlocksToken(viewerLoc, target, targetPts)
        && !splits[position].isWithin2dConvexPolygon(viewableTriangle, { edges }) ) splits[position] = null;
    }

    return this._joinSplits(splits);
  }

  /**
   * Join splits from splitAtTokenIntersections when possible.
   * From splits, return an array of rectangles, combined when feasible.
   * @param {object} splits   Output from splitAtTokenIntersections
   * @returns {PIXI.Rectangle[]}
   */
  _joinSplits(splits) {
    if ( splits.full ) return [splits.full];
    const out = [];

    // Middle can be joined with top or bottom
    if ( splits.middle ) {
      const midPts = splits.middle?.points;
      if ( splits.top ) {
        midPts[0] = splits.top.topA;
        midPts[1] = splits.top.topB;
        splits.top = null;
      }
      if ( splits.bottom ) {
        midPts[2] = splits.bottom.bottomB;
        midPts[3] = splits.bottom.bottomA;
        splits.bottom = null;
      }

      // May be able to combine middle with sides
      // sideA topB and middle topA should match
      if ( splits.sideA
        && midPts[0].equals(splits.sideA.topB)
        && midPts[3].equals(splits.sideA.bottomB) ) {

        midPts[0] = splits.sideA.topA;
        midPts[3] = splits.sideA.bottomA;
        splits.sideA = null;
      }

      if ( splits.sideB
        && midPts[1].equals(splits.sideB.topA)
        && midPts[2].equals(splits.sideB.bottomA) ) {

        midPts[1] = splits.sideB.topB;
        midPts[2] = splits.sideB.bottomB;
        splits.sideB = null;
      }
      out.push(new this.constructor(splits.middle.object, midPts));
      splits.middle = null;
    }

    if ( splits.top ) out.push(splits.top);
    if ( splits.bottom ) out.push(splits.bottom);
    if ( splits.sideA ) out.push(splits.sideA);
    if ( splits.sideB ) out.push(splits.sideB);
    return out;
  }

  /**
   * Draw the shape on the 2d canvas
   */
  draw(drawingOptions = {}) {
    const drawTool = drawingOptions.drawTool ?? new Draw();
    const convert = CONFIG.GeometryLib.utils.pixelsToGridUnits;

    drawTool.segment({ A: this.topA, B: this.topB }, drawingOptions);
    drawTool.labelPoint(this.topA, `${convert(this.topA.z)}/${convert(this.bottomA.z)}`);
    drawTool.labelPoint(this.topB, `${convert(this.topB.z)}/${convert(this.bottomB.z)}`);
    this.points.forEach(pt => drawTool.point(pt, drawingOptions));
  }
}

