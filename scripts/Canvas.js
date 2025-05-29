/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";

// Patches for the Canvas class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Wraps ----- //

/**
 * A hook event that fires when the Canvas is deactivated.
 * Needed here because the destroy token hook is too late; by then, the children of the
 * token layer are already removed and so the graphics geometry gets destroyed twice.
 * @event canvasTearDown
 * @category Canvas
 * @param {Canvas} canvas   The Canvas instance being deactivated
 */
function canvasTearDown(canvas) {
  canvas.tokens.placeables.forEach(token => {
    const losCalc = token[MODULE_ID]?.losCalc;
    if ( !losCalc ) return;
    losCalc.destroy();
    token[MODULE_ID].losCalc = undefined;
  });
}

PATCHES.BASIC.HOOKS = { canvasTearDown };
