/* globals
CONST,
CONFIG,
Wall,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LOS folder
import { Frustum } from "./Frustum.js";
import {
  NULL_SET,
  tokensOverlap,
  getFlagFast } from "./util.js";

// Base folder
import { MODULE_ID, OTHER_MODULES, TRACKER_IDS } from "../const.js";

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

  _initialize({ rayOrigin, viewer, target } = {}) {
    if ( rayOrigin ) this.rayOrigin.copyFrom(rayOrigin);
    if ( viewer ) this.viewer = viewer;
    if ( target ) this.target = target;
    this.findObstacles();
    this.constructObstacleTester();
  }

  rayIsOccluded(rayOrigin, rayDirection, { viewer, target } = {}) {
    this._initialize({ rayOrigin, viewer, target })
    return this._rayIsOccluded(rayDirection);
  }

  // Can use this method if the target point (rayDirection) is still within the target bounds.
  // Obstacles are filtered based on the vision triangle from origin to the target bounds.
  _rayIsOccluded(rayDirection) {
    return this.obstacleTester(this.rayOrigin, rayDirection);
  }

  findObstacles() {
    const senseType = this._config.senseType;
    this.obstacles = this.constructor.findBlockingObjects(this.rayOrigin, { target: this.target, viewer: this.viewer, ...this.config });
    this.obstacles.terrainWalls = this.constructor.pullOutWalls(this.obstacles.walls, CONST.WALL_SENSE_TYPES.LIMITED, senseType);
    this.obstacles.proximateWalls = this.constructor.pullOutWalls(this.obstacles.walls, CONST.WALL_SENSE_TYPES.PROXIMITY, senseType);
    this.obstacles.reverseProximateWalls = this.constructor.pullOutWalls(this.obstacles.walls, CONST.WALL_SENSE_TYPES.DISTANCE, senseType);
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
    return this.obstacles.walls.some(wall => wall[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection) !== null);
  }

  terrainWallsOcclude(rayOrigin, rayDirection) {
    let limitedOcclusion = 0;
    for ( const wall of this.obstacles.terrainWalls ) {
      if ( wall[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection) === null ) continue;
      if ( limitedOcclusion++ ) return true;
    }
    return false;
  }

  proximateWallsOcclude(rayOrigin, rayDirection) {
    for ( const wall of [...this.obstacles.proximateWalls, ...this.obstacles.reverseProximateWalls] ) {
      // If the proximity threshold is met, this edge excluded from perception calculations.
      if ( wall.edge.applyThreshold(this._config.senseType, rayOrigin) ) continue;
      if ( wall[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection) !== null ) return true;
    }
    return false;
  }

  tilesOcclude(rayOrigin, rayDirection) {
    return this.obstacles.tiles.some(tile => tile[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection));
  }

  tokensOcclude(rayOrigin, rayDirection) {
    return this.obstacles.tokens.some(token => token[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection));
  }

  regionsOcclude(rayOrigin, rayDirection) {
    return this.obstacles.regions.some(region => region[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].rayIntersection(rayOrigin, rayDirection));
  }

  // ----- NOTE: Static collision tests ----- //

  /** @type {Frustum} */
  static frustum = new Frustum();

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
  static findBlockingObjects(viewpoint, opts = {}) {
    const frustum = this.frustum.rebuild({ viewpoint, target: opts.target });
    opts.blocking ??= {};
    opts.senseType ??= "sight";
    return {
      walls: this.findBlockingWalls(frustum, opts),
      tiles: this.findBlockingTiles(frustum, opts),
      tokens: this.findBlockingTokens(frustum, opts),
      regions: this.findBlockingRegions(frustum, opts),
    }
  }

  /**
   * Pull out terrain walls from a set of walls.
   * @param {Set<Wall>} walls               Set of walls to divide
   * @param {CONST.WALL_SENSE_TYPES}        What type of wall to pull out
   * @param {string} [senseType="sight"]    Restriction type to test
   * @returns {Set<Wall>}  Modifies walls set *in place* and returns terrain walls.
   */
  static pullOutWalls(walls, wallType = CONST.WALL_SENSE_TYPES.LIMITED, senseType = "sight") {
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

  static findBlockingWalls(frustum, { senseType = "sight", blocking = {} } = {}) {
    blocking.walls ??= true;
    if ( !blocking.walls ) return NULL_SET;
    return this.filterWallsByFrustum(frustum, { senseType });
  }

  static findBlockingTiles(frustum, { senseType = "sight", blocking = {} } = {}) {
    blocking.tiles ??= true;
    return blocking.tiles ?  this.filterTilesByFrustum(frustum, { senseType }) : NULL_SET;
  }

  static findBlockingTokens(frustum, { viewer, target, blocking = {} } = {}) {
    blocking.tokens ??= {};
    blocking.tokens.live ??= true;
    blocking.tokens.dead ??= true;
    return ( blocking.tokens.live || blocking.tokens.dead )
      ? this.filterTokensByFrustum(frustum, { viewer, target, blockingTokensOpts: blocking.tokens })
      : NULL_SET;
  }

  static findBlockingRegions(frustum, { senseType = "sight", blocking = {} } = {}) {
    blocking.regions ??= true;
    return blocking.regions ? this.filterRegionsByFrustum(frustum, { senseType }) : NULL_SET;
  }

  /**
   * Filter regions in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @returns {Set<Region>}
   */
  static filterRegionsByFrustum(frustum, { senseType = "sight" } = {}) {
    if ( !CONFIG[MODULE_ID].regionsBlock ) return NULL_SET;

    const regions = frustum.findRegions();
    const TM = OTHER_MODULES.TERRAIN_MAPPER;

    if ( !TM.ACTIVE ) return regions;
    return frustum.findRegions().filter(r => {
      const senseTypes = new Set(getFlagFast(r.document, TM.KEY, TM.FLAGS.REGION.WALL_RESTRICTIONS) || []);
      if ( senseType === "move" && senseTypes.has("cover") ) return true; // Treat all move restrictions as physical cover; same as with walls.
      return senseTypes.has(senseType);
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
    if ( LEVELS.ACTIVE && senseType === "sight" ) {
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
  static filterTokensByFrustum(frustum, {
    viewer,
    target,
    blockingTokensOpts }) {

    let tokens = frustum.findTokens();

    // Filter out the viewer and target from the token set.
    // Filter all mounts and riders of both viewer and target. Possibly covered by previous test.
    const api = OTHER_MODULES.RIDEABLE.API;
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
    const geometry = placeable[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE];
    return [...geometry.iterateFaces()].filter(poly => poly.isFacing(viewpoint));
  }

  /**
   * For debugging.
   * Draw the vision triangle between viewer point and target.
   */
  _drawFrustum(draw) {
    const { viewpoint, target } = this;
    const frustum = this.constructor.frustum.rebuild({ viewpoint, target });
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
          const tileOpts = CONFIG[MODULE_ID].tileThresholdShapeOptions;
          const drawOpts = { draw, color, fillAlpha: 0.1, fill: color };
          switch ( CONFIG[MODULE_ID].tileThresholdShape ) {
            case tileOpts.RECTANGLE:
              obstacles.forEach(tile => tile[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].faces.top.draw2d(drawOpts));
              break;
            case tileOpts.ALPHA_TRIANGLES:
              obstacles.forEach(tile => tile[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].alphaThresholdTriangles.top.draw2d(drawOpts));
              break;
            case tileOpts.ALPHA_POLYGONS:
              obstacles.forEach(tile => tile[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].alphaThresholdPolygons.top.draw2d(drawOpts));
              break;
          }
          break;
        }
        case "tokens":
          obstacles.forEach(token => draw.shape(token.constrainedTokenBorder, { color, fillAlpha: 0.2 }));
          break;
        case "regions":
          obstacles.forEach(region => region[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE]
            .faces.top.draw2d(drawOpts));
          break;
      }
    }
  }

}