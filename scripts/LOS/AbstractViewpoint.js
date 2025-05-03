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
import { AbstractPolygonTriangles } from "./PlaceableTriangles.js";
import { NULL_SET } from "./util.js";

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
  /** @type {VisionTriangle} */
  static visionTriangle = new VisionTriangle();

  /** @type {ViewerLOS} */
  viewerLOS;

  /** @type {Point3d} */
  viewpointDiff;

  /** @type {PercentVisibileCalculatorAbstract} */
  // @override
  calc;

  /**
   * @param {ViewerLOS} viewerLOS      The viewer that controls this "eye"
   * @param {Point3d} viewpointDiff     The location of the eye relative to the viewer
   */
  constructor(viewerLOS, viewpoint, cfg = {}) {
    this.viewerLOS = viewerLOS;
    this.viewpointDiff = viewpoint.subtract(viewerLOS.center);
    this.config = cfg;
  }

  clearCache() { }

  /** @type {ViewerLOSConfig} */
  _config = {
    blocking: {
      walls: true,
      tiles: true,
      tokens: {
        dead: true,
        live: true,
        prone: true,
      }
    },
    debug: false,
    useLitTargetShape: false,
    largeTarget: false,
  }

  get config() { return this._config; }

  set config(cfg = {}) {
    foundry.utils.mergeObject(this._config, cfg);
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
  get senseType() { return this.viewerLOS.senseType; }

  set senseType(value) { this.calc.senseType = senseType; }

  /**
   * Determine percentage of the token visible using the class methodology.
   * @param {Token} target
   * @returns {number}
   */
  percentVisible(callback) {
    const percent = this._simpleVisibilityTest() ?? this._percentVisible(callback);
    if ( this.viewerLOS.config.debug ) console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t@viewpoint ${this.viewpoint.toString()}`)
    return percent;
  }

  async percentVisibleAsync() {
    const percent = this._simpleVisibilityTest() ?? (await this._percentVisible());
    if ( this.viewerLOS.config.debug ) console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t@viewpoint ${this.viewpoint.toString()}`)
    return percent;
  }

  /** @override */
  _percentVisible() {
    // TODO: Handle configuration options.
    return this.calc.percentVisible(this.viewer, this.target, { viewerLocation: this.viewpoint, targetLocation: this.targetLocation });
  }

  async _percentVisibleAsync() {
    // TODO: Handle configuration options.
    return this.calc.percentVisibleAsync(this.viewer, this.target, { viewerLocation: this.viewpoint, targetLocation: this.targetLocation });
  }

  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} target
   * @returns {0|1|undefined} 1.0 for visible; Undefined if obstacles present or target intersects the vision rays.
   */
  _simpleVisibilityTest() {
    const target = this.viewerLOS.target;

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
    const { terrainWalls, ...otherObjects } = this.blockingObjects;
    if ( terrainWalls.size > 1 ) return true;
    return Object.values(otherObjects).some(objSet => objSet.size);
  }

  /**
   * Filter relevant objects in the scene using the vision triangle.
   * For the z dimension, keeps objects that are between the lowest target point,
   * highest target point, and the viewing point.
   * @returns {object} Object with possible properties:
   *   - @property {Set<Wall>} walls
   *   - @property {Set<Tile>} tiles
   *   - @property {Set<Token>} tokens
   */
  static findBlockingObjects(viewpoint, target, { viewer, senseType = "sight", blockingOpts = {} } = {}) {
    const visionTri = this.visionTriangle.rebuild(viewpoint, target);
    blockingOpts.walls ??= true;
    blockingOpts.tiles ??= true;
    blockingOpts.tokens ??= {};
    blockingOpts.tokens.live ??= true;
    blockingOpts.tokens.dead ??= true;

    const blockingObjs = {
      walls: NULL_SET,
      tiles: NULL_SET,
      terrainWalls: new Set(),
      tokens: NULL_SET,
    };
    if ( blockingOpts.walls ) blockingObjs.walls = this.filterWallsByVisionTriangle(visionTri, { senseType });
    if ( blockingOpts.tiles ) blockingObjs.tiles = this.filterTilesByVisionTriangle(visionTri, { senseType });
    if ( blockingOpts.tokens.live
      || blockingObjs.tokens.dead ) blockingObjs.tokens = this.filterTokensByVisionTriangle(visionTri,
        { senseType, viewer, blockingTokensOpts: blockingOpts.tokens });

    // Separate walls into terrain and normal.
    blockingObjs.walls.forEach(w => {
      if ( w.document[senseType] === CONST.WALL_SENSE_TYPES.LIMITED ) {
        blockingObjs.walls.delete(w);
        blockingObjs.terrainWalls.add(w);
      }
    });
    return blockingObjs;
  }

  /**
   * Filter walls in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @return {Set<Wall>}
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
   * @return {Set<Tile>}
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
   * @return {Set<Token>}
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
      tokens = tokens.filter(t => tokensOverlap(  viewer, t));
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
    const polys = placeable[AbstractPolygonTriangles.ID].triangles;
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
   * Clean up memory-intensive objects.
   */
  destroy() {
    this.clearCache();
  }

  /* ----- NOTE: Debug ----- */

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight(debugDraw) {
    debugDraw ??= this.viewerLOS.config.debugDraw;
    debugDraw.segment({ A: this.viewpoint, B: this.viewerLOS.target.center });
    console.log("Drawing line of sight.")
  }

  /**
   * For debugging.
   * Draw outlines for the various objects that can be detected on the canvas.
   */
  _drawDetectedObjects(debugDraw) {
    // if ( !this.#blockingObjects.initialized ) return;
    debugDraw ??= this.viewerLOS.config.debugDraw;
    const colors = Draw.COLORS;
    const { walls, tiles, terrainWalls, tokens } = this.blockingObjects;
    walls.forEach(w => debugDraw.segment(w, { color: colors.red, fillAlpha: 0.3 }));
    tiles.forEach(t => debugDraw.shape(t.bounds, { color: colors.yellow, fillAlpha: 0.3 }));
    terrainWalls.forEach(w => debugDraw.segment(w, { color: colors.lightgreen }));
    tokens.forEach(t => debugDraw.shape(t.constrainedTokenBorder, { color: colors.orange, fillAlpha: 0.3 }));
    console.log("Drawing detected objects.")
  }

  /**
   * For debugging.
   * Draw the vision triangle between viewer point and target.
   */
  _drawVisionTriangle(debugDraw) {
    debugDraw ??= this.viewerLOS.config.debugDraw;
    //debugDraw.shape(this.constructor.visionTriangle, { width: 0, fill: Draw.COLORS.gray, fillAlpha: 0.1 });
    console.log("Drawing vision triangle.")
  }
}