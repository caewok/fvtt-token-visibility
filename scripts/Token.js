/* globals
foundry,
game,
Token,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { MODULE_ID } from "./const.js";
import { buildLOSViewer } from "./LOSCalculator.js";
import { ATVTokenHandler } from "./TokenHandler.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.DEBUG = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook: drawToken
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawToken(token) {
  if ( !token[ATVTokenHandler.constructor.ATVTokenHandlerID] ) new ATVTokenHandler(token);
}

/**
 * Hook: destroyToken
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyToken(token) {
  const losCalc = token[MODULE_ID]?.losCalc;
  if ( losCalc ) {
    losCalc.destroy();
    token[MODULE_ID].losCalc = undefined;
  }
  const atv = token[MODULE_ID]?.[ATVTokenHandler.constructor.ATVTokenHandlerID];
  if ( atv ) token[MODULE_ID][ATVTokenHandler.constructor.ATVTokenHandlerID] = undefined;
}

/**
 * A hook event that fires when the set of vision sources are initialized.
 * @event initializeVisionSources
 * @category CanvasVisibility
 * @param {Collection<string, VisionSource>} sources  The collection of current vision sources
 */
export function initializeVisionSources(sources) {
  // For each token vision source, create a viewerLOS if one does not yet exist.
  for ( const source of sources.values() ) {
    const token = source.object;
    if ( !token || !(token instanceof foundry.canvas.placeables.Token) ) continue;
    const obj = token[MODULE_ID] ??= {};
    obj.losCalc ??= buildLOSViewer(token);
  }
}

PATCHES.BASIC.HOOKS = { destroyToken, initializeVisionSources, drawToken };

// ----- NOTE: Debug Hooks ----- //

/**
 * Hook: controlToken
 * If the token is uncontrolled, clear debug drawings.
 * @event controlObject
 * @category PlaceableObject
 * @param {PlaceableObject} object The object instance which is selected/deselected.
 * @param {boolean} controlled     Whether the PlaceableObject is selected or not.
 */
async function controlTokenDebugHook(token, controlled) {
  const losCalc = token.vision?.[MODULE_ID]?.losCalc;
  if ( !losCalc ) return;
  losCalc.clearDebug();
  if ( losCalc.is3d ) {
    if ( controlled ) await losCalc.openDebugPopout();
    else await losCalc.closeDebugPopout();
  }
}

PATCHES.DEBUG.HOOKS = {
  controlToken: controlTokenDebugHook,
};
