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
import { MODULES_ACTIVE, MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// LOS folder
import { VisionPolygon, VisionTriangle } from "./VisionPolygon.js";
import { AbstractPolygonTriangles } from "./PlaceableTriangles.js";

import {
  insetPoints,
  tokensOverlap,
  getObjectProperty } from "./util.js";

// Debug
import { Draw } from "../geometry/Draw.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 */
export class AbstractViewpoint {

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
    this.viewpointDiff = viewpoint.subtract(viewerLOS.center);
    this.config = this.initializeConfig();

    // Hide initialized property so we can iterate the object.
    Object.defineProperty(this.#blockingObjects, "initialized", { enumerable: false});
  }

  /**
   * Sets configuration to the current settings.
   * @param {ViewpointConfig} [cfg]
   * @returns {ViewpointConfig}
   */
  initializeConfig(cfg = {}) { return cfg; }

  /** @type {Point3d} */
  get viewpoint() { return this.viewerLOS.center.add(this.viewpointDiff); }

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
  percentVisible() {
    const percent = this._simpleVisibilityTest() ?? this._percentVisible();
    if ( this.viewerLOS.config.debug ) console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t@viewpoint ${this.viewpoint.toString()}`)
    return percent;
  }

  async percentVisibleAsync() {
    const percent = this._simpleVisibilityTest() ?? (await this._percentVisible());
    if ( this.viewerLOS.config.debug ) console.debug(`\t${Math.round(percent * 100 * 10)/10}%\t@viewpoint ${this.viewpoint.toString()}`)
    return percent;
  }

  /** @override */
  _percentVisible() { return 1; }

  async _percentVisibleAsync() { return this._percentVisible(); }

  /**
   * Clear any cached values related to the target or target location.
   */
  clearCache() {
    this.#blockingObjects.initialized = false;
    Object.values(this.#blockingObjects).forEach(objs => objs.clear());
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
   * Holds Foundry objects that are within the vision triangle.
   * @typedef BlockingObjects
   * @type {object}
   * @property {Set<Wall>}    terrainWalls
   * @property {Set<Tile>}    tiles
   * @property {Set<Token>}   tokens
   * @property {Set<Wall>}    walls
   */
  #blockingObjects = {
    terrainWalls: new Set(),
    tiles: new Set(),
    tokens: new Set(),
    walls: new Set(),
    initialized: false
  };

  get blockingObjects() {
    if ( !this.#blockingObjects.initialized ) this.findBlockingObjects();
    // console.debug(`Blocking: \n\twalls: ${this.#blockingObjects.walls.size}\n\ttiles: ${this.#blockingObjects.tiles.size}\n\ttokens: ${this.#blockingObjects.tokens.size}`);
    // console.debug(`Blocking walls: ${[...this.#blockingObjects.walls].map(w => w.id).join(", ")}`);

    return this.#blockingObjects;
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
  findBlockingObjects() {
    const target = this.viewerLOS.target;
    if ( !target ) throw Error(`${MODULE_ID}|AbstractViewpoint|findBlockingObjects target is undefined!`);

    const blocking = this.viewerLOS.config.block;

    // Remove old blocking objects.
    const blockingObjs = this.#blockingObjects;
    Object.values(blockingObjs).forEach(objs => objs.clear());

    const visionPolygon = VisionTriangle.build(this.viewpoint, target);
    if ( blocking.walls ) blockingObjs.walls = this._filterWallsByVisionPolygon(visionPolygon);
    if ( blocking.tiles ) blockingObjs.tiles = this._filterTilesByVisionPolygon(visionPolygon);
    if ( blocking.tokens.live || blocking.tokens.dead ) blockingObjs.tokens = this._filterTokensByVisionPolygon(visionPolygon);

    // Separate walls into terrain and normal.
    blockingObjs.walls.forEach(w => {
      if ( w.document[this.viewerLOS.config.type] === CONST.WALL_SENSE_TYPES.LIMITED ) {
        blockingObjs.walls.delete(w);
        blockingObjs.terrainWalls.add(w);
      }
    });
    this.#blockingObjects.initialized = true;
    return blockingObjs;
  }

  /**
   * Filter walls in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @return {Set<Wall>}
   */
  _filterWallsByVisionPolygon(visionPolygon) {
    return visionPolygon.findWalls()
      // Ignore walls that are not blocking for the type.
      // Ignore walls with open doors.
      .filter(w => w.document[this.viewerLOS.config.type] && !w.isOpen);
  }

  /**
   * Filter tiles in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @return {Set<Tile>}
   */
  _filterTilesByVisionPolygon(visionPolygon) {
    const tiles = visionPolygon.findTiles();

    // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
    if ( MODULES_ACTIVE.LEVELS && this.viewerLOS.config.type === "sight" ) {
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
  _filterTokensByVisionPolygon(visionPolygon) {
    const viewer = this.viewerLOS.viewer;
    const target = this.viewerLOS.target;
    let tokens = visionPolygon.findTokens();

    // Filter out the viewer and target from the token set.
    tokens.delete(target);
    tokens.delete(viewer);

    // Filter tokens that directly overlaps the viewer.
    // Example: viewer is on a dragon.
    if ( viewer instanceof Token ) tokens = tokens.filter(t => tokensOverlap(viewer, t))

    // Filter all mounts and riders of both viewer and target. Possibly covered by previous test.
    const api = MODULES_ACTIVE.API.RIDEABLE;
    if ( api ) tokens = tokens.filter(t => api.RidingConnection(t, viewer) || api.RidingConnection(t, target));

    // Filter live or dead tokens.
    const { live: liveTokensBlock, dead: deadTokensBlock, prone: proneTokensBlock } = this.viewerLOS.config.block.tokens;
    if ( liveTokensBlock ^ deadTokensBlock ) {
      const tokenHPAttribute = Settings.get(Settings.KEYS.TOKEN_HP_ATTRIBUTE)
      tokens = tokens.filter(t => {
        const hp = getObjectProperty(t.actor, tokenHPAttribute);
        if ( typeof hp !== "number" ) return true;
        if ( liveTokensBlock && hp > 0 ) return true;
        if ( deadTokensBlock && hp <= 0 ) return true;
        return false;
      });
    }

    // Filter prone tokens.
    if ( !proneTokensBlock ) tokens = tokens.filter(t => !t.isProne);

    return tokens;
  }

  _filterPlaceableTrianglesByViewpoint(placeable) {
    return placeable[AbstractPolygonTriangles.ID].triangles
      .filter(tri => tri.isFacing(this.viewpoint));
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
    Object.values(this.#blockingObjects).forEach(objs => objs.clear());
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
    debugDraw.shape(this.visionPolygon, { width: 0, fill: Draw.COLORS.gray, fillAlpha: 0.1 });
    console.log("Drawing vision triangle.")
  }
}