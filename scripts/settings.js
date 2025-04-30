/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { SettingsSubmenu } from "./SettingsSubmenu.js";
import { registerArea3d } from "./patching.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { buildLOSCalculator } from "./LOSCalculator.js";
import {
  DebugVisibilityViewerArea3dPIXI,
  DebugVisibilityViewerPoints,
  DebugVisibilityViewerWebGL2,
  DebugVisibilityViewerWebGPU,
  DebugVisibilityViewerWebGPUAsync } from "./LOS/DebugVisibilityViewer.js";

// Patches for the Setting class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

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
    TWO: "points-two",
    THREE: "points-three", //
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
        AREA3D: "los-area-3d",
        AREA3D_GEOMETRIC: "los-area-3d-geometric",
        AREA3D_WEBGL2: "los-area-3d-webgl2",
        AREA3D_HYBRID: "los-area-3d-hybrid",
        WEBGL2: "los-webgl2",
        WEBGPU: "los-webgpu",
        WEBGPU_ASYNC: "los-webgpu-async"
      },
      POINT_OPTIONS: {
        NUM_POINTS: "los-points-target",
        INSET: "los-inset-target",
        POINTS3D: "los-points-3d"
      }
    }
  },

  PRONE_STATUS_ID: "prone-status-id",
  TOKEN_HP_ATTRIBUTE: "token-hp-attribute",

  PRONE_MULTIPLIER: "prone-multiplier",
  VISION_HEIGHT_MULTIPLIER: "vision-height-multiplier",

  LIVE_TOKENS_BLOCK: "live-tokens-block",
  DEAD_TOKENS_BLOCK: "dead-tokens-block",
  PRONE_TOKENS_BLOCK: "prone-tokens-block",

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

export class Settings extends ModuleSettingsAbstract {

  /** @type {object} */
  static KEYS = SETTINGS;

  /** @type {PIXI.Graphics} */
  static #DEBUG_RANGE;

  static get DEBUG_RANGE() { return canvas.tokens.children.find(c => c[`${MODULE_ID}_rangeDebug`]); }

  static initializeDebugGraphics() {
    this.#DEBUG_RANGE = new PIXI.Graphics();
    this.#DEBUG_RANGE.eventMode = "passive";

    this.#DEBUG_RANGE[`${MODULE_ID}_rangeDebug`] = true;
    canvas.tokens.addChild(this.#DEBUG_RANGE);
  }

  // Don't need to destroy b/c they are destroyed as part of canvas.tokens.
  //   static destroyDebugGraphics() {
  //     if ( !this.#DEBUG_LOS.destroyed() ) this.#DEBUG_LOS.destroy();
  //     if ( !this.#DEBUG_RANGE.destroyed() ) this.#DEBUG_RANGE.destroy();
  //   }

  static toggleRangeDebugGraphics(_enabled) {
    this.DEBUG_RANGE.clear();
  }

  static #debugViewers = new WeakMap();

  static getDebugViewer(type) {
    type ??= this.get(this.KEYS.LOS.TARGET.ALGORITHM);
    const sym = ALG_SYMBOLS[type];
    return this.#debugViewers.get(sym);
  }

  static async initializeDebugViewer(type) {
    type ??= this.get(this.KEYS.LOS.TARGET.ALGORITHM);
    const sym = ALG_SYMBOLS[type];
    let debugViewer;
    if ( this.#debugViewers.has(sym) ) debugViewer = this.#debugViewers.get(sym);
    else {
      const TYPES = this.KEYS.LOS.TARGET.TYPES;
      switch ( type ) {
        case TYPES.POINTS: debugViewer = new DebugVisibilityViewerPoints(); break;
        case TYPES.AREA3D:
        case TYPES.AREA3D_GEOMETRIC: {
          debugViewer = new DebugVisibilityViewerArea3dPIXI();
          debugViewer.algorithm = DebugVisibilityViewerArea3dPIXI.ALGORITHMS.AREA3D_GEOMETRIC;
          break;
        }
        case TYPES.AREA3D_WEBGL2: {
          debugViewer = new DebugVisibilityViewerArea3dPIXI();
          debugViewer.algorithm = DebugVisibilityViewerArea3dPIXI.ALGORITHMS.AREA3D_WEBGL2;
          break;
        }
        case TYPES.AREA3D_HYBRID: {
          debugViewer = new DebugVisibilityViewerArea3dPIXI();
          debugViewer.algorithm = DebugVisibilityViewerArea3dPIXI.ALGORITHMS.AREA3D_HYBRID;
          break;
        }
        case TYPES.WEBGL2: debugViewer = new DebugVisibilityViewerWebGL2(); break;
        case TYPES.WEBGPU: {
          debugViewer = CONFIG[MODULE_ID].webGPUDevice
          ? new DebugVisibilityViewerWebGPU({ device: CONFIG[MODULE_ID].webGPUDevice })
          : new DebugVisibilityViewerWebGL2();
          break;
        }
        case TYPES.WEBGPU_ASYNC: {
          debugViewer = CONFIG[MODULE_ID].webGPUDevice
          ? new DebugVisibilityViewerWebGPUAsync({ device: CONFIG[MODULE_ID].webGPUDevice })
          : new DebugVisibilityViewerWebGL2();
          break;
        }
      }
    }
    await debugViewer.initialize();
    debugViewer.render();
    this.#debugViewers.set(sym, debugViewer);
  }

  static destroyAllDebugViewers() {
    for ( const type of Object.values(this.KEYS.LOS.TARGET.TYPES) ) this.destroyDebugViewer(type);
  }

  static destroyDebugViewer(type) {
    type ??= this.get(this.KEYS.LOS.TARGET.ALGORITHM);
    const sym = ALG_SYMBOLS[type];
    if ( !this.#debugViewers.has(sym) ) return;
    const debugViewer = this.#debugViewers.get(sym);
    debugViewer.destroy();
    this.#debugViewers.delete(sym);
  }

  static toggleLOSDebugGraphics(enabled = false) {
    if ( enabled ) this.initializeDebugViewer();
    else this.destroyAllDebugViewers();
  }

  /**
   * Register all settings
   */
  static registerAll() {
    const { KEYS, register, registerMenu, localize } = this;
    const PT_TYPES = KEYS.POINT_TYPES;
    const RTYPES = [PT_TYPES.CENTER, PT_TYPES.FIVE, PT_TYPES.NINE];
    const PT_OPTS = KEYS.LOS.TARGET.POINT_OPTIONS;
    const LTYPES = foundry.utils.filterObject(KEYS.LOS.TARGET.TYPES,
      { POINTS: 0, AREA3D_GEOMETRIC: 0, AREA3D_WEBGL2: 0, AREA3D_HYBRID: 0, WEBGL2: 0, WEBGPU: 0, WEBGPU_ASYNC: 0 });
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
      onChange: value => this.toggleRangeDebugGraphics(value)
    });

    register(KEYS.DEBUG.LOS, {
      name: localize(`${KEYS.DEBUG.LOS}.Name`),
      hint: localize(`${KEYS.DEBUG.LOS}.Hint`),
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
      onChange: value => this.toggleLOSDebugGraphics(value)
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
      onChange: value => this.losSettingChange(TARGET.PERCENT, value)
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

    // ----- NOTE: Other tab ----- //

    register(KEYS.LIVE_TOKENS_BLOCK, {
      name: localize(`${KEYS.LIVE_TOKENS_BLOCK}.Name`),
      hint: localize(`${KEYS.LIVE_TOKENS_BLOCK}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      onChange: value => this.losSettingChange(KEYS.LIVE_TOKENS_BLOCK, value),
      tab: "other"
    });

    register(KEYS.DEAD_TOKENS_BLOCK, {
      name: localize(`${KEYS.DEAD_TOKENS_BLOCK}.Name`),
      hint: localize(`${KEYS.DEAD_TOKENS_BLOCK}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      onChange: value => this.losSettingChange(KEYS.DEAD_TOKENS_BLOCK, value),
      tab: "other"
    });

    register(KEYS.PRONE_TOKENS_BLOCK, {
      name: localize(`${KEYS.PRONE_TOKENS_BLOCK}.Name`),
      hint: localize(`${KEYS.PRONE_TOKENS_BLOCK}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      onChange: value => this.losSettingChange(KEYS.PRONE_TOKENS_BLOCK, value),
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
      default: CONFIG.GeometryLib.proneMultiplier ?? 0.33, // Same as Wall Height
      onChange: value => CONFIG.GeometryLib.proneMultiplier = value,
      tab: "other"
    });

    register(KEYS.VISION_HEIGHT_MULTIPLIER, {
      name: localize(`${KEYS.VISION_HEIGHT_MULTIPLIER}.Name`),
      hint: localize(`${KEYS.VISION_HEIGHT_MULTIPLIER}.Hint`),
      scope: "world",
      config: false,
      type: Number,
      range: {
        max: 1,  // At token top.
        min: 0,  // At token bottom.
        step: 0.1
      },
      default: CONFIG.GeometryLib.visionHeightMultiplier ?? 0.9,
      onChange: value => CONFIG.GeometryLib.visionHeightMultiplier = value,
      tab: "other"
    });

    register(KEYS.PRONE_STATUS_ID, {
      name: localize(`${KEYS.PRONE_STATUS_ID}.Name`),
      hint: localize(`${KEYS.PRONE_STATUS_ID}.Hint`),
      scope: "world",
      config: false,
      type: String,
      default: CONFIG.GeometryLib.proneStatusId || "prone",
      onChange: value => CONFIG.GeometryLib.proneStatusId = value,
      tab: "other"
    });

    register(KEYS.TOKEN_HP_ATTRIBUTE, {
      name: localize(`${KEYS.TOKEN_HP_ATTRIBUTE}.Name`),
      hint: localize(`${KEYS.TOKEN_HP_ATTRIBUTE}.Hint`),
      scope: "world",
      config: false,
      type: String,
      default: CONFIG.GeometryLib.tokenHPId || "system.attributes.hp.value",
      tab: "other",
      onChange: value => CONFIG.GeometryLib.tokenHPId = value
    });

    // Make sure these are linked at the start.
    CONFIG.GeometryLib.proneMultiplier = this.get(KEYS.PRONE_MULTIPLIER);
    CONFIG.GeometryLib.visionHeightMultiplier = this.get(KEYS.VISION_HEIGHT_MULTIPLIER);
    CONFIG.GeometryLib.proneStatusId = this.get(KEYS.PRONE_STATUS_ID);
    CONFIG.GeometryLib.tokenHPId = this.get(KEYS.TOKEN_HP_ATTRIBUTE);

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

    // ----- NOTE: Triggers based on starting settings ---- //
    // Start debug
    if ( this.get(this.KEYS.DEBUG.LOS) ) this.toggleLOSDebugGraphics(true);

    // Register the Area3D methods on initial load.
    // if ( this.typesWebGL2.has(this.get(TARGET.ALGORITHM)) ) registerArea3d();
    registerArea3d();
  }

  static typesWebGL2 = new Set([
    SETTINGS.LOS.TARGET.TYPES.AREA3D,
    SETTINGS.LOS.TARGET.TYPES.AREA3D_WEBGL2,
    SETTINGS.LOS.TARGET.TYPES.AREA3D_HYBRID]);

  static typesArea3d = new Set([
    SETTINGS.LOS.TARGET.TYPES.AREA3D,
    SETTINGS.LOS.TARGET.TYPES.AREA3D_GEOMETRIC,
    SETTINGS.LOS.TARGET.TYPES.AREA3D_WEBGL2,
    SETTINGS.LOS.TARGET.TYPES.AREA3D_HYBRID,
    SETTINGS.LOS.TARGET.TYPES.WEBGL2,
    SETTINGS.LOS.TARGET.TYPES.WEBGPU,
    SETTINGS.LOS.TARGET.TYPES.WEBGPU_ASYNC,
  ])

  static losAlgorithmChange(key, value) {
    this.cache.delete(key);
    if ( this.typesWebGL2.has(value) ) registerArea3d();
    canvas.tokens.placeables.forEach(token => {
      if ( !token.vision ) return;
      const obj = token.vision[MODULE_ID] ??= {};
      obj.losCalc?.destroy();
      obj.losCalc = buildLOSCalculator(token);
    });

    // Start up a new debug viewer.
    if ( this.get(this.KEYS.DEBUG.LOS) ) this.initializeDebugViewer(value);
  }

  static losSettingChange(key, value) {
    this.cache.delete(key);
    canvas.tokens.placeables.forEach(token => {
      const calc = token.vision?.[MODULE_ID]?.losCalc;
      if ( !calc ) return;
      calc.config[key] = value;
    });
  }
}

const ALG_SYMBOLS = {};
Object.values(SETTINGS.LOS.TARGET.TYPES).forEach(value => ALG_SYMBOLS[value] = Symbol(value));
