/* globals
game,
Hooks
*/
"use strict";

import { MODULE_ID, DEBUG } from "./const.js";

// Hooks and method registration
import { registerGeometry } from "./geometry/registration.js";
import { initializePatching, PATCHER } from "./patching.js";
import { Settings, SETTINGS, DEBUG_GRAPHICS } from "./settings.js";

// For API
import * as bench from "./benchmark.js";
import * as util from "./util.js";

import { PlanePoints3d } from "./LOS/PlaceablesPoints/PlanePoints3d.js";
import { TokenPoints3d } from "./LOS/PlaceablesPoints/TokenPoints3d.js";
import { DrawingPoints3d } from "./LOS/PlaceablesPoints/DrawingPoints3d.js";
import { WallPoints3d } from "./LOS/PlaceablesPoints/WallPoints3d.js";
import { TilePoints3d } from "./LOS/PlaceablesPoints/TilePoints3d.js";
import { VerticalPoints3d } from "./LOS/PlaceablesPoints/VerticalPoints3d.js";
import { HorizontalPoints3d } from "./LOS/PlaceablesPoints/HorizontalPoints3d.js";

import { PointsLOS } from "./LOS/PointsLOS.js";
import { Area3d, Area3dLOS } from "./LOS/Area3dLOS.js";
import { Area2d, Area2dLOS } from "./LOS/Area2dLOS.js";
import { ConstrainedTokenBorder } from "./LOS/ConstrainedTokenBorder.js";
import { Area3dPopout, area3dPopoutData } from "./LOS/Area3dPopout.js";

import * as los from "./visibility_los.js";
import * as range from "./visibility_range.js";

// Other self-executing hooks
import "./changelog.js";
import "./migration.js";

Hooks.once("init", function() {
  registerGeometry();
  initializePatching();

  game.modules.get(MODULE_ID).api = {
    bench,
    PointsLOS,
    Area2dLOS,
    Area3dLOS,
    Area2d,
    Area3d,
    util,
    ConstrainedTokenBorder,
    los,
    range,
    PlanePoints3d,
    TokenPoints3d,
    DrawingPoints3d,
    WallPoints3d,
    TilePoints3d,
    VerticalPoints3d,
    HorizontalPoints3d,
    Settings,

    Area3dPopout,
    area3dPopoutData,

    PATCHER,

    debug: DEBUG
  };
});

Hooks.once("setup", function() {
  Settings.registerAll();
});

Hooks.on("canvasReady", function() {
  console.debug("tokenvisibility|canvasReady")
  DEBUG_GRAPHICS.RANGE = new PIXI.Graphics();
  DEBUG_GRAPHICS.LOS = new PIXI.Graphics();

  if ( Settings.get(SETTINGS.DEBUG.RANGE ) ) canvas.tokens.addChild(DEBUG_GRAPHICS.RANGE);
  if ( Settings.get(SETTINGS.DEBUG.LOS ) ) canvas.tokens.addChild(DEBUG_GRAPHICS.LOS);
});

Hooks.on("canvasTearDown", function() {
  console.debug("tokenvisibility|canvasTearDown");
  canvas.tokens.removeChild(DEBUG_GRAPHICS.RANGE);
  canvas.tokens.removeChild(DEBUG_GRAPHICS.LOS);
  DEBUG_GRAPHICS.RANGE.destroy();
  DEBUG_GRAPHICS.LOS.destroy();
});

Hooks.on('createActiveEffect', refreshVisionOnActiveEffect);
Hooks.on('deleteActiveEffect', refreshVisionOnActiveEffect);


/**
 * Refresh vision for relevant active effect creation/deletion
 */
function refreshVisionOnActiveEffect(activeEffect) {
  const proneStatusId = CONFIG.GeometryLib.proneStatusId ?? Settings.get(SETTINGS.COVER.LIVE_TOKENS.ATTRIBUTE);
  const isProne = activeEffect?.statuses.some((status) => status === proneStatusId);
  if ( !isProne ) return;

  canvas.effects.visibility.refresh();
}

/**
 * Tell DevMode that we want a flag for debugging this module.
 * https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
 */
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});
