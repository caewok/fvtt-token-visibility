/* globals
game,
Hooks
*/
"use strict";

export const MODULE_ID = "tokenvisibility";
export const EPSILON = 1e-08;
export const DOCUMENTATION_URL = "https://github.com/caewok/fvtt-token-visibility/blob/master/README.md";

export const FLAGS = {
  DRAWING: { IS_HOLE: "isHole" }
};

export const MODULES_ACTIVE = {
  WALL_HEIGHT: false,
  PERFECT_VISION: false,
  LEVELS: false,
  DFREDS_CE: false,
  SIMBULS_CC: false,
  MIDI_QOL: false,
  EV: false
};

export const DEBUG = {
  range: false,
  los: false,
  cover: false,
  area: false,
  once: false,
  forceLiveTokensBlock: false,
  forceDeadTokensBlock: false
};


// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.WALL_HEIGHT = game.modules.get("wall-height")?.active;
  MODULES_ACTIVE.PERFECT_VISION = game.modules.get("perfect-vision")?.active;
  MODULES_ACTIVE.LEVELS = game.modules.get("levels")?.active;
  MODULES_ACTIVE.DFREDS_CE = game.modules.get("dfreds-convenient-effects")?.active;
  MODULES_ACTIVE.SIMBULS_CC = game.modules.get("simbuls-cover-calculator")?.active;
  MODULES_ACTIVE.MIDI_QOL = game.modules.get("midi-qol")?.active;
  MODULES_ACTIVE.ELEVATED_VISION = game.modules.get("elevatedvision")?.active;
});
