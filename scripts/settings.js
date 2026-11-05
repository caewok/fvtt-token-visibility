/* globals
CONFIG,
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, SETTINGS, pointIndicesLabels, ENUMS } from "./const.js";
import { ATVSettingsSubmenu } from "./ATVSettingsSubmenu.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { GeometricPrimitive } from "./geometry/placeable_geometry/GeometricPrimitive.js";
import { GEOMETRY_LIB_ID } from "./geometry/const.js";

export class Settings extends ModuleSettingsAbstract {

  /** @type {object} */
  static KEYS = SETTINGS;

  /** @type {object} */
  static ENUMS = ENUMS;

  /**
   * Register all settings
   */
  static registerAll() {
    const { KEYS, register, registerMenu, localize } = this;
    const PT_TYPES = ENUMS.POINT_TYPES;
    const RTYPES = [PT_TYPES.CENTER, PT_TYPES.FIVE, PT_TYPES.NINE];
    const PT_OPTS = KEYS.LOS.TARGET.POINT_OPTIONS;
    const LTYPES = ENUMS.ALGORITHM_TYPES;
    const losChoices = {};
    const rangeChoices = {};
    Object.values(RTYPES).forEach(type => rangeChoices[type] = localize(type));
    Object.values(LTYPES).forEach(type => losChoices[type] = localize(type));

    // ----- Main Settings Menu ----- //
    registerMenu(KEYS.SUBMENU, {
      name: localize(`${KEYS.SUBMENU}.Name`),
      label: localize(`${KEYS.SUBMENU}.Label`),
      icon: "fas fa-user-gear",
      type: ATVSettingsSubmenu,
      restricted: true
    });

    register(KEYS.LIGHT_MONITOR.ALGORITHM, {
      name: localize(`${KEYS.LIGHT_MONITOR.ALGORITHM}.Name`),
      hint: localize(`${KEYS.LIGHT_MONITOR.ALGORITHM}.Hint`),
      scope: "world",
      config: false,
      type: String,
      choices: {
        [ENUMS.LIGHT_ALGORITHM_TYPES.NONE]: localize(`${ENUMS.LIGHT_ALGORITHM_TYPES.NONE}`),
        [ENUMS.LIGHT_ALGORITHM_TYPES.TOKENS]: localize(`${ENUMS.LIGHT_ALGORITHM_TYPES.TOKENS}`),
        [ENUMS.LIGHT_ALGORITHM_TYPES.VIEWPOINT]: localize(`${ENUMS.LIGHT_ALGORITHM_TYPES.VIEWPOINT}`),
      },
      default: ENUMS.LIGHT_ALGORITHM_TYPES.NONE,
      onChange: value => Hooks.callAll(`${MODULE_ID}.lightMonitorChanged`, value),
    });

    register(KEYS.DEBUG.RANGE, {
      name: localize(`${KEYS.DEBUG.RANGE}.Name`),
      hint: localize(`${KEYS.DEBUG.RANGE}.Hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
      onChange: value =>  Hooks.callAll(`${MODULE_ID}.losDebugRangeChanged`, value),
    });

    register(KEYS.DEBUG.LOS, {
      name: localize(`${KEYS.DEBUG.LOS}.Name`),
      hint: localize(`${KEYS.DEBUG.LOS}.Hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
      onChange: value => Hooks.callAll(`${MODULE_ID}.losDebugLOSChanged`, value),
    });

    // ----- NOTE: Submenu ---- //

    // ----- NOTE: Range tab ----- //

    register(KEYS.RANGE.ALGORITHM, {
      name: localize(`${KEYS.RANGE.ALGORITHM}.Name`),
      hint: localize(`${KEYS.RANGE.ALGORITHM}.Hint`),
      scope: "world",
      config: false,
      type: String,
      choices: rangeChoices,
      default: PT_TYPES.NINE,
      tab: "range"
    });

    register(KEYS.RANGE.POINTS3D, {
      name: localize(`${KEYS.RANGE.POINTS3D}.Name`),
      hint: localize(`${KEYS.RANGE.POINTS3D}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      tab: "range"
    });

    register(KEYS.RANGE.DISTANCE3D, {
      name: localize(`${KEYS.RANGE.DISTANCE3D}.Name`),
      hint: localize(`${KEYS.RANGE.DISTANCE3D}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      tab: "range"
    });

    // ----- NOTE: Line-of-sight viewer tab ----- //
    const VIEWER = KEYS.LOS.VIEWER;
    const PI = GeometricPrimitive.POINT_INDICES;
    register(VIEWER.POINTS, {
      name: localize(`${VIEWER.POINTS}.Name`),
      hint: localize(`${VIEWER.POINTS}.Hint`),
      scope: "world",
      config: false,
      tab: "losViewer",
      default: [PI.CENTER],
      type: new foundry.data.fields.SetField(new foundry.data.fields.StringField({
        required: true,
        blank: false,
        initial: PI.CENTER,
        choices: pointIndicesLabels(MODULE_ID, "viewer"),
      })),
    });

    register(VIEWER.INSETS.TOP, {
      name: localize(`${VIEWER.INSETS.TOP}.Name`),
      hint: localize(`${VIEWER.INSETS.TOP}.Hint`),
      range: {
        max: 0.99,
        min: 0,
        step: 0.01
      },
      scope: "world",
      config: false,
      default: 0,
      type: Number,
      tab: "losViewer",
    });

    register(VIEWER.INSETS.BOTTOM, {
      name: localize(`${VIEWER.INSETS.BOTTOM}.Name`),
      hint: localize(`${VIEWER.INSETS.BOTTOM}.Hint`),
      range: {
        max: 0.99,
        min: 0,
        step: 0.01
      },
      scope: "world",
      config: false,
      default: 0,
      type: Number,
      tab: "losViewer",
    });

    register(VIEWER.INSETS.SIDES, {
      name: localize(`${VIEWER.INSETS.SIDES}.Name`),
      hint: localize(`${VIEWER.INSETS.SIDES}.Hint`),
      range: {
        max: 0.99,
        min: 0,
        step: 0.01
      },
      scope: "world",
      config: false,
      default: 0,
      type: Number,
      tab: "losViewer",
    });

    // ----- NOTE: Line-of-sight target tab ----- //
    const TARGET = KEYS.LOS.TARGET;

    register(TARGET.ALGORITHM, {
      name: localize(`${TARGET.ALGORITHM}.Name`),
      hint: localize(`${TARGET.ALGORITHM}.Hint`),
      scope: "world",
      config: false,
      type: String,
      choices: losChoices,
      default: LTYPES.POINTS,
      tab: "losTarget",
      onChange: value => Hooks.callAll(`${MODULE_ID}.losAlgorithmChanged`, value),
    });

    register(TARGET.PERCENT, {
      name: localize(`${TARGET.PERCENT}.Name`),
      hint: localize(`${TARGET.PERCENT}.Hint`),
      range: {
        max: 1,
        min: 0,
        step: 0.05
      },
      scope: "world",
      config: false, // () => getSetting(KEYS.LOS.ALGORITHM) !== LTYPES.POINTS,
      default: 0,
      type: Number,
      tab: "losTarget",
    });

    register(TARGET.LARGE, {
      name: localize(`${TARGET.LARGE}.Name`),
      hint: localize(`${TARGET.LARGE}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      // tab: "losTarget", // Disable setting for now.
    });

    register(PT_OPTS.POINTS, {
      name: localize(`${PT_OPTS.POINTS}.Name`),
      hint: localize(`${PT_OPTS.POINTS}.Hint`),
      scope: "world",
      config: false,
      tab: "losTarget",
      default: [PI.CENTER],
      type: new foundry.data.fields.SetField(new foundry.data.fields.StringField({
        required: true,
        blank: false,
        initial: PI.CENTER,
        choices: pointIndicesLabels(MODULE_ID),
      })),
    });

    register(PT_OPTS.INSET, {
      name: localize(`${PT_OPTS.INSET}.Name`),
      hint: localize(`${PT_OPTS.INSET}.Hint`),
      range: {
        max: 0.99,
        min: 0,
        step: 0.01
      },
      scope: "world",
      config: false, // () => getSetting(KEYS.LOS.ALGORITHM) !== LTYPES.POINTS,
      default: 0.75,
      type: Number,
      tab: "losTarget",
    });

    // ----- NOTE: Other tab ----- //

    register(KEYS.LIVE_TOKENS_BLOCK, {
      name: localize(`${KEYS.LIVE_TOKENS_BLOCK}.Name`),
      hint: localize(`${KEYS.LIVE_TOKENS_BLOCK}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      tab: "other"
    });

    register(KEYS.DEAD_TOKENS_BLOCK, {
      name: localize(`${KEYS.DEAD_TOKENS_BLOCK}.Name`),
      hint: localize(`${KEYS.DEAD_TOKENS_BLOCK}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      tab: "other"
    });

    register(KEYS.PRONE_TOKENS_BLOCK, {
      name: localize(`${KEYS.PRONE_TOKENS_BLOCK}.Name`),
      hint: localize(`${KEYS.PRONE_TOKENS_BLOCK}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      tab: "other"
    });

    register(KEYS.PRONE_MULTIPLIER, {
      name: localize(`${KEYS.PRONE_MULTIPLIER}.Name`),
      hint: localize(`${KEYS.PRONE_MULTIPLIER}.Hint`),
      scope: "world",
      config: false,
      type: Number,
      range: {
        max: 1,  // Prone equivalent to standing.
        min: 0,  // Prone equivalent to (almost) not being there at all. Will set to a single pixel.
        step: 0.1
      },
      default: CONFIG[GEOMETRY_LIB_ID].CONFIG.proneMultiplier ?? 0.33, // Same as Wall Height
      onChange: value => CONFIG[GEOMETRY_LIB_ID].CONFIG.proneMultiplier = value,
      tab: "other"
    });

    register(KEYS.PRONE_STATUS_ID, {
      name: localize(`${KEYS.PRONE_STATUS_ID}.Name`),
      hint: localize(`${KEYS.PRONE_STATUS_ID}.Hint`),
      scope: "world",
      config: false,
      type: String,
      default: CONFIG[GEOMETRY_LIB_ID].CONFIG.proneStatusId || "prone",
      onChange: value => CONFIG[GEOMETRY_LIB_ID].CONFIG.proneStatusId = value,
      tab: "other"
    });

    register(KEYS.TOKEN_HP_ATTRIBUTE, {
      name: localize(`${KEYS.TOKEN_HP_ATTRIBUTE}.Name`),
      hint: localize(`${KEYS.TOKEN_HP_ATTRIBUTE}.Hint`),
      scope: "world",
      config: false,
      type: String,
      default: CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenHPId || "system.attributes.hp.value",
      tab: "other",
      onChange: value => CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenHPId = value
    });

    // Make sure these are linked at the start.
    CONFIG[GEOMETRY_LIB_ID].CONFIG.proneMultiplier = this.get(KEYS.PRONE_MULTIPLIER);
    CONFIG[GEOMETRY_LIB_ID].CONFIG.proneStatusId = this.get(KEYS.PRONE_STATUS_ID);
    CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenHPId = this.get(KEYS.TOKEN_HP_ATTRIBUTE);
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

      default: "los-algorithm-points";
    }
    this.set(this.KEYS.LOS.TARGET.ALGORITHM, alg);
  }
}


