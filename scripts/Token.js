/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { MODULE_ID, TRACKER_IDS } from "./const.js";
import { buildLOSViewer } from "./LOSCalculator.js";
import { ATVTokenHandler } from "./TokenHandler.js";
import { TokenLightMeter } from "./TokenLightMeter.js";
import { SmallBitSet } from "./LOS/SmallBitSet.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.DEBUG = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook: refreshToken
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags         Flags being refreshed
 */
function refreshToken(token, flags) {
  if ( !(flags.refreshSize || flags.refreshRotation) ) return;
  const losViewer = token[MODULE_ID]?.[ATVTokenHandler.ID].losViewer;
  if ( !losViewer ) return;

  losViewer.dirty = flags.refreshSize; // Refresh viewpoints if viewer size changes.
  if ( !losViewer.dirty && flags.refreshRotation ) {
    // Refresh viewpoints if using any corner or side points that could change with viewer rotation.
    const PI = losViewer.constructor.POINT_INDICES;
    const bs = SmallBitSet.fromNumber(losViewer.config.viewpointIndex);
    const mask = SmallBitSet.fromIndices([PI.CORNERS.FACING, PI.CORNERS.MID, PI.CORNERS.BACK, PI.SIDES.FACING, PI.SIDES.MID, PI.SIDES.BACK]);
    const maskIx = bs.intersection(mask);
    losViewer.dirty = !maskIx.isEmpty;
  }
}


/**
 * Hook: drawToken
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawToken(token) {
  const obj = token[MODULE_ID] ??= {};
  if ( !obj[ATVTokenHandler.ID] ) new ATVTokenHandler(token);
  if ( !obj[TokenLightMeter.ID] ) new TokenLightMeter(token);
}

PATCHES.BASIC.HOOKS = { drawToken, refreshToken };
