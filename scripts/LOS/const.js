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

export const LOS_HOOKS = { ALGORITHM: "losAlgorithmChanged", DEBUG_LOS: "losDebugLOSChanged" };

export function pointIndicesLabels(MODULE_ID, type = "viewer") {
  const indices = foundry.utils.flattenObject(GeometricPrimitive.POINT_INDICES);
  const out = {};
  for ( const [key, value] of Object.entries(indices) ) {
    if ( type === "viewer" && key.includes("BACK") ) continue; // Viewer viewpoints cannot include the back, b/c the viewer shape blocks them.
    out[value] = game.i18n.localize(`${MODULE_ID}.point-indices.${key}`);
  }
  return out;
}

const INSET_RANGE = { min: 0, max: 0.99, step: 0.01 };

let tokenModifiersApplied = false;

export function registerLOSSettings(MODULE_ID, settingsManager, {
  threshold = false, largeTarget = false, tokenModifiers = true } = {}) {
  const KEYS = settingsManager.KEYS;
  const { VIEWER, TARGET } = KEYS.LOS;
  const CENTER = GeometricPrimitive.POINT_INDICES.CENTER;
  const algorithms = Object.fromEntries(Object.values(ENUMS.ALGORITHM_TYPES)
    .map(t => [t, settingsManager.localize(t)]));

  const pointsField = type => new foundry.data.fields.SetField(new foundry.data.fields.StringField({
    required: true, blank: false,
    initial: String(GeometricPrimitive.POINT_INDICES.CENTER),
    choices: pointIndicesLabels(MODULE_ID, type),
  }));

  // Viewer settings.
  settingsManager.registerSubmenuSetting(VIEWER.POINTS, "losViewer", { type: pointsField("viewer"), default: [CENTER] });
  for ( const key of Object.values(VIEWER.INSETS) ) {
    settingsManager.registerSubmenuSetting(key, "losViewer", { type: Number, range: INSET_RANGE, default: 0 });
  }

  // Target settings.
  settingsManager.registerSubmenuSetting(TARGET.ALGORITHM, "losTarget", { type: String, choices: algorithms, default: ENUMS.ALGORITHM_TYPES.POINTS });
  if ( threshold ) settingsManager.registerSubmenuSetting(TARGET.PERCENT, "losTarget", { type: Number, default: 0, range: { min: 0, max: 1, step: 0.05 } });
  settingsManager.registerSubmenuSetting(TARGET.LARGE, largeTarget ? "losTarget" : undefined, { type: Boolean, default: false });
  settingsManager.registerSubmenuSetting(TARGET.POINTS, "losTarget", { type: pointsField("target"), default: [CENTER] });
  settingsManager.registerSubmenuSetting(TARGET.INSET, "losTarget", { type: Number, range: INSET_RANGE, default: 0.75 });

  // Tokens block
  settingsManager.registerSubmenuSetting(KEYS.LOS.BLOCKING.LIVE, "other", { type: Boolean, default: false });
  settingsManager.registerSubmenuSetting(KEYS.LOS.BLOCKING.DEAD, "other", { type: Boolean, default: false });
  settingsManager.registerSubmenuSetting(KEYS.LOS.BLOCKING.PRONE, "other", { type: Boolean, default: false });

  // Debug.
  settingsManager.registerWorld(KEYS.DEBUG.LOS, { config: true, type: Boolean, default: false,
    onChange: value => Hooks.callAll(`${MODULE_ID}.${LOS_HOOKS.DEBUG_LOS}`, value),
  });

  // Geometry token modifiers.
  if ( tokenModifiers && !tokenModifiersApplied ) {
    registerTokenGeometryModifierSettings(MODULE_ID, settingsManager);
    tokenModifiersApplied = true;
  }
}

function registerTokenGeometryModifierSettings(MODULE_ID, settingsManager) {
  const KEYS = settingsManager.KEYS;
  settingsManager.registerSubmenuSetting(KEYS.PRONE_MULTIPLIER, "other", {
    type: Number,
    range: { max: 1, min: 0, step: 0.1 },
    default: CONFIG[GEOMETRY_LIB_ID].CONFIG.proneMultiplier ?? 0.33, // Same as Wall Height
    onChange: value => CONFIG.GeometryLib.CONFIG.proneMultiplier = value,
  });
  settingsManager.registerSubmenuSetting(KEYS.PRONE_STATUS_ID, "other", {
    type: String,
    default: CONFIG.GeometryLib.CONFIG.proneStatusId || "prone",
    onChange: value => CONFIG.GeometryLib.CONFIG.proneStatusId = value
  });
  settingsManager.registerSubmenuSetting(KEYS.TOKEN_HP_ATTRIBUTE, "other", {
    type: String,
    default: "system.attributes.hp.value",
    onChange: value => CONFIG.GeometryLib.CONFIG.tokenHPId = value,
  });

  // Make sure these are linked at the start.
  CONFIG[GEOMETRY_LIB_ID].CONFIG.proneMultiplier = settingsManager.get(KEYS.PRONE_MULTIPLIER);
  CONFIG[GEOMETRY_LIB_ID].CONFIG.proneStatusId = settingsManager.get(KEYS.PRONE_STATUS_ID);
  CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenHPId = settingsManager.get(KEYS.TOKEN_HP_ATTRIBUTE);
}

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
