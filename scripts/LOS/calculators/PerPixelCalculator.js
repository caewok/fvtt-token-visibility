/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID, TRACKER_IDS } from "../../const.js";
import { Settings } from "../../settings.js";

// Calculator
import { PercentVisiblePointsResultAbstract, PercentVisibleCalculatorPointsAbstract } from "./PointsCalculator.js";

// LOS folder
import { DebugVisibilityViewerArea3dPIXI } from "../DebugVisibilityViewer.js";
import { FastBitSet } from "../FastBitSet/FastBitSet.js";

// Geometry
import { Point3d } from "../../geometry/3d/Point3d.js";
import { Plane } from "../../geometry/3d/Plane.js";

export class PercentVisiblePerPixelResult extends PercentVisiblePointsResultAbstract {}

/**
 * Use 3d points on token faces or token spheres to test visibility.
 * Debug draw transforms those points to a camera perspective view.
 *
 */
export class PercentVisibleCalculatorPerPixel extends PercentVisibleCalculatorPointsAbstract {
  static resultClass = PercentVisiblePerPixelResult;

  static BitSetClass = FastBitSet;

  static defaultConfiguration = {
    ...super.defaultConfiguration,
    spherical: null, // If null, use the configuration setting.
  }

  /** @type {boolean} */
  get spherical() { return this.config.spherical ?? CONFIG[MODULE_ID].useTokenSphere; }

  _calculate() {
    this._initializeCamera();
    return super._calculate();
  }

  /** @type {Point3d[][]} */
  get targetPoints() {
    if ( this.spherical ) return [this.target[MODULE_ID][TRACKER_IDS.GEOMETRY.TOKEN.SPHERICAL].tokenSpherePoints];
    return super.targetPoints;
  }

  /** @type {Polygon3d[]|[Sphere]} */
  get targetSurfaces() {
    if ( this.spherical ) return [this.target[MODULE_ID][TRACKER_IDS.GEOMETRY.TOKEN.SPHERICAL].tokenSphere];
    return super.targetSurfaces;
  }

  surfaceIsVisible(surface) {
    if ( this.spherical ) return true;
    return surface.isFacing(this.viewpoint);
  }

  /* ----- NOTE: Pixel testing ----- */

  pointIsVisible(pt, radius2) {
    if ( !super.pointIsVisible(pt, radius2) ) return false;
    if ( !this.spherical ) return true;
    const viewplane = this.viewplane;
    return viewplane.whichSide(pt) * viewplane.whichSide(this.viewpoint) > 0
  }

  // Test visibility by constructing a plane perpendicular to the viewpoint --> center line at center.
  // TODO: Cache this for a given calculation. Also cache the viewplane side.
  get viewplane() {
    const center = Point3d.fromTokenCenter(this.target);
    const dirHorizontal = this.viewpoint.subtract(center);
    const dirB = Point3d.tmp.set(-dirHorizontal.y, dirHorizontal.x, center.z);
    const perpB = center.add(dirB);
    const dirC = dirHorizontal.cross(dirB);
    const perpC = center.add(dirC)
    return Plane.fromPoints(center, perpB, perpC)
  }

  _drawDebugPoints() { return null; } // Don't draw points on canvas; too many.
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
