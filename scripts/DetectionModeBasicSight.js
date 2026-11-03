/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Mixed wrap DetectionModeBasicSight.prototype._testPoint
 * Modify if the target is not within range, modify the target shape to be only the
 * portion within one or more lights.
 * Does not, at the moment, consider 3d shapes of either the token or the light(s).
 */
function _testPoint(wrapped, visionSource, mode, target, test) {
  // Only apply this test to tokens
  if ( !(target instanceof foundry.canvas.placeables.Token) ) return wrapped(visionSource, mode, target, test);

  // If within range, counts if any portion of the token is visible.
  if ( this._testRange(visionSource, mode, target, test)
    && this._testLOS(visionSource, mode, target, test, { testLighting: false }) ) return true;

  // Outside of vision range, token is visible if the lit portions are visible.
  return this._testLOS(visionSource, mode, target, test, { testLighting: true });
}

PATCHES.BASIC.MIXES = { _testPoint };
