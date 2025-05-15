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

/**
 * Default AbstractViewerLOS config given token visibility settings.
 * @returns {ViewerLOSConfig}
 */
function buildConfig() {
  const KEYS = Settings.KEYS;
  const { TARGET, VIEWER } = KEYS.LOS;
  const POINT_OPTIONS = TARGET.POINT_OPTIONS;
  return {
    blocking: {
      walls: true,
      tiles: true,
      tokens: {
        dead: Settings.get(KEYS.DEAD_TOKENS_BLOCK) ?? true,
        live: Settings.get(KEYS.LIVE_TOKENS_BLOCK) ?? true,
        prone: Settings.get(KEYS.PRONE_TOKENS_BLOCK) ?? true,
      }
    },
    debug: false,
    threshold: Settings.get(TARGET.PERCENT) ?? 0.75,
    useLitTargetShape: false,
    largeTarget: Settings.get(TARGET.LARGE) ?? false,

    // For points algorithm
    pointAlgorithm: Settings.get(POINT_OPTIONS.NUM_POINTS) ?? KEYS.POINT_TYPES.CENTER,
    targetInset: Settings.get(POINT_OPTIONS.INSET) ?? 0.75,
    points3d: Settings.get(POINT_OPTIONS.POINTS3D) ?? false,

    // Viewpoint
    viewpointKey: Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS,
    numViewpoints: Settings.get(VIEWER.NUM_POINTS) ?? KEYS.POINT_TYPES.CENTER,
    viewpointOffset: Settings.get(VIEWER.INSET),
    senseType: "sight",
  };
}

function currentCalculator() {
  const calcs = CONFIG[MODULE_ID].sightCalculators;
  const TARGET = Settings.KEYS.LOS.TARGET;
  switch (Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS) {
    case "los-points": return calcs.points;
    case "los-area-3d": return calcs.hybrid;
    case "los-area-3d-geometric": return calcs.geometric;
    case "los-area-3d-webgl2": return calcs.PIXI;
    case "los-area-3d-hybrid": return calcs.hybrid;
    case "los-webgl2": return calcs.webGL2;
    case "los-webgpu": return calcs.webGPU;
    case "los-webgpu-async": return calcs.webGPUAsync;
  }
}

function currentDebugViewerClass() {
  const TARGET = Settings.KEYS.LOS.TARGET;
  const debugViewers = CONFIG[MODULE_ID].debugViewers;
  switch (Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS) {
    case "los-points": return debugViewers.points;
    case "los-area-3d": return debugViewers.hybrid;
    case "los-area-3d-geometric": return debugViewers.geometric;
    case "los-area-3d-webgl2": return debugViewers.PIXI;
    case "los-area-3d-hybrid": return debugViewers.hybrid;
    case "los-webgl2": return debugViewers.webGL2;
    case "los-webgpu": return debugViewers.webGPU;
    case "los-webgpu-async": return debugViewers.webGPUAsync;
  }
}

/**
 * Build an LOS calculator for this viewer that uses the current settings.
 * @param {Token} viewer
 * @returns {AbstractViewerLOS}
 */
export function buildLOSCalculator(viewer) {
  const config = buildConfig;
  config.viewpointKey = currentCalculator(); // Share calculator for all current settings.
  return new AbstractViewerLOS(viewer, config);
}

/**
 * Build an LOS calculator for this viewer that uses the current settings, modified by
 * custom parameters.
 * @param {Token} viewer
 * @param {object} [config]         Custom parameters to override default settings.
 * @returns {AbstractViewerLOS}
 */
export function buildCustomLOSCalculator(viewer, config = {}) {
  const mergedConfig = foundry.utils.mergeObject(buildConfig(), config, { inplace: false });
  return new AbstractViewerLOS(viewer, mergedConfig);
}

/**
 * Build a debug viewer using the current settings.
 * @param {class} cl                Class of the viewer
 * @param {object} [config]         Custom parameters to override default settings.
 */
export function buildDebugViewer(cl, config = {}) {
  cl ??= currentDebugViewerClass();
  const defaultConfig = buildConfig();
  delete defaultConfig.viewpointKey;
  const mergedConfig = foundry.utils.mergeObject(defaultConfig, config, { inplace: false });
  return new cl(mergedConfig);
}

