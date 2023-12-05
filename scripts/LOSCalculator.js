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
 * Map of settings to LOS configurations.
 */
const TARGET = SETTINGS.LOS.TARGET;
const SETTINGS_CONFIG_MAP = {
  // Target
  [TARGET.LARGE]: "largeTarget",
  [TARGET.PERCENT]: "threshold",

  // Target (PointsLOS)
  [TARGET.POINT_OPTIONS.NUM_POINTS]: "numTargetPoints",
  [TARGET.POINT_OPTIONS.INSET]: "targetInset",
  [TARGET.POINT_OPTIONS.POINTS3D]: "points3d",

  // Token blocking
  [SETTINGS.LIVE_TOKENS_BLOCK]: "liveTokensBlock",
  [SETTINGS.DEAD_TOKENS_BLOCK]: "deadTokensBlock",
  [SETTINGS.PRONE_TOKENS_BLOCK]: "proneTokensBlock",
  [SETTINGS.TOKEN_HP_ATTRIBUTE]: "tokenHPAttribute",
};


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

  /** @type {AlternativeLOS} */
  calc;

  constructor(viewer, target) {
    const algorithm = Settings.get(SETTINGS.LOS.TARGET.ALGORITHM);
    const cfg = this.constructor.initialConfiguration();
    this.calc = new this.constructor.ALGORITHM_CLASS[algorithm](viewer, target, cfg);
  }

  static initialConfiguration() {
    const cfg = {
      type: "sight",
      wallsBlock: true,
      tilesBlock: true
    };

    // Add in relevant settings.
    for ( const [settingsKey, configLabel] of Object.entries(SETTINGS_CONFIG_MAP) ) {
      cfg[configLabel] = Settings.get(settingsKey);
    }

    return cfg;
  }

  /** @type {Token} */
  get viewer() { return this.calc.viewer; }

  set viewer(value) { this.calc.viewer = value; }

  /** @type {Token} */
  get target() { return this.calc.target; }

  set target(value) { this.calc.target = value; }

  destroy() { return this.calc.destroy(); }

  debug() { return this.calc.updateDebug(); }

  clearDebug() { return this.calc.clearDebug(); }

  async closeDebugPopout() { return this.calc?.closeDebugPopout(); }

  async openDebugPopout() { return this.calc?.openDebugPopout(); }

  /**
   * Test if viewer token has LOS to a target token.
   * Accounts for all viewer points if more than one in settings.
   */
  hasLOSTo(target) {
    const { viewer, calc } = this;
    if ( target ) calc.target = target;
    const center = Point3d.fromTokenCenter(viewer);

    const pointAlgorithm = Settings.get(SETTINGS.LOS.VIEWER.NUM_POINTS);
    const inset = Settings.get(SETTINGS.LOS.VIEWER.INSET);
    const viewerPoints = calc.constructor.constructViewerPoints(viewer, { pointAlgorithm, inset });

    const useDebug = Settings.get(SETTINGS.DEBUG.LOS);
    if ( useDebug ) console.debug(`\n👀${calc.viewer.name} --> 🎯${calc.target.name}`);
    let los = false;
    for ( const viewerPoint of viewerPoints ) {
      calc.visionOffset = viewerPoint.subtract(center);

      if ( useDebug ) {
        const percent = calc.percentVisible();
        console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t(@viewerPoint ${Math.round(viewerPoint.x)},${Math.round(viewerPoint.y)},${Math.round(viewerPoint.z)})`);
      }

      if ( (los = calc.hasLOS()) ) {
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
   * Update one or more specific settings in the calculator.
   */
  _updateConfiguration(config) {
    // Remap settings to the calculator config.

    for ( const [settingsLabel, settingsValue] of Object.entries(config) ) {
      if ( !Object.hasOwn(SETTINGS_CONFIG_MAP, settingsLabel) ) continue;
      const cfgLabel = SETTINGS_CONFIG_MAP[settingsLabel];
      config[cfgLabel] = settingsValue;
      delete config[settingsLabel];
    }
    this.calc.updateConfiguration(config);
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
   * Reset the calculator settings to the current settings.
   * (Used in Settings after settings have changed.)
   */
  _resetConfigurationSettings() {
    this.calc._initializeConfiguration(this.constructor.initialConfiguration());
    this.calc._clearCache();
  }
}
