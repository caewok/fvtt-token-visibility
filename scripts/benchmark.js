/* globals
canvas,
CONFIG,
foundry,
game,
PIXI
*/

"use strict";

import { QBenchmarkLoopFn, QBenchmarkLoopFnWithSleep, quantile } from "./geometry/Benchmark.js";
import { Settings } from "./settings.js";
import { randomUniform } from "./random.js";
import { buildCustomLOSViewer, buildCustomLOSCalculator, CalculatorConfig, LOSViewerConfig } from "./LOSCalculator.js";
import { ViewerLOS } from "./LOS/ViewerLOS.js";
import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { pixelsToGridUnits } from "./geometry/util.js";

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
  await benchTokenLOS(n, { sleep });
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
// export function summarizeTokenVisibility(viewers, targets) {
//   const calcs = Object.values(Settings.KEYS.LOS.TARGET.TYPES);
//   const summary = {};
//   const opts = { calcName: null };
//   for ( const calcType of calcs ) {
//     for ( const viewer of viewers ) {
//       opts.calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[calc];
//       const losCalc = buildCustomLOSViewer(viewer, opts);
//       for ( const target of targets ) {
//         if ( viewer === target ) continue;
//         const label = `${viewer.name} --> ${target.name}`;
//         summary[label] = {};
//         summary[label][calcType] = Math.round(losCalc.percentVisible(target) * 100 * 10) / 10;
//       }
//       losCalc.destroy();
//     }
//   }
//   console.table(summary);
// }

/**
 * Construct a table of token elevations and distances
 */
function summarizeTokenRange(viewers, targets) {
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
        distance2d: Math.round(pixelsToGridUnits(distance2d) * 10) / 10,
        distance3d: Math.round(pixelsToGridUnits(distance3d) * 10) / 10
      };
    }
  }
  console.table(summary);
}

// ----- NOTE: Visibility testing -----

export async function benchTokenVisibility(n = 100, sleep = false) {
  const { targets } = getTokens();
  console.log(`\nBenchmarking visibility of ${targets.length} targets from user's current perspective and settings.`);
  console.log("\nBenchmarking token los");
  console.log("Calculator Config");
  console.table(foundry.utils.flattenObject(CalculatorConfig()));
  console.log(`\nViewer Config for algorithm ${Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM)}`);
  console.table(LOSViewerConfig());

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
  const testFn = foundry.canvas.perception.DetectionModeDarkvision.prototype._testRange;
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

export async function benchTokenLOS(n = 100, opts = {}) {
  console.log("\n");
  const { viewers, targets } = getTokens();
  console.log("Percent visible using different LOS algorithms.");

  // summarizeTokenVisibility(viewers, targets);

  console.log("\nBenchmarking token los");
  console.log("Calculator Config");
  console.table(foundry.utils.flattenObject(CalculatorConfig()));
  console.log("\nViewer Config")
  console.table(LOSViewerConfig());


  await storeDebugStatus();
  opts.movement ??= false
  console.log(`${viewers.length} viewers, ${targets.length} targets`)
  console.log("\n")
  const fn = opts.movement ? runLOSTestWithMovement : runLOSTest;
  for ( const algorithm of Object.values(Settings.KEYS.LOS.TARGET.TYPES) ) {
    opts.algorithm = algorithm;
    await fn(n, viewers, targets, opts);
  }
  console.log("\n")

  await revertDebugStatus();
}

export async function benchTokenLOSAlgorithm(n = 100, { movement = false, ...opts }= {}) {
  const { viewers, targets } = getTokens();

  await storeDebugStatus();
  const fn = movement ? runLOSTestWithMovement : runLOSTest;
  await fn(n, viewers, targets, opts);
  await revertDebugStatus();
}

async function runLOSTest(n, viewers, targets, { algorithm, sleep = false, useAsync = false } = {}) {
  algorithm ??= Settings.KEYS.LOS.TARGET.TYPES.POINTS;

  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[algorithm];
  const calcClass = CONFIG[MODULE_ID].calculatorClasses[calcName];
  const calc = buildCustomLOSCalculator(calcClass);
  const losViewers = viewers.map(viewer => buildCustomLOSViewer(viewer, calc));

  let label = (`LOS: ${algorithm}`);
  const fn = sleep ? QBenchmarkLoopFnWithSleep : QBenchmarkLoopFn;
  const benchFn = useAsync ? benchLOSAsync : benchLOS;
  await fn(n, benchFn, label, losViewers, targets);
}

function benchLOS(calcs, targets) {
  const out = [];
  for ( const calc of calcs ) {
    for ( const target of targets ) {
      if ( calc.viewer === target ) continue;
      calc.target = target;
      calc.calculate();
      out.push(calc.hasLOS);
    }
  }
  return out;
}

async function benchLOSAsync(calcs, targets) {
  const out = [];
  for ( const calc of calcs ) {
    for ( const target of targets ) {
      if ( calc.viewer === target ) continue;
      calc.target = target;
      out.push(await calc.hasLOSAsync());
    }
  }
  return out;
}


async function runLOSTestWithMovement(n, viewers, targets, { algorithm, sleep = false, useAsync = false } = {}) {
  algorithm ??= Settings.KEYS.LOS.TARGET.TYPES.POINTS;

  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[algorithm];
  const calcClass = CONFIG[MODULE_ID].calculatorClasses[calcName];
  const calc = buildCustomLOSCalculator(calcClass);
  const losViewers = viewers.map(viewer => buildCustomLOSViewer(viewer, calc));

  let label = (`LOS: ${algorithm}`);
  const tokens = new Set([...viewers, ...targets]);
  const locMap = new Map();
  for ( const token of tokens ) locMap.set(token, { x: token.document.x, y: token.document.y });

  const benchFn = useAsync ? benchLOSAsync : benchLOS;
  const timings = [];
  for ( let i = 0; i < n; i += 1 ) {
    const promises = [];
    for ( const token of tokens ) {
      const xDiff = Math.round((Math.random() - 0.5) * 100); // Move up to 50.
      const yDiff = Math.round((Math.random() - 0.5) * 100);

      // Keep within scene bounds to avoid polygon errors.
      const x = token.document.x + xDiff;
      const y = token.document.y + yDiff;
      if ( !canvas.dimensions.sceneRect.contains(x, y) ) continue;
      promises.push(token.document.update({ x, y }));
    }
    await Promise.allSettled(promises);
    const t0 = performance.now();
    await benchFn(losViewers, targets);
    const t1 = performance.now();
    timings.push(t1 - t0);
    if ( sleep ) await sleepFn(0);
  }
  const sum = timings.reduce((prev, curr) => prev + curr);
  const q = quantile(timings, [.1, .5, .9]);

  const promises2 = [];
  for ( const token of tokens ) {
    const loc = locMap.get(token);
    promises2.push(token.document.update({ x: loc.x, y: loc.y }));
  }

  console.log(`${label} | ${n} iterations | ${precision(sum, 4)}ms | ${precision(sum / n, 4)}ms per | 10/50/90: ${precision(q[.1], 6)} / ${precision(q[.5], 6)} / ${precision(q[.9], 6)}`);
  await Promise.allSettled(promises2);
}

/**
 * Round a decimal number to a specified number of digits.
 * @param {Number}  n       Number to round.
 * @param {Number}  digits  Digits to round to.
 */
function precision(n, digits = 2) {
  return Math.round(n * Math.pow(10, digits)) / Math.pow(10, digits);
}

export async function sleepFn(ms) { return new Promise(r => setTimeout(r, ms)); }


