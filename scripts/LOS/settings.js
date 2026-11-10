/* globals
CONFIG,
foundry,
game,
Hooks
*/
"use strict";

import { ENUMS, LOS_HOOKS } from "./const.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { GeometricPrimitive } from "../geometry/placeable_geometry/GeometricPrimitive.js";

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
  settingsManager.registerSubmenuSetting(TARGET.ALGORITHM, "losTarget", {
    type: String,
    choices: algorithms,
    default: ENUMS.ALGORITHM_TYPES.POINTS,
    onChange: value => Hooks.callAll(`${MODULE_ID}.${LOS_HOOKS.ALGORITHM}`, value),
  });
  if ( threshold ) settingsManager.registerSubmenuSetting(TARGET.PERCENT, "losTarget", {
    type: Number,
    default: 0,
    range: { min: 0, max: 1, step: 0.05 }
  });
  settingsManager.registerSubmenuSetting(TARGET.LARGE, largeTarget ? "losTarget" : undefined, { type: Boolean, default: false });
  settingsManager.registerSubmenuSetting(TARGET.POINTS, "losTarget", { type: pointsField("target"), default: [CENTER] });
  settingsManager.registerSubmenuSetting(TARGET.INSET, "losTarget", { type: Number, range: INSET_RANGE, default: 0.75 });

  // Tokens block
  settingsManager.registerSubmenuSetting(KEYS.LOS.BLOCKING.LIVE, "other", { type: Boolean, default: false });
  settingsManager.registerSubmenuSetting(KEYS.LOS.BLOCKING.DEAD, "other", { type: Boolean, default: false });
  settingsManager.registerSubmenuSetting(KEYS.LOS.BLOCKING.PRONE, "other", { type: Boolean, default: false });

  // Debug.
  settingsManager.registerWorld(KEYS.DEBUG.LOS, {
    config: true,
    type: Boolean,
    default: false,
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
