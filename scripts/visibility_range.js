/* globals
Token
*/
"use strict";

import { SETTINGS, getSetting } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";

/* Range Options

3d: Measure distance in 3d.

Algorithms (points):
- Center point
- 9-point (Foundry default)
- 17-point (Token top and bottom)
*/

/**
 * @param {object[]} tests                    Test object, containing point and los Map
 * @param {PlaceableObject} object            The target placeable
 * @returns {object[]} tests, with elevation and possibly other tests added.
 */
export function elevatePoints(tests, object) {
  if ( !(object instanceof Token) || !tests.length ) return tests;

  // We assume for the moment that test points are arranged as in default Foundry:
  // center, 4 corners, 4 midpoints
  // We deal with the center test in testVisibilityCanvasVisibility
  const rangeAlg = getSetting(SETTINGS.RANGE.ALGORITHM);
  if ( rangeAlg === SETTINGS.RANGE.TYPES.FIVE ) tests = tests.splice(0, 5);

  // Create default elevations
  const { topZ, bottomZ } = object;
  const objectHeight = topZ - bottomZ;
  const avgElevation = bottomZ + (objectHeight * 0.5);
  for ( const test of tests ) {
    test.point.z ??= avgElevation;
    test.centerPoint = false;
  }

  // Identify the center point
  tests[0].centerPoint = true;

  // If top/bottom equal or not doing 3d points, no need for extra test points
  if ( !objectHeight || !getSetting(SETTINGS.RANGE.POINTS3D) ) return tests;

  // Add points to the tests array representing top and bottom
  const tests3d = [tests[0]];
  const ln = tests.length;
  const top = topZ;
  const bottom = bottomZ + (objectHeight * 0.1);
  for ( let i = 1; i < ln; i += 1 ) {
    const test = tests[i];
    const { x, y } = test.point;
    tests3d.push(
      // Use the same map so that x,y contains tests are cached and not repeated.
      buildTestObject(x, y, top, test.los),
      buildTestObject(x, y, bottom, test.los)
    );
  }

  return tests3d;
}

/**
 * Helper function to construct a test object for testVisiblity
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {object}  Object with { point, los }
 *  See CanvasVisibility.prototype.testVisibility
 */
function buildTestObject(x, y, z = 0, los = new Map()) {
  return { point: new Point3d(x, y, z), los, centerPoint: false };
}


