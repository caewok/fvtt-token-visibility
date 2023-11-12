/* globals
flattenObject
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Tile class

import { MODULE_ID } from "./const.js";
import { Tile3dGeometry } from "./LOS/Placeable3dGeometry.js";

export const PATCHES = {};
PATCHES.AREA3D = {};

// ----- NOTE: Area3d Hooks ----- //

/**
 * Hook: drawTile
 * Create the geometry used by Area3d
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawTileArea3d(tile) {
  const obj = tile[MODULE_ID] ??= {};
  if ( !tile.document.overhead ) return;
  obj.geometry = new Tile3dGeometry(tile);
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

  // Only overhead tiles are used by Area3d.
  if ( !tileD.overhead ) return;

  // May need to create the geometry if the tile was previously overhead.
  const tile = tileD.object;
  let geometry = tile[MODULE_ID]?.geometry ?? new Tile3dGeometry(tile);
  geometry.updateVertices();
}

/**
 * Hook: destroyTile
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyTileArea3d(tile) {
  const geometry = tile[MODULE_ID]?.geometry;
  if ( geometry ) geometry.destroy();
}

PATCHES.AREA3D.HOOKS = {
  drawTile: drawTileArea3d,
  updateTile: updateTileArea3d,
  destroyTile: destroyTileArea3d
};
