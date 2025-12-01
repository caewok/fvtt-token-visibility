/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { MODULE_ID } from "./const.js";
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

/**
 * Hook: destroyToken
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyToken(token) {
  const losCalc = token[MODULE_ID]?.losCalc;
  if ( losCalc ) losCalc.destroy();
  delete token[MODULE_ID];
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

PATCHES.BASIC.HOOKS = { destroyToken, initializeVisionSources, drawToken, refreshToken };

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
