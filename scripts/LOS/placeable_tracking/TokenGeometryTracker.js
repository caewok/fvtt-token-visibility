/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { GeometryToken, GeometryConstrainedToken, GeometryHexToken } from "../geometry/GeometryToken.js";
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


export class TokenGeometryTracker extends allGeometryMixin(AbstractPlaceableGeometryTracker) {
  static HOOKS = {
    drawToken: "_onPlaceableDraw",
    refreshToken: "_onPlaceableRefresh",
    destroyToken: "_onPlaceableDestroy",
  };

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
    "refreshPosition",
    "refreshSize",
    "refreshElevation",
  ]);

  static layer = "tokens";

  /** @type {GeometryDesc} */
  static get geomClass() {
    return canvas.grid.isHexagonal ? GeometryHexToken : GeometryToken;
  };

  /** @type {number[]} */
  static _hooks = [];

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  get token() { return this.placeable; }

  get constrainTokens() { return CONFIG[MODULE_ID].constrainTokens; }

  calculateTranslationMatrix() {
    // Move from center of token.
    const ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(this.token);
    CONFIG.GeometryLib.MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, this.matrices.translation);
    return this.matrices.translation;
  }

  calculateScaleMatrix() {
    const { width, height, zHeight } = this.constructor.tokenDimensions(this.token);
    CONFIG.GeometryLib.MatrixFloat32.scale(width, height, zHeight, this.matrices.scale);
    return this.matrices.scale;
  }

  _updateAABB() {
    // Ignore constrained for purposes of AABB.
    CONFIG.GeometryLib.threeD.AABB3d.fromToken(this.token, this.aabb);
  }

  constrainedGeom;

  _updateVerticesIndices() {
    if ( this.constrainTokens
      && this.token.isConstrainedTokenBorder ) this.constrainedGeom = new GeometryConstrainedToken({ token: this.token });
    else this.constrainedGeom = null;
  }

  top = new CONFIG.GeometryLib.threeD.Quad3d();

  get quad3d() { return this.top; }

  _updateFaces() {
    const { token, constrainTokens } = this;
    const { topZ, bottomZ } = this.token;
    const border2d = constrainTokens ? token.constrainedTokenBorder : token.tokenBorder;

    if ( border2d instanceof PIXI.Polygon ) {
      const Polygon3d = CONFIG.GeometryLib.threeD.Polygon3d;
      if ( !(this.top instanceof Polygon3d) ) this.top = new Polygon3d();
      Polygon3d.fromPolygon(border2d, topZ, this.top);
    } else { // PIXI.Rectangle
      const Quad3d = CONFIG.GeometryLib.threeD.Quad3d;
      if ( !(this.top instanceof Quad3d) ) this.top = new Quad3d();
      Quad3d.fromRectangle(border2d, topZ, this.top);
    }

    this.top.clearCache();
    if ( !this.bottom || !(this.bottom instanceof this.top.constructor) ) this.bottom = new this.top.constructor();
    this.top.clone(this.bottom);
    this.bottom.reverseOrientation();
    this.bottom.setZ(bottomZ);

    // Now build the sides from the top face.
    this.sides = this.top.buildTopSides({ bottomZ });
  }

  _updateTriangles() {
    if ( this.constrainTokens && this.token.isConstrainedTokenBorder ) {
      const geom = new GeometryConstrainedToken({ placeable: this.token });
      this.triangles = CONFIG.GeometryLib.threeD.Triangle3d.fromVertices(geom.vertices, geom.indices);
    } else super._updateTriangles();
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
    return (t !== null && t.almostBetween(minT, maxT)) ? t : null;
  }

  /**
   * Determine the token 3d dimensions, in pixel units.
   * @param {Token} token
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} zHeight     In z direction
   */
  static tokenDimensions(token) {
    // For hex grids, the token instances already account for width and height.
    const width = canvas.grid.isHexagonal ? 1 : token.document.width;
    const height = canvas.grid.isHexagonal ? 1 : token.document.height;
    const zHeight = token.topZ - token.bottomZ;

    // Shrink tokens slightly to avoid z-fighting with walls and tiles.
    return {
      width: width * canvas.dimensions.size * .99,
      height: height * canvas.dimensions.size * .99,
      zHeight: zHeight * .99,
    };
  }
}
