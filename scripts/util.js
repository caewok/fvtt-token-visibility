/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";


/**
 * Faster version of PlaceableDocument#getFlag.
 * Keyed to this module. Does not handle nested flag properties (use only the base flag property).
 * @param {PlaceableDocument} placeableD
 * @param {string} flag
 * @returns {*} Flag at that position or undefined.
 */
export function fastFlag(placeableD, flag) { return placeableD.flags[MODULE_ID]?.[flag]; }

/**
 * Log if this module's debug config is enabled.
 */
export function log(...args) {
  try {
    if ( CONFIG[MODULE_ID].debug ) console.debug(MODULE_ID, "|", ...args);
  } catch(_e) {  // eslint-disable-line no-unused-vars
    // Empty
  }
}
