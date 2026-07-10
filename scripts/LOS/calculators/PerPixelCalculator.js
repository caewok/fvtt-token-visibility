/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { Settings } from "../../settings.js";

// Calculator
import { PercentVisiblePointsResultAbstract, PercentVisibleCalculatorPointsAbstract } from "./PointsCalculator.js";

// LOS folder
import { DebugVisibilityViewerArea3dPIXI } from "../DebugVisibilityViewer.js";

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

  /** @type {class<PercentVisibleResult>} */
  static resultClass = PercentVisiblePerPixelResult;

  /* ----- NOTE: Pixel testing ----- */

  /**
   * Should this point be counted as part of the visibility calculation?
   * Here, points behind the viewing plane do not count (backside points).
   * @param {Point3d} pt
   * @param {boolean} True if the point should not be counted.
   */
  pointNotCounted(pt) {
    const viewplane = this.viewplane;
    return viewplane.whichSide(pt) * viewplane.whichSide(this.viewpoint) > 0
  }

  /**
   * Test visibility by constructing a plane perpendicular
   * to the viewpoint --> center line at center.
   * @type {Plane}
   */
  get viewplane() {
    const center = this.targetShape.center;
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
}
