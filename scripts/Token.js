/* globals
Actor,
canvas,
CONFIG
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { MODULE_ID } from "./const.js";
import { LOSCalculator } from "./LOSCalculator.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.DEBUG = {};

// ----- NOTE: Hooks ----- //



/**
 * Hook: destroyToken
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyToken(token) {
  const losCalc = token.vision?.[MODULE_ID]?.losCalc;
  losCalc?.destroy();
}

PATCHES.BASIC.HOOKS = { destroyToken };

// ----- NOTE: Wraps ----- //

/**
 * Wrap Token.prototype.initializeVisionSource
 * Add los calculator.
 * Update the VisionSource instance associated with this Token.
 * @param {object} [options]        Options which affect how the vision source is updated
 * @param {boolean} [options.deleted]   Indicate that this vision source has been deleted.
 */
function initializeVisionSource(wrapped, options) {
  wrapped(options);
  if ( !this.vision ) return;
  const obj = this.vision[MODULE_ID] ??= {};
  obj.losCalc ??= new LOSCalculator(this);
}

PATCHES.BASIC.WRAPS = { initializeVisionSource };

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
  losCalc?.clearDebug();
//   if ( controlled ) {
//     if ( calc.openDebugPopout ) await calc.openDebugPopout();
//     updateDebugForControlledToken(token)
//   }
}

/**
 * Hook: targetToken
 * Check for other controlled tokens and update their Area3d debug popout to point at this target.
 * @param {User} user        The User doing the targeting
 * @param {Token} token      The targeted Token
 * @param {boolean} targeted Whether the Token has been targeted or untargeted
 */
function targetTokenDebugHook(user, target, targeted) {
//   if ( !targeted || game.user !== user ) return;
//   canvas.tokens.placeables.forEach(token => {
//     if ( token === target || !token.controlled ) return;
//     const calc = token.vision?.[MODULE_ID]?.losCalc.calc;
//     if ( !calc ) return;
//     calc._clearCache();
//     calc.target = target;
//     // calc.updateDebug();
//   });
}

/**
 * Hook: updateToken
 * If the token moves, clear all debug drawings.
 * @param {Document} tokenD                         The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTokenDebugHook(tokenD, change, _options, _userId) {
  if ( !(Object.hasOwn(change, "x")
      || Object.hasOwn(change, "y")
      || Object.hasOwn(change, "elevation")
      || Object.hasOwn(change, "rotation")
      || Object.hasOwn(change, "width")
      || Object.hasOwn(change, "height")) ) return;

  // Token moved
  const token = tokenD.object;
  if ( token.controlled ) updateDebugForControlledToken(token);
  updateDebugForRelatedTokens(token);
}

/**
 * If token position is refreshed (i.e., clone), then clear debug.
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlag} flags
 */
function refreshTokenDebugHook(token, flags) {
  if ( !flags.refreshPosition ) return;
  if ( token.controlled ) updateDebugForControlledToken(token);
  updateDebugForRelatedTokens(token);
}

/**
 * Hook: createActiveEffect
 * If the token prone status changes, invalidate the geometry.
 * @param {ActiveEffect} effect         The effect being applied
 * @param {object} options              Options passed through: { render: true }
 * @param {string} userId               Id of the user triggering the change.
 */
function createActiveEffectDebugHook(effect, _options, _userId) {
  const actor = effect.parent;
  if ( !actor || !(actor instanceof Actor) ) return;
  if ( !effect.statuses.has(CONFIG.GeometryLib.proneStatusId) ) return;
  actor.getActiveTokens().forEach(token => {
    if ( token.controlled ) updateDebugForControlledToken(token);
    updateDebugForRelatedTokens(token);
  });
}

/**
 * Hook: deleteActiveEffect
 * If the token prone status changes, invalidate the geometry.
 * @param {ActiveEffect} effect         The effect being applied
 * @param {object} options              Options passed through: { render: true }
 * @param {string} userId               Id of the user triggering the change.
 */
function deleteActiveEffectDebugHook(effect, _options, _userId) {
  const actor = effect.parent;
  if ( !actor || !(actor instanceof Actor) ) return;
  if ( !effect.statuses.has(CONFIG.GeometryLib.proneStatusId) ) return;
  actor.getActiveTokens().forEach(token => {
    if ( token.controlled ) updateDebugForControlledToken(token);
    updateDebugForRelatedTokens(token);
  });
}

function updateDebugForControlledToken(changedToken) {
  // If this token is controlled, update its LOS canvas display to every other token.
  const changedCalc = changedToken.vision?.[MODULE_ID]?.losCalc.calc;
  if ( !changedCalc ) return;
  changedCalc.clearDebug();
  canvas.tokens.placeables.forEach(token => {
    if ( token === changedToken ) return;
    changedCalc._clearCache();
    changedCalc.target = token;
    changedCalc.updateDebug();
  });

}

/**
 * Update debug graphics for tokens related to this one.
 * @param {Token} changedToken    Token that has been updated (position, etc.)
 */
function updateDebugForRelatedTokens(changedToken) {
  // For any other controlled token, update its LOS canvas display for this one.
  canvas.tokens.placeables.forEach(token => {
    if ( token === changedToken || !token.controlled ) return;
    const calc = token.vision?.[MODULE_ID]?.losCalc.calc;
    if ( !calc ) return;
    if ( calc.target === changedToken ) calc.clearDebug();
    calc._clearCache();
    calc.target = changedToken;
    calc.updateDebug();
  });
}

PATCHES.DEBUG.HOOKS = {
  controlToken: controlTokenDebugHook,
  // updateToken: updateTokenDebugHook,
  // refreshToken: refreshTokenDebugHook,
  // targetToken: targetTokenDebugHook,
  // createActiveEffect: createActiveEffectDebugHook,
  // deleteActiveEffect: deleteActiveEffectDebugHook
};
