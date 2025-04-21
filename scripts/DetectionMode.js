/* globals
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { rangeTestPointsForToken } from "./visibility_range.js";
import { Draw } from "./geometry/Draw.js";
import { SETTINGS, Settings } from "./settings.js";
import { targetWithinLimitedAngleVision } from "./LOS/util.js";

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
function _testLOS(wrapped, visionSource, mode, target, test, { useLitTargetShape = false } = {}) {
  // Only apply this test to tokens
  if ( !(target instanceof Token) ) return wrapped(visionSource, mode, target, test);

  // Check the cached value; return if there.
  let hasLOS = test.los.get(visionSource);
  if ( hasLOS === true || hasLOS === false ) return hasLOS;

  // TODO: Is this addressed by the AltLOS algorithms?
  // Check if limited angle interferes with view of this target.
  //   if ( this.angle && visionSource.data.angle < 360 ) {
  //     if ( !this._testAngle(visionSource, mode, target, test) ) {
  //       test.los.set(visionSource, false);
  //       return false;
  //     }
  //
  //     // Limit the visible shape to vision angle.
  //     visibleTargetShape ??= target.constrainedTokenBorder;
  //     visibleTargetShape = constrainByVisionAngle(visibleTargetShape, visionSource);
  //   }

  // Configure the line-of-sight calculator.
  const losCalc = visionSource[MODULE_ID].losCalc;
  losCalc.config.useLitTargetShape = useLitTargetShape;

  // Test whether this vision source has line-of-sight to the target, cache, and return.
  hasLOS = losCalc.hasLOS(target);

  const vc = losCalc.center;
  const tc = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(losCalc.target);

  /*
  console.debug(`${losCalc.viewer.name} -> ${losCalc.target.name} ${vc.toString()}->${tc.toString()}`);
  for ( const vp of losCalc.viewpoints ) {
    console.debug(`\t${vp.viewpoint.toString()}: ${vp.percentVisible()}%`);
  }
  */


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
    return testPoints.some(pt => {
      const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
      const inRange = dist2 <= radius2;
      draw.point(pt, { alpha: 1, radius: 3, color: inRange ? Draw.COLORS.green : Draw.COLORS.red });
      return inRange;
    });
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


/* Benchmark limited vision testing
api = game.modules.get("tokenvisibility").api
QBenchmarkLoopFn = api.bench.QBenchmarkLoopFn
let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;
visionSource = viewer.vision

function overlapLimitedAngle(target, visionSource) {
  const constrainedTokenBorder = target.constrainedTokenBorder;
  const { angle, rotation, externalRadius } = visionSource.data;
  const radius = canvas.dimensions.maxR;
  const limitedAnglePoly = new LimitedAnglePolygon(visionSource, { radius, angle, rotation, externalRadius });
  return constrainedTokenBorder.overlaps(limitedAnglePoly)
}

function testLimitedAngle(target, visionSource) {
  return targetWithinLimitedAngleVision(visionSource, target)
}

function envelopsLimitedAngle(target, visionSource) {
  const constrainedTokenBorder = target.constrainedTokenBorder;
  const { angle, rotation, externalRadius } = visionSource.data;
  const radius = canvas.dimensions.maxR;
  const limitedAnglePoly = new LimitedAnglePolygon(visionSource, { radius, angle, rotation, externalRadius });
  return limitedAnglePoly.envelops(constrainedTokenBorder);
}

N = 10000
await QBenchmarkLoopFn(N, overlapLimitedAngle, "Overlaps limited angle", target, visionSource);
await QBenchmarkLoopFn(N, testLimitedAngle, "Test limited angle", target, visionSource);
await QBenchmarkLoopFn(N, envelopsLimitedAngle, "Envelops limited angle", target, visionSource);

Overlaps limited angle | 10000 iterations | 223.5ms | 0.0223ms per | 10/50/90: 0 / 0 / 0.1
Test limited angle | 10000 iterations | 30.2ms | 0.003ms per | 10/50/90: 0 / 0 / 0
Envelops limited angle | 10000 iterations | 190ms | 0.019ms per | 10/50/90: 0 / 0 / 0.1

*/

/**
 * Take a token and intersects it with the vision angle.
 * @param {PIXI.Rectangle|PIXI.Polygon|ClipperPaths} visibleShape
 * @param {VisionSource} visionSource
 * @param {number} detectionAngle       Angle
 * @returns {PIXI.Polygon[]|PIXI.Rectangle[]|PIXI.Polygon}
 */
// function constrainByVisionAngle(visibleShape, visionSource) {
//   const { angle, rotation, externalRadius } = visionSource.data;
//   if ( angle >= 360 ) return visibleShape;
//
//   // Build a limited angle for the vision source.
//   const radius = canvas.dimensions.maxR;
//   const limitedAnglePoly = new LimitedAnglePolygon(visionSource, { radius, angle, rotation, externalRadius });
//
//   // If the limited angle envelops the token shape, then we are done.
//   if ( limitedAnglePoly.envelops(visibleShape) ) return visibleShape;
//
//   // If the visible shape does not overlap, we are done.
//   // if ( !visibleShape.overlaps(limitedAnglePoly) ) return null;
//
//   // Intersect the vision polygon with the visible token shape.
//   return visibleShape.intersectPolygon(limitedAnglePoly);
// }
