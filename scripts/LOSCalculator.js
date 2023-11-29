/* globals
*/
"use strict";

import { Settings, SETTINGS } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { PointsLOS } from "./LOS/PointsLOS.js";
import { Area2dLOS } from "./LOS/Area2dLOS.js";
import { Area3dLOSGeometric } from "./LOS/Area3dLOSGeometric.js";
import { Area3dLOSWebGL } from "./LOS/Area3dLOSWebGL1.js";
import { Area3dLOSWebGL2 } from "./LOS/Area3dLOSWebGL2.js";
import { Area3dLOSHybrid } from "./LOS/Area3dLOSHybrid.js";

/** Testing
api = game.modules.get("tokenvisibility").api
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL1)
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL2)
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_GEOMETRIC)
*/


/**
 * Class that handles calculating line-of-sight between two tokens based on current settings.
 */
export class LOSCalculator {

  /** @enum {string: AlternativeLOS} */
  static ALGORITHM_CLASS = {
    "los-points": PointsLOS,
    "los-area-2d": Area2dLOS,
    "los-area-3d": Area3dLOSHybrid,
    "los-area-3d-geometric": Area3dLOSGeometric,
    "los-area-3d-webgl1": Area3dLOSWebGL,
    "los-area-3d-webgl2": Area3dLOSWebGL2,
    "los-area-3d-hybrid": Area3dLOSHybrid
  };

  static ALGORITHM_CLASS_NAME = {
    "los-points": "PointsLOS",
    "los-area-2d": "Area2dLOS",
    "los-area-3d": "Area3dLOSHybrid",
    "los-area-3d-geometric": "Area3dLOSGeometric",
    "los-area-3d-webgl1": "Area3dLOSWebGL",
    "los-area-3d-webgl2": "Area3dLOSWebGL2",
    "los-area-3d-hybrid": "Area3dLOSHybrid"
  };

  config = {
    type: "sight",
    wallsBlock: true,
    tilesBlock: true,
    deadTokensBlock: false,
    liveTokensBlock: false,
    proneTokensBlock: false,
    threshold: 0
  };

  /** @type {AlternativeLOS} */
  calc;

  constructor(viewer, target) {
    const algorithm = Settings.get(SETTINGS.LOS.TARGET.ALGORITHM);
    this.calc = new this.constructor.ALGORITHM_CLASS[algorithm](viewer, target, this.config);
  }

  destroy() {
    this.calc.destroy();
  }

  /**
   * @typedef {object}  LOSCalculatorConfiguration
   * Options that affect the one-off calculation.
   */

  /**
   * Test if viewer token has LOS to a target token.
   * Accounts for all viewer points if more than one in settings.
   */
  hasLOS(viewer, target) {
    const calc = this.calc;
    calc.viewer = viewer;
    calc.target = target;
    const center = Point3d.fromTokenCenter(viewer);
    const viewerPoints = calc.constructor.constructViewerPoints(viewer);
    const threshold = Settings.get(SETTINGS.LOS.TARGET.PERCENT);
    const useDebug = Settings.get(SETTINGS.DEBUG.LOS);
    // Debug: console.debug(`\n----- Visibility.prototype.hasLOS|${viewer.name}👀 => ${target.name}🎯 -----`);

    for ( const viewerPoint of viewerPoints ) {
      calc.visionOffset = viewerPoint.subtract(center); // TODO: Confirm this is correct.
      if ( calc.hasLOS(threshold, useDebug) ) {
        if ( useDebug ) calc.debug(true);
        return true;
      }
    }
    if ( useDebug ) calc.debug(false);
    return false;
  }


  /**
   * Calculate the percentage visible for a target token from a viewer token.
   * @param {Token} viewer
   * @param {Token} target
   * @returns {number}  Percent between 0 and 1. If the "large token subtargeting" is enabled,
   *   this could be greater than 1.
   */
  percentVisible(viewer, target, { visionOffset } = {}) {
    const calc = this.calc;
    calc.viewer = viewer;
    calc.target = target;
    if ( visionOffset ) {
      const center = Point3d.fromTokenCenter(viewer);
      calc.visionOffset = visionOffset.subtract(center); // TODO: Confirm this is correct.
    }
    if ( Settings.get(SETTINGS.DEBUG.LOS ) ) calc.debug(true);
    return calc.percentVisible();
  }

  /**
   * Update the calculator algorithm.
   */
  _updateAlgorithm(algorithm) {
    algorithm ??= Settings.get(SETTINGS.LOS.TARGET.ALGORITHM);
    const clName = this.calc.constructor.name;
    if ( clName === this.constructor.ALGORITHM_CLASS_NAME[algorithm] ) return;

    const cl = this.constructor.ALGORITHM_CLASS[algorithm];
    this.calc.destroy();
    this.calc = new cl(undefined, undefined, this.config);
  }

  /**
   * Update the calculator settings.
   */
  _updateConfigurationSettings() {
    this.calc._configure();
    this.calc._clearCache();
  }
}
