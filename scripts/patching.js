/* globals
canvas
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Patcher } from "./Patcher.js";
import { MODULES_ACTIVE, MODULE_ID } from "./const.js";
import { WallGeometryHandler, TileGeometryHandler, TokenGeometryHandler } from "./LOS/Placeable3dGeometry.js";

import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_ConstrainedTokenBorder } from "./LOS/ConstrainedTokenBorder.js";
import { PATCHES as PATCHES_DetectionMode } from "./DetectionMode.js";
import { PATCHES as PATCHES_DetectionModeBasicSight } from "./DetectionModeBasicSight.js";
import { PATCHES as PATCHES_PointSourcePolygon } from "./PointSourcePolygon.js";
import { PATCHES as PATCHES_Setting } from "./Settings.js";
import { PATCHES as PATCHES_SettingsConfig } from "./SettingsConfig.js";
import { PATCHES as PATCHES_Tile } from "./LOS/Tile.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_TokenLOS } from "./LOS/Token.js";
import { PATCHES as PATCHES_VisionSource } from "./VisionSource.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";

// Levels
import { PATCHES as PATCHES_Levels_SightHandler } from "./Levels_SightHandler.js";

const PATCHES = {
  CanvasVisibility: PATCHES_CanvasVisibility,
  ConstrainedTokenBorder: PATCHES_ConstrainedTokenBorder,
  DetectionMode: PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  PointSourcePolygon: PATCHES_PointSourcePolygon,
  Setting: PATCHES_Setting,
  SettingsConfig: PATCHES_SettingsConfig,
  Tile: PATCHES_Tile,
  Token: foundry.utils.mergeObject(PATCHES_Token, PATCHES_TokenLOS),
  VisionSource: PATCHES_VisionSource,
  Wall: PATCHES_Wall,
  "CONFIG.Levels.handlers.SightHandler": PATCHES_Levels_SightHandler
};

export const PATCHER = new Patcher(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("ConstrainedTokenBorder");

  // if ( MODULES_ACTIVE.LEVELS ) PATCHER.registerGroup("LEVELS");
  PATCHER.registerGroup("NO_LEVELS");

  // If Elevated Vision is present, we can rely on its tile cache.
  if ( !MODULES_ACTIVE.EV ) PATCHER.registerGroup("TILE");
}

export function registerArea3d() {
  PATCHER.registerGroup("AREA3D");

  // Create placeable geometry handlers.
  if ( canvas.walls ) {
    canvas.walls.placeables
      .filter(wall => !wall[MODULE_ID])
      .forEach(wall => wall[MODULE_ID] = { geomHandler: new WallGeometryHandler(wall) });

    canvas.tiles.placeables
      .filter(tile => !tile[MODULE_ID])
      .forEach(tile => tile[MODULE_ID] = { geomHandler: new TileGeometryHandler(tile) });

    canvas.tokens.placeables
      .filter(token => !token[MODULE_ID])
      .forEach(token => token[MODULE_ID] = { geomHandler: new TokenGeometryHandler(token) });
  }
}

export function deregisterArea3d() {
  // Destroy all the placeable geometries.
  if ( canvas.walls ) {
    const placeables = [
      ...canvas.walls.placeables,
      ...canvas.tiles.placeables,
      ...canvas.tokens.placeables];
    for ( const placeable of placeables ) placeable[MODULE_ID]?.geomHandler.destroy();
  }

  // Remove the unused methods, getters.
  PATCHER.deregisterGroup("AREA3D");
}
