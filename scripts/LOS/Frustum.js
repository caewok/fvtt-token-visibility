/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { AbstractPlaceableTrackerID } from "./placeable_tracking/PlaceableGeometryTracker.js";
import { Triangle3d, Quad3d } from "../geometry/3d/Polygon3d.js";
import { AABB3d } from "../geometry/AABB.js";

// Temporary points
const pt3d_0 = new Point3d();
const pt3d_1 = new Point3d();

/**
 * The viewable area between viewer and target.
 * Comprised of 4 triangle3ds, forming a pyramid, with a quad3d as the base.
 * Point of the triangle is the viewpoint.
 *
 */
export class Frustum {

  // Frustum is called early, as a static object for AbstractViewpoint. So it needs imported versions.
  top = new Triangle3d();

  bottom = new Triangle3d();

  right = new Triangle3d();

  left = new Triangle3d();

  floor = new Quad3d();

  aabb = new AABB3d();

  /** @type {PIXI.Rectangle} */
  bounds2d = new PIXI.Rectangle(); // For quadtree

  /** @type {Point3d} */
  get viewpoint() { return this.top.a; }

  setAABB() {
    const viewpoint = this.viewpoint;
    const xMinMax = Math.minMax(this.floor.a.x, this.floor.b.x, this.floor.c.x, this.floor.d.x, viewpoint.x);
    const yMinMax = Math.minMax(this.floor.a.y, this.floor.b.y, this.floor.c.y, this.floor.d.y, viewpoint.y);
    const zMinMax = Math.minMax(viewpoint.z, this.top.b.z, this.bottom.b.z);
    this.aabb.min.set(xMinMax.min, yMinMax.min, zMinMax.min);
    this.aabb.max.set(xMinMax.max, yMinMax.max, zMinMax.max);
    this.aabb.toPIXIRectangle(this.bounds2d);
  }

  /**
   * Vision Polygon for the view point --> target.
   * From the given token location, get the edge-most viewable points of the target.
   * Construct a triangle between the two target points and the token center.
   * If viewing head-on (only two key points), the portion of the target between
   * viewer and target center (typically, a rectangle) is added on to the triangle.
   * @param {PIXI.Point|Point3d} viewpoint
   * @param {PIXI.Polygon|PIXI.Rectangle} border2d
   * @param {number} [topZ=0]
   * @param {number} [bottomZ=topZ]
   * @returns {Frustum}
   */
  static build(opts = {}) {
    const out = new this();
    if ( !(opts.border2d || opts.target) ) {
      console.warn("Frustum|One of border2d or target shold be provided.", opts);
      return out;
    }
    return out.rebuild(opts);
  }

  /**
   * @param {PIXI.Point|Point3d} viewpoint
   * @param {PIXI.Polygon|PIXI.Rectangle} border2d
   * @param {number} [topZ=0]
   * @param {number} [bottomZ=topZ]
   * @returns {object}
   */
  static computeTriangle(viewpoint, border2d) {
    const keyPoints = border2d.viewablePoints(viewpoint, { outermostOnly: false }) ?? [];
    let b;
    let c;
    switch ( keyPoints.length ) {
      case 0:
      case 1: {
        const iter = border2d.toPolygon().iteratePoints({close: false});
        b = iter.next().value;
        c = iter.next().value;
        break;
      }
      case 2: {
        const k0 = keyPoints[0];
        const k1 = keyPoints[1];
        const center = border2d.center;

        // Extend the triangle rays from viewpoint so they intersect the perpendicular line from the center.
        const dir = viewpoint.to2d().subtract(center, pt3d_0);
        const perpPt = pt3d_1.set(center.x - dir.y, center.y + dir.x); // Project along the perpDir: center + perpDir
        b = foundry.utils.lineLineIntersection(viewpoint, k0, center, perpPt);
        c = foundry.utils.lineLineIntersection(viewpoint, k1, center, perpPt);
        if ( !(b && c) ) {
          const iter = border2d.toPolygon().iteratePoints({close: false});
          b = iter.next().value;
          c = iter.next().value;
        }
        break;
      }
      default:
        b = keyPoints[0];
        c = keyPoints.at(-1);
    }
    return { b, c };
  }

  rebuild({ viewpoint, target, border2d, topZ, bottomZ, infiniteDistance } = {}) {
    if ( target ) {
      border2d = (CONFIG[MODULE_ID].constrainTokens ? target.constrainedTokenBorder : target.tokenBorder);
      topZ ??= target.topZ;
      bottomZ ??= target.bottomZ;
    }

    // Use existing properties if undefined.
    viewpoint ??= this.viewpoint;
    topZ ??= this.top.b.z;
    bottomZ ??= this.bottom.b.z;
    let b;
    let c;
    if ( border2d ) {
      const res = this.constructor.computeTriangle(viewpoint, border2d, topZ, bottomZ)
      b = res.b;
      c = res.c;
    } else {
      b = this.top.b.to2d();
      c = this.top.c.to2d();
    }
    this._rebuild(viewpoint, b, c, topZ, bottomZ, infiniteDistance);
    return this;
  }

  _rebuild(viewpoint, b, c, topZ = 0, bottomZ = topZ, infiniteDistance = false) {
    if ( infiniteDistance ) {
      const dist2 = canvas.dimensions.maxR ** 2;
      b = viewpoint.towardsPointSquared(b, dist2);
      c = viewpoint.towardsPointSquared(c, dist2);
    }

    if ( foundry.utils.orient2dFast(viewpoint, c, b) < 0 ) [b, c] = [c, b]; // Force view --> b --> c to be CW
    const elevationZ = this.constructor.elevationZMinMax(viewpoint, topZ, bottomZ);

    // All shapes are CCW from viewpoint outside the frustrum.
    // Left, right, top, bottom from view of viewpoint facing the frustum bottom.
    // Quad is clockwise from point of view of the viewpoint.
    this.floor.a.set(b.x, b.y, elevationZ.max);
    this.floor.b.set(c.x, c.y, elevationZ.max);
    this.floor.c.set(c.x, c.y, elevationZ.min);
    this.floor.d.set(b.x, b.y, elevationZ.min);

    this.top.a.copyFrom(viewpoint);
    this.bottom.a.copyFrom(viewpoint);
    this.left.a.copyFrom(viewpoint);
    this.right.a.copyFrom(viewpoint);

    this.top.b.set(c.x, c.y, elevationZ.max);
    this.top.c.set(b.x, b.y, elevationZ.max);

    this.bottom.b.set(b.x, b.y, elevationZ.min);
    this.bottom.c.set(c.x, c.y, elevationZ.min);

    this.right.b.set(c.x, c.y, elevationZ.min);
    this.right.c.set(c.x, c.y, elevationZ.max);

    this.left.b.set(b.x, b.y, elevationZ.max);
    this.left.c.set(b.x, b.y, elevationZ.min);

    this.top.clearCache();
    this.bottom.clearCache();
    this.left.clearCache();
    this.right.clearCache();
    this.floor.clearCache();

    this.setAABB();

    return this; // For convenience.
  }

  static elevationZMinMax(viewpoint, topZ = 0, bottomZ = topZ) {
    const vBottomZ = viewpoint.z ?? Number.NEGATIVE_INFINITY;
    const vTopZ = viewpoint.z ?? Number.POSITIVE_INFINITY;
    const tBottomZ = bottomZ ?? Number.NEGATIVE_INFINITY;
    const tTopZ = topZ ?? Number.POSITIVE_INFINITY;
    return Math.minMax(vBottomZ, vTopZ, tBottomZ, tTopZ);
  }

  *iteratePoints() {
    yield this.top.a; // Viewpoint.
    yield this.top.c;
    yield this.top.b;
    yield this.bottom.b;
    yield this.bottom.c;
  }

  *iterateFaces(includeFloor = true) {
    yield this.top;
    yield this.left;
    yield this.bottom;
    yield this.right;
    if ( includeFloor ) yield this.floor;
  }

  /**
   * Test if a point is contained within the frustrum.
   * @param {Point3d} p
   * @returns {boolean}
   */
  containsPoint(p, testBottom = true) {
    if ( !this.aabb.contains(p) ) return false;
    for ( const face of this.iterateFaces(testBottom) ) {
      if ( face.isFacing(p) ) return false;
    }
    return true;
  }

  /**
   * Does the segment cross the frustum or contained within?
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {boolean}
   */
  overlapsSegment(a, b) {
    if ( !this.aabb.overlapsSegment(a, b) ) return false; // TODO: Is it faster without this?

    // Instead of calling containsPoint, test along the way to avoid iterating twice.
    let aInside = true;
    let bInside = true;
    for ( const face of this.iterateFaces() ) {
      if ( face.plane.lineSegmentIntersects(a, b)
        && face.intersectionT(a, b.subtract(a, pt3d_0)) !== null ) return true;
      aInside ||= !face.isFacing(a);
      bInside ||= !face.isFacing(b);
    }
    return aInside || bInside;
  }

  /**
   * Test if a sphere is contained within the frustum.
   * @param {Sphere} sphere
   * @returns {boolean}
   */
  overlapsSphere(sphere) {
    if ( this.containsPoint(sphere.center) ) return true;
    if ( !this.aabb.overlapsSphere(sphere) ) return false;
    for ( const face of this.iterateFaces() ) {
      if ( sphere.overlapsPolygon3d(face) ) return true;
    }
    return false;
  }

  /**
   * Test if a given AABB overlaps this frustrum
   * @param {AABB} aabb
   * @returns {boolean}
   */
  overlapsAABB(aabb) {
    for ( const pt of this.iteratePoints() ) {
      if ( aabb.containsPoint(pt) ) return true;
    }
    for ( const face of this.iterateFaces() ) {
      if ( aabb.overlapsConvexPolygon3d(face) ) return true;
    }
    return false;
  }

  poly3dWithinFrustum(poly3d) {
    if ( !this.convexPolygon3dWithinBounds(poly3d) ) return false;

    // Polygon edge intersects 1+ planes and the segment created is within bounds.
    for ( const face of this.iterateFaces() ) {
      const res = face.intersectPlane(poly3d); // Faces are all triangles, so likely better to use them for the intersection.
      if ( !res ) continue;

      // Segment intersection
      if ( res.b && this.segmentOverlapsFrustum(res.a, res.b) ) return true;
      else if ( this.pointWithinFrustum(res.a) ) return true; // Single point of intersection
    }
    return false;
  }

  containsEdge(edge) {
    // Ignore one-directional walls facing away from the viewpoint.
    if ( edge.direction
      && (edge.orientPoint(this.viewpoint) === edge.direction) ) return false;

    const geometry = this.#geometryWithinAABB(edge.object);
    if ( !geometry ) return false;

    return this.aabb.overlapsConvexPolygon3d(geometry.quad3d);
  }

  containsWall(wall) { return this.containsEdge(wall.edge); }

  containsTile(tile) {
    // If the elevations don't change, the tile cannot be an obstacle.
    if ( this.aabb.min.z === this.aabb.max.z ) return false;

    // Only overhead tiles count for blocking vision
    if ( tile.elevationE < tile.document.parent?.foregroundElevation ) return false;

    const geometry = this.#geometryWithinAABB(tile);
    if ( !geometry ) return false;

    return this.aabb.overlapsConvexPolygon3d(geometry.quad3d);
  }

  containsToken(token) {
    const geometry = this.#geometryWithinAABB(token);
    if ( !geometry ) return false;

    // Only test AABB for tokens, as the token shape generally closely matches the box.
    return true;
  }

  containsRegion(region) {
    // Ignore regions not within the vision rectangle elevation.
    const { topZ, bottomZ } = region;
    if ( this.outsideElevation(topZ, bottomZ) ) return false;

    // For each region shape, use the ideal version to test b/c circles and ellipses can be tested faster than polys.
    // Ignore holes (some shape with holes may get included but rather be over-inclusive here)
    // Yes or no, regardless of how many shapes of a region are in the vision triangle.
    const geometry = this.#geometryWithinAABB(region);
    if ( !geometry ) return false;

    for ( const shape of region.shapes ) {
      if ( shape.data.hole ) continue;
      const shapeGeometry = this.#geometryWithinAABB(shape);
      if ( shapeGeometry ) return true; // TODO: Is it worth testing against the frustrum directly for any region shapes?
    }
    return false;
  }

  /**
   * @param {PlaceableObject}
   * @returns {PlaceableGeometryTracker|false}
   */
  #geometryWithinAABB(placeable) {
    const geometry = placeable[MODULE_ID]?.[AbstractPlaceableTrackerID];
    if ( !geometry ) {
      console.warn(`${this.constructor.name}|geometryWithinAABB|${placeable.id} does not have a geometry object.`, placeable);
      return false;
    }
    if ( !this.aabb.overlapsAABB(geometry.aabb) ) return false;
    if ( !this.overlapsAABB(geometry.aabb) ) return false;
    return geometry;
  }



  /**
   * Test if an elevation range might be within the frustum, as determined by the AABB.
   * @param {number} [topZ=0]
   * @param {number} [bottomZ=topZ]
   * @returns {boolean}
   */
  outsideElevation(topZ = 0, bottomZ = topZ) {
    return topZ < this.aabb.min.z && bottomZ > this.aabb.max.z;
  }


  /**
   * Find edges in the scene by a triangle representing the view from viewingPoint to some
   * token (or other two points). Checks for one-directional walls; ignores those facing away from viewpoint.
   * Pass an includes function to test others.
   * @return {Set<Edge>}
   */
  findEdges() {
    const collisionTest = o => this.containsEdge(o.t);
    return canvas.edges.quadtree.getObjects(this.bounds2d, { collisionTest });
  }

  /**
   * Same as findEdges but filters based on an existing edge set.
   * @param {Edge[]|Set<Edge>} edges
   * @returns {Edge[]|Set<Edge>}
   */
  filterEdges(edges) { return edges.filter(e => this.containsEdge(e)); }

  /**
   * Find walls in the scene by a triangle representing the view from viewingPoint to some
   * token (or other two points). Checks for one-directional walls; ignores those facing away from viewpoint.
   * Pass an includes function to test others.
   * @return {Set<Wall>}
   */
  findWalls() {
    const collisionTest = o => this.containsWall(o.t);
    return canvas.walls.quadtree.getObjects(this.bounds2d, { collisionTest });
  }

  /**
   * Same as findWalls but filters based on an existing set.
   * @param {Wall[]|Set<Wall>} edges
   * @returns {Wall[]|Set<Wall>}
   */
  filterWalls(walls) { return walls.filter(w => this.containsWall(w)); }

  /**
   * Find tiles in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * @return {Set<Tile>}
   */
  findTiles() {
    const collisionTest = o => this.containsTile(o.t);
    return canvas.tiles.quadtree.getObjects(this.bounds2d, { collisionTest });
  }

  /**
   * Same as findTiles but filters based on an existing set.
   * @param {Tile[]|Set<Tile>} edges
   * @returns {Tile[]|Set<Tile>}
   */
  filterTiles(tiles) { return tiles.filter(t => this.containsTile(t)); }

  /**
   * Filter tokens in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * @return {Set<Token>}
   */
  findTokens() {
    const collisionTest = o => this.containsToken(o.t);
    return canvas.tokens.quadtree.getObjects(this.bounds2d, { collisionTest });
  }

  /**
   * Same as findTokens but filters based on an existing set.
   * @param {Token[]|Set<Token>} tokens
   * @returns {Token[]|Set<Token>}
   */
  filterTokens(tokens) { return tokens.filter(t => this.containsToken(t)); }

  /**
   * Filter regions in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * @return {Set<Region>}
   */
  findRegions() {
    // Currently no quadtree for regions. TODO: Make one?
    return new Set(canvas.regions.placeables.filter(r => this.containsRegion(r)));
  }

  /**
   * Same as findRegions but filters based on an existing set.
   * @param {Region[]|Set<Region>} regions
   * @returns {Region[]|Set<Region>}
   */
  filterRegions(regions) { return regions.filter(t => this.containsRegion(t)); }

  draw2d(opts) {
    for ( const face of this.iterateFaces() ) face.draw2d(opts);
  }
}

/* Testing

pt3d_0 = new Point3d();
pt3d_1 = new Point3d();
pt3d_2 = new Point3d();
pt3d_3 = new Point3d();
ptOnes = Object.freeze(new Point3d(1, 1, 1));

function segmentIntersectsBounds(a, b, aabb) {
    // See https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/
    const { min, max } = aabb;
    const rayOrigin = a;
    const rayDirection = b.subtract(a, pt3d_0);
    const invDirection = ptOnes.divide(rayDirection, pt3d_3);
    const t1 = pt3d_1;
    const t2 = pt3d_2;

    min.subtract(rayOrigin, t1).multiply(invDirection, t1);
    max.subtract(rayOrigin, t2).multiply(invDirection, t2);
    const xMinMax = Math.minMax(t1.x, t2.x);
    const yMinMax = Math.minMax(t1.y, t2.y);
    const zMinMax = Math.minMax(t1.z, t2.z);
    const tmax = Math.min(xMinMax.max, yMinMax.max, zMinMax.max);
    if ( tmax <= 0 ) return false;

    const tmin = Math.max(xMinMax.min, yMinMax.min, zMinMax.min);
    return tmax >= tmin && (tmin * tmin) < rayDirection.dot(rayDirection);
    // return tmax > 0 && tmax >= tmin && (tmin * tmin) < rayT2;
  }

aabb = { min: new Point3d(0, 0, 0), max: new Point3d(100, 200, 300) }

a = new Point3d(-10, -10, 10)
b = new Point3d(10, 10, 20)

a = new Point3d(10, 10, 20)
b = new Point3d(20, 30, 30)

a = new Point3d(-10, -20, -30)
b = new Point3d(-20, -20, -20)

segmentIntersectsBounds(a, b, aabb)

*/