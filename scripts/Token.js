/* globals
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { MODULE_ID } from "./const.js";
import { ConstrainedTokenBorder } from "./LOS/ConstrainedTokenBorder.js";
import { Settings } from "./settings.js";
import { TokenGeometryHandler } from "./LOS/Placeable3dGeometry.js";
import { LOSCalculator } from "./LOSCalculator.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.AREA3D = {};

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


// ----- NOTE: Area3d Hooks ----- //

/**
 * Hook: drawToken
 * Create the geometry used by Area3d
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawTokenArea3d(token) {
  const obj = token[MODULE_ID] ??= {};
  obj.geomHandler = new TokenGeometryHandler(token);
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
  token[MODULE_ID].geomHandler.update();
}

/**
 * Hook: destroyToken
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyTokenArea3d(token) { token[MODULE_ID].geomHandler.destroy(); }

PATCHES.AREA3D.HOOKS = {
  drawToken: drawTokenArea3d,
  refreshToken: refreshTokenArea3d,
  destroyToken: destroyTokenArea3d
};

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

PATCHES.BASIC.GETTERS = {
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
