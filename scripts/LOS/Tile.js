/* globals
flattenObject
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Patches for the Tile class

import { MODULE_ID } from "../const.js";
import { TilePixelCache } from "./PixelCache.js";
import { TileGeometryHandler } from "./Placeable3dGeometry.js";

export const PATCHES = {};
PATCHES.TILE = {};
PATCHES.AREA3D = {}

/**
 * Getter for Tile.mesh._evPixelCache
 */
function evPixelCache() {
  return this._evPixelCache || (this._evPixelCache = TilePixelCache.fromOverheadTileAlpha(this));
}

PATCHES.TILE.GETTERS = { evPixelCache };

/**
 * Resize tile cache on dimension change; reset the transform matrix for local coordinates
 * on other changes. Wipe the cache if the overhead status changes.
 * TODO: Is it possible to keep the cache when overhead status changes?
 */
function updateTileHook(document, change, _options, _userId) {
  if ( change.overhead ) document.object._evPixelCache = undefined;
  const cache = document.object._evPixelCache;
  if ( !cache ) return;

  if ( Object.hasOwn(change, "x")
    || Object.hasOwn(change, "y")
    || Object.hasOwn(change, "width")
    || Object.hasOwn(change, "height") ) {
    cache._resize();
  }

  if ( Object.hasOwn(change, "rotation")
    || Object.hasOwn(change, "texture")
    || (change.texture
      && (Object.hasOwn(change.texture, "scaleX")
      || Object.hasOwn(change.texture, "scaleY"))) ) {

    cache.clearTransforms();
  }
}

PATCHES.TILE.HOOKS = { updateTile: updateTileHook };

PATCHES.AREA3D = {};

// ----- NOTE: Area3d Hooks ----- //

/**
 * Hook: drawTile
 * Create the geometry used by Area3d
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawTileArea3d(tile) {
  const obj = tile[MODULE_ID] ??= {};
  obj.geomHandler = new TileGeometryHandler(tile);
}

/**
 * Hook: updateTile
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTileArea3d(tileD, changed, _options, _userId) {
  const changeKeys = new Set(Object.keys(flattenObject(changed)));
  if ( !(changeKeys.has("height")
      || changeKeys.has("width")
      || changeKeys.has("texture")
      || changeKeys.has("x")
      || changeKeys.has("y")
      || changeKeys.has("z")
      || changeKeys.has("overhead")) ) return;

  tile[MODULE_ID].geomHandler.update();
}

/**
 * Hook: destroyTile
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyTileArea3d(tile) { tile[MODULE_ID].geomHandler.destroy(); }

PATCHES.AREA3D.HOOKS = {
  drawTile: drawTileArea3d,
  updateTile: updateTileArea3d,
  destroyTile: destroyTileArea3d
};
