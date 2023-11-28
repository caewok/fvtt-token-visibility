/* globals
canvas,
CONFIG,
game,
Hooks
*/
"use strict";

import { MODULE_ID, DEBUG } from "./const.js";

// Hooks and method registration
import { registerGeometry } from "./geometry/registration.js";
import { initializePatching, PATCHER } from "./patching.js";
import { Settings, SETTINGS } from "./settings.js";

// For API
import * as bench from "./benchmark.js";
import * as benchFunctions from "./benchmark_functions.js";
import * as util from "./util.js";

import { PlanePoints3d } from "./LOS/PlaceablesPoints/PlanePoints3d.js";
import { TokenPoints3d } from "./LOS/PlaceablesPoints/TokenPoints3d.js";
import { DrawingPoints3d } from "./LOS/PlaceablesPoints/DrawingPoints3d.js";
import { WallPoints3d } from "./LOS/PlaceablesPoints/WallPoints3d.js";
import { TilePoints3d } from "./LOS/PlaceablesPoints/TilePoints3d.js";
import { VerticalPoints3d } from "./LOS/PlaceablesPoints/VerticalPoints3d.js";
import { HorizontalPoints3d } from "./LOS/PlaceablesPoints/HorizontalPoints3d.js";

import { AlternativeLOS } from "./LOS/AlternativeLOS.js";
import { PointsLOS } from "./LOS/PointsLOS.js";
import { Area2dLOS } from "./LOS/Area2dLOS.js";
import { Area3dLOSGeometric } from "./LOS/Area3dLOSGeometric.js";
import { Area3dLOSWebGL } from "./LOS/Area3dLOSWebGL1.js";
import { Area3dLOSWebGL2 } from "./LOS/Area3dLOSWebGL2.js";
import { Area3dLOSHybrid } from "./LOS/Area3dLOSHybrid.js";

import { ConstrainedTokenBorder } from "./LOS/ConstrainedTokenBorder.js";

import { AREA3D_POPOUTS } from "./LOS/Area3dPopout.js";

import { AlphaCutoffFilter } from "./LOS/AlphaCutoffFilter.js";

import { Token3dGeometry, Wall3dGeometry, DirectionalWall3dGeometry, ConstrainedToken3dGeometry } from "./LOS/Placeable3dGeometry.js";
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./LOS/Placeable3dShader.js";

import { PixelCache } from "./LOS/PixelCache.js";
import { extractPixels } from "./LOS/extract-pixels.js";

import { LOS_CALCULATOR, LOSCalculator, drawDebugPoint } from "./visibility_los.js";
import * as range from "./visibility_range.js";

// Other self-executing hooks
import "./changelog.js";
import "./migration.js";

Hooks.once("init", function() {
  registerGeometry();
  initializePatching();

   // Set CONFIGS used by this module.
  CONFIG[MODULE_ID] = {

    /**
     * The percent threshold under which a tile should be considered transparent at that pixel.
     * @type {number}
     */
    alphaThreshold: 0.75,

    /**
     * Size of the render texture (width and height) used in the webGL LOS algorithms.
     * @type {number}
     */
    renderTextureSize: 100,

    /**
     * Resolution of the render texture used in the webZGL LOS algorithm.
     * Should be between (0, 1).
     * @type {number}
     */
    renderTextureResolution: 1
  }

  game.modules.get(MODULE_ID).api = {
    bench,
    benchFunctions,

    PixelCache,
    extractPixels,

    AlternativeLOS,
    PointsLOS,
    Area2dLOS,
    Area3dLOSGeometric,
    Area3dLOSWebGL,
    Area3dLOSWebGL2,
    Area3dLOSHybrid,

    util,
    ConstrainedTokenBorder,
    los: { LOS_CALCULATOR, LOSCalculator, drawDebugPoint },
    range,
    PlanePoints3d,
    TokenPoints3d,
    DrawingPoints3d,
    WallPoints3d,
    TilePoints3d,
    VerticalPoints3d,
    HorizontalPoints3d,
    Settings,
    AlphaCutoffFilter,

    AREA3D_POPOUTS,

    Token3dGeometry, Wall3dGeometry, DirectionalWall3dGeometry, ConstrainedToken3dGeometry,
    Placeable3dShader, Tile3dShader,
    Placeable3dDebugShader, Tile3dDebugShader,

    PATCHER,

    debug: DEBUG
  };
});

Hooks.once("setup", function() {
  Settings.registerAll();
  console.debug(`${MODULE_ID}|registered settings`)
});

Hooks.on("canvasReady", function() {
  console.debug(`${MODULE_ID}|canvasReady`);
  Settings.initializeDebugGraphics();

  const api = game.modules.get(MODULE_ID).api;
  api.losCalculator = new LOSCalculator();
  LOS_CALCULATOR.CALCULATOR = api.losCalculator;
});

Hooks.on("createActiveEffect", refreshVisionOnActiveEffect);
Hooks.on("deleteActiveEffect", refreshVisionOnActiveEffect);

Hooks.on("canvasTearDown", function() {
  console.debug(`${MODULE_ID}|canvasTearDown`);
  const api = game.modules.get(MODULE_ID).api;
  api.losCalculator.destroy();
});

/**
 * Refresh vision for relevant active effect creation/deletion
 */
function refreshVisionOnActiveEffect(activeEffect) {
  const proneStatusId = CONFIG.GeometryLib.proneStatusId ?? Settings.get(SETTINGS.COVER.LIVE_TOKENS.ATTRIBUTE);
  const isProne = activeEffect?.statuses.some(status => status === proneStatusId);
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
