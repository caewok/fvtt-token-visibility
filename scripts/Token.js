/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";

export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook: updateToken
 * If the token width/height changes, invalidate the tokenShape.
 * If the token moves, clear all debug drawings.
 * @param {Document} tokenD                         The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow

 */
function updateToken(tokenD, change, _options, _userId) {
  // Token shape changed; invalidate cached shape.
  const token = tokenD.object;
  if ( (Object.hasOwn(change, "width") || Object.hasOwn(change, "height")) && token ) token._tokenShape = undefined;

  // Token moved; clear debug drawings.
  if ( Object.hasOwn(change, "x")
      || Object.hasOwn(change, "y")
      || Object.hasOwn(change, "elevation") ) {
    // Debug: console.debug("Token moved.");
    Settings.clearDebugGraphics();
    // Debug: console.debug("cleared graphics after token moved.");
  }
}

/**
 * Hook: destroyToken
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyToken(token) {
  const losCalc = token.vision?.[MODULE_ID].losCalc;
  if ( !losCalc ) return;
  losCalc.destroy();
}


PATCHES.BASIC.HOOKS = { updateToken, destroyToken };

// ----- NOTE: Wraps ----- //

/**
 * Wrap Token.prototype.updateSource
 * Reset the debugging drawings.
 */
function updateSource(wrapper, ...args) {
  // Debug: console.debug("Token source updated.");
  Settings.clearDebugGraphics();
  // Debug: console.debug("Cleared graphics after token source updated.")
  return wrapper(...args);
}

PATCHES.BASIC.WRAPS = {
  updateSource
};


