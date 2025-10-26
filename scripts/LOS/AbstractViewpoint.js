/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// LOS folder
import { Frustum } from "./Frustum.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";

// Geometry
import { Draw } from "../geometry/Draw.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 */
export class AbstractViewpoint {
  static calcClass;

  /** @type {ViewerLOS} */
  viewerLOS;

  /** @type {Point3d} */
  viewpointDiff;

  /**
   * @param {ViewerLOS} viewerLOS      The viewer that controls this "eye"; handles most of the config
   * @param {Point3d} viewpoint        The location of the eye; this will be translated to be relative to the viewer
   */
  constructor(viewerLOS, viewpoint) {
    if ( viewerLOS.calculator && !(viewerLOS.calculator instanceof this.constructor.calcClass) ) {
      console.error(`{this.constructor.name}|Calculator must be ${this.constructor.calcClass.name}.`, this.viewerLOS.calculator);
    }
    this.viewerLOS = viewerLOS;
    this.viewpointDiff = viewpoint.subtract(viewerLOS.center);
  }

  /** @type {Point3d} */
  get viewpoint() { return this.viewerLOS.center.add(this.viewpointDiff); }

  /** @type {Point3d} */
  get targetLocation() { return this.viewerLOS.targetLocation; }

  /** @type {Token} */
  get viewer() { return this.viewerLOS.viewer};

  /** @type {Token} */
  get target() { return this.viewerLOS.target; }

  /** @type {WALL_RESTRICTION_TYPES} */
  get senseType() { return this.viewerLOS.config.senseType; }

  // set senseType(value) { this.calculator.senseType = senseType; }

  /** @type {PercentVisibileCalculatorAbstract} */
  get calculator() { return this.viewerLOS.calculator; }

  get config() { return this.viewerLOS.calculator.config; }

  get debug() { return this.viewerLOS.debug; }

  set debug(value) { this.viewerLOS.debug = value; }


  // ----- NOTE: Visibility Percentages ----- //
  _percentVisible;

  lastResult;

  get percentVisible() {
    if ( typeof this._percentVisible === "undefined" ) this._percentVisible = this.lastResult.percentVisible;
    return this._percentVisible;
  }

  calculate() {
    this._percentVisible = undefined;
    if ( this.passesSimpleVisibilityTest() ) {
      this._percentVisible = 1;
      return;
    }
    this.calculator.calculate(this);
    this.lastResult = this.calculator.lastResult.clone();
    if ( this.debug ) this._drawCanvasDebug(this.viewerLOS.debugDrawForViewpoint(this));
  }

  targetOverlapsViewpoint() {
    const bounds = this.calculator.targetShape;
    if ( !bounds.contains(this.viewpoint.x, this.viewpoint.y) ) return false;
    return this.viewpoint.between(this.target.bottomZ, this.target.topZ);
  }

  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} target
   * @returns {0|1|undefined} 1.0 for visible; Undefined if obstacles present or target intersects the vision rays.
   */
  passesSimpleVisibilityTest() {
    const target = this.target;

    // Treat the scene background as fully blocking, so basement tokens don't pop-up unexpectedly.
    const backgroundElevation = canvas.scene.flags?.levels?.backgroundElevation || 0;
    if ( (this.viewpoint.z > backgroundElevation && target.topZ < backgroundElevation)
      || (this.viewpoint.z < backgroundElevation && target.bottomZ > backgroundElevation) ) return true;
    return this.targetOverlapsViewpoint();
  }

  /**
   * Clean up memory-intensive objects.
   */
  destroy() {}

  /* ----- NOTE: Debug ----- */

  /**
   * For debugging.
   * Draw various debug guides on the canvas.
   * @param {Draw} draw
   */
  _drawCanvasDebug(debugDraw) {
    this._drawLineOfSight(debugDraw);
    this.calculator.occlusionTester._drawDetectedObjects(debugDraw);
    this.calculator.occlusionTester._drawFrustum(debugDraw);
  }

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight(draw) {
    draw.segment({ A: this.viewpoint, B: this.targetLocation });
  }




}
