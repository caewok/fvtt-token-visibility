/* globals
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Wall class

import { MODULE_ID } from "../const.js";
import { WallGeometryHandler } from "./Placeable3dGeometry.js";

export const PATCHES = {};
PATCHES.LOS = {};
PATCHES.AREA3D = {};

// ----- NOTE: Basic hooks ----- //


// ----- NOTE: Area3d Hooks ----- //

/**
 * Hook: drawWall
 * Create the geometry used by Area3d
 * @param {PlaceableObject} object    The object instance being drawn
 */
function drawWallArea3d(wall) {
  const obj = wall[MODULE_ID] ??= {};
  obj.geomHandler = new WallGeometryHandler(wall);
}

/**
 * Hook: updateWall
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateWallArea3d(wallD, changed, _options, _userId) {
  const changeKeys = new Set(Object.keys(foundry.utils.flattenObject(changed)));
  wallD.object[MODULE_ID].geomHandler.update(changeKeys);
}

/**
 * Hook: destroyWall
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyWallArea3d(wall) { wall[MODULE_ID].geomHandler.destroy(); }

PATCHES.AREA3D.HOOKS = {
  drawWall: drawWallArea3d,
  updateWall: updateWallArea3d,
  destroyWall: destroyWallArea3d
};
