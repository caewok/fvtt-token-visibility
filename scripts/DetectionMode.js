/* globals
CONFIG,
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { rangeTestPointsForToken } from "./visibility_range.js";
import { Draw } from "./geometry/Draw.js";
import { SETTINGS, Settings } from "./settings.js";
import { targetWithinLimitedAngleVision } from "./LOS/util.js";
// import { WebGPUViewpointAsync } from "./LOS/WebGPU/WebGPUViewpoint.js";

// Patches for the DetectionMode class
export const PATCHES = {};
PATCHES.BASIC = {};
// PATCHES.LEVELS = {};
// PATCHES.NO_LEVELS = {};

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

PATCHES.BASIC.WRAPS = { testVisibility };

// ----- NOTE: Mixes ----- //

/**
 * Mixed wrap DetectionMode.prototype._testLOS
 * Handle different types of LOS visibility tests.
 */
function _testLOS(wrapped, visionSource, mode, target, test, { testLighting = false } = {}) {
  // Only apply this test to tokens
  if ( !(target instanceof Token) ) return wrapped(visionSource, mode, target, test);

  // Only apply this test to token viewers.
  const viewer = visionSource.object;
  if ( !viewer || !(viewer instanceof Token) ) return wrapped(visionSource, mode, target, test);

  // Check the cached value; return if there.
  let hasLOS = test.los.get(visionSource);
  if ( hasLOS === true || hasLOS === false ) return hasLOS;


//   const viewer = visionSource.object;
//   console.debug(`${this.constructor.name}|_testLOS|Testing ${viewer.name},${viewer.id} looking at ${target.name},${target.id}`,
//      { testLighting, x: viewer.document.x, y: viewer.document.y, isPreview: viewer.isPreview });
//   console.debug(`\tVision source type ${visionSource.constructor.sourceType} with mode ${mode.id}`);

  // Configure the line-of-sight calculator.
  const losCalc = viewer[MODULE_ID]?.losCalc;
  if ( !losCalc ) return wrapped(visionSource, mode, target, test);
  losCalc.setConfigForDetectionMode(this);

  // Test whether this vision source has line-of-sight to the target, cache, and return.
  losCalc.target = target;
  losCalc.testLighting = true;
  losCalc.calculate(); // TODO: Can remove if caching.
  hasLOS = testLighting ? losCalc.hasLOSDim : losCalc.hasLOSUnobscured;
  test.los.set(visionSource, hasLOS);
  // losCalc.setConfigForDetectionMode(); // Reset to basic DM?
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

  // Empty; not in range
  // See https://github.com/foundryvtt/foundryvtt/issues/8505
  if ( mode.range <= 0 ) return false;

  const Point3d = CONFIG.GeometryLib.threeD.Point3d;
  const testPoints = rangeTestPointsForToken(target);
  const visionOrigin = Point3d.fromPointSource(visionSource);
  const radius = visionSource.object.getLightRadius(mode.range);
  const radius2 = radius * radius;

  // Duplicate below so that the if test does not need to be inside the loop.
  if ( Settings.get(SETTINGS.DEBUG.RANGE) ) {
    const draw = new Draw(Settings.DEBUG_RANGE);

    // Sort the unique elevations and draw largest radius for bottom.
    const elevationSet = new Set(testPoints.map(pt => pt.z));
    const elevationArr = [...elevationSet];
    elevationArr.sort((a, b) => a - b);

    // Color all the points red or green.
    // Need to draw test points from lowest to highest elevation.
    testPoints.sort((a, b) => a.z - b.z);
    testPoints.forEach(pt => {
      const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
      const inRange = dist2 <= radius2;
      const radius = elevationArr.length < 2 ? 3
        : [7, 5, 3][elevationArr.findIndex(elem => elem === pt.z)] ?? 3;
      draw.point(pt, { alpha: 1, radius, color: inRange ? Draw.COLORS.green : Draw.COLORS.red });
    })
  }

  return testPoints.some(pt => {
    const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
    return dist2 <= radius2;
  });
}

/**
 * Mixed wrap DetectionMode.prototype._testAngle
 * Test whether the target is within the vision angle.
 * @param {VisionSource} visionSource       The vision source being tested
 * @param {TokenDetectionMode} mode         The detection mode configuration
 * @param {PlaceableObject} target          The target object being tested
 * @param {CanvasVisibilityTest} test       The test case being evaluated
 * @returns {boolean}                       Is the target within the vision angle?
 */
function _testAngle(wrapped, visionSource, mode, target, test) {
  // Only apply this test to tokens
  if ( !(target instanceof Token) ) return wrapped(visionSource, mode, target, test);

  // If completely outside the angle, we can return false.
  // Otherwise, handled in visible Token
  return targetWithinLimitedAngleVision(visionSource, target);
}

PATCHES.BASIC.MIXES = { _testLOS, _testRange, _testAngle };
