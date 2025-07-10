/* globals
game,
Hooks
*/
"use strict";

export const MODULE_ID = "tokenvisibility";
export const EPSILON = 1e-08;
export const DOCUMENTATION_URL = "https://github.com/caewok/fvtt-token-visibility/blob/master/README.md";
export const ISSUE_URL = "https://github.com/caewok/fvtt-token-visibility/issues";

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
  WALL_HEIGHT: { KEY: "wall-height" },
  ATC: { KEY: "token_cover" },
  ATV: { KEY: "token_visibility" },
  RIDEABLE: { KEY: "Rideable" },
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  for ( const obj of Object.values(OTHER_MODULES) ) obj.ACTIVE = game.modules.get(obj.KEY)?.active;
});

// API not necessarily available until ready hook. (Likely added at init.)
Hooks.once("ready", function() {
  const { TERRAIN_MAPPER, RIDEABLE } = OTHER_MODULES;
  if ( TERRAIN_MAPPER.ACTIVE ) TERRAIN_MAPPER.API = game.modules.get(TERRAIN_MAPPER.KEY).api;
  if ( RIDEABLE.ACTIVE ) RIDEABLE.API = game.modules.get(RIDEABLE.KEY).api;
});

export const FLAGS = {
  CUSTOM_TOKENS: {
    FILE_LOC: "customShapeFile",
    NAME: "customShapeName",
    OFFSET: "customShapeOffset",
  },
};
