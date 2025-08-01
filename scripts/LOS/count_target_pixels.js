/* globals
canvas,
CONFIG,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/*
Can we do token visibility testing entirely in JS but mimic WebGL?
1. For given token shape, transform all triangles (or polygons?) to camera view.
  - Skip triangles facing wrong direction
  - Calculate min/max viewport

2. Iterate over each pixel (e.g., fragment) in the viewport. If contained within token triangle(s), determine
   the frontmost triangle at that point. And determine where the fragment is located in 3d space.
  - Should be defined by barycentric coordinates for the given triangle.

3. Once the 3d location of the pixel is known, run intersection tests:
  - Line to each light / sound source
  - Line to camera.
  - For each line, filter potential obstacles using quad.
  - Test for intersections.
  - Order: first camera, then lighting if camera not blocked
  - Also determine whether dim/bright/dark (take maximum)

2 and 3 could be done using async. Or ideally, entire thing pushed to worker
*/

import { MODULE_ID } from "../const.js";
import { AbstractPolygonTrianglesID } from "./PlaceableTriangles.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { regionElevation } from "./util.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";

/**
 * Test if a barycentric coordinate is within its defined triangle.
 * @param {vec3} bary     Barycentric coordinate; x,y,z => u,v,w
 * @returns {bool} True if inside
 */
function barycentricPointInsideTriangle(bary) {
  return bary.y >= 0.0 && bary.z >= 0.0 && (bary.y + bary.z) <= 1.0;
}

class BaryTriangleData {

  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  v0 = new PIXI.Point();

  /** @type {PIXI.Point} */
  v1 = new PIXI.Point();

  /** @type {float} */
  d00 = 0.0;

  /** @type {float} */
  d01 = 0.0;

  /** @type {float} */
  d11 = 0.0;

  /** @type {float} */
  denomInv = 0.0;

  /**
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @param {PIXI.Point} c
   */
  constructor(a, b, c) {
    a = this.a.copyFrom(a);
    const v0 = b.subtract(a, this.v0)
    const v1 = c.subtract(a, this.v1);
    const d00 = this.d00 = v0.dot(v0);
    const d01 = this.d01 = v0.dot(v1);
    const d11 = this.d11 = this.v1.dot(v1);
    this.denomInv = 1 / ((d00 * d11) - (d01 * d01));
  }

  /**
   * From a 3d triangle, ignoring the z axis.
   */
  static fromTriangle3d(tri3d) {
    return new this(tri3d.a.to2d(), tri3d.b.to2d(), tri3d.c.to2d());
  }
}

/**
 * Calculate barycentric position using fixed triangle data
 * @param {PIXI.Point} p
 * @param {BaryTriangleData} triData
 * @returns {vec3}
 */
function baryFromTriangleData(p, triData, outPoint) {
  outPoint ??= new CONFIG.GeometryLib.threeD.Point3d();
  const { a, v0, v1, d00, d01, d11, denomInv } = triData;
  const v2 = p.subtract(a, outPoint);
  const d02 = v0.dot(v2);
  const d12 = v1.dot(v2);

  const u = ((d11 * d02) - (d01 * d12)) * denomInv;
  const v = ((d00 * d12) - (d01 * d02)) * denomInv;
  const w = 1.0 - u - v;
  outPoint.set(u, v, w);
  return outPoint;
}

/**
 * Interpolate from values at the triangle vertices using a barycentric point.
 * @param {Point3d} bary
 * @param {float|PIXI.Point|Point3d} a
 * @param {float|PIXI.Point|Point3d} b
 * @param {float|PIXI.Point|Point3d} c
 * @returns {float|PIXI.Point|Point3d}
 */
function interpolateBarycentricValue(bary, a, b, c) {
  const other = CONFIG.GeometryLib.threeD.Point3d.tmp.set(a, b, c);
  const out = bary.dot(other);
  other.release();
  return out;
}

/**
 * Interpolate from values at the triangle vertices using a barycentric point.
 * @param {Point3d} bary
 * @param {PIXI.Point|Point3d} a
 * @param {PIXI.Point|Point3d} b
 * @param {PIXI.Point|Point3d} c
 * @returns {PIXI.Point|Point3d}
 */
function interpolateBarycentricPoint(bary, a, b, c, outPoint) {
  outPoint ??= new a.constructor();
  a = a.multiplyScalar(bary.x);
  b = b.multiplyScalar(bary.y);
  c = c.multiplyScalar(bary.z);
  return a.add(b, outPoint).add(c, outPoint);
}

// TODO: In PlaceableTriangles.js, handle points and cached updating
// - Quad points for walls and tiles (incl. alpha texture points)
// - Cache and clear triangles and points on placeable update.
function wallsOcclude(rayOrigin, rayDirection, walls) {
  for ( const wall of walls ) {
    /* Handled elsewhere
    if ( wall.document[senseType] === types.NONE
      || wall.isOpen
      || (wall.document.dir && wall.edge.orientPoint(rayOrigin) !== wall.document.dir) ) continue;
    */

    /*
    const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
    const t = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c)
      ?? Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri1.a, tri1.b, tri1.c);
    */
    const quad = wall[MODULE_ID][AbstractPolygonTrianglesID].quad3d;
    const t = quad.intersectionT(rayOrigin, rayDirection);
    if ( t !== null && t.between(0, 1, false) ) return true;
  }
  return false;
}

function terrainWallsOcclude(rayOrigin, rayDirection, walls) {
  let limitedOcclusion = 0;
  for ( const wall of walls ) {
    /* Handled elsewhere
    if ( wall.document[senseType] === types.NONE
      || wall.isOpen
      || (wall.document.dir && wall.edge.orientPoint(rayOrigin) !== wall.document.dir) ) continue;
    */

    /*
    const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
    const t = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c)
      ?? Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri1.a, tri1.b, tri1.c);
    */
    const quad = wall[MODULE_ID][AbstractPolygonTrianglesID].quad3d;
    const t = quad.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !t.between(0, 1, false) ) continue;
    if ( limitedOcclusion++ ) return true;
  }
  return false;
}

function proximateWallsOcclude(rayOrigin, rayDirection, walls, senseType = "light") {
  for ( const wall of walls ) {
    if ( wall.edge.applyThreshold(senseType, rayOrigin) ) continue; // If the proximity threshold is met, this edge excluded from perception calculations.
    /* Handled elsewhere
    if ( wall.document[senseType] === types.NONE
      || wall.isOpen
      || (wall.document.dir && wall.edge.orientPoint(rayOrigin) !== wall.document.dir) ) continue;
    */

    /*
    const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
    const t = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c)
      ?? Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri1.a, tri1.b, tri1.c);
    */
    const quad = wall[MODULE_ID][AbstractPolygonTrianglesID].quad3d;
    const t = quad.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !t.between(0, 1, false) ) continue;
  }
  return false;
}

function tilesOcclude(rayOrigin, rayDirection, tiles) {
  for ( const tile of tiles ) {
    const quad = tile[MODULE_ID][AbstractPolygonTrianglesID].quad3d;
    const t = quad.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !t.between(0, 1, false) ) continue;
    return true;
  }
  return false;
}

function tilesOccludeAlpha(rayOrigin, rayDirection, tiles) {
  if ( !CONFIG[MODULE_ID].alphaThreshold ) return tilesOcclude(rayOrigin, rayDirection, tiles);
  const pxThreshold = 255 * CONFIG[MODULE_ID].alphaThreshold;

  for ( const tile of tiles ) {
    const quad = tile[MODULE_ID][AbstractPolygonTrianglesID].alphaQuad3d;
    const t = quad.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !t.between(0, 1, false) ) continue;

    // Check if the intersection is transparent.
    rayOrigin.add(rayDirection.multiplyScalar(t, tmpIx), tmpIx);
    const px = tile.evPixelCache.pixelAtCanvas(tmpIx.x, tmpIx.y);
    if ( px > pxThreshold ) return true;
  }
  return false;
}

// TODO: Fix useConstrained to pull separate triangles.
function tokensOcclude(rayOrigin, rayDirection, tokens) {
  // TODO: Would it be more performant to split out rectangular tokens and test quads separately? Or all non-custom tokens?
  //       Could test top/bottom only as needed.
  for ( const token of tokens ) {
    const tris = token[MODULE_ID][AbstractPolygonTrianglesID].triangles.filter(tri => tri.isFacing(rayOrigin));
    for ( const tri of tris ) {
      const t = CONFIG.GeometryLib.threeD.Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri.a, tri.b, tri.c);
      if ( t !== null && t.between(0, 1, false) ) return true;
    }
  }
  return false;
}

// TODO: Fix useConstrained to pull separate triangles.
//
function tokensOcclude2(rayOrigin, rayDirection, tokens) {
  // TODO: Would it be more performant to split out rectangular tokens and test quads separately? Or all non-custom tokens?
  //       Could test top/bottom only as needed.
  for ( const token of tokens ) {
    for ( const tri of token[MODULE_ID][AbstractPolygonTrianglesID].triangles ) {
      if ( tri.isFacing(rayOrigin) ) {
        const t = CONFIG.GeometryLib.threeD.Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri.a, tri.b, tri.c);
        if ( t !== null && t.between(0, 1, false) ) return true;
      }
    }
  }
  return false;
}

// function regionsOcclude(rayOrigin, rayDirection, regions) {
//   // TODO: Would it be more performant to handle simple regions separately?
//   //       In particular, testing top/bottom of region circles and ellipses.
//   //       Also, more refined testing for region ramps and steps.
//   for ( const region of regions ) {
//     const tris = region.tokenvisibility.geometry.triangles.filter(tri => tri.isFacing(rayOrigin));
//     for ( const tri of tris ) {
//       const t = CONFIG.GeometryLib.threeD.Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri.a, tri.b, tri.c);
//       if ( t !== null && t.between(0, 1, false) ) return true;
//     }
//   }
//   return false;
// }

function regionsOcclude(rayOrigin, rayDirection, regions) {
  for ( const region of regions ) {
    const handler = region[MODULE_ID][AbstractPolygonTrianglesID];
    const { topZ, bottomZ, rampFloor } = regionElevation(region);
    const testTop = rayOrigin > (rampFloor ?? topZ) && rayDirection.z < 0; // Ray above region top, moving down.
    const testBottom = rayOrigin < bottomZ && rayDirection.z > 0; // Ray below region bottom, moving up.
    const ixTB = testTop ? handler.topPlane.rayIntersection(rayOrigin, rayDirection)
      : testBottom ? handler.bottomPlane.rayIntersection(rayOrigin, rayDirection)
        : null;

    let containsTB = 0;
    for ( const shape of region.shapes ) {
      // If the point is contained by more shapes than holes, it must intersect a non-hole.
      // Example: Rect contains ellipse hole that contains circle. If in circle, than +2 - 1 = 1. If in ellipses, +1 -1 = 0.
      if ( ixTB && handler.shapesPixi.get(shape).contains(ixTB.x, ixTB.y) ) containsTB += (1 * (-1 * shape.data.hole));

      // Construct sides and test. Sides of a hole still block, so can treat all shapes equally.
      // A side is a vertical quad; basically a wall.
      // Check if facing.
      for ( const quad of handler.shapesSides.get(shape) ) {
        if ( !quad.isFacing(rayOrigin) ) continue;
        const t = quad.intersectionT(rayOrigin, rayDirection);
        if ( t !== null && t.between(0, 1, false) ) return true;
      }
    }
    if ( containsTB > 0 ) return true;
  }
  return false;
}


// See PointSourcePolygon.#calculateThresholdAttenuation
function attenuatedRadius() {

}

let tokensOccludeFn = tokensOcclude;


function obstaclesOcclude(rayOrigin, rayDirection, obstacles, senseType) {
  return wallsOcclude(rayOrigin, rayDirection, obstacles.walls, senseType)
    || terrainWallsOcclude(rayOrigin, rayDirection, obstacles.terrainWalls, senseType)
    || proximateWallsOcclude(rayOrigin, rayDirection, obstacles.proximateWalls, senseType)
    || tilesOccludeAlpha(rayOrigin, rayDirection, obstacles.tiles, senseType)
    || tokensOccludeFn(rayOrigin, rayDirection, obstacles.tokens, senseType)
    || regionsOcclude(rayOrigin, rayDirection, obstacles.regions, senseType);
}



// ----- NOTE: Primary functions ----- //

const tmpIx = new Point3d();
const gridPt = new PIXI.Point();
const pt3d = new Point3d();
// const SCALE = 50; // Will run from -50 to 50, or 100 pixels per row ( can drop 50, as contains should not use it)

/**
 * @typedef {object} OcclusionCount
 *
 * @prop {number} red
 * @prop {number} occluded
 * @prop {number} dark
 * @prop {number} dim
 * @prop {number} bright
 */



/**
 * @param {Camera} camera
 * @param {Token} target
 * @returns {OcclusionCount}
 */
export function countTargetPixels(camera, target, { calculateLitPortions = false, senseType = "sight", sourceType = "lighting", blocking = {}, scale = 50, tokensFn = 1, debug = false } = {}) {
  const viewpoint = camera.cameraPosition;

  tokensOccludeFn = tokensFn === 1 ? tokensOcclude : tokensOcclude2;

  // TODO: Distinguish constrained from not constrained. This will return constrained if present.
  const targetTris = target[MODULE_ID][AbstractPolygonTrianglesID].triangles.filter(poly => poly.isFacing(viewpoint));
  const { lookAtMatrix, perspectiveMatrix } = camera;
  const trisTransformed = targetTris.map(poly => {
    poly = poly.transform(lookAtMatrix).clipZ();
    poly.transform(perspectiveMatrix, poly);
    return poly;
  }).filter(tri => tri.isValid());

  /* Debugging.
  // Transformed tris range from -1 to 1 in x,y directions.
  // Scale and draw in 2d.
  trisScaled = trisTransformed.map(tri => tri.multiplyScalar(1000))
  trisScaled[0].draw2d({ color: Draw.COLORS.red })
  trisScaled[1].draw2d({ color: Draw.COLORS.blue })
  trisScaled[2].draw2d({ color: Draw.COLORS.green })
  trisScaled[3].draw2d({ color: Draw.COLORS.yellow })

  Draw.point(trisScaled[2].a)
  Draw.point(trisScaled[2].b)
  Draw.point(trisScaled[2].c)
  */

  // Transform the triangles so they fit between -1 and 1.
  let xMinMax = { };
  let yMinMax = { };
  trisTransformed.forEach(tri => {
    xMinMax = Math.minMax(...Object.values(xMinMax), tri.a.x, tri.b.x, tri.c.x);
    yMinMax = Math.minMax(...Object.values(yMinMax), tri.a.y, tri.b.y, tri.c.y);
  });

  // Scale the triangles to be between -1 and 1 on the x and y axes.
  // e.g.
  // -0.1 * x = -1, so x = 1 / 0.1 = 10
  // .4 * x = 1, so x = 1 / 0.4 = 2.5
  // w = Math.min(-1 / xMinMax.min, 1 / xMinMax.max)
  // trisTransformed.map(tri => [tri.a.x * w, tri.b.x * w, tri.c.x * w])
  // trisTransformed.map(tri => [tri.a, tri.b, tri.c])

  const xScale = Math.min(-1 / xMinMax.min, 1 / xMinMax.max);
  const yScale = Math.min(-1 / yMinMax.min, 1 / yMinMax.max);

  // Scale up to -50 to 50 so that we can easily get approximately 100 x 100 pixels.
  // Avoids where the frustum does not adequately capture the target.
  // trisScaled = trisTransformed.map(tri => tri.multiplyScalar(scale))
  const trisScaled = trisTransformed.map(tri => tri.scale({ x: scale * xScale, y: scale * yScale, z: 1 }));
  trisScaled.forEach((tri, idx) => {
    tri._original = targetTris[idx]
    tri._baryData = BaryTriangleData.fromTriangle3d(tri);
    tri._baryPoint = new CONFIG.GeometryLib.threeD.Point3d();
  });
  // TODO: Filter trisScaled by z? If z unscaled, between z = 0 and z = 1?

  const srcs = calculateLitPortions ? canvas[sourceType].placeables : [];

  // Determine what obstacles are within the various triangles.
  const viewerObstacles = ObstacleOcclusionTest.findBlockingObjects(viewpoint, target, { senseType, blocking });
  viewerObstacles.terrainWalls = ObstacleOcclusionTest.pullOutTerrainWalls(viewerObstacles.walls, senseType);
  viewerObstacles.proximateWalls = ObstacleOcclusionTest.pullOutTerrainWalls(viewerObstacles.walls, senseType);

  const srcObstacles = srcs.map(src => {
    const obstacles = ObstacleOcclusionTest.findBlockingObjects(Point3d.fromPointSource(src), target, { senseType, blocking });
    obstacles.terrainWalls = ObstacleOcclusionTest.pullOutTerrainWalls(obstacles.walls, senseType);
    obstacles.proximateWalls = ObstacleOcclusionTest.pullOutTerrainWalls(obstacles.walls, senseType);
    return obstacles;
  });

  const outArr = new Uint16Array(5);
  let pixels;
  let containingTris = new Set();
  const width = scale + scale;
  if ( debug ) pixels = new Uint8Array((width ** 2) * 4); // 4 channels per pixel (rgba)
  const LIGHT_DIR = (new Point3d(.25, .5, 1)).normalize();

  for ( let x = -scale; x < scale; x += 1 ) {
    // console.debug(`x: ${x}`);
    for ( let y = -scale; y < scale; y += 1 ) {
       const res = testPixelOcclusion(x, y, trisScaled, camera, srcs, srcObstacles, viewerObstacles, senseType);
       for ( let i = 0; i < 5; i += 1 ) outArr[i] += res.counts[i];
       if ( debug ) {
         if ( !res.containingTri ) continue; // Already set to 0.
         containingTris.add(res.containingTri);

         // TODO: Move this inside the loop and set for each light source.
         const brightness = res.counts[BRIGHT] * 1.0 || res.counts[DIM] * 0.75 || res.counts[DARK] * 0.5 || 0;
         const color = PIXEL_COLOR.set(brightness, 0, res.counts[OCCLUDED]);
         color.multiplyScalar(255, color);

         /*
         const N = res.containingTri.plane.normal;
         const NdotL = Math.max(N.dot(LIGHT_DIR), 0);
         const surfaceColor = color.multiply(AMBIENT_COLOR, SURFACE_COLOR).add(color.multiplyScalar(NdotL, CONFIG.GeometryLib.threeD.Point3d._tmp3), SURFACE_COLOR);
         surfaceColor.multiplyScalar(255, SURFACE_COLOR);
         setPixel(pixels, x, y, scale, [...SURFACE_COLOR, 255]); // Set alpha to 1.
         */

         setPixel(pixels, x, y, scale, [...color, 255]);
       }
    }
  }
  return { pixels, counts: outArr, containingTris };
}

const AMBIENT_COLOR = new Point3d(0.1, 0.1, 0.1);
const LIGHT_COLOR = new Point3d(1, 1, 1);
const PIXEL_COLOR = new Point3d();
const SURFACE_COLOR = new Point3d();

function setPixel(pixels, x, y, scale, arr) {
  const offset = pixelIndex(x + scale, y + scale, scale * 2);
  pixels.set(arr, offset);
}

function pixelIndex(x, y, width = 1, channel = 0, numChannels = 4) {
  return (y * width * numChannels) + (x * numChannels) + channel;
}

function pixelCoordinates(i, width = 1, numChannels = 4) {
  const channel = i % 4;
  const idx = ~~(i / numChannels)

  const x = (idx % width);
  const y = ~~(idx / width);
  return { x, y, channel };
}

function componentToHex(c) {
  var hex = c.toString(16);
  return hex.length == 1 ? "0" + hex : hex;
}
function rgbToHex(r, g, b) {
  return "0x" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function drawPixels(pixels, scale) {
  const width = scale * 2;
  for ( let i = 0; i < pixels.length; i += 4 ) {
    const px = pixels.subarray(i, i + 3);
    const color = parseInt(rgbToHex(px[0], px[1], px[2]), 16);
    const coords = pixelCoordinates(i, width);
    CONFIG.GeometryLib.Draw.point({ x: coords.x - scale, y: coords.y - scale }, { radius: 1, color })
  }
}

function summarizePixels(pixels, numChannels = 4) {
  const out = new Array(numChannels);
  for ( let i = 0; i < numChannels; i += 1 ) out[i] = new Map();
  for ( let i = 0; i < pixels.length; i += numChannels ) {
    for ( let j = 0; j < numChannels; j += 1 ) {
      const px = pixels[i + j];
      const count = out[j].get(px) || 0;
      out[j].set(px, count + 1);
    }
  }
  return out;
}

const tmpCountArray = new Uint16Array(5);

const RED = 0;
const OCCLUDED = 1;
const BRIGHT = 2;
const DIM = 3;
const DARK = 4;

function testPixelOcclusion(x, y, trisScaled, camera, srcs, srcObstacles, viewerObstacles, senseType) {
  tmpCountArray.fill(0);
  const out = { containingTri: null, counts: tmpCountArray };
  gridPt.set(x, y);

  // Locate the viewable triangle for this fragment.
  // Simple shapes should have a single facing triangle but it is possible for there to be more than 1 at a given point.
  // Take the closest z.
  const containingTris = trisScaled.filter(tri => {
    baryFromTriangleData(gridPt, tri._baryData, tri._baryPoint);
    return barycentricPointInsideTriangle(tri._baryPoint);
  });

  // If no containment, move to next.
  if ( !containingTris.length ) return out;

  // Simple shapes should have a single facing triangle but it is possible for there to be more than 1 at a given point.
  // Take the closest z.
  if ( containingTris.length > 1 ) {
    const tri0 = containingTris[0];
    let containingPt = interpolateBarycentricValue(tri0._baryPoint, tri0.a.z, tri0.b.z, tri0.c.z);
    for ( let i = 1, iMax = containingTris.length; i < iMax; i += 1 ) {
      const tri = containingTris[i];
      const newPt = interpolateBarycentricValue(tri._baryPoint, tri.a.z, tri.b.z, tri.c.z);
      if ( newPt.z < containingPt.z ) {
        containingTris[0] = tri;
        containingPt = newPt;
      }
    }
  }
  const containingTri = containingTris[0];
  out.containingTri = containingTri;

  // Determine the 3d point by interpolating from the original triangle.
  const origTri = containingTri._original;
  interpolateBarycentricPoint(containingTri._baryPoint, origTri.a, origTri.b, origTri.c, pt3d);

  // Now we have a 3d point, compare to the viewpoint and lighting viewpoints to determine occlusion and bright/dim/dark
  tmpCountArray[RED] = 1;

  // Is it occluded from the camera/viewer?
  const viewpoint = camera.cameraPosition;
  const rayDirection = pt3d.subtract(viewpoint); // NOTE: Don't normalize so the wall test can use 0 < t < 1.
  if ( obstaclesOcclude(viewpoint, rayDirection, viewerObstacles, senseType) ) {
    tmpCountArray[OCCLUDED] = 1;
    return out;
  }

  // Fragment brightness for each source if that option is requested.
  let isBright = false;
  let isDim = false;
  const side = origTri.plane.whichSide(viewpoint);
  for ( let i = 0, iMax = srcs.length; i < iMax; i += 1 ) {
    const src = srcs[i];
    const obstacles = srcObstacles[i];
    const srcOrigin = Point3d.fromPointSource(src);
    if ( (side * origTri.plane.whichSide(srcOrigin)) < 0 ) continue; // On opposite side of the triangle from the camera.
    const dist2 = Point3d.distanceSquaredBetween(pt3d, srcOrigin);
    if ( dist2 > (src.dimRadius ** 2) ) continue; // Not within source dim radius.

    // If blocked, then not bright or dim.
    const rayDirection = pt3d.subtract(srcOrigin); // NOTE: Don't normalize so the wall test can use 0 < t < 1.
    if ( obstaclesOcclude(srcOrigin, rayDirection, obstacles, senseType) ) continue;

    // TODO: handle light/sound attenuation from threshold walls.
    isBright ||= (dist2 <= (src.brightRadius ** 2));
    isDim ||= isBright || (dist2 <= (src.dimRadius ** 2));
    if ( isBright ) break; // Once we know a fragment is bright, we should know the rest.
  }
  tmpCountArray[BRIGHT] = isBright;
  tmpCountArray[DIM] = isDim;
  tmpCountArray[DARK] = !(isBright || isDim);
  return out;
}


/*
tmpObj = {
  bright: 0,
  dim: 0,
  dark: 0,
  occluded: 0,
  red: 0,
}

tmpArray = new Uint16Array(5);

function countArray(scale = 50) {
  const outArr = new Uint16Array(5);
  for ( let x = -scale; x < scale; x += 1 ) {
    for ( let y = -scale; y < scale; y += 1 ) {
      const res = randomCountArr();
      for ( let i = 0; i < 5; i += 1 ) outArr[i] += res[i];
    }
  }
  return outArr;
}

function countArray2(scale = 50) {
  const outArr = new Uint16Array(5);
  for ( let x = -scale; x < scale; x += 1 ) {
    for ( let y = -scale; y < scale; y += 1 ) {
      randomCountArr2(outArr);
    }
  }
  return outArr;
}

function randomCountArr() {
  tmpArray[0] = Math.round(Math.random())
  tmpArray[1] = Math.round(Math.random())
  tmpArray[2] = Math.round(Math.random())
  tmpArray[3] = Math.round(Math.random())
  tmpArray[4] = Math.round(Math.random());
  return tmpArray;
}

function randomCountArr2(arr) {
  arr[0] += Math.round(Math.random())
  arr[1] += Math.round(Math.random())
  arr[2] += Math.round(Math.random())
  arr[3] += Math.round(Math.random())
  arr[4] += Math.round(Math.random());
  return arr;
}

function countObject(scale = 50) {
  const outObj = {
    bright: 0,
    dim: 0,
    dark: 0,
    occluded: 0,
    red: 0,
  };

  for ( let x = -scale; x < scale; x += 1 ) {
    for ( let y = -scale; y < scale; y += 1 ) {
       const res = randomCountObj();
       outObj.bright += res.bright;
       outObj.dim += res.dim;
       outObj.dark += res.dark;
       outObj.occluded += res.occluded;
       outObj.red += res.red;
    }
  }
  return outObj;
}

function countObject2(scale = 50) {
  const outObj = {
    bright: 0,
    dim: 0,
    dark: 0,
    occluded: 0,
    red: 0,
  };

  for ( let x = -scale; x < scale; x += 1 ) {
    for ( let y = -scale; y < scale; y += 1 ) {
       randomCountObj2(outObj);
    }
  }
  return outObj;
}

function randomCountObj() {
  tmpObj.bright = Math.round(Math.random())
  tmpObj.dim = Math.round(Math.random())
  tmpObj.dark = Math.round(Math.random())
  tmpObj.occluded = Math.round(Math.random())
  tmpObj.red = Math.round(Math.random());
  return tmpObj;
}

function randomCountObj2(obj) {
  obj.bright += Math.round(Math.random())
  obj.dim += Math.round(Math.random())
  obj.dark += Math.round(Math.random())
  obj.occluded += Math.round(Math.random())
  obj.red += Math.round(Math.random());
  return obj;
}

N = 1000
await QBenchmarkLoopFn(N, countObject, "countObject")
await QBenchmarkLoopFn(N, countObject2, "countObject2")
await QBenchmarkLoopFn(N, countArray, "countArray")
await QBenchmarkLoopFn(N, countArray2, "countArray2")

await QBenchmarkLoopFn(N, countArray2, "countArray2")
await QBenchmarkLoopFn(N, countArray, "countArray")
await QBenchmarkLoopFn(N, countObject, "countObject")
await QBenchmarkLoopFn(N, countObject2, "countObject2")
*/


/* Testing
MODULE_ID = "tokenvisibility"
AbstractPolygonTrianglesID = "geometry"
Draw = CONFIG.GeometryLib.Draw
api = game.modules.get("tokenvisibility").api
countTargetPixels = api.countTargetPixels
let { Polygon3d, Triangle3d, GeometryToken, BasicVertices, Camera, Frustum } = api.geometry
AbstractViewpoint = api.AbstractViewpoint
Point3d = CONFIG.GeometryLib.threeD.Point3d
QBenchmarkLoop = CONFIG.GeometryLib.bench.QBenchmarkLoop;
QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn;

viewer = _token
target = game.user.targets.first()

camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective",
    up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
    mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
  });
camera.cameraPosition = Point3d.fromTokenCenter(viewer);
camera.targetPosition = Point3d.fromTokenCenter(target);

opts = { calculateLitPortions: true, senseType: "sight", sourceType: "lighting", scale: 50 }
res = countTargetPixels(camera, target, opts)

RED = 0
OCCLUDED = 1
BRIGHT = 2
DIM = 3
DARK = 4

counts = res.counts
percentVisible = (counts[RED] - counts[OCCLUDED]) / counts[RED];
percentDim = counts[DIM] / counts[RED]
percentBright = counts[BRIGHT] / counts[RED]
console.log(`${Math.round(percentVisible * 10000)/100}% visible | ${Math.round(percentDim * 10000)/100}% dim | ${Math.round(percentBright * 10000)/100}% bright`, res)

N = 100
await QBenchmarkLoopFn(N, countTargetPixels, "countTargetPixels", camera, target, opts)

summarizePixels(res.pixels)

drawPixels(res.pixels, opts.scale)
res.containingTris.forEach(tri => tri.draw2d({ color: Draw.COLORS.green }))

tex = PIXI.Texture.fromBuffer(res.pixels, 100, 100)
sprite = new PIXI.Sprite(tex)
canvas.stage.addChild(sprite)
canvas.stage.removeChild(sprite)

sprite.anchor.set(0.5)
sprite.rotation = Math.PI / 2 // 90º

function componentToHex(c) {
  var hex = c.toString(16);
  return hex.length == 1 ? "0" + hex : hex;
}
function rgbToHex(r, g, b) {
  return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

scale = 50;
width = scale * 2;
for ( let i = 0; i < res.pixels.length / 4; i += 1 ) {
  const offset = i * 4;
  const px = res.pixels.subarray(offset, offset + 4);
  const color = rgbToHex(px[0], px[1], px[2]);
  x = (i % width) - scale
  y = (~~(i / width)) - scale
  Draw.point({ x, y }, { radius: 1, color })
}


*/

/* Test all tokens in scene.

function testAll(camera, opts) {
  const vMap = new WeakMap();
  for ( const viewer of canvas.tokens.placeables ) {
    const tMap = new WeakMap();
    vMap.set(viewer, tMap);
    camera.cameraPosition = Point3d.fromTokenCenter(viewer);
    for ( const target of canvas.tokens.placeables ) {
      if ( viewer === target ) continue
      camera.targetPosition = Point3d.fromTokenCenter(target);
      tMap.set(target, countTargetPixels(camera, target, opts))
    }
  }
  return vMap;
}

camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective",
    up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
    mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
  });

opts = { calculateLitPortions: true, senseType: "sight", sourceType: "lighting", scale: 50, tokensFn: 1 }
testAll(camera, opts)

N = 5
opts = { calculateLitPortions: true, senseType: "sight", sourceType: "lighting", scale: 50, tokensFn: 1 }
await QBenchmarkLoopFn(N, testAll, "testAll", camera, opts)

opts = { calculateLitPortions: true, senseType: "sight", sourceType: "lighting", scale: 50, tokensFn: 2 }
await QBenchmarkLoopFn(N, testAll, "testAll", camera, opts)

console.log(`${canvas.tokens.placeables.length} tokens: ${(canvas.tokens.placeables.length ** 2) - canvas.tokens.placeables.length} combinations`)

8 tokens, 56 combos:
lit: true, scale: 50: 643.54ms     11.5 ms per token
lit: false, scale 50: 507.32ms      9.1 ms per token
lit: true, scale 25: 168.64ms       3.0 ms per token
lit: false, scale 25: 131.2ms       2.3 ms per token



*/


/*
function ix1(walls, rayOrigin, rayDirection) {
  return walls.map(wall => {
    const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
    return CONFIG.GeometryLib.threeD.Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c)
      || CONFIG.GeometryLib.threeD.Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri1.a, tri1.b, tri1.c);
  })
}

function ix2(walls, rayOrigin, rayDirection) {
  return walls.map(wall => {
    // a0 === a1; b1 === c0;
    const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
    return CONFIG.GeometryLib.threeD.Plane.rayIntersectionQuad3d(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c, tri1.c)
  })
}

function ix3(walls, rayOrigin, rayDirection) {
  return walls.map(wall => {
    // a0 === a1; b1 === c0;
    const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
    return CONFIG.GeometryLib.threeD.Plane.rayIntersectionQuad3dLD(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c, tri1.c)
  })
}

rayOrigin = Point3d.fromTokenCenter(viewer)
rayDirection = Point3d.fromTokenCenter(target).subtract(rayOrigin)
ix1(canvas.walls.placeables, rayOrigin, rayDirection)
ix2(canvas.walls.placeables, rayOrigin, rayDirection)
ix3(canvas.walls.placeables, rayOrigin, rayDirection)

N = 10000
await QBenchmarkLoopFn(N, ix1, "ix1", canvas.walls.placeables, rayOrigin, rayDirection)
await QBenchmarkLoopFn(N, ix2, "ix2", canvas.walls.placeables, rayOrigin, rayDirection)
await QBenchmarkLoopFn(N, ix3, "ix3", canvas.walls.placeables, rayOrigin, rayDirection)
*/