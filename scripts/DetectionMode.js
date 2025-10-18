/* globals
Token,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { ATVTokenHandlerID } from "./TokenHandler.js";
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
function _testLOS(wrapped, visionSource, mode, target, test) {
  // Only apply this test to tokens
  if ( !(target instanceof Token) ) return wrapped(visionSource, mode, target, test);

  // Check the cached value; return if there.
  let hasLOS = test.los.get(visionSource);
  if ( hasLOS === true || hasLOS === false ) return hasLOS;
  
  // Only apply this test to token viewers.
  const atv = visionSource.object?.[MODULE_ID]?.[ATVTokenHandlerID];
  if ( !atv ) return wrapped(visionSource, mode, target, test);

//   const viewer = visionSource.object;
//   console.debug(`${this.constructor.name}|_testLOS|Testing ${viewer.name},${viewer.id} looking at ${target.name},${target.id}`,
//      { testLighting, x: viewer.document.x, y: viewer.document.y, isPreview: viewer.isPreview });
//   console.debug(`\tVision source type ${visionSource.constructor.sourceType} with mode ${mode.id}`);

  // Configure the line-of-sight calculator.
  atv.setConfigForDetectionMode(this);
  hasLOS = atv.hasLOSToToken(target);
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
  const atv = visionSource.object?.[MODULE_ID]?.[ATVTokenHandlerID];
  if ( !atv ) return wrapped(visionSource, mode, target, test);
  return atv.tokenWithinVisibleRange(target, mode.range);
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

  const atv = visionSource.object?.[MODULE_ID]?.[ATVTokenHandlerID];
  if ( !atv ) return wrapped(visionSource, mode, target, test);
  return atv.tokenWithinLimitedAngleVision(target);
}

PATCHES.BASIC.MIXES = { _testLOS, _testRange, _testAngle };
