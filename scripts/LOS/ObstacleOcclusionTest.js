/* globals
CONST,
CONFIG,
Wall,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID, OTHER_MODULES } from "../const.js";
import { VisionTriangle } from "./VisionTriangle.js";
import { AbstractPolygonTrianglesID } from "./PlaceableTriangles.js";
import {
  NULL_SET,
  tokensOverlap,
  getFlagFast } from "./util.js";

export class ObstacleOcclusionTest {
  target;

  rayOrigin = new CONFIG.GeometryLib.threeD.Point3d();

  obstacles = {};

  config = {
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

  _initialize(rayOrigin, target) {
    this.rayOrigin.copyFrom(rayOrigin);
    this.target = target;
    this.findObstacles();
    this.constructObstacleTester();
  }

  rayIsOccluded(rayOrigin, rayDirection, target) {
    this._initialize(rayOrigin, target)
    return this._rayIsOccluded(rayDirection);
  }

  // Can use this method if the target point (rayDirection) is still within the target bounds.
  // Obstacles are filtered based on the vision triangle from origin to the target bounds.
  _rayIsOccluded(rayDirection) {
    return this.obstacleTester(this.rayOrigin, rayDirection);
  }

  findObstacles() {
    const senseType = this.config.senseType;
    this.obstacles = this.constructor.findBlockingObjects(this.rayOrigin, this.target, this.config);
    this.obstacles.terrainWalls = this.constructor.pullOutTerrainWalls(this.obstacles.walls, senseType);
    this.obstacles.proximateWalls = this.constructor.pullOutTerrainWalls(this.obstacles.walls, senseType);
  }

  obstacleTester;

  constructObstacleTester() {
    // Wouldn't really need this but for the tile alpha test. Obstacle found should follow the blocking config.
    const blocking = this.config.blocking;
    const fnNames = [];
    if ( blocking.walls ) fnNames.push("wallsOcclude", "terrainWallsOcclude", "proximateWallsOcclude");
    if ( blocking.tiles ) {
      if ( CONFIG[MODULE_ID].alphaThreshold ) fnNames.push("alphaTilesOcclude");
      else fnNames.push("tilesOcclude");
    }
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
    return this.obstacles.walls.some(wall => wall.rayIntersection(rayOrigin, rayDirection) !== null);
  }

  terrainWallsOcclude(rayOrigin, rayDirection) {
    let limitedOcclusion = 0;
    for ( const wall of this.obstacles.terrainWalls ) {
      if ( wall.rayIntersection(rayOrigin, rayDirection) === null ) continue;
      if ( limitedOcclusion++ ) return true;
    }
    return false;
  }

  proximateWallsOcclude(rayOrigin, rayDirection) {
    for ( const wall of this.obstacles.proximateWalls ) {
      // If the proximity threshold is met, this edge excluded from perception calculations.
      if ( wall.edge.applyThreshold(this.config.senseType, rayOrigin) ) continue;
      if ( wall.rayIntersection(rayOrigin, rayDirection) !== null ) return true;
    }
    return false;
  }

  tilesOcclude(rayOrigin, rayDirection) {
    return this.obstacles.tiles.some(tile => tile.rayIntersection(rayOrigin, rayDirection));
  }

  alphaTilesOcclude(rayOrigin, rayDirection) {
    return this.obstacles.tiles.some(tile => {
      const t = tile.rayIntersectionAlpha(rayOrigin, rayDirection);
      if ( t === null ) return false;
      return tile.alphaThresholdTest(rayOrigin, rayDirection, t);
    });
  }

  tokensOcclude(rayOrigin, rayDirection) {
    return this.obstacles.tokens.some(token => token.rayIntersection(rayOrigin, rayDirection));
  }

  regionsOcclude(rayOrigin, rayDirection) {
    return this.obstacles.regions.some(region => region.rayIntersection(rayOrigin, rayDirection));
  }

  // ----- NOTE: Static collision tests ----- //

  /** @type {VisionTriangle} */
  static visionTriangle = new VisionTriangle();

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
  static findBlockingObjects(viewpoint, target, opts = {}) {
    const visionTri = this.visionTriangle.rebuild(viewpoint, target);
    opts.blocking ??= {};
    opts.senseType ??= "sight";
    opts.target ??= target;
    return {
      walls: this.findBlockingWalls(visionTri, opts),
      tiles: this.findBlockingTiles(visionTri, opts),
      tokens: this.findBlockingTokens(visionTri, opts),
      regions: this.findBlockingRegions(visionTri, opts),
    }
  }

  /**
   * Pull out terrain walls from a set of walls.
   * @param {Set<Wall>} walls       Set of walls to divide
   * @param {string} [senseType="sight"]    Restriction type to test
   * @returns {Set<Wall>}  Modifies walls set *in place* and returns terrain walls.
   */
  static pullOutTerrainWalls(walls, senseType = "sight") {
    if ( !walls.size ) return NULL_SET;
    const terrainWalls = new Set();
    walls.forEach(w => {
      if ( w.document[senseType] === CONST.WALL_SENSE_TYPES.LIMITED ) {
        walls.delete(w);
        terrainWalls.add(w);
      }
    });
    return terrainWalls;
  }

  /**
   * Pull out threshold walls from a set of walls. Both proximate and reverse.
   * @param {Set<Wall>} walls       Set of walls to divide
   * @param {string} [senseType="sight"]    Restriction type to test
   * @returns {Set<Wall>}  Modifies walls set *in place* and returns proximate/reverse walls.
   */
  static pullOutProximateWalls(walls, senseType = "sight") {
    if ( !walls.size ) return NULL_SET;
    const proximateWalls = new Set();
    walls.forEach(w => {
      if ( w.document[senseType] >= CONST.WALL_SENSE_TYPES.PROXIMATE ) {
        walls.delete(w);
        proximateWalls.add(w);
      }
    });
    return proximateWalls;
  }

  static findBlockingWalls(visionTri, { senseType = "sight", blocking = {} } = {}) {
    blocking.walls ??= true;
    if ( !blocking.walls ) return NULL_SET;
    return this.filterWallsByVisionTriangle(visionTri, { senseType });
  }

  static findBlockingTiles(visionTri, { senseType = "sight", blocking = {} } = {}) {
    blocking.tiles ??= true;
    return blocking.tiles ?  this.filterTilesByVisionTriangle(visionTri, { senseType }) : NULL_SET;
  }

  static findBlockingTokens(visionTri, { viewer, target, blocking = {} } = {}) {
    blocking.tokens ??= {};
    blocking.tokens.live ??= true;
    blocking.tokens.dead ??= true;
    return ( blocking.tokens.live || blocking.tokens.dead )
      ? this.filterTokensByVisionTriangle(visionTri, { viewer, target, blockingTokensOpts: blocking.tokens })
      : NULL_SET;
  }

  static findBlockingRegions(visionTri, { senseType = "sight", blocking = {} } = {}) {
    blocking.regions ??= true;
    return blocking.regions ? this.filterRegionsByVisionTriangle(visionTri, { senseType }) : NULL_SET;
  }

  /**
   * Filter regions in the scene by a triangle representing the view from viewingPoint to
   * target (or other two points). Only considers 2d top-down view.
   * @returns {Set<Region>}
   */
  static filterRegionsByVisionTriangle(visionTri, { senseType = "sight" } = {}) {
    if ( !CONFIG[MODULE_ID].regionsBlock ) return NULL_SET;

    const regions = visionTri.findRegions();
    const TM = OTHER_MODULES.TERRAIN_MAPPER;

    if ( !TM.ACTIVE ) return regions;
    return visionTri.findRegions().filter(r => {
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
  static filterTokensByVisionTriangle(visionTri, {
    viewer,
    target,
    blockingTokensOpts }) {

    let tokens = visionTri.findTokens();

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
    const polys = placeable[MODULE_ID][AbstractPolygonTrianglesID].triangles;
    return polys.filter(poly => poly.isFacing(viewpoint));
  }

}