/* globals
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";

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

  RANGE: {
    ALGORITHM: "range-algorithm",
    TYPES: {
      CENTER: "range-points-center",
      FIVE: "range-points-five",
      NINE: "range-points-nine"
    },
    POINTS3D: "range-points-3d",
    DISTANCE3D: "range-distance-3d"
  },

  LOS: {
    ALGORITHM: "los-algorithm",
    TYPES: {
      POINTS: "los-points",
      CORNERS: "los-corners",
      AREA: "los-area",
      AREA3D: "los-area-3d"
    },

    PERCENT_AREA: "los-percent-area"
  },

  CHANGELOG: "changelog",

  WELCOME_DIALOG: {
    v020: "welcome-dialog-v0-20",
    v030: "welcome-dialog-v0-30"
  },

  MIGRATION: {
    v032: "migration-v032",
    v054: "migration-v054"
  }
};


/* Range testing types:
1. Center point -- Only test the center point of tokens.
2. Foundry -- Use the Foundry 8 points.
3. 3d Foundry -- Add additional points to top and bottom, 27 total

For 3d, test points in 3 dimensions.
*/

/* LOS testing types:
1. Points --- Use the same points from range, test if contained in LOS polygon.
3. Area -- Use token area.

For area, provide a slider for 0–100% of token area.
Each token should have a setting for bounds scale for vision.

For 3d points, don't test los contains for extra 3d Foundry points. (They would obv. be the same. )
For 3d points, do test wall collisions for non-infinite walls.
(Infinite walls included in LOS.)
*/

/* Cover testing types:
1. Center to 4 Corners -- from the center point of the token to 4 corners
Half trigger: 1 (hex: 1)
3/4 trigger: 3 (hex: 4)
2. Corner to Four Corner -- DMG rules; vision from each occupied grid point
Half trigger: 1 (hex: 1)
3/4 trigger: 3 (hex: 4)
3. Center to Center -- PF2e version
3/4 (standard)
4. Area
Half trigger: % area
3/4 trigger: % area
full trigger: % area

3D versions ( same triggers )
5. Center to cube corners
6. Cube corner to cube corners
7. 3d Area


Other settings:
GM can provide the name of an active effect to apply when covered. Applies to the token with cover.
- low active effect
- medium active effect
- high active effect

Cover Names:
Generic: low, medium, high
PF2e: lesser, standard, greater
dnd5e: half, 3/4, full

*/

export function registerSettings() {
  const RTYPES = SETTINGS.RANGE.TYPES;
  const LTYPES = SETTINGS.LOS.TYPES;

  game.settings.register(MODULE_ID, SETTINGS.RANGE.ALGORITHM, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.RANGE.ALGORITHM}.Name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.RANGE.ALGORITHM}.Hint`),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [RTYPES.CENTER]: game.i18n.localize(`${MODULE_ID}.settings.${RTYPES.CENTER}`),
      [RTYPES.FIVE]: game.i18n.localize(`${MODULE_ID}.settings.${RTYPES.FIVE}`),
      [RTYPES.NINE]: game.i18n.localize(`${MODULE_ID}.settings.${RTYPES.NINE}`)
    },
    default: RTYPES.NINE
  });

  game.settings.register(MODULE_ID, SETTINGS.RANGE.POINTS3D, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.RANGE.POINTS3D}.Name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.RANGE.POINTS3D}.Hint`),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.RANGE.DISTANCE3D, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.RANGE.DISTANCE3D}.Name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.RANGE.DISTANCE3D}.Hint`),
    scope: "world",
    config: !MODULES_ACTIVE.LEVELS && !MODULES_ACTIVE.PERFECT_VISION,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.LOS.ALGORITHM, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.LOS.ALGORITHM}.Name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.LOS.ALGORITHM}.Hint`),
    scope: "world",
    config: true,
    type: String,
    choices: {
      [LTYPES.POINTS]: game.i18n.localize(`${MODULE_ID}.settings.${LTYPES.POINTS}`),
      [LTYPES.CORNERS]: game.i18n.localize(`${MODULE_ID}.settings.${LTYPES.CORNERS}`),
      [LTYPES.AREA]: game.i18n.localize(`${MODULE_ID}.settings.${LTYPES.AREA}`),
      [LTYPES.AREA3D]: game.i18n.localize(`${MODULE_ID}.settings.${LTYPES.AREA3D}`)
    },
    default: LTYPES.POINTS
  });

  game.settings.register(MODULE_ID, SETTINGS.LOS.PERCENT_AREA, {
    name: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.LOS.PERCENT_AREA}.Name`),
    hint: game.i18n.localize(`${MODULE_ID}.settings.${SETTINGS.LOS.PERCENT_AREA}.Hint`),
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
}
