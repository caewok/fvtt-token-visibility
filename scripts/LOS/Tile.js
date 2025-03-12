/* globals
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Patches for the Tile class
import { MODULE_ID } from "../const.js";
import { TileGeometryHandler, GEOMETRY_ID } from "./Placeable3dGeometry.js";
import { TileTrianglesHandler } from "./PlaceableTrianglesHandler.js";

export const PATCHES = {};
PATCHES.AREA3D = {};
PATCHES.LOS = {};

/**
 * Hook: drawTile
 * Create the geometry used by Area3d
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawTile(tile) {
  new TileTrianglesHandler(tile);
}

/**
 * Hook: updateTile
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateTile(tileD, changed, _options, _userId) {
  const tile = tileD.object;
  if ( !tile ) return;
  const changeKeys = new Set(Object.keys(foundry.utils.flattenObject(changed)));
  tile[TileTrianglesHandler.ID].update(changeKeys);
  // TODO: Only run if other modules are not present.
  // Default to ATV, ATC, then Elevation Shadows.
}

/**
 * Hook: destroyTile
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyTile(tile) { tile[TileTrianglesHandler.ID] = null; }

PATCHES.LOS = {
  drawTile,
  updateTile,
  destroyTile
};

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
  tileD.object?.[GEOMETRY_ID]?.update(changeKeys);
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
