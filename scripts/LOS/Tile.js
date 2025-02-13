/* globals
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Patches for the Tile class

import { TileGeometryHandler, GEOMETRY_ID } from "./Placeable3dGeometry.js";

export const PATCHES = {};
PATCHES.AREA3D = {};

// ----- NOTE: Area3d Hooks ----- //

/**
 * Hook: drawTile
 * Create the geometry used by Area3d
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawTileArea3d(tile) {
  new TileGeometryHandler(tile);
}

/**
 * Hook: updateTile
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTileArea3d(tileD, changed, _options, _userId) {
  const changeKeys = new Set(Object.keys(foundry.utils.flattenObject(changed)));
  if ( !(changeKeys.has("height")
      || changeKeys.has("width")
      || changeKeys.has("texture")
      || changeKeys.has("x")
      || changeKeys.has("y")
      || changeKeys.has("z")
      || changeKeys.has("overhead")) ) return;

  tileD.object?.[GEOMETRY_ID]?.update();
}

/**
 * Hook: destroyTile
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyTileArea3d(tile) { tile[GEOMETRY_ID].destroy(); }

PATCHES.AREA3D.HOOKS = {
  drawTile: drawTileArea3d,
  updateTile: updateTileArea3d,
  destroyTile: destroyTileArea3d
};
