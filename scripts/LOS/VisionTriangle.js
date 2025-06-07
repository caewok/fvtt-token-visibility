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
import { Ellipse } from "../geometry/Ellipse.js";

/**
 * The viewable area between viewer and target.
 * TODO: Could make this a pyramid, containing four Triangle3d with a rectangle3d base.
 *
 */
export class VisionTriangle {

  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  b = new PIXI.Point();

  /** @type {PIXI.Point} */
  c = new PIXI.Point();

  /** @type {VPElevation} */
  elevationZ = {
    min: Number.NEGATIVE_INFINITY,
    max: Number.POSITIVE_INFINITY
  };

  /** @type {PIXI.Rectangle} */
  bounds = new PIXI.Rectangle;

  constructor(a, b, c, elevationZ = { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY }) {
    if ( a ) this.a.copyFrom(a);
    if ( b ) this.b.copyFrom(b);
    if ( c ) this.c.copyFrom(c);
    this.elevationZ.min = elevationZ.min;
    this.elevationZ.max = elevationZ.max;
    this.setBounds();
  }

  setBounds() {
    const { a, b, c } = this;
    const xMinMax = Math.minMax(a.x, b.x, c.x);
    const yMinMax = Math.minMax(a.y, b.y, c.y);
    this.bounds.x = xMinMax.min;
    this.bounds.y = yMinMax.min;
    this.bounds.width = xMinMax.max - xMinMax.min;
    this.bounds.height = yMinMax.max - yMinMax.min;
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
    const res = this.computeTriangle(viewpoint, target, targetBorder)
    return new this(res.a, res.b, res.c, res.elevationZ);
  }

  static computeTriangle(viewpoint, target, targetBorder) {
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

    const elevationZ = this.elevationZMinMax(viewpoint, target);
    return { a: viewpoint, b, c, elevationZ };
  }

  rebuild(viewpoint, target, targetBorder) {
    const res = this.constructor.computeTriangle(viewpoint, target, targetBorder);
    this.a.copyFrom(res.a);
    this.b.copyFrom(res.b);
    this.c.copyFrom(res.c);
    this.elevationZ.min = res.elevationZ.min;
    this.elevationZ.max = res.elevationZ.max;
    this.setBounds();
    return this; // For convenience.
  }

  static elevationZMinMax(viewpoint, target) {
    const vBottomZ = viewpoint.z ?? Number.NEGATIVE_INFINITY;
    const vTopZ = viewpoint.z ?? Number.POSITIVE_INFINITY;
    const tBottomZ = target.bottomZ ?? Number.NEGATIVE_INFINITY;
    const tTopZ = target.topZ ?? Number.POSITIVE_INFINITY;
    return Math.minMax(vBottomZ, vTopZ, tBottomZ, tTopZ);
  }

  /**
   * Determine the minimum and maximum elevations for a given viewpoint and target.
   * @param {Point3d} viewpoint
   * @param {Token} target
   * @returns {number} Elevation in pixel units
   */
  static elevationZMin(viewpoint, target) {
    return Math.min(
      viewpoint?.z ?? Number.NEGATIVE_INFINITY,
      target?.bottomZ ?? Number.NEGATIVE_INFINITY
    );
  }

  static elevationZMax(viewpoint, target) {
    return Math.max(
      viewpoint?.z ?? Number.POSITIVE_INFINITY,
      target?.topZ ?? Number.POSITIVE_INFINITY
    );
  }

  /**
   * Test if a point is inside the triangle in 2d.
   * @param {Point} p
   * @returns {boolean}
   */
  pointInsideTriangle(p) {
    const orient2d = foundry.utils.orient2dFast;

    // All orientations must be the same sign or 0.
    const oAB = orient2d(this.a, this.b, p);
    const oBC = orient2d(this.b, this.c, p);
    return (oAB * oBC >= 0) && (oAB * orient2d(this.c, this.a, p) >= 0);
  }

  pointInsideInfiniteTriangle(p) {
    const orient2d = foundry.utils.orient2dFast;

    // All orientations must be the same sign or 0.
    const oAB = orient2d(this.a, this.b, p);
    const oCA = orient2d(this.c, this.a, p);
    return (oAB * oCA >= 0)
  }

  draw({ draw, ...opts } = {}) {
    draw ??= new CONFIG.GeometryLib.Draw;
    draw.shape(new PIXI.Polygon(this.a, this.b, this.c), opts)
  }

  containsEdge(edge) {
    // Ignore one-directional walls facing away from the viewpoint.
    if ( edge.direction
      && (edge.orientPoint(this.a) === edge.direction) ) return false;

    // Is the wall within the elevation box?
    let { top, bottom } = edge.elevationLibGeometry.a;
    top ??= 1e06;
    bottom ??= -1e06;
    top = CONFIG.GeometryLib.utils.gridUnitsToPixels(top);
    bottom = CONFIG.GeometryLib.utils.gridUnitsToPixels(bottom);

    if ( top <= this.elevationZ.min || bottom >= this.elevationZ.max ) return false;

    // Ignore walls not within the elevation vision rectangle.
    const { a, b } = edge;
    if ( this.pointInsideTriangle(a) || this.pointInsideTriangle(b) ) return true;

    // Does the wall intersect the triangle?
    // Don't really care about the back of the vision triangle? (b|c)
    // Wall would cut through token, end inside triangle.
    const lsi = foundry.utils.lineSegmentIntersects;
    return ( lsi(this.a, this.b, a, b) || lsi(this.a, this.c, a, b) );
  }

  containsWall(wall) { return this.containsEdge(wall.edge); }

  wallInBackground(wall) { return this.edgeInBackground(wall.edge); }

  infinitePoints() {
    const dist2 = Math.pow(canvas.dimensions.maxR, 2);
    const b = this.a.towardsPointSquared(this.b, dist2);
    const c = this.a.towardsPointSquared(this.c, dist2);
    return { b, c };
  }

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

  containsTile(tile) {
    // If the elevations don't change, the tile cannot be an obstacle.
    if ( this.elevationZ.min === this.elevationZ.max ) return false;

    // Only overhead tiles count for blocking vision
    if ( tile.elevationE < tile.document.parent?.foregroundElevation ) return false;

    // Ignore tiles that are not within the elevation vision rectangle.
    const tileZ = tile.elevationZ
    if ( tileZ <= this.elevationZ.min || tileZ >= this.elevationZ.max ) return false;

    // Use the alpha bounding box. This might be a polygon if the tile is rotated.
    const alphaThreshold = CONFIG[MODULE_ID].alphaThreshold;
    const tBounds = tile.evPixelCache.getThresholdCanvasBoundingBox(alphaThreshold);
    const tCenter = tBounds.center;
    if ( this.pointInsideTriangle(tCenter) ) return true;
    return tBounds.lineSegmentIntersects(this.a, this.b, { inside: true })
      || tBounds.lineSegmentIntersects(this.a, this.c, { inside: true });
  }

  containsToken(token) {
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
    const { topZ, bottomZ } = regionElevation(region);
    if ( topZ < this.elevationZ.min || bottomZ > this.elevationZ.max ) return false;

    // For each region shape, use the ideal version to test b/c circles and ellipses can be tested faster than polys.
    // Ignore holes (some shape with holes may get included but rather be over-inclusive here)
    // Yes or no, regardless of how many shapes of a region are in the vision triangle.
    for ( const shape of region.shapes ) {
      const pixi = convertRegionShapeToPIXI(shape);
      if ( pixi.lineSegmentIntersects(this.a, this.b, { inside: true })
        || pixi.lineSegmentIntersects(this.a, this.c, { inside: true }) ) return true;
    }
    return false;
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
    return canvas.edges.quadtree.getObjects(this.bounds, { collisionTest });
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
    return canvas.walls.quadtree.getObjects(this.bounds, { collisionTest });
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
    return canvas.tiles.quadtree.getObjects(this.bounds, { collisionTest });
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
    return canvas.tokens.quadtree.getObjects(this.bounds, { collisionTest });
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