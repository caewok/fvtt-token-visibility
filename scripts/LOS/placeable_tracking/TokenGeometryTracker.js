/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import {
  GeometryToken,
  GeometryConstrainedToken,
  GeometryHexToken,
  GeometryLitToken,
  GeometryBrightLitToken } from "../geometry/GeometryToken.js";
import { AbstractPlaceableGeometryTracker, allGeometryMixin } from "./PlaceableGeometryTracker.js";
import { FixedLengthTrackingBuffer } from "./TrackingBuffer.js";

import { Polygon3d, Quad3d } from "../../geometry/3d/Polygon3d.js";
import { Point3d } from "../../geometry/3d/Point3d.js";
import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";
import { AABB3d } from "../../geometry/AABB.js";
import { almostBetween } from "../../geometry/util.js";

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
    const ctr = Point3d.fromTokenCenter(this.token);
    MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, this.matrices.translation);
    return this.matrices.translation;
  }

  calculateScaleMatrix() {
    const { width, height, zHeight } = this.constructor.tokenDimensions(this.token);
    MatrixFloat32.scale(width, height, zHeight, this.matrices.scale);
    return this.matrices.scale;
  }

  _updateAABB() {
    // Ignore constrained for purposes of AABB.
    AABB3d.fromToken(this.token, this.aabb);
  }

  constrainedGeom;

  _updateVerticesIndices() {
    if ( this.constrainTokens
      && this.token.isConstrainedTokenBorder ) this.constrainedGeom = new GeometryConstrainedToken({ token: this.token });
    else this.constrainedGeom = null;
  }

  faces = {
    top: new CONFIG.GeometryLib.threeD.Quad3d(),
    bottom: new CONFIG.GeometryLib.threeD.Quad3d(),
    sides: [],
  }



  get quad3d() { return this.faces.top; }

  _updateFaces() {
    const border2d = this.constrainTokens ? this.token.constrainedTokenBorder : this.token.tokenBorder;
    return this._updateFacesForBorder(border2d);
  }

  _updateFacesForBorder(border2d) {
    const faces = this.faces;
    const { topZ, bottomZ } = this.token;

    if ( border2d instanceof PIXI.Polygon ) {
      if ( !(faces.top instanceof Polygon3d) ) faces.top = new Polygon3d();
      Polygon3d.fromPolygon(border2d, topZ, faces.top);
    } else if ( border2d instanceof PIXI.Rectangle ){ // PIXI.Rectangle
      if ( !(faces.top instanceof Quad3d) ) faces.top = new Quad3d();
      Quad3d.fromRectangle(border2d, topZ, faces.top);
    } else {
      if ( !(faces.top instanceof Polygon3d) ) faces.top = new Polygon3d();
      Polygon3d.fromPolygon(border2d.toPolygon(), topZ, faces.top);
    }

    // Confirm the orientation by testing against a point directly above the border plane.
    const pt0 = faces.top.points[0];
    const tmp = Point3d.tmp.set(pt0.x, pt0.y, pt0.z + 1);
    if ( !faces.top.isFacing(tmp) ) faces.top.reverseOrientation();

    // Construct the bottom face, reversing its orientation.
    faces.top.clearCache();
    if ( !faces.bottom || !(faces.bottom instanceof faces.top.constructor) ) faces.bottom = new faces.top.constructor();
    faces.top.clone(faces.bottom);
    faces.bottom.reverseOrientation();
    faces.bottom.setZ(bottomZ);

    // Now build the sides from the top face.
    faces.sides = faces.top.buildTopSides(bottomZ);
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

export class LitTokenGeometryTracker extends TokenGeometryTracker {
  static ID = "litGeometry";

  static HOOKS = {
    drawToken: "_onPlaceableDraw",
    refreshToken: "_onPlaceableRefresh",
    destroyToken: "_onPlaceableDestroy",

    createAmbientLight: "_onLightingUpdate",
    updateAmbientLight: "_onLightingUpdate",
    removeAmbientLight: "_onLightingUpdate",
  };

  static _onLightingUpdate() {
    canvas.tokens.forEach(t => {
      const geom = t[MODULE_ID][this.ID];
      if ( !geom ) return;
      geom._updateFaces();
    });
  }

  /** @type {GeometryDesc} */
  static geomClass = GeometryLitToken;

  /** @type {number[]} */
  static _hooks = [];

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  _updateFaces() {
    const border2d = this.token.litTokenBorder;
    if ( !border2d ) {
      this.faces.top = null;
      this.faces.bottom = null;
      this.faces.sides.length = 0;
      return;
    }
    return this._updateFacesForBorder(border2d);
  }
}

export class BrightLitTokenGeometryTracker extends TokenGeometryTracker {
  static ID = "brightLitGeometry";

  static HOOKS = {
    drawToken: "_onPlaceableDraw",
    refreshToken: "_onPlaceableRefresh",
    destroyToken: "_onPlaceableDestroy",

    createAmbientLight: "_onLightingUpdate",
    updateAmbientLight: "_onLightingUpdate",
    removeAmbientLight: "_onLightingUpdate",
  };

  static _onLightingUpdate() {
    canvas.tokens.forEach(t => {
      const geom = t[MODULE_ID][this.ID];
      if ( !geom ) return;
      geom._updateFaces();
    });
  }

  /** @type {GeometryDesc} */
  static geomClass = GeometryBrightLitToken;

  /** @type {number[]} */
  static _hooks = [];

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  _updateFaces() {
    const border2d = this.token.brightLitTokenBorder;
    if ( !border2d ) {
      this.faces.top = null;
      this.faces.bottom = null;
      this.faces.sides.length = 0;
      return;
    }
    return this._updateFacesForBorder(border2d);
  }
}
