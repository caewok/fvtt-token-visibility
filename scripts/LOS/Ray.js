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


// TODO: Move this to geometryLib?
// Ultimately replace the Ray3d with this.

/**
 * Ray in a given direction from an origin point.
 * Assumed static, and will cache inverse direction and distance squared accordingly.
 * In testing, it is faster to set the invDirection and distance in the constructor, rather than cache it.
 * Even when using the same ray a million times. (The cached times get closer but still slower.)
 */
export class Ray2d {
  /** @type {PIXI.Point} */
  origin = new PIXI.Point();

  /** @type {PIXI.Point} */
  direction = new PIXI.Point();

  /** @type {PIXI.Point} */
  invDirection = new PIXI.Point();

  /** @type {number} */
  distanceSquared = 0;

  /**
   * Use instead of constructor so that origin, direction, invDirection can be set correctly.
   * Otherwise, Ray3d will still use PIXI.Point in the constructor.
   */
  static fromDirection(origin, direction, distanceSquared) {
    const r = new this();
    r.origin.copyFrom(origin);
    const dir = r.direction.copyFrom(direction);
    dir.constructor._tmp.set(1, 1).divide(dir, r.invDirection);
    r.distanceSquared = distanceSquared ?? dir.dot(dir);
    return r;
  }

  /**
   * Build ray from two points.
   * @param {PIXI.Point} origin
   * @param {PIXI.Point} towardsPoint
   * @returns {this}
   */
  static fromPoints(origin, towardsPoint) {
    return this.fromDirection(origin, towardsPoint.subtract(origin));
  }

  /**
   * Build ray from two points but normalize the direction.
   * @param {PIXI.Point} origin
   * @param {PIXI.Point} towardsPoint
   * @param {number} [distanceSquared=1]
   * @returns {this}
   */
  static normalizedRayFromPoints(origin, towardsPoint, distanceSquared = 1) {
    // Setting distanceSquared avoids the calc.
    return this.fromDirection(origin, normalizedDirection(origin, towardsPoint), distanceSquared);
  }

  /**
   * Normalize the direction and construct the ray.
   * @param {Point} origin
   * @param {Point} direction
   * @param {number} [distanceSquared=1]
   */
  static normalizedRayFromDirection(origin, direction, distanceSquared = 1) {
    // Need to normalize direction first otherwise invDirection will be wrong.
    const nd = direction.constructor._tmp;
    nd.set(direction).normalize(nd);
    return this.fromDirection(origin, nd, distanceSquared);
  }

  /**
   * Project the ray by multiplier of the ray length.
   * If ray is normalized, this will project the ray the given distance.
   * @param {number} distanceMultiplier
   * @returns {vec2} A newly constructed vector.
   */
  project(distanceMultiplier, outPoint) {
    outPoint ??= new this.origin.constructor()
    return this.origin.add(this.direction.multiplyScalar(distanceMultiplier, outPoint), outPoint);
  }

  /**
   * Project ray by distance.
   * If ray is normalized, use project as it is faster.
   * @param {number} distance
   * @returns {PIXI.Point} A newly constructed vector.
   */
  projectDistance(distance, outPoint) {
    const t = distance / Math.sqrt(this.distanceSquared);
    return this.project(t, outPoint);
  }

  /**
   * Project the ray a given distance squared. Ray should be normalized.
   * @param {number} distance2
   * @returns {PIXI.Point} A newly constructed vector
   */
  projectDistanceSquared(distance2, outPoint) {
    if ( this.distanceSquared === 0.0 ) return this.origin.clone();

    const sign = Math.sign(distance2);
    const t = (sign * Math.sqrt(Math.abs(distance2))) / this.distanceSquared;
    return this.project(t, outPoint);
  }

  /**
   * Equivalent to Ray.angle.
   * The normalized angle of the ray in radians on the range (-PI, PI).
   * @returns {number}
   */
  angle2d() { return Math.atan2(this.direction.y, this.direction.x); }

  /**
   * Rotate the vector along the z axis.
   * @param {number} radians
   * @returns {Ray2d}
   */
  rotate2d(radians) {
    // See https://www.quora.com/How-do-you-rotate-a-vector-by-an-angle
    const cA = Math.cos(radians);
    const sA = Math.sin(radians);
    return new Ray2d(
      this.origin,
      { x: (this.direction.x * cA) - (this.direction.y * sA),
        y: (this.direction.x * sA) - (this.direction.y * cA) }
    );
  }

  /**
   * Determine if the ray intersects a 2d aabb bounding box.
   * @param {Ray2d} ray         Direction must not be normalized
   * @param {PIXI.Point} bmin
   * @param {PIXI.Point} bmax
   * @returns {boolean}
   */
  intersectsAABB(bmin, bmax) {
    const { origin, invDirection } = this;
    const minXY = this.origin.constructor._tmp;
    const maxXY = this.origin.constructor._tmp2;
    bmin.subtract(origin, minXY).multiply(invDirection, minXY);
    bmax.subtract(origin, maxXY).multiply(invDirection, maxXY);

    // Determine min/max of x and y, respectively.
    const minVals = minXY.min(maxXY, this.origin.constructor._tmp3);
    const maxVals = minXY.max(maxXY, maxXY);

    // Determine min o the maximums, max of the minimums.
    const tmax = Math.min(maxVals.x, maxVals.y);
    const tmin = Math.max(minVals.x, minVals.y);
    return tmax > 0.0 && tmax >= tmin && tmin < 1.0;
  }
}


export class Ray3d extends Ray2d {
  /** @type {PIXI.Point} */
  origin = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {PIXI.Point} */
  direction = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {PIXI.Point} */
  invDirection = new CONFIG.GeometryLib.threeD.Point3d();

  /**
   * Intersect a plane, returning the t-value indicating where along the ray
   * the intersection occurred.
   * @param {Plane} plane
   * @returns {number|null} Null if no intersection.
   */
  intersectPlane(plane) {
    const denom = plane.normal.dot(this.direction);
    if ( denom.almostEqual(0) ) return null;
    const delta = CONFIG.GeometryLib.threeD.Point3d._tmp3;
    plane.point.subtract(this.origin, delta);
    return delta.dot(plane.normal) * this.invDirection;
  }
}


/**
 * Normalized direction vector from point a to point b.
 * @param {PIXI.Point|Point3d} a
 * @param {PIXI.Point|Point3d} b
 * @param {PIXI.Point|Point3d} [outPoint]
 * @returns {outPoint}
 */
function normalizedDirection(a, b, outPoint) {
  outPoint ??= new a.constructor();
  return b.subtract(a, outPoint).normalize(outPoint);
}