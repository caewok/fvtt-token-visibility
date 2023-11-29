/* globals
canvas,
ClipperLib,
CONFIG,
CONST,
foundry,
LimitedAnglePolygon,
PIXI,
PointSourcePolygon,
Ray,
VisionSource
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULES_ACTIVE, MODULE_ID, FLAGS } from "../const.js";
import { insetPoints, lineIntersectionQuadrilateral3d, buildTokenPoints, lineSegmentIntersectsQuadrilateral3d } from "./util.js";
import { Settings, SETTINGS } from "../settings.js";

// Geometry folder
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";

// Points folder
import { WallPoints3d } from "./PlaceablesPoints/WallPoints3d.js";

/**
 * Base class to estimate line-of-sight between a source and a token using different methods.
 * The expectation is that the class will be initialized with a viewer token and target token,
 * and that these tokens may change position or other characteristics.
 *
 * Configuration allows a point other than viewer center to be used. This point is relative
 * to the viewer shape and will be updated as the viewer moves.
 *
 * It is permitted to change the viewer or the target token. Any cached values
 * would be reset accordingly.
 *
 * Measured values assume a single vision point on the viewer, perceiving the given token target.
 *
 * Generally, calling `hasLOS` or `percentVisible` will reset to the current viewer/target data.
 * Data may be cached otherwise.
 *
 */
export class AlternativeLOS {

  /**
   * @typedef AlternativeLOSConfig  Configuration settings for this class.
   * @type {object}
   * @property {CONST.WALL_RESTRICTION_TYPES} type    Type of source (light, sight, etc.)
   * @property {boolean} wallsBlock                   Can walls block in this test?
   * @property {boolean} tilesBlock                   Can tiles block in this test?
   * @property {boolean} deadTokensBlock              Can dead tokens block in this test?
   * @property {boolean} liveTokensBlock              Can live tokens block in this test?
   * @property {boolean} proneTokensBlock             Can prone tokens block in this test?
   * @property {Point3d} visionOffset                 Offset delta from the viewer center for vision point.
   * @property {PIXI.Polygon} visibleTargetShape      Portion of the token shape that is visible.
   * @property {VisionSource} visionSource            Vision source of the viewer.
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
    this.#viewer = viewer;
    this.#target = target;
    this._configure(config);
  }

  /**
   * Initialize settings that will stick even as the viewer and target are modified.
   * @param {object} config   Properties intended to override defaults
   */
  _configure(config = {}) {
    const cfg = this.config;
    cfg.type = config.type ?? "sight";
    cfg.wallsBlock = config.wallsBlock ?? true;
    cfg.tilesBlock = config.tilesBlock ?? true;
    cfg.deadTokensBlock = config.deadTokensBlock ?? false;
    cfg.liveTokensBlock = config.liveTokensBlock ?? false;
    cfg.proneTokensBlock = config.proneTokensBlock ?? false;
    cfg.useLitTargetShape = config.useLitTargetShape ?? false;
    cfg.largeTarget = config.largeTarget ?? Settings.get(SETTINGS.LOS.TARGET.LARGE);
    cfg.visionOffset = config.visionOffset ?? new Point3d();
  }

  _updateConfiguration(config = {}) {
    const cfg = this.config;
    for ( const [key, value] of Object.entries(config) ) cfg[key] = value;
    this._clearCache();
  }

  _clearCache() {
    // Viewer
    this.#viewerPoint = undefined;

    // Target
    this.#targetCenter = undefined;
    this.#visibleTargetShape = undefined;

    // Other
    this._visionPolygon = undefined;
    this.#blockingObjects.initialized = false;
  }

  /**
   * Method to be overridden by subclasses if objects must be destroyed before deleting.
   */
  destroy() {

  }

  // ----- NOTE: Viewer properties ----- //

  /**
   * The token that is considered the "viewer" of the target.
   * By default, the viewer is assumed to view from its center point, although this can
   * be changed by setting config.visionOffset.
   * @type {Token}
   */
  #viewer;

  get viewer() { return this.#viewer; }

  set viewer(value) {
    if ( value instanceof VisionSource ) value = value.object;
    if ( value === this.#viewer ) return;
    this.#viewer = value;
    this._clearCache();
  }

  #viewerPoint;

  /**
   * The line-of-sight is calculated from this point.
   * @type {Point3d}
   */
  get viewerPoint() {
    return this.#viewerPoint
      || (this.#viewerPoint = Point3d.fromTokenCenter(this.viewer).add(this.config.visionOffset));
  }

  /** @type {Point3d} */
  set visionOffset(value) {
    this.config.visionOffset.copyPartial(value);
    this._clearCache();
  }

  // ----- NOTE: Target properties ----- //

  /**
   * A token that is being tested for whether it is "viewable" from the point of view of the viewer.
   * Typically viewable by a light ray but could be other rays (such as whether an arrow could hit it).
   * Typically based on sight but could be other physical characteristics.
   * The border shape of the token is separately controlled by configuration.
   * Subclasses might measure points on the token or the token shape itself for visibility.
   * @type {Token}
   */
  #target;

  get target() { return this.#target; }

  set target(value) {
    if ( value === this.#target ) return;
    this.#target = value;
    this._clearCache();
  }

  /** @type {Point3d} */
  #targetCenter;

  get targetCenter() {
    return this.#targetCenter
      || (this.#targetCenter = Point3d.fromTokenCenter(this.target));
  }

  #visibleTargetShape;

  get visibleTargetShape() {
    if ( this.config.useLitTargetShape ) return this.constructor.constrainTargetShapeWithLights(this.target);
    return this.target.constrainedTokenBorder;
  }

  // ----- NOTE: Other getters / setters ----- //

  /**
   * The viewable area between viewer and target.
   * Typically, this is a triangle, but if viewed head-on, it will be a triangle
   * with the portion of the target between viewer and target center added on.
   * Not private so subclasses, like WebGL, can override.
   * @typedef {PIXI.Polygon} visionPolygon
   * @property {Segment[]} edges
   * @property {PIXI.Rectangle} bounds
   */
  _visionPolygon;

  // TODO: Define a target border property and use that instead.
  // Make consistent with visible token border.
  // For speed and simplicity, may want to have a target rectangle bounds and a target border.
  get visionPolygon() {
    if ( !this._visionPolygon ) {
      this._visionPolygon = this.constructor.visionPolygon(this.viewerPoint, this.target);
      this._visionPolygon._edges = [...this._visionPolygon.iterateEdges()];
      this._visionPolygon._bounds = this._visionPolygon.getBounds();
    }
    return this._visionPolygon;
  }

  /**
   * Holds Foundry objects that are within the vision triangle.
   * @typedef BlockingObjects
   * @type {object}
   * @property {Set<Drawing>} drawing
   * @property {Set<Wall>}    terrainWalls
   * @property {Set<Tile>}    tiles
   * @property {Set<Token>}   tokens
   * @property {Set<Wall>}    walls
   */
  #blockingObjects = {
    drawings: new Set(),
    terrainWalls: new Set(),
    tiles: new Set(),
    tokens: new Set(),
    walls: new Set(),
    initialized: false
  };

  get blockingObjects() {
    if ( !this.#blockingObjects.initialized ) this._findBlockingObjects();
    return this.#blockingObjects;
  }

  // ------ NOTE: Primary methods to be overridden by subclass -----

  /**
   * Determine whether a viewer has line-of-sight to a target based on meeting a threshold.
   * @param {number} [threshold]    Percentage to be met to be considered visible
   * @returns {boolean}
   */
  hasLOS(threshold, printResult = false) {
    // Debug: console.debug(`hasLOS|${this.viewer.name}👀 => ${this.target.name}🎯`);
    this._clearCache();

    threshold ??= Settings.get(SETTINGS.LOS.TARGET.PERCENT);
    const percentVisible = this.percentVisible();
    if ( printResult ) console.debug(`${this.viewer.name} sees ${Math.round(percentVisible * 100 * 10) / 10}% of ${this.target.name}.`);


    if ( typeof percentVisible === "undefined" ) return true; // Defaults to visible.
    if ( percentVisible.almostEqual(0) ) return false;
    return percentVisible > threshold || percentVisible.almostEqual(threshold);
  }

  /**
   * Determine percentage of the token visible using the class methodology.
   * Should be extended by subclass.
   * @returns {number}
   */
  percentVisible() {
    // Simple case: target is within the vision angle of the viewer and no obstacles present.
    return this._simpleVisibilityTest();
  }

  /**
   * Test for whether target is within the vision angle of the viewer and no obstacles present.
   * @returns {0|1|undefined} Undefined if obstacles present or target intersects the vision rays.
   */
  _simpleVisibilityTest() {
    this._clearCache();

    // To avoid obvious errors.
    if ( this.viewer === this.target
      || this.viewerPoint.almostEqual(Point3d.fromTokenCenter(this.target)) ) return 1;

    const visionSource = this.config.visionSource;
    const targetWithin = visionSource ? this.constructor.targetWithinLimitedAngleVision(visionSource, this.target) : 1;
    if ( !targetWithin ) return 0;
    if ( !this.hasPotentialObstacles && targetWithin === this.constructor.TARGET_WITHIN_ANGLE.INSIDE ) return 1;
    return undefined;  // Must be extended by subclass.
  }

  /**
   * @returns {boolean} True if some blocking placeable within the vision triangle.
   */
  hasPotentialObstacles() {
    const objs = this.#blockingObjects;
    return objs.walls.size || objs.tokens.size || objs.tiles.size;
  }

  /**
   * Take a token and intersects it with a set of lights.
   * @param {Token} token
   * @returns {PIXI.Polygon|PIXI.Rectangle|ClipperPaths}
   */
  static constrainTargetShapeWithLights(token) {
    const tokenBorder = token.constrainedTokenBorder;

    // If the global light source is present, then we can use the whole token.
    if ( canvas.effects.illumination.globalLight ) return tokenBorder;

    // Cannot really use quadtree b/c it doesn't contain all light sources.
    const lightShapes = [];
    for ( const light of canvas.effects.lightSources.values() ) {
      const lightShape = light.shape;
      if ( !light.active || lightShape.points < 6 ) continue; // Avoid disabled or broken lights.

      // If a light envelops the token shape, then we can use the entire token shape.
      if ( lightShape.envelops(tokenBorder) ) return tokenBorder;

      // If the token overlaps the light, then we may need to intersect the shape.
      if ( tokenBorder.overlaps(lightShape) ) lightShapes.push(lightShape);
    }
    if ( !lightShapes.length ) return tokenBorder;

    const paths = ClipperPaths.fromPolygons(lightShapes);
    const tokenPath = ClipperPaths.fromPolygons(tokenBorder instanceof PIXI.Rectangle
      ? [tokenBorder.toPolygon()] : [tokenBorder]);
    const combined = paths
      .combine()
      .intersectPaths(tokenPath)
      .clean()
      .simplify();
    return combined;
  }


  // ----- NOTE: Collision tests ----- //

  /**
   * Find objects that are within the vision triangle between viewer and target.
   * Sets this._blockingObjects for drawings, tiles, tokens, walls, and terrainWalls.
   * Sets _blockingObjectsAreSet
   */
  _findBlockingObjects() {
    // Locate blocking objects for the vision triangle
    const type = this.config.type;
    const blockingObjs = this.#blockingObjects;
    const objsFound = this._filterSceneObjectsByVisionPolygon();

    // Separate the terrain walls.
    const { terrainWalls, walls } = blockingObjs;
    terrainWalls.clear();
    walls.clear();
    objsFound.walls.forEach(w => {
      const s = w.document[type] === CONST.WALL_SENSE_TYPES.LIMITED ? terrainWalls : walls;
      s.add(w);
    });

    // Add walls for limited angle sight, if necessary.
    const limitedAngleWalls = this._constructLimitedAngleWallPoints3d();
    if ( limitedAngleWalls ) {
      walls.add(limitedAngleWalls[0]);
      walls.add(limitedAngleWalls[1]);
    }

    // Add tokens, tiles, drawings
    if ( objsFound.tokens ) blockingObjs.tokens = objsFound.tokens;
    else blockingObjs.tokens.clear();

    if ( objsFound.tiles ) blockingObjs.tiles = objsFound.tiles;
    else blockingObjs.tiles.clear();

    if ( objsFound.drawings ) blockingObjs.drawings = objsFound.drawings;
    else blockingObjs.drawings.clear();

    blockingObjs.initialized = true;
  }


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
      if ( !tile.mesh?.containsPixel(ix.x, ix.y, 0.99) ) continue; // Transparent, so no collision.

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

    // Filter out the viewer and target token
    const collisionTest = o => !(o.t.bounds.contains(startPt.x, startPt.y) || o.t.bounds.contains(endPt.x, endPt.y));
    const ray = new Ray(startPt, endPt);
    let tokens = canvas.tokens.quadtree.getObjects(ray.bounds, { collisionTest });

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
   * Convenience method that uses settings of this calculator to construct viewer points.
   * @returns {Points3d[]|undefined} Undefined if viewer cannot be ascertained
   */
  constructViewerPoints() {
    const { pointAlgorithm, inset } = this;
    return this.constructor.constructTokenPoints(this.viewer, { pointAlgorithm, inset });
  }


  // ----- NOTE: Static methods ----- //

  static constructViewerPoints(viewer, opts = {}) {
    opts.pointAlgorithm ??= Settings.get(SETTINGS.LOS.VIEWER.NUM_POINTS);
    opts.inset ??= Settings.get(SETTINGS.LOS.VIEWER.INSET);
    opts.viewer ??= viewer.bounds; // TODO: Should probably handle hex token shapes?
    return this._constructTokenPoints(viewer, opts);
  }

  static constructTargetPoints(target, opts = {}) {
    opts.pointAlgorithm ??= Settings.get(SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS);
    opts.inset ??= Settings.get(SETTINGS.LOS.TARGET.POINT_OPTIONS.INSET);
    opts.tokenShape ??= target.constrainedTokenBorder;
    return this._constructTokenPoints(target, opts);
  }

  static _constructTokenPoints(token, { tokenShape, pointAlgorithm, inset } = {}) {
    const TYPES = SETTINGS.POINT_TYPES;
    const center = Point3d.fromTokenCenter(token);

    const tokenPoints = [];
    if ( pointAlgorithm === TYPES.CENTER
        || pointAlgorithm === TYPES.FIVE
        || pointAlgorithm === TYPES.NINE ) tokenPoints.push(center);

    if ( pointAlgorithm === TYPES.CENTER ) return tokenPoints;

    tokenShape ??= token.constrainedTokenBorder;
    let cornerPoints = this.getCorners(tokenShape, center.z);

    // Inset by 1 pixel or inset percentage;
    insetPoints(cornerPoints, center, inset);

    // If two points, keep only the front-facing points.
    if ( pointAlgorithm === TYPES.TWO ) {
      // Token rotation is 0º for due south, while Ray is 0º for due east.
      // Token rotation is 90º for due west, while Ray is 90º for due south.
      // Use the Ray version to divide the token into front and back.
      const angle = Math.toRadians(token.document.rotation);
      const dirPt = PIXI.Point.fromAngle(center, angle, 100);
      cornerPoints = cornerPoints.filter(pt => foundry.utils.orient2dFast(center, dirPt, pt) <= 0);
    }

    tokenPoints.push(...cornerPoints);
    if ( pointAlgorithm === TYPES.TWO
      || pointAlgorithm === TYPES.FOUR
      || pointAlgorithm === TYPES.FIVE ) return tokenPoints;

    // Add in the midpoints between corners.
    const ln = cornerPoints.length;
    let prevPt = cornerPoints.at(-1);
    for ( let i = 0; i < ln; i += 1 ) {
      // Don't need to inset b/c the corners already are.
      const currPt = cornerPoints[i];
      tokenPoints.push(Point3d.midPoint(prevPt, currPt));
      prevPt = currPt;
    }
    return tokenPoints;
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
  static visionPolygon(viewingPoint, target, border) {
    border ??= target.constrainedTokenBorder;
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
        out = new PIXI.Polygon([viewingPoint, keyPoints[0], keyPoints.at(-1)]);
    }

    if ( !out.isClockwise ) out.reverseOrientation();
    return out;
  }

  /**
   * Helper that constructs 3d points for the points of a token shape (rectangle or polygon).
   * Uses the elevation provided as the z-value.
   * @param {PIXI.Polygon|PIXI.Rectangle} tokenShape
   * @parma {number} elevation
   * @returns {Point3d[]} Array of corner points.
   */
  static getCorners(tokenShape, elevation) {
    if ( tokenShape instanceof PIXI.Rectangle ) {
      // Token unconstrained by walls.
      // Use corners 1 pixel in to ensure collisions if there is an adjacent wall.
      tokenShape.pad(-1);
      return [
        new Point3d(tokenShape.left, tokenShape.top, elevation),
        new Point3d(tokenShape.right, tokenShape.top, elevation),
        new Point3d(tokenShape.right, tokenShape.bottom, elevation),
        new Point3d(tokenShape.left, tokenShape.bottom, elevation)
      ];
    }

    // Constrained is polygon. Only use corners of polygon
    // Scale down polygon to avoid adjacent walls.
    const padShape = tokenShape.pad(-2, { scalingFactor: 100 });
    return [...padShape.iteratePoints({close: false})].map(pt => new Point3d(pt.x, pt.y, elevation));
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
   * @returns {object} Object with possible properties:
   *   - @property {Set<Wall>} walls
   *   - @property {Set<Tile>} tiles
   *   - @property {Set<Token>} tokens
   *   - @property {Set<Drawings>} drawings
   */
  _filterSceneObjectsByVisionPolygon() {
    const {
      type,
      wallsBlock,
      liveTokensBlock,
      deadTokensBlock,
      tilesBlock } = this.config;

    const { target, viewerPoint } = this;
    const { topZ, bottomZ } = target;
    const maxE = Math.max(viewerPoint.z, topZ);
    const minE = Math.min(viewerPoint.z, bottomZ);
    const out = {};
    if ( wallsBlock ) {
      out.walls = this
        ._filterWallsByVisionPolygon()
        .filter(w => (w.topZ > minE) && (w.bottomZ < maxE)); // Filter walls too low or too high.
    }

    if ( tilesBlock ) {
      out.tiles = this
        ._filterTilesByVisionPolygon()
        .filter(t => { // Filter tiles that are definitely too low or too high
          const tZ = t.elevationZ;
          return (tZ < maxE) && (tZ > minE);
        });

      // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
      if ( MODULES_ACTIVE.LEVELS && type === "sight" ) {
        out.tiles = out.tiles.filter(t => !t.document?.flags?.levels?.noCollision);
      }

      // Check drawings if there are tiles
      if ( out.tiles.size ) out.drawings = this._filterDrawingsByVisionPolygon();
    }

    if ( liveTokensBlock || deadTokensBlock ) {
      out.tokens = this
        ._filterTokensByVisionPolygon()
        .filter(t => (t.topZ > minE) && (t.bottomZ < maxE)); // Filter tokens too low or too high.
    }

    return out;
  }

  /**
   * Filter drawings in the scene if they are flagged as holes.
   * @return {Set<Drawings>}
   */
  _filterDrawingsByVisionPolygon(visionPolygon) {
    visionPolygon ??= this.visionPolygon;
    let drawings = canvas.drawings.quadtree.getObjects(visionPolygon._bounds);

    // Filter by holes
    drawings = drawings.filter(d => d.document.getFlag(MODULE_ID, FLAGS.DRAWING.IS_HOLE)
      && ( d.document.shape.type === CONST.DRAWING_TYPES.POLYGON
      || d.document.shape.type === CONST.DRAWING_TYPES.ELLIPSE
      || d.document.shape.type === CONST.DRAWING_TYPES.RECTANGLE));

    // Filter by the precise triangle cone
    // Also convert to CenteredPolygon b/c it handles bounds better
    const edges = visionPolygon._edges;
    return drawings.filter(d => {
      const shape = CONFIG.GeometryLib.utils.centeredPolygonFromDrawing(d);
      const center = shape.center;
      if ( visionPolygon.contains(center.x, center.y) ) return true;
      const dBounds = shape.getBounds();
      return edges.some(e => dBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
  }

  /**
   * Filter tokens in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * Excludes the target and the visionSource token. If no visionSource, excludes any
   * token under the viewer point.
   * @return {Set<Token>}
   */
  _filterTokensByVisionPolygon() {
    const { visionPolygon, target, viewerPoint, config } = this;
    const viewer = config.visionSource?.object;

    // Filter out the viewer and target from the token set.
    const collisionTest = viewer
      ? o => !(o.t === target || o.t === viewer)
      : o => !(o.t === target || o.t.bounds.contains(viewerPoint.x, viewerPoint.y));
    const tokens = canvas.tokens.quadtree.getObjects(visionPolygon._bounds, { collisionTest });

    // Filter by the precise triangle cone
    // For speed and simplicity, consider only token rectangular bounds
    const edges = visionPolygon._edges;
    return tokens.filter(t => {
      const tCenter = t.center;
      if ( visionPolygon.contains(tCenter.x, tCenter.y) ) return true;
      const tBounds = t.bounds;
      return edges.some(e => tBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
  }

  /**
   * Filter tiles in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * @return {Set<Tile>}
   */
  _filterTilesByVisionPolygon(visionPolygon) {
    visionPolygon ??= this.visionPolygon;
    const tiles = canvas.tiles.quadtree.getObjects(visionPolygon._bounds);

    // Filter by the precise triangle shape
    // Also filter by overhead tiles
    const edges = visionPolygon._edges;
    const alphaThreshold = CONFIG[MODULE_ID].alphaThreshold;
    return tiles.filter(t => {
      // Only overhead tiles count for blocking vision
      if ( !t.document.overhead ) return false;

      // Check remainder against the vision polygon shape
      // const tBounds = t.bounds;

      // Use the alpha bounding box. This might be a polygon if the tile is rotated.
      const tBounds = t.evPixelCache.getThresholdCanvasBoundingBox(alphaThreshold);
      const tCenter = tBounds.center;
      if ( visionPolygon.contains(tCenter.x, tCenter.y) ) return true;
      return edges.some(e => tBounds.lineSegmentIntersects(e.A, e.B, { inside: true }));
    });
  }

  /**
   * Filter walls in the scene by a triangle representing the view from viewingPoint to some
   * token (or other two points). Only considers 2d top-down view.
   * @return {Set<Wall>}
   */
  _filterWallsByVisionPolygon() {
    const visionPolygon = this.visionPolygon;
    let walls = canvas.walls.quadtree.getObjects(visionPolygon._bounds);
    walls = walls.filter(w => this._testWallInclusion(w));

    // Filter by the precise triangle cone.
    const edges = visionPolygon._edges;
    return walls.filter(w => {
      if ( visionPolygon.contains(w.A.x, w.A.y) || visionPolygon.contains(w.B.x, w.B.y) ) return true;
      return edges.some(e => foundry.utils.lineSegmentIntersects(w.A, w.B, e.A, e.B));
    });
  }

  /**
   * Test whether a wall should be included as potentially blocking from point of view of
   * token.
   * Comparable to ClockwiseSweep.prototype._testWallInclusion but less thorough.
   */
  _testWallInclusion(wall) {
    // Ignore walls that are not blocking for the type
    if (!wall.document[this.config.type] || wall.isOpen ) return false;

    // Ignore one-directional walls facing away
    const side = wall.orientPoint(this.viewerPoint);
    return !wall.document.dir || (side !== wall.document.dir);
  }

  /** @type {enum} */
  static TARGET_WITHIN_ANGLE = {
    OUTSIDE: 0,
    INSIDE: 1,
    INTERSECTS: 2
  };

  /**
   * Test if any part of the target is within the limited angle vision of the token.
   * @param {VisionSource} visionSource
   * @param {PIXI.Rectangle|PIXI.Polygon} targetShape
   * @returns {boolean}
   */
  static targetWithinLimitedAngleVision(visionSource, targetShape) {
    const angle = visionSource.data.angle;
    if ( angle === 360 ) return true;

    // Does the target intersect the two rays from viewer center?
    // Does the target fall between the two rays?
    const { x, y, rotation } = visionSource.data;

    // The angle of the left (counter-clockwise) edge of the emitted cone in radians.
    // See LimitedAnglePolygon
    const aMin = Math.normalizeRadians(Math.toRadians(rotation + 90 - (angle / 2)));

    // The angle of the right (clockwise) edge of the emitted cone in radians.
    const aMax = aMin + Math.toRadians(angle);

    // For each edge:
    // If it intersects a ray, target is within.
    // If an endpoint is within the limited angle, target is within
    const rMin = Ray.fromAngle(x, y, aMin, canvas.dimensions.maxR);
    const rMax = Ray.fromAngle(x, y, aMax, canvas.dimensions.maxR);

    const targetWithin = () => {
      const inside = true;
      const ixFn = targetShape.lineSegmentIntersects;
      const hasIx = ixFn(rMin.A, rMin.B, { inside }) || ixFn(rMax.A, rMax.B, { inside });
      return hasIx + 1; // 1 if inside (no intersection); 2 if intersects.
    };

    // Probably worth checking the target center first
    const center = this.targetCenter;
    if ( LimitedAnglePolygon.pointBetweenRays(center, rMin, rMax, angle) ) return targetWithin();
    if ( LimitedAnglePolygon.pointBetweenRays(center, rMin, rMax, angle) ) return targetWithin();

    // TODO: Would it be more performant to assign an angle to each target point?
    // Or maybe just check orientation of ray to each point?
    const edges = this.visibleTargetShape.toPolygon().iterateEdges();
    for ( const edge of edges ) {
      if ( foundry.utils.lineSegmentIntersects(rMin.A, rMin.B, edge.A, edge.B) ) return 2;
      if ( foundry.utils.lineSegmentIntersects(rMax.A, rMax.B, edge.A, edge.B) ) return 2;
      if ( LimitedAnglePolygon.pointBetweenRays(edge.A, rMin, rMax, angle) ) return targetWithin();
      if ( LimitedAnglePolygon.pointBetweenRays(edge.B, rMin, rMax, angle) ) return targetWithin();
    }

    return 0;
  }

  /**
   * Construct walls based on limited angle rays
   * Start 1 pixel behind the origin
   * @returns {null|WallPoints3d[2]}
   */
  _constructLimitedAngleWallPoints3d() {
    const visionSource = this.config.visionSource;
    if ( !visionSource ) return;
    const angle = visionSource.data.angle;
    if ( angle === 360 ) return null;

    const { x, y, rotation } = visionSource.data;
    const aMin = Math.normalizeRadians(Math.toRadians(rotation + 90 - (angle / 2)));
    const aMax = aMin + Math.toRadians(angle);

    // 0 faces south; 270 faces east
    const aMed = (aMax + aMin) * 0.5;
    const rMed = Ray.fromAngle(x, y, aMed, -1);
    const rMin = Ray.fromAngle(rMed.B.x, rMed.B.y, aMin, canvas.dimensions.maxR);
    const rMax = Ray.fromAngle(rMed.B.x, rMed.B.y, aMax, canvas.dimensions.maxR);

    // Use the ray as the wall
    rMin.topZ = canvas.dimensions.maxR;
    rMin.bottomZ = -canvas.dimensions.maxR;
    rMax.topZ = canvas.dimensions.maxR;
    rMax.bottomZ = -canvas.dimensions.maxR;
    return [new WallPoints3d(rMin), new WallPoints3d(rMax)];
  }

  // ----- NOTE: Debugging methods ----- //

  async debug(hasLOS) {
    hasLOS ??= this.hasLOS();
    this._drawCanvasDebug(hasLOS);
  }

  async enableDebug() { }

  async disableDebug() { }

  clearDebug() {
    this._clearCanvasDebug();
  }

  /**
   * For debugging.
   * Draw debugging objects on the main canvas.
   * @param {boolean} hasLOS    Is there line-of-sight to this target?
   */
  _drawCanvasDebug(hasLOS = true) {
    this._drawLineOfSight();
    this._drawVisionTriangle();
    this._drawVisibleTokenBorder(hasLOS);
    this._drawDetectedObjects();
  }

  _clearCanvasDebug() {
    const draw = new Draw(Settings.DEBUG_LOS);
    draw.clearDrawings();
  }

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight() {
    const draw = new Draw(Settings.DEBUG_LOS);
    draw.segment({A: this.viewerPoint, B: this.targetCenter});
  }

  /**
   * For debugging.
   * Draw the constrained token border and visible shape, if any.
   * @param {boolean} hasLOS    Is there line-of-sight to this target?
   */
  _drawVisibleTokenBorder(hasLOS = true) {
    const draw = new Draw(Settings.DEBUG_LOS);
    const color = hasLOS ? Draw.COLORS.green : Draw.COLORS.red;

    // Fill in the constrained border on canvas
    draw.shape(this.target.constrainedTokenBorder, { color, fill: color, fillAlpha: 0.2});

    // Separately fill in the visibile target shape
    const visibleTargetShape = this.config.visibleTargetShape;
    if ( visibleTargetShape ) draw.shape(visibleTargetShape, { color: Draw.COLORS.yellow });
  }

  /**
   * For debugging.
   * Draw outlines for the various objects that can be detected on the canvas.
   */
  _drawDetectedObjects() {
    const draw = new Draw(Settings.DEBUG_LOS);
    const colors = Draw.COLORS;
    const { walls, tiles, terrainWalls, tokens, drawings } = this.blockingObjects;
    walls.forEach(w => draw.segment(w, { color: colors.blue, fillAlpha: 0.3 }));
    tiles.forEach(t => draw.shape(t.bounds, { color: colors.yellow, fillAlpha: 0.3 }));
    terrainWalls.forEach(w => draw.segment(w, { color: colors.lightgreen }));
    drawings.forEach(d => draw.shape(d.bounds, { color: colors.gray, fillAlpha: 0.3 }));
    tokens.forEach(t => draw.shape(t.constrainedTokenBorder, { color: colors.orange, fillAlpha: 0.3 }));
  }

  /**
   * For debugging.
   * Draw the vision triangle between viewer point and target.
   */
  _drawVisionTriangle() {
    const draw = new Draw(Settings.DEBUG_LOS);
    draw.shape(this.visionPolygon, { fill: Draw.COLORS.lightblue, fillAlpha: 0.2 });
  }
}
