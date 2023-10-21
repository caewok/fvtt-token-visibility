/* globals
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DEBUG } from "./const.js";
import { testLOS } from "./visibility_los.js";
import { rangeTestPointsForToken } from "./visibility_range.js";
import { Draw } from "./geometry/Draw.js";
import { Point3d } from "./geometry/3d/Point3d.js";

// Patches for the DetectionMode class
export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.LEVELS = {};
PATCHES.NO_LEVELS = {};

// ----- NOTE: Wraps ----- //

/**
 * Wrap DetectionMode.prototype.testVisibility
 * Create extra points if necessary.
 * Modify tests so LOS area algorithms can use only the center point
 * @param {VisionSource} visionSource           The vision source being tested
 * @param {TokenDetectionMode} mode             The detection mode configuration
 * @param {CanvasVisibilityTestConfig} config   The visibility test configuration
 * @returns {boolean}                           Is the test target visible?
 */
function testVisibility(wrapped, visionSource, mode, {object, tests}={}) {
  if ( !(object instanceof Token) ) return wrapped(visionSource, mode, { object, tests });

  // Use only a single test. This typically should already occur, if called from
  // CanvasVisibility.prototype.testVisibility.
  tests = [tests[0]];
  return wrapped(visionSource, mode, { object, tests });
}

PATCHES.NO_LEVELS.WRAPS = { testVisibility };

// ----- NOTE: Mixes ----- //

/**
 * Mixed wrap DetectionMode.prototype._testLOS
 * Handle different types of LOS visibility tests.
 */
function _testLOS(wrapped, visionSource, mode, target, test) {
  // Only apply this test to tokens
  if ( !(target instanceof Token) ) return wrapped(visionSource, mode, target, test);

  // Check the cached value; return if there.
  let hasLOS = test.los.get(visionSource);
  if ( hasLOS === true || hasLOS === false ) return hasLOS;

  // Test whether this vision source has line-of-sight to the target, cache, and return.
  hasLOS = testLOS(visionSource, target);
  test.los.set(visionSource, hasLOS);
  return hasLOS;
}

/**
 * Mixed wrap DetectionMode.prototype._testRange
 * Test in 3d if setting is enabled.
 * @param {VisionSource} visionSource           The vision source being tested
 * @param {TokenDetectionMode} mode             The detection mode configuration
 * @param {PlaceableObject} target              The target object being tested
 * @param {CanvasVisibilityTest} test           The test case being evaluated
 * @returns {boolean}                           Is the target within range?
 */
function _testRange(wrapped, visionSource, mode, target, test) {
  // Only apply this test to tokens
  if ( !(target instanceof Token) ) return wrapped(visionSource, mode, target, test);

  const debug = DEBUG.range;

  // Empty; not in range
  // See https://github.com/foundryvtt/foundryvtt/issues/8505
  if ( mode.range <= 0 ) return false;

  const testPoints = rangeTestPointsForToken(target);
  const visionOrigin = Point3d.fromPointSource(visionSource);
  const radius = visionSource.object.getLightRadius(mode.range);
  const radius2 = radius * radius;

  if ( debug ) {
    testPoints.forEach(pt => {
      const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
      const inRange = dist2 <= radius2;
      Draw.point(pt, { alpha: 1, radius: 3, color: inRange ? Draw.COLORS.green : Draw.COLORS.red });
    });
  }

  return testPoints.some(pt => {
    const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
    return dist2 <= radius2;
  });
}

PATCHES.BASIC.MIXES = { _testLOS };
PATCHES.NO_LEVELS.MIXES = { _testRange };
