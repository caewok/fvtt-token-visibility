/* globals
canvas,
ClipperLib,
CONFIG,
foundry,
PIXI,
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { orient3dFast } from "./util.js";

const lte = (x, b) => x < b || x.almostEqual(b);
const gte = (x, b) => x > b || x.almostEqual(b);

function isNearCollinear3d(a, b, c) {
  const Point3d = CONFIG.GeometryLib.threeD.Point3d;
  // Collinear if the normal is 0,0,0.
  const vAB = b.subtract(a, Point3d._tmp1);
  const vAC = c.subtract(a, Point3d._tmp2);
  const normal = vAB.cross(vAC, Point3d._tmp3);
  return normal.almostEqual({ x: 0, y: 0, z: 0 });
}

/*
3d Polygon representing a flat polygon plane.
Can be transformed in 3d space.
Can be clipped at a specific z value.

Points in a Polygon3d are assumed to not be modified in place after creation.
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

  // ----- NOTE: In-place modifiers ----- //

  /**
   * Clear the getter caches.
   */
  clearCache() {
    this.#bounds.x = undefined;
    this.#plane = undefined;
    this.#centroid = undefined;
  }

  /**
   * Test and remove collinear points. Modified in place; assumes no significant change to
   * cached properties from this.
   */
  clean() {
    // Drop collinear points.
    const iter = this.iteratePoints({ close: true });
    let a = iter.next().value;
    let b = iter.next().value;
    const newPoints = [a];
    for ( let c of iter ) {
      if ( !isNearCollinear3d(a, b, c) ) newPoints.push(b);
      a = b;
      b = c;
    }
    if ( newPoints.length < this.points.length ) {
      this.points.length = newPoints.length;
      this.points.forEach((pt, idx) => pt.copyFrom(newPoints[idx]));
    }
  }

  /**
   * Sets the z value in place. Clears the cached properties.
   */
  setZ(z = 0) { this.points.forEach(pt => pt.z = z); this.clearCache(); }

  /**
   * Reverse the orientation of this polygon. Done in place.
   */
  reverseOrientation() { this.points.reverse(); return this; }

  // ----- NOTE: Bounds ----- //

  /** @type {object<minMax>} */
  #bounds = {};

get bounds() {
  if ( !this.#bounds.x ) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    for (const pt of this.points) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
      minZ = Math.min(minZ, pt.z);
      maxZ = Math.max(maxZ, pt.z);
    }
    
    this.#bounds.x = { min: minX, max: maxX };
    this.#bounds.y = { min: minY, max: maxY };
    this.#bounds.z = { min: minZ, max: maxZ };
  }
  return this.#bounds;
}

  // ----- NOTE: Plane ----- //

  /** @type {Plane} */
  #plane;

  get plane() {
    if ( !this.#plane ) {
      // Assumes without testing that points are not collinear.
      const Plane = CONFIG.GeometryLib.threeD.Plane;
      this.#plane = Plane.fromPoints(this.points[0], this.points[1], this.points[2]);
    }
    return this.#plane;
  }

  // ----- NOTE: Centroid ----- //

  /** @type {Point3d} */
  #centroid;

  /**
   * Centroid (center point) of this polygon.
   * @type {Point3d}
   */
  get centroid() {
    if ( !this.#centroid ) {
      const Point3d = CONFIG.GeometryLib.threeD.Point3d;
      const plane = this.plane;

      // Convert to 2d polygon and calculate centroid.
      const M2d = plane.conversion2dMatrix;
      const poly2d = new PIXI.Polygon(this.points.map(pt3d => M2d.multiplyPoint3d(pt3d).to2d()));
      const ctr = poly2d.center;
      this.#centroid = plane.conversion2dMatrixInverse.multiplyPoint3d(Point3d._tmp.set(ctr.x, ctr.y, 0));
    }
    return this.#centroid;
  }

  /**
   * @param {Points3d} points
   * @returns {Points3d}
   */
  static convexHull(points) {
    // Assuming flat points, determine plane and then convert to 2d
    const Plane = CONFIG.GeometryLib.threeD.Plane;
    const plane = Plane.fromPoints(points[0], points[1], points[2]);
    const M2d = plane.conversion2dMatrix;
    const points2d = points.map(pt3d => M2d.multiplyPoint3d(pt3d));
    const convex2dPoints = convexHull(points2d);
    return convex2dPoints.map(pt => plane.conversion2dMatrixInverse.multiplyPoint3d(pt))
  }

  // ----- NOTE: Factory methods ----- //

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
    if ( poly.isHole ) out.isHole = true;
    poly.iteratePoints({ close: false }).forEach((pt, idx) => out.points[idx].set(pt.x, pt.y, elevation));
    return out;
  }

  static fromClipperPaths(cpObj, elevation = 0) {
    return cpObj.toPolygons().map(poly => this.fromPolygon(poly, elevation));
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

  /**
   * Make a copy of this polygon.
   * @returns {Polygon3d} A new polygon
   */
  clone() {
    const out = new this.constructor(this.points.length);
    out.isHole = this.isHole;
    this.points.forEach((pt, idx) => out.points[idx].copyFrom(pt));
    return out;
  }

  _cloneEmpty() {
    const out = new this.constructor(0);
    out.isHole = this.isHole;
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  /**
   * @param {"x"|"y"|"z"} omitAxis    Which of the three axes to omit to drop this to 2d.
   * @param {object} [opts]
   * @param {number} [opts.scalingFactor]   How to scale the clipper points
   * @returns {ClipperPaths}
   */
  toClipperPaths({ omitAxis = "z", scalingFactor = 1 } = {}) {
    const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;

    let points;
    if ( ClipperPaths === CONFIG.GeometryLib.Clipper2Paths ) {
      const Point64 = CONFIG.GeometryLib.Clipper2Paths.Clipper2.Point64;
      switch ( omitAxis ) {
        case "x": points = this.points.map(pt => new Point64(pt.to2d({x: "y", y: "z"}), scalingFactor)); break;
        case "y": points = this.points.map(pt => new Point64(pt.to2d({x: "x", y: "z"}), scalingFactor)); break;
        case "z": points = this.points.map(pt => new Point64(pt.to2d({x: "x", y: "y"}), scalingFactor)); break;
      }
    } else {
      const IntPoint = ClipperLib.IntPoint;
      switch ( omitAxis ) {
        case "x": points = this.points.map(pt => new IntPoint(pt.y * scalingFactor, pt.z * scalingFactor)); break;
        case "y": points = this.points.map(pt => new IntPoint(pt.x * scalingFactor, pt.z * scalingFactor)); break;
        case "z": points = this.points.map(pt => new IntPoint(pt.x * scalingFactor, pt.y * scalingFactor)); break;
      }
    }
    const out = new CONFIG[MODULE_ID].ClipperPaths([points], { scalingFactor });
    return out;
  }

  /**
   * Convert to 2d polygon, dropping z.
   * @returns {PIXI.Polygon}
   */
  to2dPolygon(omitAxis = "z") {
    if ( omitAxis === "z" ) return new PIXI.Polygon(this.points); // PIXI.Polygon ignores "z" attribute.

    const n = this.points.length;
    const points = Array(n * 2);
    const [x, y] = omitAxis === "x" ? ["y", "z"] : ["x", "z"];
    for ( let i = 0; i < n; i += 1 ) {
      const pt = this.points[i];
      points[i * 2] = pt[x];
      points[i * 2 + 1] = pt[y];
    }
    return new PIXI.Polygon(points);
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

  // ----- NOTE: Iterators ----- //

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

//   forEach(callback) {
//     for ( let i = 0, iMax = this.points.length; i < iMax; i += 1 ) callback(this.points[i], i, this);
//   }

  // ----- NOTE: Property tests ----- //

  /** @type {boolean} */
  isHole = false;

  /**
   * Does this polygon face a given point?
   * Defined as counter-clockwise.
   * @param {Point3d} p
   * @returns {boolean}
   */
  isFacing(p) { return orient3dFast(this.points[0], this.points[1], this.points[2], p) > 0; }

  // ----- NOTE: Transformations ----- //

  /**
   * Transform the points using a transformation matrix.
   * @param {Matrix} M
   * @param {Polygon3d} [poly]    The triangle to modify
   * @returns {Polygon3d} The modified tri.
   */
  transform(M, poly3d) {
    poly3d ??= this.clone();
    poly3d.points.forEach((pt, idx) => M.multiplyPoint3d(this.points[idx], pt));
    return poly3d;
  }

  multiplyScalar(multiplier, poly3d) {
    poly3d ??= this.clone();
    poly3d.points.forEach(pt => pt.multiplyScalar(multiplier, pt));
    return poly3d;
  }

  scale({ x = 1, y = 1, z = 1} = {}, poly3d) {
    poly3d ??= this.clone();
    const scalePt = CONFIG.GeometryLib.threeD.Point3d._tmp1.set(x, y, z);
    poly3d.points.forEach(pt => pt.multiply(scalePt, pt));
    return poly3d;
  }

  divideByZ(poly3d) {
    poly3d ??= this.clone();
    poly3d.points.forEach(pt => {
      const zInv = 1 / pt.z;
      pt.x *= zInv;
      pt.y *= zInv;
      pt.z = 1;
    });
    return poly3d;
  }

  // ----- NOTE: Intersection ----- //

  /**
   * Test if a ray intersects the polygon. Does not consider whether this polygon is facing.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {Point3d|null}
   */
  intersection(rayOrigin, rayDirection) {
    // First get the plane intersection.
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const plane = this.plane;
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
      if ( cmp(A) ) toKeep.push(A.clone());
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
    const out = this._cloneEmpty();
    out.points = toKeep;
    return out;
  }

  /* ----- NOTE: Debug ----- */

  draw2d({ draw, omitAxis = "z", ...opts } = {}) {
    draw ??= new CONFIG.GeometryLib.Draw;
    draw.shape(this.to2dPolygon(omitAxis), opts);
  }
}

function pointFromVertices(i, vertices, indices, outPoint) {
  outPoint ??= new CONFIG.GeometryLib.threeD.Point3d;
  const idx = indices[i];
  const v = vertices.slice(idx * 3, (idx * 3) + 3);
  outPoint.set(v[0], v[1], v[2]);
  return outPoint;
}


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

  // ----- NOTE: Factory methods ----- //

  static from3Points(a, b, c) {
    const tri = new this();
    tri.a.copyFrom(a);
    tri.b.copyFrom(b);
    tri.c.copyFrom(c);
    return tri;
  }

  static fromPartial3Points(a, b, c) {
    const tri = new this();
    tri.a.copyPartial(a);
    tri.b.copyPartial(b);
    tri.c.copyPartial(c);
    return tri;
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
      tris[j] = this.from3Points(a, b, c);
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

  // ----- NOTE: Intersection ----- //

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
    const nPoints = toKeep.length;
    const out = nPoints === 3 ? (new this.constructor()) : (new Polygon3d(nPoints));
    out.isHole = this.isHole;
    out.points.forEach((pt, idx) => pt.copyFrom(toKeep[idx]));
    return out;
  }
}

/**
 * Represent 1+ polygons that represent a shape.
 * Each can be a Polygon3d that is either a hole or outer (not hole). See Clipper Paths.
 * An outer polygon may be contained within a hole. Parent-child structure not maintained.
 */
export class Polygons3d extends Polygon3d {
  /** @type {Polygon3d[]} */
  polygons = [];

  // TODO: Determine the convex hull of the polygons to determine the points of this polygon?
  constructor(n = 0) {
    super(0);
    this.polygons.length = n;
  }

  #applyMethodToAll(method, ...args) { this.polygons.forEach(poly => poly[method](...args)); }

  #applyMethodToAllWithReturn(method, ...args) { return this.polygons.map(poly => poly[method](...args)); }

  #applyMethodToAllWithClone(method, poly3d, ...args) {
    poly3d ??= this.clone();
    poly3d.polygons.forEach(poly => poly[method](...args, poly));
    return poly3d;
  }

  static #createSingleUsingMethod(method, ...args) {
    const out = new this(1);
    out.polygons[0] = Polygon3d[method](...args);
    return out;
  }

  // ----- NOTE: In-place modifiers ----- //

  /**
   * Clear the getter caches.
   */
  clearCache() {
    this.#applyMethodToAll("clearCache");
    this.#bounds.x = undefined;
    this.#centroid = undefined;
    // No #plane for Polygons3d.
  }

  clean() { this.#applyMethodToAll("clean"); }

  setZ(z) { this.#applyMethodToAll("setZ", z); }

  reverseOrientation() { this.#applyMethodToAll("reverseOrientation"); return this; }

  // ----- NOTE: Bounds ----- //

  /** @type {object<minMax>} */
  #bounds = {};

  get bounds() {
    const b = this.#bounds;
    if ( !b.x ) {
      const allBounds = this.applyMethodToAllWithReturn("bounds");
      allBounds.reduce((acc, curr) => {
        b.x = Math.minMax(acc.x.min, acc.x.max, curr.x.min, curr.x.max);
        b.y = Math.minMax(acc.y.min, acc.y.max, curr.y.min, curr.x.max);
        b.z = Math.minMax(acc.z.min, acc.z.max, curr.z.min, curr.x.max);
        return b;
      });
    }
    return b;
  }

  // ----- NOTE: Plane ----- //

  /** @type {Plane} */
  get plane() { return this.polygons[0].plane; }

  // ----- NOTE: Centroid ----- //

  /** @type {Point3d} */
  #centroid;

  centroid() {
    if ( !this.centroid ) {
      // Assuming flat points, determine plane and then convert to 2d
      const plane = this.plane;
      const points = this.polygons.flatMap(poly => poly.points);
      const M2d = plane.conversion2dMatrix;
      const points2d = points.map(pt3d => M2d.multiplyPoint3d(pt3d));
      const convex2dPoints = convexHull(points2d);

      // Determine the centroid of the 2d convex polygon.
      const convexPoly2d = new PIXI.Polygon(convex2dPoints);
      this.#centroid = convexPoly2d.center;
    }
    return this.#centroid;
  }

  // ----- NOTE: Factory methods ----- //

  static from3dPolygons(polys) {
    const n = polys.length;
    const polys3d = new this(n);
    for ( let i = 0; i < n; i += 1 ) polys3d.polygons[i] = polys[i];
    return polys3d;
  }

  static fromPoints(pts) { return this.#createSingleUsingMethod("fromPoints", pts); }

  static from2dPoints(pts, elevation) { return this.#createSingleUsingMethod("from2dPoints", pts, elevation); }

  static from3dPoints(pts) { return this.#createSingleUsingMethod("from3dPoints", pts); }

  static fromPolygon(poly, elevation) { return this.#createSingleUsingMethod("fromPolygon", poly, elevation); }

  static fromPolygons(polys, elevation) {
    const out = new this();
    out.polygons = polys.map(poly => Polygon3d.fromPolygon(poly, elevation));
    return out;
  }

  static fromClipperPaths(cpObj, elevation) {
    const out = new this();
    out.polygons = Polygon3d.fromClipperPaths(cpObj, elevation);
    return out;
  }

  static fromVertices(vertices, indices) { this.#createSingleUsingMethod("fromVertices", vertices, indices); }

  clone() {
    const out = new this.constructor(0);
    out.polygons = this.polygons.map(poly => poly.clone());
    return out;
  }

  // ----- NOTE: Conversions to ----- //

  /**
   * @param {"x"|"y"|"z"} omitAxis    Which of the three axes to omit to drop this to 2d.
   * @param {object} [opts]
   * @param {number} [opts.scalingFactor]   How to scale the clipper points
   * @returns {ClipperPaths}
   */
  toClipperPaths(opts) {
    const cpObjArr = this.#applyMethodToAllWithReturn("toClipperPaths", opts);
    return CONFIG[MODULE_ID].ClipperPaths.joinPaths(cpObjArr);
  }

  to2dPolygon(omitAxis) { return this.#applyMethodToAllWithReturn("to2dPolygon", omitAxis); }

  toPerspectivePolygon() { return this.#applyMethodToAllWithReturn("toPerspectivePolygon"); }

  // ----- NOTE: Iterators ----- //

  /**
   * Iterator: a, b, c.
   */
  [Symbol.iterator]() {
    const n = this.polygons.length;
    const data = this;
    let index = 0;
    return {
      next() {
        if ( index < n ) return {
          value: data.polygons[index++],
          done: false };
        else return { done: true };
      }
    };
  }

  forEach(callback, thisArg) {
    this.polygons.forEach(callback, thisArg);
  }

  // ----- NOTE: Property tests ----- //

  isFacing(p) {
    const poly = this.polygons[0];
    return poly.isFacing(p) ^ poly.isHole; // Holes have reverse orientation.
  }

  // ----- NOTE: Transformations ----- //

  transform(M, poly3d) { return this.#applyMethodToAllWithClone("transform", poly3d, M); }

  multiplyScalar(multiplier, poly3d) { return this.#applyMethodToAllWithClone("multiplyScalar", poly3d, multiplier); }

  scale(opts, poly3d) { return this.#applyMethodToAllWithClone("scale", poly3d, opts); }

  divideByZ(poly3d) { return this.#applyMethodToAllWithClone("divideByZ", poly3d); }

  // ----- NOTE: Intersection ----- //

  /**
   * Test if a ray intersects the polygon. Does not consider whether this polygon is facing.
   * Ignores holes. If 2+ polygons overlap, it will count as an intersection if it intersects
   * more outer than holes.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {Point3d|null}
   */
  intersection(rayOrigin, rayDirection) {
    let ixNum = 0;
    let ix;
    for ( const poly of this.polygons ) {
      const polyIx = poly.intersection(rayOrigin, rayDirection);
      if ( polyIx ) {
        ix = polyIx;
        ixNum += (poly.isHole ? -1 : 1);
      }
    }
    return ixNum > 0 ? ix : null;
  }

  clipPlanePoints(...args) { this.#applyMethodToAllWithReturn("clipPlanePoints", ...args); }

  clipZ(...args) {
    const out = this._cloneEmpty();
    out.polygons = this.#applyMethodToAllWithReturn("clipZ", ...args);
    return out;
  }

  /* ----- NOTE: Debug ----- */

  draw2d(opts = {}) {
    const color = opts.color;
    const fill = opts.fill;
    const draw = opts.draw?.g || canvas.controls.debug;

    // Sort so holes are last.
    this.polygons.sort((a, b) => a.isHole - b.isHole);
    for ( const poly of this.polygons ) {
      if ( poly.isHole ) {
        if ( !opts.holeColor ) draw.beginHole(); // If holeColor, don't treat as hole
        opts.color = opts.holeColor || opts.color;
        opts.fill = opts.holeFill || opts.fill;
      }
      poly.draw2d(opts);
      if ( poly.isHole ) {
        if ( !opts.holeColor ) draw.endHole();
        opts.color = color;
        opts.fill = fill;
      }
    }
  }
}


/*
(a.y - c.y) * (b.x - c.x) -  (a.x - c.x) * (b.y - c.y)
(p.y - r.y) * (q.x - r.x) >= (p.x - r.x) * (q.y - r.y)

orient2dFast(a, b, c) > 0 === (a.y - c.y) * (b.x - c.x) >=  (a.x - c.x) * (b.y - c.y)
orient2dFast(p, q, r) > 0
*/

/**
 * Comparison function used by convex hull function.
 * @param {Point} a
 * @param {Point} b
 * @returns {boolean}
 */
function convexHullCmpFn(a, b) {
  const dx = a.x - b.x;
  return dx ? dx : a.y - b.y;
}

/**
 * Test the point against existing hull points.
 * @parma {PIXI.Point[]} hull
 * @param {PIXI.Point} point
*/
function testHullPoint(hull, p) {
  const orient2d = foundry.utils.orient2dFast;
  while ( hull.length >= 2 ) {
    const q = hull[hull.length - 1];
    const r = hull[hull.length - 2];
    if ( orient2d(p, q, r) >= 0 ) hull.pop();
    else break;
  }
  hull.push(p);
}

function convexHull(points) {
  const ln = points.length;
  if ( ln <= 1 ) return points;

  const newPoints = [...points];
  newPoints.sort(convexHullCmpFn);

  // Andrew's monotone chain algorithm.
  const upperHull = [];
  for ( let i = 0; i < ln; i += 1 ) testHullPoint(upperHull, newPoints[i]);
  upperHull.pop();

  const lowerHull = [];
  for ( let i = ln - 1; i >= 0; i -= 1 ) testHullPoint(lowerHull, newPoints[i]);
  lowerHull.pop();

  if ( upperHull.length === 1
    && lowerHull.length === 1
    && upperHull[0].x === lowerHull[0].x
    && upperHull[0].y === lowerHull[0].y ) return upperHull;

  return upperHull.concat(lowerHull);
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

Polygon3d.convexHull(poly3d.points)
Polygon3d.convexHull2(poly3d.points)

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


Polygons3d = game.modules.get("tokenvisibility").api.triangles.Polygons3d

poly = new PIXI.Polygon(
  100, 100,
  100, 500,
  500, 500,
)

hole = new PIXI.Polygon(
  150, 200,
  200, 400,
  300, 400,
)
hole.isHole = true;

polys3d = Polygons3d.fromPolygons([poly, hole])
polys3d.draw2d({ color: Draw.COLORS.blue, holeColor: Draw.COLORS.red })
polys3d.draw2d({ color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.5 })

rayOrigin = new Point3d(200, 300, 50)
rayDirection = new Point3d(0, 0, -1)
ix = polys3d.intersection(rayOrigin, rayDirection)

rayOrigin = new Point3d(150, 450, 50)
rayDirection = new Point3d(0, 0, -1)
ix = polys3d.intersection(rayOrigin, rayDirection)


points = [
  new Point3d(0, 0, 0),
  new Point3d(100, 0, 100),
  new Point3d(0, 100, 0),
  new Point3d(50, 50, 50),
  new Point3d(200, 20, 200),
  new Point3d(300, 50, 300),
  new Point3d(300, 300, 300),
  new Point3d(250, 75, 250),
  new Point3d(0, 75, 0),
  new Point3d(50, 250, 50),
  new Point3d(25, 210, 25),
  new Point3d(150, 150, 150),
  new Point3d(150, 200, 150),
]
points.forEach(pt => Draw.point(pt))

ptsC = Polygon3d.convexHull(points)
ptsC2 = Polygon3d.convexHull2(points)

polyC = Polygon3d.from3dPoints(ptsC)
polyC2 = Polygon3d.from3dPoints(ptsC2)
polyC.draw2d({ color: Draw.COLORS.blue })
polyC2.draw2d({ color: Draw.COLORS.green })

b = polyC2.bounds
boundsRect = new PIXI.Rectangle(b.x.min, b.y.min, b.x.max - b.x.min, b.y.max - b.y.min)



*/
