/* globals
game,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";
import { SettingsButton } from "./SettingsButton.js";

// Non-caching alt:
// export function getSetting(settingName) {
//   return game.settings.get(MODULE_ID, settingName);
// }

// For caching to work, need to clean the cache whenever a setting below changes.
// Need function for onChange.
export const settingsCache = new Map();
export function getSetting(settingName) {
  const cached = settingsCache.get(settingName);
  if ( cached === undefined ) {
    const value = game.settings.get(MODULE_ID, settingName);
    settingsCache.set(settingName, value);
    return value;
  }
  return cached;
}

/* Testing cached settings
function fnDefault(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}

N = 1000
await api.bench.QBenchmarkLoopFn(N, getSetting, "cached", "cover-algorithm")
await api.bench.QBenchmarkLoopFn(N, fnDefault, "default", "cover-algorithm")

await api.bench.QBenchmarkLoopFn(N, getSetting, "cached","cover-token-dead")
await api.bench.QBenchmarkLoopFn(N, fnDefault, "default","cover-token-dead")

await api.bench.QBenchmarkLoopFn(N, getSetting, "cached","cover-token-live")
await api.bench.QBenchmarkLoopFn(N, fnDefault, "default","cover-token-live")
*/

export async function setSetting(settingName, value) {
  settingsCache.delete(settingName);
  return game.settings.set(MODULE_ID, settingName, value);
}

export const SETTINGS = {
  AREA3D_USE_SHADOWS: "area3d-use-shadows", // For benchmarking and debugging for now.

  POINT_TYPES: {
    CENTER: "points-center",
    FOUR: "points-four", // Five without center
    FIVE: "points-five", // Corners + center
    EIGHT: "points-eight", // Nine without center
    NINE: "points-nine" // Corners, midpoints, center
  },

  RANGE: {
    ALGORITHM: "range-algorithm",
    POINTS3D: "range-points-3d",
    DISTANCE3D: "range-distance-3d"
  },

  LOS: {
    ALGORITHM: "los-algorithm",
    PERCENT: "los-percent",
    LARGE_TARGET: "los-large-target",
    TYPES: {
      POINTS: "los-points",
      AREA2D: "los-area-2d",
      AREA3D: "los-area-3d"
    },

    VIEWER: {
      NUM_POINTS: "los-points-viewer",
      INSET: "los-inset-viewer"
    },

    POINT_OPTIONS: {
      NUM_POINTS: "los-points-target",
      INSET: "los-inset-target",
      POINTS3D: "los-points-3d"
    }
  },

  BUTTONS: {
    FOUNDRY_DEFAULT: "button-foundry-default",
    DND_5E_DMG: "button-dnd5e-dmg",
    PF2E: "button-pf2e",
    THREE_D: "button-three-d"
  },

  CHANGELOG: "changelog",

  WELCOME_DIALOG: {
    v020: "welcome-dialog-v0-20",
    v030: "welcome-dialog-v0-30"
  },

  MIGRATION: {
    v032: "migration-v032",
    v054: "migration-v054",
    v060: "migration-v060"
  }
};

//
// class FoundryDefaultButton extends SettingsButton {
//   async buttonFn() {
//     await foundryDefaultSettings();
//     ui.notifications.notify(game.i18n.localize(`${MODULE_ID}.settings.button-foundry-default.Notification`));
//   }
// }
//
// class DnD5eButton extends SettingsButton {
//   async buttonFn() {
//     await dnd5eDMGSettings();
//     ui.notifications.notify(game.i18n.localize(`${MODULE_ID}.settings.button-dnd5e-dmg.Notification`));
//   }
// }
//
// class PF2eButton extends SettingsButton {
//   async buttonFn() {
//     await pf2eSettings();
//     ui.notifications.notify(game.i18n.localize(`${MODULE_ID}.settings.button-pf2e.Notification`));
//   }
// }
//
// class ThreeDButton extends SettingsButton {
//   async buttonFn() {
//     await threeDSettings();
//     ui.notifications.notify(game.i18n.localize(`${MODULE_ID}.settings.button-three-d.Notification`));
//   }
// }


export function registerSettings() {
  const localize = key => game.i18n.localize(`${MODULE_ID}.settings.${key}`);

//   game.settings.registerMenu(MODULE_ID, SETTINGS.BUTTONS.FOUNDRY_DEFAULT, {
//     name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.BUTTONS.FOUNDRY_DEFAULT}.Name`),
//     label: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.BUTTONS.FOUNDRY_DEFAULT}.Label`),
//     icon: "fas fa-sliders",
//     type: FoundryDefaultButton,
//     restricted: true
//   });
//
//   game.settings.registerMenu(MODULE_ID, SETTINGS.BUTTONS.DND_5E_DMG, {
//     name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.BUTTONS.DND_5E_DMG}.Name`),
//     label: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.BUTTONS.DND_5E_DMG}.Label`),
//     icon: "fas fa-sliders",
//     type: DnD5eButton,
//     restricted: true
//   });
//
//   game.settings.registerMenu(MODULE_ID, SETTINGS.BUTTONS.PF2E, {
//     name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.BUTTONS.PF2E}.Name`),
//     label: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.BUTTONS.PF2E}.Label`),
//     icon: "fas fa-sliders",
//     type: PF2eButton,
//     restricted: true
//   });
//
//   game.settings.registerMenu(MODULE_ID, SETTINGS.BUTTONS.THREE_D, {
//     name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.BUTTONS.THREE_D}.Name`),
//     label: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.BUTTONS.THREE_D}.Label`),
//     icon: "fas fa-sliders",
//     type: ThreeDButton,
//     restricted: true
//   });

  // ----- NOTE: Range ----- //
  const PT_TYPES = SETTINGS.POINT_TYPES;
  const RTYPES = [PT_TYPES.CENTER, PT_TYPES.FIVE, PT_TYPES.NINE];
  const rangeChoices = {};
  Object.values(RTYPES).forEach(type => rangeChoices[type] = localize(type));

  game.settings.register(MODULE_ID, SETTINGS.RANGE.ALGORITHM, {
    name: localize(`${SETTINGS.RANGE.ALGORITHM}.Name`),
    hint: localize(`${SETTINGS.RANGE.ALGORITHM}.Hint`),
    scope: "world",
    config: true,
    type: String,
    choices: rangeChoices,
    default: RTYPES.NINE
  });

  game.settings.register(MODULE_ID, SETTINGS.RANGE.POINTS3D, {
    name: localize(`${SETTINGS.RANGE.POINTS3D}.Name`),
    hint: localize(`${SETTINGS.RANGE.POINTS3D}.Hint`),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.RANGE.DISTANCE3D, {
    name: localize(`${SETTINGS.RANGE.DISTANCE3D}.Name`),
    hint: localize(`${SETTINGS.RANGE.DISTANCE3D}.Hint`),
    scope: "world",
    config: !MODULES_ACTIVE.LEVELS && !MODULES_ACTIVE.PERFECT_VISION,
    type: Boolean,
    default: true
  });

  // ----- NOTE: Line-of-sight ----- //
  const PT_OPTS = SETTINGS.LOS.POINT_OPTIONS;
  const LTYPES = SETTINGS.LOS.TYPES;
  const losChoices = {};
  const ptChoices = {};
  Object.values(LTYPES).forEach(type => losChoices[type] = localize(type));
  Object.values(PT_TYPES).forEach(type => ptChoices[type] = localize(type));

  game.settings.register(MODULE_ID, SETTINGS.LOS.VIEWER.NUM_POINTS, {
    name: localize(`${SETTINGS.LOS.VIEWER.NUM_POINTS}.Name`),
    hint: localize(`${SETTINGS.LOS.VIEWER.NUM_POINTS}.Hint`),
    scope: "world",
    config: true,
    type: String,
    choices: ptChoices,
    default: PT_TYPES.CENTER
  });

  game.settings.register(MODULE_ID, SETTINGS.LOS.VIEWER.INSET, {
    name: localize(`${SETTINGS.LOS.VIEWER.INSET}.Name`),
    hint: localize(`${SETTINGS.LOS.VIEWER.INSET}.Hint`),
    range: {
      max: 0.99,
      min: 0,
      step: 0.01
    },
    scope: "world",
    config: true, // () => getSetting(SETTINGS.LOS.ALGORITHM) !== LTYPES.POINTS,
    default: 0.75,
    type: Number
  });

  game.settings.register(MODULE_ID, SETTINGS.LOS.ALGORITHM, {
    name: localize(`${SETTINGS.LOS.ALGORITHM}.Name`),
    hint: localize(`${SETTINGS.LOS.ALGORITHM}.Hint`),
    scope: "world",
    config: true,
    type: String,
    choices: losChoices,
    default: LTYPES.NINE
  });

  game.settings.register(MODULE_ID, SETTINGS.LOS.PERCENT, {
    name: localize(`${SETTINGS.LOS.PERCENT}.Name`),
    hint: localize(`${SETTINGS.LOS.PERCENT}.Hint`),
    range: {
      max: 1,
      min: 0,
      step: 0.05
    },
    scope: "world",
    config: true, // () => getSetting(SETTINGS.LOS.ALGORITHM) !== LTYPES.POINTS,
    default: 0,
    type: Number
  });

  game.settings.register(MODULE_ID, PT_OPTS.NUM_POINTS, {
    name: localize(`${PT_OPTS.NUM_POINTS}.Name`),
    hint: localize(`${PT_OPTS.NUM_POINTS}.Hint`),
    scope: "world",
    config: true,
    type: String,
    choices: ptChoices,
    default: PT_TYPES.NINE
  });

  game.settings.register(MODULE_ID, PT_OPTS.INSET, {
    name: localize(`${PT_OPTS.INSET}.Name`),
    hint: localize(`${PT_OPTS.INSET}.Hint`),
    range: {
      max: 0.99,
      min: 0,
      step: 0.01
    },
    scope: "world",
    config: true, // () => getSetting(SETTINGS.LOS.ALGORITHM) !== LTYPES.POINTS,
    default: 0.75,
    type: Number
  });

  game.settings.register(MODULE_ID, PT_OPTS.POINTS3D, {
    name: localize(`${PT_OPTS.POINTS3D}.Name`),
    hint: localize(`${PT_OPTS.POINTS3D}.Hint`),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.LOS.LARGE_TARGET, {
    name: localize(`${SETTINGS.LOS.LARGE_TARGET}.Name`),
    hint: localize(`${SETTINGS.LOS.LARGE_TARGET}.Hint`),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.AREA3D_USE_SHADOWS, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.WELCOME_DIALOG.v030, {
    scope: "world",
    config: false,
    default: false,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.MIGRATION.v032, {
    scope: "world",
    config: false,
    default: false,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.MIGRATION.v054, {
    scope: "world",
    config: false,
    default: false,
    type: Boolean
  });

  game.settings.register(MODULE_ID, SETTINGS.MIGRATION.v060, {
    scope: "world",
    config: false,
    default: false,
    type: Boolean
  });
}

