/* globals
game,
Hooks
*/
"use strict";

export const MODULE_ID = "tokenvisibility";
export const EPSILON = 1e-08;
export const DOCUMENTATION_URL = "https://github.com/caewok/fvtt-token-visibility/blob/master/README.md";
export const ISSUE_URL = "https://github.com/caewok/fvtt-token-visibility/issues";

export const TRACKER_IDS = {
  VISIBILITY: "visibility",
  LIGHT_METER: "lightMeter",
};

export const FALLBACK_ICON = "icons/svg/hazard.svg";

/**
 * Checks for libGeometery.
 * @type {object}
 */
export const GEOMETRY_LIB_OPTS = {
  // What geometries we need to track.
  placeableGeometries: [
    "Tile",
    "Token",
    "Region",
    "Wall",
    "Level",
  ],
};

// Font Awesome icons used in this module in controls or tabs.
export const FA_ICONS = {
  BLOCK_SIGHT: "fa-solid fa-eye-low-vision", // https://fontawesome.com/icons/classic/solid/eye-low-vision
};

export const REGION_BEHAVIORS = {
  BLOCK_SIGHT: "blockSight",
};
