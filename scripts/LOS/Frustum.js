/* globals
canvas,
CONFIG,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { regionElevation, convertRegionShapeToPIXI } from "./util.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Triangle3d, Quad3d } from "../geometry/3d/Polygon3d.js";
import { AABB3d } from "../geometry/AABB.js";
import { AbstractPolygonTrianglesID } from "./PlaceableTriangles.js";

// Temporary points
const pt3d_0 = new Point3d();
const pt3d_1 = new Point3d();
const pt3d_2 = new Point3d();
const pt3d_3 = new Point3d();
const ptOnes = Object.freeze(new Point3d(1, 1, 1));

// Bounding box axes (normals of the aabb faces)
const aabbAxes = [new Point3d(1, 0, 0), new Point3d(0, 1, 0), new Point3d(0, 0, 1)];

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

  /**
   * @param {Point3d} viewpoint
   * @param {PIXI.Point|Point3d} b
   * @param {PIXI.Point|Point3d} c
   * @param {number} minZ
   * @param {number} maxZ
   */
  constructor(viewpoint, b, c, minZ = Number.NEGATIVE_INFINITY, maxZ = Number.POSITIVE_INFINITY) {
    if ( viewpoint ) this._rebuild(viewpoint, b, c, minZ, maxZ);
  }

  setAABB() {
    const viewpoint = this.viewpoint;
    const xMinMax = Math.minMax(this.floor.a.x, this.floor.b.x, this.floor.c.x, this.floor.d.x, viewpoint.x);
    const yMinMax = Math.minMax(this.floor.a.y, this.floor.b.y, this.floor.c.y, this.floor.d.y, viewpoint.y);
    const zMinMax = Math.minMax(viewpoint.z, this.top.b.z, this.bottom.b.z);
    this.aabb.min.set(xMinMax.min, yMinMax.min, zMinMax.min);
    this.aabb.max.set(xMinMax.max, yMinMax.max, zMinMax.max);

    this.bounds2d.x = xMinMax.min;
    this.bounds2d.y = yMinMax.min;
    this.bounds2d.width = xMinMax.max - xMinMax.min;
    this.bounds2d.height = yMinMax.max - yMinMax.min;
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
   * @returns {Frustum}
   */
  static buildFromTarget(viewpoint, target, targetBorder) {
    const border2d = targetBorder ?? (CONFIG[MODULE_ID].constrainTokens ? target.constrainedTokenBorder : target.tokenBorder);
    return this.build(viewpoint, border2d, target.topZ, target.bottomZ);
  }

  static rebuildFromTarget(viewpoint, target, targetBorder) {
    const border2d = targetBorder ?? (CONFIG[MODULE_ID].constrainTokens ? target.constrainedTokenBorder : target.tokenBorder);
    return this.rebuild(viewpoint, border2d, target.topZ, target.bottomZ);
  }

  /**
   * @param {PIXI.Point|Point3d} viewpoint
   * @param {PIXI.Polygon|PIXI.Rectangle} border2d
   * @param {number} [topZ=0]
   * @param {number} [bottomZ=topZ]
   * @returns {Frustum}
   */
  static build(viewpoint, border2d, topZ = 0, bottomZ = topZ) {
    const { b, c } = this.computeTriangle(viewpoint, border2d);
    const elevationZ = this.elevationZMinMax(viewpoint, topZ, bottomZ);
    return new this(viewpoint, b, c, elevationZ.min, elevationZ.max);
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
        const perpDir = pt3d_1.set(-dir.y, dir.x);
        const perpPt = center.add(perpDir, perpDir); // Project along the perpDir.
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

  rebuild({ viewpoint, border2d, topZ, bottomZ } = {}) {
    viewpoint ??= this.viewpoint;
    topZ ??= this.top.b.z;
    bottomZ ??= this.bottom.b.z;
    let b;
    let c;
    if ( border2d ) {
      const res = this.computeTriangle(viewpoint, border2d, topZ, bottomZ)
      b = res.b;
      c = res.c;
    } else {
      b = this.top.b.to2d();
      c = this.top.c.to2d();
    }
    this._rebuild(viewpoint, b, c, topZ, bottomZ);
    return this;
  }

  _rebuild(viewpoint, b, c, topZ = 0, bottomZ = topZ) {
    if ( foundry.utils.orient2dFast(viewpoint, c, b) < 0 ) [b, c] = [c, b]; // Force view --> b --> c to be CW
    const elevationZ = this.elevationZMinMax(viewpoint, topZ, bottomZ);

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
  pointWithinFrustum(p, testBottom = true) {
    if ( !this.pointWithinBounds(p) ) return false;
    for ( const face of this.iterateFaces(testBottom) ) {
      if ( face.isFacing(p) ) return false;
    }
    return true;
  }

  /**
   * Test if a point is contained within aabb bounds of the frustrum.
   * Does not test whether p is in fact inside the frustum.
   * @param {Point3d} p
   * @returns {boolean}
   */
  pointWithinBounds(p) {
    const { min, max } = this.aabb;
    return p.x.between(min.x, max.x) && p.y.between(min.y, max.y) && p.z.between(min.z, max.z);
  }

  /**
   * Does the segment cross the frustum or contained within?
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {boolean}
   */
  segmentOverlapsFrustum(a, b) {
    if ( !this.segmentWithinBounds(a, b) ) return false; // TODO: Is it faster without this?

    // Instead of calling pointWithinFrustum, test along the way to avoid iterating twice.
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
   * Does the segment cross the aabb bounds or is contained within?
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {boolean}
   */
  segmentOverlapsBounds(a, b) {
    // See https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/
    const { min, max } = this.aabb;
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
  }

  /**
   * Test if a sphere is contained within the bounds.
   * @param {Point3d} center
   * @param {number} radius
   * @returns {boolean}
   */
  sphereWithinBounds(center, radius) {
    if ( this.pointWithinBounds(center) ) return true;

    // https://stackoverflow.com/questions/28343716/sphere-intersection-test-of-aabb
    const { min, max } = this.aabb;
    let dmin = 0;
    for ( const axis of ["x", "y", "z"] ) {
      const c = center[axis];
      if ( c < min[axis] ) dmin += Math.pow(c - min[axis], 2);
      else if ( c > max[axis] ) dmin += Math.pow(c - max[axis], 2);
    }
    return dmin <= (radius * radius);
  }

  sphereWithinFrustum(center, radius) {
    if ( !this.sphereWithinBounds(center, radius) ) return false;
    if ( this.pointWithFrustum(center) ) return true;
    for ( const face of this.iterateFaces() ) {
      // TODO: Complete
    }

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

  convexPolygon3dWithinBounds(poly3d) {
    // Test points and then skip to testing full bounds.
    // TODO: Worth testing segmentOverlapsBounds?
    for ( const pt of poly3d.iteratePoints({ close: false }) ) {
      if ( this.pointWithinBounds(pt) ) return true;
    }
    return this.convexPolygon3dOverlapsBounds(poly3d);
  }


  *iterateAABBVertices() {
    const { min, max } = this.aabb;
    yield min;
    yield max;
    yield pt3d_3.set(max.x, min.y, min.z);
    yield pt3d_3.set(min.x, max.y, min.z);
    yield pt3d_3.set(min.x, min.y, max.z);
    yield pt3d_3.set(max.x, max.y, min.z);
    yield pt3d_3.set(max.x, min.y, max.z);
    yield pt3d_3.set(min.x, max.x, max.z);
  }


  /**
   * Test if an edge, representing a 2d rectangle, intersects the 3d bounding box.
   */
  // tri3dIntersectsBoundingBox(tri3d) { return this.convexPolygon3dOverlapsBounds(quad3d); }

  // quad3dIntersectsBoundingBox(quad3d) { return this.convexPolygon3dOverlapsBounds(quad3d); }

  convexPolygon3dOverlapsBounds(poly3d) {
    const axes = [...aabbAxes, poly3d.plane.normal]; // Plane N is already normalized.

    // Iterate through each polygon edge.
    const EPSILON = 1e-08;
    const iter = poly3d.iteratePoints({ close: true });
    let a = iter.next().value;
    for ( const b of iter ) {
      const edgeDir = b.subtract(a, pt3d_0);

      // Only consider non-zero edge directions.
      if ( edgeDir.magnitude > EPSILON ) {
        edgeDir.normalize(edgeDir);
        for ( const aabbDir of aabbAxes ) {
          const crossAxis = aabbDir.cross(edgeDir);
          if ( crossAxis.magnitude() > EPSILON ) axes.push(crossAxis.normalize());
        }
      }
      a = b;
    }

    // SAT Test: Iterate through all collected axes and check for separation
    const polyVertices = [...poly3d];
    const aabbVertices = [...this.iterateAABBVertices()];
    for ( const axis of axes ) {
      // Project all vertices of both shapes onto the current axis
      const rectProjections = polyVertices.map(v => v.dot(axis));
      const aabbProjections = aabbVertices.map(v => v.dot(axis));

      // Find the minimum and maximum projected values for both shapes
      const rectMin = Math.min(...rectProjections);
      const rectMax = Math.max(...rectProjections);
      const aabbMin = Math.min(...aabbProjections);
      const aabbMax = Math.max(...aabbProjections);

      // Check for overlap on this axis
      // If the maximum projection of one shape is less than the minimum projection of the other,
      // or vice-versa, then there is a gap, and a separating axis has been found.
      if (rectMax < aabbMin || aabbMax < rectMin) return false; // Separating axis found, no intersection
    }
    return true; // No separating axis; must be intersecting.
  }



  infinitePoints() {
    const dist2 = Math.pow(canvas.dimensions.maxR, 2);
    const b = this.a.towardsPointSquared(this.b, dist2);
    const c = this.a.towardsPointSquared(this.c, dist2);
    return { b, c };
  }



  wallInBackground(wall) { return this.edgeInBackground(wall.edge); }


  edgeInBackground(edge) {
    // Either it is a foreground wall or a background wall.
    if ( this.containsEdge(edge) ) return false;

    // Use an infinite triangle.
    if ( this.pointInsideInfiniteTriangle(edge.a)
      || this.pointInsideInfiniteTriangle(edge.b) ) return true;

    const { b, c } = this.infinitePoints();
    const lsi = foundry.utils.lineSegmentIntersects;
    return ( lsi(this.a, b, edge.a, edge.b) || lsi(this.a, c, edge.a, edge.b) );
  }

  tileInBackground(tile) {
    // Only overhead tiles count for blocking vision
    if ( tile.elevationE < tile.document.parent?.foregroundElevation ) return false;

    // Either it is a foreground tile or a background tile.
    if ( this.containsTile(tile) ) return false;

    // Use an infinite triangle.
    const alphaThreshold = CONFIG[MODULE_ID].alphaThreshold;
    const tBounds = tile.evPixelCache.getThresholdCanvasBoundingBox(alphaThreshold);
    const { b, c } = this.infinitePoints();
    return tBounds.lineSegmentIntersects(this.a, b, { inside: true })
      || tBounds.lineSegmentIntersects(this.a, c, { inside: true });
  }

  regionInBackground(region) {
    // Either it is a foreground region or a background region.
    if ( this.containsRegion(region) ) return false;

    // Use an infinite triangle.
    const { b, c } = this.infinitePoints();
    for ( const shape of region.shapes ) {
      const pixi = convertRegionShapeToPIXI(shape);
      if ( pixi.lineSegmentIntersects(this.a, b, { inside: true })
        || pixi.lineSegmentIntersects(this.a, c, { inside: true }) ) return true;
    }
    return false;
  }

  containsEdge(edge) {
    // Ignore one-directional walls facing away from the viewpoint.
    if ( edge.direction
      && (edge.orientPoint(this.viewpoint) === edge.direction) ) return false;

    const quad3d = edge.object?.[MODULE_ID][AbstractPolygonTrianglesID].quad3d
    if ( !quad3d ) {
      console.warn(`${this.constructor.name}|containsEdge|${edge.id} does not have a quad object.`, edge);
      return false;
    }
    return this.convexPolygon3dOverlapsBounds(edge.object[MODULE_ID][AbstractPolygonTrianglesID].quad3d);
  }

  containsWall(wall) { return this.containsEdge(wall.edge); }

  containsTile(tile) {
    // If the elevations don't change, the tile cannot be an obstacle.
    if ( this.elevationZ.min === this.elevationZ.max ) return false;

    // Only overhead tiles count for blocking vision
    if ( tile.elevationE < tile.document.parent?.foregroundElevation ) return false;

    let quad3d;
    if ( CONFIG[MODULE_ID].alphaThreshold ) {
      quad3d = tile[MODULE_ID]?.[AbstractPolygonTrianglesID]?.alphaQuad3d;
    }
    quad3d ??= tile[MODULE_ID]?.[AbstractPolygonTrianglesID]?.quad3d;
    if ( !quad3d ) return false;
    return this.convexPolygon3dOverlapsBounds(quad3d);
  }

  containsToken(token) {
    // Use the token sphere.

    // Ignore tokens not within the elevation vision rectangle.
    if ( token.topZ < this.elevationZ.min || token.bottomZ > this.elevationZ.max ) return false;

    // Even for constrained tokens, the token center should remain within the token border.
    const tCenter = token.center;
    if ( this.pointInsideTriangle(tCenter) ) return true;

    // Full test of token border.
    const tBounds = token.constrainedTokenBorder;
    return tBounds.lineSegmentIntersects(this.a, this.b, { inside: true })
      || tBounds.lineSegmentIntersects(this.a, this.c, { inside: true });
  }

  containsRegion(region) {
    // Ignore regions not within the vision rectangle elevation.
    if ( this.outsideRegionElevation(region) ) return false;

    // For each region shape, use the ideal version to test b/c circles and ellipses can be tested faster than polys.
    // Ignore holes (some shape with holes may get included but rather be over-inclusive here)
    // Yes or no, regardless of how many shapes of a region are in the vision triangle.
    for ( const shape of region.shapes ) {
      if ( this.containsRegionShape(shape) ) return true;
    }
    return false;
  }

  outsideRegionElevation(region) {
    const { topZ, bottomZ } = regionElevation(region);
    return ( topZ < this.elevationZ.min && bottomZ > this.elevationZ.max );
  }


  // Does not test elevation.
  containsRegionShape(regionShape) {
    const pixi = convertRegionShapeToPIXI(regionShape);
    return ( pixi.lineSegmentIntersects(this.a, this.b, { inside: true })
        || pixi.lineSegmentIntersects(this.a, this.c, { inside: true }) );
  }

  /**
   * Boundary rectangle that extends from the viewpoint beyond the edge of the canvas.
   * @returns {PIXI.Rectangle}
   */
  backgroundBounds() {
    const a = this.a;
    const { b, c } = this.infinitePoints();
    const xMinMax = Math.minMax(a.x, b.x, c.x);
    const yMinMax = Math.minMax(a.y, b.y, c.y);
    return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
  }

  /**
   * Using quadtree, locate all the edges within the background triangle.
   * @returns {PIXI.Rectangle}
   */
  findBackgroundEdges() {
    const collisionTest = o => this.edgeInBackground(o.t);
    return canvas.edges.quadtree.getObjects(this.backgroundBounds(), { collisionTest });
  }

  findBackgroundWalls() {
    const collisionTest = o => this.wallInBackground(o.t);
    return canvas.walls.quadtree.getObjects(this.backgroundBounds(), { collisionTest });
  }

  findBackgroundTiles() {
    const collisionTest = o => this.tileInBackground(o.t);
    return canvas.tiles.quadtree.getObjects(this.backgroundBounds(), { collisionTest });
  }

  findBackgroundRegions() {
    return new Set(canvas.regions.placeables.filter(r => this.regionInBackground(r)));
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