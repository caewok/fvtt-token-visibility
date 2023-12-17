/* globals
canvas,
CONFIG,
DetectionModeBasicSight,
game,
PIXI
*/

"use strict";

import { QBenchmarkLoopFn } from "./benchmark_functions.js";
import { Settings, SETTINGS } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { randomUniform } from "./random.js";

import { PointsLOS } from "./LOS/PointsLOS.js";
import { Area2dLOS } from "./LOS/Area2dLOS.js";
import { Area3dLOSGeometric } from "./LOS/Area3dLOSGeometric.js";
import { Area3dLOSWebGL } from "./LOS/Area3dLOSWebGL1.js";
import { Area3dLOSWebGL2 } from "./LOS/Area3dLOSWebGL2.js";
import { Area3dLOSHybrid } from "./LOS/Area3dLOSHybrid.js";
import { LOSCalculator } from "./LOSCalculator.js";

/* Use
api = game.modules.get("tokenvisibility").api
await api.bench.benchAll();

await api.benchTokenRange(1000)
await api.benchTokenLOS(100)
await api.benchTokenVisibility(1000)
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
  await benchTokenVisibility(n);
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
  const calcs = {
    calcPoints: new PointsLOS(),
    calcArea2d: new Area2dLOS(),
    calcArea3dGeometric: new Area3dLOSGeometric(),
    calcArea3dWebGL1: new Area3dLOSWebGL(),
    calcArea3dWebGL2: new Area3dLOSWebGL2(),
    calcArea3dLOSHybrid: new Area3dLOSHybrid()
  };

  const summary = {};
  for ( const viewer of viewers ) {
    Object.values(calcs).forEach(calc => calc.viewer = viewer);
    for ( const target of targets ) {
      if ( viewer === target ) continue;
      const label = `${viewer.name} --> ${target.name}`;
      summary[label] = {};
      Object.entries(calcs).forEach(([name, calc]) => {
        calc.target = target;
        summary[label][name] = Math.round(calc.percentVisible() * 100 * 10) / 10;
      });
    }
  }

  console.table(summary);
  Object.values(calcs).forEach(calc => calc.destroy());
}

/**
 * Construct a table of token elevations and distances
 */
function summarizeTokenRange(viewers, targets) {
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

export async function benchTokenVisibility(n = 100) {
  const { targets } = getTokens();
  console.log(`\nBenchmarking visibility of ${targets.length} targets from user's current perspective and settings.`);

  await storeDebugStatus();
  await QBenchmarkLoopFn(n, benchVisibility, "Visibility", targets);
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

  return canvas.effects.visibility.testVisibility(center, { tolerance, object: target });
}

// ----- NOTE: Range testing -----

export async function benchTokenRange(n = 100) {
  console.log("\n");
  const { viewers, targets } = getTokens();
  console.log("Elevation and distance summary.");
  summarizeTokenRange(viewers, targets);

  console.log("\nBenchmarking token range");
  await storeDebugStatus();
  storeRangeSettings();

  console.log("\n");
  await runRangeTest(n, viewers, targets, SETTINGS.POINT_TYPES.CENTER, false);
  await runRangeTest(n, viewers, targets, SETTINGS.POINT_TYPES.NINE, false);

  console.log("\n");
  await runRangeTest(n, viewers, targets, SETTINGS.POINT_TYPES.CENTER, true);
  await runRangeTest(n, viewers, targets, SETTINGS.POINT_TYPES.NINE, true);

  await revertDebugStatus();
  await revertRangeSettings();
}

async function runRangeTest(n, viewers, targets, algorithm, d3 = false) {
  const label = (`Range: ${algorithm}, 3d: ${d3}`);
  await Settings.set(SETTINGS.RANGE.ALGORITHM, algorithm);
  await Settings.set(SETTINGS.RANGE.POINTS3D, d3);
  await Settings.set(SETTINGS.RANGE.DISTANCE3D, d3);
  await QBenchmarkLoopFn(n, benchRange, label, viewers, targets);
}

const userSettings = { debug: {}, range: {}, los: {}};
async function storeDebugStatus() {
  userSettings.debug.range = Settings.get(SETTINGS.DEBUG.RANGE);
  userSettings.debug.los = Settings.get(SETTINGS.DEBUG.LOS);
  await Settings.set(SETTINGS.DEBUG.RANGE, false);
  await Settings.set(SETTINGS.DEBUG.LOS, false);
}

async function revertDebugStatus() {
  await Settings.set(SETTINGS.DEBUG.RANGE, userSettings.debug.range);
  await Settings.set(SETTINGS.DEBUG.LOS, userSettings.debug.los);
}

function storeRangeSettings() {
  userSettings.range.algorithm = Settings.get(SETTINGS.RANGE.ALGORITHM);
  userSettings.range.points3d = Settings.get(SETTINGS.RANGE.POINTS3D);
  userSettings.range.distance3d = Settings.get(SETTINGS.RANGE.DISTANCE3D);
}

async function revertRangeSettings() {
  const { algorithm, points3d, distance3d } = userSettings.range;
  await Settings.set(SETTINGS.RANGE.ALGORITHM, algorithm);
  await Settings.set(SETTINGS.RANGE.POINTS3D, points3d);
  await Settings.set(SETTINGS.RANGE.DISTANCE3D, distance3d);
}

function benchRange(viewers, targets) {
  const out = [];
  const testFn = DetectionModeBasicSight.prototype._testRange;
  for ( const viewer of viewers ) {
    for ( const target of targets ) {
      if ( viewer === target ) continue;
      out.push(testFn(viewer.vision, "sight", target));
    }
  }
  return out;
}

// ----- NOTE: LOS testing -----

export async function benchTokenLOS(n = 100) {
  console.log("\n");
  const { viewers, targets } = getTokens();
  console.log("Percent visible using different LOS algorithms.");
  summarizeTokenVisibility(viewers, targets);

  console.log("\nBenchmarking token los");
  await storeDebugStatus();
  storeLOSSettings();

  const algs = SETTINGS.LOS.TARGET.TYPES;
  const nPts = SETTINGS.POINT_TYPES;

  await runLOSTest(n, viewers, targets, algs.POINTS, false, nPts.CENTER);
  await runLOSTest(n, viewers, targets, algs.POINTS, false, nPts.NINE);
  await runLOSTest(n, viewers, targets, algs.AREA2D, false);
  await runLOSTest(n, viewers, targets, algs.AREA3D, false);
  await runLOSTest(n, viewers, targets, algs.AREA3D_GEOMETRIC, false);
  await runLOSTest(n, viewers, targets, algs.AREA3D_WEBGL1, false);
  await runLOSTest(n, viewers, targets, algs.AREA3D_WEBGL2, false);
  await runLOSTest(n, viewers, targets, algs.AREA3D_HYBRID, false);

  console.log("\n");
  await runLOSTest(n, viewers, targets, algs.POINTS, true, nPts.CENTER);
  await runLOSTest(n, viewers, targets, algs.POINTS, true, nPts.CENTER);
  await runLOSTest(n, viewers, targets, algs.AREA2D, true);
  await runLOSTest(n, viewers, targets, algs.AREA3D, true);
  await runLOSTest(n, viewers, targets, algs.AREA3D_GEOMETRIC, true);
  await runLOSTest(n, viewers, targets, algs.AREA3D_WEBGL1, true);
  await runLOSTest(n, viewers, targets, algs.AREA3D_WEBGL2, true);
  await runLOSTest(n, viewers, targets, algs.AREA3D_HYBRID, true);

  await revertDebugStatus();
  await revertLOSSettings();
}

function storeLOSSettings() {
  userSettings.los.algorithm = Settings.get(SETTINGS.LOS.TARGET.ALGORITHM);
  userSettings.los.points = Settings.get(SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS);
  userSettings.los.large = Settings.get(SETTINGS.LOS.TARGET.LARGE);
}

async function revertLOSSettings() {
  const { algorithm, points, large } = userSettings.los;
  await Settings.set(SETTINGS.LOS.TARGET.ALGORITHM, algorithm);
  await Settings.set(SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS, points);
  await Settings.set(SETTINGS.LOS.TARGET.LARGE, large);
}

async function runLOSTest(n, viewers, targets, algorithm, large, nPoints) {
  let label = (`LOS: ${algorithm}, largeToken: ${large}`);
  if ( algorithm === SETTINGS.LOS.TARGET.TYPES.POINTS ) {
    await Settings.set(SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS, nPoints);
    label += `, ${nPoints}`;
  }
  await Settings.set(SETTINGS.LOS.TARGET.ALGORITHM, algorithm);
  await Settings.set(SETTINGS.LOS.TARGET.LARGE, large);
  const calc = new LOSCalculator();

  await QBenchmarkLoopFn(n, benchLOS, label, calc, viewers, targets);
  calc.destroy();
}

function benchLOS(calc, viewers, targets) {
  const out = [];
  for ( const viewer of viewers ) {
    for ( const target of targets ) {
      if ( viewer === target ) continue;
      out.push(calc.hasLOS(viewer, target));
    }
  }
  return out;
}

