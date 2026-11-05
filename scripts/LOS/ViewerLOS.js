/* globals
canvas,
CONFIG,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";

// Geometry
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { GeometricPrimitive } from "../geometry/placeable_geometry/GeometricPrimitive.js";
import { Frustum } from "../geometry/3d/Frustum.js";
import { AABB3d } from "../geometry/3d/AABB3d.js";
import { TokenGeometry } from "../geometry/placeable_geometry/TokenGeometry.js";

// LOS folder
import { tokensOverlap } from "./util.js";
import { SmallBitSet } from "./SmallBitSet.js";

// Viewpoint algorithms.
import { Viewpoint } from "./Viewpoint.js";

/**

ViewerLOS
- viewpoint
  - needs calculator (from parent viewerLOS)
- calculator
  - Needs occlusionTester
- occlusionTester

ViewerLOS should not be responsible for defining the calculator or the occlusion tester.
ViewerLOS must set the subjectToken and initialize the occlusion tester before each calculation.
ViewerLOS defines the frustum for the occlusion tester.
- Use MultiViewFrustum to define for multiple viewpoints.
- Set frustum before calculating.
- Frustum defined and stored in ViewerLOS
Occlusion tester can share a global config object for the module.
*/

/**
 * @typedef {object} ViewerLOSConfig  Configuration settings for this class. Also see the calc config.
 * @property {number} viewpointIndex                  Points configuration for the viewer's viewpoints
 * @property {ViewpointInsets} insets                 Offset each viewpoint from viewer border
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
  static POINT_INDICES = GeometricPrimitive.POINT_INDICES;

  // Simply trim "los-algorithm-" from the setting.
  static VIEWPOINT_ALGORITHM_SETTINGS = {
    "los-algorithm-points": "points",
    "los-algorithm-geometric": "geometric",
    "los-algorithm-per-pixel": "per-pixel",
    "los-algorithm-webgl2": "webgl2",
  };

  /** @type {PercentVisibleCalculator} */
  calculator;

  /** @type {MultiViewFrustum} */
  frustum = new MultiViewFrustum();

  /** @type {ObstacleOcclusionTest} */
  get occlusionTester() { return this.calculator.occlusionTester; }

  /**
   * @param {Token} viewer                The token whose LOS should be tested
   */
  constructor(viewer, calculator) {
    this.#viewer = viewer;
    this.calculator = calculator;
  }

  // ----- NOTE: Configuration ---- //

  config = {
    // Viewpoint configuration
    viewpointIndex: 1, // Center point only.
    insets: {
      sides: 0,
      top: 0,
      bottom: 0,
    },
    angle: true, // If constrained by the viewer vision angle
    threshold: 0.75, // Percent used for LOS
  };

  // ----- NOTE: Viewer ----- //

  /** @type {Point3d} */
  viewerCenter = new Point3d();

  /** @type {number} */
  get visionAngle() { return this.viewer?.vision.data.angle ?? 360; }

  /**
   * The token associated with a camera location signifying the viewer.
   * @type {Token}
   */
  #viewer;

  get viewer() { return this.#viewer; }

  /** @type {GeometricPrimitive} */
  get viewerShape() {
    const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.tokens.geomForPlaceable(this.viewer).full; // Don't need the constrained shape here.
    return geom.shapes[0];
  }

  // ----- NOTE: Viewpoints ----- //

  /** @type {Viewpoint} */
  viewpoints = [];

  // Track key viewpoint parameters.

  /** @type {number} */
  #currentViewpointIndex = null;

  /** @type {class} */
  #currentViewerShape = null;

  /**
   * Track viewer dimensions to determine if viewpoints need to be changed.
   */
  #currentViewerDims = new Point3d();

  _viewerDimsChanged() {
    using dims = TokenGeometry.tokenDimensions(this.viewer.document);
    return !this.#currentViewerDims.equals(dims);
  }


  /** @type {ViewpointInsets} Scratch object; valid until the next call. */
  #insetScratch = { sides: 0, top: 0, bottom: 0 };

  /** @type {ViewpointInsets} Insets used when the viewpoints were last built. */
  #currentInsets = { sides: null, top: null, bottom: null };

  // Tracking rotation for directional viewpoints.

  /** @type {number|null} */
  #currentFacingSide = null;

  /** Viewpoint indices whose positions depend on the direction to the target. */
  static #DIRECTION_MASK = SmallBitSet.fromIndices((() => {
    const PI = GeometricPrimitive.POINT_INDICES;
    return [PI.CORNERS.FACING, PI.CORNERS.MID, PI.CORNERS.BACK, PI.SIDES.FACING, PI.SIDES.MID, PI.SIDES.BACK];
  })());

  #facingSide() {
    using dir = this.targetShape.center.subtract(this.viewerShape.center);
    return Viewpoint.findFacingSide(this.viewerShape.internalPoints, dir, this.#currentFacingSide);
  }

  #facingChanged() {
    const usesDirection = SmallBitSet.fromNumber(this.config.viewpointIndex)
      .intersects(this.constructor.#DIRECTION_MASK);
    return usesDirection && this.#facingSide() !== this.#currentFacingSide;
  }

  get viewpointInsets() {
    Object.assign(this.#insetScratch, this.config.insets);
    return this.#insetScratch;
  }

  #insetsChanged() {
    const now = this.viewpointInsets;
    const was = this.#currentInsets;
    return now.sides !== was.sides || now.top !== was.top || now.bottom !== was.bottom;
  }

  /**
   * Set up the viewpoints for this viewer.
   */
  initializeViewpoints() {
    this.viewerCenter.copyFrom(this.viewerShape.center);
    this.targetLocation.copyFrom(this.targetShape.center);
    using dir = this.targetLocation.subtract(this.viewerCenter);

    const insets = this.viewpointInsets;
    const facingSide = this.#facingSide();
    const pts = Viewpoint.constructTokenPoints(this.viewerShape, dir, {
      pointKey: this.config.viewpointIndex,
      insets,
      facingSide: this.#facingSide(),
    });
    this.#currentFacingSide = facingSide;

    // Construct the viewpoints: either modify existing or construct new.
    const n = Math.min(this.viewpoints.length, pts.length);
    this.viewpoints.length = pts.length;
    for ( let i = 0; i < n; i += 1 ) this.viewpoints[i].setFromPoint(pts[i]);
    for ( let i = n, iMax = pts.length; i < iMax; i += 1 ) this.viewpoints[i] = new Viewpoint(this, pts[i]);

    // Cache the key viewpoint parameters so we know when to rebuild the viewpoints.
    TokenGeometry.tokenDimensions(this.viewer.document, this.#currentViewerDims);
    this.#currentViewerShape = this.viewerShape;
    this.#currentViewpointIndex = this.config.viewpointIndex;
    Object.assign(this.#currentInsets, insets);

    return true;
  }

  // ----- NOTE: Caching ----- //

  /** @type {boolean} */
  #dirty = true;

  get dirty() {
    this.#dirty ||= this.#insetsChanged()
                 || this.#currentViewpointIndex !== this.config.viewpointIndex
                 || this.#currentViewerShape !== this.viewerShape
                 || this._viewerDimsChanged()
                 || this.#facingChanged();
    return this.#dirty;
  }

  set dirty(value) { this.#dirty ||= value; }



  /**
   * Update the viewpoints if needed.
   */
  _clean() {
    this.initializeViewpoints();
    this.#dirty = false;
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
  targetLocation = new Point3d();

  /** @type {PlaceableGeometry} */
  get targetGeometry() {
    const type = this.calculator.constructor.targetGeometryType;
    return CONFIG[GEOMETRY_LIB_ID].geometryManager.tokens.geomForPlaceable(this.target)[type];
  }

  /** @type {GeometricPrimitive} */
  get targetShape() { return this.targetGeometry.shapes[0]; }

  // ----- NOTE: Visibility testing ----- //

  get hasLOS() { return this.percentVisible > 0 && this.percentVisible >= this.config.threshold; } // If threshold is 0, any part counts.

  _percentVisible;

  get percentVisible() {
    if ( !Number.isNumeric(this._percentVisible) ) this.calculate();
    return this._percentVisible;
  }

  /**
   * Calculate the line-of-sight for a set of viewpoints.
   * @param {CalculatorConfig} cfg
   */
  calculate() {
    // Wipe the previous estimate.
    this.viewpoints.forEach(vp => vp.lastResult = undefined);

    // Lock in the current viewer and target location.
    TokenGeometry.tokenCenter(this.viewer.document, this.viewerCenter);
    TokenGeometry.tokenCenter(this.target.document, this.targetLocation);

    this.occlusionTester.initialize({
      subjectToken: this.target,
      tokensToExclude: [this.viewer],
      levelId: this.viewer.document.level,
    });

    // Can skip calculation if simple view test returns true/false.
    const alwaysVisible = this.simpleVisibilityTest();
    if ( alwaysVisible === true || alwaysVisible === false ) {
      this._percentVisible = Number(alwaysVisible);
      return;
    }

    // Debug:
    // console.debug(`\nViewerLOS|viewer ${this.viewer.name} at ${this.viewerCenter}
    // (Source at ${this.viewer.document._source.x}, ${this.viewer.document._source.y}).`);
    // console.debug(`ViewerLOS|target ${this.target.name} at ${this.targetLocation}
    // (Source at ${this.target.document._source.x}, ${this.target.document._source.y}).`);

    this._percentVisible = 0;
    if ( this.dirty ) this._clean();

    // Set up the calculator frustum.
    this._setFrustum();
    this.calculator.occlusionTester.frustum = this.frustum;

    // Set the calculator target
    this.calculator.targetShape = this.targetGeometry.shapes[0];
    this.calculator.targetLocation = this.targetLocation;


    // Test each viewpoint until unobscured is 1.
    for ( const vp of this.viewpoints ) {
      if ( this._viewpointBlockedByViewer(vp.viewpoint) ) {
        vp.lastResult = vp.calculator._createResult();
        vp.lastResult.makeFullyNotVisible();
        // Debug: console.debug(`\nViewerLOS|viewer ${this.viewer.name} at ${this.viewerCenter}:
        // vp ${vp.viewpoint} blocked`);
        continue;
      }
      const res = vp.calculate();
      this._percentVisible = Math.max(this._percentVisible, res.percentVisible);
      if ( this._percentVisible >= 1 ) {
        // Debug: console.debug(`\nViewerLOS|viewer ${this.viewer.name} at
        // ${this.viewerCenter}: percentVisible: ${this._percentVisible}`);
        return;
      }
    }
    if ( CONFIG[MODULE_ID].useStereoBlending
      && this._percentVisible < this.config.threshold ) this._calculateStereo();
    // Debug: if ( this._percentVisible.almostEqual(0) ) console.debug(`\nViewerLOS|viewer
    // ${this.viewer.name}: target ${this.target.name} not visible.`);
    // Debug: console.debug(`\nViewerLOS|viewer ${this.viewer.name} at
    // ${this.viewerCenter}: percentVisible: ${this._percentVisible}`);
  }

  /**
   * Basic tests for visibility of target from viewer perspective.
   * @returns {boolean|undefined} True if the viewer must see the target.
   *                              False if viewer can never see the target.
   *                              Otherwise undefined.
   */
  simpleVisibilityTest() {
    const viewer = this.viewer;
    const target = this.target;
    if ( !viewer || !target ) {
      console.warn(`${this.constructor.name}#simpleVisibilityTest called without viewer or target set.`, { viewer, target });
      return true; // Returning undefined would likely result in a calculation without target or viewer.
    }

    // To avoid obvious errors.
    if ( viewer === target ) return true;

    // If the viewer and target are on different levels,
    // the level of the target must be viewable from the level of the viewer.
    const viewerLevelId = this.viewer.document.level;
    const targetLevelId = this.target.document.level;
    if ( viewerLevelId !== targetLevelId ) {
      const viewerLevel = canvas.scene.levels.get(viewerLevelId);
      if ( !viewerLevel.visibility.levels.has(targetLevelId) ) return false;
    }

    // If the target is not within the vision angle of the viewer, it is not visible.
    if ( viewer.vision
      && this.config.angle
      && !this.constructor.targetWithinLimitedAngleVision(viewer.vision, target) ) return false;

    // If directly overlapping, presumed visible.
    if ( tokensOverlap(viewer, target) ) return true;

    // Otherwise, calculation is required.
    return undefined;
  }

  _setFrustum() {
    // Set the target.
    this.frustum.targetAABB = this.targetGeometry.aabb;

    // Remove all viewpoints from the frustum that are not in the current viewpoint list.
    const keys = new Set(this.viewpoints.map(vp => vp.viewpoint.key));
    for ( const key of [...this.frustum.frustums.keys()] ) {
      if ( !keys.has(key) ) this.frustum.frustums.delete(key);
    }

    // Add in viewpoints. (Repeats will be ignored)
    this.viewpoints.forEach(vp => this.frustum.addViewpoint(vp.viewpoint));
    this.frustum.setAABB();
  }

  /** @type {PercentVisibleResult} */
  _stereoResult;

  /**
   * For a given set of viewpoint results, blend into a single result
   */
  _calculateStereo() {
    const numViewpoints = this.viewpoints.length;
    this._stereoResult = this.viewpoints[0].lastResult;
    for ( let i = 1; i < numViewpoints; i += 1 ) {
      const vp = this.viewpoints[i];
      this._stereoResult = this._stereoResult.blendMaximize(vp.lastResult);
    }
    this._percentVisible = this._stereoResult.percentVisible;
  }

  /**
   * Viewpoint blocked if it is further from the target than the center point.
   * In other words, if it traverses too much of the viewer shape.
   * Also blocked if outside the constrained token border.
   * @param {Point3d|PIXI.Point} pt
   * @returns {boolean} True if blocked
   */
  _viewpointBlockedByViewer(pt) {
    // If the viewpoint is outside the constrained border, treat as blocked.
    if ( this.constructor.testPointOutsideConstrainedBorder(pt, this.viewer) ) return true;

    // Viewpoint must be closer to the target center than the viewer center.
    using viewerCtr = this.viewerShape.center.to2d();
    using targetCtr = this.targetShape.center.to2d();
    using tc = targetCtr.subtract(viewerCtr);
    const len2 = tc.dot2(); // Distance squared between viewer and target.
    if ( len2.almostEqual(0) ) return false;

    // Blocked only when behind the viewer's center relative to the target.
    // (The line to the target would cross the viewer's own body).
    // Level or forward points are never blocked.
    using pt2d = pt.to2d();
    using pc = pt2d.subtract(viewerCtr);
    return (tc.dot(pc) / Math.sqrt(len2)) < -1;
  }

  /**
   * Test if any part of the target is within the limited angle vision of the token.
   * @param {PointVisionSource} visionSource
   * @param {Token|PIXI.Rectangle|PIXI.Polygon} targetShape
   * @returns {boolean}
   */
  static targetWithinLimitedAngleVision(visionSource, targetOrShape) {
    const targetShape = targetOrShape instanceof foundry.canvas.placeables.Token
      ? targetOrShape.tokenBorder : targetOrShape;
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
    const rMin = foundry.canvas.geometry.Ray.fromAngle(x, y, aMin, canvas.dimensions.maxR);
    const rMax = foundry.canvas.geometry.Ray.fromAngle(x, y, aMax, canvas.dimensions.maxR);

    const targetWithin = () => {
      const opts = { inside: true };
      const hasIx = targetShape.lineSegmentIntersects(rMin.A, rMin.B, opts)
                 || targetShape.lineSegmentIntersects(rMax.A, rMax.B, opts);
      return hasIx + 1; // 1 if inside (no intersection); 2 if intersects.
    };

    // Probably worth checking the target center first
    const LimitedAnglePolygon = foundry.canvas.geometry.LimitedAnglePolygon;
    const lsi = foundry.utils.lineSegmentIntersects;
    const center = targetShape.center;
    if ( LimitedAnglePolygon.pointBetweenRays(center, rMin, rMax, angle) ) return targetWithin();

    // TODO: Would it be more performant to assign an angle to each target point?
    // Or maybe just check orientation of ray to each point?
    const edges = targetShape.toPolygon().iterateEdges();
    for ( const edge of edges ) {
      if ( lsi(rMin.A, rMin.B, edge.a, edge.b) ) return 2;
      if ( lsi(rMax.A, rMax.B, edge.a, edge.b) ) return 2;
      if ( LimitedAnglePolygon.pointBetweenRays(edge.a, rMin, rMax, angle) ) return targetWithin();
      if ( LimitedAnglePolygon.pointBetweenRays(edge.b, rMin, rMax, angle) ) return targetWithin();
    }

    return 0;
  }


  /**
   * Test if a viewpoint or target point is outside the constrained border of the token.
   * Expands the constrained border slightly to accommodate points exactly on border.
   * @param {PIXI.Point} pt
   * @param {Token} token
   * @returns {boolean} If no constrained border, returns true. Otherwise true if within the constrained border.
   */
  static testPointOutsideConstrainedBorder(pt, token) {
    const constrainedBorder = token.constrainedTokenBorder;
    if ( constrainedBorder.equals(token.tokenBorder) ) return false;
    return !constrainedBorder.clone().pad(2).contains(pt.x, pt.y); // Expand slightly to accommodate points on the edge.
  }

  /* ----- NOTE: Debug ----- */

  /**
   * For debugging.
   * Draw debugging objects on the main canvas.
   */
  _drawCanvasDebug(debugDraw, debugViewpointDraw) {
    this._drawVisibleTokenBorder(debugDraw);
    this._drawLineOfSightDebug(debugDraw);
    this.viewpoints.forEach(vp => vp._drawCanvasDebug(debugViewpointDraw));
  }

  /**
   * For debugging.
   * Draw the line from the viewpoint to the target.
   * Color red if fails LOS threshold test for that viewpoint.
   */
  _drawLineOfSightDebug(draw) {
    // Debug:
    // console.debug(`\nViewerLOS debug|viewer ${this.viewer.name} at ${this.viewerCenter}
    // (Source at ${this.viewer.document._source.x}, ${this.viewer.document._source.y}).`);
    // console.debug(`ViewerLOS debug|target ${this.target.name} at ${this.targetLocation}
    // (Source at ${this.target.document._source.x}, ${this.target.document._source.y}).`);

    const simpleTest = this.simpleVisibilityTest();
    if ( simpleTest === false || simpleTest === true ) {
      // No viewpoints used; color each with light green or light red line.
      const opts = { color: simpleTest ? Draw.COLORS.LIGHT.green : Draw.COLORS.LIGHT.red };
      for ( const vp of this.viewpoints ) vp._drawLOSSegment(this.targetLocation, draw, opts);
    } else for ( const vp of this.viewpoints ) vp._drawLOS(this.targetLocation, draw);
  }


  /**
   * For debugging.
   * Draw the constrained token border and visible shape, if any.
   */
  _drawVisibleTokenBorder(draw) {
    const color = Draw.COLORS.blue;

    // Fill in the target border on canvas
    if ( this.target ) {
      const border = CONFIG[GEOMETRY_LIB_ID].CONFIG.constrainTokens
        ? this.target.constrainedTokenBorder : this.target.tokenBorder;
      draw.shape(border, { color, fill: color, fillAlpha: 0.2});
    }
  }
}

class MultiViewFrustum {

  /**
   * Store frustums by the key of the viewpoint.
   * @type {Map<BigInt, Frustum}
   */
  frustums = new Map();

  /**
   * Frustum target aabb
   * @type {AABB3d}
   */
  #targetAABB = new AABB3d();

  get targetAABB() { return this.#targetAABB; }

  set targetAABB(value) {
    if ( this.#targetAABB.almostEqual(value) ) return;
    this.#targetAABB.copyFrom(value);
    this.updateTargetAABB();
  }

  aabb = new AABB3d();

  /**
   * Define the bounding box for this frustum.
   */
  setAABB() {
    const aabbs = [...this.frustums.values().map(f => f.aabb)];
    AABB3d.union(aabbs, this.aabb);
  }

  /**
   * Update or add a viewpoint.
   * @param {Point3d} viewpoint
   * @returns {this}
   */
  addViewpoint(viewpoint, infiniteDistance = false) {
    const key = viewpoint.key;
    if ( this.frustums.has(key) ) return this;
    let frustum = null;
    const targetAABB = this.#targetAABB;
    if ( targetAABB ) {
      frustum = this.frustums.get(key) ?? new Frustum();
      frustum = Frustum.fromAABB(targetAABB, { frustum, viewpoint, infiniteDistance });
    }
    this.frustums.set(key, frustum);
    this.setAABB();
    return this;
  }

  removeViewpoint(viewpoint) { this.frustums.delete(viewpoint.key); }

  /**
   * Update the target aabb for each frustum, keeping the viewpoint.
   * @param {AABB3d} [aabb]
   */
  updateTargetAABB(aabb, infiniteDistance = false) {
    if ( aabb ) this.#targetAABB.copyFrom(aabb);
    aabb = this.targetAABB;
    const opts = { infiniteDistance };
    for ( const [key, frustum] of this.frustums.entries() ) {
      opts.frustum = frustum;
      opts.viewpoint = null;
      if ( !frustum ) {
        opts.viewpoint = Point3d.invertKey(key);
        opts.frustum = new Frustum();
      }
      Frustum.fromAABB(aabb, opts);
    }
    this.setAABB();
  }

  /**
   * Create a frustum from a target token.
   * @param {Token} target
   * @param {object} [opts]
   * @param {Point3d[]} [opts.viewpoints=[]]
   * @returns {MultiViewFrustum}
   */
  static fromTarget(target, { viewpoints, ...opts } = {}) {
    const out = new this();
    if ( !viewpoints && opts.viewpoint ) viewpoints = [opts.viewpoint];
    for ( const vp of viewpoints ) out.addViewpoint(vp, opts.infiniteDistance);
    out.targetAABB = target.aabb;
    out.setAABB();
    return out;
  }

  /**
   * Create a frustum from a bounding box.
   * @param {AABB3d} aabb
   * @param {object} [opts]
   * @param {Point3d[]} [opts.viewpoints=[]]
   * @returns {MultiViewFrustum}
   */
  static fromAABB(aabb, { viewpoints, ...opts } = {}) {
    const out = new this();
    if ( !viewpoints && opts.viewpoint ) viewpoints = [opts.viewpoint];
    for ( const vp of viewpoints ) out.addViewpoint(vp, opts.infiniteDistance);
    out.targetAABB = aabb;
    out.setAABB();
    return out;
  }

  // ----- NOTE: Iteration ----- //

  *iteratePoints() {
    for ( const frustum of this.frustums.values() ) yield* frustum.iteratePoints();
  }

  *iterateFaces(opts) {
    for ( const frustum of this.frustums.values() ) yield* frustum.iterateFaces(opts);
  }

  #overlapTest(methodName, ...args) {
    for ( const frustum of this.frustums.values() ) {
      if ( frustum[methodName](...args) ) return true;
    }
    return false;
  }

  /**
   * Test if a point is contained within the frustrum.
   * @param {Point3d} p
   * @returns {boolean}
   */
  containsPoint(p, testBottom) { return this.#overlapTest("containsPoint", p, testBottom); }

  /**
   * Does the segment cross the frustum or contained within?
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {boolean}
   */
  overlapsSegment(a, b) { return this.#overlapTest("overlapsSegment", a, b); }

  /**
   * Test if a sphere is contained within the frustum.
   * @param {Sphere} sphere
   * @returns {boolean}
   */
  overlapsSphere(sphere) { return this.#overlapTest("overlapsSphere", sphere); }

  /**
   * Test if a given AABB overlaps this frustrum
   * @param {AABB} aabb
   * @returns {boolean}
   */
  overlapsAABB(aabb) { return this.#overlapTest("overlapsAABB", aabb); }

  poly3dWithinFrustum(poly3d) { return this.#overlapTest("poly3dWithinFrustum", poly3d); }

  overlapsGeometry(geom) { return this.#overlapTest("overlapsGeometry", geom); }

  overlapsDocument(doc, foregroundType) { return this.#overlapTest("overlapsDocument", doc, foregroundType); }

  overlapsRegionDocument(regionD) { return this.#overlapTest("overlapsRegionDocument", regionD); }

  _overlapsRegionShapeGeom(geom) { return this.#overlapTest("_overlapsRegionShapeGeom", geom); }

  outsideElevation(...args) {
    for ( const frustum of this.frustums.values() ) {
      if ( !frustum.outsideElevation(...args) ) return false;
    }
    return true;
  }

  draw2d(opts) {
    for ( const frustum of this.frustums.values() ) frustum.draw2d(opts);
  }

}
