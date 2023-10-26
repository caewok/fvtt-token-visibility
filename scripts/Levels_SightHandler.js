/* globals
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings, SETTINGS } from "./settings.js";

// Patches for the CONFIG.Levels.handlers.SightHandler class
export const PATCHES = {};
PATCHES.LEVELS = {};


// ----- NOTE: Overrides ----- //

/**
 * Override Level's SightHandler.getTestPoints
 * Levels:
 * - not precise: returns center point only
 * - precise, not exact: center + 4 corners at target LOS height
 * - precise and exact: 5 precise points plus center + 4 corners at target ~ elevation
 * (targetElevation = token.document.elevation + (targetLOSH - token.document.elevation) * 0.1)
 */
function getTestPoints(token, tol = 4) {
  const rangeAlg = Settings.get(SETTINGS.RANGE.ALGORITHM);

  // Convert back to elevation units b/c that is what Levels expects.
  const { topZ, bottomZ, center, w, h } = token;
  const { x, y } = center;
  const topE = CONFIG.GeometryLib.utils.pixelsToGridUnits(topZ);
  const bottomE = CONFIG.GeometryLib.utils.pixelsToGridUnits(bottomZ);

  const height = topE - bottomE;
  const avgE = bottomE + (height * 0.5);
  const bottom = bottomE + (height * 0.1);
  const top = topE;

  // Construct center point
  const tests = [{ x, y, z: avgE }];

  if ( rangeAlg === SETTINGS.RANGE.TYPES.FIVE || rangeAlg === SETTINGS.RANGE.TYPES.NINE ) {
    // Construct corners, using tolerance to inset.
    const { x: lx, y: ly } = token;
    tests.push(
      { x: lx + tol, y: ly + tol, z: avgE },
      { x: lx + tol, y: ly + h - tol, z: avgE },
      { x: lx + w - tol, y: ly + h - tol, z: avgE },
      { x: lx + w - tol, y: ly + tol, z: avgE }
    );
  }

  if ( rangeAlg === SETTINGS.RANGE.TYPES.NINE ) {
    // Construct the side points, using tolerance to inset
    const w2 = w * 0.5;
    const h2 = h * 0.5;
    tests.push(
      { x: x - w2 + tol, y, z: avgE },
      { x, y: y - h2 + tol, z: avgE },
      { x: x + w2 - tol, y, z: avgE },
      { x, y: y + h2 - tol, z: avgE }
    );
  }

  if ( !(height && Settings.get(SETTINGS.RANGE.POINTS3D)) ) return tests;

  // Add an additional center point for testing center top/bottom
  tests.push({ x, y, z: avgE });

  // Convert the remaining tests from the middle to the top/bottom
  // (Skip middle as mostly redundant.)
  const ln = tests.length - 1;
  for ( let i = 1; i < ln; i += 1 ) {
    const test = tests[i];
    test.z = top;
    tests.push({ x: test.x, y: test.y, z: bottom });
  }

  return tests;
}

PATCHES.LEVELS.STATIC_OVERRIDES = { getTestPoints };
