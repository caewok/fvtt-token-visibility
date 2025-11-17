/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../../const.js";
import { Settings } from "../../settings.js";

// LOS folder
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { Camera } from "../Camera.js";
import { DebugVisibilityViewerArea3dPIXI } from "../DebugVisibilityViewer.js";
import { FastBitSet } from "../FastBitSet/FastBitSet.js";

// Geometry
import { Point3d } from "../../geometry/3d/Point3d.js";
import { Draw } from "../../geometry/Draw.js";
import { MatrixFlat } from "../../geometry/MatrixFlat.js";
import { Sphere } from "../../geometry/3d/Sphere.js";
import { Plane } from "../../geometry/3d/Plane.js";

export class PercentVisiblePerPixelResult extends PercentVisibleResult {

  // Which faces are represented by the face points for this viewpoint and token?
  // Non-facing faces will be empty in the array.
  data = {
    unobscured: [],
    numPoints: [],
  };

  get totalTargetArea() {
    return this.data.numPoints.reduce((acc, curr) => acc + curr, 0); // empty elements transformed to 0.
  }

  // Handled by the calculator, which combines multiple results.
  get largeTargetArea() { return this.totalTargetArea; }

  get visibleArea() { return this.data.unobscured.reduce((acc, curr) => acc + (curr ? curr.cardinality : 0), 0); }

  /**
   * Blend this result with another result, taking the maximum values at each test location.
   * Used to treat viewpoints as "eyes" in which 2+ viewpoints are combined to view an object.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMaximize(other) {
    let out = super.blendMaximize(other);
    if ( out ) return out;
    out = this.clone();
    for ( let i = 0, iMax = out.data.numPoints.length; i < iMax; i += 1 ) {
      // Combine each face in turn.
      if ( out.data.unobscured[i] && other.data.unobscured[i] ) {
        out.data.unobscured[i].or(other.data.unobscured[i]);
        out.data.numPoints[i] += other.data.numPoints[i];
      }
      else if ( other.data.unobscured[i] ) { // this.data for index i is empty.
        out.data.unobscured[i] = other.data.unobscured[i];
        out.data.numPoints[i] = other.data.numPoints[i];
      } // Else other.data for index i is empty.
    }
    return out;
  }
}

/**
 * Use 3d points on token faces or token spheres to test visibility.
 * Debug draw transforms those points to a camera perspective view.
 *
 */
export class PercentVisibleCalculatorPerPixel extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisiblePerPixelResult;

  static defaultConfiguration = {
    ...super.defaultConfiguration,
    spacing: 10, // Pixel spacing between points
  };

  /**
   * How many spherical points are necessary to achieve a given spacing for a given sphere radius?
   * @param {number} [radius=1]
   * @param {number} [spacing]        Defaults to the module spacing default for per-pixel calculator.
   * @returns {number}
   */
  static numberOfSphericalPointsForSpacing(r = 1, l = CONFIG[MODULE_ID].perPixelSpacing || 10) {
    // Surface area of a sphere is 4πr^2.
    // With N points, divide by N to get average area per point.
    // Assuming perfectly equidistant points, consider side length of a square with average area.
    // l = sqrt(4πr^2/N) = 2r*sqrt(π/N)
    // To get N, square both sides and simplify.
    // N = (4πr^2) / l^2
    // l = 2 * r * Math.sqrt(Math.PI / N);
    return (4 * Math.PI * (r ** 2)) / (l ** 2);
  }

  constructor(target, cfg = {}) {
    // So the configuration can be picked up.
    cfg.spacing ??= CONFIG[MODULE_ID].perPixelSpacing || 10;
    super(target, cfg);
  }

  /** @type {Camera} */
  camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective",
    up: new Point3d(0, 0, -1),
    mirrorMDiag: new Point3d(1, 1, 1),
  });

  targetPoints = [];

  visiblePoints = new FastBitSet();

  initializeCalculations() {
    this._initializeCamera();
  }

  _calculate() {
    this.initializeCalculations();
    const result = this._generateTargetPoints();
    return this.countTargetPixels(result);
  }

  _initializeCamera() {
    this.camera.cameraPosition = this.viewpoint;
    this.camera.targetPosition = this.targetLocation;
    this.camera.setTargetTokenFrustum(this.target);
  }

  _generateTargetPoints() {
    return CONFIG[MODULE_ID].useTokenSphere ? this._generateSphericalPoints() : this._generateFacePoints();
  }

  _generateFacePoints() {
    // TODO: Cache and reuse target points. Maybe in the target geometry tracker.
    const faces = this.target[MODULE_ID].geometry.faces;
    const targetFaces = [faces.top, faces.bottom, ...faces.sides];
    const numFaces = targetFaces.length

    const result = this._createResult();
    this.targetPoints = Array(numFaces);
    result.data.unobscured = Array(numFaces);
    result.data.numPoints = Array(numFaces);
    const opts = { spacing: this.config.spacing, startAtEdge: false };
    for ( let i = 0; i < numFaces; i += 1 ) {
      const face = targetFaces[i];
      if ( !face.isFacing(this.viewpoint) ) continue;
      result.data.unobscured[i] = new FastBitSet();

      // TODO: Cache the target points.
      this.targetPoints[i] = face.pointsLattice(opts);
      result.data.numPoints[i] = this.targetPoints[i].length;
    }
    return result;
  }

  #scaleM = MatrixFlat.identity(4, 4);

  #translateM = MatrixFlat.identity(4, 4);

  #transformM = MatrixFlat.identity(4, 4);

  get targetRadius() {
    const { h, w, topZ, bottomZ } = this.target;
    const xy = Math.max(h, w) * 0.5;
    const height = (topZ - bottomZ) * 0.5;
    return Math.sqrt(xy ** 2 + height ** 2);
  }

  _generateSphericalPoints() {
    // TODO: Cache and reuse target points. Maybe in the target geometry tracker.
    // TODO: Ellipsoids with distinct h, w, z?
    // See TokenLightMeter
    const target = this.target;
    const r = this.targetRadius
    const nPoints = Math.floor(this.constructor.numberOfSphericalPointsForSpacing(r)) || 1;
    const unitPoints = Sphere.pointsLattice(nPoints);

    // Update the transform matrix.
    const center = Point3d.fromTokenCenter(target);
    MatrixFlat.scale(r, r, r, this.#scaleM);
    MatrixFlat.translation(center.x, center.y, center.z, this.#translateM);
    this.#scaleM.multiply4x4(this.#translateM, this.#transformM);

    // Update the token points.
    this.targetPoints = [Array(unitPoints.length)];
    const targetPoints = this.targetPoints[0];
    unitPoints.forEach((pt, i) => targetPoints[i] = this.#transformM.multiplyPoint3d(pt));

    const result = this._createResult();
    result.data.unobscured = [new FastBitSet()];
    result.data.numPoints = [0];
    return result;
  }

  /* ----- NOTE: Pixel testing ----- */

  countTargetPixels(result) {
    return CONFIG[MODULE_ID].useTokenSphere ? this.countTargetSphericalPixels(result) : this.countTargetFacePixels(result);
  }

  countTargetFacePixels(result) {
    const targetPoints = this.targetPoints;
    for ( let i = 0, iMax = targetPoints.length; i < iMax; i += 1 ) {
      const pts = targetPoints[i];
      if ( !pts ) continue;
      const bs = result.data.unobscured[i];
      bs.clear();
      for ( let j = 0, jMax = pts.length; j < jMax; j += 1 ) {
        if ( !this.pointIsOccluded(pts[j]) ) bs.add(j);
      }
    }
    return result;
  }

  countTargetSphericalPixels(result) {
    result.data.numPoints[0] = 0;

    // Sum the total visible pixels, which will form the denominator.
    // Only test for obscurity if the pixel is visible (i.e., not behind the sphere).
    const targetPoints = this.targetPoints[0];
    const bs = result.data.unobscured[0];
    bs.clear();

    // Test visibility by constructing a plane perpendicular to the viewpoint --> center line at center.
    // Point must be in front of the plane to be visible.
    const viewplane = this.viewplane;
    const viewSide = Math.sign(viewplane.whichSide(this.viewpoint));
    const visiblePoints = this.visiblePoints;
    visiblePoints.clear();
    for ( let j = 0, jMax = targetPoints.length; j < jMax; j += 1 ) {
      const pt = targetPoints[j];
      if ( Math.sign(viewplane.whichSide(pt)) === viewSide ) {
        visiblePoints.add(j);
        if ( !this.pointIsOccluded(pt) ) bs.add(j);
      }
    }
    result.data.numPoints[0] = this.visiblePoints.cardinality;
    return result;
  }

  // Test visibility by constructing a plane perpendicular to the viewpoint --> center line at center.
  get viewplane() {
    const center = Point3d.fromTokenCenter(this.target);
    const dirHorizontal = this.viewpoint.subtract(center);
    const dirB = Point3d.tmp.set(-dirHorizontal.y, dirHorizontal.x, center.z);
    const perpB = center.add(dirB);
    const dirC = dirHorizontal.cross(dirB);
    const perpC = center.add(dirC)
    return Plane.fromPoints(center, perpB, perpC)
  }


  /**
   * Given a point in 3d space (presumably on a token face), test for occlusion between it and viewpoint.
   * @param {Point3d} fragmentPoint
   * @returns {boolean} True if occluded.
   */
  pointIsOccluded(fragmentPoint) {
    // Is it occluded from the camera/viewer?
    const rayDirection = Point3d.tmp;
    fragmentPoint.subtract(this.viewpoint, rayDirection);
    const isOccluded = this.occlusionTester._rayIsOccluded(rayDirection);
    rayDirection.release();
    return isOccluded;
  }

  // ----- NOTE: Debugging ----- //

  /**
   * Transform a 3d point to a 2d perspective for point of view of viewpoint.
   * @param {Point3d} pt
   * @returns {PIXI.Point} pt
   */
  _applyPerspective(pts) {
    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;
    return pts
      .map(pt => lookAtM.multiplyPoint3d(pt))
      .filter(pt => {
        if ( pt.z >= 0 ) {
          pt.release();
          return false;
        }
        return true;
      })
      .map(pt => perspectiveM.multiplyPoint3d(pt, pt));
  }

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(draw, { width = 100, height = 100 } = []) {
    const result = this.calculate();
    const mult = PIXI.Point.tmp.set(width, height);
    const a = PIXI.Point.tmp;
    const opts = {
      color: Draw.COLORS.blue,
      radius: 2,
      alpha: 0.5,
    };
    for ( let i = 0, iMax = result.data.unobscured.length; i < iMax; i += 1 ) {
      const face = result.data.unobscured[i];
      if ( !face ) continue;
      const bs = result.data.unobscured[i];
      const pts = this._applyPerspective(this.targetPoints[i]);
      for ( let j = 0, jMax = pts.length; j < jMax; j += 1 ) {
        const pt = pts[j];
        if ( CONFIG[MODULE_ID].useTokenSphere && !this.visiblePoints.has(j) ) continue;

        opts.color = bs.has(j) ? Draw.COLORS.blue : Draw.COLORS.red;
        // draw.point({ x: i * 5, y: j}, opts);
        draw.point(pt.multiply(mult, a), opts);
        // console.log(pt.multiply(mult));
      }
    }
    mult.release();
    a.release();
  }
}

export class DebugVisibilityViewerPerPixel extends DebugVisibilityViewerArea3dPIXI {
  algorithm = Settings.KEYS.LOS.TARGET.TYPES.PER_PIXEL;

//   updatePopoutFooter(percentVisible) {
//     super.updatePopoutFooter(percentVisible);
//     const calc = this.viewerLOS.calculator;
//
//     const { RED, BRIGHT, DIM, DARK } = calc.constructor.OCCLUSION_TYPES;
//     const area = calc.counts[RED];
//     const bright = calc.counts[BRIGHT] / area;
//     const dim = calc.counts[DIM] / area;
//     const dark = calc.counts[DARK] / area;
//
//     const footer2 = this.popout.element[0].getElementsByTagName("p")[1];
//     footer2.innerHTML = `${(bright * 100).toFixed(0)}% bright | ${(dim * 100).toFixed(0)}% dim | ${(dark * 100).toFixed(0)}% dark`;
//   }
}
