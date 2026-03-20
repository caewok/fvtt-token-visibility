/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";

// Trackers
import { WallGeometryTracker } from "./geometry/placeable_tracking/WallGeometryTracker.js";
import { TileGeometryTracker } from "./geometry/placeable_tracking/TileGeometryTracker.js";
import { TokenGeometryTracker } from "./geometry/placeable_tracking/TokenGeometryTracker.js";
import { RegionGeometryTracker } from "./geometry/placeable_tracking/RegionGeometryTracker.js";
import { PlaceableUpdateWatcher } from "./geometry/placeable_tracking/PlaceableUpdateWatcher.js";




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

  // Register basic watchers for placeables.
  const updateFn = placeable => {
    const obj = placeable[MODULE_ID] ??= {}
    obj.updateId ??= 0;
    obj.updateId += 1;
  }
  const docKeys = {
    Wall: [
      ...WallGeometryTracker.TRACKER_TYPES.position,
      ...WallGeometryTracker.TRACKER_TYPES.direction,
      ...WallGeometryTracker.TRACKER_TYPES.restriction,
      ...WallGeometryTracker.TRACKER_TYPES.door,
      ...WallGeometryTracker.TRACKER_TYPES.threshold,
    ],
    Tile: [
      ...TileGeometryTracker.TRACKER_TYPES.position,
      ...TileGeometryTracker.TRACKER_TYPES.scale,
      ...TileGeometryTracker.TRACKER_TYPES.rotation,
    ],
    Token: [
      ...TokenGeometryTracker.TRACKER_TYPES.position,
      ...TokenGeometryTracker.TRACKER_TYPES.scale,
      ...TokenGeometryTracker.TRACKER_TYPES.shape,
    ],
    Region: [
      ...RegionGeometryTracker.TRACKER_TYPES.elevation,
      ...RegionGeometryTracker.TRACKER_TYPES.shapes,
    ],
  };
  for ( const [docName, keys] of Object.entries(docKeys) ) {
    const watcher = PlaceableUpdateWatcher.create(docName);
    watcher.register(keys, updateFn);
    watcher.activate();
  }

  // Placeable Geometry for collision testing.
  const geometryTracking = CONFIG.GeometryLib.lib.placeableGeometryTracking;
  const geometryTypes = [
    "Tile",
    "Wall",
    "Token",
    "Region",
  ];
  for ( const type of geometryTypes ) {
    const cl = geometryTracking[`${type}GeometryTracker`];
    const tracker = cl.create();
    tracker.activate();
    tracker.registerExistingPlaceables();
  }

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

  // Placeable Geometry for collision testing.
  const geometryTracking = CONFIG.GeometryLib.lib.placeableGeometryTracking;
  const geometryTypes = [
    "Tile",
    "Wall",
    "Token",
    "Region",
  ];
  for ( const type of geometryTypes ) {
    const cl = geometryTracking[`${type}GeometryTracker`];
    const tracker = cl.create();
    tracker.deactivate();
    tracker.deRegisterExistingPlaceables();
  }
}

PATCHES.BASIC.HOOKS = { canvasReady, canvasTearDown };
