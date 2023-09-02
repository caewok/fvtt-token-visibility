/* globals
duplicate,
Hooks,
game,
canvas
*/
"use strict";

// Ignores Cover
import {
  IgnoresCover,
  IgnoresCoverSimbuls,
  IgnoresCoverDND5e } from "./IgnoresCover.js";

import { getSetting, SETTINGS, setSetting, updateConfigStatusEffects } from "./settings.js";


export const MODULE_ID = "tokenvisibility";
export const EPSILON = 1e-08;

export const FLAGS = {
  DRAWING: { IS_HOLE: "isHole" },
  COVER: {
    IGNORE: {
      ALL: "ignoreCoverAll",
      MWAK: "ignoreCoverMWAK",
      MSAK: "ignoreCoverMSAK",
      RWAK: "ignoreCoverRWAK",
      RSAK: "ignoreCoverRSAK"
    },

    IGNORE_DND5E: "helpersIgnoreCover",
    SPELLSNIPER: "spellSniper",
    SHARPSHOOTER: "sharpShooter"
  }
};

export const COVER = {};

COVER.TYPES = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  TOTAL: 4
};

COVER.IDS = {};

COVER.IDS[MODULE_ID] = new Set([
  `${MODULE_ID}.cover.LOW`,
  `${MODULE_ID}.cover.MEDIUM`,
  `${MODULE_ID}.cover.HIGH`
]);

COVER.IDS["dfreds-convenient-effects"] = new Set([
  "Convenient Effect: Cover (Half)",
  "Convenient Effect: Cover (Three-Quarters)",
  "Convenient Effect: Cover (Total)"
]);

COVER.IDS.ALL = COVER.IDS[MODULE_ID].union(COVER.IDS["dfreds-convenient-effects"]);

COVER.DFRED_NAMES = {
  LOW: "Cover (Half)",
  MEDIUM: "Cover (Three-Quarters)",
  HIGH: "Cover (Total)"
};


COVER.CATEGORIES = {
  LOW: {
    "dfreds-convenient-effects": "Convenient Effect: Cover (Half)",
    [MODULE_ID]: `${MODULE_ID}.cover.LOW`
  },

  MEDIUM: {
    "dfreds-convenient-effects": "Convenient Effect: Cover (Three-Quarters)",
    [MODULE_ID]: `${MODULE_ID}.cover.MEDIUM`
  },

  HIGH: {
    "dfreds-convenient-effects": "Convenient Effect: Cover (Total)",
    [MODULE_ID]: `${MODULE_ID}.cover.HIGH`
  }
};

COVER.MIN = Math.min(...Object.values(COVER.TYPES));
COVER.MAX = Math.max(...Object.values(COVER.TYPES));

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

export let IGNORES_COVER_HANDLER = IgnoresCover;

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

/**
 * Helper to set the cover ignore handler and, crucially, update all tokens.
 */
export function setCoverIgnoreHandler(handler) {
  if ( !(handler.prototype instanceof IgnoresCover ) ) {
    console.warn("setCoverIgnoreHandler: handler not recognized.");
    return;
  }

  IGNORES_COVER_HANDLER = handler;

  // Simplest just to revert any existing.
  canvas.tokens.placeables.forEach(t => t._ignoresCoverType = undefined);
}

Hooks.once("ready", async function() {
  // Version 0.3.2: "ignoreCover" flag becomes "ignoreCoverAll"
  await migrateIgnoreCoverFlag();
  await migrateCoverStatusData();

  // Set the ignores cover handler based on what systems and modules are active
  const handler = MODULES_ACTIVE.SIMBULS_CC ? IgnoresCoverSimbuls
    : game.system.id === "dnd5e" ? IgnoresCoverDND5e : IgnoresCover;

  setCoverIgnoreHandler(handler);
});


/**
 * Cover flag was originally "ignoreCover".
 * As of v0.3.2, all, mwak, etc. were introduced. So migrate the "ignoreCover" to "ignoreCoverAll"
 */
async function migrateIgnoreCoverFlag() {
  if ( getSetting(SETTINGS.MIGRATION.v032) ) return;

  // Confirm that actor flags are updated to newest version
  // IGNORE: "ignoreCover" --> "ignoreCoverAll"
  game.actors.forEach(a => {
    const allCover = a.getFlag(MODULE_ID, "ignoreCover");
    if ( allCover ) {
      a.setFlag(MODULE_ID, FLAGS.COVER.IGNORE.ALL, allCover);
      a.unsetFlag(MODULE_ID, "ignoreCover");
    }
  });

  // Unlinked tokens may not otherwise get updated.
  canvas.tokens.placeables.forEach(t => {
    const allCover = t.actor.getFlag(MODULE_ID, "ignoreCover");
    if ( allCover ) {
      t.actor.setFlag(MODULE_ID, FLAGS.COVER.IGNORE.ALL, allCover);
      t.actor.unsetFlag(MODULE_ID, "ignoreCover");
    }
  });

  await setSetting(SETTINGS.MIGRATION.v032, true);
}

async function migrateCoverStatusData() {
  if ( getSetting(SETTINGS.MIGRATION.v054) ) return;

  // Update config status effects.
  const allStatusEffects = getSetting(SETTINGS.COVER.EFFECTS);
  for ( const systemId of Object.keys(allStatusEffects) ) {
    const systemStatusEffects = allStatusEffects[systemId];
    for ( const type of Object.keys(systemStatusEffects) ) {
      const effectData = systemStatusEffects[type];

      if ( !effectData.name ) effectData.name = effectData.label;
      delete effectData.label;

      if ( !effectData.id ) effectData.id = effectData._id;
      delete effectData._id;

      switch ( systemId ) {
        case "generic":
          if ( type === "LOW" && effectData.name === "Low" ) effectData.name = "tokenvisibility.Cover.Low";
          if ( type === "MEDIUM" && effectData.name === "Medium" ) effectData.name = "tokenvisibility.Cover.Medium";
          if ( type === "HIGH" && effectData.name === "High" ) effectData.name = "tokenvisibility.Cover.High";
          break;
        case "dnd5e":
        case "dnd5e_midiqol":
          if ( type === "LOW" && effectData.name === "Half" ) effectData.name = "DND5E.CoverHalf";
          if ( type === "MEDIUM" && effectData.name === "Three-Quarters" ) effectData.name = "DND5E.CoverThreeQuarters";
          if ( type === "HIGH" && effectData.name === "Total" ) effectData.name = "DND5E.CoverTotal";
          break;
        case "pf2e":
          if ( type === "LOW" && effectData.name === "Lesser" ) effectData.name = "PF2E.Cover.Lesser";
          if ( type === "MEDIUM" && effectData.name === "Standard" ) effectData.name = "PF2E.Cover.Standard";
          if ( type === "HIGH" && effectData.name === "Greater" ) effectData.name = "PF2E.Cover.Greater";
          break;
      }
      allStatusEffects[systemId][type] = effectData;
    }
  }

  await setSetting(SETTINGS.COVER.EFFECTS, allStatusEffects);
  updateConfigStatusEffects();
  await setSetting(SETTINGS.MIGRATION.v054, true);
}


// Default status effects for different systems.
// {0: 'Custom', 1: 'Multiply', 2: 'Add', 3: 'Downgrade', 4: 'Upgrade', 5: 'Override'}
export const STATUS_EFFECTS = {
  generic: {
    LOW: {
      id: `${MODULE_ID}.cover.LOW`,
      icon: `modules/${MODULE_ID}/assets/shield_low_gray.svg`,
      name: "tokenvisibility.Cover.Low"
    },

    MEDIUM: {
      id: `${MODULE_ID}.cover.MEDIUM`,
      icon: `modules/${MODULE_ID}/assets/shield_medium_gray.svg`,
      name: "tokenvisibility.Cover.Medium"
    },

    HIGH: {
      id: `${MODULE_ID}.cover.HIGH`,
      icon: `modules/${MODULE_ID}/assets/shield_high_gray.svg`,
      name: "tokenvisibility.Cover.High"
    }
  }
};

STATUS_EFFECTS.dnd5e = duplicate(STATUS_EFFECTS.generic);
STATUS_EFFECTS.dnd5e.LOW.name = "DND5E.CoverHalf";
STATUS_EFFECTS.dnd5e.MEDIUM.name = "DND5E.CoverThreeQuarters";
STATUS_EFFECTS.dnd5e.HIGH.name = "DND5E.CoverTotal";

STATUS_EFFECTS.dnd5e.LOW.changes = [
  {
    key: "system.attributes.ac.cover",
    mode: 2,
    value: "+2"
  },

  {
    key: "system.attributes.dex.saveBonus",
    mode: 2,
    value: "+2"
  }
];


STATUS_EFFECTS.dnd5e.MEDIUM.changes = [
  {
    key: "system.attributes.ac.cover",
    mode: 2,
    value: "+5"
  },

  {
    key: "system.attributes.dex.bonuses.save",
    mode: 2,
    value: "+5"
  }
];

STATUS_EFFECTS.dnd5e.HIGH.changes = [
  {
    key: "system.attributes.ac.cover",
    mode: 2,
    value: "+99"
  },

  {
    key: "system.attributes.dex.bonuses.save",
    mode: 2,
    value: "+99"
  }
];

STATUS_EFFECTS.dnd5e_midiqol = duplicate(STATUS_EFFECTS.dnd5e);
STATUS_EFFECTS.dnd5e_midiqol.HIGH.changes = [
  {
    key: "flags.midi-qol.grants.attack.fail.all",
    mode: 0,
    value: "1"
  }
];


STATUS_EFFECTS.pf2e = duplicate(STATUS_EFFECTS.generic);
STATUS_EFFECTS.pf2e.LOW.name = "PF2E.Cover.Lesser";
STATUS_EFFECTS.pf2e.MEDIUM.name = "PF2E.Cover.Standard";
STATUS_EFFECTS.pf2e.HIGH.name = "PF2E.Cover.Greater";
