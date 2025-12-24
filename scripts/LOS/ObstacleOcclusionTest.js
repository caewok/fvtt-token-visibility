/* globals
CONST,
CONFIG,
Wall,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LOS folder
import { OTHER_MODULES, TRACKER_IDS, TILE_THRESHOLD_SHAPE_OPTIONS } from "./const.js";
import { Frustum } from "./Frustum.js";
import {
  NULL_SET,
  tokensOverlap,
  getFlagFast } from "./util.js";

// Base folder
import { MODULE_ID } from "../const.js";

// Geometry
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";


export class ObstacleOcclusionTest {
  obstacles = {
    tiles: NULL_SET,
    tokens: NULL_SET,
    regions: NULL_SET,
    walls: NULL_SET,
    terrainWalls: NULL_SET,
    proximateWalls: NULL_SET,
    reverseProximateWalls: NULL_SET,
  };

  /** @type {Frustum} */
  frustum = new Frustum();

  /** @type {CalculatorConfig} */
  _config = {
    senseType: "sight",
    blocking: {
      walls: true,
      tiles: true,
      regions: true,
      tokens: {
        dead: false,
        live: false,
        prone: false,
      }
    },
  };

  get config() { return structuredClone(this._config); }

  /** @type {Token} */
  target;

  /** @type {Token} */
  viewer;

  /** @type {Point3d} */
  rayOrigin = new Point3d();

  get viewpoint() { return this.rayOrigin; }

  _initialize({ rayOrigin, viewer, target, viewpoint } = {}) {
    // console.debug("ObstacleOcclusionTest|_initialize");
    if ( viewpoint ) this.rayOrigin.copyFrom(viewpoint);
    if ( rayOrigin ) this.rayOrigin.copyFrom(rayOrigin);
    if ( viewer ) this.viewer = viewer;
    if ( target ) this.target = target;
    this.frustum.rebuild({ viewpoint: this.viewpoint, target: this.target });
    this.findObstacles();
    this.constructObstacleTester();
  }

  rayIsOccluded(rayOrigin, rayDirection, { viewer, target } = {}) {
    // console.debug("ObstacleOcclusionTest|rayIsOccluded");
    this._initialize({ rayOrigin, viewer, target })
    return this._rayIsOccluded(rayDirection);
  }

  // Can use this method if the target point (rayDirection) is still within the target bounds.
  // Obstacles are filtered based on the vision triangle from origin to the target bounds.
  _rayIsOccluded(rayDirection) {
    // console.debug("ObstacleOcclusionTest|_rayIsOccluded");
    return this.obstacleTester.call(this, this.rayOrigin, rayDirection);
  }

  findObstacles() {
    const senseType = this._config.senseType;
    this.findBlockingObjects();
    this.obstacles.terrainWalls = this.constructor.subsetWallsByType(this.obstacles.walls, CONST.WALL_SENSE_TYPES.LIMITED, senseType);
    this.obstacles.proximateWalls = this.constructor.subsetWallsByType(this.obstacles.walls, CONST.WALL_SENSE_TYPES.PROXIMITY, senseType);
    this.obstacles.reverseProximateWalls = this.constructor.subsetWallsByType(this.obstacles.walls, CONST.WALL_SENSE_TYPES.DISTANCE, senseType);
  }

  obstacleTester;

  constructObstacleTester() {
    // Obstacle found should follow the blocking config.
    const blocking = this._config.blocking;
    const fnNames = [];
    if ( blocking.walls ) fnNames.push("wallsOcclude", "terrainWallsOcclude", "proximateWallsOcclude");
    if ( blocking.tiles ) fnNames.push("tilesOcclude");
    if ( blocking.tokens.dead || blocking.tokens.live || blocking.tokens.prone ) fnNames.push("tokensOcclude");
    if ( blocking.regions ) fnNames.push("regionsOcclude");
    this.obstacleTester = this.#occlusionTester(fnNames);
  }

  // see https://nikoheikkila.fi/blog/layman-s-guide-to-higher-order-functions/
  #occlusionTester(fnNames) {
    return function(rayOrigin, rayDirection) {
      return fnNames.some(name => this[name](rayOrigin, rayDirection))
    }
  }

  wallsOcclude(rayOrigin, rayDirection) {
    return this.obstacles.walls.some(wall => wall[TRACKER_IDS.BASE][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection, 0, 1) !== null);
  }

  terrainWallsOcclude(rayOrigin, rayDirection) {
    // console.debug(`rayOrigin ${rayOrigin}, rayDirection ${rayDirection} for ${this.obstacles.terrainWalls.size} terrain walls.`);
    let limitedOcclusion = 0;
    for ( const wall of this.obstacles.terrainWalls ) {
      if ( wall[TRACKER_IDS.BASE][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection, 0, 1) === null ) continue;
      if ( limitedOcclusion++ ) return true;
    }
    return false;
  }

  proximateWallsOcclude(rayOrigin, rayDirection) {
    for ( const wall of [...this.obstacles.proximateWalls, ...this.obstacles.reverseProximateWalls] ) {
      // If the proximity threshold is met, this edge excluded from perception calculations.
      if ( wall.edge.applyThreshold(this._config.senseType, rayOrigin) ) continue;
      if ( wall[TRACKER_IDS.BASE][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection, 0, 1) !== null ) return true;
    }
    return false;
  }

  tilesOcclude(rayOrigin, rayDirection) {
    return this.obstacles.tiles.some(tile => tile[TRACKER_IDS.BASE][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection, 0, 1));
  }

  tokensOcclude(rayOrigin, rayDirection) {
    return this.obstacles.tokens.some(token => token[TRACKER_IDS.BASE][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection, 0, 1));
  }

  regionsOcclude(rayOrigin, rayDirection) {
    return this.obstacles.regions.some(region => region[TRACKER_IDS.BASE][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection, 0, 1));
  }

  filterPolys3d(polys) { return polys.filter(poly => this.frustum.poly3dWithinFrustum(poly)); }

  // ----- NOTE: Collision tests ----- //

  /**
   * Filter relevant objects in the scene using the vision triangle.
   * For the z dimension, keeps objects that are between the lowest target point,
   * highest target point, and the viewing point.
   * @returns {object} Object with possible properties:
   *   - @property {Set<Wall>} walls
   *   - @property {Set<Tile>} tiles
   *   - @property {Set<Token>} tokens
   *   - @property {Set<Region>} regions
   */
  findBlockingObjects() {
    this.findBlockingWalls();
    this.findBlockingTiles();
    this.findBlockingTokens();
    this.findBlockingRegions();
  }

  /**
   * Pull out terrain walls or other wall types from a set of walls.
   * @param {Set<Wall>} walls               Set of walls to divide
   * @param {CONST.WALL_SENSE_TYPES}        What type of wall to pull out
   * @param {string} [senseType="sight"]    Restriction type to test
   * @returns {Set<Wall>}  Modifies walls set *in place* and returns terrain walls.
   */
  static subsetWallsByType(walls, wallType = CONST.WALL_SENSE_TYPES.LIMITED, senseType = "sight") {
    if ( !walls.size ) return NULL_SET;
    const wallSubset = new Set();
    walls
      .filter(w => w.document[senseType] === wallType)
      .forEach(w => {
        walls.delete(w);
        wallSubset.add(w);
      });
    return wallSubset;
  }

  findBlockingWalls() {
    this.obstacles.walls = this._config.blocking.walls
      ? this.constructor.filterWallsByFrustum(this.frustum, { senseType: this._config.senseType })
      : NULL_SET;
  }

  findBlockingTiles() {
    this.obstacles.tiles = this._config.blocking.tiles
      ? this.constructor.filterTilesByFrustum(this.frustum, { senseType: this._config.senseType })
      : NULL_SET;
  }

  findBlockingTokens() {
    if ( !(this._config.blocking.tokens.live || this._config.blocking.tokens.dead) ) {
      this.obstacles.tokens = NULL_SET;
      return;
    }

    // Locate tokens but exclude the target and viewer.
    this.obstacles.tokens = this.constructor.filterTokensByFrustum(this.frustum, { senseType: this._config.senseType });
    this.obstacles.tokens.delete(this.target);
    this.obstacles.tokens.delete(this.viewer);
    if ( !this.obstacles.tokens.size ) return; // Avoid processing below exceptions.

    // Filter all mounts and riders of both viewer and target.
    const RIDEABLE = OTHER_MODULES.RIDEABLE;
    if ( RIDEABLE ) {
      this.obstacles.tokens = this.obstacles.tokens.filter(t =>
        !(RIDEABLE.API.RidingConnection(t, this.target) || RIDEABLE.API.RidingConnection(t, this.viewer)));
    }

    // Test for dead/live/prone.
    this.obstacles.tokens = this.obstacles.tokens.filter(t => this.includeToken(t));
  }

  includeToken(token) {
    if ( this._config.blocking.tokens.dead && CONFIG[MODULE_ID].tokenIsDead(token) ) return true;
    if ( this._config.blocking.tokens.live && CONFIG[MODULE_ID].tokenIsAlive(token) ) return true;
    if ( this._config.blocking.tokens.prone && token.isProne ) return true;
    return false;
  }

  findBlockingRegions() {
    this.obstacles.regions = this._config.blocking.regions
      ? this.constructor.filterRegionsByFrustum(this.frustum, { senseType: this._config.senseType })
      : NULL_SET;

  }

  /**
   * Filter regions in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @returns {Set<Region>}
   */
  static filterRegionsByFrustum(frustum, { senseType = "sight" } = {}) {
    if ( !CONFIG[MODULE_ID].regionsBlock ) return NULL_SET;

    const regions = frustum.findRegions();
    if ( !OTHER_MODULES.TERRAIN_MAPPER ) return regions;

    // If Terrain Mapper is active, consider the region blocking if its wall type blocks sight.
    // TODO: Should handle limited and proximate wall types.
    return frustum.findRegions().filter(r => {
      for ( const behavior of r.document.behaviors ) {
        if ( behavior.type !== "terrainmapper.blockingWalls" ) continue;
        if ( behavior.system.types.sight > 0 ) return true;
      }
      return false;
    });
  }

  /**
   * Filter walls in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @returns {Set<Wall>}
   */
  static filterWallsByFrustum(frustum, { senseType = "sight" } = {}) {
    // Ignore walls that are not blocking for the type.
    // Ignore walls with open doors.
    return frustum.findWalls().filter(w => w.document[senseType] && !w.isOpen);
  }

  static filterEdgesByFrustum(frustum, { senseType = "sight" } = {}) {
    // Ignore edges that are not blocking for the type.
    // Ignore edges that are walls with open doors.
    return frustum.findEdges().filter(e => e[senseType] && !(e.object instanceof Wall && e.object.isOpen));
  }

  /**
   * Filter tiles in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @returns {Set<Tile>}
   */
  static filterTilesByFrustum(frustum, { senseType = "sight" } = {}) {
    const tiles = frustum.findTiles();

    // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
    const LEVELS = OTHER_MODULES.LEVELS;
    if ( LEVELS && senseType === "sight" ) {
      return tiles.filter(t => !getFlagFast(t.document, LEVELS.KEY, LEVELS.FLAGS.ALLOW_SIGHT));
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
  static filterTokensByFrustum(frustum) { return frustum.findTokens(); }

  /**
   * For debugging.
   * Draw the vision triangle between viewer point and target.
   */
  _drawFrustum(draw) {
    const { viewpoint, target } = this;
    const frustum = this.frustum.rebuild({ viewpoint, target });
    frustum.draw2d({ draw, width: 0, fill: Draw.COLORS.gray, fillAlpha: 0.1 });
  }

  /**
   * For debugging.
   * Draw outlines for the various objects that can be detected on the canvas.
   */
  _drawDetectedObjects(draw) {
    const colors = Draw.COLORS;
    const OBSTACLE_COLORS = {
      walls: colors.lightred,
      terrainWalls: colors.lightgreen,
      proximateWalls: colors.lightblue,
      tiles: colors.yellow,
      tokens: colors.orange,
      regions: colors.red,
    }
    for ( const [key, obstacles] of Object.entries(this.obstacles) ) {
      const color = OBSTACLE_COLORS[key];
      const drawOpts = { draw, color, fillAlpha: 0.1, fill: color };
      switch ( key ) {
        case "walls":
        case "terrainWalls":
        case "proximateWalls":
          obstacles.forEach(wall => draw.segment(wall, { color }));
          break;
        case "tiles": {
          const drawOpts = { draw, color, fillAlpha: 0.1, fill: color };
          let label;
          switch ( CONFIG[MODULE_ID].tileThresholdShape || TILE_THRESHOLD_SHAPE_OPTIONS.RECTANGLE ) {
            case TILE_THRESHOLD_SHAPE_OPTIONS.RECTANGLE:
              obstacles.forEach(tile => tile[TRACKER_IDS.BASE][TRACKER_IDS.GEOMETRY.PLACEABLE].faces.top.draw2d(drawOpts));
              break;
            case TILE_THRESHOLD_SHAPE_OPTIONS.ALPHA_TRIANGLES: label = "alphaThresholdTriangles";
            case TILE_THRESHOLD_SHAPE_OPTIONS.ALPHA_POLYGONS:
              label ??= "alphaThresholdPolygons";
              obstacles.forEach(tile => {
                const polygons3d = tile[TRACKER_IDS.BASE][TRACKER_IDS.GEOMETRY.PLACEABLE][label].top.clone();
                polygons3d.polygons = this.filterPolys3d(polygons3d.polygons);
                polygons3d.draw2d(drawOpts);
              });
              break;
          }
          break;
        }
        case "tokens":
          obstacles.forEach(token => draw.shape(token.constrainedTokenBorder, { color, fillAlpha: 0.2 }));
          break;
        case "regions":
          obstacles.forEach(region => region[TRACKER_IDS.BASE][TRACKER_IDS.GEOMETRY.PLACEABLE]
            .faces.top.draw2d(drawOpts));
          break;
      }
    }
  }

}