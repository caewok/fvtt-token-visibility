/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { TRACKER_IDS } from "../const.js";
import {
  GeometryToken,
  GeometryConstrainedToken,
  GeometryHexToken,
  GeometryLitToken,
  GeometryBrightLitToken,
  GeometrySphericalToken, } from "../geometry/GeometryToken.js";
import { AbstractPlaceableGeometryTracker, allGeometryMixin } from "./PlaceableGeometryTracker.js";
import { FixedLengthTrackingBuffer } from "./TrackingBuffer.js";
import { numberOfSphericalPointsForSpacing } from "../util.js";

// libGeometry
import { Polygon3d, Quad3d, Circle3d } from "../../geometry/3d/Polygon3d.js";
import { Point3d } from "../../geometry/3d/Point3d.js";
import { MatrixFlat } from "../../geometry/MatrixFlat.js";
import { AABB3d } from "../../geometry/AABB.js";
import { almostBetween } from "../../geometry/util.js";
import { Sphere } from "../../geometry/3d/Sphere.js";

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
    MatrixFlat.translation(ctr.x, ctr.y, ctr.z, this.matrices.translation);
    return this.matrices.translation;
  }

  calculateScaleMatrix() {
    const { width, height, zHeight } = this.constructor.tokenDimensions(this.token);
    MatrixFlat.scale(width, height, zHeight, this.matrices.scale);
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
    top: new Quad3d(),
    bottom: new Quad3d(),
    sides: [],
  };

  facePoints = {
    top: [],
    bottom: [],
    sides: [], // Double array
  };

  get quad3d() { return this.faces.top; }

  _updateFaces() {
    const border2d = this.constrainTokens ? this.token.constrainedTokenBorder : this.token.tokenBorder;
    this._updateFacesForBorder(border2d);
    this._generateFacePoints();
  }

  _updateFacesForBorder(border2d) {
    const faces = this.faces;
    const { topZ, bottomZ } = this.token;

    if ( border2d instanceof PIXI.Rectangle ) faces.top = Quad3d.fromRectangle(border2d, topZ);
    else if ( border2d instanceof PIXI.Circle ) faces.top = Circle3d.fromCircle(border2d, topZ);
    else faces.top = Polygon3d.fromPolygon(border2d.toPolygon(), topZ);

    // Confirm the orientation by testing against a point within the token.
    const ctr2d = border2d.center;
    const ctr3d = Point3d.tmp.set(ctr2d.x, ctr2d.y, bottomZ + ((topZ - bottomZ) * 0.5));
    if ( faces.top.isFacing(ctr3d) ) faces.top.reverseOrientation();

    /*
    Point3d = CONFIG.GeometryLib.threeD.Point3d
    krusk = _token
    geometry = krusk.tokenvisibility.geometry
    border2d = krusk.tokenBorder
    let { topZ, bottomZ } = krusk
    ctr2d = border2d.center;
    ctr3d = Point3d.tmp.set(ctr2d.x, ctr2d.y, bottomZ + ((topZ - bottomZ) * 0.5));
    geometry.faces.top.isFacing(ctr3d)


    */

    // Construct the bottom face, reversing its orientation.
    faces.bottom = faces.top.clone();
    faces.bottom.setZ(bottomZ);
    faces.bottom.reverseOrientation();

    // Now build the sides from the top face.
    faces.sides = faces.top.buildTopSides(bottomZ);
    faces.sides.forEach(side => {
      if ( side.isFacing(ctr3d) ) side.reverseOrientation();
    });
    ctr3d.release();
  }

  _generateFacePoints() {
    const opts = { spacing: CONFIG[MODULE_ID].perPixelSpacing || 10, startAtEdge: false };
    if ( this.faces.top ) this.facePoints.top = this.faces.top.pointsLattice(opts);
    if ( this.faces.bottom ) this.facePoints.bottom = this.faces.bottom.pointsLattice(opts);

    // Process each side; store in equivalent structure to face.sides array.
    const numSides = this.faces.sides.length;
    this.facePoints.sides = new Array(numSides);
    for ( let i = 0; i < numSides; i += 1 ) this.facePoints.sides[i] = this.faces.sides[i].pointsLattice(opts);
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
    for ( const face of this.iterateFaces() ) {
      const t = face.intersectionT(rayOrigin, rayDirection);
      if ( t !== null && almostBetween(t, minT, maxT) ) return t;
    }
    return null;
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
  static ID = TRACKER_IDS.GEOMETRY.TOKEN.LIT;

  static HOOKS = {
    drawToken: "_onPlaceableDraw",
    refreshToken: "_onPlaceableRefresh",
    destroyToken: "_onPlaceableDestroy",

    createAmbientLight: "_onLightingUpdate",
    updateAmbientLight: "_onLightingUpdate",
    removeAmbientLight: "_onLightingUpdate",
  };

  static _onLightingUpdate() {
    canvas.tokens.placeables.forEach(t => {
      const geom = t[TRACKER_IDS.BASE][this.ID];
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
    this._updateFacesForBorder(border2d);
  }
}

export class BrightLitTokenGeometryTracker extends TokenGeometryTracker {
  static ID = TRACKER_IDS.GEOMETRY.TOKEN.BRIGHT;

  static HOOKS = {
    drawToken: "_onPlaceableDraw",
    refreshToken: "_onPlaceableRefresh",
    destroyToken: "_onPlaceableDestroy",

    createAmbientLight: "_onLightingUpdate",
    updateAmbientLight: "_onLightingUpdate",
    removeAmbientLight: "_onLightingUpdate",
  };

  static _onLightingUpdate() {
    canvas.tokens.placeables.forEach(t => {
      const geom = t[TRACKER_IDS.BASE][this.ID];
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
    this._updateFacesForBorder(border2d);
  }
}

export class SphericalTokenGeometryTracker extends TokenGeometryTracker {
  static ID = TRACKER_IDS.GEOMETRY.TOKEN.SPHERICAL;

  /** @type {GeometryDesc} */
  static geomClass = GeometrySphericalToken;

  /** @type {number[]} */
  static _hooks = [];

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  tokenSphere = new Sphere();

  tokenSphereUnitPoints = [];

  tokenSpherePoints = [];

  #scaleM = MatrixFlat.identity(4, 4);

  #translateM = MatrixFlat.identity(4, 4);

  #transformM = MatrixFlat.identity(4, 4);

  _updateFaces() {
    super._updateFaces();

    // If the radius changes, the number of spherical points may have changed.
    if ( this.tokenSphere.radius !== this.tokenRadius ) {
      this.tokenSphere.radius = this.tokenRadius;
      this.tokenSphereUnitPoints = this._generateSphericalPoints();
    }

    // Update the position and scale of the token sphere points.
    // Update the transform matrix.
    const center = Point3d.fromTokenCenter(this.token);
    const { width, height, zHeight } = this.constructor.tokenDimensions(this.token);

    // const r = this.tokenRadius;
    MatrixFlat.scale(width * 0.5, height * 0.5, zHeight * 0.5, this.#scaleM);
    MatrixFlat.translation(center.x, center.y, center.z, this.#translateM);
    this.#scaleM.multiply4x4(this.#translateM, this.#transformM);

    // Update the token points.
    const tokenSpherePoints = this.tokenSpherePoints = Array(this.tokenSphereUnitPoints.length);
    this.tokenSphereUnitPoints.forEach((pt, i) => tokenSpherePoints[i] = this.#transformM.multiplyPoint3d(pt));
  }

  _generateSphericalPoints() {
    // TODO: Cache and reuse target points. Maybe in the target geometry tracker.
    // TODO: Ellipsoids with distinct h, w, z?
    // See TokenLightMeter
    const nPoints = Math.floor(numberOfSphericalPointsForSpacing(this.tokenRadius)) || 1;
    return Sphere.pointsLattice(nPoints);
  }

  get tokenRadius() {
    const { width, height, zHeight } = this.constructor.tokenDimensions(this.token);
    return Point3d.distanceBetween(Point3d.tmp.set(0, 0, 0), Point3d.tmp.set(width * 0.5, height * 0.5, zHeight * 0.5));
  }

  rayIntersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    const t = this.tokenSphere.rayIntersectionT(rayOrigin, rayDirection);
    return (t !== null && almostBetween(t, minT, maxT)) ? t : null;
  }
}
