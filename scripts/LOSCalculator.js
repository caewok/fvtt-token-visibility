/* globals
foundry,
*/
"use strict";

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
    useLitTargetShape: true,
    largeTarget: Settings.get(TARGET.LARGE) ?? false,

    // For points algorithm
    pointAlgorithm: Settings.get(POINT_OPTIONS.NUM_POINTS) ?? KEYS.POINT_TYPES.CENTER,
    targetInset: Settings.get(POINT_OPTIONS.INSET) ?? 0.75,
    points3d: Settings.get(POINT_OPTIONS.POINTS3D) ?? false,

    // Viewpoint
    viewpointClass: Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS,
    numViewpoints: Settings.get(VIEWER.NUM_POINTS) ?? KEYS.POINT_TYPES.CENTER,
    viewpointOffset: Settings.get(VIEWER.INSET),
    senseType: "sight",
  };
}

/**
 * Build an LOS calculator for this viewer that uses the current settings.
 * @param {Token} viewer
 * @returns {AbstractViewerLOS}
 */
export function buildLOSCalculator(viewer) {
  const config = buildConfig();
  return new AbstractViewerLOS(viewer, config);
}

/**
 * Build an LOS calculator for this viewer that uses the current settings, modified by
 * custom parameters.
 * @param {Token} viewer
 * @param {object} [config]         Custom parameters to override default settings.
 * @returns {AbstractViewerLOS}
 */
export function buildCustomLOSCalculator(token, config = {}) {
  const mergedConfig = foundry.utils.mergeObject(this.buildConfig, config, { inplace: false });
  return new AbstractViewerLOS(token, mergedConfig);
}
