/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "./geometry/const.js";

// Patches for the ActiveEffect class
export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Refresh vision when a token goes prone.
 */
function refreshVisionOnActiveEffect(activeEffect) {
  const proneStatusId = CONFIG[GEOMETRY_LIB_ID].CONFIG.proneStatusId;
  if ( !proneStatusId ) return;
  const isProne = activeEffect?.statuses.some(status => status === proneStatusId);
  if ( !isProne ) return;

  canvas.effects.visibility.refresh();
}


PATCHES.BASIC.HOOKS = {
  createActiveEffect: refreshVisionOnActiveEffect,
  deleteActiveEffect: refreshVisionOnActiveEffect
}
