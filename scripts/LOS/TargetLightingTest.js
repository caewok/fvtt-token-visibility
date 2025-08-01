/* globals
CONFIG,
canvas,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";
import { AbstractPolygonTrianglesID } from "./PlaceableTriangles.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";


// NOTE: Temporary objects
const BRIGHT = 0;
const DIM = 1;
const DARK = 2;

/**
 * Spot test how much a given target is lit.
 * For now, test all viewed faces without respect to perspective
 * or whether the given point on the face is occluded.
 * Just determines the extent to which a token is lit.
 */
export class TargetLightingTest {

  static LIGHT_LEVELS = { BRIGHT, DIM, DARK };

  target;

  viewpoint = new CONFIG.GeometryLib.threeD.Point3d();

  _config = {
    pointsPerFace: 9,
    sourceType: "lighting",
    senseType: "sight",
    blocking: {
      walls: true,
      tiles: true,
      regions: true,
      tokens: {
        dead: false,
        live: false,
        prone: false,
      }
    },
  };

  get config() { return this._config; }

  set config(cfg = {}) { foundry.utils.mergeObject(this._config, cfg, { inplace: true}); }

  counts = new Uint16Array(3);

  get dimPercentage() {
    const c = this.counts;
    const dim = c[DIM];
    const dark = c[DARK];
    return dim / (dim + dark);
  }

  get brightPercentage() {
    const c = this.counts;
    const bright = c[BRIGHT];
    const dim = c[DIM];
    const dark = c[DARK];
    return bright / (dim + dark);
  }

  get darkPercentage() {
    const c = this.counts;
    const dim = c[DIM];
    const dark = c[DARK];
    return dark / (dim + dark);
  }

  get percentages() {
    const c = this.counts;
    const bright = c[BRIGHT];
    const dim = c[DIM];
    const dark = c[DARK];
    const denom = 1 / (dim + dark);
    return {
      bright: bright * denom,
      dim: dim * denom,
      dark: dark * denom,
    };
  }

  #srcOrigin = new CONFIG.GeometryLib.threeD.Point3d();

  #rayDirection = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {WeakMap<PointSource, ObstacleOcclusionTest>} */
  occlusionTesters = new WeakMap();

  _initialize() {
    for ( const src of canvas[this.config.sourceType].placeables ) {
      let tester;
      if ( !this.occlusionTesters.has(src) ) {
        tester = new ObstacleOcclusionTest();
        tester.config = this.config; // Link so changes to config are reflected in the tester.
        this.occlusionTesters.set(src, tester);
      }

      // Setup the occlusion tester so the faster internal method can be used.
      tester ??= this.occlusionTesters.get(src);
      tester._initialize(this.viewpoint, this.target);
    }
    this.counts.fill(0);
  }

  calculateFromViewpoint(viewpoint, target, { targetPolys, config } = {}) {
    this.viewpoint.copyFrom(viewpoint);
    this.target = target;
    if ( config ) this.config = config;
    this._initialize();
    targetPolys ??= target[MODULE_ID][AbstractPolygonTrianglesID].triangles.filter(poly => poly.isFacing(this.viewpoint));
    targetPolys.forEach(face => this.testTokenFace(face));
  }

  /**
   * Test a given token face by sampling multiple points.
   * @param {Polygon3d} face            Token face to test
   * @param {Uint16Array[3]} counts        Array with bright|dim|dark counts
   * @returns {Uint16Array[3]} The counts array
   */
  testTokenFace(face, testPts) {
    const viewingSide = face.plane.whichSide(this.viewpoint);
    testPts ??= this.generateFacePoints(face);
    for ( const pt of testPts ) this._testTokenFacePoint(pt, face, viewingSide);
  }

  _testTokenFacePoint(pt, face, viewingSide) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const srcOrigin = this.#srcOrigin;
    const rayDirection = this.#rayDirection;
    let isBright = false;
    let isDim = false;
    for ( const src of canvas[this.config.sourceType].placeables ) {
      Point3d.fromPointSource(src, srcOrigin);
      if ( viewingSide * face.plane.whichSide(srcOrigin) < 0 ) continue; // On opposite side of the face from the viewer.
      const dist2 = Point3d.distanceSquaredBetween(pt, srcOrigin);
      if ( dist2 > (src.dimRadius ** 2) ) continue; // Not within source dim radius.

      // If blocked, then not bright or dim.
      pt.subtract(srcOrigin, rayDirection); // NOTE: Don't normalize so the wall test can use 0 < t < 1.
      if ( this.occlusionTesters.get(src)._rayIsOccluded(rayDirection) ) continue;

      // TODO: handle light/sound attenuation from threshold walls.
      isBright ||= (dist2 <= (src.brightRadius ** 2));
      isDim ||= isBright || (dist2 <= (src.dimRadius ** 2));
      if ( isBright ) break; // Once we know a fragment is bright, we should know the rest.
    }
    this.counts[BRIGHT] += isBright;
    this.counts[DIM] += isDim;
    this.counts[DARK] += !(isBright || isDim);
  }

  // TODO: Does Plane#to2d and Plane#to3d work? If so, use instead of conversion matrix.

  generateFacePoints(face) {
    // To ensure it is on the plane, generate a 2d point and test for 2d containment,
    // then move to 3d.
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const numPoints = this.config.pointsPerFace;
    const poly2d = face.toPlanarPolygon();
    const bounds = poly2d.getBounds();
    const pts = new Array(numPoints);
    for ( let i = 0; i < numPoints; i += 1 ) pts[i] = this.constructor.generatePointInPolygon2d(poly2d, bounds);
    const invMat2d = face.plane.conversion2dMatrixInverse;
    const tmpPt = Point3d.tmp;
    const out = pts.map(pt => invMat2d.multiplyPoint3d(tmpPt.set(pt.x, pt.y, 0)));
    tmpPt.release();
    return out;
  }

  static generatePointInPolygon2d(poly2d, bounds) {
    bounds ??= poly2d.getBounds();
    let pt = new PIXI.Point();
    do {
      pt.x = (Math.random() * bounds.width) + bounds.x;
      pt.y = (Math.random() * bounds.height) + bounds.y;

    } while ( !bounds.contains(pt.x, pt.y) );
    return pt;
  }
}




