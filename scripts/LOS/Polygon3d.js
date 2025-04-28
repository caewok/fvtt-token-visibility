/* globals
CONFIG,
PIXI,
*/
"use strict";

import { orient3dFast } from "./util.js";

const lte = (x, b) => x < b || x.almostEqual(b);
const gte = (x, b) => x > b || x.almostEqual(b);

/*
3d Polygon representing a flat polygon plane.
Can be transformed in 3d space.
Can be clipped at a specific z value.
*/
export class Polygon3d {

  // TODO: Cache bounds and plane. Use setter to modify points to reset cache?
  //       Or just only allow points set once?
  //       Could have set points(pts) and set them all at once.
  //       Difficult b/c of transform and scale, along with the fact that each point can be
  //       modified in place.

  /** @type {Point3d} */
  points = [];

  constructor(n = 0) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    this.points.length = n;
    for ( let i = 0; i < n; i += 1 ) this.points[i] = new Point3d();
  }

  setZ(z = 0) { this.points.forEach(pt => pt.z = z); }

  get bounds() {
    const n = this.points.length;
    const xs = Array(n);
    const ys = Array(n);
    const zs = Array(n);
    for ( let i = 0; i < n; i += 1 ) {
      const pt = this.points[i];
      xs[i] = pt.x;
      ys[i] = pt.y;
      zs[i] = pt.z;
    }
    return {
      x: Math.minMax(...xs),
      y: Math.minMax(...ys),
      z: Math.minMax(...zs),
    };
  }

  static fromPoints(pts) {
    const n = pts.length;
    const poly3d = new this(n);
    for ( let i = 0; i < n; i += 1 ) poly3d.points[i].copyPartial(pts[i]);
    return poly3d;
  }

  static from2dPoints(pts, elevation = 0) {
    const n = pts.length;
    const poly3d = new this(n);
    for ( let i = 0; i < n; i += 1 ) {
      const { x, y } = pts[i];
      poly3d.points[i].set(x, y, elevation);
    }
    return poly3d;
  }

  static from3dPoints(pts) {
    const n = pts.length;
    const poly3d = new this(n);
    for ( let i = 0; i < n; i += 1 ) poly3d.points[i].copyFrom(pts[i]);
    return poly3d;
  }

  static fromPolygon(poly, elevation = 0) {
    const out = new this(poly.points.length * 0.5);
    poly.iteratePoints({ close: false }).forEach((pt, idx) => out.points[idx].set(pt.x, pt.y, elevation));
    return out;
  }

  static fromClipperPaths(cpObj, elevation = 0) {
    return cpObj.paths.map(path => {
      const n = path.length;
      const invScale = 1 / cpObj.scalingFactor;
      const poly3d = new this(n);
      poly3d.forEach((pt, idx) => pt.set(path[idx].X * invScale, path[idx].Y * invScale, elevation));
      return poly3d;
    });
  }

  /**
   * Iterate over the polygon's edges in order.
   * If the polygon is closed, the last two points will be ignored.
   * (Use close = true to return the last --> first edge.)
   * @param {object} [options]
   * @param {boolean} [close]   If true, return last point --> first point as edge.
   * @returns { A: Point3d, B: Point3d } for each edge
   * Edges link, such that edge0.B === edge.1.A.
   */
  *iterateEdges({close = true} = {}) {
    const n = this.points.length;
    if ( n < 2 ) return;

    const firstA = this.points[0];
    let A = firstA;
    for ( let i = 1; i < n; i += 1 ) {
      const B = this.points[i];
      yield { A, B };
      A = B;
    }

    if ( close ) {
      const B = firstA;
      yield { A, B };
    }
  }

  /**
   * Iterate over the polygon's {x, y} points in order.
   * @param {object} [options]
   * @param {boolean} [options.close]   If close, include the first point again.
   * @returns {Point3d}
   */
  *iteratePoints({ close = true } = {}) {
    const n = this.points.length;
    for ( let i = 0; i < n; i += 1 ) yield this.points[i];
    if ( close ) yield this.points[0];
  }

  /**
   * Convert to 2d polygon, dropping z.
   * @returns {PIXI.Polygon}
   */
  to2dPolygon(omitAxis = "z") {
    switch ( omitAxis ) {
      case "x": return new PIXI.Polygon(this.points.flatMap(pt => [pt.y, pt.z]));
      case "y": return new PIXI.Polygon(this.points.flatMap(pt => [pt.x, pt.z]));
      case "z": return new PIXI.Polygon(this.points); // PIXI.Polygon ignores "z" attribute.
    }
  }

  /**
   * Convert to 2d polygon by perspective transform, dividing each point by z.
   * @returns {PIXI.Polygon}
   */
  toPerspectivePolygon() {
    return new PIXI.Polygon(this.points.flatMap(pt => {
      const invZ = 1 / pt.z;
      return [pt.x * invZ, pt.y * invZ];
    }));
  }

  /**
   * Iterator: a, b, c.
   */
  [Symbol.iterator]() {
    const n = this.points.length;
    const data = this;
    let index = 0;
    return {
      next() {
        if ( index < n ) return {
          value: data.points[index++],
          done: false };
        else return { done: true };
      }
    };
  }

  forEach(callback) {
    for ( let i = 0, iMax = this.points.length; i < iMax; i += 1 ) callback(this.points[i], i, this);
  }

  /**
   * Does this polygon face a given point?
   * Defined as counter-clockwise.
   * @param {Point3d} p
   * @returns {boolean}
   */
  isFacing(p) { return orient3dFast(this.points[0], this.points[1], this.points[2], p) > 0; }

  /**
   * Reverse the orientation of this polygon
   */
  reverseOrientation() { this.points.reverse(); }

  /**
   * Make a copy of this polygon.
   * @returns {Polygon3d} A new polygon
   */
  clone() {
    const out = new this.constructor(this.points.length);
    this.points.forEach((pt, idx) => out.points[idx].copyFrom(pt));
    return out;
  }

  /**
   * Transform the points using a transformation matrix.
   * @param {Matrix} M
   * @param {Polygon3d} [poly]    The triangle to modify
   * @returns {Polygon3d} The modified tri.
   */
  transform(M, poly3d) {
    poly3d ??= this.clone();
    poly3d.forEach((pt, idx) => M.multiplyPoint3d(this.points[idx], pt));
    return poly3d;
  }

  scale(multiplier, poly3d) {
    poly3d ??= this.clone();
    poly3d.points.forEach(pt => pt.multiplyScalar(multiplier, pt));
    return poly3d;
  }


  /**
   * Test if a ray intersects the polygon. Does not consider whether this polygon is facing.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {Point3d|null}
   */
  intersection(rayOrigin, rayDirection) {
    // First get the plane intersection.
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const Plane = CONFIG.GeometryLib.threeD.Plane;
    const plane = Plane.fromPoints(this.points[0], this.points[1], this.points[2]);
    const t = plane.rayIntersection(rayOrigin, rayDirection);
    if ( t == null || t < 0 ) return null;
    if ( t.almostEqual(0) ) return rayOrigin;

    // Then test 3d bounds.
    const ix = Point3d._tmp;
    rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix)
    const bounds = this.bounds;
    if ( !lte(ix.x, bounds.x.max)
      || !gte(ix.x, bounds.x.min)
      || !lte(ix.y, bounds.y.max)
      || !gte(ix.y, bounds.y.min)
      || !lte(ix.z, bounds.z.max)
      || !gte(ix.z, bounds.z.min) ) return null;

    // Then convert to 2d polygon and test if contained.
    const M2d = plane.conversion2dMatrix;
    const poly2d = new PIXI.Polygon(this.points.map(pt3d => M2d.multiplyPoint3d(pt3d).to2d()));
    const ix2d = M2d.multiplyPoint3d(ix).to2d();
    return poly2d.contains(ix2d.x, ix2d.y) ? ix : null;
  }

  /**
   * Truncate a set of points representing a plane shape to keep only the points
   * compared to a given coordinate value. It is assumed that the shape can be closed by
   * getting lastPoint --> firstPoint.
   * @param {PIXI.Point[]|Point3d[]} points   Array of points representing a polygon
   * @param {object} [opts]
   * @param {number} [opts.cutoff=0]          Value to use in the comparator
   * @param {string} [opts.coordinate="z"]    Index to use in the comparator
   * @param {"lessThan"
            |"greaterThan"
            |"lessThanEqual"
            |"greaterThanEqual"} [opts.cmp="lessThan" ]    How to test the cutoff (what to keep)
   * @returns {PIXI.Point[]|Point3d[]} The new set of points as needed, or original points
   *   May return more points than provided (i.e, triangle clipped so it becomes a quad)
   */
  clipPlanePoints({ cutoff = 0, coordinate = "z", cmp = "lessThan" } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    switch ( cmp ) {
      case "lessThanEqual": cmp = pt => pt[coordinate] <= cutoff; break;
      case "greaterThan": cmp = pt => pt[coordinate] > cutoff; break;
      case "greaterThanEqual": cmp = pt => pt[coordinate] >= cutoff; break;
      default: cmp = pt => pt[coordinate] < cutoff;
    }

    // Walk along the polygon edges. If the z value of the point passes, keep it.
    // If the edge crosses the z line, add a new point at the crossing point.
    // Discard all points that don't meet it.
    const toKeep = [];
    for ( const edge of this.iterateEdges({ close: true }) ) {
      const { A, B } = edge;
      if ( cmp(A) ) toKeep.push(A);
      if ( cmp(A) ^ cmp(B) ) {
        const newPt = new Point3d();
        const res = A.projectToAxisValue(B, cutoff, coordinate, newPt);
        if ( res && !(newPt.almostEqual(A) || newPt.almostEqual(B)) ) toKeep.push(newPt);
      }
    }
    return toKeep;
  }

  /**
   * Clip this polygon in the z direction.
   * @param {number} z
   * @param {boolean} [keepLessThan=true]
   * @returns {Polygon3d}
   */
  clipZ({ z = -0.1, keepLessThan = true } = {}) {
    const toKeep = this.clipPlanePoints({
      cutoff: z,
      coordinate: "z",
      cmp: keepLessThan ? "lessThan" : "greaterThan"
    });
    const out = new this.constructor(0);
    out.points = toKeep;
    return out;
  }

  /**
   * Create a polygon from given indices and vertices
   * @param {Number[]} vertices     Array of vertices, 3 coordinates per vertex
   * @param {Number[]} [indices]    Indices to determine order in which polygon points are created from vertices
   * @returns {Triangle[]}
   */
  static fromVertices(vertices, indices) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const n = indices.length;
    if ( vertices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of vertices is not divisible by 3: ${vertices.length}`);
    indices ??= Array.fromRange(Math.floor(vertices.length / 3));
    if ( n % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of indices is not divisible by 3: ${indices.length}`);
    const poly3d = new this(n);
    for ( let i = 0, j = 0, jMax = n; j < jMax; j += 1 ) {
      poly3d.points[j].copyFrom(pointFromVertices(i++, vertices, indices, Point3d._tmp1));
    }
    return poly3d;
  }

  /* ----- NOTE: Debug ----- */

  draw2d({ omitAxis = "z", ...opts } = {}) {
    CONFIG.GeometryLib.Draw.shape(this.to2dPolygon(omitAxis), opts);
  }
}

function pointFromVertices(i, vertices, indices, outPoint) {
  outPoint ??= new CONFIG.GeometryLib.threeD.Point3d;
  const idx = indices[i];
  const v = vertices.slice(idx * 3, (idx * 3) + 3);
  outPoint.set(v[0], v[1], v[2]);
  return outPoint;
}

/* Testing
Draw = CONFIG.GeometryLib.Draw
Polygon3d = game.modules.get("tokenvisibility").api.triangles.Polygon3d
Point3d = CONFIG.GeometryLib.threeD.Point3d

poly = new PIXI.Polygon(
  100, 100,
  100, 500,
  500, 500,
)

poly3d = Polygon3d.fromPolygon(poly, 20)
poly3d.forEach((pt, idx) => console.log(`${idx} ${pt}`))

rayOrigin = new Point3d(200, 300, 50)
rayDirection = new Point3d(0, 0, -1)
ix = poly3d.intersection(rayOrigin, rayDirection)

rayDirection = new Point3d(0, 0, 1)
poly3d.intersection(rayOrigin, rayDirection)

poly3d = Polygon3d.from3dPoints([
  new Point3d(0, 100, -100),
  new Point3d(0, 100, 500),
  new Point3d(0, 500, 500)
])

clipped = poly3d.clipZ()
clipped2 = poly3d.clipZ({ keepLessThan: false })

poly3d.draw2d({ omitAxis: "x" })
clipped.draw2d({ omitAxis: "x", color: Draw.COLORS.red })
clipped2.draw2d({ omitAxis: "x", color: Draw.COLORS.blue })

*/


/**
 * Basic triangle shape in 3d.
 */
export class Triangle3d extends Polygon3d {

  constructor() {
    super(3);
  }

  /** @type {Point3d} */
  get a() { return this.points[0]; }

  /** @type {Point3d} */
  get b() { return this.points[1]; }

  /** @type {Point3d} */
  get c() { return this.points[2]; }


  static fromPoints(a, b, c) {
    const tri = new this();
    tri.a.copyFrom(a);
    tri.b.copyFrom(b);
    tri.c.copyFrom(c);
    return tri;
  }

  static fromPartialPoints(a, b, c) {
    const tri = new this();
    tri.a.copyPartial(a);
    tri.b.copyPartial(b);
    tri.c.copyPartial(c);
    return tri;
  }

  /**
   * Test if a ray intersects the triangle. Does not consider whether this triangle is facing.
   * Möller-Trumbore intersection algorithm for a triangle.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {t|null}
   */
  intersection(rayOrigin, rayDirection) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const { a, b, c } = this;

    // Calculate the edge vectors of the triangle
    // Not really worth caching these values, as it would require updating them if a,b,c change.
    const edge1 = b.subtract(a, Point3d._tmp1);
    const edge2 = c.subtract(a, Point3d._tmp2);

    // Calculate the determinant of the triangle
    const pvec = rayDirection.cross(edge2, Point3d._tmp3);

    // If the determinant is near zero, ray lies in plane of triangle
    const det = edge1.dot(pvec);
    if (det > -Number.EPSILON && det < Number.EPSILON) return null;  // Ray is parallel to triangle
    const invDet = 1 / det;

    // Calculate the intersection point using barycentric coordinates
    const tvec = rayOrigin.subtract(a, Point3d._tmp);
    const u = invDet * tvec.dot(pvec);
    if (u < 0 || u > 1) return null;  // Intersection point is outside of triangle

    const qvec = tvec.cross(edge1, Point3d._tmp3); // The tmp value cannot be tvec or edge1.
    const v = invDet * rayDirection.dot(qvec);
    if (v < 0 || u + v > 1) return null;  // Intersection point is outside of triangle

    // Calculate the distance to the intersection point
    const t = invDet * edge2.dot(qvec);
    if ( t <= Number.EPSILON ) return null;

    const tile = this.tile;
    if ( !tile || !tile.mesh ) return t;

    // Test tile transparency.
    // TODO: Do we need to check if t is in range?
    const ix = Point3d._tmp3;
    rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix);
    if ( !tile.mesh.containsCanvasPoint(ix) ) return null; // Transparent, so no collision.
    return t;
  }

  /**
   * Clip this polygon in the z direction.
   * @param {number} z
   * @param {boolean} [keepLessThan=true]
   * @returns {Polygon3d}
   */
  clipZ({ z = -0.1, keepLessThan = true } = {}) {
    const toKeep = this.clipPlanePoints({
      cutoff: z,
      coordinate: "z",
      cmp: keepLessThan ? "lessThan" : "greaterThan"
    });
    const out = toKeep.length === 3 ? (new this.constructor()) : (new Polygon3d(0));
    out.points.forEach((pt, idx) => pt.copyFrom(toKeep[idx]));
    return out;
  }


  /**
   * Create an array of triangles from given indices and vertices.
   * @param {Number[]} vertices     Array of vertices, 3 coordinates per vertex, 3 vertices per triangle
   * @param {Number[]} [indices]    Indices to determine order in which triangles are created from vertices
   * @returns {Triangle[]}
   */
  static fromVertices(vertices, indices) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    if ( vertices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of vertices is not divisible by 3: ${vertices.length}`);
    indices ??= Array.fromRange(Math.floor(vertices.length / 3));
    if ( indices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of indices is not divisible by 3: ${indices.length}`);
    const tris = new Array(Math.floor(indices.length / 3));
    for ( let i = 0, j = 0, jMax = tris.length; j < jMax; j += 1 ) {
      const a = pointFromVertices(i++, vertices, indices, Point3d._tmp1);
      const b = pointFromVertices(i++, vertices, indices, Point3d._tmp2);
      const c = pointFromVertices(i++, vertices, indices, Point3d._tmp3);
      tris[j] = this.fromPoints(a, b, c);
    }
    return tris;
  }

  /**
   * Create an array of triangles from given array of point 3ds and indices.
   * @param {Number[]} points       Point3ds
   * @param {Number[]} [indices]    Indices to determine order in which triangles are created from vertices
   */
  static fromPoint3d(points, indices) {
    const vertices = new Array(points.length * 3);
    for ( let i = 0, j = 0, iMax = points.length; i < iMax; i += 1 ) {
      const pt = points[i];
      vertices[j++] = pt.x;
      vertices[j++] = pt.y;
      vertices[j++] = pt.z;
    }
    return this.fromVertices(vertices, indices);
  }
}

