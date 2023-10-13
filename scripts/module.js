/* globals
game,
Hooks
*/
"use strict";

import { MODULE_ID, DEBUG } from "./const.js";

// Hooks and method registration
import { registerGeometry } from "./geometry/registration.js";
import { initializePatching, PATCHER } from "./patching.js";
import {
  registerSettings,
  getSetting,
  setSetting } from "./settings.js";

// For API
import * as bench from "./benchmark.js";
import * as util from "./util.js";

import { PlanePoints3d } from "./PlaceablesPoints/PlanePoints3d.js";
import { TokenPoints3d } from "./PlaceablesPoints/TokenPoints3d.js";
import { DrawingPoints3d } from "./PlaceablesPoints/DrawingPoints3d.js";
import { WallPoints3d } from "./PlaceablesPoints/WallPoints3d.js";
import { TilePoints3d } from "./PlaceablesPoints/TilePoints3d.js";
import { VerticalPoints3d } from "./PlaceablesPoints/VerticalPoints3d.js";
import { HorizontalPoints3d } from "./PlaceablesPoints/HorizontalPoints3d.js";

import { Area3d } from "./Area3d.js";
import { Area2d } from "./Area2d.js";
import { ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";

import { Area3dPopout, area3dPopoutData } from "./Area3dPopout.js";

import * as los from "./visibility_los.js";

// Other self-executing hooks
import "./changelog.js";
import "./migration.js";

Hooks.once("init", function() {
  registerGeometry();
  initializePatching();

  game.modules.get(MODULE_ID).api = {
    bench,
    Area2d,
    Area3d,
    util,
    ConstrainedTokenBorder,
    los,
    PlanePoints3d,
    TokenPoints3d,
    DrawingPoints3d,
    WallPoints3d,
    TilePoints3d,
    VerticalPoints3d,
    HorizontalPoints3d,
    getSetting,
    setSetting,

    Area3dPopout,
    area3dPopoutData,

    PATCHER,

    debug: DEBUG
  };
});

Hooks.once("setup", function() {
  registerSettings();
});


/**
 * Tell DevMode that we want a flag for debugging this module.
 * https://github.com/League-of-Foundry-Developers/foundryvtt-devMode
 */
Hooks.once("devModeReady", ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});
