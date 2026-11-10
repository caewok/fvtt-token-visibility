/* globals
CONFIG,
foundry,
game,
Hooks
*/
"use strict";

import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { GeometricPrimitive } from "../geometry/placeable_geometry/GeometricPrimitive.js";

export const TEMPLATES = {
  // At: `modules/${MODULE_ID}/scripts/LOS/templates/tile-config.html`,
  TILE: new URL("./templates/tile-config.html", import.meta.url).pathname.substring(1),
};

/** @type {enum<string>} */
export const TILE_THRESHOLD_SHAPE_OPTIONS = {
  RECTANGLE: "full", // Fastest, but only trims rectangular transparent border without considering holes or irregular shapes.
  ALPHA_TRIANGLES: "triangles", // In testing, this seems very slow.
  ALPHA_POLYGONS: "polygons", // Much faster than triangles.
  ALPHA_BOUNDING_BOX: "boundingRect",   // Just the outer alpha box.
  ALPHA_BOUNDING_POLYGON: "boundingPolygon", // The outer alpha polygon.
};

export const FLAGS = {
  CUSTOM_TOKENS: {
    FILE_LOC: "customShapeFile",
    NAME: "customShapeName",
    OFFSET: "customShapeOffset",
  },

  TILE_ALPHA_SHAPE: "tileAlphaShape",
  TILE_ALPHA_SHAPE_OPTIONS: {
    ...TILE_THRESHOLD_SHAPE_OPTIONS,
    CALCULATED: "calculated",
    IGNORE: "ignore",
  },
  REGION_BLOCKING: "regionBlocking",
  REGION_BLOCKING_OPTIONS: {
    COVER: "cover",
    SIGHT: "sight",
  },
};

// Track certain modules that complement features of this module.
export const OTHER_MODULES = {
  TERRAIN_MAPPER: {
    KEY: "terrainmapper",
    FLAGS: {
      REGION: {
        WALL_RESTRICTIONS: "wallRestrictions"
      },
    },
  },
  LEVELS: {
    KEY: "levels",
    FLAGS: {
      ALLOW_SIGHT: "noCollision",
    },
  },
  ATV: { KEY: "token_visibility" },
  RIDEABLE: { KEY: "Rideable" },
};

/** @type {Object<CONST.WALL_RESTRICTION_TYPES|DetectionMode.DETECTION_TYPES>} */
export const DETECTION_SENSE_TYPES = {
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT]: "sight",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND]: "sound",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.MOVE]: "move",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER]: "light",
  sight: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
  sound: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND,
  move: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.MOVE,
  light: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER, // No "light" equivalent
};

/** @type {Object<"lighting"|"sounds"|DetectionMode.DETECTION_TYPES>} */
export const DETECTION_SOURCE_TYPES = {
  lighting: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
  sounds: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND,
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT]: "lighting",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND]: "sounds",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.MOVE]: "lighting",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER]: "lighting",
};

export const ENUMS = {
  POINT_TYPES: {
    CENTER: "points-center",
    TWO: "points-two",
    THREE: "points-three", //
    FOUR: "points-four", // Five without center
    FIVE: "points-five", // Corners + center
    EIGHT: "points-eight", // Nine without center
    NINE: "points-nine" // Corners, midpoints, center
  },
  ALGORITHM_TYPES: {
    POINTS: "los-algorithm-points",
    PER_PIXEL: "los-algorithm-per-pixel",
    GEOMETRIC: "los-algorithm-geometric",
    WEBGL2: "los-algorithm-webgl2",
  },
  POINT_INDICES: GeometricPrimitive.POINT_INDICES,
};

export const LOS_SETTINGS = {
  LOS: {
    VIEWER: {
      POINTS: "los-points-options-viewer",
      INSETS: { SIDES: "los-inset-viewer-sides", TOP: "los-inset-viewer-top", BOTTOM: "los-inset-viewer-bottom" },
    },
    TARGET: {
      ALGORITHM: "los-algorithm",
      LARGE: "los-large-target",
      POINTS: "los-points-options-target",
      INSET: "los-inset-target",
    },
    BLOCKING: { LIVE: "live-tokens-block", DEAD: "dead-tokens-block", PRONE: "prone-tokens-block" },
  },
  PRONE_STATUS_ID: "prone-status-id",
  PRONE_MULTIPLIER: "prone-multiplier",
  TOKEN_HP_ATTRIBUTE: "token-hp-attribute",
  DEBUG: { LOS: "debug-los" }
};

export const LOS_HOOKS = {
  ALGORITHM: "losAlgorithmChanged",
  DEBUG_LOS: "losDebugLOSChanged",
  WEBGL2_CONTEXT: "webGL2ContextChanged"
};


// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  for ( const [key, obj] of Object.entries(OTHER_MODULES) ) {
    if ( !game.modules.get(obj.KEY)?.active ) delete OTHER_MODULES[key];
  }
});

// API not necessarily available until ready hook. (Likely added at init.)
Hooks.once("ready", function() {
  const { TERRAIN_MAPPER, RIDEABLE } = OTHER_MODULES;
  if ( TERRAIN_MAPPER ) TERRAIN_MAPPER.API = game.modules.get(TERRAIN_MAPPER.KEY).api;
  if ( RIDEABLE ) RIDEABLE.API = game.modules.get(RIDEABLE.KEY).api;
});
