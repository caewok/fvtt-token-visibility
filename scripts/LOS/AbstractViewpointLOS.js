/* globals
CONFIG,
CONST,
canvas,
foundry,
PIXI,
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULES_ACTIVE } from "../const.js";
import { Settings } from "../settings.js";

// LOS folder
import { VisionPolygon } from "./VisionPolygon.js";

import {
  insetPoints,
  tokensOverlap } from "./util.js";

// Debug
import { Draw } from "../geometry/Draw.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 */
export class AbstractViewpointLOS {

  /** @type {ViewerLOS} */
  viewerLOS;

  /** @type {Point3d} */
  viewpointDiff;

  /** @type {object} */
  config;

  /**
   * @param {ViewerLOS} viewerLOS      The viewer that controls this "eye"
   * @param {Point3d} viewpointDiff     The location of the eye relative to the viewer
   */
  constructor(viewerLOS, viewpoint) {
    this.viewerLOS = viewerLOS;
    this.viewpointDiff = viewpoint.subtract(viewerLOS.viewer.center);
    this.config = this.initializeConfig();
  }

  /**
   * Sets configuration to the current settings.
   * @param {ViewpointLOSConfig} [cfg]
   * @returns {ViewpointLOSConfig}
   */
  initializeConfig(cfg = {}) { return cfg; }

  /** @type {Point3d} */
  get viewpoint() { return this.viewerLOS.viewer.center.add(this.viewpointDiff); }

  /**
   * The viewable area between viewer and target.
   * Typically, this is a triangle, but if viewed head-on, it will be a triangle
   * with the portion of the target between viewer and target center added on.
   * @typedef {PIXI.Polygon} visionPolygon
   * @property {Segment[]} edges
   * @property {PIXI.Rectangle} bounds
   */
  get visionPolygon() {
    return VisionPolygon.build(this.viewpoint, this.viewerLOS.target);
  }

  /**
   * Determine percentage of the token visible using the class methodology.
   * @param {Token} target
   * @returns {number}
   */
  percentVisible(target) {
    const percent = this._simpleVisibilityTest(target) ?? this._percentVisible(target);
    if ( this.viewerLOS.config.debug ) console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t(@viewerPoint ${Math.round(this.viewpoint.x)},${Math.round(this.viewpoint.y)},${Math.round(this.viewpoint.z)})`)
    return percent;
  }

  /** @override */
  _percentVisible(_target) { return 1; }

  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} target
   * @returns {0|1|undefined} 1.0 for visible; Undefined if obstacles present or target intersects the vision rays.
   */
  _simpleVisibilityTest(target) {
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
  hasPotentialObstacles(target) {
    this.findBlockingObjects(target); // TODO: Cache this.
    const { terrainWalls, ...otherObjects } = this.blockingObjects;
    if ( terrainWalls.size > 1 ) return true;
    return Object.values(otherObjects).some(objSet => objSet.size);
  }

  /**
   * Holds Foundry objects that are within the vision triangle.
   * @typedef BlockingObjects
   * @type {object}
   * @property {Set<Wall>}    terrainWalls
   * @property {Set<Tile>}    tiles
   * @property {Set<Token>}   tokens
   * @property {Set<Wall>}    walls
   */
  blockingObjects = {
    terrainWalls: new Set(),
    tiles: new Set(),
    tokens: new Set(),
    walls: new Set()
  };

  /**
   * Filter relevant objects in the scene using the vision triangle.
   * For the z dimension, keeps objects that are between the lowest target point,
   * highest target point, and the viewing point.
   * @returns {object} Object with possible properties:
   *   - @property {Set<Wall>} walls
   *   - @property {Set<Tile>} tiles
   *   - @property {Set<Token>} tokens
   */
  findBlockingObjects(target) {
    const blocking = this.viewerLOS.config.block;

    // Remove old blocking objects.
    const blockingObjs = this.blockingObjects;
    Object.values(blockingObjs).forEach(objs => objs.clear());

    const visionPolygon = VisionPolygon.build(this.viewpoint, target);
    if ( blocking.walls ) blockingObjs.walls = this._filterWallsByVisionPolygon(visionPolygon);
    if ( blocking.tiles ) blockingObjs.tiles = this._filterTilesByVisionPolygon(visionPolygon);
    if ( blocking.tokens.live || blocking.tokens.dead ) blockingObjs.tokens = this._filterTokensByVisionPolygon(visionPolygon, target);

    // Separate walls into terrain and normal.
    blockingObjs.walls.forEach(w => {
      if ( w.document[this.viewerLOS.config.type] === CONST.WALL_SENSE_TYPES.LIMITED ) {
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
  _filterWallsByVisionPolygon(visionPolygon, walls) {
    walls ??= canvas.walls.quadtree
        .getObjects(visionPolygon._bounds)
        .filter(w => w.document[this.viewerLOS.config.type] ); // Ignore walls that are not blocking for the type.
    return visionPolygon.filterWalls(walls);
  }

  /**
   * Filter tiles in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @return {Set<Tile>}
   */
  _filterTilesByVisionPolygon(visionPolygon, tiles) {
    tiles ??= canvas.tiles.quadtree.getObjects(visionPolygon._bounds);

    // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
    if ( MODULES_ACTIVE.LEVELS && this.viewerLOS.config.type === "sight" ) {
      tiles = tiles.filter(t => !t.document?.flags?.levels?.noCollision);
    }
    return visionPolygon.filterTiles(tiles);
  }

  /**
   * Filter tokens in the scene by a triangle representing the view from viewingPoint to
   * token (or other two points). Only considers 2d top-down view.
   * Excludes the target and the visionSource token. If no visionSource, excludes any
   * token under the viewer point.
   * @return {Set<Token>}
   */
  _filterTokensByVisionPolygon(visionPolygon, target, tokens) {
    const viewer = this.viewerLOS.viewer;
    tokens ??= canvas.tokens.quadtree.getObjects(visionPolygon._bounds);

    // Filter out the viewer and target from the token set.
    tokens.delete(target);
    tokens.delete(viewer);

    // Filter tokens that directly overlaps the viewer.
    // Example: viewer is on a dragon.
    if ( viewer instanceof Token ) tokens = tokens.filter(t => tokensOverlap(viewer, t))

    // Filter tokens that directly overlaps the viewer.
    // Example: viewer is on a dragon.
    if ( viewer instanceof Token ) tokens = tokens.filter(t => tokensOverlap(viewer, t));

    // Filter all mounts and riders of both viewer and target. Possibly covered by previous test.
    const api = MODULES_ACTIVE.API.RIDEABLE;
    if ( api ) tokens = tokens.filter(t => api.RidingConnection(t, viewer)
      || api.RidingConnection(t, target));

    // Filter by the precise triangle cone
    return visionPolygon.filterTokens(tokens);
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
  destroy() {}

  /* ----- NOTE: Debug ----- */

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight() {
    this.viewerLOS.debugDraw.segment({ A: this.viewpoint, B: this.viewerLOS.target.center });
  }

  /**
   * For debugging.
   * Draw outlines for the various objects that can be detected on the canvas.
   */
  _drawDetectedObjects() {
    const draw = this.viewerLOS.debugDraw;
    const colors = Draw.COLORS;
    const { walls, tiles, terrainWalls, tokens } = this.blockingObjects;
    walls.forEach(w => draw.segment(w, { color: colors.red, fillAlpha: 0.3 }));
    tiles.forEach(t => draw.shape(t.bounds, { color: colors.yellow, fillAlpha: 0.3 }));
    terrainWalls.forEach(w => draw.segment(w, { color: colors.lightgreen }));
    tokens.forEach(t => draw.shape(t.constrainedTokenBorder, { color: colors.orange, fillAlpha: 0.3 }));
  }

  /**
   * For debugging.
   * Draw the vision triangle between viewer point and target.
   */
  _drawVisionTriangle() {
    const draw = this.viewerLOS.debugDraw;
    draw.shape(this.visionPolygon, { width: 0, fill: Draw.COLORS.lightblue, fillAlpha: 0.2 });
  }
}