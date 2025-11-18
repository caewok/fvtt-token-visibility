/* globals
canvas,
CONFIG,
foundry,
LimitedAnglePolygon,
PIXI,
Ray,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { EPSILON, MODULE_ID, OTHER_MODULES } from "../const.js";
import { Point3d } from "../geometry/3d/Point3d.js";

/**
 * Define a null set class and null set which always contains 0 elements.
 * The class simply removes the add method.
 */
class NullSet extends Set {
  add(value) {
   console.error(`${MODULE_ID}|Attempted to add ${value} to a NullSet.`, value);
   return this;
  }
}
export const NULL_SET = new NullSet();


/**
 * Log if this module's debug config is enabled.
 */
export function log(...args) {
  try {
    if ( CONFIG[MODULE_ID].debug ) console.debug(MODULE_ID, "|", ...args);
  } catch(_e) {
    // Empty
  }
}

/**
 * Fast rounding for positive numbers
 * @param {number} n
 * @returns {number}
 */
export function roundFastPositive(n) { return (n + 0.5) << 0; }


/**
 * Test if the token constrained borders overlap and tokens are at same elevation.
 * Used to allow vision when tokens are nearly on top of one another.
 * @param {Token} token1
 * @param {Token} token2
 * @param {number} [pad=-2]     Increase or decrease the borders. By default, shrink the
 *   borders to avoid false positives for adjacent tokens.
 * @returns {boolean}
 */
export function tokensOverlap(token1, token2, pad = -2) {
  if ( token1.elevationE !== token2.elevationE ) return false;
  if ( token1.center.equals(token2.center) ) return true;
  const border1 = token1.constrainedTokenBorder.clone().pad(pad);
  const border2 = token2.constrainedTokenBorder.clone().pad(pad);
  return border1.overlaps(border2);
}

/**
 * Trim line segment to its intersection points with a rectangle.
 * If the endpoint is inside the rectangle, keep it.
 * Note: points on the right or bottom border of the rectangle do not count b/c we want the pixel positions.
 * @param {PIXI.Rectangle} rect
 * @param {Point} a
 * @param {Point} b
 * @returns { Point[2]|null } Null if both are outside.
 */
export function trimLineSegmentToPixelRectangle(rect, a, b) {
  rect = new PIXI.Rectangle(rect.x, rect.y, rect.width - 1, rect.height - 1);

  if ( !rect.lineSegmentIntersects(a, b, { inside: true }) ) return null;

  const ixs = rect.segmentIntersections(a, b);
  if ( ixs.length === 2 ) return ixs;
  if ( ixs.length === 0 ) return [a, b];

  // If only 1 intersection:
  //   1. a || b is inside and the other is outside.
  //   2. a || b is on the edge and the other is outside.
  //   3. a || b is on the edge and the other is inside.
  // Point on edge will be considered inside by _getZone.

  // 1 or 2 for a
  const aOutside = rect._getZone(a) !== PIXI.Rectangle.CS_ZONES.INSIDE;
  if ( aOutside ) return [ixs[0], b];

  // 1 or 2 for b
  const bOutside = rect._getZone(b) !== PIXI.Rectangle.CS_ZONES.INSIDE;
  if ( bOutside ) return [a, ixs[0]];

  // 3. One point on the edge; other inside. Doesn't matter which.
  return [a, b];
}


/**
 * Bresenham line algorithm to generate pixel coordinates for a line between two points.
 * All coordinates must be positive or zero.
 * @param {number} x0   First coordinate x value
 * @param {number} y0   First coordinate y value
 * @param {number} x1   Second coordinate x value
 * @param {number} y1   Second coordinate y value
 * @testing
Draw = CONFIG.GeometryLib.Draw
let [t0, t1] = canvas.tokens.controlled
pixels = bresenhamLine(t0.center.x, t0.center.y, t1.center.x, t1.center.y)
for ( let i = 0; i < pixels.length; i += 2 ) {
  Draw.point({ x: pixels[i], y: pixels[i + 1]}, { radius: 1 });
}
 */
export function bresenhamLine(x0, y0, x1, y1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;
  let err = dx - dy;

  const pixels = [x0, y0];
  while ( x0 !== x1 || y0 !== y1 ) {
    const e2 = err * 2;
    if ( e2 > -dy ) {
      err -= dy;
      x0 += sx;
    }
    if ( e2 < dx ) {
      err += dx;
      y0 += sy;
    }

    pixels.push(x0, y0);
  }
  return pixels;
}

export function* bresenhamLineIterator(x0, y0, x1, y1) {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;
  let err = dx - dy;
  yield { x: x0, y: y0 };
  while ( x0 !== x1 || y0 !== y1 ) {
    const e2 = err * 2;
    if ( e2 > -dy ) {
      err -= dy;
      x0 += sx;
    }
    if ( e2 < dx ) {
      err += dx;
      y0 += sy;
    }

    yield { x: x0, y: y0 };
  }
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

export function sumRedPixels(targetCache) {
  const pixels = targetCache.pixels;
  const nPixels = pixels.length;
  let sumTarget = 0;
  for ( let i = 0; i < nPixels; i += 4 ) sumTarget += Boolean(targetCache.pixels[i]);
  return sumTarget;
}

export function sumRedObstaclesPixels(targetCache) {
  const pixels = targetCache.pixels;
  const nPixels = pixels.length;
  let sumTarget = 0;
  for ( let i = 0; i < nPixels; i += 4 ) {
    const px = pixels[i];
    if ( px < 128 ) continue;
    sumTarget += Boolean(targetCache.pixels[i]);
  }
  return sumTarget;
}


/**
 * Determine minimum and maximum x and y of an array of polygons.
 * @param {PIXI.Polygon[]} polygons
 * @returns { object }
 *   - @prop {object} xMinMax
 *     - @prop {number} min
 *     - @prop {number} max
 *   - @prop {object} yMinMax
 *     - @prop {number} min
 *     - @prop {number} max
 */
export function minMaxPolygonCoordinates(polygons) {
  let elem = 0;
  polygons.forEach(poly => elem += poly.points.length);
  const nCoord = elem * 0.5;
  const xs = Array(nCoord);
  const ys = Array(nCoord);
  for ( let i = 0, k = 0, n = polygons.length; i < n; i += 1) {
    const arr = polygons[i].points;
    const nArr = arr.length;
    for ( let j = 0; j < nArr; j += 2, k += 1 ) {
      xs[k] = arr[j];
      ys[k] = arr[j+1];
    }
  }
  return { xMinMax: Math.minMax(...xs), yMinMax: Math.minMax(...ys) };
}

/**
 * Efficiently combine multiple typed arrays.
 * @param {TypedArray[]} args
 * @returns {TypedArray}
 */
export function combineTypedArrays(arrs) {
  const len = arrs.reduce((acc, curr) => acc + curr.length, 0);
  const out = new arrs[0].constructor(len);
  out.set(arrs[0]);
  let idx = 0;
  for ( let i = 0, n = arrs.length; i < n; i += 1 ) {
    out.set(arrs[i], idx);
    idx += arrs[i].length;
  }
  return out;
}

/**
 * From http://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html
 * Load an image bitmap from a url.
 * @param {string} url
 * @param {object} [opts]       Options passed to createImageBitmap
 * @returns {ImageBitmap}
 */
export async function loadImageBitmap(url, opts = {}) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await createImageBitmap(blob, opts);
}


/* Orient3dFast license
https://github.com/mourner/robust-predicates/tree/main
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>

*/

/**
 * See https://github.com/mourner/robust-predicates/blob/main/src/orient3d.js
 * Returns a positive value if the point d lies above the plane passing through a, b, and c,
 * meaning that a, b, and c appear in counterclockwise order when viewed from d.
 * Returns a negative value if d lies below the plane.
 * Returns zero if the points are coplanar.
 * The result is also an approximation of six times the signed volume of the tetrahedron defined by the four points.
 * @param {Point3d} a
 * @param {Point3d} b
 * @param {Point3d} c
 * @param {Point3d} d
 * @returns {number}
 */


export function orient3dFast(a, b, c, d) {
  // Perform vector subtractions using pre-allocated temporary vectors
  const adx = a.x - d.x;
  const ady = a.y - d.y;
  const adz = a.z - d.z;

  const bdx = b.x - d.x;
  const bdy = b.y - d.y;
  const bdz = b.z - d.z;

  const cdx = c.x - d.x;
  const cdy = c.y - d.y;
  const cdz = c.z - d.z;

  // Calculate the 3x3 determinant directly
  return adx * (bdy * cdz - bdz * cdy)
       + bdx * (cdy * adz - cdz * ady)
       + cdx * (ady * bdz - adz * bdy);
}

/**
 * For a given numeric array or numeric set, apply a method to each consecutive group.
 * So if 0–5, 7–9, 12, should result in 3 callbacks:
 *  { start: 0, length: 5 }, { start: 7, length: 3 }, { start: 12, length: 1 }
 * @param {Set<number>|number[]} arr
 * @param {function} callback
 *   - @param {number} start        The starting number
 *   - @param {number} length       The length of consecutive numbers.
 */
export function applyConsecutively(arr, callback) {
  if ( arr instanceof Set ) arr = [...arr.values()];
  arr.sort((a, b) => a - b);

  for ( let i = 0, iMax = arr.length; i < iMax; i += 1 ) {
    const start = arr[i];
    let length = 1;
    while ( arr[i + 1] === arr[i] + 1 ) { length += 1; i += 1; }
    callback(start, length);
  }
}

export function checkFramebufferStatus(gl, framebuffer) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    let errorMessage = `Framebuffer error: ${status}`;
    switch (status) {
      case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
        errorMessage = "Framebuffer incomplete: Attachment is missing or invalid";
        break;
      case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
        errorMessage = "Framebuffer incomplete: Missing attachment";
        break;
      case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
        errorMessage = "Framebuffer incomplete: Dimensions are mismatched";
        break;
      case gl.FRAMEBUFFER_UNSUPPORTED:
        errorMessage = "Framebuffer incomplete: Unsupported format";
        break;
      case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE:
        errorMessage = "Framebuffer incomplete: Multisample settings are inconsistent";
        break;
      default:
        errorMessage = `Framebuffer error: ${status}`;
    }
    console.error(errorMessage);
  }
  return status === gl.FRAMEBUFFER_COMPLETE;
}

export function flipObjectKeyValues(obj) {
  const newObj = {};
  Object.entries(obj).forEach(([key, value]) => newObj[value] = key);
  return newObj;
}

export function isTypedArray(obj) {
  return ArrayBuffer.isView(obj) && !(obj instanceof DataView);
}

/**
 * Determine elevation of a region, specific to LOS considerations.
 * If terrain mapper is present, returns the top of the plateau or ramp.
 * Ensures top and bottom have a defined MIN/MAX, not null or infinity.
 * @param {Region} region
 * @returns {object<topZ: {number}, bottomZ: {number}>}
 */
export function regionElevation(region) {
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels
  const tm = region.terrainmapper;
  let topZ = (OTHER_MODULES.TERRAIN_MAPPER.ACTIVE && tm.isElevated)
    ? gridUnitsToPixels(tm.plateauElevation) : region.topZ;
  let bottomZ = region.bottomZ;
  if ( !(topZ && isFinite(topZ)) ) topZ = 1e06;
  if ( !(bottomZ && isFinite(bottomZ)) ) bottomZ = -1e06;
  const rampFloor = (OTHER_MODULES.TERRAIN_MAPPER.ACTIVE && tm.isRamp) ? gridUnitsToPixels(tm.rampFloor) : null;
  return { topZ, bottomZ, rampFloor };
}


/**
 * Converts region shape to a temporary PIXI shape.
 * Must clone the shape if needed more than just temporarily.
 * @param {RegionShape} regionShape
 * @returns {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|Ellipse}
 */
const tmpRectangle = new PIXI.Rectangle();
const tmpCircle = new PIXI.Circle();
const tmpPolygon = new PIXI.Polygon();
const tmpEllipse = new PIXI.Ellipse(); // No need for rotation right now?

export function convertRegionShapeToPIXI(regionShape) {
  const shapeData = regionShape.data;
  switch ( shapeData.type ) {
    case "rectangle": {
      // TODO: What about the shape data rotation parameter? Is it actually used?
      tmpRectangle.copyFrom(shapeData);
      return tmpRectangle;
    }
    case "polygon": {
      tmpPolygon.points = shapeData.points;
      return tmpPolygon;
    }
    case "circle": {
      tmpCircle.x = shapeData.x;
      tmpCircle.y = shapeData.y;
      tmpCircle.radius = shapeData.radius;
      return tmpCircle;
    }
    case "ellipse": {
      // TODO: What about the shape data rotation parameter? Is it actually used?
      tmpEllipse.x = shapeData.x;
      tmpEllipse.y = shapeData.y;
      tmpEllipse.width = shapeData.radiusX;
      tmpEllipse.height = shapeData.radiusY;
      // tmpEllipse.rotation = shapeData.rotation;
      return tmpEllipse;
    }
    default: console.error(`Shape ${shapeData.type} not recognized.`, regionShape);
  }
}

/**
 * Sets a typed array to the values of another, in place if possible.
 * If the source length differs from the destination, a new destination is created.
 * @param {TypedArray} dst
 * @param {TypedArray} src
 * @returns {TypedArray} dst, possibly new
 */
export function setTypedArray(dst, src) {
  if ( src.length !== dst.length ) dst = new dst.constructor(src);
  else dst.set(src);
  return dst;
}

export function isString(obj) { return typeof obj === "string" || obj instanceof String; }

/**
 * Test if point p0 and point p1 are on the same side relative to segment a|b.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @param {PIXI.Point} p0
 * @param {PIXI.Point} p1
 * @returns {boolean}
 */
export function sameSide(a, b, p0, p1) {
  return (foundry.utils.orient2dFast(a, b, p0) * foundry.utils.orient2dFast(a, b, p1)) > 0;
}

/**
 * Fast version of PlaceableDocument.getFlag that avoid calling getProperty.
 * Does not handle nested flags.
 * @param {PlaceableDocument} doc
 * @param {string} scope
 * @param {string} key
 * @returns {*|undefined} Undefined if no flag
 */
export function getFlagFast(doc, scope, key) {
  return doc.flags?.[scope]?.[key];
}

/**
 * Clamp a number between two values, allowing numbers very close to the min or max.
 * For example, clamp(0, 1, 1e-06) would clamp -.00001 to 0.
 * @param {number} num
 * @param {number} min
 * @param {number} max
 * @param {number} [epsilon=1e-08]
 * @returns {number}
 */
export function approximateClamp(num, min, max, epsilon = 1e-08) {
  if ( num.almostEqual(min, epsilon) ) return min;
  if ( num.almostEqual(max, epsilon) ) return max;
  return Math.clamp(num, min, max);
}

/**
 * Map mean to link arbitrary ids to index integers.
 * Allows reverse lookup and tracking of used indices.
 */
export class IndexMap extends Map {
  // Each arbitrary id is stored in an element of the array corresponding to its index.
  // Index may have null or undefined values.
  /** @type {*[]} */
  #index = [];

  set(key, value) {
    if ( !Number.isInteger(value) || value < 0 ) return console.error("IndexedMap|Value must be positive integer", value);
    this.#index[value] = key;
    super.set(key, value);
  }

  hasIndex(value) { return Boolean(this.#index[value]); }

  getKeyAtIndex(value) { return this.#index[value]; }

  get maxIndex() { return this.#index.length - 1; }

  clear() {
    this.#index.length = 0;
    super.clear();
  }

  delete(key) {
    const value = this.get(key);
    if ( typeof value !== "undefined" ) this.#index[value] = null;
    return super.delete(key);
  }

  /**
   * The next empty index or a new index if the index array is full.
   */
  get nextIndex() {
    const i = this.#index.findIndex(elem => elem == null);
    if ( ~i ) return i;
    return this.#index.length;
  }

  *iterateEmptyIndices() {
    const index = this.#index;
    for ( let i = 0, iMax = index.length; i < iMax; i += 1 ) {
      const elem = index[i];
      if ( elem == null ) yield i;
    }
    yield index.length;
  }
}

export class IndexWeakMap extends WeakMap {
  #index = [];

  set(key, value) {
    if ( !Number.isInteger(value) || value < 0 ) return console.error("IndexedMap|Value must be positive integer", value);
    this.#index[value] = new WeakRef(key);
    super.set(key, value);
  }

  mayHaveIndex(value) { return Boolean(this.#index[value]); }

  hasIndex(value) { return Boolean(this.getKeyAtIndex(value)); }

  getKeyAtIndex(value) { return this.#index[value]?.deref(); }

  clear() {
    this.#index.length = 0;
    // No WeakMap#clear.
  }

  delete(key) {
    const value = this.get(key);
    if ( typeof value !== "undefined" ) this.#index[value] = null;
    return super.delete(key);
  }

  /**
   * The next empty index or a new index if the index array is full.
   * @type {number}
   */
  get nextIndex() {
    const index = this.#index;
    for ( let i = 0, iMax = index.length; i < iMax; i += 1 ) {
      const elem = index[i];
      if ( !elem ) return i;
      if ( typeof elem.deref() === "undefined" ) return i;
    }
    return index.length;
  }

  *iterateEmptyIndices() {
    const index = this.#index;
    for ( let i = 0, iMax = index.length; i < iMax; i += 1 ) {
      const elem = index[i];
      if ( elem == null ) yield i;
      else if ( typeof elem.deref() === "undefined") return i;
    }
    yield index.length;
  }

  clean() {
    const index = this.#index;
    for ( let i = 0, iMax = index.length; i < iMax; i += 1 ) {
      const elem = index[i];
      if ( elem == null ) continue;
      if ( typeof elem.deref() === "undefined") index[i] = null;
    }
  }
}

export function isOdd(n) { return (n & 1) === 1; }
