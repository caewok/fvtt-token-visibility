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
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { AbstractViewerLOS } from "./LOS/AbstractViewerLOS.js";
import { buildDebugViewer, currentDebugViewerClass, currentCalculator, buildLOSCalculator } from "./LOSCalculator.js";


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
  POINT_TYPES: AbstractViewerLOS.POINT_TYPES,

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
        POINTS: "los-algorithm-points",
        GEOMETRIC: "los-algorithm-geometric",
        PER_PIXEL: "los-algorithm-per-pixel",
        HYBRID: "los-algorithm-hybrid",
        WEBGL2: "los-algorithm-webgl2",
        WEBGPU: "los-algorithm-webgpu",
        WEBGPU_ASYNC: "los-algorithm-webgpu-async"
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
    v060: "migration-v060",
    v080: "migration-v080",
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

  static initializeDebugViewer(type) {
    type ??= this.get(this.KEYS.LOS.TARGET.ALGORITHM);
    const sym = ALG_SYMBOLS[type];
    const debugViewer = this.#debugViewers.get(sym) ?? buildDebugViewer(currentDebugViewerClass(type));
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
      { POINTS: 0, GEOMETRIC: 0, WEBGL2: 0 });
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
      tab: "losViewer",
      onChange: value => this.losSettingChange(VIEWER.NUM_POINTS, value)
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
      tab: "losViewer",
      onChange: value => this.losSettingChange(VIEWER.INSET, value)
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
      onChange: value => this.losSettingChange(TARGET.ALGORITHM, value)
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

    register(KEYS.MIGRATION.v080, {
      scope: "world",
      config: false,
      default: false,
      type: Boolean
    });
  }

  static migrate() {
    if ( !this.get(this.KEYS.MIGRATION.v080) ) {
      let alg = this.get(this.KEYS.LOS.TARGET.ALGORITHM);
      switch ( alg ) {
        case "los-points": alg = "los-algorithm-points"; break;
        case "los-area-3d":
        case "los-area-3d-geometric": alg = "los-algorithm-geometric"; break;
        case "los-area-3d-hybrid": alg = "los-algorithm-hybrid"; break;
        case "los-webgl2": alg = "los-algorithm-webgl2"; break;
        case "los-webgpu": alg = "los-algorithm-webgpu"; break;
        case "los-webgpu-async": alg = "los-algorithm-webgpu-async"; break;
      }
      this.set(this.KEYS.LOS.TARGET.ALGORITHM, alg);
      this.set(this.KEYS.MIGRATION.v080, true);
    }
  }

  static losSettingChange(key, value) {
    this.cache.delete(key);
    const { TARGET, VIEWER } = SETTINGS.LOS;

    if ( key === TARGET.ALGORITHM ) {
      // Set a new shared calculator for all tokens.
      const calc = buildLOSCalculator();
      canvas.tokens.placeables.forEach(token => {
        const losCalc = token[MODULE_ID]?.losCalc;
        if ( !losCalc ) return;
        losCalc.calculator = calc;
      });
    } else if ( key === VIEWER.NUM_POINTS || key === VIEWER.INSET ) {
      // Update the viewpoints for all tokens.
      const config = { [configKeyForSetting[key]]: value };

      canvas.tokens.placeables.forEach(token => {
        const losCalc = token.vision?.[MODULE_ID]?.losCalc;
        if ( !losCalc ) return;
        losCalc.initializeViewpoints(config);
      });
    } else if ( key === TARGET.PERCENT ) {
      // Update the threshold percentage for all tokens.
      canvas.tokens.placeables.forEach(token => {
        const losCalc = token.vision?.[MODULE_ID]?.losCalc;
        if ( !losCalc ) return;
        losCalc.threshold = value;
      });
    } else {
      // Change to the calculator config.
      const config = foundry.utils.expandObject({ [configKeyForSetting[key]]: value });
      const currCalc = currentCalculator();
      currCalc.config = config;
    }

    // Start up a new debug viewer.
    if ( key === TARGET.ALGORITHM
      && this.get(this.KEYS.DEBUG.LOS) ) this.initializeDebugViewer(value);
  }
}

const configKeyForSetting = {
  [SETTINGS.LOS.TARGET.LARGE]: "largeTarget",
  [SETTINGS.LOS.TARGET.PERCENT]: "threshold",

  // Viewpoints.
  [SETTINGS.LOS.TARGET.ALGORITHM]: "viewpointClass",
  [SETTINGS.LOS.VIEWER.NUM_POINTS]: "numViewpoints",
  [SETTINGS.LOS.VIEWER.INSET]: "viewpointOffset",

  // Points viewpoints.
  [SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS]: "pointAlgorithm",
  [SETTINGS.LOS.TARGET.POINT_OPTIONS.INSET]: "targetInset",
  [SETTINGS.LOS.TARGET.POINT_OPTIONS.POINTS3D]: "points3d",

  // Blocking
  [SETTINGS.LIVE_TOKENS_BLOCK]: "blocking.tokens.live",
  [SETTINGS.DEAD_TOKENS_BLOCK]: "blocking.tokens.dead",
  [SETTINGS.PRONE_TOKENS_BLOCK]: "blocking.tokens.prone",
}

const ALG_SYMBOLS = {};
Object.values(SETTINGS.LOS.TARGET.TYPES).forEach(value => ALG_SYMBOLS[value] = Symbol(value));
