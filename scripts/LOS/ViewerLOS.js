/* globals
canvas,
ClipperLib,
CONFIG,
CONST,
foundry,
LimitedAnglePolygon,
PIXI,
Ray,
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULES_ACTIVE, MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// LOS folder

// Geometry folder

/**
 * @typedef {object} TokenBlockingConfig    Whether tokens block LOS
 * @property {boolean} dead                 Do dead tokens block?
 * @property {boolean} live                 Do live tokens block?
 * @property {boolean} prone                Do prone tokens block?
 */

/**
 * @typedef {object} BlockingConfig     Whether different objects block LOS
 * @property {boolean} walls                Do walls block?
 * @property {boolean} tiles                Do tiles block?
 * @property {TokenBlockingConfig} tokens   Do tokens block?
 */

/**
 * @typedef {object} ViewerLOSConfig  Configuration settings for this class.
 * @property {CONST.WALL_RESTRICTION_TYPES} type    Type of source (light, sight, etc.)
 * @property {BlockingConfig} blocking              Do various canvas objects block?
 * @property {Point3d} visionOffset                 Offset delta from the viewer center for vision point
 * @property {boolean} largeTarget                  Use special handling for targets larger than grid square
 * @property {number} threshold                     Numeric threshold for determining LOS from percent visible
 * @property {PIXI.Polygon} visibleTargetShape      Portion of the token shape that is visible
 * @property {boolean} useLitTargetShape            Should the illuminated target shape be used?
 */

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 */
export class AbstractViewpointLOS {

  /** @type {ViewerLOS} */
  viewer;

  /** @type {Point3d} */
  viewpointDiff;

  /**
   * @param {ViewerLOS} viewer      The viewer that controls this "eye"
   * @param {Point3d} viewpointDiff     The location of the eye relative to the viewer
   */
  constructor(viewer, viewpointDiff) {
    this.viewer = viewer;
    this.viewpointDiff = viewpointDiff;
  }

  /** @type {Point3d} */
  get viewpoint() { return this.viewer.center.add(viewpointDiff); }

  /**
   * The viewable area between viewer and target.
   * Typically, this is a triangle, but if viewed head-on, it will be a triangle
   * with the portion of the target between viewer and target center added on.
   * @typedef {PIXI.Polygon} visionPolygon
   * @property {Segment[]} edges
   * @property {PIXI.Rectangle} bounds
   */
  #visionPolygon;

  get visionPolygon() {
    return (this.#visionPolygon ??= VisionPolygon.build(this.viewpoint, this.viewer.target));
  }

  /**
   * Determine percentage of the token visible using the class methodology.
   * @param {Token} target
   * @returns {number}
   */
  percentVisible(target) {
    return this._simpleVisibilityTest(target) ?? this._percentVisible(target)
  }

  /** @override */
  _percentVisible(target) { return 1; }

  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} target
   * @returns {0|1|undefined} 1.0 for visible; Undefined if obstacles present or target intersects the vision rays.
   */
  _simpleVisibilityTest(target) {
    const { viewer, viewpoint } = viewpoint;

    // If directly overlapping.
    if ( target.bounds.contains(viewpoint) ) return 1;

    // Treat the scene background as fully blocking, so basement tokens don't pop-up unexpectedly.
    const backgroundElevation = canvas.scene.flags?.levels?.backgroundElevation || 0;
    if ( (viewpoint.z > backgroundElevation && target.topZ < backgroundElevation)
      || (viewpoint.z < backgroundElevation && target.bottomZ > backgroundElevation) ) return 0;

    const targetWithin = viewer.vision ? this.constructor.targetWithinLimitedAngleVision(viewer.vision, target) : 1;
    if ( !targetWithin ) return 0;
    if ( !this.hasPotentialObstacles && targetWithin === this.constructor.TARGET_WITHIN_ANGLE.INSIDE ) return 1;

    // Target is not lit.
    if ( this.#config.useLitTargetShape ) {
      const shape = this.visibleTargetShape;
      if ( !shape ) return 0;
      if ( shape instanceof PIXI.Polygon && shape.points < 6 ) return 0;
    }
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
    const {
      wallsBlock,
      liveTokensBlock,
      deadTokensBlock,
      tilesBlock } = this.viewer.config;

    // Remove old blocking objects.
    const blockingObjs = this.blockingObjects;
    Object.values(blockingObjs).forEach(objs => objs.clear());

    const visionPolygon = VisionPolygon.build(this.viewpoint, target)
    if ( wallsBlock ) blockingObjs.walls = this._filterWallsByVisionPolygon(visionPolygon);
    if ( tilesBlock ) blockingObjs.tiles = this._filterTilesByVisionPolygon(visionPolygon);
    if ( liveTokensBlock || deadTokensBlock ) blockingObjs.tokens = this._filterTokensByVisionPolygon(visionPolygon, target);

    // Separate walls into terrain and normal.
    blockingObjs.walls.forEach(w => {
      if ( w.document[type] === CONST.WALL_SENSE_TYPES.LIMITED ) {
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
        .filter(w => w.document[this.viewer.config.type] ); // Ignore walls that are not blocking for the type.
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
    if ( MODULES_ACTIVE.LEVELS && this.viewer.config.type === "sight" ) {
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
    const viewer = this.viewer;
    tokens ??= canvas.tokens.quadtree.getObjects(visionPolygon._bounds);

    // Filter out the viewer and target from the token set.
    tokens.delete(target);
    tokens.delete(viewer);

    // Filter tokens that directly overlaps the viewer.
    // Example: viewer is on a dragon.
    if ( viewer instanceof Token ) tokens = tokens.filter(t => this.tokensOverlap(viewer, t))

    // Filter tokens that directly overlaps the viewer.
    // Example: viewer is on a dragon.
    if ( viewer instanceof Token ) tokens = tokens.filter(t => this.tokensOverlap(viewer, t));

    // Filter all mounts and riders of both viewer and target. Possibly covered by previous test.
    const api = MODULES_ACTIVE.API.RIDEABLE;
    if ( api ) tokens = tokens.filter(t => api.RidingConnection(t, viewer)
      || api.RidingConnection(t, target));

    // Filter by the precise triangle cone
    return visionPolygon.filterTokens(tokens);
  }

}

export class AbstractViewerLOS {

  /** @type {Token} */
  viewer;

  /** @type {ViewerLOSConfig} */
  config = {
    type: "sight",
    wallsBlock: Settings.
  }

  /**
   * @param {Token} viewer      The token whose LOS should be tested
   */
  constructor(viewer) {
    this.viewer = viewer;
    this.config = this.initializeConfig();
  }

  /**
   * Sets configuration to the current settings.
   * @param {ViewerLOSConfig} [cfg]
   * @returns {ViewerLOSConfig}
   */
  initializeConfig(cfg = {}) {
    const KEYS = Settings.KEYS;

    // Basic configs.
    cfg.type ??= "sight";
    cfg.useLitTargetShape ??= true;
    cfg.threshold ??= 0;

    // Blocking canvas objects.
    cfg.block ??= {};
    cfg.block.walls ??= true;
    cfg.block.tiles ??= true;

    // Blocking tokens.
    cfg.block.tokens ??= {};
    cfg.block.tokens.dead ??= Settings.get(KEYS.DEAD_TOKENS_BLOCK);
    cfg.block.tokens.live ??= Settings.get(KEYS.LIVE_TOKENS_BLOCK);
    cfg.block.tokens.prone ??= Settings.get(KEYS.PRONE_TOKENS_BLOCK);
  }

  /** @type {Point3d} */
  get center() { return CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(this.token); }

  /** @type {number} */
  get visionAngle() { return this.token?.vision.data.angle ?? 360; }

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
    this._clearTargetCache();
    this._setViewpoints();
  }

  /** @type {Point3d} */
  #targetCenter = new Point3d(null); // Set x=null to indicate uninitialized.

  get targetCenter() {
    if ( this.#targetCenter.x == null ) Point3d.fromTokenCenter(this.target, this.#targetCenter);
    return this.#targetCenter;
  }

  /**
   * The target shape, constrained by overlapping walls and (if `useLitTargetShape`) overlapping lights.
   * @type {PIXI.Polygon|PIXI.Rectangle|undefined}
   */
  #visibleTargetShape;

  get visibleTargetShape() {
    if ( !this.#visibleTargetShape ) {
      if ( this.#config.useLitTargetShape ) this.#visibleTargetShape = this._constructLitTargetShape();
      else this.#visibleTargetShape = this.target.constrainedTokenBorder;
    }
    return this.#visibleTargetShape;
  }

  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} target
   * @returns {0|1|undefined} 1.0 for visible; Undefined if obstacles present or target intersects the vision rays.
   */
  _simpleVisibilityTest(target) {
    if ( target ) this.target = target;
    const viewer = this.viewer;

    // To avoid obvious errors.
    if ( viewer === target ) return 1;

    // If directly overlapping.
    if ( this.tokensOverlap(viewer, target) ) return 1;

    // If considering lighting on the target, return 0 if no lighting.
    if ( this.config.useLitTargetShape & typeof this.visibleTargetShape === "undefined" ) return 0;

    return viewpoints.any(v => v._simpleVisibilityTest());

  }

  /**
   * Test if the token constrained borders overlap and tokens are at same elevation.
   * Used to allow vision when tokens are nearly on top of one another.
   * @param {Token} token1
   * @param {Token} token2
   * @param {number} [pad=-2]     Increase or decrease the borders. By default, shrink the
   *   borders to avoid false positives for adjacent tokens.
   * @returns {boolean}
   */
  tokensOverlap(token1, token2, pad = -2) {
    if ( token1.elevationE !== token2.elevationE ) return false;
    if ( token1.center.equals(token2.center) ) return true;
    const border1 = token1.constrainedTokenBorder.pad(pad);
    const border2 = token2.constrainedTokenBorder.pad(pad);
    return border1.overlaps(border2);
  }

  /**
   * Use the lights that overlap the target shape to construct the shape.
   * @returns {PIXI.Polygon|PIXI.Rectangle|undefined} If no overlap, returns undefined.
   *   If 2+ lights create holes or multiple polygons, the convex hull is returned.
   *   (Because cannot currently handle 2+ distinct target shapes.)
   */
  _constructLitTargetShape() {
    const shape = this.constructor.constrainTargetShapeWithLights(this.target);
    if ( !(shape instanceof ClipperPaths )) return shape;

    // Multiple polygons present. Ignore holes. Return remaining polygon or
    // construct one from convex hull of remaining polygons.
    const polys = shape.toPolygons().filter(poly => !poly.isHole);
    if ( polys.length === 0 ) return undefined;
    if ( polys.length === 1 ) return polys[0];

    // Construct convex hull.
    const pts = [];
    for ( const poly of polys ) pts.push(...poly.iteratePoints({ close: false }));
    return PIXI.Polygon.convexHull(pts);
  }

  /**
   * Take a token and intersects it with a set of lights.
   * @param {Token} token
   * @returns {PIXI.Polygon|PIXI.Rectangle|ClipperPaths|undefined}
   */
  static constrainTargetShapeWithLights(token) {
    const tokenBorder = token.constrainedTokenBorder;

    // If the global light source is present, then we can use the whole token.
    if ( canvas.environment.globalLightSource.active ) return tokenBorder;

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
    if ( !lightShapes.length ) return undefined;

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

  /** @type {enum} */
  static TARGET_WITHIN_ANGLE = {
    OUTSIDE: 0,
    INSIDE: 1,
    INTERSECTS: 2
  };

  /**
   * Test if any part of the target is within the limited angle vision of the token.
   * @param {PointVisionSource} visionSource
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

}

/**
 * LOS defined for a specific viewing token.
 */
export class VisionLOS {

  /** @type {VisionSource} */
  get visionSource() { return this.viewer.vision; }

}

/**
 * LOS defined for attacking token to measure cover of defending tokens.
 */
export class CoverLOS {

}


