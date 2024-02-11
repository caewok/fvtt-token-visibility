/* globals
*/
"use strict";

import { Settings } from "../settings.js";
import { PointsLOS } from "./PointsLOS.js";
import { Area2dLOS } from "./Area2dLOS.js";
import { Area3dLOSGeometric } from "./Area3dLOSGeometric.js";
import { Area3dLOSWebGL } from "./Area3dLOSWebGL1.js";
import { Area3dLOSWebGL2 } from "./Area3dLOSWebGL2.js";
import { Area3dLOSHybrid } from "./Area3dLOSHybrid.js";

/**
 * Map of settings to LOS configurations.
 */
const TARGET = Settings.KEYS.LOS.TARGET;

/**
 * Class that handles calculating line-of-sight between two tokens based on current settings.
 * Abstract version does not have anything LOS-specific beyond what can be used by
 * CoverCalculator in Alt. Token Cover.
 */
export class AbstractCalculator {
  /**
   * Map of settings to LOS configurations.
   * @type {object}
   */
  static SETTINGS_CONFIG_MAP = {
    // Target
    [TARGET.LARGE]: "largeTarget",
    [TARGET.PERCENT]: "threshold",

    // Target (PointsLOS)
    [TARGET.POINT_OPTIONS.NUM_POINTS]: "numTargetPoints",
    [TARGET.POINT_OPTIONS.INSET]: "targetInset",
    [TARGET.POINT_OPTIONS.POINTS3D]: "points3d",

    // Token blocking
    [Settings.KEYS.LIVE_TOKENS_BLOCK]: "liveTokensBlock",
    [Settings.KEYS.DEAD_TOKENS_BLOCK]: "deadTokensBlock",
    [Settings.KEYS.PRONE_TOKENS_BLOCK]: "proneTokensBlock"
  };

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
    const algorithm = Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM);
    const cfg = this.constructor.initialConfiguration();
    const cl = this.constructor.ALGORITHM_CLASS[algorithm] ?? PointsLOS;
    this.calc = new cl(viewer, target, cfg);
  }

  static initialConfiguration(cfg = {}) {
    cfg.type ??= "sight";
    cfg.wallsBlock ??= true;
    cfg.tilesBlock ??= true;

    // Add in relevant settings.
    for ( const [settingsKey, configLabel] of Object.entries(this.SETTINGS_CONFIG_MAP) ) {
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

  async closeDebugPopout() {
    if ( !this.calc.closeDebugPopout ) return;
    return this.calc.closeDebugPopout();
  }

  async openDebugPopout() {
    if ( !this.calc.openDebugPopout ) return;
    return this.calc.openDebugPopout();
  }

  /**
   * Update one or more specific settings in the calculator.
   */
  _updateConfiguration(config) {
    // Remap settings to the calculator config.

    for ( const [settingsLabel, settingsValue] of Object.entries(config) ) {
      if ( !Object.hasOwn(this.constructor.SETTINGS_CONFIG_MAP, settingsLabel) ) continue;
      const cfgLabel = this.constructor.SETTINGS_CONFIG_MAP[settingsLabel];
      config[cfgLabel] = settingsValue;
      delete config[settingsLabel];
    }
    this.calc.updateConfiguration(config);
  }

  /**
   * Update the calculator algorithm.
   */
  _updateAlgorithm(algorithm) {
    algorithm ??= Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM);
    const clName = this.calc.constructor.name;
    if ( clName === this.constructor.ALGORITHM_CLASS_NAME[algorithm] ) return;

    const config = { ...this.calc.config };
    const cl = this.constructor.ALGORITHM_CLASS[algorithm];
    this.calc.destroy();
    this.calc = new cl(this.viewer, this.target, config);
  }

  _forceWebGL2() { this._updateAlgorithm(Settings.KEYS.LOS.TARGET.TYPE.AREA3D_WEBGL2); }

  _forceGeometric() { this._updateAlgorithm(Settings.KEYS.LOS.TARGET.TYPE.AREA3D_GEOMETRIC); }

  /**
   * Reset the calculator settings to the current settings.
   * (Used in Settings after settings have changed.)
   */
  _resetConfigurationSettings() {
    this.calc._initializeConfiguration(this.constructor.initialConfiguration());
    this.calc._clearCache();
  }
}
