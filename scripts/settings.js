/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TRACKER_IDS } from "./const.js";
import { ATVSettingsSubmenu } from "./ATVSettingsSubmenu.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { buildDebugViewer, currentDebugViewerClass, currentCalculator, buildLOSCalculator } from "./LOSCalculator.js";
import { pointIndexForSet } from "./LOS/SmallBitSet.js";
import { ViewerLOS } from "./LOS/ViewerLOS.js";
import { LightStatusTracker } from "./LightStatusTracker.js";

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
      POINTS: "los-points-options-viewer",
      INSET: "los-inset-viewer",
    },

    TARGET: {
      ALGORITHM: "los-algorithm",
      PERCENT: "los-percent",
      LARGE: "los-large-target",
      TYPES: {
        POINTS: "los-algorithm-points",
        PER_PIXEL: "los-algorithm-per-pixel",
        GEOMETRIC: "los-algorithm-geometric",
//         HYBRID: "los-algorithm-hybrid",
        WEBGL2: "los-algorithm-webgl2",
//         WEBGPU: "los-algorithm-webgpu",
//         WEBGPU_ASYNC: "los-algorithm-webgpu-async"
      },
      POINT_OPTIONS: {
        POINTS: "los-points-options-target",
        INSET: "los-inset-target",
      }
    }
  },

  LIGHT_MONITOR: {
    ALGORITHM: "lm-algorithm",
    TYPES: {
      NONE: "lm-algorithm-none",
      TOKENS: "lm-algorithm-tokens",
      VIEWPOINT: "lm-algorithm-viewpoint",
    },
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

  static debugViewer;

  static initializeDebugViewer(type) {
    type ??= this.get(this.KEYS.LOS.TARGET.ALGORITHM);
    this.debugViewer ??= buildDebugViewer(currentDebugViewerClass(type));
    this.debugViewer.render();
  }

  static destroyDebugViewer() {
    if ( !this.debugViewer ) return;
    this.debugViewer.destroy();
    this.debugViewer = undefined;
  }

  static toggleLOSDebugGraphics(enabled = false) {
    if ( enabled ) this.initializeDebugViewer();
    else this.destroyDebugViewer();
  }

  /** @type {LightStatusTracker} */
  static lightMonitor;

  /**
   * Register all settings
   */
  static registerAll() {
    const { KEYS, register, registerMenu, localize } = this;
    const PT_TYPES = KEYS.POINT_TYPES;
    const RTYPES = [PT_TYPES.CENTER, PT_TYPES.FIVE, PT_TYPES.NINE];
    const PT_OPTS = KEYS.LOS.TARGET.POINT_OPTIONS;
    const LTYPES = foundry.utils.filterObject(KEYS.LOS.TARGET.TYPES,
      { POINTS: 0, PER_PIXEL: 0, GEOMETRIC: 0, WEBGL2: 0 });
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
      type: ATVSettingsSubmenu,
      restricted: true
    });

    register(KEYS.LIGHT_MONITOR.ALGORITHM, {
      name: localize(`${KEYS.LIGHT_MONITOR.ALGORITHM}.Name`),
      hint: localize(`${KEYS.LIGHT_MONITOR.ALGORITHM}.Hint`),
      scope: "world",
      config: true,
      type: String,
      choices: {
        [KEYS.LIGHT_MONITOR.TYPES.NONE]: localize(`${KEYS.LIGHT_MONITOR.TYPES.NONE}`),
        [KEYS.LIGHT_MONITOR.TYPES.TOKENS]: localize(`${KEYS.LIGHT_MONITOR.TYPES.TOKENS}`),
        [KEYS.LIGHT_MONITOR.TYPES.VIEWPOINT]: localize(`${KEYS.LIGHT_MONITOR.TYPES.VIEWPOINT}`),
      },
      default: KEYS.LIGHT_MONITOR.TYPES.NONE,
      onChange: this.updateLightMonitor
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
    const PI = ViewerLOS.POINT_INDICES;
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
        initial: 0,
        choices: {
          [PI.CENTER]: "Center",
          [PI.CORNERS.FACING]: "Front Corners",
          [PI.CORNERS.MID]: "Mid Corners",
          [PI.CORNERS.BACK]: "Back Corners",
          [PI.SIDES.FACING]: "Facing Sides",
          [PI.SIDES.MID]: "Mid Sides",
          [PI.SIDES.BACK]: "Back Sides",
          [PI.D3.TOP]: "Top Elevation",
          [PI.D3.MID]: "Middle Elevation",
          [PI.D3.BOTTOM]: "Bottom Elevation",
        },
      })),
      onChange: value => this.losSettingChange(VIEWER.POINTS, value)
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

    register(TARGET.ALGORITHM, {
      name: localize(`${TARGET.ALGORITHM}.Name`),
      hint: localize(`${TARGET.ALGORITHM}.Hint`),
      scope: "world",
      config: false,
      type: String,
      choices: losChoices,
      default: LTYPES.POINTS,
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

    register(TARGET.LARGE, {
      name: localize(`${TARGET.LARGE}.Name`),
      hint: localize(`${TARGET.LARGE}.Hint`),
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
      tab: "losTarget",
      onChange: value => this.losSettingChange(TARGET.LARGE, value)
    });

    register(TARGET.POINT_OPTIONS.POINTS, {
      name: localize(`${TARGET.POINT_OPTIONS.POINTS}.Name`),
      hint: localize(`${TARGET.POINT_OPTIONS.POINTS}.Hint`),
      scope: "world",
      config: false,
      tab: "losTarget",
      default: [PI.CENTER],
      type: new foundry.data.fields.SetField(new foundry.data.fields.StringField({
        required: true,
        blank: false,
        initial: 0,
        choices: {
          [PI.CENTER]: "Center",
          [PI.CORNERS.FACING]: "Front Corners",
          [PI.CORNERS.MID]: "Mid Corners",
          [PI.CORNERS.BACK]: "Back Corners",
          [PI.SIDES.FACING]: "Facing Sides",
          [PI.SIDES.MID]: "Mid Sides",
          [PI.SIDES.BACK]: "Back Sides",
          [PI.D3.TOP]: "Top Elevation",
          [PI.D3.MID]: "Middle Elevation",
          [PI.D3.BOTTOM]: "Bottom Elevation",
        },
      })),
      onChange: value => this.losSettingChange(TARGET.POINT_OPTIONS.POINTS, value)
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

  static updateLightMonitor(value) {
    const LM = Settings.KEYS.LIGHT_MONITOR;
    switch ( value ) {
      case LM.TYPES.NONE:
        if ( !Settings.lightMonitor ) break;
        Settings.lightMonitor.destroy();
        Settings.lightMonitor = undefined;
        break;
      case LM.TYPES.TOKENS:
        Settings.lightMonitor ??= new LightStatusTracker();
        Settings.lightMonitor.stopLocalIconMonitor();
        Settings.lightMonitor.startLightMonitor();
        break;
      case LM.TYPES.VIEWPOINT:
        Settings.lightMonitor ??= new LightStatusTracker();
        Settings.lightMonitor.stopLightMonitor();
        Settings.lightMonitor.startLocalIconMonitor();
        break;
    }
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

    switch ( key ) {
      case TARGET.ALGORITHM: {
        // Set a new shared calculator for all tokens.
        const losCalc = buildLOSCalculator();
        canvas.tokens.placeables.forEach(token => {
          const handler = token[MODULE_ID]?.[TRACKER_IDS.VISIBILITY];
          if ( !handler ) return;
          if ( handler.losViewer.calculator ) handler.losViewer.calculator.destroy();
          handler.losViewer.calculator = losCalc;
        });

        // Start up a new debug viewer.
        if ( this.get(this.KEYS.DEBUG.LOS) ) {
          this.destroyDebugViewer();
          this.initializeDebugViewer(value);
        }
        break;
      }
      case VIEWER.POINTS: value = pointIndexForSet(value);
      case VIEWER.INSET: { /* eslint-disable-line no-fallthrough */
        // Tell the los viewer to update the viewpoints.
        canvas.tokens.placeables.forEach(token => {
          const handler = token[MODULE_ID]?.[TRACKER_IDS.VISIBILITY];
          if ( !handler ) return;
          handler.losViewer.dirty = true;
        });
      }
      case TARGET.PERCENT: {  /* eslint-disable-line no-fallthrough */
        // Update the viewpoints for all tokens.
        const config = { [configKeyForSetting[key]]: value };
        canvas.tokens.placeables.forEach(token => {
          const handler = token[MODULE_ID]?.[TRACKER_IDS.VISIBILITY];
          if ( !handler ) return;
          handler.losViewer.config = config;
        });
        break;
      }

      // Changes to the calculator config.
      case TARGET.POINT_OPTIONS.POINTS: value = pointIndexForSet(value);
      default: { /* eslint-disable-line no-fallthrough */
        const config = foundry.utils.expandObject({ [configKeyForSetting[key]]: value });
        const currCalc = currentCalculator();
        currCalc.config = config;
      }
    }
  }
}

const configKeyForSetting = {
  [SETTINGS.LOS.TARGET.LARGE]: "largeTarget",
  [SETTINGS.LOS.TARGET.PERCENT]: "threshold",

  // Viewpoints.
  [SETTINGS.LOS.VIEWER.POINTS]: "viewpointIndex",
  [SETTINGS.LOS.VIEWER.INSET]: "viewpointInset",

  // Points viewpoints.
  [SETTINGS.LOS.TARGET.POINT_OPTIONS.POINTS]: "targetPointIndex",
  [SETTINGS.LOS.TARGET.POINT_OPTIONS.INSET]: "targetInset",

  // Blocking
  [SETTINGS.LIVE_TOKENS_BLOCK]: "blocking.tokens.live",
  [SETTINGS.DEAD_TOKENS_BLOCK]: "blocking.tokens.dead",
  [SETTINGS.PRONE_TOKENS_BLOCK]: "blocking.tokens.prone",
}

const ALG_SYMBOLS = {};
Object.values(SETTINGS.LOS.TARGET.TYPES).forEach(value => ALG_SYMBOLS[value] = Symbol(value));
