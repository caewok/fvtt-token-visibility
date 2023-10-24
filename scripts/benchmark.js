/* globals
canvas,
game,
_token
*/

"use strict";

import { randomUniform } from "./random.js";
import { QBenchmarkLoopFn } from "./benchmark_functions.js";
import { SETTINGS, getSetting, setSetting } from "./settings.js";

/*
Rectangle intersection vs just testing all four edges
api = game.modules.get('tokenvisibility').api;
randomRectangle = api.random.randomRectangle;
randomSegment = api.random.randomSegment;
QBenchmarkLoopWithSetupFn = api.bench.QBenchmarkLoopWithSetupFn;

function setupFn() {
  rect = randomRectangle({minWidth: 1000});
  segment = randomSegment();
  return [rect, segment];
}

edges = ["leftEdge",  "topEdge", "rightEdge", "bottomEdge"];
function intersectSides(rect, segment) {
  for (let i = 0; i < 4; i += 1 ) {
    const edge = rect[edges[i]];
    if ( foundry.utils.lineSegmentIntersects(edge.A, edge.B, segment.A, segment.B) ) { return true; }
  }
  return false;
}

intersectRectangle = function(rect, segment) {
  return rect.lineSegmentIntersects(segment.A, segment.B);
}

function testFn() {
  args = setupFn();
  return [...args, intersectSides(...args), intersectRectangle(...args)]
//   return intersectSides(...args) === intersectRectangle(...args)
}
res = Array.fromRange(1000).map(elem => testFn())
res.every(elem => elem)


iterations = 10000
await QBenchmarkLoopWithSetupFn(iterations, setupFn, intersectSides, "intersectSides")
await QBenchmarkLoopWithSetupFn(iterations, setupFn, intersectRectangle, "intersectRectangle")

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
  console.log(`Range: ${getSetting(SETTINGS.RANGE.ALGORITHM)}
LOS: ${getSetting(SETTINGS.LOS.ALGORITHM)} | Percent: ${getSetting(SETTINGS.LOS.PERCENT_AREA)*100}%`);

  await QBenchmarkLoopFn(n, visibilityTestFn, "Visibility", tokens);
}


export async function benchTokenRange(n = 100) {
  game.modules.get("tokenvisibility").api.debug = false;

  const default_settings = {
    range_algorithm: getSetting(SETTINGS.RANGE.ALGORITHM),
    los_algorithm: getSetting(SETTINGS.LOS.ALGORITHM),
    range_3d: getSetting(SETTINGS.RANGE.DISTANCE3D),
    points_3d: getSetting(SETTINGS.RANGE.POINTS3D)
  };

  const controlled = _token;
  if ( !controlled ) {
    console.error("Must select a single token to benchmark range.");
    return;
  }

  const tokens = canvas.tokens.placeables.filter(t => !t.controlled);
  console.log(`\nBenching token visibility range for ${tokens.length} tokens.`);

  // Set to default LOS for test
  await setSetting(SETTINGS.LOS.ALGORITHM, SETTINGS.LOS.TYPES.POINTS);

  console.log("\n2D range measurements");
  await setSetting(SETTINGS.RANGE.DISTANCE3D, false);
  await setSetting(SETTINGS.RANGE.POINTS3D, false);

  // Foundry
  await setSetting(SETTINGS.RANGE.ALGORITHM, SETTINGS.RANGE.TYPES.NINE);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Range 9-point (Foundry)", tokens);

  // Center only
  await setSetting(SETTINGS.RANGE.ALGORITHM, SETTINGS.RANGE.TYPES.CENTER);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Range Center Only", tokens);

  // Foundry 3d
  await setSetting(SETTINGS.RANGE.ALGORITHM, SETTINGS.RANGE.TYPES.FIVE);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Range 5-point", tokens);

  console.log("\n3D range measurements");
  await setSetting(SETTINGS.RANGE.DISTANCE3D, true);
  await setSetting(SETTINGS.RANGE.POINTS3D, true);

  // Foundry
  await setSetting(SETTINGS.RANGE.ALGORITHM, SETTINGS.RANGE.TYPES.NINE);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Range 9-point (Foundry)", tokens);

  // Center only
  await setSetting(SETTINGS.RANGE.ALGORITHM, SETTINGS.RANGE.TYPES.CENTER);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Range Center Only", tokens);

  // Foundry 3d
  await setSetting(SETTINGS.RANGE.ALGORITHM, SETTINGS.RANGE.TYPES.FIVE);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Range 5-point", tokens);

  // Reset
  await setSetting(SETTINGS.RANGE.ALGORITHM, default_settings.range_algorithm);
  await setSetting(SETTINGS.LOS.ALGORITHM, default_settings.los_algorithm);
  await setSetting(SETTINGS.RANGE.DISTANCE3D, default_settings.range_3d);
  await setSetting(SETTINGS.RANGE.POINTS3D, default_settings.points_3d);
}

export async function benchTokenLOS(n = 100) {
  game.modules.get("tokenvisibility").api.debug = false;

  const default_settings = {
    range_algorithm: getSetting(SETTINGS.RANGE.ALGORITHM),
    los_algorithm: getSetting(SETTINGS.LOS.ALGORITHM),
    los_percent_area: getSetting(SETTINGS.LOS.PERCENT_AREA)
  };

  const controlled = _token;
  if ( !controlled ) {
    console.error("Must select a single token to benchmark LOS.");
    return;
  }

  const tokens = canvas.tokens.placeables.filter(t => !t.controlled);
  console.log(`\nBenching token visibility LOS for ${tokens.length} tokens.`);

  // Set to default Range for test
  await setSetting(SETTINGS.RANGE.ALGORITHM, SETTINGS.RANGE.TYPES.NINE);

  // Foundry (Points)
  await setSetting(SETTINGS.LOS.ALGORITHM, SETTINGS.LOS.TYPES.POINTS);
  await QBenchmarkLoopFn(n, visibilityTestFn, "LOS Points", tokens);

  // Area 3d (Does not vary based on area percentage.)
  await setSetting(SETTINGS.LOS.ALGORITHM, SETTINGS.LOS.TYPES.AREA3D);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Area3d", tokens);

  // ***** Area Percentage = 0 ***********
  console.log("\nArea percentage 0");
  await setSetting(SETTINGS.LOS.PERCENT_AREA, 0);

  await setSetting(SETTINGS.LOS.ALGORITHM, SETTINGS.LOS.TYPES.AREA);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Area", tokens);

  // ***** Area Percentage = .25 ***********
  console.log("\nArea percentage .25");
  await setSetting(SETTINGS.LOS.PERCENT_AREA, .25);

  await setSetting(SETTINGS.LOS.ALGORITHM, SETTINGS.LOS.TYPES.AREA);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Area", tokens);

  // ***** Area Percentage = .5 ***********
  console.log("\nArea percentage .5");
  await setSetting(SETTINGS.LOS.PERCENT_AREA, .5);

  await setSetting(SETTINGS.LOS.ALGORITHM, SETTINGS.LOS.TYPES.AREA);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Area", tokens);

  // ***** Area Percentage = .75 ***********
  console.log("\nArea percentage .75");
  await setSetting(SETTINGS.LOS.PERCENT_AREA, 0.75);

  await setSetting(SETTINGS.LOS.ALGORITHM, SETTINGS.LOS.TYPES.AREA);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Area", tokens);

  // ***** Area Percentage = 1 ***********
  console.log("\nArea percentage 1");
  await setSetting(SETTINGS.LOS.PERCENT_AREA, 1);

  await setSetting(SETTINGS.LOS.ALGORITHM, SETTINGS.LOS.TYPES.AREA);
  await QBenchmarkLoopFn(n, visibilityTestFn, "Area", tokens);

  // Reset
  await setSetting(SETTINGS.RANGE.ALGORITHM, default_settings.range_algorithm);
  await setSetting(SETTINGS.LOS.ALGORITHM, default_settings.los_algorithm);
  await setSetting(SETTINGS.LOS.PERCENT_AREA, default_settings.los_percent_area);
}

function visibilityTestFn(tokens) {
  const out = [];

  // Avoid caching the constrained token shape
  for ( const token of tokens ) token._constrainedTokenBorder = undefined;

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
