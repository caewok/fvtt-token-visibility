/* globals
canvas,
CONFIG,
DetectionMode,
foundry,
LimitedAnglePolygon,
PIXI,
Ray,
Token,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";

// LOS folder
import { tokensOverlap } from "./util.js";
import { DocumentUpdateTracker, TokenUpdateTracker } from "./UpdateTracker.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";

// Viewpoint algorithms.
import { PercentVisibleCalculatorAbstract } from "./PercentVisibleCalculator.js";
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { PointsViewpoint } from "./PointsViewpoint.js";
import { GeometricViewpoint } from "./GeometricViewpoint.js";
import { Hybrid3dViewpoint } from "./Hybrid3dViewpoint.js";
import { WebGL2Viewpoint } from "./WebGL2/WebGL2Viewpoint.js";
import { PerPixelViewpoint } from "./PerPixelViewpoint.js";
// import { WebGPUViewpoint, WebGPUViewpointAsync } from "./WebGPU/WebGPUViewpoint.js";

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
 * @typedef {object} CalculatorConfig    Configuration settings passed to viewpoints
 * @property {BlockingConfig} blocking                    Do various canvas objects block?
 * @property {boolean} largeTarget                        Use special handling for targets larger than grid square
 * @property {CONST.WALL_RESTRICTION_TYPES} senseType     Type of source (light, sight, etc.)
 * @property {boolean} testLighting            Should the illuminated target shape be used?
 * @property {boolean} debug                              Trigger debug drawings and logging
 */

/**
 * @typedef {object} PointsCalculatorConfig
 * ...{CalculatorConfig}
 * @property {AbstractViewerLOS.POINT_TYPES} pointAlgorithm     String code for the point algorithm (number of points) to use
 * @property {number} targetInset                       How much to inset target points from target border
 * @property {boolean} points3d                         Whether to use 3d points
 */

/**
 * @typedef {object} WebGL2CalculatorConfig
 * ...{CalculatorConfig}
 * @property {number} alphaThreshold                    Threshold value for testing alpha of tiles
 * @property {boolean} useInstancing                    Use instancing with webGL2
 */

/**
 * @typedef {object} ViewerLOSConfig  Configuration settings for this class. Also see the calc config.
 * @property {AbstractViewerLOS.POINT_TYPES} numViewpoints    String code for number of viewpoints
 * @property {number} viewpointOffset                         Offset each viewpoint from border
 * @property {number} threshold                               Percent needed to be seen for LOS
 */

/** @type {Object<CONST.WALL_RESTRICTION_TYPES|DetectionMode.DETECTION_TYPES>} */
const DM_SENSE_TYPES = {
  [DetectionMode.DETECTION_TYPES.SIGHT]: "sight",
  [DetectionMode.DETECTION_TYPES.SOUND]: "sound",
  [DetectionMode.DETECTION_TYPES.MOVE]: "move",
  [DetectionMode.DETECTION_TYPES.OTHER]: "light",
  "sight": DetectionMode.DETECTION_TYPES.SIGHT,
  "sound": DetectionMode.DETECTION_TYPES.SOUND,
  "move": DetectionMode.DETECTION_TYPES.MOVE,
  "light": DetectionMode.DETECTION_TYPES.OTHER, // No "light" equivalent
}

/** @type {Object<"lighting"|"sounds"|DetectionMode.DETECTION_TYPES>} */
const DM_SOURCE_TYPES = {
  "lighting": DetectionMode.DETECTION_TYPES.SIGHT,
  "sounds": DetectionMode.DETECTION_TYPES.SOUND,
  [DetectionMode.DETECTION_TYPES.SIGHT]: "lighting",
  [DetectionMode.DETECTION_TYPES.SOUND]: "sounds",
  [DetectionMode.DETECTION_TYPES.MOVE]: "lighting",
  [DetectionMode.DETECTION_TYPES.OTHER]: "lighting",
};


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

  // Simply trim "los-algorithm-" from the setting.
  static VIEWPOINT_ALGORITHM_SETTINGS = {
    "los-algorithm-points": "points",
    "los-algorithm-geometric": "geometric",
    "los-algorithm-per-pixel": "per-pixel",
    "los-algorithm-hybrid": "hybrid",
    "los-algorithm-webgl2": "webGL2",
    "los-algorithm-webgpu": "webGPU",
    "los-algorithm-webgpu-async": "webGPUAsync",
  };

  /** @type {enum<class>} */
  static get VIEWPOINT_CLASSES() { // Cannot access PointsViewpoint, others, before initialization. So use a getter.
    return {
      "points": PointsViewpoint,
      "geometric": GeometricViewpoint,
      "per-pixel": PerPixelViewpoint,
      "hybrid": Hybrid3dViewpoint,
      "webgl2": WebGL2Viewpoint,
      // "webgpu": WebGPUViewpoint,
      // "webgpu-async": WebGPUViewpointAsync,

      // Cannot reliably test for class, so test for class name instead.
      "PointsViewpoint": "points",
      "GeometricViewpoint": "geometric",
      "PerPixelViewpoint": "per-pixel",
      "Hybrid3dViewpoint": "hybrid",
      "WebGL2Viewpoint": "webgl2",
      // "WebGPUViewpoint": "webgpu",
      // "WebGPUViewpointAsync": "webgpu-async",
    }
  };

  static NUM_VIEWPOINTS_OPTIONS = new Set([
    this.POINT_TYPES.CENTER,
    this.POINT_TYPES.TWO,
    this.POINT_TYPES.THREE,
    this.POINT_TYPES.FOUR,
    this.POINT_TYPES.FIVE,
    this.POINT_TYPES.EIGHT,
    this.POINT_TYPES.NINE,
  ]);

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
   *
   * One of calcalator or viewpointClass must be provided:
   * @param {PercentVisibleCalculatorAbstract} [opts.calculator]      Calculator to use to test the viewpoints
   * @param {VIEWPOINT_CLASSES|class} [opts.viewpointClass]           Class of the viewpoint algorithm
   *
   * Other options:
   * @param {number|string} [opts.numViewpoints]              Number of viewpoints or string identifying associated algorithm
   * @param {number} [opts.viewpointOffset]                   Used to adjust the viewpoint location
   * @param {number} [opts.threshold]                         Percentage used to test for LOS (above this passes)
   * @param {object} [...cfg]                                 Passed to a newly-constructed calculator if none provided.
   */
  constructor(viewer, { calculator, viewpointClass, numViewpoints, viewpointOffset, ...cfg } = {}) {
    this.#viewer = viewer;

    if ( typeof numViewpoints !== "undefined" ) this.#config.numViewpoints = numViewpoints;
    if ( viewpointOffset !== "undefined" ) this.#config.viewpointOffset = viewpointOffset;

    // Confirm the calculator and viewpoint class are compatible and create the calculator
    if ( !calculator && !viewpointClass ) return console.error(`${this.constructor.name}|One of calculator or viewpointClass must be provided.`);
    viewpointClass ??= calculator.constructor.viewpointClass;
    const viewpointClassName = this.constructor.convertViewpointClassToName(viewpointClass);
    viewpointClass = this.constructor.VIEWPOINT_CLASSES[viewpointClassName];
    if ( calculator && viewpointClass ) {
      if ( calculator.constructor.viewpointClass !== viewpointClass ) return console.error(`${this.constructor.name}|Calculator and viewpoint class appear incompatible`, calculator, viewpointClass);
    }
    calculator ??= new viewpointClass.calcClass(cfg);
    this.#calculator = calculator;

    // Create the viewpoints.
    if ( this.#viewer ) this.initializeViewpoints({ numViewpoints, viewpointOffset });
  }

  async initialize() { return this.calculator.initialize(); }

  // ----- NOTE: Configuration ---- //

  static defaultConfiguration = {
    // Viewpoint configuration
    angle: true, // If constrained by the viewer vision angle
    viewpointOffset: 0,
    threshold: 0.75, // Percent used for LOS
  }

  /** @type {ViewerLOSConfig} */
  #config = { ...this.constructor.defaultConfiguration };

  get config() { return structuredClone(this.#config); }

  set config(cfg = {}) { foundry.utils.mergeObject(this.#config, cfg, { inplace: true}) }

  get viewpointOffset() { return this.#config.viewpointOffset; }

  get threshold() { return this.#config.threshold; }

  set threshold(value) { this.#config.threshold = value; }

  get debug() { return this.calculator.config.debug; }

  set debug(debug) { this.calculator.config = { debug }; }

  /**
   * @typedef {object} DetectionModeConfig
   * Detection mode settings relevant to the viewer LOS and calculator.
   * @prop {boolean} walls                          Do walls block?
   * @prop {DetectionMode.DETECTION_TYPES} type     Detection type
   * @prop {number} angle                           Is the viewer limited by its viewing angle?
   */

  // Used for caching
  /** @type {DetectionModeConfig} */
  get detectionModeConfig() {
    const calcConfig = this.calculator.config;
    return {
      walls: calcConfig.blocking.walls,
      type: DM_SENSE_TYPES[calcConfig.senseType],
      angle: this.config.angle,
    }
  }

  /**
   * Set this LOS configuration to match a detection mode's settings.
   * See CONFIG.Canvas.detectionModes (and CONFIG.Canvas.visionModes)
   * @param {DetectionMode} dm
   */
  setConfigForDetectionMode(dm = CONFIG.Canvas.detectionModes.basicSight) {
    const calcConfig = {
      blocking: {
        walls: dm.walls,
        tiles: dm.walls,
        regions: dm.walls,
      },
      senseType: DM_SENSE_TYPES[dm.type],
      sourceType: DM_SOURCE_TYPES[dm.type],
    };
    this.config = { angle: dm.angle };
    this.calculator.config = calcConfig;
  }

  // ----- NOTE: Calculator ----- //

  #calculator;

  get calculator() { return this.#calculator; }

  set calculator(value) {
    if ( !(value instanceof PercentVisibleCalculatorAbstract) ) console.error("Calculator not recognized", { value });
    const viewpointClass = this.viewpointClass;
    this.#calculator = value;
    if ( viewpointClass !== this.viewpointClass ) this.initializeViewpoints();
  }

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
    if ( this.#viewer === value ) return;
    this.#viewer = value;
    if ( value ) this.initializeViewpoints();
  }

  // ----- NOTE: Viewpoints ----- //
  /** @type {AbstractViewpoint} */
  viewpoints = [];

  get viewpointClass() { return this.#calculator.constructor.viewpointClass; }

  get viewpointClassName() {
    return this.constructor.VIEWPOINT_CLASSES[this.#calculator.constructor.viewpointClass.name];
  }

  static convertViewpointClassToName(value) {
    if ( value.name ) value = this.VIEWPOINT_CLASSES[value.name]; // If class, check against class name. Ignored for strings.
    value = value.replace("los-algorithm-", "");
    if ( !this.VIEWPOINT_CLASSES[value]) return console.error(`Viewpoint class ${value} not recognized.`, { value });
    return value;
  }

  /**
   * If the viewpoint class is changed, creates new viewpoints with new calculators.
   * To build viewpoints with a shared calculator, set the calculator instead.
   * @param {VIEWPOINT_ALGORITHM_SETTINGS|VIEWPOINT_CLASSES} value    The string key, settings string, or class
   */
  set viewpointClass(value) {
    // Clean up the value to be a in VIEWPOINT_CLASSES.
    value = this.constructor.convertViewpointClassToName(value);

    // Confirm if change is needed.
    if ( this.viewpointClassName === value ) return;
    const viewpointCl = this.constructor.VIEWPOINT_CLASSES[value];
    const calcClass = viewpointCl.constructor.calcClass;
    this.#calculator = new calcClass(this.#calculator.config);
    this.initializeViewpoints();
  }

  /**
   * Set up the viewpoints for this viewer.
   */
  initializeViewpoints({ numViewpoints, viewpointOffset } = {}) {
    this.viewpoints.forEach(vp => vp.destroy());

    numViewpoints ||= this.viewpoints.length || 1;
    viewpointOffset ??= this.viewpointOffset;
    const cl = this.viewpointClass;
    let pointAlgorithm = numViewpoints;
    if ( !this.constructor.NUM_VIEWPOINTS_OPTIONS.has(pointAlgorithm) ) pointAlgorithm = this.constructor.NUM_VIEWPOINTS[numViewpoints]
    this.viewpoints = AbstractViewpoint.constructTokenPoints(this.viewer, {
      pointAlgorithm,
      inset: viewpointOffset
    }).map(pt => new cl(this, pt));
    this.#config.viewpointOffset = viewpointOffset;
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
  }

  /** @type {Point3d} */
  get targetLocation() { return CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(this.target); }

  // ----- NOTE: Visibility testing ----- //

  get hasLOS() { return this.percentVisible >= this.threshold; }

  _percentVisible;

  get percentVisible() {
    if ( typeof this._percentVisible === "undefined" ) this.calculate();
    return this._percentVisible;
  }


  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} [target]
   * @returns {1|0|01} 1.0 for visible; -1 if unknown
   */
  simpleVisibilityTest() {
    const target = this.target;
    const viewer = this.viewer;

    // To avoid obvious errors.
    if ( viewer === target ) return 1;

    // If directly overlapping.
    if ( tokensOverlap(viewer, target) ) return 1;

    // Target is not within the limited angle vision of the viewer.
    if ( viewer.vision && this.config.angle && !this.constructor.targetWithinLimitedAngleVision(viewer.vision, target) ) return 0;

    return -1;
  }


  calculate() {
    this._percentVisible = 0;
    const simpleTest = this.simpleVisibilityTest();
    if ( ~simpleTest ) {
      this._percentVisible = simpleTest;
      return;
    }

    // Test each viewpoint until unobscured is 1.
    // If testing lighting, dim must also be 1. (Currently, can ignore bright. Unlikely to be drastically different per viewpoint.)
    this.calculator.initializeView(this);
    for ( const vp of this.viewpoints ) {
      vp.calculate();
      this._percentVisible = Math.max(this._percentVisible, vp.percentVisible);
      if ( this._percentVisible >= 1 ) break;
    }
  }

  /**
   * Test if any part of the target is within the limited angle vision of the token.
   * @param {PointVisionSource} visionSource
   * @param {Token|PIXI.Rectangle|PIXI.Polygon} targetShape
   * @returns {boolean}
   */
  static targetWithinLimitedAngleVision(visionSource, targetOrShape) {
    const targetShape = targetOrShape instanceof Token ? targetOrShape.tokenBorder : targetOrShape;
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
      const opts = { inside: true };
      const hasIx = targetShape.lineSegmentIntersects(rMin.A, rMin.B, opts)
                 || targetShape.lineSegmentIntersects(rMax.A, rMax.B, opts);
      return hasIx + 1; // 1 if inside (no intersection); 2 if intersects.
    };

    // Probably worth checking the target center first
    const center = targetShape.center;
    if ( LimitedAnglePolygon.pointBetweenRays(center, rMin, rMax, angle) ) return targetWithin();
    if ( LimitedAnglePolygon.pointBetweenRays(center, rMin, rMax, angle) ) return targetWithin();

    // TODO: Would it be more performant to assign an angle to each target point?
    // Or maybe just check orientation of ray to each point?
    const edges = targetShape.toPolygon().iterateEdges();
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

    // DO NOT destroy calculator, as that depends on whether the calculator was a one-off.
  }

  /* ----- NOTE: Debug ----- */

  /**
   * Container to hold all canvas graphics.
   */
  #canvasDebugContainer;

  get canvasDebugContainer() {
    if ( !this.#canvasDebugContainer || this.#canvasDebugContainer.destroyed ) this._initializeCanvasDebugGraphics();
    return this.#canvasDebugContainer;
  }

  /**
   * Container to hold all viewpoint canvas graphics. Children indexed to match vp indexes.
   */
  #viewpointDebugContainer;

  _destroyCanvasDebugGraphics() {
    const c = this.#canvasDebugContainer;
    if ( c && !c.destroyed ) c.destroy({ children: true });
    this.#canvasDebugContainer = undefined;
  }

  _destroyViewpointDebugGraphics() {
    const c = this.#viewpointDebugContainer;
    if ( this.#canvasDebugContainer ) this.#canvasDebugContainer.removeChild(c);
    if ( c && !c.destroyed ) c.destroy({ children: true });
    this.#viewpointDebugContainer = undefined;
  }

  _initializeCanvasDebugGraphics() {
    this._destroyCanvasDebugGraphics();
    this.#canvasDebugContainer = new PIXI.Container();
    this.#canvasDebugContainer.eventMode = "passive"; // Allow targeting, selection to pass through.
    this.#canvasDebugContainer.addChild(new PIXI.Graphics());
  }

  _initializeViewpointDebugGraphics() {
    this._destroyViewpointDebugGraphics();
    this.#viewpointDebugContainer = new PIXI.Container();
    this.#viewpointDebugContainer.eventMode = "passive"; // Allow targeting, selection to pass through.
    this.canvasDebugContainer.addChild(this.#viewpointDebugContainer);
    const Draw = CONFIG.GeometryLib.Draw;
    this.viewpoints.forEach(vp => {
      const g = new PIXI.Graphics();
      g.eventMode = "passive"; // Allow targeting, selection to pass through.
      this.#viewpointDebugContainer.addChild(g);
      this._debugViewpointDraw.set(vp, new Draw(g));
    });
  }

  #debugCanvasDraw;

  get debugCanvasDraw() {
    const Draw = CONFIG.GeometryLib.Draw;
    if ( this.#debugCanvasDraw && !this.#debugCanvasDraw.g.destroyed ) return this.#debugCanvasDraw;
    this.#debugCanvasDraw = new Draw(this.canvasDebugContainer.children[0]);
    return this.#debugCanvasDraw;
  }

  _debugViewpointDraw = new WeakMap();

  debugDrawForViewpoint(vp) {
    if ( !this._debugViewpointDraw.has(vp) ) this._initializeViewpointDebugGraphics();
    return this._debugViewpointDraw.get(vp);
  }


  /**
   * For debugging.
   * Draw debugging objects on the main canvas.
   */
  _drawCanvasDebug() {
    const canvasDraw = this.debugCanvasDraw;
    canvasDraw.clearDrawings();
    this._drawVisibleTokenBorder(canvasDraw);
    this._drawFrustumLightSources(canvasDraw);
    this.viewpoints.forEach(vp => this.debugDrawForViewpoint(vp).clearDrawings());
  }

  /**
   * For debugging.
   * Draw the constrained token border and visible shape, if any.
   */
  _drawVisibleTokenBorder(draw) {
    const color = CONFIG.GeometryLib.Draw.COLORS.blue;

    // Fill in the target border on canvas
    if ( this.target ) {
      const border = CONFIG[MODULE_ID].constrainTokens ? this.target.constrainedTokenBorder : this.target.tokenBorder;
      draw.shape(border, { color, fill: color, fillAlpha: 0.2});
    }
  }

  /**
   * For debugging.
   * Draw the vision triangle between light source and target.
   */
  _drawFrustumLightSources(draw) {
    if ( canvas.environment.globalLightSource.active ) return;
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const ctr = Point3d.fromTokenCenter(this.target);
    for ( const src of canvas.lighting.placeables ) {
      const srcOrigin = Point3d.fromPointSource(src);
      const dist2 = Point3d.distanceSquaredBetween(ctr, srcOrigin);
      const isBright = src.brightRadius && (src.brightRadius ** 2) < dist2;
      const isDim = (src.radius ** 2) < dist2;
      if ( !(isDim || isBright) ) continue;
      const fillAlpha = isBright ? 0.3 : 0.1;
      const frustum = ObstacleOcclusionTest.frustum.rebuild({ viewpoint: srcOrigin, target: this.target });
      frustum.draw2d({ draw, width: 0, fill: CONFIG.GeometryLib.Draw.COLORS.yellow, fillAlpha });
    }
  }
}

export class CachedAbstractViewerLOS extends AbstractViewerLOS {

  /** @type {WeakMap<Token, Float32Array(3)>} */
  #cache = new WeakMap();


  // Keyed to the current settings to detect settings changes.
  /** @type {string} */
  #cacheKey = ""

  constructor(...args) {
    super(...args);
    this.initializeTrackers();
  }

  /** @type {DocumentUpdateTracker} */
  wallTracker;

  /** @type {DocumentUpdateTracker} */
  tileTracker;

  /** @type {TokenUpdateTracker} */
  tokenTracker;

  /** @type {RegionUpdateTracker} */
  regionTracker;

  initializeTrackers() {
    this.wallTracker = new DocumentUpdateTracker("Wall", DocumentUpdateTracker.LOS_ATTRIBUTES.Wall);
    this.tileTracker = new DocumentUpdateTracker("Tile", DocumentUpdateTracker.LOS_ATTRIBUTES.Tile);
    this.regionTracker = new DocumentUpdateTracker("Region", DocumentUpdateTracker.LOS_ATTRIBUTES.Region);
    this.tokenTracker = new TokenUpdateTracker(TokenUpdateTracker.LOS_ATTRIBUTES, TokenUpdateTracker.LOS_FLAGS);
  }

  #calculateCacheKey() {
    const calcConfig = { ...this.calculator.config };

    // Combine all remaining settings into string.
    return JSON.stringify({
      ...this.config,
      ...calcConfig,
      viewpointClassName: this.viewpointClassName,
      numViewpoints: this.viewpoints.length
    });
  }

  /**
   * Compare the cached setting to the current ones. Invalidate if not the same.
   * Also check if the scene or target has changed. Invalidate accordingly.
   * @param {Token} [target]
   */
  validateCache() {
    const target = this.target;
    // If the settings have changed, wipe the cache.
    const cacheKey = this.#calculateCacheKey();
    if ( this.#cacheKey !== cacheKey ) {
      // console.debug(`${this.constructor.name}|${this.viewer.name} --> ${target.name} cache key changed\n\t${this.#cacheKeys[cacheType]}\n\t${cacheKey}`);
      this.#cacheKey = cacheKey;
      this.#cache = new WeakMap();
      return;
    }

    // Determine if any updates to placeables might affect the cached value(s).
    // NOTE: WeakMap has no clear method.
    // Make sure to call all 4: wallTracker, tileTracker, tokenTracker x2.
    let clearAll = false;
    let clearViewer = false;
    let clearTarget = false;
    if ( this.wallTracker.logUpdate() ) clearAll = true;
    if ( this.tileTracker.logUpdate() ) clearAll = true;
    if ( this.regionTracker.logUpdate() ) clearAll = true;
    if ( this.tokenTracker.logUpdate(this.viewer) ) clearViewer = true;
    if ( this.tokenTracker.logUpdate(target) ) clearTarget = true;

    // console.debug(`${this.constructor.name}|${this.viewer.name} --> ${target.name}`, { clearAll, clearViewer, clearTarget });
    if ( clearAll || clearViewer ) this.#cache = new WeakMap();
    else if ( clearTarget ) this.#cache.delete(target);
  }

  /**
   * Store within a target's cache different detection mode results.
   * Run the calculation for each as needed.
   */
  get cacheCategory() { return JSON.stringify(this.detectionModeConfig); }

  /**
   * Copy the current visibility values to the cache.
   * @param {Token} [target]
   */
  setCache() {
    const target = this.target;
    const cacheCategory = this.cacheCategory;
    const cachedObj = this.#cache.get(target) ?? {};
    cachedObj[cacheCategory] = this.percentVisible;
    this.#cache.set(target, cachedObj);
  }

  /**
   * Set this object's visibility values to the cached values.
   * Note that this does not affect this object's current calculator values.
   * @param {Token} [target]
   * @returns {boolean} True if cached update was used; false otherwise.
   */
  updateFromCache() {
    const target = this.target;
    this.validateCache(target);
    const cacheCategory = this.cacheCategory;
    const cachedVis = this.#cache.get(target)?.[cacheCategory];
    if ( typeof cachedVis === "undefined" ) return false;
    this._percentVisible = cachedVis;
    return true;
  }

  /**
   * Does a cached value for this target exist? Does not check if the cached value is still the correct length,
   * although in theory it should be---otherwise the cache should have been invalidated.
   * @param {Token} [target]
   * @returns {boolean}
   */
  hasCachedValue(target) {
    target ??= this.target;
    return this.#cache.has(target);
  }

  calculate(force = false) {
    if ( force || !this.updateFromCache() ) {
      super.calculate();
      this.setCache();
    }
  }

}

// const { UNOBSCURED, DIM, BRIGHT } = AbstractViewerLOS.VISIBILITY_LABELS;
