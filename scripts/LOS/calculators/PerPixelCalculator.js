/* globals
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

  /** @type {Camera} */
  camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective",
    up: new Point3d(0, 0, -1),
    mirrorMDiag: new Point3d(1, 1, 1),
  });

  targetPoints = [];

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
    // TODO: Handle sphere points as a distinct option.
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

  /* ----- NOTE: Pixel testing ----- */

  counts = new Uint16Array(5);

  countTargetPixels(result) {
    const targetPoints = this.targetPoints;
    for ( let i = 0, iMax = targetPoints.length; i < iMax; i += 1 ) {
      const pts = targetPoints[i];
      if ( !pts ) continue;
      const bs = result.data.unobscured[i];
      for ( let j = 0, jMax = pts.length; j < jMax; j += 1 ) {
        if ( !this.pointIsOccluded(pts[j]) ) bs.add(j);
      }
    }
    return result;
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
        opts.color = bs.has(j) ? Draw.COLORS.blue : Draw.COLORS.red;
        // draw.point({ x: i * 5, y: j}, opts);
        draw.point(pts[j].multiply(mult, a), opts);
        console.log(pts[j].multiply(mult));
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
