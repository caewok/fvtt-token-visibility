/* globals
canvas
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Patcher } from "./Patcher.js";
import { MODULES_ACTIVE, MODULE_ID } from "./const.js";
import { WallGeometryHandler, TileGeometryHandler, TokenGeometryHandler } from "./LOS/Placeable3dGeometry.js";

import { PATCHES as PATCHES_Canvas } from "./Canvas.js";
import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_DetectionMode } from "./DetectionMode.js";
import { PATCHES as PATCHES_DetectionModeBasicSight } from "./DetectionModeBasicSight.js";
import { PATCHES as PATCHES_Setting } from "./Settings.js";
import { PATCHES as PATCHES_SettingsConfig } from "./SettingsConfig.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_VisionSource } from "./VisionSource.js";

// LOS
import { PATCHES as PATCHES_ConstrainedTokenBorder } from "./LOS/ConstrainedTokenBorder.js";
import { PATCHES as PATCHES_PointSourcePolygon } from "./LOS/PointSourcePolygon.js";
import { PATCHES as PATCHES_Tile } from "./LOS/Tile.js";
import { PATCHES as PATCHES_TokenLOS } from "./LOS/Token.js";
import { PATCHES as PATCHES_VisionSourceLOS } from "./LOS/VisionSource.js";
import { PATCHES as PATCHES_WallLOS } from "./LOS/Wall.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";

// Levels
import { PATCHES as PATCHES_Levels_SightHandler } from "./Levels_SightHandler.js";

const PATCHES = {
  Canvas: PATCHES_Canvas,
  CanvasVisibility: PATCHES_CanvasVisibility,
  ConstrainedTokenBorder: PATCHES_ConstrainedTokenBorder,
  DetectionMode: PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  PointSourcePolygon: PATCHES_PointSourcePolygon,
  Setting: PATCHES_Setting,
  SettingsConfig: PATCHES_SettingsConfig,
  Tile: PATCHES_Tile,
  Token: foundry.utils.mergeObject(PATCHES_Token, PATCHES_TokenLOS),
  VisionSource: foundry.utils.mergeObject(PATCHES_VisionSource, PATCHES_VisionSourceLOS),
  Wall: foundry.utils.mergeObject(PATCHES_Wall, PATCHES_WallLOS),
  "CONFIG.Levels.handlers.SightHandler": PATCHES_Levels_SightHandler
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("LOS");
  PATCHER.registerGroup("ConstrainedTokenBorder");

  // if ( MODULES_ACTIVE.LEVELS ) PATCHER.registerGroup("LEVELS");
  //PATCHER.registerGroup("NO_LEVELS");

  // If Elevated Vision is present, we can rely on its tile cache.
  if ( !MODULES_ACTIVE.EV ) PATCHER.registerGroup("TILE");
}

export function registerArea3d() {
  PATCHER.registerGroup("AREA3D");

  // Create placeable geometry handlers for placeables already in the scene.
  WallGeometryHandler.registerPlaceables();
  TileGeometryHandler.registerPlaceables();
  TokenGeometryHandler.registerPlaceables();
}

export function registerDebug() { PATCHER.registerGroup("DEBUG"); }

export function deregisterDebug() { PATCHER.deregisterGroup("DEBUG"); }
