/* globals
canvas,
foundry,
game,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { SettingsSubmenu } from "./SettingsSubmenu.js";
import { LOS_CALCULATOR } from "./visibility_los.js";
import { registerArea3d, deregisterArea3d } from "./patching.js";

// Patches for the Setting class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Wipe the settings cache on update
 */
function updateSetting(document, change, options, userId) {  // eslint-disable-line no-unused-vars
  const [module, ...arr] = document.key.split(".");
  const key = arr.join("."); // If the key has periods, multiple will be returned by split.
  if ( module === MODULE_ID && Settings.cache.has(key) ) Settings.cache.delete(key);
}

PATCHES.BASIC.HOOKS = { updateSetting };


/* Testing cached settings
function fnDefault(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}

N = 1000
await api.bench.QBenchmarkLoopFn(N, getSetting, "cached", "cover-algorithm")
await api.bench.QBenchmarkLoopFn(N, fnDefault, "default", "cover-algorithm")

await api.bench.QBenchmarkLoopFn(N, getSetting, "cached","cover-token-dead")
await api.bench.QBenchmarkLoopFn(N, fnDefault, "default","cover-token-dead")

await api.bench.QBenchmarkLoopFn(N, getSetting, "cached","cover-token-live")
await api.bench.QBenchmarkLoopFn(N, fnDefault, "default","cover-token-live")
*/

export const SETTINGS = {
  AREA3D_USE_SHADOWS: "area3d-use-shadows", // For benchmarking and debugging for now.
  SUBMENU: "submenu",
  POINT_TYPES: {
    CENTER: "points-center",
    FOUR: "points-four", // Five without center
    FIVE: "points-five", // Corners + center
    EIGHT: "points-eight", // Nine without center
    NINE: "points-nine" // Corners, midpoints, center
  },

  RANGE: {
    ALGORITHM: "range-algorithm",
    POINTS3D: "range-points-3d",
    DISTANCE3D: "range-distance-3d"
  },

  LOS: {
    VIEWER: {
      NUM_POINTS: "los-points-viewer",
      INSET: "los-inset-viewer"
    },

    TARGET: {
      ALGORITHM: "los-algorithm",
      PERCENT: "los-percent",
      LARGE: "los-large-target",
      TYPES: {
        POINTS: "los-points",
        AREA2D: "los-area-2d",
        AREA3D: "los-area-3d",
        AREA3D_GEOMETRIC: "los-area-3d-geometric",
        AREA3D_WEBGL1: "los-area-3d-webgl1",
        AREA3D_WEBGL2: "los-area-3d-webgl2",
        AREA3D_HYBRID: "los-area-3d-hybrid"
      },
      POINT_OPTIONS: {
        NUM_POINTS: "los-points-target",
        INSET: "los-inset-target",
        POINTS3D: "los-points-3d"
      }
    }
  },

  CHANGELOG: "changelog",
  DEBUG: {
    RANGE: "debug-range",
    LOS: "debug-los"
  },

  WELCOME_DIALOG: {
    v020: "welcome-dialog-v0-20",
    v030: "welcome-dialog-v0-30"
  },

  MIGRATION: {
    v032: "migration-v032",
    v054: "migration-v054",
    v060: "migration-v060"
  }
};

export class Settings {
  /** @type {Map<string, *>} */
  static cache = new Map();

  /** @type {object} */
  static KEYS = SETTINGS;

  /** @type {PIXI.Graphics} */
  static #DEBUG_LOS;

  /** @type {PIXI.Graphics} */
  static #DEBUG_RANGE;

  static get DEBUG_LOS() { return canvas.tokens.children.find(c => c[`${MODULE_ID}_losDebug`]); }

  static get DEBUG_RANGE() { return canvas.tokens.children.find(c => c[`${MODULE_ID}_rangeDebug`]); }

  static initializeDebugGraphics() {
    this.#DEBUG_LOS = new PIXI.Graphics();
    this.#DEBUG_RANGE = new PIXI.Graphics();
    this.#DEBUG_LOS.eventMode = "passive"; // Allow targeting, selection to pass through.
    this.#DEBUG_RANGE.eventMode = "passive";

    this.#DEBUG_LOS[`${MODULE_ID}_losDebug`] = true;
    this.#DEBUG_RANGE[`${MODULE_ID}_rangeDebug`] = true;
    canvas.tokens.addChild(this.#DEBUG_LOS);
    canvas.tokens.addChild(this.#DEBUG_RANGE);
  }

  // Don't need to destroy b/c they are destroyed as part of canvas.tokens.
  //   static destroyDebugGraphics() {
  //     if ( !this.#DEBUG_LOS.destroyed() ) this.#DEBUG_LOS.destroy();
  //     if ( !this.#DEBUG_RANGE.destroyed() ) this.#DEBUG_RANGE.destroy();
  //   }

  static clearDebugGraphics() {
    LOS_CALCULATOR.CALCULATOR.calc.clearDebug();
    this.DEBUG_RANGE.clear();
  }

  static updateLOSDebugGraphics(enable) {
    const calc = LOS_CALCULATOR.CALCULATOR.calc;
    if ( enable ) calc.enableDebug();
    else calc.disableDebug();
  }

  /**
   * Retrive a specific setting.
   * Cache the setting.  For caching to work, need to clean the cache whenever a setting below changes.
   * @param {string} key
   * @returns {*}
   */
  static get(key) {
    // TODO: Bring back a working cache.

    const cached = this.cache.get(key);
    if ( typeof cached !== "undefined" ) {
      const origValue = game.settings.get(MODULE_ID, key);
      if ( origValue !== cached ) {
        console.debug(`Settings cache fail: ${origValue} !== ${cached} for key ${key}`);
        return origValue;
      }

      return cached;

    }
    const value = game.settings.get(MODULE_ID, key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set a specific setting.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<boolean>}
   */
  static async set(key, value) {
    this.cache.delete(key);
    return game.settings.set(MODULE_ID, key, value);
  }

  /**
   * Register a specific setting.
   * @param {string} key        Passed to registerMenu
   * @param {object} options    Passed to registerMenu
   */
  static register(key, options) { game.settings.register(MODULE_ID, key, options); }

  /**
   * Register a submenu.
   * @param {string} key        Passed to registerMenu
   * @param {object} options    Passed to registerMenu
   */
  static registerMenu(key, options) { game.settings.registerMenu(MODULE_ID, key, options); }

  /**
   * Register all settings
   */
  static registerAll() {
    const { KEYS, register, registerMenu } = this;
    const localize = key => game.i18n.localize(`${MODULE_ID}.settings.${key}`);
    const PT_TYPES = KEYS.POINT_TYPES;
    const RTYPES = [PT_TYPES.CENTER, PT_TYPES.FIVE, PT_TYPES.NINE];
    const PT_OPTS = KEYS.LOS.TARGET.POINT_OPTIONS;
    const LTYPES = foundry.utils.filterObject(KEYS.LOS.TARGET.TYPES, { POINTS: 0, AREA2D: 0, AREA3D: 0 });
    const losChoices = {};
    const ptChoices = {};
    const rangeChoices = {};
    Object.values(RTYPES).forEach(type => rangeChoices[type] = localize(type));
    Object.values(LTYPES).forEach(type => losChoices[type] = localize(type));
    Object.values(PT_TYPES).forEach(type => ptChoices[type] = localize(type));

    // ----- Main Settings Menu ----- //
    registerMenu(KEYS.SUBMENU, {
      name: localize(`${KEYS.SUBMENU}.Name`),
      label: localize(`${KEYS.SUBMENU}.Label`),
      icon: "fas fa-user-gear",
      type: SettingsSubmenu,
      restricted: true
    });

    register(KEYS.DEBUG.RANGE, {
      name: localize(`${KEYS.DEBUG.RANGE}.Name`),
      hint: localize(`${KEYS.DEBUG.RANGE}.Hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
      onChange: _value => this.clearDebugGraphics()
    });

    register(KEYS.DEBUG.LOS, {
      name: localize(`${KEYS.DEBUG.LOS}.Name`),
      hint: localize(`${KEYS.DEBUG.LOS}.Hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
      onChange: value => this.updateLOSDebugGraphics(value)
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
      default: RTYPES.NINE,
      tab: "range"
    });

    register(KEYS.RANGE.POINTS3D, {
      name: localize(`${KEYS.RANGE.POINTS3D}.Name`),
      hint: localize(`${KEYS.RANGE.POINTS3D}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
      tab: "range"
    });

    register(KEYS.RANGE.DISTANCE3D, {
      name: localize(`${KEYS.RANGE.DISTANCE3D}.Name`),
      hint: localize(`${KEYS.RANGE.DISTANCE3D}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
      tab: "range"
    });

    // ----- NOTE: Line-of-sight viewer tab ----- //
    const VIEWER = KEYS.LOS.VIEWER;
    register(VIEWER.NUM_POINTS, {
      name: localize(`${VIEWER.NUM_POINTS}.Name`),
      hint: localize(`${VIEWER.NUM_POINTS}.Hint`),
      scope: "world",
      config: false,
      type: String,
      choices: ptChoices,
      default: PT_TYPES.CENTER,
      tab: "losViewer"
    });

    register(VIEWER.INSET, {
      name: localize(`${VIEWER.INSET}.Name`),
      hint: localize(`${VIEWER.INSET}.Hint`),
      range: {
        max: 0.99,
        min: 0,
        step: 0.01
      },
      scope: "world",
      config: false,
      default: 0.75,
      type: Number,
      tab: "losViewer"
    });

    // ----- NOTE: Line-of-sight target tab ----- //
    const TARGET = KEYS.LOS.TARGET;
    register(TARGET.LARGE, {
      name: localize(`${TARGET.LARGE}.Name`),
      hint: localize(`${TARGET.LARGE}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
      tab: "losTarget",
      onChange: value => this.losSettingChange(TARGET.LARGE, value)
    });

    register(TARGET.ALGORITHM, {
      name: localize(`${TARGET.ALGORITHM}.Name`),
      hint: localize(`${TARGET.ALGORITHM}.Hint`),
      scope: "world",
      config: false,
      type: String,
      choices: losChoices,
      default: LTYPES.NINE,
      tab: "losTarget",
      onChange: value => this.losAlgorithmChange(TARGET.ALGORITHM, value)
    });

    // Register the Area3D methods on initial load.
    if ( this.typesWebGL2.has(this.get(TARGET.ALGORITHM)) ) registerArea3d();
    else deregisterArea3d();

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
      tab: "losTarget"
    });

    register(PT_OPTS.NUM_POINTS, {
      name: localize(`${PT_OPTS.NUM_POINTS}.Name`),
      hint: localize(`${PT_OPTS.NUM_POINTS}.Hint`),
      scope: "world",
      config: false,
      type: String,
      choices: ptChoices,
      default: PT_TYPES.NINE,
      tab: "losTarget",
      onChange: value => this.losSettingChange(PT_OPTS.NUM_POINTS, value)
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
      onChange: value => this.losSettingChange(PT_OPTS.INSET, value)
    });

    register(PT_OPTS.POINTS3D, {
      name: localize(`${PT_OPTS.POINTS3D}.Name`),
      hint: localize(`${PT_OPTS.POINTS3D}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
      tab: "losTarget",
      onChange: value => this.losSettingChange(PT_OPTS.POINTS3D, value)
    });

    // ----- NOTE: Hidden settings ----- //

    register(KEYS.AREA3D_USE_SHADOWS, {
      scope: "world",
      config: false,
      type: Boolean,
      default: false
    });

    register(KEYS.WELCOME_DIALOG.v030, {
      scope: "world",
      config: false,
      default: false,
      type: Boolean
    });

    register(KEYS.MIGRATION.v032, {
      scope: "world",
      config: false,
      default: false,
      type: Boolean
    });

    register(KEYS.MIGRATION.v054, {
      scope: "world",
      config: false,
      default: false,
      type: Boolean
    });

    register(KEYS.MIGRATION.v060, {
      scope: "world",
      config: false,
      default: false,
      type: Boolean
    });
  }

  static typesWebGL2 = new Set([
    SETTINGS.LOS.TARGET.TYPES.AREA3D,
    SETTINGS.LOS.TARGET.TYPES.AREA3D_WEBGL2,
    SETTINGS.LOS.TARGET.TYPES.AREA3D_HYBRID]);

  static losAlgorithmChange(key, value) {
    this.cache.delete(key);
    if ( this.typesWebGL2.has(value) ) registerArea3d();
    else deregisterArea3d();

    LOS_CALCULATOR.CALCULATOR._updateAlgorithm();
  }

  static losSettingChange(key, _value) {
    this.cache.delete(key);
    LOS_CALCULATOR.CALCULATOR._updateConfigurationSettings();
  }
}
