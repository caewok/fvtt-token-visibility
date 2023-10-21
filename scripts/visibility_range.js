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
 * Construct points within the token shape to test for visible range.
 * @param {Token} token
 * @returns {Point3d[]}
 */
export function rangeTestPointsForToken(token) {
  const { topZ, bottomZ, center, w, h } = token;
  const t = Math.min(w, h) / 4;
  const offsets = [[0, 0]];
  const rangeAlg = getSetting(SETTINGS.RANGE.ALGORITHM);
  if ( rangeAlg === SETTINGS.RANGE.TYPES.FIVE || rangeAlg === SETTINGS.RANGE.TYPES.NINE ) {
    offsets.push(
      [-t, -t],
      [-t, t],
      [t, t],
      [t, -t]
    )

    if ( rangeAlg === SETTINGS.RANGE.TYPES.NINE ) {
      offsets.push(
        [-t, 0],
        [t, 0],
        [0, -t],
        [0, t]
      )
    }
  }

  const tokenHeight = topZ - bottomZ;
  const avgElevation = bottomZ + (tokenHeight * 0.5);
  const tests = offsets.forEach(o => new Point3d(center.x + o[0], center.y + o[1], avgElevation));
  return this.elevatePoints(tests, token);
}


/**
 * @param {object[]} tests                    Test object, containing point and los Map
 * @param {PlaceableObject} object            The target placeable
 * @returns {object[]} tests, with elevation and possibly other tests added.
 */
function elevatePoints(tests, token) {
  const { topZ, bottomZ } = token;
  const tokenHeight =  topZ - bottomZ;

  // If top/bottom equal or not doing 3d points, no need for extra test points
  if ( !tokenHeight || !getSetting(SETTINGS.RANGE.POINTS3D) ) return tests;

  // Add points to the tests array representing top and bottom.
  // Don't keep the middle points, except for dead center.
  const ln = tests.length;
  const tests3d = [tests[0]]; // Dead center test point. Useful to keep as first test.
  const top = topZ;
  const bottom = bottomZ + (tokenHeight * 0.1);
  for ( let i = 1; i < ln; i += 1 ) {
    const test = tests[i];
    tests3d.push(
      new Point3d(test.x, test.y, top);
      new Point3d(test.x, test.y, bottom);
    );
  }
  return tests3d;
}
