/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";

// Trackers
import {
  TokenGeometryTracker,
  LitTokenGeometryTracker,
  BrightLitTokenGeometryTracker,
  SphericalTokenGeometryTracker, } from "./LOS/placeable_tracking/TokenGeometryTracker.js";
import { WallGeometryTracker } from "./LOS/placeable_tracking/WallGeometryTracker.js";
import { TileGeometryTracker } from "./LOS/placeable_tracking/TileGeometryTracker.js";
import { RegionGeometryTracker } from "./LOS/placeable_tracking/RegionGeometryTracker.js";



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
  console.debug(`${MODULE_ID}|canvasReady`);
  if ( Settings.get(Settings.KEYS.DEBUG.LOS) ) Settings.toggleLOSDebugGraphics(true);

  WallGeometryTracker.registerExistingPlaceables();
  TileGeometryTracker.registerExistingPlaceables();
  TokenGeometryTracker.registerExistingPlaceables();
  SphericalTokenGeometryTracker.registerExistingPlaceables();
  LitTokenGeometryTracker.registerExistingPlaceables();
  BrightLitTokenGeometryTracker.registerExistingPlaceables();
  RegionGeometryTracker.registerExistingPlaceables();

  // Must be after the trackers are ready.
  Settings.updateLightMonitor(Settings.get(Settings.KEYS.LIGHT_MONITOR.ALGORITHM));
}

/**
 * A hook event that fires when the Canvas is deactivated.
 * Needed here because the destroy token hook is too late; by then, the children of the
 * token layer are already removed and so the graphics geometry gets destroyed twice.
 * @event canvasTearDown
 * @category Canvas
 * @param {Canvas} canvas   The Canvas instance being deactivated
 */
function canvasTearDown(canvas) {
  Settings.toggleLOSDebugGraphics(false);
  Settings.updateLightMonitor(Settings.KEYS.LIGHT_MONITOR.TYPES.NONE);

  canvas.tokens.placeables.forEach(token => {
    const losCalc = token[MODULE_ID]?.losCalc;
    if ( !losCalc ) return;
    losCalc.destroy();
    token[MODULE_ID].losCalc = undefined;
  });
}

PATCHES.BASIC.HOOKS = { canvasReady, canvasTearDown };
