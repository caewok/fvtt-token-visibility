/* globals
game,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, SETTINGS, ENUMS } from "./const.js";
import { registerLOSSettings } from "./LOS/settings.js";
import { ATVSettingsSubmenu } from "./ATVSettingsSubmenu.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";

export class Settings extends ModuleSettingsAbstract {

  /** @type {object} */
  static KEYS = SETTINGS;

  /** @type {object} */
  static ENUMS = ENUMS;

  /**
   * Register all settings
   */
  static registerAll() {
    const { KEYS, registerMenu, localize } = this;
    const PT_TYPES = ENUMS.POINT_TYPES;
    const RTYPES = [PT_TYPES.CENTER, PT_TYPES.FIVE, PT_TYPES.NINE];
    const rangeChoices = {};
    Object.values(RTYPES).forEach(type => rangeChoices[type] = localize(type));

    // ----- Main Settings Menu ----- //
    registerMenu(KEYS.SUBMENU, {
      name: localize(`${KEYS.SUBMENU}.Name`),
      label: localize(`${KEYS.SUBMENU}.Label`),
      icon: "fas fa-user-gear",
      type: ATVSettingsSubmenu,
      restricted: true
    });

    this.registerHidden(KEYS.LIGHT_MONITOR.ALGORITHM, {
      type: String,
      choices: {
        [ENUMS.LIGHT_ALGORITHM_TYPES.NONE]: localize(`${ENUMS.LIGHT_ALGORITHM_TYPES.NONE}`),
        [ENUMS.LIGHT_ALGORITHM_TYPES.TOKENS]: localize(`${ENUMS.LIGHT_ALGORITHM_TYPES.TOKENS}`),
        [ENUMS.LIGHT_ALGORITHM_TYPES.VIEWPOINT]: localize(`${ENUMS.LIGHT_ALGORITHM_TYPES.VIEWPOINT}`),
      },
      default: ENUMS.LIGHT_ALGORITHM_TYPES.NONE,
      onChange: value => Hooks.callAll(`${MODULE_ID}.lightMonitorChanged`, value),
    });

    this.registerWorld(KEYS.DEBUG.RANGE, {
      type: Boolean,
      default: false,
      onChange: value => Hooks.callAll(`${MODULE_ID}.losDebugRangeChanged`, value),
    });

    // ----- NOTE: LOS ---- //

    // Do not use large target for now, until fixed.
    registerLOSSettings(MODULE_ID, this, { threshold: true, largeTarget: false, tokenModifiers: true });

    // ----- NOTE: Submenu ---- //

    // ----- NOTE: Range tab ----- //

    this.registerSubmenuSetting(KEYS.RANGE.ALGORITHM, "range", {
      type: String,
      choices: rangeChoices,
      default: PT_TYPES.NINE,
    });

    this.registerSubmenuSetting(KEYS.RANGE.POINTS3D, "range", {
      type: Boolean,
      default: false,
    });

    this.registerSubmenuSetting(KEYS.RANGE.DISTANCE3D, "range", {
      type: Boolean,
      default: false,
    });
  }

  static migrate() {
    if ( !game.user.isGM ) return;
    this._migrateAlgorithm();
  }

  static _migrateAlgorithm() {
    let alg = this.get(this.KEYS.LOS.TARGET.ALGORITHM);
    switch ( alg ) {

      // If current, can ignore.
      case "los-algorithm-points":
      case "los-algorithm-per-pixel":
      case "los-algorithm-geometric":
      case "los-algorithm-webgl2": return;

      // Points
      case "los-points": alg = "los-algorithm-points"; break;

      // Geometric
      case "los-area-3d":
      case "los-area-3d-geometric": alg = "los-algorithm-geometric"; break;

      // WebGL2
      case "los-area-3d-hybrid":
      case "los-algorithm-hybrid":
      case "los-webgl2":
      case "los-webgpu":
      case "los-algorithm-webgpu":
      case "los-webgpu-async":
      case "los-algorithm-webgpu-async": alg = "los-algorithm-webgl2"; break;

      default: alg = "los-algorithm-points";
    }
    this.set(this.KEYS.LOS.TARGET.ALGORITHM, alg);
  }
}


