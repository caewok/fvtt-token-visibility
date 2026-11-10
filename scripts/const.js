/* globals
*/
"use strict";

import { ENUMS as LOS_ENUMS, LOS_SETTINGS } from "./LOS/const.js";
export { pointIndicesLabels } from "./LOS/settings.js";

export const MODULE_ID = "tokenvisibility";
export const EPSILON = 1e-08;
export const DOCUMENTATION_URL = "https://github.com/caewok/fvtt-token-visibility/blob/master/README.md";
export const ISSUE_URL = "https://github.com/caewok/fvtt-token-visibility/issues";

export const TRACKER_IDS = {
  VISIBILITY: "visibility",
  LIGHT_METER: "lightMeter",
};

export const FLAGS = {
  OPACITY: "opacity",
};

export const FALLBACK_ICON = "icons/svg/hazard.svg";

/**
 * Options provided to the libGeometry library upon load.
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

  wallHeightRequired: true,
  tokenHeightRequired: true,
};

// Font Awesome icons used in this module in controls or tabs.
export const FA_ICONS = {
  BLOCK_SIGHT: "fa-solid fa-eye-low-vision", // https://fontawesome.com/icons/classic/solid/eye-low-vision
};

export const REGION_BEHAVIORS = {
  BLOCK_SIGHT: "blockSight",
};

export const TEMPLATES = {
  TOKEN_CONFIG: `modules/${MODULE_ID}/templates/token-config.html`,
  WALL_CONFIG: `modules/${MODULE_ID}/templates/wall-config.html`,
};

export const ENUMS = {
  LIGHT_ALGORITHM_TYPES: {
    NONE: "lm-algorithm-none",
    TOKENS: "lm-algorithm-tokens",
    VIEWPOINT: "lm-algorithm-viewpoint",
  },
  ...LOS_ENUMS
}

export const SETTINGS = foundry.utils.mergeObject(foundry.utils.deepClone(LOS_SETTINGS), {
  SUBMENU: "submenu",
  RANGE: {
    ALGORITHM: "range-algorithm",
    POINTS3D: "range-points-3d",
    DISTANCE3D: "range-distance-3d",
  },

  LOS: {
    TARGET: {
      PERCENT: "los-percent",
    },
  },

  LIGHT_MONITOR: {
    ALGORITHM: "lm-algorithm",
  },

  CHANGELOG: "changelog",
  DEBUG: {
    RANGE: "debug-range",
  },
});


