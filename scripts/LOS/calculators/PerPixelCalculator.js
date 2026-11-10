/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Calculator
import { PercentVisiblePointsResultAbstract, PercentVisibleCalculatorPointsAbstract } from "./PointsCalculator.js";

// Geometry
import { Point3d } from "../../geometry/3d/Point3d.js";
import { Plane } from "../../geometry/3d/Plane.js";
import { SpherePrimitive } from "../../geometry/placeable_geometry/InstancedGeometricPrimitive.js";

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

  /** @yield {Point3d} */
  *iterateTargetPoints() {
    const vp = this.viewpoint;
    if ( this.targetShape instanceof SpherePrimitive ) {
      const sphere = this.targetShape.faces[0];

      // The point must not be occluded by the sphere in relation to the viewer.
      // Vieweable if: Occluded r^2 + (distance vp --> ctr)^2 > (distance vp --> pt) ^2.
      const thresholdDistance = sphere.radiusSquared + Point3d.distanceSquaredBetween(vp, sphere.center);
      for ( const pt of this.targetShape.iterateFacePoints() ) {
        if ( thresholdDistance > Point3d.distanceSquaredBetween(vp, pt) ) yield pt;
      }
      return;
    }

    // Only get points for faces that point toward the viewer.
    const fp = this.targetShape.facePoints;
    const faces = this.targetShape.faces;
    for ( let i = 0, n = fp.length; i < n; i += 1 ) {
      const face = faces[i];
      if ( face.plane.whichSide(vp) > 0 ) yield* fp[i];
    }
  }

  _drawDebugPoints() { return null; } // Don't draw points on canvas; too many.
}
