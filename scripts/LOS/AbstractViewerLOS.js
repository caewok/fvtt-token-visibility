/* globals
canvas,
CONFIG,
CONST,
foundry,
LimitedAnglePolygon,
PIXI,
Ray
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LOS folder
import { tokensOverlap } from "./util.js";

// Viewpoint algorithms.
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { PointsViewpoint } from "./PointsViewpoint.js";
import { GeometricViewpoint } from "./GeometricViewpoint.js";
import { PIXIViewpoint } from "./PIXIViewpoint.js";
import { Hybrid3dViewpoint } from "./Hybrid3dViewpoint.js";
import { WebGL2Viewpoint } from "./WebGL2/WebGL2Viewpoint.js";
import { WebGPUViewpoint, WebGPUViewpointAsync } from "./WebGPU/WebGPUViewpoint.js";

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
 * @property {CONST.WALL_RESTRICTION_TYPES} senseType    Type of source (light, sight, etc.)
 * @property {BlockingConfig} blocking              Do various canvas objects block?
 * @property {boolean} largeTarget                  Use special handling for targets larger than grid square
 * @property {number} threshold                     Numeric threshold for determining LOS from percent visible
 * @property {boolean} useLitTargetShape            Should the illuminated target shape be used?
 */
export class AbstractViewerLOS {
  /** @type {enum<string>} */
  static POINT_TYPES = {
    CENTER: "points-center",
    TWO: "points-two",
    THREE: "points-three", //
    FOUR: "points-four", // Five without center
    FIVE: "points-five", // Corners + center
    EIGHT: "points-eight", // Nine without center
    NINE: "points-nine" // Corners, midpoints, center
  };

  /** @type {enum<class>} */
  static get VIEWPOINT_CLASSES() { // Cannot access PointsViewpoint, others, before initialization. So use a getter.
    return {
      "los-points": PointsViewpoint,
      "los-area-3d": GeometricViewpoint,
      "los-area-3d-geometric": GeometricViewpoint,
      "los-area-3d-webgl2": PIXIViewpoint,
      "los-area-3d-hybrid": Hybrid3dViewpoint,
      "los-webgl2": WebGL2Viewpoint,
      "los-webgpu": WebGPUViewpoint,
      "los-webgpu-async": WebGPUViewpointAsync,
      points: PointsViewpoint,
      geometric: GeometricViewpoint,
      PIXI: PIXIViewpoint,
      hybrid: Hybrid3dViewpoint,
      webGL2: WebGL2Viewpoint,
      webGPU: WebGPUViewpoint,
      webGPUAsync: WebGPUViewpointAsync,
    }
  };

  /** @type {enum<string>} */
  static NUM_VIEWPOINTS = {
    1: this.POINT_TYPES.CENTER,
    2: this.POINT_TYPES.TWO,
    3: this.POINT_TYPES.THREE,
    4: this.POINT_TYPES.FOUR,
    5: this.POINT_TYPES.FIVE,
    8: this.POINT_TYPES.EIGHT,
    9: this.POINT_TYPES.NINE,
    ...this.POINT_TYPES,
  };

  /**
   * @param {Token} viewer      The token whose LOS should be tested
   * @param {object} [opts]
   * @param {VIEWPOINT_CLASSES|class} [opts.viewpointClass]   Class of the viewpoint algorithm
   * @param {number|string} [opts.numViewpoints]              Number of viewpoints or associated algorithm
   * @param {number} [opts.viewpointOffset]                   Used to adjust the viewpoint location
   * @param {WALL_RESTRICTION_TYPES} [opts.senseType]         What type of walls block this viewer (e.g., sight, light)
   * @param {object} [...cfg]                                 Other options
   */
  constructor(viewer, { viewpointClass, numViewpoints, viewpointOffset, senseType, ...cfg } = {}) {
    this.viewer = viewer;
    this.config = cfg;
    this.setViewpointClass({ viewpointClass, numViewpoints, viewpointOffset, senseType });
  }

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
    threshold: 0.75,
    useLitTargetShape: false,
    largeTarget: false,
  }

  /** @type {ViewerLOSConfig} */
  get config() { return this._config; }

  set config(cfg = {}) {
    if ( cfg.numViewpoints && !Object.hasOwn(this.constructor.NUM_VIEWPOINTS, cfg.numViewpoints) ) {
      console.error(`${this.constructor.name}|Number of viewpoint configuration ${cfg.numViewpoints} not recognized.`);
    }
    if ( Number.isNumeric(cfg.threshold) && !cfg.threshold.between(0, 1) ) {
      console.error(`${this.constructor.name}|Threshold configuration ${cfg.threshold} not recognized.`);
    }
    foundry.utils.mergeObject(this._config, cfg);
  }

  /**
   * Sets configuration to the current settings.
   * @param {ViewerLOSConfig} [cfg]
   * @returns {ViewerLOSConfig}
   */
//   initializeConfig(cfg = {}) {
//     const KEYS = Settings.KEYS;
//
//     // Basic configs.
//     cfg.type ??= "sight";
//     cfg.useLitTargetShape ??= true;
//     cfg.threshold ??= Settings.get(KEYS.LOS.TARGET.PERCENT);
//     cfg.largeTarget ??= Settings.get(KEYS.LOS.TARGET.LARGE);
//     cfg.debug ??= Settings.get(KEYS.DEBUG.LOS);
//     cfg.debugDraw ??= new CONFIG.GeometryLib.Draw();
//
//     // Blocking canvas objects.
//     cfg.blocking ??= {};
//     cfg.blocking.walls ??= true;
//     cfg.blocking.tiles ??= true;
//
//     // Blocking tokens.
//     cfg.blocking.tokens ??= {};
//     cfg.blocking.tokens.dead ??= Settings.get(KEYS.DEAD_TOKENS_BLOCK);
//     cfg.blocking.tokens.live ??= Settings.get(KEYS.LIVE_TOKENS_BLOCK);
//     cfg.blocking.tokens.prone ??= Settings.get(KEYS.PRONE_TOKENS_BLOCK);
//
//     // Viewpoints.
//     cfg.viewerPoints = Settings.get(KEYS.LOS.VIEWER.NUM_POINTS);
//     cfg.viewpointClass = this.constructor.VIEWPOINT_CLASSES[Settings.get(KEYS.LOS.TARGET.ALGORITHM)]
//       ?? AbstractViewpoint;
//
//     return cfg;
//   }


  // ----- NOTE: Viewer ----- //

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
    this.#initializeViewpoints();
  }

  // ----- NOTE: Viewpoints ----- //

  /** @type {AbstractViewpoint} */
  viewpoints = [];

  #viewpointClass = PointsViewpoint;

  #numViewpoints = this.constructor.POINT_TYPES.CENTER;

  #viewpointOffset = 0;

  #senseType = "sight";

  get viewpointClass() { return this.#viewpointClass; }

  get viewpointOffset() { return this.#viewpointOffset; }

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  get senseType() { return this.#senseType; }

  set senseType(value) {
    if ( !CONST.WALL_RESTRICTION_TYPES.some(elem => elem === value) ) {
      console.error(`${this.constructor.name}|Sense type configuration ${value} not recognized.`);
    }
    this.#senseType = value;
    this.viewpoints.forEach(vp => vp.senseType = value);
  }

  /**
   * Determine the viewpoints for this viewer.
   * @returns {Point3d[]}
   */
  #initializeViewpoints() {
    const cl = this.#viewpointClass;
    this.viewpoints = AbstractViewpoint.constructTokenPoints(this.viewer, {
      pointAlgorithm: this.#numViewpoints,
      inset: this.#viewpointOffset
    }).map(pt => new cl(this, pt, this.config));
  }

  setViewpointClass({ viewpointClass, numViewpoints, viewpointOffset, senseType }) {
    if ( viewpointClass ) this.#viewpointClass = this.constructor.VIEWPOINT_CLASSES[viewpointClass] || viewpointClass;
    if ( numViewpoints ) this.#numViewpoints = this.constructor.NUM_VIEWPOINTS[numViewpoints] || numViewpoints;
    if ( Number.isNumeric(viewpointOffset) ) this.#viewpointOffset = viewpointOffset;
    if ( senseType ) this.#senseType = senseType;
    this.clearCache();
    this.#initializeViewpoints();
  }



  // ----- NOTE: Target ---- //

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
   * Clear cached items that must be reset when the viewpoint or target moves.
   */
  clearCache() {
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
   * @param {object} [opts]
   * @param {number} [opts.threshold]    Percentage to be met to be considered visible
   * @param {}
   * @returns {boolean}
   */
  hasLOS(target, { threshold, callback } = {}) {
    threshold ??= this.config.threshold;
    const percent = this.percentVisible(target, callback); // Percent visible will reset the cache.
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
  percentVisible(target, callback) {
    this.target = target;  // Important so the cache is reset.
    const percent = this._simpleVisibilityTest(target) ?? this._percentVisible(target, callback);
    if ( this.config.debug ) console.debug(`👀${this.viewer.name} --> 🎯${target.name}\t${Math.round(percent * 100 * 10)/10}%`);
    return percent;
  }

  async percentVisibleAsync(target) {
    this.target = target;  // Important so the cache is reset.
    const percent = this._simpleVisibilityTest(target) ?? (await this._percentVisibleAsync(target));
    if ( this.config.debug ) console.debug(`👀${this.viewer.name} --> 🎯${target.name}\t${Math.round(percent * 100 * 10)/10}%`);
    return percent;
  }

  _percentVisible(target, callback) {
    let max = 0;
    for ( const vp of this.viewpoints ) {
      max = Math.max(max, vp.percentVisible(callback));
      if ( max === 1 ) return max;
    }
    return max;
  }

  async _percentVisibleAsync(_target) {
    let max = 0;
    for ( const vp of this.viewpoints ) {
      max = Math.max(max, (await vp.percentVisibleAsync()));
      if ( max === 1 ) return max;
    }
    return max;
  }

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
    this.#viewer = undefined;
    this.viewpoints.forEach(vp => vp.destroy());
    this.viewpoints.length = 0;
  }

  /* ----- NOTE: Debug ----- */

//   clearDebug() {
//     if ( !this.config.debugDraw ) return;
//     this.config.debugDraw.clear();
//   }

  /**
   * For debugging.
   * Draw debugging objects on the main canvas.
   * @param {boolean} hasLOS    Is there line-of-sight to this target?
   */
//   _drawCanvasDebug() {
//     const draw = this.config.debugDraw;
//     this._drawVisibleTokenBorder();
//     this.viewpoints.forEach(vp => {
//       // vp._drawLineOfSight(draw);
//       // vp._drawVisionTriangle(draw);
//       vp._drawDetectedObjects(draw);
//     });
//   }

  /**
   * For debugging.
   * Draw the constrained token border and visible shape, if any.
   * @param {boolean} hasLOS    Is there line-of-sight to this target?
   */
//   _drawVisibleTokenBorder() {
//     const draw = this.config.debugDraw;
//     let color = Draw.COLORS.blue;
//
//     // Fill in the constrained border on canvas
//     draw.shape(this.target.constrainedTokenBorder, { color, fill: color, fillAlpha: 0.2});
//
//     // Separately fill in the visible target shape
//     if ( this.visibleTargetShape ) draw.shape(this.visibleTargetShape, { color: Draw.COLORS.yellow });
//     console.log("Drawing visible token border.")
//   }
}
