/* globals
CONFIG,
CONST,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID, MODULES_ACTIVE } from "../const.js";
import { Draw } from "../geometry/Draw.js";

/**
 * @typedef {object} AABB
 * @property {Point3d} min
 * @property {Point3d} max
 */

/**
 * Store blocking objects that can be tested for collisions.
 * All objects must define an aabb bounds in 3 dimensions.
 * All objects must define hasBoundsIntersection and hasObjectIntersection.
 */
class AbstractBlockingObject {

  /** @type {*} */
  object; // Represented object.

  constructor(object) {
    this.object = object;
  }

  // ---- NOTE: Property getters ----- //

  /** @type {string} */
  get id() { return this.object.id; }

  // ----- NOTE: Simple getter calculations ----- //

  /**
   * @type {AABB} */
  #aabb = {
    min: new CONFIG.GeometryLib.threeD.Point3d(),
    max: new CONFIG.GeometryLib.threeD.Point3d()
  }

  /** @override */
  get aabb() { return this.#aabb; }

  // ----- NOTE: Collisions ----- //

  /**
   * Intersect the edge representing a vertical wall.
   * @param {Ray3d} ray
   * @returns {bool}
   */
  hasBoundsIntersection(ray) {
    const aabb = this.aabb;
    return ray.intersectsAABB(aabb.min, aabb.max);
  }

  /**
   * Test for represented object intersection.
   * @param {Ray3d} ray             Ray to test
   * @param {object} [opts = {}]    Options object
   * @returns {boolean}
   * @override
   */
  hasObjectIntersection(ray, _opts = {}) { return true; }

  // ----- NOTE: Debugging ----- //

  /** @type {Point3d} */
  get centroid() {
    const { min, max } = this.aabb;
    return min.add(max).multiplyScalar(0.5);
  }

  /** @type {PIXI.Rectangle} */
  get boundsRect() {
    const aabb = this.aabb;
    return new PIXI.Rectangle(
      aabb.min.x,
      aabb.min.y,
      aabb.max.x - aabb.min.x,
      aabb.max.y - aabb.min.y
    );
  }

  /**
   * Draw this edge.
   */
  drawObject(_opts = {}) {  }

  /**
   * Draw the edge center point.
   */
  drawCentroid(opts = {}) { Draw.point(this.centroid, opts); }

  /**
   * Draw the 2d bounds.
   */
  drawBounds(opts = {}) { Draw.shape(this.boundsRect, opts); }
}

/**
 * Any flat object that blocks.
 */
class AbstractPlanarBlockingObject extends AbstractBlockingObject {
  // ---- NOTE: Property getters ----- //

  /** @type {Point3d} */
  #point = new CONFIG.GeometryLib.threeD.Point3d(); // Any point within the object on the object plane.

  get point() { return this.#point; }

  /** @type {Point3d} */
  #normal = new CONFIG.GeometryLib.threeD.Point3d(0, 0, 1); // upVector

  get normal() { return this.#normal; }

  /** @type {Plane} */
  #plane = new CONFIG.GeometryLib.threeD.Plane();

  get plane() {
    // Could link the normal and point but would still have to force a recalc.
    // Copying is cleaner.
    this.#plane.normal.copyFrom(this.normal);
    this.#plane.point.copyFrom(this.point);
    return this.#plane;
  }
}


/**
 * Store blocking objects that can be tested for collisions.
 * Simplify by using triangles, tracking certain properties for each triangle:
 * Tiles
 * - Also test for alpha transparency at intersection point.
 * Walls
 * - Track wall type, e.g. terrain walls
 * - One-way walls use cw / ccw only.
 * Tokens
 * - Use cw/ccw to avoid testing overlaps.
 */
export class BlockingTriangle extends AbstractPlanarBlockingObject {
  // Object must be Point3d[3].

  /** @type {Point3d} */
  get a() { return this.object[0]; }

  /** @type {Point3d} */
  get point() { return this.object[0]; }

  /** @type {Point3d} */
  get b() { return this.object[1]; }

  /** @type {Point3d} */
  get c() { return this.object[2]; }

  // ----- NOTE: Simple getter calculations ----- //
  get normal() {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const normal = super.normal;
    const { a, b, c} = this;
    const diff10 = b.subtract(a, Point3d._tmp2);
    const diff20 = c.subtract(a, Point3d._tmp3);
    diff10.cross(diff20, normal).normalize(normal);
    return normal;
  }

  get aabb() {
    const aabb = super.aabb;
    const { a, b, c } = this;
    const xMinMax = Math.minMax(a.x, b.x, c.x);
    const yMinMax = Math.minMax(a.y, b.y, c.y);
    const zMinMax = Math.minMax(a.z, b.z, c.z);
    aabb.min.set(xMinMax.min, yMinMax.min, zMinMax.min);
    aabb.max.set(xMinMax.max, yMinMax.max, zMinMax.max);
    return aabb;
  }

  // ----- NOTE: Facing calculations ----- //

  /**
   * CCW is considered front-facing.
   */
  facing() {
    // https://stackoverflow.com/questions/9120032/determine-winding-of-a-2d-triangles-after-triangulation
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const ba = Point3d._tmp2;
    const ca = Point3d._tmp3;
    const { a, b, c } = this;
    b.subtract(a, ba);
    c.subtract(a, ca);
    ba.cross(ca, ba).z;
  }

  frontFacing() {
    const f = this.facing();
    return f() > 0 && !f.almostEqual(0);
  }

  // TODO: Fix.
  convertToPerspective(viewpoint) {
    // return new this.constructor(a, b, c);
  }

}

/**
 * Represent an edge for purposes of a BVH tree.
 * For now, store the edge and use it directly.
 * To cache, either:
 * - store the edge information (a, b, top, bottom) and compare it or
 * - hook edge changes and modify accordingly
 */
export class BlockingEdge extends AbstractPlanarBlockingObject {

  // ---- NOTE: Property getters ----- //

  /** @type {Edge} */
  get edge() { return this.object; }

  /** @type {PIXI.Point} */
  get a() { return this.object.a; }

  /** @type {PIXI.Point} */
  get b() { return this.object.b; }

  /** @type {number} */
  get top() { return this.object.elevationLibGeometry.a.top ?? 1.0e06; }

  /** @type {number} */
  get bottom() { return this.object.elevationLibGeometry.a.bottom ?? -1.0e06; }

  // ----- NOTE: Simple getter calculations ----- //
  get normal() {
    const normal = super.normal;
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const { a, b, top, bottom } = this;
    const pt0 = Point3d._tmp.set(a.x, a.y, top);
    const pt1 = Point3d._tmp2.set(b.x, b.y, top);
    const pt2 = Point3d._tmp3.set(a.x, a.y, bottom);
    const diff10 = pt1.subtract(pt0, pt1);
    const diff20 = pt2.subtract(pt0, pt2);
    diff10.cross(diff20, normal).normalize(normal);
    return normal;
  }

  get aabb() {
    const aabb = super.aabb;
    const { a, b, top, bottom } = this;
    const xMinMax = Math.minMax(a.x, b.x);
    const yMinMax = Math.minMax(a.y, b.y);
    aabb.min.set(xMinMax.min, yMinMax.min, bottom);
    aabb.max.set(xMinMax.max, yMinMax.max, top);
    return aabb;
  }

  // ----- NOTE: Collisions ----- //

  /**
   * More thorough test for intersection.
   * Given a source type, tests for threshold, wall type, direction, and door.
   * @param {Ray3d} ray
   * @param {sourceType} CONST.WALL_RESTRICTION_TYPES
   * @param {boolean}
   */
  hasObjectIntersection(ray, { sourceType } = {}) {
    const edge = this.edge;
    if ( edge[sourceType] === CONST.WALL_SENSE_TYPES.NONE ) return false;
    if ( edge.object.isOpen ) return false;
    if ( edge.direction ) {
      const o = edge.orientPoint(ray.origin);
      if ( o !== edge.direction ) return false;
    }
    if ( edge.applyThreshold(sourceType, ray.origin) ) return false;
    return intersectVerticalRectangleRay(this.plane, ray, this.a, this.b) !== null;
  }

  // ----- NOTE: Debugging ----- //

  /**
   * Draw this edge.
   */
  drawObject(opts = {}) { Draw.segment(this.edge, opts); }
}

export class BlockingTile extends AbstractPlanarBlockingObject  {

  // ---- NOTE: Property getters ----- //

  /** @type {Tile} */
  get tile() { return this.object; }

  /** @type {number} */
  get elevation() { return this.tile.document.elevation; }

  /** @type {Point3d} */
  get point() {
    const pt = super.point();
    const { x, y, elevation } = this.tile.document;
    pt.set(x, y, elevation);
    return pt;
  }

  // ----- NOTE: Simple getter calculations ----- //

  /** @type {AABB} */
  get aabb() {
    const aabb = super.aabb();
    const { x, y, width, height, elevation } = this.tile.document;
    aabb.min.set(x, y, elevation)
    aabb.max.set(x + width, y + height, elevation);
    return aabb;
  }

  // ----- NOTE: Collisions ----- //

  /**
   * Test tile for intersection.
   * Given a source type, tests for threshold, wall type, direction, and door.
   * @param {Ray3d} ray
   * @param {sourceType} CONST.WALL_RESTRICTION_TYPES
   * @param {boolean}
   */
  hasObjectIntersection(ray, { sourceType, alphaThreshold = CONFIG[MODULE_ID].alphaThreshold } = {}) {
    // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
    if ( MODULES_ACTIVE.LEVELS
      && sourceType === "sight"
      && this.tile.document.flags?.levels?.noCollision ) return false;

    // Assumed bounds intersection was already tested.
    // Need the intersection point to test alpha.
    const t = ray.intersectPlane(this.plane);
    if ( t == null || t < 0.0 || (t*t) > ray.distanceSquared ) return false;
    const ix = CONFIG.GeometryLib.threeD.Point3d._tmp;
    ray.project(t, ix);

    // Need to test the tile intersection point for transparency (Levels holes).
    if ( !this.tile.mesh?.containsCanvasPoint(ix, alphaThreshold) ) return false;
    return true;
  }

  // ----- NOTE: Debugging ----- //

  /**
   * Draw this tile.
   */
  drawObject(opts) { this.drawBounds(opts); }
}


/**
 * Intersect ray with 2d vertical rectangle.
 * @param {Plane} plane
 * @param {Ray3d} ray
 * @param {Point3d} a      Where z is the top elevation
 * @param {Point3d} b      Where z is the bottom elevation
 * @param {Point3d} ix     The intersection point.
 * @returns {float|null} T-value or null if no intersection.
 */
function intersectVerticalRectangleRay(plane, ray, a, b, ix) {
  const t = ray.intersectPlane(plane);
  if ( t == null ) return null;
  if ( t < 0.0 || (t*t) > ray.distanceSquared ) return null;
  ix ??= CONFIG.GeometryLib.threeD.Point3d._tmp;
  ray.project(t, ix);

  // Within vertical extent.
  if ( ix.z > a.z || ix.z < b.z ) return null;

  // Within the 2d endpoints.
  const dist2Endpoints = PIXI.Point.distanceSquaredBetween(a, b);
  const dist2A = PIXI.Point.distanceSquaredBetween(a, ix);
  if ( dist2A > dist2Endpoints ) return null;
  const dist2B = PIXI.Point.distanceSquaredBetween(b, ix);
  if ( dist2B > dist2Endpoints ) return null;
  return t;
}

/**
 * Represent a token for purposes of a BVH tree.
 * Only 3d token bounds are intersected.
 * If the token has a specific shape, that must be handled separately.
 */
export class BlockingToken extends AbstractBlockingObject {

  // ---- NOTE: Property getters ----- //

  /** @type {Token} */
  get token() { return this.object; }

  get aabb() {
    const aabb = super.aabb;
    const { top, bottom } = CONFIG.GeometryLib.threeD.Point3d.fromToken(this.object);
    const { w, h } = this.object
    const w1_2 = w * 0.5;
    const h1_2 = h * 0.5;
    aabb.min.set(top.x - w1_2, top.y - h1_2, bottom.z);
    aabb.max.set(top.x + w1_2, top.y + h1_2, top.z)
    return aabb;
  }

  // TODO: Add to hasObjectIntersection any checks re viewerToken?

  // ----- NOTE: Debugging ----- //

  /**
   * Draw this token 2d overhead.
   */
  drawObject(opts) { return this.drawBounds(opts); }
}

/**
 * Store a basic triangle that can be tested for barycentric inclusion.
 * Stores the relevant barycentric values.
 */
export class BaryTriangle2d {

  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  b = new PIXI.Point();

  /** @type {PIXI.Point} */
  c = new PIXI.Point();

  static fromPoints(a, b, c) {
    const tri = new this();
    tri.a.copyFrom(a);
    tri.b.copyFrom(b);
    tri.c.copyFrom(c);
    tri._storeBaryData();
    return tri;
  }

  #v0 = new PIXI.Point();

  #v1 = new PIXI.Point();

  #v2 = new PIXI.Point();

  #d00 = 0;

  #d01 = 0;

  #d11 = 0;

  _storeBaryData() {
    this.b.subtract(this.a, this.#v0);
    this.c.subtract(this.a, this.#v1);

    this.#d00 = this.#v0.dot(this.#v0);
    this.#d01 = this.#v0.dot(this.#v1);
    this.#d11 = this.#v1.dot(this.#v1);
  }

  /**
   * Calculate barycentric position within a given triangle
   * For point p and triangle abc, return the barycentric uvw as a vec3 or vec2.
   * See https://ceng2.ktu.edu.tr/~cakir/files/grafikler/Texture_Mapping.pdf
   * @param {vec3|vec2} p
   * @param {vec3|vec2} a
   * @param {vec3|vec2} b
   * @param {vec3|vec2} c
   * @returns {vec3}
   */
  barycentric(p) {
    const v0 = this.#v0;
    const v1 = this.#v1;
    const v2 = p.subtract(this.a, this.a.constructor._tmp3);
    const d00 = this.#d00;
    const d01 = this.#d01;
    const d11 = this.#d11;
    const d20 = v2.dot(v0);
    const d21 = v2.dot(v1);

    const denom = ((d00 * d11) - (d01 * d01));
    // TODO: Is this test needed? if ( denom == 0.0 ) return new vec3(-1.0);

    const denomInv = 1.0 / denom; // Fixed for given triangle
    const v = ((d11 * d20) - (d01 * d21)) * denomInv;
    const w = ((d00 * d21) - (d01 * d20)) * denomInv;
    const u = 1.0 - v - w;
    return { u, v, w };
  }

  /**
   * Test if a barycentric coordinate is within its defined triangle.
   * @param {PIX.Point} p     Barycentric coordinate; x,y,z => u,v,w
   * @returns {bool} True if inside
   */
  pointInsideTriangle(p) {
    const { u, v, w } = this.barycentric(p)
    return u >= 0.0 && v >= 0.0 && (v + w) <= 1.0;
  }
}

// This does nothing beyond BaryTriangle2d.
export class BaryTriangle3d extends BaryTriangle2d {
  /** @type {Point3d} */
  a = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  b = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  c = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  #v0 = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  #v1 = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  #v2 = new CONFIG.GeometryLib.threeD.Point3d();
}


export class BaryTriangle3dNormal extends BaryTriangle3d {

  /** @type {Point3d} */
  #normal = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {number} */
  #normalM2 = 0;

  /** @type {Point3d} */
  #dCB = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  #dAC = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  #dBA = new CONFIG.GeometryLib.threeD.Point3d();

  _storeBaryData() {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const dBA = this.b.subtract(this.a, Point3d._tmp2);
    const dCA = this.c.subtract(this.a, Point3d._tmp3);
    dBA.cross(dCA, this.#normal);
    this.#normalM2 = this.#normal.magnitudeSquared();

    // Store differences between the points.
    this.c.subtract(this.b, this.#dCB);
    this.a.subtract(this.c, this.#dAC);
    this.b.subtract(this.a, this.#dBA);
  }

  barycentric(p) {
    const dPB = p.subtract(this.b, Point3d._tmp3);
    const nA = this.#dCB.cross(dPB, Point3d._tmp3);
    const u = this.#normal.dot(nA) / this.#normalM2;

    const dPC = p.subtract(this.c, Point3d._tmp3);
    const nB = this.#dAC.cross(dPC, Point3d._tmp3);
    const v = this.#normal.dot(nB) / this.#normalM2;

    const dPA = p.subtract(this.a, Point3d._tmp3);
    const nC = this.#dBA.cross(dPA, Point3d._tmp3);
    const w = this.#normal.dot(nC) / this.#normalM2;
    return { u, v, w };
  }
}

