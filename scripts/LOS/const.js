/* globals
game,
Hooks
*/
"use strict";

export const FLAGS = {
  CUSTOM_TOKENS: {
    FILE_LOC: "customShapeFile",
    NAME: "customShapeName",
    OFFSET: "customShapeOffset",
  },
};

export const TRACKER_IDS = {
  BASE: "tokenvisibility",
  GEOMETRY: {
    PLACEABLE: "geometry",
    TOKEN: {
      NORMAL: "geometry",
      LIT: "litGeometry",
      BRIGHT: "brightLitGeometry",
      SPHERICAL: "sphericalGeometry",
    }
  },
  VISIBILITY: "visibility",
  LIGHT_METER: "lightMeter",
};

/** @type {enum<string>} */
export const TILE_THRESHOLD_SHAPE_OPTIONS: {
  RECTANGLE: "rectangle", // Fastest, but only trims rectangular transparent border without considering holes or irregular shapes.
  ALPHA_TRIANGLES: "alphaThresholdTriangles", // In testing, this seems very slow.
  ALPHA_POLYGONS: "alphaThresholdPolygons", // Much faster than triangles.
},

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
