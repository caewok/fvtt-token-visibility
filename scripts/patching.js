/* globals
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Patcher } from "./Patcher.js";
import { MODULES_ACTIVE } from "./const.js";

import { PATCHES as PATCHES_CanvasVisibility } from "./CanvasVisibility.js";
import { PATCHES as PATCHES_ConstrainedTokenBorder } from "./LOS/ConstrainedTokenBorder.js";
import { PATCHES as PATCHES_DetectionMode } from "./DetectionMode.js";
import { PATCHES as PATCHES_DetectionModeBasicSight } from "./DetectionModeBasicSight.js";
import { PATCHES as PATCHES_DrawingConfig} from "./DrawingConfig.js";
import { PATCHES as PATCHES_PointSourcePolygon } from "./PointSourcePolygon.js";
import { PATCHES as PATCHES_Setting } from "./Settings.js";
import { PATCHES as PATCHES_SettingsConfig } from "./SettingsConfig.js";
import { PATCHES as PATCHES_Tile } from "./Tile.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_VisionSource } from "./VisionSource.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";

// Levels
import { PATCHES as PATCHES_Levels_SightHandler } from "./Levels_SightHandler.js";

const PATCHES = {
  CanvasVisibility: PATCHES_CanvasVisibility,
  ConstrainedTokenBorder: PATCHES_ConstrainedTokenBorder,
  DetectionMode: PATCHES_DetectionMode,
  DetectionModeBasicSight: PATCHES_DetectionModeBasicSight,
  DrawingConfig: PATCHES_DrawingConfig,
  PointSourcePolygon: PATCHES_PointSourcePolygon,
  Setting: PATCHES_Setting,
  SettingsConfig: PATCHES_SettingsConfig,
  Tile: PATCHES_Tile,
  Token: PATCHES_Token,
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

  // TODO: Only when Area3d is enabled.
  PATCHER.registerGroup("AREA3D");
}
