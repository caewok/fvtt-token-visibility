/* globals
game,
foundry,
PIXI,
CONFIG
*/
"use strict";

import { MODULE_ID, EPSILON } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { TokenPoints3d } from "./PlaceablesPoints/TokenPoints3d.js";
import { getSetting, SETTINGS } from "./settings.js";

/**
 * Gets the actor object by the actor UUID
 * Comparable to DFred's version.
 * https://github.com/DFreds/dfreds-convenient-effects/blob/8feaede24d310a3fa231d320ae5d33ecb326897f/scripts/foundry-helpers.js#L41
 * @param {string} uuid - the actor UUID
 * @returns {Actor} the actor that was found via the UUID
 */
export function getActorByUuid(uuid) {
  const actorToken = fromUuidSync(uuid);
  return actorToken?.actor ?? actorToken;
}

export function getTokenByUUID(uuid) {
  const token = fromUuidSync(uuid);
  return token?.object;
}

/**
 * Get the key for a given object value. Presumes unique values, otherwise returns first.
 */
export function keyForValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}

/**
 * Retrieve an embedded property from an object using a string.
 * @param {object} obj
 * @param {string} str
 * @returns {object}
 */
export function getObjectProperty(obj, str) {
  return str
    .replace(/\[([^\[\]]*)\]/g, ".$1.") // eslint-disable-line no-useless-escape
    .split(".")
    .filter(t => t !== "")
    .reduce((prev, cur) => prev && prev[cur], obj);
}

/**
 * Get elements of an array by a list of indices
 * https://stackoverflow.com/questions/43708721/how-to-select-elements-from-an-array-based-on-the-indices-of-another-array-in-ja
 * @param {Array} arr       Array with elements to select
 * @param {number[]} indices   Indices to choose from arr. Indices not in arr will be undefined.
 * @returns {Array}
 */
export function elementsByIndex(arr, indices) {
  return indices.map(aIndex => arr[aIndex]);
}

/**
 * Test if an edge CD blocks a line segment AB in 2d.
 * Endpoints count, so if AB crosses C or D, it is blocked.
 * But if AB ends at C or on CD, it does not.
 * It is assumed that A is the start of the segment/ray and so only B is tested.
 * @param {Point} a                   The first endpoint of segment AB
 * @param {Point} b                   The second endpoint of segment AB
 * @param {Point} c                   The first endpoint of segment CD
 * @param {Point} d                   The second endpoint of segment CD
 * @returns {boolean} Does the edge CD block?
 */
export function segmentBlocks(a, b, c, d) {
  if ( b.almostEqual(c) || b.almostEqual(d) ) return false;

  if ( CONFIG.GeometryLib.utils.lineSegmentCrosses(a, b, c, d) ) return true;

  if ( foundry.utils.lineSegmentIntersects(a, b, c, d)
    && (!foundry.utils.orient2dFast(a, b, c) || !foundry.utils.orient2dFast(a, b, d)) ) return true;

  return false;
}

/**
 * Version of Ray.prototype.towardsPointSquared
 * Default is to move 1 pixel along the line.
 * @param {Point} a           Starting point
 * @param {Point} b           Ending point
 * @param {number} distance2  Square of the distance to move
 * @returns {Point} New point on the line, sqrt(distance2) from a.
 */
export function walkLineIncrement(a, b, distance2 = 1) {
  const delta = b.subtract(a);
  const mag2 = delta.magnitudeSquared();
  const t = Math.sqrt(distance2 / mag2);

  const outPoint = new PIXI.Point();
  delta.multiplyScalar(t, outPoint).add(a, outPoint);
  return outPoint;
}

export function walkLinePercentage(a, b, percent = .5) {
  const delta = b.subtract(a);
  const outPoint = new PIXI.Point();
  delta.multiplyScalar(percent, outPoint).add(a, outPoint);
  return outPoint;
}

/**
 * Quickly test whether the line segment AB intersects with a wall in 3d.
 * Extension of lineSegmentPlaneIntersects where the plane is not infinite.
 * Takes advantage of the fact that 3d walls in Foundry move straight out of the canvas
 * @param {Point3d} a   The first endpoint of segment AB
 * @param {Point3d} b   The second endpoint of segment AB
 * @param {Point3d} c   The first corner of the rectangle
 * @param {Point3d} d   The second corner of the rectangle
 * @param {Point3d} e   The third corner of the rectangle
 * @param {Point3d} f   The fourth corner of the rectangle
 *                      Optional. Default is for the plane to go up in the z direction.
 *
 * @returns {boolean} Does the line segment intersect the rectangle in 3d?
 */
export function lineSegment3dWallIntersection(a, b, wall, epsilon = 1e-8) {
  let bottomZ = wall.bottomZ;
  let topZ = wall.bottomZ;

  if ( !isFinite(bottomZ) ) bottomZ = Number.MIN_SAFE_INTEGER;
  if ( !isFinite(topZ) ) topZ = Number.MAX_SAFE_INTEGER;

  // Four corners of the wall: c, d, e, f
  const c = new Point3d(wall.A.x, wall.A.y, bottomZ);
  const d = new Point3d(wall.B.x, wall.B.y, bottomZ);

  // First test if wall and segment intersect from 2d overhead.
  if ( !foundry.utils.lineSegmentIntersects(a, b, c, d) ) { return null; }

  // Second test if segment intersects the wall as a plane
  const e = new Point3d(wall.A.x, wall.A.y, topZ);

  if ( !CONFIG.GeometryLib.utils.lineSegment3dPlaneIntersects(a, b, c, d, e) ) { return null; }

  // At this point, we know the wall, if infinite, would intersect the segment
  // But the segment might pass above or below.
  // Simple approach is to get the actual intersection with the infinite plane,
  // and then test for height.
  const ix = lineWall3dIntersection(a, b, wall, epsilon);
  if ( !ix || ix.z < wall.bottomZ || ix.z > wall.topZ ) { return null; }

  return ix;
}

export function linePlane3dIntersection(a, b, c, d, epsilon = 1e-8) {
  const u = b.subtract(a);
  const dot = d.dot(u);

  if ( Math.abs(dot) > epsilon ) {
    // The factor of the point between a -> b (0 - 1)
    // if 'fac' is between (0 - 1) the point intersects with the segment.
    // Otherwise:
    // < 0.0: behind a.
    // > 1.0: infront of b.
    const w = a.subtract(c);
    const fac = -d.dot(w) / dot;
    const uFac = u.multiplyScalar(fac);
    a.add(uFac, uFac);
    return uFac;
  }

  // The segment is parallel to the plane.
  return null;
}

/**
 * Möller-Trumbore ray-triangle intersection
 * Calculate intersection of a ray and a triangle in three dimensions.
 * @param {Point3d} A   Point on the line. For a ray, the ray origin point.
 * @param {Point3d} rayVector   Line vector, from origin.
 * @param {Point3d} v0          Triangle vertex 0
 * @param {Point3d} v1          Triangle vertex 1
 * @param {Point3d} v2          Triangle vertex 2
 * @returns {number|null}  Intersection point of the line, relative to A.
 */
export function lineIntersectionTriangle3d(A, rayVector, v0, v1, v2) {
  const EPSILON = 1e-08;

  const edge1 = v1.subtract(v0);
  const edge2 = v2.subtract(v0);

  const h = rayVector.cross(edge2);
  const a = edge1.dot(h);

  if ( a.almostEqual(0, EPSILON) ) return null; // Ray is parallel to triangle.

  const f = 1.0 / a;

  const s = A.subtract(v0);
  return lineTriangleIntersectionLocation(rayVector, edge1, edge2, s, f, h);

  // To compute the intersection location using t and outPoint = new Point3d():
  // A.add(rayVector.multiplyScalar(t, outPoint), outPoint);
  // If t > 0, t is on the ray.
  // if t < 1, t is between rayOrigin and B, where rayVector = B.subtract(A)
}

/**
 * Helper to get intersection of line with triangle, assuming not parallel.
 * @param {Point3d} rayVector   Line vector, from origin A.
 * @param {Point3d} edge1       Vector from v0 for one triangle edge
 * @param {Point3d} edge2       Vector from v0 for other triangle edge
 * @param {number} f            Ratio from rayIntersectsTriangle3d
 * @param {Point3d} h           Cross of rayVector with edge2.
 * @param {Point3d} s           A minus v0.
 * @returns {number|null}
 */
export function lineTriangleIntersectionLocation(rayVector, edge1, edge2, s, f, h) {
  const u = f * s.dot(h);
  if ( u < 0.0 || u > 1.0 ) return null;

  const q = s.cross(edge1);
  const v = f * rayVector.dot(q);
  if ( v < 0.0 || (u + v) > 1.0 ) return null;

  return f * edge2.dot(q); // This is t

  // To compute the intersection location using t and outPoint = new Point3d():
  // A.add(rayVector.multiplyScalar(t, outPoint), outPoint);
  // If t > 0, t is on the ray.
  // if t < 1, t is between rayOrigin and B, where rayVector = B.subtract(A)
}

/**
 * Test if line intersects a quadrilateral in 3d.
 * Applies Möller-Trumbore ray-triangle intersection but does the planar test only once.
 * @param {Point3d} A           Point on the line. For a ray, the ray origin point.
 * @param {Point3d} rayVector   Line vector, from origin.
 * @param {Point3d} r0          Quad vertex 0  Expected vertices in CW order.
 * @param {Point3d} r1          Quad vertex 1
 * @param {Point3d} r2          Quad vertex 2
 * @param {Point3d} r3          Quad vertex 3
 * @returns {number|null}  Place on the ray of the intersection or null if none.
 */
export function lineIntersectionQuadrilateral3d(A, rayVector, r0, r1, r2, r3) {
  // Test both directions of the quad (otherwise, need to force to CW order)
  let res = _lineIntersectionQuadrilateral3d(A, rayVector, r0, r1, r2, r3);
  if ( res === null ) res = _lineIntersectionQuadrilateral3d(A, rayVector, r3, r2, r1, r0);
  return res;
}

function _lineIntersectionQuadrilateral3d(A, rayVector, r0, r1, r2, r3) {
  // Triangles are 0-1-2 and 0-2-3
  const edge1 = r1.subtract(r0);
  const edge2 = r2.subtract(r0);

  const h = rayVector.cross(edge2);
  const a = edge1.dot(h);

  if ( a.almostEqual(0, EPSILON) ) return null; // Ray is parallel to triangle.

  const f = 1.0 / a;
  const s = A.subtract(r0);

  const tri1 = lineTriangleIntersectionLocation(rayVector, edge1, edge2, s, f, h);
  if ( tri1 !== null ) return tri1;

  const edge3 = r3.subtract(r0);
  const h2 = rayVector.cross(edge3);
  const a2 = edge1.dot(h);
  const f2 = 1.0 / a2;

  return lineTriangleIntersectionLocation(rayVector, edge1, edge3, s, f2, h2);
}

/**
 * Boolean test for whether a line segment intersects a quadrilateral.
 * Relies on Möller-Trumbore ray-triangle intersection.
 * @param {Point3d} A     First endpoint of the segment
 * @param {Point3d} B     Second endpoint of the segment
 * @param {Point3d} r0          Quad vertex 0  Expected vertices in CW order.
 * @param {Point3d} r1          Quad vertex 1
 * @param {Point3d} r2          Quad vertex 2
 * @param {Point3d} r3          Quad vertex 3
 * @returns {boolean} True if intersection occurs.
 */
export function lineSegmentIntersectsQuadrilateral3d(A, B, r0, r1, r2, r3, { EPSILON = 1e-08 } = {}) {
  const rayVector = B.subtract(A);
  const t = lineIntersectionQuadrilateral3d(A, rayVector, r0, r1, r2, r3);
  if ( t === null ) return false;

  return !(t < EPSILON || t > (1 + EPSILON));
}

/**
 * Get the intersection of a 3d line with a wall extended as a plane.
 * See https://stackoverflow.com/questions/5666222/3d-line-plane-intersection
 * @param {Point3d} a   First point on the line
 * @param {Point3d} b   Second point on the line
 * @param {Wall} wall   Wall to intersect
 */
export function lineWall3dIntersection(a, b, wall, epsilon = EPSILON) {
  const Ax = wall.A.x;
  const Ay = wall.A.y;

  const c = new Point3d(Ax, Ay, 0);

  // Perpendicular vectors are (-dy, dx) and (dy, -dx)
  const d = new Point3d(-(wall.B.y - Ay), (wall.B.x - Ax), 0);

  return linePlane3dIntersection(a, b, c, d, epsilon);
}

/**
 * @typedef buildTokenPointsConfig
 * @type {object}
 * @property {CONST.WALL_RESTRICTION_TYPES} type    Type of vision source
 * @property {boolean} deadTokensBlock              Do dead tokens block vision?
 * @property {boolean} liveTokensBlock              Do live tokens block vision?
 * @property {PIXI.Graphics} graphics               Graphics to pass to the point constructor
 */

/**
 * Given config options, build TokenPoints3d from tokens.
 * The points will use either half- or full-height tokens, depending on config.
 * @param {Token[]|Set<Token>} tokens
 * @param {buildTokenPointsConfig} config
 * @returns {TokenPoints3d[]}
 */
export function buildTokenPoints(tokens, config) {
  if ( !tokens.length && !tokens.size ) return tokens;
  const { liveTokensBlock, deadTokensBlock, proneTokensBlock } = config;
  if ( !(liveTokensBlock || deadTokensBlock) ) return [];

  const hpAttribute = getSetting(SETTINGS.COVER.DEAD_TOKENS.ATTRIBUTE);

  // Filter live or dead tokens
  if ( liveTokensBlock ^ deadTokensBlock ) tokens = tokens.filter(t => {
    const hp = getObjectProperty(t.actor, hpAttribute);
    if ( typeof hp !== "number" ) return true;

    if ( liveTokensBlock && hp > 0 ) return true;
    if ( deadTokensBlock && hp <= 0 ) return true;
    return false;
  });


  if ( !proneTokensBlock ) tokens = tokens.filter(t => !t.isProne);

  // Pad (inset) to avoid triggering cover at corners. See issue 49.
  return tokens.map(t => new TokenPoints3d(t, { pad: -1 }));
}
