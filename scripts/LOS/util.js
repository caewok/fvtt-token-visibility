/* globals
*/
"use strict";

import { EPSILON } from "../const.js";
import { TokenPoints3d } from "./PlaceablesPoints/TokenPoints3d.js";
import { Settings, SETTINGS } from "../settings.js";
import { Point3d } from "../geometry/3d/Point3d.js";

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
 * Take an array of points and move them toward a center point by a specified percentage.
 * @param {PIXI.Point[]|Point3d[]} pts        Array of points to adjust. These are adjusted in place.
 * @param {PIXI.Point|Point3d} tokenCenter    Center point to move toward
 * @param {number} insetPercentage            Percent between 0 and 1, where 1 would move the points to the center.
 * @returns {PIXI.Point[]|Point3d[]} The points, for convenience.
 */
export function insetPoints(pts, tokenCenter, insetPercentage) {
  const delta = new Point3d();
  if ( insetPercentage ) {
    pts.forEach(pt => {
      tokenCenter.subtract(pt, delta);
      delta.multiplyScalar(insetPercentage, delta);
      pt.add(delta, pt);
    });
  } else {
    pts.forEach(pt => {
      tokenCenter.subtract(pt, delta);
      delta.x = Math.sign(delta.x); // 1 pixel
      delta.y = Math.sign(delta.y); // 1 pixel
      pt.add(delta, pt);
    });
  }
  return pts;
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
 * Helper to get intersection of line with triangle, assuming not parallel.
 * @param {Point3d} rayVector   Line vector, from origin A.
 * @param {Point3d} edge1       Vector from v0 for one triangle edge
 * @param {Point3d} edge2       Vector from v0 for other triangle edge
 * @param {number} f            Ratio from rayIntersectsTriangle3d
 * @param {Point3d} h           Cross of rayVector with edge2.
 * @param {Point3d} s           A minus v0.
 * @returns {number|null}
 */
function lineTriangleIntersectionLocation(rayVector, edge1, edge2, s, f, h) {
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

  const hpAttribute = Settings.get(SETTINGS.COVER.DEAD_TOKENS.ATTRIBUTE);

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
