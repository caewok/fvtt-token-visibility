/* globals
CONFIG,
CONST,
canvas,
foundry,
PIXI,
Wall,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULES_ACTIVE, MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// LOS folder
import { VisionTriangle } from "./VisionTriangle.js";
import { AbstractPolygonTrianglesID } from "./PlaceableTriangles.js";
import { NULL_SET } from "./util.js";
import { squaresUnderToken, hexesUnderToken } from "./shapes_under_token.js";

import {
  insetPoints,
  tokensOverlap } from "./util.js";

// Debug
import { Draw } from "../geometry/Draw.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 */
export class AbstractViewpoint {
  static calcClass;

  /** @type {VisionTriangle} */
  static visionTriangle = new VisionTriangle();

  /** @type {ViewerLOS} */
  viewerLOS;

  /** @type {Point3d} */
  viewpointDiff;

  /**
   * @param {ViewerLOS} viewerLOS      The viewer that controls this "eye"; handles most of the config
   * @param {Point3d} viewpoint        The location of the eye; this will be translated to be relative to the viewer
   */
  constructor(viewerLOS, viewpoint) {
    if ( viewerLOS.calculator && !(viewerLOS.calculator instanceof this.constructor.calcClass) ) {
      console.error(`{this.constructor.name}|Calculator must be ${this.constructor.calcClass.name}.`, this.viewerLOS.calculator);
    }
    this.viewerLOS = viewerLOS;
    this.viewpointDiff = viewpoint.subtract(viewerLOS.center);
  }

  /** @type {Point3d} */
  get viewpoint() { return this.viewerLOS.center.add(this.viewpointDiff); }

  /** @type {Point3d} */
  get targetLocation() { return CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(this.viewerLOS.target); }

  /** @type {Token} */
  get viewer() { return this.viewerLOS.viewer};

  /** @type {Token} */
  get target() { return this.viewerLOS.target; }

  /** @type {WALL_RESTRICTION_TYPES} */
  get senseType() { return this.viewerLOS.config.senseType; }

  // set senseType(value) { this.calculator.senseType = senseType; }

  /** @type {PercentVisibileCalculatorAbstract} */
  get calculator() { return this.viewerLOS.calculator; }

  get config() { return this.viewerLOS.calculator.config; }

  /**
   * Determine percentage of the token visible using the class methodology.
   * @param {Token} target
   * @returns {number}
   */
  percentVisible() {
    const percent = this.simpleVisibilityTest() ?? this._percentVisible();
    // if ( this.viewerLOS.config.debug ) console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t@viewpoint ${this.viewpoint.toString()}`)
    return percent;
  }

  async percentVisibleAsync() {
    const percent = this.simpleVisibilityTest() ?? (await this._percentVisible());
    // if ( this.viewerLOS.config.debug ) console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t@viewpoint ${this.viewpoint.toString()}`)
    return percent;
  }

  /** @override */
  _percentVisible() {
    const { calculator, viewer, target, viewpoint: viewerLocation, targetLocation } = this;
    return calculator.percentVisible(viewer, target, { viewerLocation, targetLocation });
  }

  async _percentVisibleAsync() {
    const { calculator, viewer, target, viewpoint: viewerLocation, targetLocation } = this;
    return calculator.percentVisibleAsync(viewer, target, { viewerLocation, targetLocation });
  }

  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} target
   * @returns {0|1|undefined} 1.0 for visible; Undefined if obstacles present or target intersects the vision rays.
   */
  simpleVisibilityTest() {
    const target = this.target;

    // If directly overlapping.
    if ( target.bounds.contains(this.viewpoint) ) return 1;

    // Treat the scene background as fully blocking, so basement tokens don't pop-up unexpectedly.
    const backgroundElevation = canvas.scene.flags?.levels?.backgroundElevation || 0;
    if ( (this.viewpoint.z > backgroundElevation && target.topZ < backgroundElevation)
      || (this.viewpoint.z < backgroundElevation && target.bottomZ > backgroundElevation) ) return 0;

    if ( !this.hasPotentialObstacles(target) ) return 1;

    return undefined;
  }

  // ----- NOTE: Collision tests ----- //
  /**
   * Test if we have one or more potentially blocking objects. Does not check for whether
   * the objects in fact block but does require two terrain walls to count.
   * @returns {boolean} True if some blocking placeable within the vision triangle.
   *
   */
  hasPotentialObstacles() {
    // TODO: Cache blocking objects and pass through to calc? Cache visionTriangle?
    const visionTri = this.constructor.visionTriangle.rebuild(this.viewpoint, this.target);
    const opts = {
      senseType: this.config.senseType,
      viewer: this.viewer,
      target: this.target,
      blockingOpts: this.config.blocking,
    };
    const blockingObjs = this.constructor.findBlockingWalls(visionTri, opts);
    if ( blockingObjs.walls.size || blockingObjs.terrainWalls.size > 1 ) return true;
    if ( this.constructor.findBlockingTiles(visionTri, opts).size
      || this.constructor.findBlockingTokens(visionTri, opts).size
      || this.constructor.findBlockingRegions(visionTri, opts).size ) return true;
    return false;
  }

  /**
   * Filter relevant objects in the scene using the vision triangle.
   * For the z dimension, keeps objects that are between the lowest target point,
   * highest target point, and the viewing point.
   * @returns {object} Object with possible properties:
   *   - @property {Set<Wall>} walls
   *   - @property {Set<Wall>} terrainWalls
   *   - @property {Set<Tile>} tiles
   *   - @property {Set<Token>} tokens
   */
  static findBlockingObjects(viewpoint, target, opts = {}) {
    const visionTri = this.visionTriangle.rebuild(viewpoint, target);

    opts.blockingOpts ??= {};
    opts.senseType ??= "sight";
    opts.target ??= target;

    const blockingObjs = this.findBlockingWalls(visionTri, opts);
    blockingObjs.tiles = this.findBlockingTiles(visionTri, opts);
    blockingObjs.tokens = this.findBlockingTokens(visionTri, opts);
    blockingObjs.regions = this.findBlockingRegions(visionTri, opts);
    return blockingObjs;
  }

  static findBlockingWalls(visionTri, { senseType = "sight", blockingOpts = {} } = {}) {
    blockingOpts.walls ??= true;
    if ( !blockingOpts.walls ) return { walls: NULL_SET, terrainWalls: NULL_SET };
    const walls = this.filterWallsByVisionTriangle(visionTri, { senseType });
    const terrainWalls = new Set();

    // Separate walls into terrain and normal.
    walls.forEach(w => {
      if ( w.document[senseType] === CONST.WALL_SENSE_TYPES.LIMITED ) {
        walls.delete(w);
        terrainWalls.add(w);
      }
    });
    return { walls, terrainWalls };
  }

  static findBlockingTiles(visionTri, { senseType = "sight", blockingOpts = {} } = {}) {
    blockingOpts.tiles ??= true;
    return blockingOpts.tiles ?  this.filterTilesByVisionTriangle(visionTri, { senseType }) : NULL_SET;
  }

  static findBlockingTokens(visionTri, { viewer, target, blockingOpts = {} } = {}) {
    blockingOpts.tokens ??= {};
    blockingOpts.tokens.live ??= true;
    blockingOpts.tokens.dead ??= true;
    return ( blockingOpts.tokens.live || blockingOpts.tokens.dead )
      ? this.filterTokensByVisionTriangle(visionTri, { viewer, target, blockingTokensOpts: blockingOpts.tokens })
      : NULL_SET;
  }

  static findBlockingRegions(visionTri, { senseType = "sight", blockingOpts = {} } = {}) {
    blockingOpts.regions ??= true;
    return blockingOpts.regions ? this.filterRegionsByVisionTriangle(visionTri, { senseType }) : NULL_SET;
  }

  /**
   * Filter regions in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @returns {Set<Region>}
   */
  static filterRegionsByVisionTriangle(visionTri, { senseType = "sight" } = {}) {
    // TODO: Filter by sense type
    if ( !CONFIG[MODULE_ID].regionsBlock ) return NULL_SET;
    return visionTri.findRegions();
  }

  /**
   * Filter walls in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @returns {Set<Wall>}
   */
  static filterWallsByVisionTriangle(visionTri, { senseType = "sight" } = {}) {
    // Ignore walls that are not blocking for the type.
    // Ignore walls with open doors.
    return visionTri.findWalls().filter(w => w.document[senseType] && !w.isOpen);
  }

  static filterEdgesByVisionTriangle(visionTri, { senseType = "sight" } = {}) {
    // Ignore edges that are not blocking for the type.
    // Ignore edges that are walls with open doors.
    return visionTri.findEdges().filter(e => e[senseType] && !(e.object instanceof Wall && e.object.isOpen));
  }

  /**
   * Filter tiles in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @returns {Set<Tile>}
   */
  static filterTilesByVisionTriangle(visionTri, { senseType = "sight" } = {}) {
    const tiles = visionTri.findTiles();

    // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
    if ( MODULES_ACTIVE.LEVELS && senseType === "sight" ) {
      return tiles.filter(t => !t.document?.flags?.levels?.noCollision);
    }
    return tiles;
  }

  /**
   * Filter tokens in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * Excludes the target and the visionSource token. If no visionSource, excludes any
   * token under the viewer point.
   * @returns {Set<Token>}
   */
  static filterTokensByVisionTriangle(visionTri, {
    viewer,
    target,
    blockingTokensOpts }) {

    let tokens = visionTri.findTokens();

    // Filter out the viewer and target from the token set.
    // Filter all mounts and riders of both viewer and target. Possibly covered by previous test.
    const api = MODULES_ACTIVE.API.RIDEABLE;
    if ( target ) {
      tokens.delete(target);
      if ( api ) tokens = tokens.filter(t => api.RidingConnection(t, target))
    }
    if ( viewer ) {
      tokens.delete(viewer);
      tokens = tokens.filter(t => !tokensOverlap(viewer, t));
      if ( api ) tokens = tokens.filter(t => api.RidingConnection(t, viewer))
    }

    // Filter live, dead, prone tokens.
    return tokens.filter(token => this.includeToken(token, blockingTokensOpts));
  }

  static includeToken(token, { dead = true, live = true, prone = true } = {}) {
    if ( !dead && CONFIG[MODULE_ID].tokenIsDead(token) ) return false;
    if ( !live && CONFIG[MODULE_ID].tokenIsAlive(token) ) return false;
    if ( !prone && token.isProne ) return false;
    return true;
  }

  static filterPlaceablePolygonsByViewpoint(placeable, viewpoint) {
    const polys = placeable[MODULE_ID][AbstractPolygonTrianglesID].triangles;
    return polys.filter(poly => poly.isFacing(viewpoint));
  }

  _filterPlaceablePolygonsByViewpoint(placeable) {
    return this.constructor.filterPlaceablePolygonsByViewpoint(placeable, this.viewpoint);
  }

  /**
   * @param {Token} token
   * @param {object} [opts]
   * @param {PIXI.Polygon|PIXI.Rectangle} [opts.tokenShape]
   * @param {POINT_TYPES} [opts.pointAlgorithm]
   * @param {number} [opts.inset]
   * @param {Point3d} [opts.viewpoint]
   * @returns {Point3d[]}
   */
  static constructTokenPoints(token, { tokenShape, pointAlgorithm, inset, viewpoint } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const TYPES = Settings.KEYS.POINT_TYPES;
    const center = Point3d.fromTokenCenter(token);

    const tokenPoints = [];
    if ( pointAlgorithm === TYPES.CENTER
        || pointAlgorithm === TYPES.THREE
        || pointAlgorithm === TYPES.FIVE
        || pointAlgorithm === TYPES.NINE ) tokenPoints.push(center);

    if ( pointAlgorithm === TYPES.CENTER ) return tokenPoints;

    tokenShape ??= token.constrainedTokenBorder;
    let cornerPoints = this.getCorners(tokenShape, center.z);

    // Inset by 1 pixel or inset percentage;
    insetPoints(cornerPoints, center, inset);

    // If two points, keep only the front-facing points.
    // For targets, keep the closest two points to the viewer point.
    if ( pointAlgorithm === TYPES.TWO ) {
      if ( viewpoint ) {
        cornerPoints.forEach(pt => pt._dist = Point3d.distanceSquaredBetween(viewpoint, pt));
        cornerPoints.sort((a, b) => a._dist - b._dist);
        cornerPoints.splice(2);
      } else {
        // Token rotation is 0º for due south, while Ray is 0º for due east.
        // Token rotation is 90º for due west, while Ray is 90º for due south.
        // Use the Ray version to divide the token into front and back.
        const angle = Math.toRadians(token.document.rotation);
        const dirPt = PIXI.Point.fromAngle(center, angle, 100);
        cornerPoints = cornerPoints.filter(pt => foundry.utils.orient2dFast(center, dirPt, pt) <= 0);
      }
    }

    if ( pointAlgorithm === TYPES.THREE ) {
      if ( viewpoint ) {
        tokenPoints.shift(); // Remove the center point.
        cornerPoints.forEach(pt => pt._dist = Point3d.distanceSquaredBetween(viewpoint, pt));
        cornerPoints.sort((a, b) => a._dist - b._dist);

        // If 2 of the 4 points are equidistant, we are in line with the target and can stick to the top 2.
        const numPoints = cornerPoints[0]._dist === cornerPoints[1]._dist ? 2 : 3;
        cornerPoints.splice(numPoints);
      } else {
        // Token rotation is 0º for due south, while Ray is 0º for due east.
        // Token rotation is 90º for due west, while Ray is 90º for due south.
        // Use the Ray version to divide the token into front and back.
        const angle = Math.toRadians(token.document.rotation);
        const dirPt = PIXI.Point.fromAngle(center, angle, 100);
        cornerPoints = cornerPoints.filter(pt => foundry.utils.orient2dFast(center, dirPt, pt) <= 0);
      }
    }

    tokenPoints.push(...cornerPoints);
    if ( pointAlgorithm === TYPES.TWO
      || pointAlgorithm === TYPES.THREE
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
   * Helper that constructs 3d points for the points of a token shape (rectangle or polygon).
   * Uses the elevation provided as the z-value.
   * @param {PIXI.Polygon|PIXI.Rectangle} tokenShape
   * @parma {number} elevation
   * @returns {Point3d[]} Array of corner points.
   */
  static getCorners(tokenShape, elevation) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    if ( tokenShape instanceof PIXI.Rectangle ) {
      // Token unconstrained by walls.
      // Use corners 1 pixel in to ensure collisions if there is an adjacent wall.
      // PIXI.Rectangle.prototype.pad modifies in place.
      tokenShape = tokenShape.clone();
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
   * Get polygons representing all grids under a token.
   * If token is constrained, overlap the constrained polygon on the grid shapes.
   * @param {Token} token
   * @return {PIXI.Polygon[]|PIXI.Rectangle[]|null}
   */
  static constrainedGridShapesUnderToken(token) {
    const gridShapes = this.gridShapesUnderToken(token);
    const constrained = token.constrainedTokenBorder;

    // Token unconstrained by walls.
    if ( constrained instanceof PIXI.Rectangle ) return gridShapes;

    // For each gridShape, intersect against the constrained shape
    const constrainedGridShapes = [];
    const constrainedPath = CONFIG[MODULE_ID].ClipperPaths.fromPolygons([constrained]);
    for ( let gridShape of gridShapes ) {
      if ( gridShape instanceof PIXI.Rectangle ) gridShape = gridShape.toPolygon();

      const constrainedGridShape = constrainedPath.intersectPolygon(gridShape).simplify();
      if ( constrainedGridShape instanceof CONFIG[MODULE_ID].ClipperPaths ) {
        // Ignore holes.
        const polys = constrainedGridShape.toPolygons().filter(poly => !poly.isHole && poly.points.length >= 6);
        if ( polys.length ) constrainedGridShapes.push(...polys);
      } else if ( constrainedGridShape instanceof PIXI.Polygon && constrainedGridShape.points.length >= 6 ) {
        constrainedGridShapes.push(constrainedGridShape);
      } else if ( constrainedGridShape instanceof PIXI.Rectangle ) {
        constrainedGridShapes.push(constrainedGridShape);
      }
    }

    return constrainedGridShapes;
  }

  /**
   * Get polygons representing all grids under a token.
   * @param {Token} token
   * @return {PIXI.Polygon[]|PIXI.Rectangle[]|null}
   */
  static gridShapesUnderToken(token) {
    if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) {
      // console.error("gridShapesUnderTarget called on gridless scene!");
      return [token.bounds];
    }
    return canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squaresUnderToken(token) : hexesUnderToken(token);
  }

  /**
   * Clean up memory-intensive objects.
   */
  destroy() {}

  /* ----- NOTE: Debug ----- */

  /**
   * For debugging.
   * Draw various debug guides on the canvas.
   * @param {Draw} draw
   */
  _drawCanvasDebug(debugDraw) {
    // this._drawLineOfSight(debugDraw);
    this._drawDetectedObjects(debugDraw);
    this._drawVisionTriangle(debugDraw);
  }

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight(debugDraw) {
    debugDraw ??= this.viewerLOS.config.debugDraw;
    debugDraw.segment({ A: this.viewpoint, B: this.targetLocation });
  }

  /**
   * For debugging.
   * Draw outlines for the various objects that can be detected on the canvas.
   */
  _drawDetectedObjects(debugDraw) {
    // if ( !this.#blockingObjects.initialized ) return;
    const blockingObjects = AbstractViewpoint.findBlockingObjects(this.viewpoint, this.target,
      { viewer: this.viewer, senseType: this.config.senseType, blockingOpts: this.config.blocking });
    debugDraw ??= this.viewerLOS.config.debugDraw;
    const colors = Draw.COLORS;
    const { walls, tiles, terrainWalls, tokens } = blockingObjects;
    walls.forEach(wall => debugDraw.segment(wall, { color: colors.red }));
    // tiles.forEach(tile => debugDraw.shape(tile.bounds, { color: colors.yellow }));
    tiles.forEach(tile => tile.tokenvisibility.geometry.triangles.forEach(tri => tri.draw2d({ draw: debugDraw, color: Draw.COLORS.yellow, fillAlpha: 0.1, fill: Draw.COLORS.yellow })));
    terrainWalls.forEach(wall => debugDraw.segment(wall, { color: colors.lightgreen }));
    tokens.forEach(token => debugDraw.shape(token.constrainedTokenBorder, { color: colors.orange, fillAlpha: 0.2 }));
  }

  /**
   * For debugging.
   * Draw the vision triangle between viewer point and target.
   */
  _drawVisionTriangle(debugDraw) {
    debugDraw ??= this.viewerLOS.config.debugDraw;
    const visionTri = this.constructor.visionTriangle.rebuild(this.viewpoint, this.target);
    visionTri.draw({ draw: debugDraw, width: 0, fill: CONFIG.GeometryLib.Draw.COLORS.gray, fillAlpha: 0.1 });
  }
}