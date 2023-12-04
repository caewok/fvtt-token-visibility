/* globals
canvas,
PIXI,
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";
import { GEOMETRY_ID, TokenGeometryHandler } from "./Placeable3dGeometry.js";

export const PATCHES = {};
PATCHES.LOS = {};
PATCHES.AREA3D = {};


// ----- NOTE: Hooks ----- //

/**
 * Hook: updateToken
 * If the token width/height changes, invalidate the tokenShape.
 * @param {Document} tokenD                         The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateToken(tokenD, change, _options, _userId) {
  // Token shape changed; invalidate cached shape.
  const token = tokenD.object;
  if ( !token ) return;
  if ( Object.hasOwn(change, "width")
    || Object.hasOwn(change, "height") ) token._tokenShape = undefined;
}

PATCHES.LOS.HOOKS = { updateToken };

// ----- NOTE: Area3d Hooks ----- //

/**
 * Hook: drawToken
 * Create the geometry used by Area3d
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawTokenArea3d(token) {
  new TokenGeometryHandler(token);
}

/**
 * Hook: updateToken
 * If the token shape or position changes, invalidate the geometry.
 * @param {Document} tokenD                         The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTokenArea3d(tokenD, change, _options, _userId) {
  // Token shape changed; invalidate cached shape.
  const token = tokenD.object;
  if ( !token ) return;
  if ( Object.hasOwn(change, "width")
    || Object.hasOwn(change, "height")
    || Object.hasOwn(change, "x")
    || Object.hasOwn(change, "y")
    || Object.hasOwn(change, "elevation") ) token[GEOMETRY_ID].update();
}

/**
 * Hook: refreshToken
 * @param {PlaceableObject} object    The object instance being refreshed
 * @param {RenderFlags} flags         Flags being refreshed
 */
function refreshTokenArea3d(token, flags) {
  // TODO: What other updates affect the view?
  //       Need to hook updateTokenDocument as well or instead?
  if ( !(flags.refreshPosition || flags.refreshElevation) ) return;
  token[GEOMETRY_ID].update();
}

/**
 * Hook: createActiveEffect
 * If the token prone status changes, invalidate the geometry.
 * @param {ActiveEffect} effect         The effect being applied
 * @param {object} options              Options passed through: { render: true }
 * @param {string} userId               Id of the user triggering the change.
 */
function createActiveEffectArea3d(effect, _options, _userId) {
  const actor = effect.parent;
  if ( !actor || !(actor instanceof Actor) ) return;
  if ( !effect.statuses.has(CONFIG.GeometryLib.proneStatusId) ) return;
  actor.getActiveTokens().forEach(token => token[GEOMETRY_ID].update());
  // Possible alternatives:
  //   // Checking if the token is prone: token.isProne
  //   // Check that the actor does not have additional prone status from something else.
  //   if ( token.actor.statuses.has(CONFIG.GeometryLib.proneStatusId) ) return;
  //   token[GEOMETRY_ID].update();
}


/**
 * Hook: deleteActiveEffect
 * If the token prone status changes, invalidate the geometry.
 * @param {ActiveEffect} effect         The effect being applied
 * @param {object} options              Options passed through: { render: true }
 * @param {string} userId               Id of the user triggering the change.
 */
function deleteActiveEffectArea3d(effect, _options, _userId) {
  const actor = effect.parent;
  if ( !actor || !(actor instanceof Actor) ) return;
  if ( !effect.statuses.has(CONFIG.GeometryLib.proneStatusId) ) return;
  actor.getActiveTokens().forEach(token => token[GEOMETRY_ID].update());
}


/**
 * Hook: destroyToken
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyTokenArea3d(token) { token[GEOMETRY_ID].destroy(); }

PATCHES.AREA3D.HOOKS = {
  drawToken: drawTokenArea3d,
  updateToken: updateTokenArea3d,
  refreshToken: refreshTokenArea3d,
  destroyToken: destroyTokenArea3d,
  createActiveEffect: createActiveEffectArea3d,
  deleteActiveEffect: deleteActiveEffectArea3d
};


// ----- NOTE: Getters ----- //

/**
 * New getter: Token.prototype.constrainedTokenBorder
 * Determine the constrained border shape for this token.
 * @returns {ConstrainedTokenShape|PIXI.Rectangle}
 */
function constrainedTokenBorder() { return ConstrainedTokenBorder.get(this).constrainedBorder(); }

/**
 * New getter: Token.prototype.isConstrainedTokenBorder
 * Determine whether the border is currently constrained for this token.
 * I.e., the token overlaps a wall.
 * @returns {boolean}
 */
function isConstrainedTokenBorder() { return !ConstrainedTokenBorder.get(this)._unrestricted; }

/**
 * New getter: Token.prototype.tokenBorder
 * Determine the correct border shape for this token. Utilize the cached token shape.
 * @returns {PIXI.Polygon|PIXI.Rectangle}
 */
function tokenBorder() { return this.tokenShape.translate(this.x, this.y); }

/**
 * New getter: Token.prototype.tokenShape
 * Cache the token shape.
 * @type {PIXI.Polygon|PIXI.Rectangle}
 */
function tokenShape() { return this._tokenShape || (this._tokenShape = calculateTokenShape(this)); }

PATCHES.LOS.GETTERS = {
  constrainedTokenBorder,
  tokenBorder,
  tokenShape,
  isConstrainedTokenBorder
};


// ----- NOTE: Helper functions ----- //
/**
 * Theoretical token shape at 0,0 origin.
 * @returns {PIXI.Polygon|PIXI.Rectangle}
 */
function calculateTokenShape(token) {
  // TODO: Use RegularPolygon shapes for use with WeilerAtherton
  // Hexagon (for width .5 or 1)
  // Square (for width === height)
  let shape;
  if ( canvas.grid.isHex ) {
    const pts = canvas.grid.grid.getBorderPolygon(token.document.width, token.document.height, 0);
    if ( pts ) shape = new PIXI.Polygon(pts);
  }

  return shape || new PIXI.Rectangle(0, 0, token.w, token.h);
}
