/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Wall class

import { MODULE_ID } from "./const.js";

export const PATCHES = {};
PATCHES.DEBUG = {};

// ----- NOTE: Debug Hooks ----- //

/**
 * Hook: updateWall
 * On a wall update, update any debug display.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateWall(_wallD, _changed, _options, _userId) {
  canvas.tokens.placeables.forEach(token => {
    if ( !token.controlled ) return;
    const calc = token.vision?.[MODULE_ID]?.losCalc.calc;
    if ( !calc ) return;
    calc.clearDebug();
    calc._clearCache();
    calc.updateDebug();
  });
}

PATCHES.DEBUG.HOOKS = {
  updateWall
};
