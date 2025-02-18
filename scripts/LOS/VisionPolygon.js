/* globals
ClipperLib,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";

import { Draw } from "../geometry/Draw.js";

/**
 * The viewable area between viewer and target.
 * Typically, this is a triangle, but if viewed head-on, it will be a triangle
 * with the portion of the target between viewer and target center added on.
 */
export class VisionPolygon extends PIXI.Polygon {
  /**
   * @typedef {object} VPElevation
   * @property {number} min
   * @property {number} max
   */

  /** @type {VPElevation} */
  elevation = {
    min: Number.NEGATIVE_INFINITY,
    max: Number.POSITIVE_INFINITY
  };

  /**
   * Convert array of points to a vision polygon.
   * @param {PIXI.Point[]|number[]} points
   * @returns {VisionPolygon}
   */
  static fromPoints(points, viewpoint, target) {
    const vp = new VisionPolygon(points);
    vp.elevation.min = this.elevationMin(viewpoint, target);
    vp.elevation.max = this.elevationMax(viewpoint, target);

    // Cache for speed??
    // vp._edges = [...vp.iterateEdges()];
    vp._bounds = vp.getBounds();
    return vp;
  }

  /**
   * Convert a regular polygon to a vision polygon.
   * @param {PIXI.Polygon} poly
   * @returns {VisionPolygon}
   */
  static fromPolygon(poly, viewpoint, target) {
    return this.fromPoints(poly.points, viewpoint, target);
  }

  /**
   * Determine the minimum and maximum elevations for a given viewpoint and target.
   * @param {Point3d} viewpoint
   * @param {Token} target
   * @returns {number}
   */
  static elevationMin(viewpoint, target) {
    return Math.min(
      viewpoint?.z ?? Number.NEGATIVE_INFINITY,
      target?.bottomZ ?? Number.NEGATIVE_INFINITY
    );
  }
  static elevationMax(viewpoint, target) {
    return Math.max(
      viewpoint?.z ?? Number.POSITIVE_INFINITY,
      target?.topZ ?? Number.POSITIVE_INFINITY
    );
  }

  /**
   * Vision Polygon for the view point --> target.
   * From the given token location, get the edge-most viewable points of the target.
   * Construct a triangle between the two target points and the token center.
   * If viewing head-on (only two key points), the portion of the target between
   * viewer and target center (typically, a rectangle) is added on to the triangle.
   * @param {PIXI.Point|Point3d} viewpoint
   * @param {Token} target
   * @param {PIXI.Polygon|PIXI.Rectangle} targetBorder
   * @returns {VisionPolygon}
   */
  static build(viewpoint, target, targetBorder) {
    targetBorder ??= target.constrainedTokenBorder;
    const keyPoints = targetBorder.viewablePoints(viewpoint, { outermostOnly: false }) ?? [];
    let out;
    switch ( keyPoints.length ) {
      case 0:
      case 1:
        out = targetBorder.toPolygon().points;
        break;
      case 2: {
        const k0 = keyPoints[0];
        const k1 = keyPoints[1];
        const center = target.center;

        // Build a rectangle between center and key points.
        // Intersect against the targetBorder
        const X = Math.minMax(k0.x, k1.x, center.x);
        const Y = Math.minMax(k0.y, k1.y, center.y);
        const rect = new PIXI.Rectangle(X.min, Y.min, X.max - X.min, Y.max - Y.min);
        const intersect = targetBorder instanceof PIXI.Rectangle ? rect : rect.intersectPolygon(targetBorder);

        // Union the triangle with this border
        const triangle = new PIXI.Polygon([viewpoint, k0, k1]);

        // WA requires a polygon with a positive orientation.
        if ( !triangle.isPositive ) triangle.reverseOrientation();
        out = intersect.intersectPolygon(triangle, { clipType: ClipperLib.ClipType.ctUnion }).points;
        break;
      }
      default:
        out = [viewpoint, keyPoints[0], keyPoints.at(-1)];
    }
    out = this.fromPoints(out, viewpoint, target);
    if ( !out.isClockwise ) out.reverseOrientation();
    return out;
  }

  /**
   * Filter walls in the scene by a triangle representing the view from viewingPoint to some
   * token (or other two points). Only considers 2d top-down view.
   * @param {Set<Wall>}
   * @return {Set<Wall>}
   */
  filterWalls(walls) {
    const viewpoint = this.iteratePoints().next().value;

    // Filter by the precise triangle cone.
    return walls.filter(wall => {
      if ( wall.isOpen ) return false;

      // Ignore one-directional walls facing away from the viewpoint.
      if ( wall.document.dir
        && (wall.edge.orientPoint(viewpoint) === wall.document.dir) ) return false;

      // Ignore walls that are not within the elevation vision rectangle.
      let { top, bottom } = wall.edge.elevationLibGeometry.a;
      top ??= Number.POSITIVE_INFINITY;
      bottom ??= Number.NEGATIVE_INFINITY;
      if ( wall.top < this.elevation.min || wall.bottom > this.elevation.max ) return false;

      const { a, b } = wall.edge;
      if ( this.contains(a.x, a.y) || this.contains(b.x, b.y) ) return true;
      return this.iterateEdges().some(e => foundry.utils.lineSegmentIntersects(a, b, e.A, e.B));
    });
  }

  /**
   * Filter tiles in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * @param {Set<Tile>}
   * @return {Set<Tile>}
   */
  filterTiles(tiles) {
    // Filter by the precise triangle shape
    // Also filter by overhead tiles
    const alphaThreshold = CONFIG[MODULE_ID].alphaThreshold;
    return tiles.filter(tile => {
      const tileE = tile.document.elevation;

      // Only overhead tiles count for blocking vision
      // TODO: Need more nuanced understanding of overhead tiles and what should block.
      if ( tileE < tile.document.parent?.foregroundElevation ) return false;

      // Ignore tiles that are not within the elevation vision rectangle.
      if ( tileE < this.elevation.min || tileE > this.elevation.max ) return false;

      // Use the alpha bounding box. This might be a polygon if the tile is rotated.
      const tBounds = tile.evPixelCache.getThresholdCanvasBoundingBox(alphaThreshold);
      const tCenter = tBounds.center;
      if ( this.contains(tCenter.x, tCenter.y) ) return true;
      return this.iterateEdges().some(e => tBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
  }

  /**
   * Filter tokens in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * Excludes the target and the visionSource token. If no visionSource, excludes any
   * token under the viewer point.
   * @param {Set<Token>}
   * @return {Set<Token>}
   */
  filterTokens(tokens) {
    return tokens.filter(token => {
      // Ignore tokens not within the elevation vision rectangle.
      if ( token.topE < this.elevation.min || token.bottomE > this.elevation.max ) return false;

      // Even for constrained tokens, the token center should remain within the token border.
      const tCenter = token.center;
      if ( this.contains(tCenter.x, tCenter.y) ) return true;

      // Full test of token border.
      const tBounds = token.bounds;
      return this.iterateEdges().some(e => tBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
  }
}


/**
 * The viewable area between viewer and target.
 * Triangle
 *
 */
export class VisionTriangle {

  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  b = new PIXI.Point();

  /** @type {PIXI.Point} */
  c = new PIXI.Point();

  /** @type {number} */
  maxElevation = Number.POSITIVE_INFINITY;

  /** @type {number} */
  minElevation = Number.NEGATIVE_INFINITY;

  constructor(a, b, c, maxElevation = Number.POSITIVE_INFINITY, minElevation = Number.NEGATIVE_INFINITY) {
    this.a.copyFrom(a);
    this.b.copyFrom(b);
    this.c.copyFrom(c);
    this.maxElevation = maxElevation;
    this.minElevation = minElevation;
    this._storeBaryData();
  }

  /**
   * Vision Polygon for the view point --> target.
   * From the given token location, get the edge-most viewable points of the target.
   * Construct a triangle between the two target points and the token center.
   * If viewing head-on (only two key points), the portion of the target between
   * viewer and target center (typically, a rectangle) is added on to the triangle.
   * @param {PIXI.Point|Point3d} viewpoint
   * @param {Token} target
   * @param {PIXI.Polygon|PIXI.Rectangle} targetBorder
   * @returns {VisionPolygon}
   */
  static build(viewpoint, target, targetBorder) {
    targetBorder ??= target.constrainedTokenBorder;
    const keyPoints = targetBorder.viewablePoints(viewpoint, { outermostOnly: false }) ?? [];
    let b;
    let c;
    switch ( keyPoints.length ) {
      case 0:
      case 1: {
        const iter = targetBorder.toPolygon().iteratePoints({close: false});
        b = iter.next().value;
        c = iter.next().value;
        break;
      }
      case 2: {
        const k0 = keyPoints[0];
        const k1 = keyPoints[1];
        const center = target.center;

        // Extend the triangle rays from viewpoint so they intersect the perpendicular line from the center.
        const dir = viewpoint.to2d().subtract(center, PIXI.Point._tmp3);
        const perpDir = PIXI.Point._tmp2.set(-dir.y, dir.x);
        const perpPt = center.add(perpDir, perpDir); // Project along the perpDir.
        b = foundry.utils.lineLineIntersection(viewpoint, k0, center, perpPt);
        c = foundry.utils.lineLineIntersection(viewpoint, k1, center, perpPt);
        if ( !(b && c) ) {
          const iter = targetBorder.toPolygon().iteratePoints({close: false});
          b = iter.next().value;
          c = iter.next().value;
        }
        break;
      }
      default:
        b = keyPoints[0];
        c = keyPoints.at(-1);
    }
    return new this(viewpoint, b, c, this.elevationMin(viewpoint, target), this.elevationMax(viewpoint, target));
  }

  /**
   * Determine the minimum and maximum elevations for a given viewpoint and target.
   * @param {Point3d} viewpoint
   * @param {Token} target
   * @returns {number}
   */
  static elevationMin(viewpoint, target) {
    return Math.min(
      viewpoint?.z ?? Number.NEGATIVE_INFINITY,
      target?.bottomZ ?? Number.NEGATIVE_INFINITY
    );
  }
  static elevationMax(viewpoint, target) {
    return Math.max(
      viewpoint?.z ?? Number.POSITIVE_INFINITY,
      target?.topZ ?? Number.POSITIVE_INFINITY
    );
  }

  #v0 = new PIXI.Point();

  #v1 = new PIXI.Point();

  #d00 = 0;

  #d01 = 0;

  #d11 = 0;

  _storeBaryData() {
    this.b.subtract(this.a, this.#v0);
    this.c.subtract(this.a, this.#v1);

    this.#d00 = this.#v0.dot(this.#v0);
    this.#d01 = this.#v0.dot(this.#v1);
    this.#d11 = this.#v1.dot(this.#v1);
  }

  /**
   * Calculate barycentric position within a given triangle
   * For point p and triangle abc, return the barycentric uvw as a vec3 or vec2.
   * See https://ceng2.ktu.edu.tr/~cakir/files/grafikler/Texture_Mapping.pdf
   * @param {vec3|vec2} p
   * @param {vec3|vec2} a
   * @param {vec3|vec2} b
   * @param {vec3|vec2} c
   * @returns {vec3}
   */
  barycentric(p) {
    const v0 = this.#v0;
    const v1 = this.#v1;
    const v2 = p.subtract(this.a, this.a.constructor._tmp3);
    const d00 = this.#d00;
    const d01 = this.#d01;
    const d11 = this.#d11;
    const d20 = v2.dot(v0);
    const d21 = v2.dot(v1);

    const denom = ((d00 * d11) - (d01 * d01));
    // TODO: Is this test needed? if ( denom == 0.0 ) return new vec3(-1.0);

    const denomInv = 1.0 / denom; // Fixed for given triangle
    const v = ((d11 * d20) - (d01 * d21)) * denomInv;
    const w = ((d00 * d21) - (d01 * d20)) * denomInv;
    const u = 1.0 - v - w;
    return { u, v, w };
  }

  /**
   * Test if a barycentric coordinate is within its defined triangle.
   * @param {PIX.Point} p     Barycentric coordinate; x,y,z => u,v,w
   * @returns {bool} True if inside
   */
  pointInsideTriangle(p) {
    const { u, v, w } = this.barycentric(p)
    return u >= 0.0 && v >= 0.0 && (v + w) <= 1.0;
  }

  pointInsideTriangleFast(p) {
    const v0 = this.#v0;
    const v1 = this.#v1;
    const v2 = p.subtract(this.a, this.a.constructor._tmp3);
    const d00 = this.#d00;
    const d01 = this.#d01;
    const d11 = this.#d11;
    const d20 = v2.dot(v0);
    const d21 = v2.dot(v1);

    const denom = ((d00 * d11) - (d01 * d01));
    // TODO: Is this test needed? if ( denom == 0.0 ) return new vec3(-1.0);

    const denomInv = 1.0 / denom; // Fixed for given triangle
    const v = ((d11 * d20) - (d01 * d21)) * denomInv;
    if ( v < 0 ) return false;

    const w = ((d00 * d21) - (d01 * d20)) * denomInv;
    if ( w < 0 ) return false;
    if ( v + w > 1 ) return false;
    return true;
  }

  // Fastest.
  pointInsideTriangleOrient(p) {
    const orient2d = foundry.utils.orient2dFast;

    // All orientations must be the same sign or 0.
    const oAB = orient2d(this.a, this.b, p);
    const oBC = orient2d(this.b, this.c, p);
    return (oAB * oBC >= 0) && (oAB * orient2d(this.c, this.a, p) >= 0);
  }

  pointWithinElevation(p) { return p.z <= this.maxElevation && p.z >= this.minElevation; }

  draw(opts = {}) {
    Draw.shape(new PIXI.Polygon(this.a, this.b, this.c), opts)
  }
}

/* Testing

Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
let { VisionPolygon, VisionTriangle } = api.bvh

viewer = _token
target = game.user.targets.first()

visionPoly = VisionPolygon.build(Point3d.fromTokenCenter(viewer), target)
visionTri = VisionTriangle.build(Point3d.fromTokenCenter(viewer), target)
Draw.shape(visionPoly)
visionTri.draw({ color: Draw.COLORS.blue })

pt = _token.center

fn = function(ptTest, pt) {
  const dir = PIXI.Point._tmp.set(Math.random(), Math.random());
  dir.multiplyScalar(200, dir);
  return ptTest(pt.add(dir, PIXI.Point._tmp));
}


for ( let i = 0; i < 100; i += 1 ) {
  const dir = PIXI.Point._tmp.set(Math.random(), Math.random());
  dir.multiplyScalar(200, dir);
  const newPt = pt.add(dir, PIXI.Point._tmp);
  const a = visionTri.pointInsideTriangle(newPt);
  const b = visionTri.pointInsideTriangleFast(newPt);
  const c = visionTri.pointInsideTriangleOrient(newPt);
  console.log(`${i}\t${newPt.x.toFixed(2)},${newPt.y.toFixed(2)}\t ${a} ${b} ${c}`)
  if ( a !== b || a !== c ) {
    console.error("Failed!", { a, b, c, newPt })
    break;
  }
}




N = 1000
await foundry.utils.benchmark(VisionPolygon.build.bind(VisionPolygon), N, Point3d.fromTokenCenter(viewer), target, target.constrainedTokenBorder)
await foundry.utils.benchmark(VisionTriangle.build.bind(VisionTriangle), N, Point3d.fromTokenCenter(viewer), target, target.constrainedTokenBorder)

N = 10000
await foundry.utils.benchmark(visionPoly.contains.bind(visionPoly), N, pt)
await foundry.utils.benchmark(visionTri.pointInsideTriangle.bind(visionTri), N, pt)
await foundry.utils.benchmark(visionTri.pointInsideTriangleFast.bind(visionTri), N, pt)
await foundry.utils.benchmark(visionTri.pointInsideTriangleOrient.bind(visionTri), N, pt)

await foundry.utils.benchmark(fn, N, visionPoly.contains.bind(visionPoly), pt)
await foundry.utils.benchmark(fn, N, visionTri.pointInsideTriangle.bind(visionTri), pt)
await foundry.utils.benchmark(fn, N, visionTri.pointInsideTriangleFast.bind(visionTri), pt)
await foundry.utils.benchmark(fn, N, visionTri.pointInsideTriangleOrient.bind(visionTri), pt)

*/