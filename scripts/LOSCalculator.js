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

  /** @enum {AlternativeLOS} */
  static ALGORITHM_CLASS = {
    "los-points": PointsLOS,
    "los-area-2d": Area2dLOS,
    "los-area-3d": Area3dLOSHybrid,
    "los-area-3d-geometric": Area3dLOSGeometric,
    "los-area-3d-webgl1": Area3dLOSWebGL,
    "los-area-3d-webgl2": Area3dLOSWebGL2,
    "los-area-3d-hybrid": Area3dLOSHybrid
  };

  /** @enum {string} */
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

  /** @type {Token} */
  get viewer() { return this.calc.viewer; }

  set viewer(value) { this.calc.viewer = value; }

  /** @type {Token} */
  get target() { return this.calc.target; }

  set target(value) { this.calc.target = value; }

  destroy() { return this.calc.destroy(); }

  debug(hasLOS) { return this.calc.debug(hasLOS); }

  clearDebug() { return this.calc.clearDebug(); }

  async closeDebugPopout() { return this.calc?.closeDebugPopout(); }

  async openDebugPopout() { return this.calc?.openDebugPopout(); }

  /**
   * Test if viewer token has LOS to a target token.
   * Accounts for all viewer points if more than one in settings.
   */
  hasLOS(target) {
    const { viewer, calc } = this;
    if ( target ) calc.target = target;
    const center = Point3d.fromTokenCenter(viewer);
    const viewerPoints = calc.constructor.constructViewerPoints(viewer);
    const threshold = Settings.get(SETTINGS.LOS.TARGET.PERCENT);
    const useDebug = Settings.get(SETTINGS.DEBUG.LOS);
    if ( useDebug ) console.debug(`\n👀${calc.viewer.name} --> 🎯${calc.target.name}`);
    let los = false;
    for ( const viewerPoint of viewerPoints ) {
      calc.visionOffset = viewerPoint.subtract(center);

      if ( useDebug ) {
        const percent = calc.percentVisible();
        console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t(@viewerPoint ${Math.round(viewerPoint.x)},${Math.round(viewerPoint.y)},${Math.round(viewerPoint.z)})`);
      }

      if ( (los = calc.hasLOS(threshold)) ) {
        //if ( useDebug ) calc.debug(true);
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
    if ( Settings.get(SETTINGS.DEBUG.LOS) ) {
      const viewerPoint = calc.viewerPoint;
      console.debug(`\n👀${calc.viewer.name} --> 🎯${calc.target.name}`);
      console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t(@viewerPoint ${Math.round(viewerPoint.x)},${Math.round(viewerPoint.y)},${Math.round(viewerPoint.z)})`);
    }

    return percent;
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
    this.calc = new cl(this.viewer, this.target, this.config);
  }

  /**
   * Update the calculator settings.
   */
  _updateConfigurationSettings() {
    this.calc._configure();
    this.calc._clearCache();
  }
}
