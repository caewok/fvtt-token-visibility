/* globals
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryWall } from "../geometry/GeometryWall.js";
import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";
import { AABB3d } from "../../geometry/AABB.js";
import { Quad3d } from "../../geometry/3d/Polygon3d.js";
import { almostBetween, gridUnitsToPixels } from "../../geometry/util.js";
import { AbstractPlaceableGeometryTracker, allGeometryMixin } from "./PlaceableGeometryTracker.js";
import { FixedLengthTrackingBuffer } from "./TrackingBuffer.js";

/* WallGeometry
Placeable geometry stored in wall placeables.
- AABB
- rotation, scaling, and translation matrices from an ideal shape.
- Polygon3ds for faces
- Triangle3ds for faces
- Update key

Faces and triangles oriented based on wall direction.


*/

export class WallGeometryTracker extends allGeometryMixin(AbstractPlaceableGeometryTracker) {
  static HOOKS = {
    createWall: "_onPlaceableDocumentCreation",
    updateWall: "_onPlaceableDocumentUpdate",
    removeWall: "_onPlaceableDocumentDeletion",
  };

  /**
   * Change keys in updateWall hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
    "x",
    "y",
    "flags.elevatedvision.elevation.top",
    "flags.elevatedvision.elevation.bottom",
    "flags.wall-height.top",
    "flags.wall-height.top",
    "c",
    "dir",
  ]);

  static layer = "walls";

  /** @type {GeometryDesc} */
  static geomClass = GeometryWall;

  /** @type {number[]} */
  static _hooks = [];

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  get wall() { return this.placeable; }

  get edge() { return this.placeable.edge; }

  calculateTranslationMatrix() {
    const edge = this.edge;
    const pos = this.constructor.edgeCenter(edge);
    const { top, bottom } = this.constructor.edgeElevation(edge);
    const zHeight = top - bottom;
    const z = top - (zHeight * 0.5);
    MatrixFloat32.translation(pos.x, pos.y, z, this.matrices.translation);
    return this.matrices.translation;

  }

  calculateRotationMatrix() {
    const rot = this.constructor.edgeAngle(this.edge);
    MatrixFloat32.rotationZ(rot, true, this.matrices.rotation);
    return this.matrices.rotation;
  }

  calculateScaleMatrix() {
    const edge = this.edge;
    const ln = this.constructor.edgeLength(edge);
    const { top, bottom } = this.constructor.edgeElevation(edge);
    const scaleZ = top - bottom;
    MatrixFloat32.scale(ln, 1.0, scaleZ, this.matrices.scale);
    return this.matrices.scale;
  }

  _updateAABB() { AABB3d.fromEdge(this.edge, this.aabb); }

  _updateVerticesIndices() {
    const type = this.isDirectional ? "directional" : "double";
    if ( this.geom.type !== type ) this.geom = new this.constructor.geomClass({ type });
  }

  faces = {
    top: new Quad3d(),
    bottom: new Quad3d(),
    sides: [],
  }

  get quad3d() { return this.faces.top; }

  _updateFaces() {
    this.#updateFace(this.faces.top);
    if ( this.constructor.isDirectional(this.edge) ) this.faces.bottom = undefined;
    else {
      this.faces.bottom ??= new Quad3d();
      this.faces.top.clone(this.faces.bottom);
      this.faces.bottom.reverseOrientation();
    }
  }

  /**
   * Determine where a ray hits this object's triangles.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {number} [cutoff=1]   Ignore hits further along the ray from this (treat ray as segment)
   * @returns {number|null} The distance along the ray
   */
  rayIntersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    const t = this.quad3d.intersectionT(rayOrigin, rayDirection);
    return (t !== null && almostBetween(t, minT, maxT)) ? t : null;
  }

  #updateFace(quad) {
    const wall = this.placeable;
    let topZ = wall.topZ;
    let bottomZ = wall.bottomZ;
    if ( !isFinite(topZ) ) topZ = 1e06;
    if ( !isFinite(bottomZ) ) bottomZ = -1e06;

    quad.points[0].set(...wall.edge.a, topZ);
    quad.points[1].set(...wall.edge.a, bottomZ);
    quad.points[2].set(...wall.edge.b, bottomZ);
    quad.points[3].set(...wall.edge.b, topZ);
    quad.clearCache();
  }


  /**
   * Determine the top and bottom edge elevations. Null values will be given large constants.
   * @param {Edge} edge
   * @returns {object}
   * - @prop {number} top         1e05 if null
   * - @prop {number} bottom      -1e05 if null
   */
  static edgeElevation(edge) {
    let { top, bottom } = edge.elevationLibGeometry.a;
    top ??= 1e05;
    bottom ??= -1e05;
    top = gridUnitsToPixels(top);
    bottom = gridUnitsToPixels(bottom);
    return { top, bottom };
  }

  /**
   * Determine the 2d center point of the edge.
   * @param {Edge} edge
   * @returns {PIXI.Point}
   */
  static edgeCenter(edge) {
    const ctr = new PIXI.Point();
    return edge.a.add(edge.b, ctr).multiplyScalar(0.5, ctr);
  }

  /**
   * Determine the 2d length of the edge.
   * @param {Edge} edge
   * @returns {number}
   */
  static edgeLength(edge) { return PIXI.Point.distanceBetween(edge.a, edge.b); }

  /**
   * Angle of the edge on the 2d canvas.
   * @param {Edge} edge
   * @returns {number} Angle in radians
   */
  static edgeAngle(edge) {
    const delta = edge.b.subtract(edge.a, PIXI.Point.tmp);
    const out = Math.atan2(delta.y, delta.x);
    delta.release();
    return out;
  }

  /**
   * Is this a terrain (limited) edge?
   * @param {Edge} edge
   * @returns {boolean}
   */
  static isTerrain(edge, { senseType = "sight" } = {}) {
    return edge[senseType] === CONST.WALL_SENSE_TYPES.LIMITED;
  }

  /**
   * Is this a directional edge?
   * @param {Edge} edge
   * @returns {boolean}
   */
  static isDirectional(edge) { return Boolean(edge.direction); }
}
