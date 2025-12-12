/* globals
canvas,
CONFIG,
foundry,
LimitedAnglePolygon,
PIXI,
Ray,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";

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
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT]: "sight",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND]: "sound",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.MOVE]: "move",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER]: "light",
  "sight": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
  "sound": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND,
  "move": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.MOVE,
  "light": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER, // No "light" equivalent
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
      MID: 2,
      BACK: 3,
    },
    SIDES: {
      FACING: 4,
      MID: 5,
      BACK: 6,
    },
    D3: {
      // If none of TOP, MID, or BOTTOM, then midpoint is assumed.
      // Otherwise, MID may be omitted.
      TOP: 7,
      MID: 8,
      BOTTOM: 9,
    }
  };

  static POINT_OPTIONS = {}; // Filled in below.

  // Simply trim "los-algorithm-" from the setting.
  static VIEWPOINT_ALGORITHM_SETTINGS = {
    "los-algorithm-points": "points",
    "los-algorithm-geometric": "geometric",
    "los-algorithm-per-pixel": "per-pixel",
    "los-algorithm-sample-pixel": "sample-pixel",
    "los-algorithm-hybrid": "hybrid",
    "los-algorithm-webgl2": "webgl2",
    "los-algorithm-webgpu": "webgpu",
    "los-algorithm-webgpu-async": "webgpu-async",
  };

  /** @type {PercentVisibleCalculator} */
  calculator;

  /**
   * @param {Token} viewer      					The token whose LOS should be tested
   * @param {PercentVisibleCalculator} 		The visibility calculator to use.
   */
  constructor(viewer, calculator, cfg = {}) {
    this.viewer = viewer;
    this.calculator = calculator;
    // Dirty variable already set for constructor.

    this.#config = foundry.utils.mergeObject(this.constructor.defaultConfiguration, cfg, { inplace: false, insertKeys: false });
  }

  // ----- NOTE: Configuration ---- //

  static defaultConfiguration = {
    // Viewpoint configuration
    viewpointIndex: 1, // Center point only.
    viewpointInset: 0, // Percentage inset
    angle: true, // If constrained by the viewer vision angle
    threshold: 0.75, // Percent used for LOS
  };

  /** @type {ViewerLOSConfig} */
  #config = { ...this.constructor.defaultConfiguration };

  get config() { return structuredClone(this.#config); }

  set config(cfg = {}) {
    if ( Object.hasOwn(cfg, "viewpointIndex")
      && cfg.viewpointIndex instanceof SmallBitSet ) cfg.viewpointIndex = cfg.viewpointIndex.word;
    this.#dirty ||= Object.hasOwn(cfg, "viewpointIndex") || Object.hasOwn(cfg, "viewpointInset");
    foundry.utils.mergeObject(this.#config, cfg, { inplace: true, insertKeys: false });
  }

  get viewpointInset() { return this.#config.viewpointInset; }

  get threshold() { return this.#config.threshold; }

  set threshold(value) { this.#config.threshold = value; }

  // ----- NOTE: Caching ----- //

  /** @type {boolean} */
  #dirty = true;

  get dirty() { return this.#dirty; }

  set dirty(value) { this.#dirty ||= value; }

  /**
   * Update the viewpoints.
   */
  _clean() {
    this.#dirty = !this.initializeViewpoints();
  }

  // ----- NOTE: Viewer ----- //

  /** @type {Point3d} */
  get center() { return this.viewer ? Point3d.fromTokenCenter(this.viewer) : undefined; }

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
  }

  // ----- NOTE: Viewpoints ----- //
  /** @type {Viewpoint} */
  viewpoints = [];

  /**
   * Set up the viewpoints for this viewer.
   */
  initializeViewpoints() {
    if ( !this.viewer ) return false;
    const pts = this.constructor.constructTokenPoints(this.viewer, {
      pointKey: this.config.viewpointIndex,
      inset: this.config.viewpointInset,
      // tokenShape defaults to this.viewer.tokenBorder.
    });

    // Destroy existing viewpoints
    this.viewpoints.length = pts.length;

    // Build new viewpoints.
    pts.forEach((pt, idx) => this.viewpoints[idx] = new Viewpoint(this, pt));
    return true;
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
  get targetLocation() { return Point3d.fromTokenCenter(this.target); }

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
    this.viewpoints.forEach(vp => vp.lastResult = undefined);
    this.calculator.initializeView(this);
    if ( this.dirty ) this._clean();

    this._percentVisible = 0;
    const simpleTest = this.simpleVisibilityTest();
    if ( ~simpleTest ) {
      this._percentVisible = simpleTest;
      return;
    }

    // Test each viewpoint until unobscured is 1.
    for ( const vp of this.viewpoints ) {
      if ( this._viewpointBlockedByViewer(vp.viewpoint) ) {
        vp.lastResult = vp.calculator._createResult();
        vp.lastResult.makeFullyNotVisible();
        continue;
      }
      const res = vp.calculate();
      this._percentVisible = Math.max(this._percentVisible, res.percentVisible);
      if ( this._percentVisible >= 1 ) return;
    }
    if ( CONFIG[MODULE_ID].useStereoBlending
      && this._percentVisible < this.config.threshold ) this._calculateStereo();
  }

  /** @type {PercentVisibleResult} */
  _stereoResult;

  /**
   * For a given set of viewpoint results, blend into a single result
   */
  _calculateStereo() {
    const numViewpoints = this.viewpoints.length;
    this._stereoResult = this.viewpoints[0].lastResult
    for ( let i = 1; i < numViewpoints; i += 1 ) {
      const vp = this.viewpoints[i];
      this._stereoResult = this._stereoResult.blendMaximize(vp.lastResult)
    }
    this._percentVisible = this._stereoResult.percentVisible;
  }

  /**
   * Viewpoint blocked if it is further from the target than the center point.
   * In other words, if it traverses too much of the viewer shape.
   * Also blocked if outside the constrained token border.
   * @param {Point3d} pt
   * @returns {boolean} True if blocked
   */
  _viewpointBlockedByViewer(pt) {
    // If the viewpoint is outside the constrained border, treat as blocked.
    if ( this.constructor.testPointOutsideConstrainedBorder(pt, this.viewer, this.config.inset) ) return true;

    // Viewpoint must be closer to the target center than the viewer center.
    const ctr = this.center;
    if ( pt.almostEqual(ctr) ) return false; // Center point is special; not blocked.
    const targetCtr = Point3d.fromTokenCenter(this.target);
    return PIXI.Point.distanceSquaredBetween(ctr, targetCtr) < PIXI.Point.distanceSquaredBetween(pt, targetCtr); // Use a 2d distance test.
  }

  /**
   * Test if a viewpoint or target point is outside the constrained border of the token.
   * Expands the constrained border slightly to accommodate points exactly on border.
   * Does not handle insets less than 0.
   * @param {PIXI.Point} pt
   * @param {Token} token
   * @param {number} [inset=1]
   * @returns {boolean} If no constrained border, returns true. Otherwise true if within the constrained border.
   */
  static testPointOutsideConstrainedBorder(pt, token, inset = 0) {
    const constrainedBorder = token.constrainedTokenBorder;
    if ( constrainedBorder.equals(token.tokenBorder) ) return false;
    if ( inset > 0 ) return true;
    return constrainedBorder.pad(2).contains(pt.x, pt.y); // Expand slightly to accommodate points on the edge.
  }

  /**
   * Test if any part of the target is within the limited angle vision of the token.
   * @param {PointVisionSource} visionSource
   * @param {Token|PIXI.Rectangle|PIXI.Polygon} targetShape
   * @returns {boolean}
   */
  static targetWithinLimitedAngleVision(visionSource, targetOrShape) {
    const targetShape = targetOrShape instanceof foundry.canvas.placeables.Token ? targetOrShape.tokenBorder : targetOrShape;
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
    tokenShape ??= token.tokenBorder;
    const tokenPoints = [];
    const bs = pointKey instanceof SmallBitSet ? pointKey : SmallBitSet.fromNumber(pointKey);
    const PI = this.POINT_INDICES;

    // Are there any corners?
    const cornersMask = SmallBitSet.fromIndices([PI.CORNERS.FACING, PI.CORNERS.MID, PI.CORNERS.BACK]);
    const cornersIx = bs.intersectionNew(cornersMask);

    // Are there any sides?
    const sidesMask = SmallBitSet.fromIndices([PI.SIDES.FACING, PI.SIDES.MID, PI.SIDES.BACK]);
    const sidesIx = bs.intersectionNew(sidesMask);

    if ( !(cornersIx.isEmpty && sidesIx.isEmpty) ) {
      const pointCategories = viewpoint
        ? this._facingTargetPoints(token, tokenShape, viewpoint)
        : this._facingViewerPoints(token, tokenShape);

      // Add corners.
      const corners = pointCategories.corners;
      if ( cornersIx.hasIndex(PI.CORNERS.FACING) ) tokenPoints.push(...corners.facing);
      if ( cornersIx.hasIndex(PI.CORNERS.MID) ) tokenPoints.push(...corners.mid);
      if ( cornersIx.hasIndex(PI.CORNERS.BACK) ) tokenPoints.push(...corners.back);

      // Add sides.
      const sides = pointCategories.sides;
      if ( sidesIx.hasIndex(PI.SIDES.FACING) ) tokenPoints.push(...sides.facing);
      if ( sidesIx.hasIndex(PI.SIDES.MID) ) tokenPoints.push(...sides.mid);
      if ( sidesIx.hasIndex(PI.SIDES.BACK) ) tokenPoints.push(...sides.back);
    }

    // Inset all corner and side points.
    const center = Point3d.fromTokenCenter(token);
    insetPoints(tokenPoints, center, inset);

    // Add center point last, b/c it is not inset nor rotated. Add to front of queue for consistency.
    if ( bs.hasIndex(PI.CENTER) ) tokenPoints.unshift(center);

    // 3d
    const d3Mask = SmallBitSet.fromIndices([PI.D3.TOP, PI.D3.MID, PI.D3.BOTTOM]);
    const d3Ix = bs.intersectionNew(d3Mask);

    // If none of TOP, MID, or BOTTOM, then midpoint is assumed.
    if ( d3Ix.isEmpty ) return tokenPoints;

    // Create top, mid, or bottom points as needed.
    const { topZ, bottomZ } = token;
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
   * @typedef {object} FacingPoints
   *
   * @prop {object} corners
   *   - @prop {Point3d[]} facing
   *   - @prop {Point3d[]} mid
   *   - @prop {Point3d[]} back
   * @prop {object} sides
   *   - @prop {Point3d[]} facing
   *   - @prop {Point3d[]} mid
   *   - @prop {Point3d[]} back
   */

  /**
   * Determine the corner- and midpoints for a given viewer that faces a given direction.
   * Viewer points should not change in number based on rotation. Instead,
   * the points are set based on a south-facing target (rotation = 0). Then points are rotated.
   * @param {Point3d[]} pts
   * @param {Token} viewer
   * @param {Point3d} viewpoint
   * @returns {FacingPoints}
   */
  static _facingViewerPoints(token, tokenShape) {
    // Rotate by the token rotation.
    // First shift so the token center is 0,0,0.
    // Then rotate.
    // Then translate back.
    // Note: Point.rotate and Point.translate does not currently affect z values.
    const out = this._facingTokenPoints(token, tokenShape);
    const rad = Math.toRadians(token.document.rotation);
    if ( !rad ) return out; // No rotation.
    const ctr = token.center;
    const fn = pt => pt
      .translate(-ctr.x, -ctr.y, pt)
      .rotate(rad, pt)
      .translate(ctr.x, ctr.y, pt);

    for ( const loc of ["facing", "mid", "back"] ) {
      out.corners[loc].forEach(fn);
      out.sides[loc].forEach(fn);
    }
    return out;
  }

  /**
   * Sort given token points into front, mid, back.
   * @param {Point3d[]} pts
   * @param {Token} token
   * @param {Point3d} [dir]     Direction from center point that indicates the token front. Defaults to due south.
   * @returns {object}
   * - @prop {Point3d[]} facing
   * - @prop {Point3d[]} mid
   * - @prop {Point3d[]} back
   */
  static sortFacingPoints(pts, token, dir) {
    dir = dir ? dir.clone() : Point3d.tmp.set(0, 1, 0);
    const dirPerp = Point3d.tmp.set(dir.y, -dir.x, 0); // (-dir.y, dir.x) flips front/back.
    const dist2d = Math.min(token.w, token.h) * 0.25; // Divide at the 0.25 and 0.75 marks
    dir.normalize(dir).multiplyScalar(dist2d, dir);
    dirPerp.normalize(dirPerp);

    const center = Point3d.fromTokenCenter(token);
    const out = {
      facing: [],
      mid: [],
      back: [],
    };
    const aFront = center.add(dir);
    const aBack = center.subtract(dir);
    const bFront = aFront.add(dirPerp);
    const bBack = aBack.add(dirPerp);
    const orient2d = foundry.utils.orient2dFast;
    const oCenterFront = orient2d(aFront, bFront, center);
    const oCenterBack = orient2d(aBack, bBack, center);
    pts.forEach(pt => {
      const arr = (orient2d(aFront, bFront, pt) * oCenterFront) < 0 ? out.facing
        : (orient2d(aBack, bBack, pt) * oCenterBack) < 0 ? out.back : out.mid;
      arr.push(pt);
    });
    Point3d.release(aFront, aBack, bFront, bBack, dir, dirPerp, center);
    return out;
  }

  /**
   * Determine which corner- or mid-points are facing and which are back for a target.
   * Based on points in front of the token's (target's) center point relative to a viewpoint.
   * E.g., same side as viewpoint relative to a line perpendicular to the center-->viewpoint line from center.
   * @param {Point3d[]} pts
   * @param {Token} viewer
   * @param {Point3d} viewpoint
   * @returns {FacingPoints}
   */
  static _facingTargetPoints(token, tokenShape, viewpoint) {
    // Determine the line perpendicular to the center --> viewpoint line and use to sort the points.
    const center = Point3d.fromTokenCenter(token);
    const dir = viewpoint.subtract(center);
    return this._facingTokenPoints(token, tokenShape, dir);
  }

  /**
   * Determine which corner- or mid-points are facing and which are back for a token facing a given direction.
   * Based on points in front of the token's (target's) center point relative to a viewpoint.
   * E.g., same side as viewpoint relative to a line perpendicular to the center-->viewpoint line from center.
   * @param {Point3d[]} pts
   * @param {Token} viewer
   * @param {Point3d} viewpoint
   * @returns {FacingPoints}
   */
  static _facingTokenPoints(token, tokenShape, dir) {
    // Divide the token into thirds : front third, mid third (sides), back third.
    // Target points don't shift with rotation. But what is considered "front", "mid", "back" can change
    // based on viewpoint perspective
    const midZ = token.bottomZ + ((token.topZ - token.bottomZ) * 0.5);
    const corners = this.getCorners(tokenShape, midZ);
    const sides = midpoints(corners);
    return {
      corners: this.sortFacingPoints(corners, token, dir),
      sides: this.sortFacingPoints(sides, token, dir),
    };
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
      tokenShape = tokenShape.clone().pad(PAD);
      return [
        Point3d.tmp.set(tokenShape.left, tokenShape.top, elevation),
        Point3d.tmp.set(tokenShape.right, tokenShape.top, elevation),
        Point3d.tmp.set(tokenShape.right, tokenShape.bottom, elevation),
        Point3d.tmp.set(tokenShape.left, tokenShape.bottom, elevation)
      ];
    } else if ( tokenShape instanceof PIXI.Polygon ) tokenShape = tokenShape.clone(); // Avoid modifying the underlying shape with pad.
    else tokenShape = tokenShape.toPolygon();

    // Constrained is polygon. Only use corners of polygon
    // Scale down polygon to avoid adjacent walls.
    const padShape = tokenShape.pad(PAD, { scalingFactor: 100 });
    return [...padShape.iteratePoints({close: false})].map(pt => new Point3d(pt.x, pt.y, elevation));
  }




  /* ----- NOTE: Debug ----- */


  /**
   * For debugging.
   * Draw debugging objects on the main canvas.
   */
  _drawCanvasDebug(debugDraw, debugViewpointDraw) {
    this._drawVisibleTokenBorder(debugDraw);
    this._drawFrustumLightSources(debugDraw);
    this._drawLineOfSightDebug(debugDraw);
    this.viewpoints.forEach(vp => vp._drawCanvasDebug(debugViewpointDraw));
  }

  /**
   * For debugging.
   * Draw the line from the viewpoint to the target.
   * Color red if fails LOS threshold test for that viewpoint.
   */
  _drawLineOfSightDebug(draw) {
    const COLORS = Draw.COLORS;
    const simpleTest = this.simpleVisibilityTest();
    const seg = { a: null, b: this.targetLocation };
    const opts = { color: null, alpha: 0.5, dashLength: 0, gapLength: 0 };
    if ( ~simpleTest ) {
      // No viewpoints used; color each with light green or light red line.
      opts.color = simpleTest ? COLORS.lightgreen : COLORS.lightred;
      opts.dashLength = 10;
      opts.gapLength = 10;
      for ( const vp of this.viewpoints ) {
        seg.a = vp.viewpoint;
        draw.segment(seg, opts);
      }
      return;
    }

    for ( const vp of this.viewpoints ) {
      seg.a = vp.viewpoint;
      if ( !vp.lastResult ) {
        // Viewpoint did not count.
        opts.dashLength = 10;
        opts.gapLength = 10;
        opts.color = COLORS.orange;
      } else if ( vp.lastResult.type === vp.lastResult.constructor.VISIBILITY.NONE ) {
        opts.dashLength = 10;
        opts.gapLength = 10;
        opts.color = COLORS.red;
      } else if ( vp.lastResult.type === vp.lastResult.constructor.VISIBILITY.FULL ) {
        opts.dashLength = 10;
        opts.gapLength = 10;
        opts.color = COLORS.green;
      } else {
        opts.dashLength = 0;
        opts.gapLength = 0;
        const percentVis = vp.percentVisible;
        opts.color = percentVis === 0 ? COLORS.red
          : percentVis < this.threshold ? COLORS.orange : COLORS.green;
      }
      draw.segment(seg, opts);
    }
  }


  /**
   * For debugging.
   * Draw the constrained token border and visible shape, if any.
   */
  _drawVisibleTokenBorder(draw) {
    const color = Draw.COLORS.blue;

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
    const ctr = Point3d.fromTokenCenter(this.target);
    for ( const src of canvas.lighting.placeables ) {
      const srcOrigin = Point3d.fromPointSource(src);
      const dist2 = Point3d.distanceSquaredBetween(ctr, srcOrigin);
      const isBright = src.brightRadius && (src.brightRadius ** 2) < dist2;
      const isDim = (src.radius ** 2) < dist2;
      if ( !(isDim || isBright) ) continue;
      const fillAlpha = isBright ? 0.3 : 0.1;
      const frustum = ObstacleOcclusionTest.frustum.rebuild({ viewpoint: srcOrigin, target: this.target });
      frustum.draw2d({ draw, width: 0, fill: Draw.COLORS.yellow, fillAlpha });
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
 * Calculate all the midpoints for an array of points.
 * Includes the midpoint between end and start (circular).
 * @param {Point3d[]} pts
 * @returns {Point3d[]}
 */
function midpoints(pts) {
  const nPts = pts.length;
  const out = Array(nPts);
  let a = pts.at(-1);
  for ( let i = 0; i < nPts; i += 1 ) {
    const b = pts[i];
    out[i] = Point3d.midPoint(a, b);
    a = b;
  }
  return out;
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
