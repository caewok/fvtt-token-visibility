/* globals
canvas,
CONST,
foundry,
PointSourcePolygon,
Ray
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../geometry/3d/Point3d.js";
import { Plane } from "../geometry/3d/Plane.js";

// Patches for the PointSourcePolygon class
export const PATCHES = {};
PATCHES.LOS = {};

// ----- NOTE: New static methods ----- //

/**
 * New method: PointSourcePolygon.prototype.testCollision3d
 * 3d version of ClockwiseSweepPolygon.testCollision
 * Test whether a Ray between the origin and destination points would collide with a boundary of this Polygon
 * @param {Point} origin                          An origin point
 * @param {Point} destination                     A destination point
 * @param {PointSourcePolygonConfig} config       The configuration that defines a certain Polygon type
 * @param {string} [config.mode]                  The collision mode to test: "any", "all", or "closest"
 * @returns {boolean|Point3d|Point3d[]|null} The collision result depends on the mode of the test:
 *                                                * any: returns a boolean for whether any collision occurred
 *                                                * all: returns a sorted array of Point3d instances
 *                                                * closest: returns a Point3d instance or null
 */
function testCollision3d(origin, destination, {mode="all", wallTypes="all", ...config}={}) {
  const poly = new this();
  const ray = new Ray(origin, destination);
  config.boundaryShapes ||= [];
  config.boundaryShapes.push(ray.bounds);
  poly.initialize(origin, config);
  return poly._testCollision3d(ray, mode, wallTypes);
}

PATCHES.LOS.STATIC_METHODS = {
  testCollision3d
};


// ----- NOTE: New methods ----- //

/**
 * New method: PointSourcePolygon.prototype._testCollision3d
 * Check whether a given ray intersects with walls.
 * This version considers rays with a z element
 *
 * @param {PolygonRay} ray            The Ray being tested
 * @param {object} [options={}]       Options which customize how collision is tested
 * @param {string} [options.type=move]        Which collision type to check, a value in CONST.WALL_RESTRICTION_TYPES
 * @param {string} [options.mode=all]         Which type of collisions are returned: any, closest, all
 * @param {boolean} [options.debug=false]     Visualize some debugging data to help understand the collision test
 * @param {boolean}[options.walls=all]        What walls to test:
 *                                            * all: all walls
 *                                            * limited: limited bottom or top walls only
 * @return {boolean|object[]|object}  Whether any collision occurred if mode is "any"
 *                                    An array of collisions, if mode is "all"
 *                                    The closest collision, if mode is "closest"
 */
function _testCollision3d(ray, mode, wallTypes = "all") {
  // Identify candidate edges
  // Don't use this._identifyEdges b/c we need all edges, including those excluded by Wall Height
  const collisionTest = (o, rect) => originalTestWallInclusion.call(this, o.t, rect);
  let walls = canvas.walls.quadtree.getObjects(ray.bounds, { collisionTest });
  if ( wallTypes === "limited" ) {
    walls = walls.filter(w => isFinite(w.topZ) || isFinite(w.bottomZ) );
  }

  return testWallsForIntersections(ray.A, ray.B, walls, mode, this.config.type);
}

PATCHES.LOS.METHODS = {
  _testCollision3d
};

// ----- NOTE: Helper functions ----- //

/**
 * Helper function to test walls for intersections in 3d.
 * Walls assumed to be vertical, but may have top and bottom elevations.
 * Top A and B elevations must match; bottom A and B elevations must match
 * @param {Point3d} origin          Origin of the ray that may intersect walls
 * @param {Point3d} destination     Destination/endpoint of the ray that may intersect walls
 * @param {Wall[]|Set<Wall>} walls  Walls to test for intersections
 * @param {string} mode             "any": return true if collision, false otherwise
 *                                  "all": return all collisions as an array
 *                                  "closest": return the closest collision
 *                                  "sorted": return the collisions sorted by distance,
 *                                    with initial terrain wall collision removed, if any
 * @param {string} type             The wall type (light, move, sight, sound).
 *                                  If undefined, all walls will be treated as NORMAL restriction.
 * @returns {boolean|object[]|object}
 */
function testWallsForIntersections(origin, destination, walls, mode, type) {
  origin = new Point3d(origin.x, origin.y, origin.z);
  destination = new Point3d(destination.x, destination.y, destination.z);
  const direction = destination.subtract(origin);

  const collisions = [];
  for ( let wall of walls ) {
    // Check the 2d overhead first.
    if ( !foundry.utils.lineSegmentIntersects(origin, destination, wall.A, wall.B) ) continue;

    const wallPoints = Point3d.fromWall(wall, { finite: true });
    const t = Plane.rayIntersectionQuad3dLD(
      origin,
      direction,
      wallPoints.A.top,
      wallPoints.A.bottom,
      wallPoints.B.bottom,
      wallPoints.B.top);

    if ( t === null || t < 0 || t > 1 ) continue;

    const ix = origin.add(direction.multiplyScalar(t));
    ix.type = wall.document[type] ?? CONST.WALL_SENSE_TYPES.NORMAL;
    ix.t = t;
    ix.wall = wall;

    if ( mode === "any" && (ix.type === CONST.WALL_SENSE_TYPES.NORMAL || collisions.length) ) return true;
    collisions.push(ix);
  }

  if ( mode === "any" ) return false;

  // Return all collisions
  if ( mode === "all" ) return collisions;

  // Return the closest collision
  collisions.sort((a, b) => a.t - b.t);
  if ( collisions[0]?.type === CONST.WALL_SENSE_TYPES.LIMITED ) collisions.shift();

  if ( mode === "sorted" ) return collisions;

  return collisions[0] || null;
}

function originalTestWallInclusion(wall, bounds) {
  const {type, boundaryShapes, useThreshold, wallDirectionMode } = this.config;

  // First test for inclusion in our overall bounding box
  if ( !bounds.lineSegmentIntersects(wall.A, wall.B, { inside: true }) ) return false;

  // Specific boundary shapes may impose additional requirements
  for ( const shape of boundaryShapes ) {
    if ( shape._includeEdge && !shape._includeEdge(wall.A, wall.B) ) return false;
  }

  // Ignore walls which are nearly collinear with the origin
  const side = wall.orientPoint(this.origin);
  if ( !side ) return false;

  // Always include interior walls underneath active roof tiles
  if ( (type === "sight") && wall.hasActiveRoof ) return true;

  // Otherwise, ignore walls that are not blocking for this polygon type
  else if ( !wall.document[type] || wall.isOpen ) return false;

  // Ignore one-directional walls which are facing away from the origin
  const wdm = PointSourcePolygon.WALL_DIRECTION_MODES;
  if ( wall.document.dir && (wallDirectionMode !== wdm.BOTH) ) {
    if ( (wallDirectionMode === wdm.NORMAL) === (side === wall.document.dir) ) return false;
  }

  // Condition walls on whether their threshold proximity is met
  if ( useThreshold ) return !wall.applyThreshold(type, this.origin);
  return true;
}
