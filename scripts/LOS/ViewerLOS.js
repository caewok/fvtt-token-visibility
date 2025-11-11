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
import { Point3d } from "../geometry/3d/Point3d.js";

// LOS folder
import { tokensOverlap, insetPoints } from "./util.js";
import { DocumentUpdateTracker, TokenUpdateTracker } from "./UpdateTracker.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";
import { SmallBitSet } from "./SmallBitSet.js";

// Viewpoint algorithms.
import { Viewpoint } from "./Viewpoint.js";

// import { WebGPUViewpoint, WebGPUViewpointAsync } from "./WebGPU/WebGPUViewpoint.js";

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

/**
 * @typedef {object} ViewerLOSConfig  Configuration settings for this class. Also see the calc config.
 * @property {number} viewpointIndex    					    Points configuration for the viewer's viewpoints
 * @property {number} viewpointInset                  Offset each viewpoint from viewer border
 * @property {boolean} angle                          True if constrained by viewer vision angle
 * @property {number} threshold                       Percent needed to be seen for LOS
 */

export class ViewerLOS {

  /**
   * Index for each of the point combinations.
   * For all but center, the point is ignored if the ray passes nearly entirely through the token.
   * E.g., more than half the width/height.
   * @type {enum<number>}
   */
  static POINT_INDICES = {
    CENTER: 0,	    			// e.g., 00000001
    CORNERS: {
      FACING: 1,				  // e.g., 00000010
      BACK: 2,
    },
    MID: {
      FACING: 3,
      SIDES: 4,
      BACK: 5,
    },
    D3: {
      // If none of TOP, MID, or BOTTOM, then midpoint is assumed.
      // Otherwise, MID may be omitted.
      TOP: 6,
      MID: 7,
      BOTTOM: 8,
    }
  };

  static POINT_OPTIONS = {}; // Filled in below.

  /**
   * How many viewpoints for a given point index code?
   * @param {number|BitSet} idx
   * @returns {number}
   */
  static numViewpointsForIndex(idx) {
    const PI = this.POINT_INDICES;
    const bs = idx instanceof SmallBitSet ? idx : SmallBitSet.fromNumber(idx);
    let count = 0;
    count += bs.hasIndex(PI.CENTER);
    count += 2 * bs.hasIndex(PI.CORNERS.FACING);
    count += 2 * bs.hasIndex(PI.CORNERS.BACK);
    count += 2 * bs.hasIndex(PI.MID.SIDES);
    count += bs.hasIndex(PI.MID.FACING);
    count += bs.hasIndex(PI.MID.BACK);

    // There are [count] points on each level, minimum of 1 level.
    const mult = (bs.hasIndex(PI.D3.TOP) + bs.hasIndex(PI.D3.MID) + bs.hasIndex(PI.D3.BOTTOM)) || 1;
    return count * mult;
  }

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

  /** @type {PercentVisibleCalculator} */
  calculator;

  /**
   * @param {Token} viewer      					The token whose LOS should be tested
   * @param {PercentVisibleCalculator} 		The visibility calculator to use.
   */
  constructor(viewer, calculator) {
    this.viewer = viewer;
    this.calculator = calculator;
    // Dirty variable already set for constructor.
  }

  // ----- NOTE: Configuration ---- //

  static defaultConfiguration = {
    // Viewpoint configuration
    viewpointIndex: 1, // Center point only.
    viewpointInset: 0,
    angle: true, // If constrained by the viewer vision angle
    threshold: 0.75, // Percent used for LOS
  }

  /** @type {ViewerLOSConfig} */
  #config = { ...this.constructor.defaultConfiguration };

  get config() { return structuredClone(this.#config); }

  set config(cfg = {}) {
    if ( Object.hasOwn(cfg, "viewpointIndex")
      && cfg.viewpointIndex instanceof SmallBitSet ) cfg.viewpointIndex = cfg.viewpointIndex.word;
    this.#dirty ||= Object.hasOwn(cfg, "viewpointIndex") || Object.hasOwn(cfg, "viewpointInset");
    foundry.utils.mergeObject(this.#config, cfg, { inplace: true});
  }

  get viewpointInset() { return this.#config.viewpointInset; }

  get threshold() { return this.#config.threshold; }

  set threshold(value) { this.#config.threshold = value; }

  get debug() { return this.calculator.config.debug; }

  set debug(debug) { this.calculator.config = { debug }; }


  // ----- NOTE: Caching ----- //

  /** @type {boolean} */
  #dirty = true;

  get dirty() { return this.#dirty; }

  set dirty(value) { this.dirty ||= value; }

  /**
   * Update the viewpoints.
   */
  _clean() {
    this.initializeViewpoints();
    this.#dirty = false;
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
    this.dirty = true;
    this.initializeViewpoints();
  }

  // ----- NOTE: Viewpoints ----- //
  /** @type {Viewpoint} */
  viewpoints = [];

  get numViewpoints() { return this.constructor.numViewpointsForIndex(this.#config.viewpointIndex); }

  /**
   * Set up the viewpoints for this viewer.
   */
  initializeViewpoints() {
    if ( !this.viewer ) return;
    this.viewpoints.length = this.numViewpoints;
    this.constructor.constructTokenPoints(this.viewer, {
      pointKey: this.config.viewpointIndex,
      inset: this.config.viewpointInset,
    }).forEach((pt, idx) => this.viewpoints[idx] = new Viewpoint(this, pt));
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

  set target(value) { this.#target = value; }

  /** @type {Point3d} */
  get targetLocation() { return CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(this.target); }

  // ----- NOTE: Visibility testing ----- //

  get hasLOS() { return this.percentVisible > 0 && this.percentVisible >= this.threshold; } // If threshold is 0, any part counts.

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
      if ( this._viewpointBlockedByViewer(vp.viewpoint) ) continue;
      const res = vp.calculate();
      this._percentVisible = Math.max(this._percentVisible, res.percentVisible);
      if ( this._percentVisible >= 1 ) break;
    }
  }


  /**
   * Viewpoint blocked if it is further from the target than the center point.
   * In other words, if it traverses too much of the viewer shape.
   * @param {Point3d} vp
   * @returns {boolean} True if blocked
   */
  _viewpointBlockedByViewer(vp) {
    const ctr = this.center;
    if ( vp.almostEqual(ctr) ) return false; // Center point is special; not blocked.
    const targetCtr = Point3d.fromTokenCenter(this.target);
    return Point3d.distanceSquaredBetween(ctr, targetCtr) < Point3d.distanceSquaredBetween(vp, targetCtr);
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
   * Build points for a given token.
   * @param {Token} token
   * @param {object} [opts]
   * @param {PIXI.Polygon|PIXI.Rectangle} [opts.tokenShape]
   * @param {number|BitSet} [opts.pointKey]
   * @param {number} [opts.inset]
   * @param {Point3d} [opts.viewpoint]
   * @returns {Point3d[]}
   */
  static constructTokenPoints(token, { pointKey = 1, tokenShape, inset, viewpoint } = {}) {
    tokenShape ??= token.constrainedTokenBorder;
    const bs = pointKey instanceof SmallBitSet ? pointKey : SmallBitSet.fromNumber(pointKey);
    const PI = this.POINT_INDICES;
    const center = Point3d.fromTokenCenter(token);
    let cornerPoints;
    let facing;
    let back;
    const tokenPoints = [];

    // Corners
    // If two points, keep only the front-facing points.
    // For targets, keep the closest two points to the viewer point.
    const { topZ, bottomZ } = token;
    const midZ = topZ - bottomZ;

    // Set either all 4 corners or a subset.
    const cornerMask = SmallBitSet.fromIndices([PI.CORNERS.FACING, PI.CORNERS.BACK]);
    const cornerIx = bs.intersectionNew(cornerMask);
    if ( cornerIx.equals(cornerMask) ) {
      cornerPoints = this.getCorners(tokenShape, midZ);
      tokenPoints.push(...cornerPoints);
    } else if ( !cornerIx.isEmpty ) {
      cornerPoints = this.getCorners(tokenShape, midZ);
      const res = this._facingPoints(cornerPoints, token, viewpoint);
      facing = res.facing;
      back = res.back;
      if ( cornerIx.hasIndex(PI.CORNERS.FACING) ) tokenPoints.push(...facing);
      if ( cornerIx.hasIndex(PI.CORNERS.BACK) ) tokenPoints.push(...back);
    }

    // Set either all side points or a subset
    const sidesMask = SmallBitSet.fromIndices([PI.MID.FACING, PI.MID.BACK, PI.MID.SIDES]);
    const sidesIx = bs.intersectionNew(sidesMask);
    if ( sidesIx.equals(sidesMask) ) {
      cornerPoints ??= this.getCorners(tokenShape, midZ);
      let a = cornerPoints.at(-1);
      for ( const b of cornerPoints ) {
        tokenPoints.push(Point3d.midPoint(a, b));
        a = b;
      }
    } else if ( !sidesIx.isEmpty ) {
      if ( !facing ) {
        cornerPoints ??= this.getCorners(tokenShape, midZ);
        const res = this._facingPoints(cornerPoints, token, viewpoint);
        facing = res.facing;
        back = res.back;
      }
      if ( sidesIx.hasIndex(PI.MID.FACING) ) tokenPoints.push(Point3d.midPoint(facing[0], facing[1])); // Two front points form the frontside.
      if ( sidesIx.hasIndex(PI.MID.BACK) ) tokenPoints.push(Point3d.midPoint(back[0], back[1])); // Two back points form the backside.
      if ( sidesIx.hasIndex(PI.MID.SIDES) ) {
        // The back point closest to the facing point share a side.
        facing.forEach(pt => pt.t0 = Point3d.distanceSquaredBetween(pt, back[0]));
        const idx = facing[1].t0 < facing[0].t0;  // idx 0 <= idx 1 ? 0; idx 1 < idx 0 ? 1.
        tokenPoints.push(Point3d.midPoint(facing[0], back[idx]));  //
        tokenPoints.push(Point3d.midPOint(facing[1], back[1 - idx]));
      }
    }
    insetPoints(tokenPoints, center, inset);

    // Add center point last, b/c it is not inset. Add to first position.
    if ( bs.hasIndex(PI.CENTER) ) tokenPoints.unshift(center);

    // 3d
    const d3Mask = SmallBitSet.fromIndices([PI.D3.TOP, PI.D3.MID, PI.D3.BOTTOM]);
    const d3Ix = bs.intersectionNew(d3Mask);

    // If none of TOP, MID, or BOTTOM, then midpoint is assumed.
    if ( d3Ix.isEmpty ) return tokenPoints;

    // Create top, mid, or bottom points as needed.
    const out = [];
    if ( d3Ix.hasIndex(PI.D3.MID) ) out.push(...tokenPoints);
    if ( d3Ix.hasIndex(PI.D3.TOP) ) out.push(...tokenPoints.map(pt => {
      pt = pt.clone();
      pt.z = topZ;
      return pt;
    }));
    if ( d3Ix.hasIndex(PI.D3.BOTTOM) ) out.push(...tokenPoints.map(pt => {
      pt = pt.clone();
      pt.z = bottomZ;
      return pt;
    }));
    return out;
  }

  /**
   * Determine which corner- or mid-points are facing and which are back.
   * Two approaches:
   * 1. Based on token (viewer) rotation.
   * 2. Based on points in front of the token's (target's) center point relative to a viewpoint.
   *    E.g., same side as viewpoint relative to a line perpendicular to the center-->viewpoint line from center.
   * @param {Point3d[]} pts
   * @param {Token} viewer
   * @param {Point3d} [viewpoint]
   * @returns {object}
   * - @prop {Point3d[]} facing
   * - @prop {Point3d[]} back
   */
  static _facingPoints(pts, token, viewpoint) {
    // Token rotation is 0º for due south, while Ray is 0º for due east.
    // Token rotation is 90º for due west, while Ray is 90º for due south.
    // Use the Ray version to divide the token into front and back.
    const facing = [];
    const back = [];
    const center = Point3d.fromTokenCenter(token);
    let b;
    if ( viewpoint ) {
      // Determine the line perpendicular to the center --> viewpoint line and use to sort the points.
      const dir = viewpoint.subtract(center);
      const dirPerp = Point3d.tmp.set(dir.y, -dir.x, 0); // (-dir.y, dir.x) flips front/back.
      b = center.add(dirPerp);
      dir.release();
      dirPerp.release();
    } else {
      // Token rotation is 0º for due south, while Ray is 0º for due east.
      // Token rotation is 90º for due west, while Ray is 90º for due south.
      // Use the Ray version to divide the token into front and back.
      const angle = Math.toRadians(token.document.rotation);
      b = PIXI.Point.fromAngle(center, angle, 100);
    }
    pts.forEach(pt => {
      const arr = foundry.utils.orient2dFast(center, b, pt) > 0 ? back : facing;
      arr.push(pt);
    });
    center.release();
    b.release();
    return { facing, back };
  }

  /**
   * Helper that constructs 3d points for the points of a token shape (rectangle or polygon).
   * Uses the elevation provided as the z-value.
   * @param {PIXI.Polygon|PIXI.Rectangle} tokenShape
   * @parma {number} elevation
   * @returns {Point3d[]} Array of corner points.
   */
  static getCorners(tokenShape, elevation) {
    const PAD = -1;
    // Rectangle is easier to pad, so handle separately.
    if ( tokenShape instanceof PIXI.Rectangle ) {
      // Token unconstrained by walls.
      // Use corners 1 pixel in to ensure collisions if there is an adjacent wall.
      // PIXI.Rectangle.prototype.pad modifies in place.
      tokenShape = tokenShape.clone();
      tokenShape.pad(PAD);
      return [
        Point3d.tmp.set(tokenShape.left, tokenShape.top, elevation),
        Point3d.tmp.set(tokenShape.right, tokenShape.top, elevation),
        Point3d.tmp.set(tokenShape.right, tokenShape.bottom, elevation),
        Point3d.tmp.set(tokenShape.left, tokenShape.bottom, elevation)
      ];
    } else tokenShape = tokenShape.toPolygon();

    // Constrained is polygon. Only use corners of polygon
    // Scale down polygon to avoid adjacent walls.
    const padShape = tokenShape.pad(PAD, { scalingFactor: 100 });
    return [...padShape.iteratePoints({close: false})].map(pt => new Point3d(pt.x, pt.y, elevation));
  }


  /**
   * Destroy any PIXI objects and remove hooks upon destroying.
   */
  destroy() {
    this.#target = undefined;
    this.#viewer = undefined;
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

  _clearCanvasDebug() {
    this.debugCanvasDraw.clearDrawings();
    this.viewpoints.forEach(vp => this.debugDrawForViewpoint(vp).clearDrawings())
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

export class CachedViewerLOS extends ViewerLOS {

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
      calcClass: this.calculator.constructor.name,
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

/**
 * Set the numeric bit value for object of indices, recursively.
 */
/*
function setPointOptions(obj, prefix = {}) {
  for ( const [key, index] of Object.entries(obj) ) {
    if ( Number.isNumeric(index) ) prefix[key] = 2 ** index;
    else prefix[key] = setPointOptions(index);
  }
  return prefix;
}
ViewerLOS.POINT_OPTIONS = setPointOptions(ViewerLOS.POINT_INDICES);
*/


// const { UNOBSCURED, DIM, BRIGHT } = ViewerLOS.VISIBILITY_LABELS;
