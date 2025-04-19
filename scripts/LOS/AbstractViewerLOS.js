/* globals
canvas,
CONFIG,
foundry,
LimitedAnglePolygon,
PIXI,
Ray
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder.
import { Settings } from "../settings.js";

// LOS folder
import { tokensOverlap } from "./util.js";

// Viewpoint algorithms.
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { PointsViewpoint } from "./PointsViewpoint.js";
import { Area3dGeometricViewpoint } from "./Area3dGeometricViewpoint.js";
import { Area3dWebGL1Viewpoint } from "./Area3dWebGL1Viewpoint.js";
import { Area3dWebGL2Viewpoint } from "./Area3dWebGL2Viewpoint.js";
import { Area3dHybridViewpoint } from "./Area3dHybridViewpoint.js";
import { WebGL2Viewpoint } from "./WebGL2/WebGL2Viewpoint.js";
import { WebGPUViewpoint, WebGPUViewpointAsync } from "./WebGPU/WebGPUViewpoint.js";

// Debug
import { Draw } from "../geometry/Draw.js";


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
 * @property {Settings.KEYS.POINT_TYPES} viewerPoints   Algorithm defining the viewer viewpoints
 * @property {class} viewpointClass                 Class of the viewpoints
 */
export class AbstractViewerLOS {
  /** @type {enum<string>} */
  static get POINT_TYPES() { return Settings.KEYS.POINT_TYPES; }

  /** @type {enum<class>} */
  static VIEWPOINT_CLASSES = {
    "los-points": PointsViewpoint,
    "los-area-3d": Area3dGeometricViewpoint,
    "los-area-3d-geometric": Area3dGeometricViewpoint,
    "los-area-3d-webgl1": Area3dWebGL1Viewpoint,
    "los-area-3d-webgl2": Area3dWebGL2Viewpoint,
    "los-area-3d-hybrid": Area3dHybridViewpoint,
    "los-webgl2": WebGL2Viewpoint,
    "los-webgpu": WebGPUViewpoint,
    "los-webgpu-async": WebGPUViewpointAsync,
  };

  /** @type {Token} */
  viewer;

  /** @type {ViewerLOSConfig} */
  config = {};

  /** @type {AbstractViewpoint} */
  viewpoints = [];

  /**
   * @param {Token} viewer      The token whose LOS should be tested
   */
  constructor(viewer, cfg) {
    this.config = this.initializeConfig(cfg);
    this.viewer = viewer;
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
    cfg.threshold ??= Settings.get(KEYS.LOS.TARGET.PERCENT);
    cfg.largeTarget ??= Settings.get(KEYS.LOS.TARGET.LARGE);
    cfg.debug ??= Settings.get(KEYS.DEBUG.LOS);
    cfg.debugDraw ??= new CONFIG.GeometryLib.Draw();

    // Blocking canvas objects.
    cfg.block ??= {};
    cfg.block.walls ??= true;
    cfg.block.tiles ??= true;

    // Blocking tokens.
    cfg.block.tokens ??= {};
    cfg.block.tokens.dead ??= Settings.get(KEYS.DEAD_TOKENS_BLOCK);
    cfg.block.tokens.live ??= Settings.get(KEYS.LIVE_TOKENS_BLOCK);
    cfg.block.tokens.prone ??= Settings.get(KEYS.PRONE_TOKENS_BLOCK);

    // Viewpoints.
    cfg.viewerPoints = Settings.get(KEYS.LOS.VIEWER.NUM_POINTS);
    cfg.viewpointClass = this.constructor.VIEWPOINT_CLASSES[Settings.get(KEYS.LOS.TARGET.ALGORITHM)]
      ?? AbstractViewpoint;

    return cfg;
  }

  /**
   * Determine the viewpoints for this viewer.
   * @returns {Point3d[]}
   */
  initializeViewpoints() {
    const cl = this.config.viewpointClass;
    return AbstractViewpoint.constructTokenPoints(this.viewer, {
      pointAlgorithm: this.config.viewerPoints,
      inset: this.config.inset
    }).map(pt => new cl(this, pt));
  }

  /**
   * Update the viewpoint class.
   * Resets the viewpoints to the new algorithm.
   * @param {Settings.KEYS.LOS.TARGET.TYPES} alg
   */
  _updateAlgorithm(alg) {
    this.config.viewpointClass = this.constructor.VIEWPOINT_CLASSES[alg] ?? AbstractViewpoint;
    this.viewpoints = this.initializeViewpoints();
  }

  /** @type {Point3d} */
  get center() { return this.viewer ? CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(this.viewer) : undefined; }

  /** @type {number} */
  get visionAngle() { return this.viewer?.vision.data.angle ?? 360; }

  /**
   * The token associated with a camera location signifying the viewer.
   * @type {Token}
   */
  #viewer;

  get viewer() { return this.#viewer; }

  set viewer(value) {
    this.#viewer = value;
    this.clearCache();
    this.viewpoints = this.initializeViewpoints();
  }

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
    this.#target = value;
    this.clearCache();
  }

  /** @type {Point3d} */
  get targetCenter() {
    return CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(this.target);
  }

  /**
   * The target shape, constrained by overlapping walls and (if `useLitTargetShape`) overlapping lights.
   * @type {PIXI.Polygon|PIXI.Rectangle|undefined}
   */
  #visibleTargetShape;

  get visibleTargetShape() { return (this.#visibleTargetShape ??= this._calculateVisibleTargetShape(this.target)); }

  _calculateVisibleTargetShape(target) {
    return this.config.useLitTargetShape
      ? this._constructLitTargetShape(target) : target.constrainedTokenBorder;
  }

  /**
   * Clear cached items that must be reset when the viewpoint or target moves.
   */
  clearCache() {
    this.#visibleTargetShape = undefined;
    this.viewpoints.forEach(vp => vp.clearCache());
  }

  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} target
   * @returns {0|1|undefined} 1.0 for visible; Undefined if obstacles present or target intersects the vision rays.
   */
  _simpleVisibilityTest(target) {
    this.target = target; // Important so the cache is reset.
    const viewer = this.viewer;

    // To avoid obvious errors.
    if ( viewer === target ) return 1;

    // If directly overlapping.
    if ( tokensOverlap(viewer, target) ) return 1;

    // Target is not within the limited angle vision of the viewer.
    if ( viewer.vision && !this.constructor.targetWithinLimitedAngleVision(viewer.vision, target) ) return 0;

    // Target is not lit.
    if ( this.config.useLitTargetShape ) {
      const shape = this.visibleTargetShape;
      if ( !shape ) return 0;
      if ( shape instanceof PIXI.Polygon && shape.points < 6 ) return 0;
    };

    // If all viewpoints are blocked, return 0; if any unblocked, return 1.
    let blocked = true;
    for ( const vp of this.viewpoints ) {
      const thisVP = vp._simpleVisibilityTest(target);
      if ( thisVP === 1 ) return 1;
      blocked &&= (thisVP === 0);
    }
    return blocked ? 0 : undefined;
  }

  /**
   * Determine whether a viewer has line-of-sight to a target based on meeting a threshold.
   * @param {Token} target
   * @param {number} [threshold]    Percentage to be met to be considered visible
   * @returns {boolean}
   */
  hasLOS(target, threshold) {
    threshold ??= this.config.threshold;
    const percent = this.percentVisible(target); // Percent visible will reset the cache.
    const hasLOS = !percent.almostEqual(0)
      && (percent > threshold || percent.almostEqual(threshold));
    if ( this.config.debug ) console.debug(`\t👀${this.viewer.name} --> 🎯${target.name} ${hasLOS ? "has" : "no"} LOS.`);
    return hasLOS;
  }

  async hasLOSAsync(target, threshold) {
    threshold ??= this.config.threshold;
    const percent = await this.percentVisibleAsync(target); // Percent visible will reset the cache.
    const hasLOS = !percent.almostEqual(0)
      && (percent > threshold || percent.almostEqual(threshold));
    if ( this.config.debug ) console.debug(`\t👀${this.viewer.name} --> 🎯${target.name} ${hasLOS ? "has" : "no"} LOS.`);
    return hasLOS;
  }

  /**
   * Determine percentage of the token visible using the class methodology.
   * @returns {number}
   */
  percentVisible(target) {
    this.target = target;  // Important so the cache is reset.
    const percent = this._simpleVisibilityTest(target) ?? this._percentVisible(target);
    if ( this.config.debug ) console.debug(`👀${this.viewer.name} --> 🎯${target.name}\t${Math.round(percent * 100 * 10)/10}%`);
    return percent;
  }

  async percentVisibleAsync(target) {
    this.target = target;  // Important so the cache is reset.
    const percent = this._simpleVisibilityTest(target) ?? (await this._percentVisibleAsync(target));
    if ( this.config.debug ) console.debug(`👀${this.viewer.name} --> 🎯${target.name}\t${Math.round(percent * 100 * 10)/10}%`);
    return percent;
  }

  _percentVisible(target) {
    let max = 0;
    for ( const vp of this.viewpoints ) {
      max = Math.max(max, vp.percentVisible(target));
      if ( max === 1 ) return max;
    }
    return max;
  }

  async _percentVisibleAsync(target) {
    let max = 0;
    for ( const vp of this.viewpoints ) {
      max = Math.max(max, (await vp.percentVisibleAsync(target)));
      if ( max === 1 ) return max;
    }
    return max;
  }

  /**
   * Use the lights that overlap the target shape to construct the shape.
   * @returns {PIXI.Polygon|PIXI.Rectangle|undefined} If no overlap, returns undefined.
   *   If 2+ lights create holes or multiple polygons, the convex hull is returned.
   *   (Because cannot currently handle 2+ distinct target shapes.)
   */
  _constructLitTargetShape(target) {
    const shape = this.constructor.constrainTargetShapeWithLights(target);
    if ( !(shape instanceof CONFIG.GeometryLib.ClipperPaths )) return shape;

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

    const ClipperPaths = CONFIG.GeometryLib.ClipperPaths;
    const combined = ClipperPaths.fromPolygons(lightShapes)
      .combine()
      .intersectPaths(ClipperPaths.fromPolygons([tokenBorder.toPolygon()]))
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

  /**
   * Destroy any PIXI objects and remove hooks upon destroying.
   */
  destroy() {
    this.#target = undefined;
    this.viewer = undefined;
    this.viewpoints.forEach(vp => vp.destroy());
    this.viewpoints.length = 0;
  }

  /* ----- NOTE: Debug ----- */

  clearDebug() {
    if ( !this.config.debugDraw ) return;
    this.config.debugDraw.clear();
  }

  /**
   * For debugging.
   * Draw debugging objects on the main canvas.
   * @param {boolean} hasLOS    Is there line-of-sight to this target?
   */
  _drawCanvasDebug() {
    const draw = this.config.debugDraw;
    this._drawVisibleTokenBorder();
    this.viewpoints.forEach(vp => {
      // vp._drawLineOfSight(draw);
      vp._drawVisionTriangle(draw);
      vp._drawDetectedObjects(draw);
    });
  }

  /**
   * For debugging.
   * Draw the constrained token border and visible shape, if any.
   * @param {boolean} hasLOS    Is there line-of-sight to this target?
   */
  _drawVisibleTokenBorder() {
    const draw = this.config.debugDraw;
    let color = Draw.COLORS.blue;

    // Fill in the constrained border on canvas
    draw.shape(this.target.constrainedTokenBorder, { color, fill: color, fillAlpha: 0.2});

    // Separately fill in the visible target shape
    if ( this.visibleTargetShape ) draw.shape(this.visibleTargetShape, { color: Draw.COLORS.yellow });
    console.log("Drawing visible token border.")
  }
}
