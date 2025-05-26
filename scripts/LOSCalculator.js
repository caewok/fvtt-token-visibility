/* globals
CONFIG,
foundry,
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { AbstractViewerLOS } from "./LOS/AbstractViewerLOS.js";

/** Testing
api = game.modules.get("tokenvisibility").api
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL1)
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL2)
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_GEOMETRIC)
*/

export function currentCalculator(type) {
  const KEYS = Settings.KEYS;
  const { TARGET, VIEWER } = KEYS.LOS;
  const POINT_OPTIONS = TARGET.POINT_OPTIONS;
  const calcs = CONFIG[MODULE_ID].sightCalculators;
  type ??= Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS;
  switch (type) {
    case "los-points": return calcs.points;
    case "los-area-3d": return calcs.hybrid;
    case "los-area-3d-geometric": return calcs.geometric;
    case "los-area-3d-hybrid": return calcs.hybrid;
    case "los-webgl2": return calcs.webGL2;
    case "los-webgpu": return calcs.webGPU;
    case "los-webgpu-async": return calcs.webGPUAsync;
  }
}

export function currentDebugViewerClass(type) {
  const KEYS = Settings.KEYS;
  const { TARGET, VIEWER } = KEYS.LOS;
  const POINT_OPTIONS = TARGET.POINT_OPTIONS;
  const debugViewers = CONFIG[MODULE_ID].debugViewerClasses;
  type ??= Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS;
  switch (type) {
    case "los-points": return debugViewers.points;
    case "los-area-3d": return debugViewers.hybrid;
    case "los-area-3d-geometric": return debugViewers.geometric;
    case "los-area-3d-hybrid": return debugViewers.hybrid;
    case "los-webgl2": return debugViewers.webGL2;
    case "los-webgpu": return debugViewers.webGPU;
    case "los-webgpu-async": return debugViewers.webGPUAsync;
  }
}

/**
 * Automatic config object for token blocking settings.
 * Used to automatically update settings across los calculators.
 * @type {TokenBlockingConfig}
 */
/*
class TokenBlockingConfig {
  static get dead() { return Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK) ?? true; }

  static get live() { return Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK) ?? true; }

  static get prone() { return Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK) ?? true; }
}
Object.defineProperty(TokenBlockingConfig, "dead", { enumerable: true })
Object.defineProperty(TokenBlockingConfig, "live", { enumerable: true })
Object.defineProperty(TokenBlockingConfig, "prone", { enumerable: true })
*/

const TokenBlockingConfig = {}
Object.defineProperties(TokenBlockingConfig, {
  dead: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK) ?? true; }
  },
  live: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK) ?? true; }
  },
  prone: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK) ?? true; }
  },
  clone: {
   value: function() { return { ...this }; }
  },
});

/**
 * Automatic config object for blocking settings.
 * Used to automatically update settings across los calculators.
 * @type {BlockingConfig}
 */
const BlockingConfig = { walls: true, tiles: true, tokens: TokenBlockingConfig };
Object.defineProperty(BlockingConfig, "clone", {
  value: function() {
    const obj = { ...this };
    obj.tokens = obj.tokens.clone();
    return obj;
  }
})

/**
 * Automatic config object object for LOS, returning the current settings
 * Used to automatically update settings across los calculators.
 * @type {ViewerLOSConfig}
 */
const ViewerLOSConfig = {
  blocking: BlockingConfig,
  debug: false,
  useLitTargetShape: false,
  senseType: "sight",
}
Object.defineProperties(ViewerLOSConfig, {
  threshold: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.LOS.TARGET.PERCENT) ?? 0.75; }
  },
  largeTarget: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.LOS.TARGET.LARGE) ?? false; }
  },

  // Points algorithm
  pointAlgorithm: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER ?? false; }
  },
  targetInset: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.INSET) ?? 0.75; }
  },
  points3d: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.POINTS3D) ?? false; }
  },

  // Viewpoint
  viewpointKey: {
    enumerable: true,
    get() {
      // Shared calculator.
      return currentCalculator();
    }
  },
  numViewpoints: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.LOS.VIEWER.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER; }
  },
  viewpointOffset: {
    enumerable: true,
    get() { return Settings.get(Settings.KEYS.LOS.VIEWER.INSET); }
  },

  // Cloning method.
  clone: {
   value: function() {
     const obj = { ...this };
     obj.blocking = this.blocking.clone();
     return obj;
    }
  },
});



/**
 * Build an LOS calculator for this viewer that uses the current settings.
 * @param {Token} viewer
 * @returns {AbstractViewerLOS}
 */
export function buildLOSCalculator(viewer) {
  return new AbstractViewerLOS(viewer, ViewerLOSConfig.clone());
}

/**
 * Build an LOS calculator for this viewer that uses the current settings, modified by
 * custom parameters.
 * @param {Token} viewer
 * @param {object} [config]         Custom parameters to override default settings.
 * @returns {AbstractViewerLOS}
 */
export function buildCustomLOSCalculator(viewer, config = {}) {
  const defaultConfig = ViewerLOSConfig.clone();
  foundry.utils.mergeObject(defaultConfig, config, { inplace: true });
  return new AbstractViewerLOS(viewer, defaultConfig);
}

/**
 * Build a debug viewer using the current settings.
 * @param {class} cl                Class of the viewer
 * @param {object} [config]         Custom parameters to override default settings.
 */
export function buildDebugViewer(cl, config = {}) {
  cl ??= currentDebugViewerClass();
  const defaultConfig = ViewerLOSConfig.clone();
  delete defaultConfig.viewpointKey; // Remove the shared calculator.
  foundry.utils.mergeObject(defaultConfig, config, { inplace: true });
  return new cl(defaultConfig);
}

