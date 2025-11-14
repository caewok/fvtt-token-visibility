/* globals
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Patcher } from "./Patcher.js";

import { PATCHES as PATCHES_Canvas } from "./Canvas.js";
import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_DetectionMode } from "./DetectionMode.js";
import { PATCHES as PATCHES_DetectionModeBasicSight } from "./DetectionModeBasicSight.js";
import { PATCHES as PATCHES_Settings } from "./ModuleSettingsAbstract.js";
import { PATCHES as PATCHES_SettingsConfig } from "./SettingsConfig.js";
import { PATCHES as PATCHES_Token } from "./Token.js";

// Levels
import { PATCHES as PATCHES_Levels_SightHandler } from "./Levels_SightHandler.js";

const PATCHES = {
  Canvas: PATCHES_Canvas,
  CanvasVisibility: PATCHES_CanvasVisibility,
  "foundry.canvas.perception.DetectionMode": PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  ClientSettings: PATCHES_Settings,
  SettingsConfig: PATCHES_SettingsConfig,
  "foundry.canvas.placeables.Token": PATCHES_Token,
  "CONFIG.Levels.handlers.SightHandler": PATCHES_Levels_SightHandler,
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("LOS");
  registerArea3d();

  // if ( MODULES_ACTIVE.LEVELS ) PATCHER.registerGroup("LEVELS");
  //PATCHER.registerGroup("NO_LEVELS");

  // If Elevated Vision is present, we can rely on its tile cache.
  // if ( !MODULES_ACTIVE.ELEVATED_VISION ) PATCHER.registerGroup("TILE");
}

export function registerArea3d() {
  PATCHER.registerGroup("AREA3D");
}

export function registerDebug() { }//PATCHER.registerGroup("DEBUG"); }

export function deregisterDebug() { }//PATCHER.deregisterGroup("DEBUG"); }
