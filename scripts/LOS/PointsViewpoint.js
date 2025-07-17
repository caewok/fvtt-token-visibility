/* globals
canvas,
CONFIG,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";
import { PercentVisibleCalculatorAbstract } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerAbstract } from "./DebugVisibilityViewer.js";

/*
Points algorithm also can use area and threshold.
Number of points tested is the total area; points without collision represent % viewable area.

Dim and bright lighting test options:
1. Point is within litTokenBorder
2. Point not obscured from light and within light radius

*/




/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class PointsViewpoint extends AbstractViewpoint {
  static get calcClass() { return PercentVisibleCalculatorPoints; }


  _drawDebugPoints(debugDraw, { width = 1 } = {}) {
    const Draw = CONFIG.GeometryLib.Draw;
    for ( const debugPoints of this.calculator.debugPoints ) {
      for ( const debugPoint of debugPoints) {
        const { A, B, hasCollision } = debugPoint;
        const color = hasCollision ? Draw.COLORS.red : Draw.COLORS.green;
        debugDraw.segment({ A, B }, { alpha: 0.5, width, color });
      }
    }
  }
}

const TOTAL = 0;
const OBSCURED = 1;
const BRIGHT = 2;
const DIM = 3;
const DARK = 4;

/**
 * Handle points algorithm.
 */
export class PercentVisibleCalculatorPoints extends PercentVisibleCalculatorAbstract {

  static get viewpointClass() { return PointsViewpoint; }

  static defaultConfiguration = {
    ...PercentVisibleCalculatorAbstract.defaultConfiguration,
    pointAlgorithm: "points-center",
    targetInset: 0.75,
    points3d: false,
  }

  /** @type {Points3d[][]} */
  targetPoints = [];

  counts = new Uint8Array(this.constructor.COUNT_LABELS.length);

  // Use separate lighting occlusion testers b/c it will change viewpoints a lot.
  /** @type {WeakMap<PointSource, ObstacleOcclusionTest>} */
  occlusionTesters = new WeakMap();

  #rayDirection = new CONFIG.GeometryLib.threeD.Point3d();

  // Points handles large target slightly differently. See _testLargeTarget.
  get largeTargetArea() { return this.counts[TOTAL]; }

  initializeCalculations() {
    this.debugPoints.length = 0;
    this._initializeLightTesting();
    this._initializeOcclusionTesters();
  }

  _calculate() {
    if ( this.config.largeTarget ) this._testLargeTarget();
    else {
      const targetPoints = this.constructTargetPoints();
      this._testPointToPoints(targetPoints);
    }
  }

  _testLargeTarget() {
    // Construct points for each target subshape, defined by grid spaces under the target.
    const target = this.target;
    const targetShapes = CONFIG[MODULE_ID].constrainTokens
      ? this.constructor.constrainedGridShapesUnderToken(target): this.constructor.gridShapesUnderToken(target);
    if ( !targetShapes.length ) {
      console.warn(`${MODULE_ID}|${this.constructor.name}|Target shapes for large target not working.`);
      const targetPoints = this.constructTargetPoints(this.target);
      this._testPointToPoints(targetPoints);
      return;
    }

    const tmpCounts = new Uint8Array(this.constructor.COUNT_LABELS.length);
    let currentPercent = 0;
    for ( const targetShape of targetShapes ) {
      const targetPoints = this.constructTargetPoints(targetShape);
      this._testPointToPoints(targetPoints);

      // If no lighting, look for maximum percent unoccluded,
      // If lighting, look for maximum percent dim.
      // Keeping in mind that denominator (number of target points) could change between iterations.
      const numerator = this.config.testLighting ? this.counts[DIM] : (this.counts[TOTAL] - this.counts[OBSCURED]);
      const newPercent = numerator / this.counts[TOTAL];
      if ( newPercent > currentPercent ) {
        tmpCounts.set(this.counts);
        currentPercent = newPercent;
      }
      if ( newPercent >= 1 ) break;
    }
    this.counts.set(tmpCounts);
  }

  _initializeLightTesting() {
    if ( this.config.testLighting ) {
      this._testLightingForPoint = this._testLightingOcclusionForPoint.bind(this);
    } else this._testLightingForPoint = () => null; // Ignore

//     const litMethod = CONFIG[MODULE_ID].litToken;
//     if ( this.config.testLighting && litMethod ) {
//       const method = litMethod ===  CONFIG[MODULE_ID].litTokenOptions.CONSTRAIN
//         ? "_testLightingContainmentForPoint" : "_testLightingOcclusionForPoint";
//       this._testLightingForPoint = this[method].bind(this);
//     } else this._testLightingForPoint = () => null; // Ignore
  }

  _initializeOcclusionTesters() {
    this.occlusionTester._initialize(this.viewpoint, this.target);
    for ( const src of canvas[this.config.sourceType].placeables ) {
      let tester;
      if ( !this.occlusionTesters.has(src) ) {
        tester = new ObstacleOcclusionTest();
        tester.config = this.config; // Link so changes to config are reflected in the tester.
        this.occlusionTesters.set(src, tester);
      }

      // Setup the occlusion tester so the faster internal method can be used.
      tester ??= this.occlusionTesters.get(src);
      tester._initialize(this.viewpoint, this.target);
    }
  }


  /* ----- NOTE: Target points ----- */


  constructTargetPoints(tokenShape) {
    const target = this.target;
    const { pointAlgorithm, targetInset, points3d } = this.config;
    const cfg = { pointAlgorithm, inset: targetInset, viewpoint: this.viewpoint };
    cfg.tokenShape = tokenShape ?? (CONFIG[MODULE_ID].constrainTokens ? this.target.constrainedTokenBorder : this.target.tokenBorder);
    const targetPoints = AbstractViewpoint.constructTokenPoints(target, cfg);
    return points3d ? PointsViewpoint.elevatePoints(target, targetPoints) : targetPoints;
  }



  /* ----- NOTE: Visibility testing ----- */


  debugPoints = [];

  _testPointToPoints(targetPoints) {
    this.counts.fill(0);
    const numPoints = targetPoints.length;
    this.counts[TOTAL] = numPoints;
    const debugPoints = Array(numPoints);
    this.debugPoints.push(debugPoints);
    for ( let i = 0; i < numPoints; i += 1 ) {
      const targetPoint = targetPoints[i];
      this.viewpoint.subtract(targetPoint, this.#rayDirection);
      const isOccluded = this.occlusionTester._rayIsOccluded(this.#rayDirection);
      this.counts[OBSCURED] += isOccluded;

      const debugObject = { A: this.viewpoint, B: targetPoint, isOccluded, isDim: null, isBright: null };
      debugPoints[i] = debugObject;
      if ( !isOccluded ) this._testLightingForPoint(targetPoint, debugObject);
    }
  }

  _testLightingForPoint;

  /**
   * Use the target's lit shape to determine if the point is lit.
   */
//   _testLightingContainmentForPoint(targetPoint, debugObject = {}) {
//     // TODO: Add option to test sound sources by switching this.config.sourceType.
//     // Requires new border calcs: soundTokenBorder
//
//     const isDim = this.target.litTokenBorder
//       ? this.target.litTokenBorder.contains(targetPoint.x, targetPoint.y) : false;
//     const isBright = isDim
//       && (this.target.brightLitTokenBorder
//         ? this.target.brightLitTokenBorder.contains(targetPoint.x, targetPoint.y) : false);
//     debugObject.isDim = isDim;
//     debugObject.isBright = isBright;
//     this.counts[BRIGHT] += isBright;
//     this.counts[DIM] += isDim;
//     this.counts[DARK] += !(isDim || isBright);
//   }

  _testLightingOcclusionForPoint(targetPoint, debugObject = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const srcOrigin = Point3d._tmp;

    let isBright = false;
    let isDim = false;
    for ( const src of canvas[this.config.sourceType].placeables ) {
      Point3d.fromPointSource(src, srcOrigin);
      const dist2 = Point3d.distanceSquaredBetween(targetPoint, srcOrigin);
      if ( dist2 > (src.dimRadius ** 2) ) continue; // Not within source dim radius.

      // If blocked, not bright or dim.
      // TODO: Don't test tokens for blocking the light or set a config option somewhere.
      // Probably means not syncing the configs for the occlusion testers.
      srcOrigin.subtract(targetPoint, this.#rayDirection); // NOTE: Modifies rayDirection, so only use after the viewer ray has been tested.
      if ( this.occlusionTesters.get(src)._rayIsOccluded(this.#rayDirection) ) continue;

      // TODO: handle light/sound attenuation from threshold walls.
      isBright ||= (dist2 <= (src.brightRadius ** 2));
      isDim ||= isBright || (dist2 <= (src.dimRadius ** 2));
      if ( isBright ) break; // Once we know a fragment is bright, we should know the rest.
    }

    debugObject.isDim = isDim;
    debugObject.isBright = isBright;
    this.counts[BRIGHT] += isBright;
    this.counts[DIM] += isDim;
    this.counts[DARK] += !(isDim || isBright);
  }
}

export class DebugVisibilityViewerPoints extends DebugVisibilityViewerAbstract {
  static viewpointClass = PointsViewpoint;

  /** @type {Token[]} */
  get viewers() { return canvas.tokens.controlled; }

  /** @type {Token[]} */
  get targets() { return game.user.targets.values(); }

  updateDebugForPercentVisible(_percentVisible) {
    // Calculate points and pull the debug data.
    for ( const viewer of this.viewers) {
      this.viewerLOS.viewer = viewer;

      for ( const target of this.targets) {
        if ( viewer === target ) continue;
        this.viewerLOS.target = target;

        if ( this.viewerLOS.simpleVisibilityTest(target) ) continue;

        // Draw each set of points separately.
        this.viewerLOS.viewpoints.forEach(vp => {
          const percentVisible = vp.percentVisible();
          const width = percentVisible >= this.viewerLOS.config.threshold ? 2 : 1;
          vp._drawDebugPoints(this.debugDraw, { width });
        });
      }
    }
  }

  /**
   * Triggered whenever a token is refreshed.
   * @param {Token} token
   * @param {RenderFlags} flags
   */
  onRefreshToken(token, flags) {
    if ( !(this.viewers.some(viewer => viewer === token)
        || this.targets.some(target => target === token)) ) return;
    if ( !(flags.refreshPosition
        || flags.refreshElevation
        || flags.refreshSize ) ) return;
    this.render();
  }
}
