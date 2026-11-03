/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TRACKER_IDS, ENUMS } from "./const.js";
import { Settings } from "./settings.js";
import { buildOcclusionTester, buildLOSCalculator } from "./LOSCalculator.js";
import { ATVLOSManager } from "./ATVLOSManager.js";

// Patches for the Canvas class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Wraps ----- //

/**
 * A hook event that fires when the Canvas is ready.
 * Needed here to enable the debug viewer.
 * @event
 * @category Canvas
 * @param {Canvas} canvas The Canvas which is now ready for use
 */
function canvasReady(_canvas) {

  // Destroy any old calculator.
  if ( CONFIG[MODULE_ID].losCalculator ) {
    CONFIG[MODULE_ID].losCalculator.destroy();
    CONFIG[MODULE_ID].losCalculator = null;
  }

  // Create a shared occlusion tester.
  CONFIG[MODULE_ID].occlusionTester = buildOcclusionTester();

  // Create a shared los calculator.
  const calc = CONFIG[MODULE_ID].losCalculator = buildLOSCalculator();

  // Replace for any tokens already in the scene.
  canvas.tokens.placeables.forEach(token => {
    const losViewer = token[MODULE_ID]?.[TRACKER_IDS.VISIBILITY]?.losViewer;
    if ( !losViewer ) return;
    losViewer.calculator = calc;
  });

  ATVLOSManager.initializeDebugGraphics();
  if ( Settings.get(Settings.KEYS.DEBUG.LOS) ) ATVLOSManager.toggleLOSDebugGraphics(true);

  // Must be after the trackers are ready.
  ATVLOSManager.updateLightMonitor(Settings.get(Settings.KEYS.LIGHT_MONITOR.ALGORITHM));
}

/**
 * A hook event that fires when the Canvas is deactivated.
 * Needed here because the destroy token hook is too late; by then, the children of the
 * token layer are already removed and so the graphics geometry gets destroyed twice.
 * @event canvasTearDown
 * @category Canvas
 * @param {Canvas} canvas   The Canvas instance being deactivated
 */
function canvasTearDown(_canvas) {
  ATVLOSManager.toggleLOSDebugGraphics(false);
  ATVLOSManager.updateLightMonitor(ENUMS.LIGHT_ALGORITHM_TYPES.NONE);

  // Destroy any old calculator.
  if ( CONFIG[MODULE_ID].losCalculator ) {
    CONFIG[MODULE_ID].losCalculator.destroy();
    CONFIG[MODULE_ID].losCalculator = null;
  }
}

PATCHES.BASIC.HOOKS = { canvasReady, canvasTearDown };
