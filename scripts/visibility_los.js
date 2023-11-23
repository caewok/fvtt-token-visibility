/* globals
canvas,
CONFIG,
LimitedAnglePolygon,
PointSourcePolygon
*/
"use strict";

import { MODULES_ACTIVE } from "./const.js";
import { Settings, SETTINGS } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { PointsLOS } from "./LOS/PointsLOS.js";
import { Area2dLOS } from "./LOS/Area2dLOS.js";
import { Area3dLOSGeometric } from "./LOS/Area3dLOSGeometric.js";
import { Area3dLOSWebGL } from "./LOS/Area3dLOSWebGL1.js";
import { Area3dLOSWebGL2 } from "./LOS/Area3dLOSWebGL2.js";
import { Area3dLOSHybrid } from "./LOS/Area3dLOSHybrid.js";
import { ConstrainedTokenBorder } from "./LOS/ConstrainedTokenBorder.js";
import { Draw } from "./geometry/Draw.js";


/* Visibility algorithm
Three tests, increasing in difficulty and stringency. User can select between 0% and 100%
of token area that must be seen to be visible. 0% means any tiny portion counts. User can
also adjust the token size up or down. For example, you might want only the inner 80% of
the token to count. Or for a particularly large creature that expands beyond its token
(dragon!) you might make it 120% of the token size.

Tests:
1. Center point to test LOS and FOV.
< 50% area: If the center point is within the LOS/FOV , the token is visibile. Return if true.
> 50% area: Center point must be seen, but is not sufficient in itself, to be visible.
            Filter sources that do not meet this criterion.

After this point, constrain the token shape such that if it overlaps a wall, the shape
is trimmed accordingly.

2. Visibility polygon to test LOS.
Draw rays from the vision source origin to the viewable edges of the constrained token shape.
Test if a wall intersects (blocks) both rays.

If no walls present, then we are done; return true.
If not testing area, then if walls only block one side, we are done; return true.
If a wall blocks both rays, then we are done; return false.

3. Intersect test.
Intersect the constrained token shape against the source los or fov. If not testing area,
then it is sufficient to test if the constrained token shape intersects the los/fov.

1 + 3 alone appear to do better than 1 + 2 + 3, so skipping 2 for now.
*/


/* Token visibility testing workflow
Token.prototype.isVisible
- Constructs "tolerance" based on width and height of token
- Calls canvas.effects.visibility.testVisibility(this.center, {tolerance, object: this})

CanvasVisibility.prototype.testVisibility
- Prepares array of points based on tolerance. Default is 2 px. Either [0, 0] or
  set of 9 points: center, 8 points arranged in square, tolerance away from center
- Creates a config = { object, tests: offsets.map(o => point, los)}
- Calls lightSource.testVisibility for each active lightSource
- Calls modes.basicSight.testVisibility for each visionSource. (basic detection test)
- Calls detectionMode.testVisibility on each vision source with special detection modes

DetectionMode.prototype.testVisibility
- Calls DetectionMode.prototype._canDetect for the given visionSource and object
- Calls DetectionMode.prototype._testPoint for each test object (test point) for the given visionSource and object

DetectionMode.prototype._canDetect
- Theoretical detection; should not consider relative positions of objects

DetectionMode.prototype._testPoint
- For given point, call _testLOS
- For given point, call _testRange

DetectionMode.prototype._testLOS
- Tests whether the visionSource.los contains the test point

DetectionMode.prototype._testRange
- Tests whether the test point is within range of a light source visionSource.object.getLightRadius

*/

export const LOS_CALCULATOR = { CALCULATOR: undefined };

/** Testing
api = game.modules.get("tokenvisibility").api
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL2)
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_GEOMETRIC)
*/


/**
 * Class that handles calculating line-of-sight between two tokens based on current settings.
 */
export class LOSCalculator {

  /** @enum {string: AlternativeLOS} */
  static ALGORITHM_CLASS = {
    "los-points": PointsLOS,
    "los-area-2d": Area2dLOS,
    "los-area-3d": Area3dLOSHybrid,
    "los-area-3d-geometric": Area3dLOSGeometric,
    "los-area-3d-webgl1": Area3dLOSWebGL,
    "los-area-3d-webgl2": Area3dLOSWebGL2,
    "los-area-3d-hybrid": Area3dLOSHybrid
  };

  static ALGORITHM_CLASS_NAME = {
    "los-points": "PointsLOS",
    "los-area-2d": "Area2dLOS",
    "los-area-3d": "Area3dLOSHybrid",
    "los-area-3d-geometric": "Area3dLOSGeometric",
    "los-area-3d-webgl1": "Area3dLOSWebGL",
    "los-area-3d-webgl2": "Area3dLOSWebGL2",
    "los-area-3d-hybrid": "Area3dLOSHybrid"
  };

  config = {
    type: "sight",
    wallsBlock: true,
    tilesBlock: true,
    deadTokensBlock: false,
    liveTokensBlock: false,
    proneTokensBlock: false,
    threshold: 0,

  };

  /** @type {AlternativeLOS} */
  calc;

  constructor() {
    const algorithm = Settings.get(SETTINGS.LOS.TARGET.ALGORITHM);
    this.calc = new this.constructor.ALGORITHM_CLASS[algorithm](undefined, undefined, this.config);
  }

  destroy() {
    this.calc.destroy();
  }

  /**
   * @typedef {object}  LOSCalculatorConfiguration
   * Options that affect the one-off calculation.
   */

  /**
   * Test if viewer token has LOS to a target token.
   * Accounts for all viewer points if more than one in settings.
   */
  hasLOS(viewer, target) {
    const calc = this.calc;
    calc.viewer = viewer;
    calc.target = target;
    const center = Point3d.fromTokenCenter(viewer);
    const viewerPoints = calc.constructor.constructViewerPoints(viewer);
    const threshold = Settings.get(SETTINGS.LOS.TARGET.PERCENT);
    const useDebug = Settings.get(SETTINGS.DEBUG.LOS);
    // console.debug(`\n----- Visibility.prototype.hasLOS|${viewer.name}👀 => ${target.name}🎯 -----`);

    for ( const viewerPoint of viewerPoints ) {
      calc.visionOffset = viewerPoint.subtract(center); // TODO: Confirm this is correct.
      if ( calc.hasLOS(threshold, useDebug) ) {
        if ( useDebug ) calc.debug(true);
        return true;
      }
    }
    if ( useDebug ) calc.debug(false);
    return false;
  }


  /**
   * Calculate the percentage visible for a target token from a viewer token.
   * @param {Token} viewer
   * @param {Token} target
   * @returns {number}  Percent between 0 and 1. If the "large token subtargeting" is enabled,
   *   this could be greater than 1.
   */
  percentVisible(viewer, target, { visionOffset } = {}) {
    const calc = this.calc;
    calc.viewer = viewer;
    calc.target = target;
    if ( visionOffset ) {
      const center = Point3d.fromTokenCenter(viewer);
      calc.visionOffset = visionOffset.subtract(center); // TODO: Confirm this is correct.
    }
    if ( Settings.get(SETTINGS.DEBUG.LOS ) ) calc.debug(true);
    return calc.percentVisible();
  }

  /**
   * Update the calculator algorithm.
   */
  _updateAlgorithm(algorithm) {
    algorithm ??= Settings.get(SETTINGS.LOS.TARGET.ALGORITHM);
    const clName = this.calc.constructor.name;
    if ( clName === this.constructor.ALGORITHM_CLASS_NAME[algorithm] ) return;

    const cl = this.constructor.ALGORITHM_CLASS[algorithm];
    this.calc.destroy();
    this.calc = new cl(undefined, undefined, this.config);
  }

  /**
   * Update the calculator settings.
   */
  _updateConfigurationSettings() {
    this.calc._configure(); // At the moment, this really only changes large target.
    this.calc._clearCache();
  }
}

/**
 * Draw red or green test points for debugging.
 * @param {VisionSource} visionSource
 * @param {Point} pt
 * @param {boolean} hasLOS       Is there line-of-sight to the point?
 */
export function drawDebugPoint(visionSource, pt, hasLOS) {
  const origin = new Point3d(visionSource.x, visionSource.y, visionSource.elevationZ);
  Draw.segment({A: origin, B: pt}, {
    color: hasLOS ? Draw.COLORS.green : Draw.COLORS.red,
    alpha: 0.5
  });
}

function isConstrained(los) {
  const boundaryShapes = los.config.boundaryShapes;
  if ( boundaryShapes.length === 0 ) return false;
  if ( boundaryShapes.length >= 2 ) return true;

  const boundaryShape = boundaryShapes[0];
  if ( !(boundaryShape instanceof LimitedAnglePolygon) ) return true;

  return boundaryShape.radius < canvas.dimensions.maxR;
}


/**
 * Test a point for line-of-sight. Confirm:
 * 1. Point is on the same level as the visionSource.
 * 2. Point is in LOS.
 * 3. Point is within the constrained target shape.
 * 4. No collisions with wall height limited walls.
 * @param {VisionSource} visionSource
 * @param {Token} target
 * @param {object} test       Object containing Point to test
 * @returns {boolean} True if source has line-of-sight to point
 */
export function testLOSPoint(visionSource, target, test) {
  // Test for Levels to avoid vision between levels tiles
  const origin = new Point3d(visionSource.x, visionSource.y, visionSource.elevationZ);
  const pt = test.point;
  if ( !hasLOSCeilingFloorLevels(origin, pt) ) return false;

  // If not within LOS, then we are done.
  if ( MODULES_ACTIVE.PERFECT_VISION ) {
    if ( !isConstrained(visionSource.los) ) {
      if ( !visionSource.los.contains(pt.x, pt.y) ) return false;
    } else {
      const { angle, rotation, externalRadius } = visionSource.data;
      if ( angle !== 360 ) {
        const dx = pt.x - visionSource.x;
        const dy = pt.y - visionSource.y;
        if ( (dx * dx) + (dy * dy) > (externalRadius * externalRadius) ) {
          const aMin = rotation + 90 - (angle / 2);
          const a = Math.toDegrees(Math.atan2(dy, dx));
          if ( ((((a - aMin) % 360) + 360) % 360) > angle ) return false;
        }
      }
      const origin = { x: visionSource.x, y: visionSource.y };
      const type = visionSource.los.config.type;
      if ( CONFIG.Canvas.losBackend.testCollision(origin, pt, { source: visionSource, type, mode: "any" }) ) {
        return false;
      }
    }
  } else if ( !visionSource.los.contains(pt.x, pt.y) ) return false;

  // If not within the constrained token shape, then don't test.
  // Assume that unconstrained token shapes contain all test points.
  const cst = ConstrainedTokenBorder.get(target);
  if ( !cst.contains(pt.x, pt.y) ) return false;

  // If wall height is not active, collisions will be equivalent to the contains test
  // because no limited walls to screw this up. (Note that contains is true at this point.)
  if ( !MODULES_ACTIVE.WALL_HEIGHT ) return true;

  // Test all non-infinite walls for collisions
  if ( MODULES_ACTIVE.LEVELS ) return !CONFIG.Levels.API.testCollision(origin, pt);
  else return !PointSourcePolygon.testCollision3d(origin, pt, { type: "sight", mode: "any", wallTypes: "limited" });
}

/**
 * Test a target token for line-of-sight using point(s) of the token and target.
 * Returns true if the desired percentage of points between token and target are unblocked.
 * @param {VisionSource} visionSource
 * @param {Token} target
 * @returns {boolean} True if source has line-of-sight to target.
 */
// const LOS_CLASSES = {
//   "los-points": PointsLOS,
//   "los-area-2d": Area2dLOS,
//   "los-area-3d": Area3dLOS
// };

// export function testLOS(visionSource, target) {
//   // Avoid errors when testing vision for tokens directly on top of one another
//   const targetCenter = target.center;
//   if ( visionSource.x === targetCenter.x && visionSource.y === targetCenter.y ) return false;
//
//   const api = game.modules.get(MODULE_ID).api;
//   return api.losCalculator.hasLOS(visionSource.object, target);
// }

/**
 * Test whether the origin and test point are on different levels and so no LOS.
 * See https://github.com/theripper93/Levels/blob/v9/scripts/handlers/sightHandler.js
 */
function hasLOSCeilingFloorLevels(origin, testPoint) {
  if ( !MODULES_ACTIVE.LEVELS ) return true;

  const z0 = origin.z;
  const z1 = testPoint.z;

  // Check the background for collisions
  const bgElevation = canvas?.scene?.flags?.levels?.backgroundElevation ?? 0;

  if ( (origin.z < bgElevation && bgElevation < z1)
    || (z1 < bgElevation && bgElevation < z0) ) return false;

  // Loop through all the planes and check for both ceiling and floor collision on each tile
  for (let tile of canvas.tiles.placeables) {
    if ( tile.document.flags?.levels?.noCollision ) continue;
    const bottom = tile.document.flags?.levels?.rangeBottom ?? -Infinity;
    if ( bottom !== -Infinity
      && ((z0 < bottom && bottom < z1) || (z1 < bottom && bottom < z0)) ) {

      const zIntersectionPoint = getPointForPlane(origin, testPoint, bottom);
      if ( tile.containsPixel(zIntersectionPoint.x, zIntersectionPoint.y, 0.99) ) return false;
    }
  }

  return true;
}

// From https://github.com/theripper93/Levels/blob/v9/scripts/handlers/sightHandler.js
// Get the intersection point between the ray and the Z plane
function getPointForPlane(a, b, z) {
  const dabz = b.z - a.z;
  if ( !dabz ) return null;

  const dzaz = z - a.z;
  const x = ((dzaz * (b.x - a.x)) + (a.x * b.z) - (a.x * a.z)) / dabz;
  const y = ((dzaz * (b.y - a.y)) + (b.z * a.y) - (a.z * a.y)) / dabz;
  return { x, y };
}
