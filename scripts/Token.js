/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { MODULE_ID } from "./const.js";
import { ATVTokenHandler } from "./TokenHandler.js";
import { TokenLightMeter } from "./TokenLightMeter.js";
import { SmallBitSet } from "./LOS/SmallBitSet.js";

export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook: refreshToken
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags         Flags being refreshed
 */
function refreshToken(token, flags) {
  if ( !flags.refreshSize ) return;
  const losViewer = token[MODULE_ID]?.[ATVTokenHandler.ID].losViewer;
  if ( losViewer ) losViewer.dirty = true;
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
