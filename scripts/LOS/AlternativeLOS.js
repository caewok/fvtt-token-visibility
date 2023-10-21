/* globals
canvas,
ClipperLib.
CONFIG,
CONST,
foundry,
PIXI,
PointSourcePolygon,
Ray
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULES_ACTIVE, MODULE_ID, FLAGS } from "../const.js";
import { lineIntersectionQuadrilateral3d, buildTokenPoints, lineSegmentIntersectsQuadrilateral3d } from "../util.js";

// Geometry folder
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";

/**
 * Base class to estimate line-of-sight between a source and a token using different methods.
 */
export class AlternativeLOS {

  /**
   * An object that has x, y, and elevationZ or z properties.
   * The line-of-sight is calculated from this point.
   * @type {object}
   */
  viewerPoint = new Point3d();

  /**
   * A token that is being tested for whether it is "viewable" from the point of view of the viewer.
   * Typically viewable by a light ray but could be other rays (such as whether an arrow could hit it).
   * Typically based on sight but could be other physical characteristics.
   * @type {Token}
   */
  target;

  /**
   * @typedef AlternativeLOSConfig  Configuration settings for this class.
   * @type {object}
   * @property {CONST.WALL_RESTRICTION_TYPES} type    Type of source (light, sight, etc.)
   * @property {boolean} wallsBlock                   Can walls block in this test?
   * @property {boolean} tilesBlock                   Can tiles block in this test?
   * @property {boolean} deadTokensBlock              Can dead tokens block in this test?
   * @property {boolean} liveTokensBlock              Can live tokens block in this test?
   * @property {boolean} proneTokensBlock             Can prone tokens block in this test?
   * @property {boolean} debug                        Enable debug visualizations.
   */
  config = {};

  /**
   * @param {Point3d|Token|VisionSource} viewer   Point or object with z, y, z|elevationZ properties
   * @param {Token} target
   * @param {AlternativeLOSConfig} config
   */
  constructor(viewer, target, config) {
    if ( viewer instanceof VisionSource ) viewer = viewer.object;
    if ( viewer instanceof Token ) viewer = Point3d.fromTokenCenter(viewer);

    this.viewerPoint.x = viewer.x;
    this.viewerPoint.y = viewer.y;
    this.viewerPoint.z = viewer.elevationZ ?? viewer.z ?? 0;
    this.target = target;
    this.#configure(config);
  }

  /**
   * Configure the constructor.
   * @param {object} config   Properties intended to override defaults.
   */
  #configure(config = {}) {
    const cfg = this.config;
    cfg.type = config.type ?? "sight";
    cfg.wallsBlock = config.wallsBlock || true;
    cfg.tilesBlock = config.tilesBlock || MODULES_ACTIVE.LEVELS || MODULES_ACTIVE.EV;
    cfg.deadTokensBlock = config.deadTokensBlock || false;
    cfg.liveTokensBlock = config.liveTokensBlock || false;
    cfg.proneTokensBlock = config.proneTokensBlock || true;
    cfg.debug = config.debug || false;
  }

  // ------ NOTE: Primary methods to be overridden by subclass -----

  /**
   * Determine whether a viewer has line-of-sight to a target based on meeting a threshold.
   * @param {number} [threshold]    Percentage to be met to be considered visible
   * @returns {boolean}
   */
  hasLOS(threshold) {
    const percentVisible = this.percentVisible();
    if ( percentVisible.almostEqual(0) ) return false;
    return this.percentVisible > threshold || percentVisible.almostEqual(threshold);
  }

  /**
   * Determine percentage of the token visible using the class methodology.
   * @returns {number}
   */
  percentVisible() {
    console.error("AlternativeLOS.prototype.percentVisible must be defined by the subclass.");
  }

  // ----- NOTE: Collision tests ----- //

  /**
   * Does the ray between two points collide with an object?
   * @param {Point3d} startPt      Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if an object blocks this ray
   */
  _hasCollision(startPt, endPt) {
    return this._hasWallCollision(startPt, endPt)
      || this._hasTileCollision(startPt, endPt)
      || this._hasTokenCollision(startPt, endPt);
  }

  /**
   * Does the ray between two points collide with a wall?
   * @param {Point3d} startPt      Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if a wall blocks this ray
   */
  _hasWallCollision(startPt, endPt) {
    if ( !this.config.wallsBlock ) return false;
    const mode = "any";
    const type = this.config.type;
    return PointSourcePolygon.testCollision3d(startPt, endPt, { mode, type });
  }

  /**
   * Does the ray between two points collide with a tile?
   * @param {Point3d} startPt       Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if a tile blocks this ray
   */
  _hasTileCollision(startPt, endPt) {
    if ( !this.config.tilesBlock ) return false;
    const ray = new Ray(startPt, endPt);

    // Ignore non-overhead tiles
    const collisionTest = (o, _rect) => o.t.document.overhead;
    const tiles = canvas.tiles.quadtree.getObjects(ray.bounds, { collisionTest });

    // Because tiles are parallel to the XY plane, we need not test ones obviously above or below.
    const maxE = Math.max(startPt.z, endPt.z);
    const minE = Math.min(startPt.z, endPt.z);

    // Precalculate
    const rayVector = endPt.subtract(startPt);
    const zeroMin = 1e-08;
    const oneMax = 1 + 1e-08;

    for ( const tile of tiles ) {
      if ( this.config.type === "light" && tile.document.flags?.levels?.noCollision ) continue;

      const { x, y, width, height, elevation } = tile.document;
      const elevationZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation);

      if ( elevationZ < minE || elevationZ > maxE ) continue;

      const r0 = new Point3d(x, y, elevationZ);
      const r1 = new Point3d(x + width, y, elevationZ);
      const r2 = new Point3d(x + width, y + height, elevationZ);
      const r3 = new Point3d(x, y + height, elevationZ);

      // Need to test the tile intersection point for transparency (Levels holes).
      // Otherwise, could just use lineSegmentIntersectsQuadrilateral3d
      const t = lineIntersectionQuadrilateral3d(startPt, rayVector, r0, r1, r2, r3);
      if ( t === null || t < zeroMin || t > oneMax ) continue;
      const ix = new Point3d();
      startPt.add(rayVector.multiplyScalar(t, ix), ix);
      if ( !tile.containsPixel(ix.x, ix.y, 0.99) ) continue; // Transparent, so no collision.

      return true;
    }
    return false;
  }

  /**
   * Does the ray between two points collide with a token?
   * @param {Point3d} startPt       Starting point of this ray
   * @param {Point3d} endPt         End point of this ray
   * @returns {boolean} True if a token blocks this ray
   */
  _hasTokenCollision(startPt, endPt) {
    const { liveTokensBlock, deadTokensBlock } = this.config;
    if ( !(liveTokensBlock || deadTokensBlock) ) return false;

    const ray = new Ray(startPt, endPt);
    let tokens = canvas.tokens.quadtree.getObjects(ray.bounds);

    // Filter out the viewer and target token
    this._filterTokensForCollisionTesting(tokens);

    // Build full- or half-height startPts3d from tokens
    const tokenPts = buildTokenPoints(tokens, this.config);

    // Set viewing position and test token sides for collisions
    for ( const pts of tokenPts ) {
      const sides = pts._viewableFaces(startPt);
      for ( const side of sides ) {
        if ( lineSegmentIntersectsQuadrilateral3d(startPt, endPt,
          side.points[0],
          side.points[1],
          side.points[2],
          side.points[3]) ) return true;
      }
    }
    return false;
  }

  /**
   * Filter out tokens from potential collision testing.
   * @param {Set<Token>} tokens      Array of tokens to be tested for collisions
   */
  _filterTokensForCollisionTesting(tokens) {
    tokens.delete(this.target);
  }

  /**
   * Vision Polygon for the view point --> target.
   * From the given token location, get the edge-most viewable points of the target.
   * Construct a triangle between the two target points and the token center.
   * If viewing head-on (only two key points), the portion of the target between
   * viewer and target center (typically, a rectangle) is added on to the triangle.
   * @param {PIXI.Point|Point3d} viewingPoint
   * @param {Token} target
   * @returns {PIXI.Polygon} Triangle between view point and target. Will be clockwise.
   */
  static visionPolygon(viewingPoint, target) {
    const border = target.constrainedTokenBorder;
    const keyPoints = border.viewablePoints(viewingPoint, { outermostOnly: false });
    if ( !keyPoints ) return border.toPolygon();

    let out;
    switch ( keyPoints.length ) {
      case 0:
      case 1:
        out = border.toPolygon();
        break;
      case 2: {
        const k0 = keyPoints[0];
        const k1 = keyPoints[1];
        const center = target.center;

        // Build a rectangle between center and key points.
        // Intersect against the border
        const X = Math.minMax(k0.x, k1.x, center.x);
        const Y = Math.minMax(k0.y, k1.y, center.y);
        const rect = new PIXI.Rectangle(X.min, Y.min, X.max - X.min, Y.max - Y.min);
        const intersect = border instanceof PIXI.Rectangle ? rect : rect.intersectPolygon(border);

        // Union the triangle with this border
        const triangle = new PIXI.Polygon([viewingPoint, k0, k1]);

        // WA requires a polygon with a positive orientation.
        if ( !triangle.isPositive ) triangle.reverseOrientation();
        out = intersect.intersectPolygon(triangle, { clipType: ClipperLib.ClipType.ctUnion });
        break;
      }
      default:
        out = new PIXI.Polygon([viewingPoint, keyPoints[0], keyPoints[keyPoints.length - 1]]);
    }

    if ( !out.isClockwise ) out.reverseOrientation();
    return out;
  }

  /**
   * @typedef {object} VisionPolygonFilterConfig
   * @property {CONST.WALL_RESTRICTION_TYPES} type  Used to filter walls.
   * @property {boolean} filterWalls                If true, find and filter walls
   * @property {boolean} filterTokens               If true, find and filter tokens
   * @property {boolean} filterTiles                If true, find and filter tiles
   * @property {Token} viewer                       Viewer token to exclude from filtered token results
   */

  /**
   * Filter relevant objects in the scene using the vision triangle.
   * For the z dimension, keeps objects that are between the lowest target point,
   * highest target point, and the viewing point.
   * @param {Point3d} viewingPoint    The 3d location of the "viewer" (vision/light source)
   * @param {Token} target            The token being "viewed".
   * @param {VisionPolygonFilterConfig} [opts]     Options that affect what is filtered.
   */
  static filterSceneObjectsByVisionPolygon(viewingPoint, target, {
    visionPolygon,
    type = "sight",
    filterWalls = true,
    filterTokens = true,
    filterTiles = true,
    debug = false,
    viewer } = {}) {

    visionPolygon ??= this.visionPolygon(viewingPoint, target);
    if ( debug ) Draw.shape(visionPolygon,
      { color: Draw.COLORS.blue, fillAlpha: 0.2, fill: Draw.COLORS.blue });

    const { topZ, bottomZ } = target;
    const maxE = Math.max(viewingPoint.z ?? 0, topZ);
    const minE = Math.min(viewingPoint.z ?? 0, bottomZ);

    const out = { walls: new Set(), tokens: new Set(), tiles: new Set(), drawings: new Set() };
    if ( filterWalls ) {
      out.walls = this
        .filterWallsByVisionPolygon(viewingPoint, visionPolygon, { type })
        .filter(w => (w.topZ > minE) && (w.bottomZ < maxE)); // Filter walls too low or too high.
      if ( debug ) out.walls.forEach(w => Draw.segment(w, { color: Draw.COLORS.gray, alpha: 0.2 }));
    }

    if ( filterTokens ) {
      out.tokens = this
        .filterTokensByVisionPolygon(visionPolygon, { viewer, target })
        .filter(t => (t.topZ > minE) && (t.bottomZ < maxE)); // Filter tokens too low or too high.
      if ( debug ) out.tokens.forEach(t => Draw.shape(t.bounds, { color: Draw.COLORS.gray }));
    }

    if ( filterTiles ) {
      out.tiles = this.filterTilesByVisionPolygon(visionPolygon);

      // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
      if ( MODULES_ACTIVE.LEVELS && type === "sight" ) {
        out.tiles = out.tiles.filter(t => !t.document?.flags?.levels?.noCollision);
      }

      // Filter tiles that are definitely too low or too high
      out.tiles = out.tiles.filter(t => {
        const tZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(t.document.elevation);
        return (tZ < maxE) && (tZ > minE);
      });

      // Check drawings if there are tiles
      if ( out.tiles.size ) out.drawings = this.filterDrawingsByVisionPolygon(visionPolygon);

      if ( debug ) {
        out.tiles.forEach(t => Draw.shape(t.bounds, { color: Draw.COLORS.gray }));
        out.drawings.forEach(d => Draw.shape(d.bounds, { color: Draw.COLORS.gray }));
      }
    }

    return out;
  }

  /**
   * Filter drawings in the scene if they are flagged as holes.
   * @param {PIXI.Polygon} visionPolygon
   */
  static filterDrawingsByVisionPolygon(visionPolygon) {
    let drawings = canvas.drawings.quadtree.getObjects(visionPolygon.getBounds());

    // Filter by holes
    drawings = drawings.filter(d => d.document.getFlag(MODULE_ID, FLAGS.DRAWING.IS_HOLE)
      && ( d.document.shape.type === CONST.DRAWING_TYPES.POLYGON
      || d.document.shape.type === CONST.DRAWING_TYPES.ELLIPSE
      || d.document.shape.type === CONST.DRAWING_TYPES.RECTANGLE));

    if ( !drawings.size ) return drawings;

    // Filter by the precise triangle cone
    // Also convert to CenteredPolygon b/c it handles bounds better
    const edges = [...visionPolygon.iterateEdges()];
    drawings = drawings.filter(d => {
      const shape = CONFIG.GeometryLib.utils.centeredPolygonFromDrawing(d);
      const center = shape.center;
      if ( visionPolygon.contains(center.x, center.y) ) return true;
      const dBounds = shape.getBounds();
      return edges.some(e => dBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
    return drawings;
  }

  /**
   * Filter tokens in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * @param {PIXI.Polygon} visionPolygon
   * @param {object} [options]
   * @param {string|undefined} viewerId   Id of viewer token to exclude
   * @param {string|undefined} targetId   Id of target token to exclude
   * @return {Set<Token>}
   */
  static filterTokensByVisionPolygon(visionPolygon, { viewer, target } = {}) {
    let tokens = canvas.tokens.quadtree.getObjects(visionPolygon.getBounds());

    // Filter out the viewer and target token
    tokens.delete(viewer);
    tokens.delete(target);

    if ( !tokens.size ) return tokens;

    // Filter by the precise triangle cone
    // For speed and simplicity, consider only token rectangular bounds
    const edges = [...visionPolygon.iterateEdges()];
    tokens = tokens.filter(t => {
      const tCenter = t.center;
      if ( visionPolygon.contains(tCenter.x, tCenter.y) ) return true;
      const tBounds = t.bounds;
      return edges.some(e => tBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
    return tokens;
  }

  /**
   * Filter tiles in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * @param {PIXI.Polygon} visionPolygon
   * @return {Set<Tile>}
   */
  static filterTilesByVisionPolygon(visionPolygon) {
    let tiles = canvas.tiles.quadtree.getObjects(visionPolygon.getBounds());
    if ( !tiles.size ) return tiles;

    // Filter by the precise triangle shape
    // Also filter by overhead tiles
    const edges = [...visionPolygon.iterateEdges()];
    tiles = tiles.filter(t => {
      // Only overhead tiles count for blocking vision
      if ( !t.document.overhead ) return false;

      // Check remainder against the vision polygon shape
      const tBounds = t.bounds;
      const tCenter = tBounds.center;
      if ( visionPolygon.contains(tCenter.x, tCenter.y) ) return true;
      return edges.some(e => tBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
    return tiles;
  }

  /**
   * Filter walls in the scene by a triangle representing the view from viewingPoint to some
   * token (or other two points). Only considers 2d top-down view.
   * @param {Point3d} viewingPoint
   * @param {PIXI.Polygon} visionPolygon
   * @param {object} [options]
   * @param {string} [type]     Wall restriction type: sight, light, move, sound
   * @return {Set<Wall>}
   */
  static filterWallsByVisionPolygon(viewingPoint, visionPolygon, { type = "sight" } = {}) {
    let walls = canvas.walls.quadtree.getObjects(visionPolygon.getBounds());
    walls = walls.filter(w => this._testWallInclusion(w, viewingPoint, { type }));

    if ( !walls.size ) return walls;

    // Filter by the precise triangle cone.
    const edges = [...visionPolygon.iterateEdges()];
    walls = walls.filter(w => {
      if ( visionPolygon.contains(w.A.x, w.A.y) || visionPolygon.contains(w.B.x, w.B.y) ) return true;
      return edges.some(e => foundry.utils.lineSegmentIntersects(w.A, w.B, e.A, e.B));
    });
    return walls;
  }

  /**
   * Test whether a wall should be included as potentially blocking from point of view of
   * token.
   * Comparable to ClockwiseSweep.prototype._testWallInclusion but less thorough.
   */
  static _testWallInclusion(wall, viewingPoint, { type = "sight" } = {}) {
    // Ignore walls that are not blocking for the type
    if (!wall.document[type] || wall.isOpen ) return false;

    // Ignore one-directional walls facing away
    const side = wall.orientPoint(viewingPoint);
    return !wall.document.dir || (side !== wall.document.dir);
  }

}
