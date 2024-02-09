/* globals
*/
"use strict";

import { Settings } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { AbstractCalculator } from "./LOS/AbstractCalculator.js";

/** Testing
api = game.modules.get("tokenvisibility").api
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL1)
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL2)
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_GEOMETRIC)
*/


/**
 * Class that handles calculating line-of-sight between two tokens based on current settings.
 */
export class LOSCalculator extends AbstractCalculator {
  /**
   * Test if viewer token has LOS to a target token.
   * Accounts for all viewer points if more than one in settings.
   */
  hasLOSTo(target) {
    const { viewer, calc } = this;
    if ( target ) calc.target = target;

    const pointAlgorithm = Settings.get(Settings.KEYS.LOS.VIEWER.NUM_POINTS);
    const inset = Settings.get(Settings.KEYS.LOS.VIEWER.INSET);
    const viewerPoints = calc.constructor.constructViewerPoints(viewer, { pointAlgorithm, inset });

    const useDebug = Settings.get(Settings.KEYS.DEBUG.LOS);
    if ( useDebug ) console.debug(`\n👀${calc.viewer.name} --> 🎯${calc.target.name}`);
    let los = false;
    for ( const viewerPoint of viewerPoints ) {
      calc.viewerPoint = viewerPoint;

      if ( useDebug ) {
        const percent = calc.percentVisible();
        console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t(@viewerPoint ${Math.round(viewerPoint.x)},${Math.round(viewerPoint.y)},${Math.round(viewerPoint.z)})`);
      }

      if ( (los = calc.hasLOS()) ) {
        los = true;
        break;
      }
    }

    if ( useDebug ) console.debug(`\tLOS? ${los}`);
    return los;
  }

  /**
   * Calculate the percentage visible for a target token from a viewer token.
   * @param {Point3d} visionOffset     Offset from the center of the viewer.
   * @returns {number}  Percent between 0 and 1. If the "large token subtargeting" is enabled,
   *   this could be greater than 1.
   */
  percentVisible(target, visionOffset = new Point3d()) {
    const calc = this.calc;
    if ( target ) calc.target = target;
    calc.visionOffset = visionOffset;
    const percent = calc.percentVisible();
    if ( Settings.get(Settings.KEYS.DEBUG.LOS) ) {
      const viewerPoint = calc.viewerPoint;
      console.debug(`\n👀${calc.viewer.name} --> 🎯${calc.target.name}`);
      console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t(@viewerPoint ${Math.round(viewerPoint.x)},${Math.round(viewerPoint.y)},${Math.round(viewerPoint.z)})`);
    }
    return percent;
  }
}
