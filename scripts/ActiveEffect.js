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
  if ( !canvas?.ready ) return;
  const proneStatusId = CONFIG[GEOMETRY_LIB_ID].CONFIG.proneStatusId;
  if ( !proneStatusId ) return;
  const isProne = activeEffect?.statuses.has(proneStatusId);
  if ( !isProne ) return;
  canvas.perception.update({ refreshVision: true })
}


PATCHES.BASIC.HOOKS = {
  createActiveEffect: refreshVisionOnActiveEffect,
  deleteActiveEffect: refreshVisionOnActiveEffect
}
