/* globals
game,
Hooks
*/
"use strict";

export const MODULE_ID = "tokenvisibility";
export const EPSILON = 1e-08;
export const DOCUMENTATION_URL = "https://github.com/caewok/fvtt-token-visibility/blob/master/README.md";
export const ISSUE_URL = "https://github.com/caewok/fvtt-token-visibility/issues";

export const MODULES_ACTIVE = {
  LEVELS: false,
  TOKEN_COVER: false,
  ELEVATED_VISION: false,
  RIDEABLE: false,
  TERRAIN_MAPPER: false,
  API: {}
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.LEVELS = game.modules.get("levels")?.active;
  MODULES_ACTIVE.TOKEN_COVER = game.modules.get("tokencover")?.active;
  MODULES_ACTIVE.ELEVATED_VISION = game.modules.get("elevatedvision")?.active;
  MODULES_ACTIVE.RIDEABLE = game.modules.get("Rideable")?.active;
  MODULES_ACTIVE.TERRAIN_MAPPER = game.modules.get("terrainmapper")?.active;

  if ( MODULES_ACTIVE.RIDEABLE ) MODULES_ACTIVE.API.RIDEABLE = game.modules.get("Rideable").api;
});

export const FLAGS = {
  TERRAIN_MAPPER: {
    REGION: {
      WALL_RESTRICTIONS: "wallRestrictions",
    }
  }
};
