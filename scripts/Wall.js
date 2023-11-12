/* globals
flattenObject
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Wall class

import { MODULE_ID } from "./const.js";
import { Wall3dGeometry } from "./LOS/Placeable3dGeometry.js";

export const PATCHES = {};
PATCHES.AREA3D = {};

// ----- NOTE: Area3d Hooks ----- //

/**
 * Hook: drawWall
 * Create the geometry used by Area3d
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawWallArea3d(wall) {
  const obj = wall[MODULE_ID] ??= {};
  obj.geometry = new Wall3dGeometry(wall);
}

/**
 * Hook: updateWall
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateWallArea3d(wallD, changed, _options, _userId) {
  const changeKeys = new Set(Object.keys(flattenObject(changed)));
  if ( !changeKeys.has("c") ) return;

  const wall = wallD.object;
  const geometry = wall[MODULE_ID]?.geometry;
  if ( !geometry ) return;
  geometry.updateVertices();
}

/**
 * Hook: destroyWall
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyWallArea3d(wall) {
  const geometry = wall[MODULE_ID]?.geometry;
  if ( geometry ) geometry.destroy();
}

PATCHES.AREA3D.HOOKS = {
  drawWall: drawWallArea3d,
  updateWall: updateWallArea3d,
  destroyWall: destroyWallArea3d
};
