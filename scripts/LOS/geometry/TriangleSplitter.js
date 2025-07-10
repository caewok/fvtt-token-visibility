/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { BasicVertices } from "./BasicVertices.js";
import { Polygon3d, Triangle3d, Polygons3d } from "./Polygon3d.js";

/* Split triangles along vertical plane

For a given set of 3d triangle vertices representing a solid 3d object,
split along a vertical plane such that only triangles or triangle portions on a given side
of the plane are kept.

Used to calculate restrained and lit token shapes for complex token objects.

Basic algorithm:
Each 3d triangle that intersects the plane at more than an endpoint creates a line segment in that plane.
For each intersecting triangle:
- Define the intersection segment.
  - If no intersection or single ix point --> skip to next triangle.
- Test each triangle point against the plane for which to keep.
  - If segment === triangle edge && 3rd point removed, remove whole triangle; skip to next.
  - If segment === triangle edge && keep 3rd point, keep whole triangle.
  - If keep 1 point, create new triangle: segment + point.
  - If keep 2 points, create 2 new triangles: segment + point 1, segment + point 2.
  - Discard old triangle.
- Store the intersection segment.

For segments:
- Pick arbitrary segment A|B
- Locate all connecting segments that share (almost equal) to B.
  - If 2+ segments, split into 2 polygons
  - store A|B and test B|C; repeat until connected back to A.

- Triangulate each polygon. Can use fan or earcut based on reducing 3d polygon to 2d plane and then converting back.
*/

/**
 * @typedef {object} Segment3d
 * @prop {Point3d} a
 * @prop {Point3d} b
 */

export class TriangleSplitter {
  /** @type {Set<Segment3d>} */
  #unusedSegments = new Set();

  /** @type {Plane} */
  plane;

  /** @type {Triangle3d[]} */
  triangles = [];

  keepCW = true;

  /**
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @param {boolean} keepCW      Keep either all triangles clockwise (true) to a|b or counterclockwise (false)
   * @returns {TriangleSplitter}
   */
  constructor(plane, keepCW = true) {
    this.plane = plane;
    this.keepCW = keepCW;
  }

  /**
   * Create a vertical cutting plane along the a|b 2d overhead segment.
   */
  static from2dPoints(a, b, keepCW = true) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const a3 = new Point3d(a.x, a.y, 0);
    const b3 = new Point3d(b.x, b.y, 0);
    const c3 = new Point3d(a.x, a.y, 1);
    const plane = new CONFIG.GeometryLib.threeD.Plane.fromPoints(a3, b3, c3);
    return new this(plane, keepCW);
  }

  trianglesFromVerticesIndices(vertices, indices, { keepUVs = false, keepNormals = false} = {}) {
    // TODO: Track UVs and normals for triangles3d, polygons3d
    const vs = BasicVertices.trimNormalsAndUVs(vertices, { keepUVs, keepNormals });
    return Triangle3d.fromVertices(vs, indices);
  }

  splitFromTriangles3d(tris) {
    /*
    api = game.modules.get("tokenvisibility").api
    let { Polygon3d, Triangle3d } = api.geometry

    let { Point3d, Plane } = CONFIG.GeometryLib.threeD
    Draw = CONFIG.GeometryLib.Draw
    a = new PIXI.Point(-25, 50)
    b = new PIXI.Point(-50, -25)
    plane = Plane.fromPoints(new Point3d(a.x, a.y, 0), new Point3d(b.x, b.y, 0), new Point3d(a.x, a.y, 1))
    tris = [
      Triangle3d.from2dPoints([{ x: -50, y: -50 }, { x: -50, y: 50 }, { x: 50, y: 50 }], 100),
      Triangle3d.from2dPoints([{ x: -50, y: -50 }, { x: 50, y: 50 }, { x: 50, y: -50 }], 100),
    ]
  */
    this.#unusedSegments.clear();
    this.triangles.length = 0;
    for ( const tri of tris ) {
      const res = this._splitTriangle3d(tri);
      if ( !res ) continue;
      if ( res === true ) {
        this.triangles.push(tri);
        continue;
      }
      this.triangles.push(...res);

      // Capture the newly created edge.
      const { a, b } = this.triangles[0];
      this.#unusedSegments.add({ a, b });
    }

    // Build new triangles on the plane for each polygon formed from the captured segments.
    const polys = this._buildNewTriangles();
    this.triangles.push(...polys.polygons);
    return this.triangles;
  }


  /**
   * Create polygons from the segments on the plane.
   * Then subdivide using fan or earcut to triangles.
   * @returns {}
   */
  _buildNewTriangles() {
    // TODO: Improve speed by indexing the segment endpoints in some fashion.
    const tris = [];

    // Note: segments further in the queue that are deleted from the set will be skipped in the for loop.
    for ( const segment of this.#unusedSegments ) {
      const polySegments = this.constructor.buildPolygonFromSegments(segment, this.#unusedSegments);
      if ( polySegments ) {
        const nSegments = polySegments.length;
        const points = new Array(nSegments * 2);
        for ( let i = 0, j = 0; i < nSegments; i += 1 ) {
          const segment = polySegments[i];
          this.#unusedSegments.delete(segment);
          points[j++] = segment.a;
          points[j++] = segment.b;
        }
        const poly3d = new Polygon3d.from3dPoints(points);
        tris.push(...poly3d.triangulate());
      }
    }
    const out = new Polygons3d();
    out.polygons = tris;
    return out;
  }

  /**
   * For a given segment, try to build a closed polygon from a set or array of other segments.
   * @param {Segment} startSegment
   * @param {Set<Segment>|Segment[]} unusedSegments
   * @returns {Segment[]|null}
   */
  static buildPolygonFromSegments(startSegment, unusedSegments) {
    // From a set of segments, build a line from adjacent segments representing a polygon.
    // Stop when the polygon is closed.
    // To increase performance, test the nextSegment against both ends of the poly line.
    const polySegments = [startSegment];
    let endA = polySegments[0].a;
    let endB = polySegments.at(-1).b;
    for ( const nextSegment of unusedSegments ) {
      let used = -1; // -1: added at start, 0: not used, 1: added at end.
      let flip = false;
      if ( endB.almostEqual(nextSegment.a) ) used = 1;
      else if ( endB.almostEqual(nextSegment.b) ) { used = 1; flip = true; }
      else if ( endA.almostEqual(nextSegment.b) ) used = -1;
      else if ( endA.almostEqual(nextSegment.a) ) { used = -1; flip = true; }

      if ( flip ) this.constructor.flipSegment(nextSegment);
      if ( used ) {
        if ( ~used ) {
          polySegments.push(nextSegment);
          endB = nextSegment.b;
        } else {
          polySegments.unshift(nextSegment);
          endA = nextSegment.a;
        }
      }

      // If the end equals the beginning, we have a closed loop.
      if ( endA.almostEqual(endB) ) return polySegments;

      // TODO: What if the polygons share segments? Like a W where the plane crosses the middle point.
      // --> In that case, the triangles associated with the middle W should be kept or rejected whole; no segment formed.
      // So in theory, no shared segments as that would imply either the shape is malformed (crossed) or triangle incorrectly formed a segment.
    }
    return null;
  }

  _splitTriangle3d(tri) {
    let numIn = 0;
    const inEndpoints = [...tri].filter(pt => {
      const side = this.plane.whichSide(pt);
      const isIn = !side.almostEqual(0) && ((side > 0) ^ this.keepCW);
      numIn += isIn
      return isIn;
    });
    switch ( numIn ) {
      case 0: return false;
      case 3: return true;
    }
    const ixSegment = tri.intersectPlane(this.plane);
    if ( !ixSegment ) {
      console.error(`this.constructor.name|_splitTriangle3d|No intersecting segments found for tri`, tri);
      return false;
    }
    if ( ixSegment instanceof CONFIG.GeometryLib.Point3d ) return numIn > 1; // 1 point is on the plane.

    // TODO: Copy normal and update UVs.
    if ( numIn === 1 ) return [new Triangle3d.from3Points(ixSegment.a, ixSegment.b, inEndpoints[0])];
    return [
      new Triangle3d.from3Points(ixSegment.a, ixSegment.b, inEndpoints[0]),
      new Triangle3d.from3Points(ixSegment.a, ixSegment.b, inEndpoints[1]),
    ];
  }

  /**
   * Swap the a and b endpoints of the segment, in place.
   * @param {Segment} segment
   * @returns {Segment} Same segment, in place.
   */
  static flipSegment(segment) {
    const tmpX = segment.a.x;
    const tmpY = segment.a.y;
    const tmpZ = segment.a.z;
    segment.a.x = segment.b.x;
    segment.a.y = segment.b.y;
    segment.a.z = segment.b.z;
    segment.b.x = tmpX;
    segment.b.y = tmpY;
    segment.b.z = tmpZ;
    return segment;
  }
}
