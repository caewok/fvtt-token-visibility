/* globals
canvas,
game,
_token
*/

"use strict";

import { randomUniform } from "./random.js";
import { QBenchmarkLoopFn } from "./benchmark_functions.js";
import { Settings, SETTINGS } from "./settings.js";
import { DefaultSettings } from "./SettingsSubmenu.js";

/*
api = game.modules.get("tokenvisibility").api
await api.bench.benchCurrent()
await api.bench.benchAll();
a

*/

/**
 * Benchmark token visibility.
 * For each token in the scene:
 * - control the token
 * - test visibility of all other tokens
 */

export async function benchAll(n = 100) {
  await benchTokenRange(n);
  await benchTokenLOS(n);
}

export async function benchCurrent(n = 100) {
  game.modules.get("tokenvisibility").api.debug = false;

  const controlled = _token;
  if ( !controlled ) {
    console.error("Must select a single token to benchmark range.");
    return;
  }

  const tokens = canvas.tokens.placeables.filter(t => !t.controlled);
  console.log(`Benching current settings for ${tokens.length} tokens.`);
  console.log(`Range: ${Settings.get(SETTINGS.RANGE.ALGORITHM)}
LOS: ${Settings.get(SETTINGS.LOS.TARGET.ALGORITHM)} | Percent: ${Settings.get(SETTINGS.LOS.TARGET.PERCENT)*100}%`);

  // Store debug status to restore later.
  const debugRange = Settings.get(SETTINGS.DEBUG.RANGE);
  const debugLOS = Settings.get(SETTINGS.DEBUG.LOS);
  await Settings.set(SETTINGS.DEBUG.RANGE, false);
  await Settings.set(SETTINGS.DEBUG.LOS, false);

  await QBenchmarkLoopFn(n, visibilityTestFn, "Visibility", tokens);

  await Settings.set(SETTINGS.DEBUG.RANGE, debugRange);
  await Settings.set(SETTINGS.DEBUG.LOS, debugLOS);
}


export async function benchTokenRange(n = 100) {
  const controlled = _token;
  if ( !controlled ) {
    console.error("Must select a single token to benchmark range.");
    return;
  }

  game.modules.get("tokenvisibility").api.debug = false;

  // Store the current settings to restore later.
  const currentSettings = {};
  for ( const settingName of DefaultSettings.changeableSettings ) {
    currentSettings[settingName] = Settings.get(settingName);
  }

  // Store debug status to restore later.
  const debugRange = Settings.get(SETTINGS.DEBUG.RANGE);
  const debugLOS = Settings.get(SETTINGS.DEBUG.LOS);
  await Settings.set(SETTINGS.DEBUG.RANGE, false);
  await Settings.set(SETTINGS.DEBUG.LOS, false);

  // Count tokens in the scene
  const tokens = canvas.tokens.placeables.filter(t => !t.controlled);
  console.log(`\nBenching token visibility range for ${tokens.length} tokens.`);

  // Walk through points and 2d/3d range.
  const RANGE = SETTINGS.RANGE;
  const TYPES = SETTINGS.POINT_TYPES;

  // NOTE: 2D
  await Settings.set(RANGE.POINTS3D, false);
  await Settings.set(RANGE.DISTANCE3D, false);
  for ( const type of Object.values(TYPES) ) {
    const testName = `2D ${type}`;
    await Settings.set(RANGE.ALGORITHM, type);
    await QBenchmarkLoopFn(n, visibilityTestFn, testName, tokens);
  }

  // NOTE: 3D
  await Settings.set(RANGE.POINTS3D, false);
  await Settings.set(RANGE.DISTANCE3D, false);
  for ( const type of Object.values(TYPES) ) {
    const testName = `3D ${type}`;
    await Settings.set(RANGE.ALGORITHM, type);
    await QBenchmarkLoopFn(n, visibilityTestFn, testName, tokens);
  }

  // Reset
  for ( const [key, value] of Object.entries(currentSettings) ) await Settings.set(key, value);
  await Settings.set(SETTINGS.DEBUG.RANGE, debugRange);
  await Settings.set(SETTINGS.DEBUG.LOS, debugLOS);
}

export async function benchTokenLOS(n = 100) {
  const controlled = _token;
  if ( !controlled ) {
    console.error("Must select a single token to benchmark range.");
    return;
  }

  game.modules.get("tokenvisibility").api.debug = false;

  // Store the current settings to restore later.
  const currentSettings = {};
  for ( const settingName of DefaultSettings.changeableSettings ) {
    currentSettings[settingName] = Settings.get(settingName);
  }

  // Store debug status to restore later.
  const debugRange = Settings.get(SETTINGS.DEBUG.RANGE);
  const debugLOS = Settings.get(SETTINGS.DEBUG.LOS);
  await Settings.set(SETTINGS.DEBUG.RANGE, false);
  await Settings.set(SETTINGS.DEBUG.LOS, false);

  // Count tokens in the scene
  const tokens = canvas.tokens.placeables.filter(t => !t.controlled);
  console.log(`\nBenching token visibility range for ${tokens.length} tokens.`);

  // Walk through default LOS settings.
  for ( const defaultSetting of ["foundry", "dnd5e", "threeD"] ) {
    const settings = DefaultSettings[defaultSetting];
    for ( const [key, value] of Object.entries(settings) ) await Settings.set(key, value);
    await QBenchmarkLoopFn(n, visibilityTestFn, defaultSetting, tokens);
  }

  // Reset
  for ( const [key, value] of Object.entries(currentSettings) ) await Settings.set(key, value);
  await Settings.set(SETTINGS.DEBUG.RANGE, debugRange);
  await Settings.set(SETTINGS.DEBUG.LOS, debugLOS);
}

function visibilityTestFn(tokens) {
  const out = [];

  // Avoid caching the constrained token shape
  // for ( const token of tokens ) token._constrainedTokenBorder = undefined;

  for ( const token of tokens ) {
    const tolerance = token.document.iconSize / 4;

    // Randomize a bit to try to limit caching
    const center = {
      x: token.center.x + Math.round(randomUniform(-10, 10)),
      y: token.center.y + Math.round(randomUniform(-10, 10))
    };

    out.push(canvas.effects.visibility.testVisibility(center, { tolerance, object: token }));
  }
  return out;
}
