/* globals
canvas,
CONFIG,
DetectionModeBasicSight,
game,
PIXI
*/

"use strict";

import { QBenchmarkLoopFn, QBenchmarkLoopFnWithSleep } from "./geometry/Benchmark.js";
import { Settings } from "./settings.js";
import { randomUniform } from "./random.js";
import { buildCustomLOSCalculator } from "./LOSCalculator.js";
import { registerArea3d } from "./patching.js";

/* Use
api = game.modules.get("tokenvisibility").api
await api.bench.benchAll();

await api.bench.benchTokenRange(1000)
await api.bench.benchTokenLOS(100)
await api.bench.TokenVisibility(1000)
*/

/**
 * Benchmark token visibility.
 * For each token in the scene:
 * - control the token
 * - test visibility of all other tokens
 */

export async function benchAll(n = 100, sleep = false) {
  await benchTokenRange(n, sleep);
  await benchTokenLOS(n, sleep);
  await benchTokenVisibility(n, sleep);
}

// ----- NOTE: Setup and summaries ----- //

/**
 * Set controlled tokens to viewers and targeted tokens to targets.
 * If none available, fall back to all tokens
 */
function getTokens() {
  let targets = [...game.user.targets];
  let viewers = canvas.tokens.controlled;
  if ( !targets.length ) targets = canvas.tokens.placeables;
  if ( !viewers.length) viewers = canvas.tokens.placeables;
  return { viewers, targets };
}

/**
 * Construct a table of token percent visibility using the various methods.
 */
function summarizeTokenVisibility(viewers, targets) {
  const calcs = Object.values(Settings.KEYS.LOS.TARGET.TYPES);
  const summary = {};
  for ( const calcType of calcs ) {
    for ( const viewer of viewers ) {
      const losCalc = buildCustomLOSCalculator(viewer, calcType);
      for ( const target of targets ) {
        if ( viewer === target ) continue;
        const label = `${viewer.name} --> ${target.name}`;
        summary[label] = {};
        summary[label][calcType] = Math.round(losCalc.percentVisible(target) * 100 * 10) / 10;
      }
      losCalc.destroy();
    }
  }
  console.table(summary);
}

/**
 * Construct a table of token elevations and distances
 */
function summarizeTokenRange(viewers, targets) {
  const Point3d = CONFIG.GeometryLib.threeD.Point3d;
  const gridFn = CONFIG.GeometryLib.utils.pixelsToGridUnits;
  const summary = {};
  for ( const viewer of viewers ) {
    for ( const target of targets ) {
      if ( viewer === target ) continue;
      const distance2d = PIXI.Point.distanceBetween(viewer.center, target.center);
      const distance3d = Point3d.distanceBetween(
        Point3d.fromTokenCenter(viewer),
        Point3d.fromTokenCenter(target));
      summary[`${viewer.name} --> ${target.name}`] = {
        viewerElevation: viewer.elevationE,
        targetElevation: target.elevationE,
        distance2d: Math.round(gridFn(distance2d) * 10) / 10,
        distance3d: Math.round(gridFn(distance3d) * 10) / 10
      };
    }
  }
  console.table(summary);
}

// ----- NOTE: Visibility testing -----

export async function benchTokenVisibility(n = 100, sleep = false) {
  const { targets } = getTokens();
  console.log(`\nBenchmarking visibility of ${targets.length} targets from user's current perspective and settings.`);

  await storeDebugStatus();
  const fn = sleep ? QBenchmarkLoopFnWithSleep : QBenchmarkLoopFn;
  await fn(n, benchVisibility, "Visibility", targets);
  await revertDebugStatus();
}

function benchVisibility(targets) {
  const out = [];
  for ( const target of targets ) {
    out.push(testVisibility(target));
  }
  return out;
}

function testVisibility(target) {
  const tolerance = target.document.iconSize / 4;

  // Randomize a bit to try to limit caching
  const center = {
    x: target.center.x + Math.round(randomUniform(-10, 10)),
    y: target.center.y + Math.round(randomUniform(-10, 10))
  };

  return canvas.visibility.testVisibility(center, { tolerance, object: target });
}

// ----- NOTE: Range testing -----

export async function benchTokenRange(n = 100, sleep = false) {
  console.log("\n");
  const { viewers, targets } = getTokens();

  console.log("Elevation and distance summary.");
  summarizeTokenRange(viewers, targets);

  console.log("\nBenchmarking token range");
  await storeDebugStatus();
  storeRangeSettings();
  const opts = { sleep };
  console.log("\n");
  for ( const d3 of [false, true] ) {
    opts.d3 = d3;
    for ( const algorithm of Object.values(Settings.KEYS.POINT_TYPES) ) {
      opts.algorithm = algorithm;
      await runRangeTest(n, viewers, targets, opts);
    }
    console.log("\n");
  }
  await revertDebugStatus();
  await revertRangeSettings();
}

async function runRangeTest(n, viewers, targets, { algorithm, d3 = false, sleep = false } = {}) {
  algorithm ??= Settings.KEYS.POINT_TYPES.CENTER;

  const label = (`Range: ${algorithm}, 3d: ${d3}`);
  const { ALGORITHM, POINTS3D, DISTANCE3D } = Settings.KEYS.RANGE;
  await Settings.set(ALGORITHM, algorithm);
  await Settings.set(POINTS3D, d3);
  await Settings.set(DISTANCE3D, d3);

  const fn = sleep ? QBenchmarkLoopFnWithSleep : QBenchmarkLoopFn;
  await fn(n, benchRange, label, viewers, targets);
}

const userSettings = { debug: {}, range: {}, los: {}};
async function storeDebugStatus() {
  const { RANGE, LOS } = Settings.KEYS.DEBUG;
  userSettings.debug.range = Settings.get(RANGE);
  userSettings.debug.los = Settings.get(LOS);
  await Settings.set(RANGE, false);
  await Settings.set(LOS, false);
}

async function revertDebugStatus() {
  const { RANGE, LOS } = Settings.KEYS.DEBUG;
  await Settings.set(RANGE, userSettings.debug.range);
  await Settings.set(LOS, userSettings.debug.los);
}

function storeRangeSettings() {
  const { ALGORITHM, POINTS3D, DISTANCE3D } = Settings.KEYS.RANGE;
  userSettings.range.algorithm = Settings.get(ALGORITHM);
  userSettings.range.points3d = Settings.get(POINTS3D);
  userSettings.range.distance3d = Settings.get(DISTANCE3D);
}

async function revertRangeSettings() {
  const { ALGORITHM, POINTS3D, DISTANCE3D } = Settings.KEYS.RANGE;
  const { algorithm, points3d, distance3d } = userSettings.range;
  await Settings.set(ALGORITHM, algorithm);
  await Settings.set(POINTS3D, points3d);
  await Settings.set(DISTANCE3D, distance3d);
}

function benchRange(viewers, targets) {
  const out = [];
  const testFn = DetectionModeBasicSight.prototype._testRange;
  for ( const viewer of viewers ) {
    for ( const target of targets ) {
      if ( viewer === target ) continue;
      if ( !viewer.vision ) continue;
      out.push(testFn(viewer.vision, "sight", target));
    }
  }
  return out;
}

// ----- NOTE: LOS testing -----

export async function benchTokenLOS(n = 100, sleep = false) {
  console.log("\n");
  const { viewers, targets } = getTokens();
  registerArea3d(); // Required for Area3d algorithms to work.
  console.log("Percent visible using different LOS algorithms.");

  // summarizeTokenVisibility(viewers, targets);

  console.log("\nBenchmarking token los");
  await storeDebugStatus();

  const { POINTS, AREA3D_HYBRID } = Settings.KEYS.LOS.TARGET.TYPES;
  const { CENTER, TWO, THREE, FOUR, FIVE, EIGHT, NINE } = Settings.KEYS.POINT_TYPES;
  // const nSmall = Math.round(n * 0.1); // For the very slow webGL1.
  const opts = { nPoints: CENTER, sleep };

  // Count viewpoints.
  const viewpointCases = { [CENTER]: 1, [TWO]: 2, [THREE]: 3, [FOUR]: 4, [FIVE]: 5, [EIGHT]: 8, [NINE]: 9 }
  const viewpoints = viewpointCases[Settings.get(Settings.KEYS.LOS.VIEWER.NUM_POINTS)]
  console.log(`${viewers.length} viewers, ${viewpoints} viewpoints, ${targets.length} targets`)

  console.log("\n")
  for ( const large of [false, true] ) {
    opts.large = large;
    for ( const algorithm of Object.values(Settings.KEYS.LOS.TARGET.TYPES) ) {
      if ( algorithm === AREA3D_HYBRID ) continue; // Skip for the moment b/c it is failing.
      opts.algorithm = algorithm;
      await runLOSTest(n, viewers, targets, opts);

      // For points test, run additional test using 9 points vs just 1.
      if ( algorithm === POINTS ) {
        opts.nPoints = NINE;
        await runLOSTest(n, viewers, targets, opts);
        opts.nPoints = CENTER;
      }
    }
    console.log("\n")
  }

  await revertDebugStatus();
}

export async function benchTokenLOSAlgorithm(n = 100, { algorithm, large = false, nPoints, sleep = false } = {}) {
  algorithm ??= Settings.KEYS.LOS.TARGET.TYPES.POINTS;
  nPoints ??= Settings.KEYS.POINT_TYPES.NINE;

  const { viewers, targets } = getTokens();
  registerArea3d(); // Required for Area3d algorithms to work.

  await storeDebugStatus();
  await runLOSTest(n, viewers, targets, { algorithm, large, nPoints, sleep });
  await revertDebugStatus();
}

async function revertLOSSettings() {
  const { ALGORITHM, POINT_OPTIONS, LARGE } = Settings.KEYS.LOS.TARGET;
  const { algorithm, points, large } = userSettings.los;
  await Settings.set(ALGORITHM, algorithm);
  await Settings.set(POINT_OPTIONS.NUM_POINTS, points);
  await Settings.set(LARGE, large);
}

async function runLOSTest(n, viewers, targets, { algorithm, large = false, nPoints, sleep = false } = {}) {

  const calcs = viewers.map(viewer => {
    const losCalc = buildCustomLOSCalculator(viewer, algorithm);
    losCalc.config.largeTarget = large;
    if ( algorithm === Settings.KEYS.LOS.TARGET.TYPES.POINTS ) losCalc.viewpoints
      .forEach(viewpoint => viewpoint.config.pointAlgorithm = nPoints);
    return losCalc;
  });

  let label = (`LOS: ${algorithm}, largeToken: ${large}`);
  if ( algorithm === Settings.KEYS.LOS.TARGET.TYPES.POINTS ) label += `, ${nPoints}`;
  const fn = sleep ? QBenchmarkLoopFnWithSleep : QBenchmarkLoopFn;
  await fn(n, benchLOS, label, calcs, targets);
}

function benchLOS(calcs, targets) {
  const out = [];
  for ( const calc of calcs ) {
    for ( const target of targets ) {
      if ( calc.viewer === target ) continue;
      out.push(calc.hasLOS(target));
    }
  }
  return out;
}
