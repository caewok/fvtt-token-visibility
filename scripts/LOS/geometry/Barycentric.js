/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../../geometry/3d/Point3d.js";

const tmpPt3d = new Point3d();

export class BaryTriangleData {

  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  v0 = new PIXI.Point();

  /** @type {PIXI.Point} */
  v1 = new PIXI.Point();

  /** @type {float} */
  d00 = 0.0;

  /** @type {float} */
  d01 = 0.0;

  /** @type {float} */
  d11 = 0.0;

  /** @type {float} */
  denomInv = 0.0;

  /**
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @param {PIXI.Point} c
   */
  constructor(a, b, c) {
    a = this.a.copyFrom(a);
    const v0 = b.subtract(a, this.v0)
    const v1 = c.subtract(a, this.v1);
    const d00 = this.d00 = v0.dot(v0);
    const d01 = this.d01 = v0.dot(v1);
    const d11 = this.d11 = this.v1.dot(v1);
    this.denomInv = 1 / ((d00 * d11) - (d01 * d01));
  }

  /**
   * From a 3d triangle, ignoring the z axis.
   */
  static fromTriangle3d(tri3d) {
    return new this(tri3d.a.to2d(), tri3d.b.to2d(), tri3d.c.to2d());
  }
}

export class BarycentricPoint extends Point3d {

  get u() { return this.x; }

  set u(value) { this.x = value; }

  get v() { return this.y; }

  set v(value) { this.y = value; }

  get w() { return this.z; }

  set w(value) { this.z = value; }

  /**
   * Calculate barycentric position using fixed triangle data
   * @param {PIXI.Point} p
   * @param {BaryTriangleData} triData
   * @returns {vec3}
   */
  static fromTriangleData(p, data, outPoint) {
    outPoint ??= new this();
    const { a, v0, v1, d00, d01, d11, denomInv } = data;
    const v2 = p.subtract(a, outPoint);
    const d20 = v2.dot(v0);
    const d21 = v2.dot(v1);

    const v = ((d11 * d20) - (d01 * d21)) * denomInv;
    const w = ((d00 * d21) - (d01 * d20)) * denomInv;
    const u = 1.0 - v - w;
    outPoint.set(u, v, w);
    return outPoint;
  }

  isInsideTriangle() {
    return this.y >= 0.0 && this.z >= 0.0 && (this.y + this.z) <= 1.0;
  }

  /**
   * Interpolate a numeric value at the triangle vertices using a barycentric point.
   * @param {number} a
   * @param {number} b
   * @param {number} c
   * @returns {number}
   */
  interpolateNumber(a, b, c) { return this.dot(tmpPt3d.set(a, b, c)); }

  /**
   * Interpolate from values at the triangle vertices using a barycentric point.
   * @param {PIXI.Point|Point3d} a
   * @param {PIXI.Point|Point3d} b
   * @param {PIXI.Point|Point3d} c
   * @returns {PIXI.Point|Point3d}
   */
  interpolatePoint(a, b, c, outPoint) {
    outPoint ??= new a.constructor();
    a = a.multiplyScalar(this.x);
    b = b.multiplyScalar(this.y);
    c = c.multiplyScalar(this.z);
    return a.add(b, outPoint).add(c, outPoint);
  }

  interpolate(a, b, c, outPoint) {
    if ( Number.isNumeric(a) ) return this.interpolateNumber(a, b, c);
    return this.interpolatePoint(a, b, c, outPoint);
  }
}
