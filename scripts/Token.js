/* globals
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class

import { MODULE_ID } from "./const.js";
import { ConstrainedTokenBorder } from "./LOS/ConstrainedTokenBorder.js";
import { Settings } from "./settings.js";
import { Token3dGeometry } from "./LOS/Placeable3dGeometry.js";

export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.AREA3D = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook controlToken
 * If the token is controlled or uncontrolled, clear debug drawings.
 */
function controlToken(_token, _controlled) {
  // Settings.clearDebugGraphics();
  console.debug("Token controlled.");
}

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
    Settings.clearDebugGraphics();
    console.debug("Token moved.");
  }
}

PATCHES.BASIC.HOOKS = { controlToken, updateToken };


// ----- NOTE: Area3d Hooks ----- //

/**
 * Hook: drawToken
 * Create the geometry used by Area3d
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawTokenArea3d(token) {
  const obj = token[MODULE_ID] ??= {};
  obj.geometry = new Token3dGeometry(token);
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

  const geometry = token[MODULE_ID]?.geometry;
  if ( !geometry ) return;
  geometry.updateVertices();
}

/**
 * Hook: destroyToken
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyTokenArea3d(token) {
  const geometry = token[MODULE_ID]?.geometry;
  if ( geometry ) geometry.destroy();
}

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
  Settings.clearDebugGraphics();
  console.debug("Token source updated.");
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
  tokenShape
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
