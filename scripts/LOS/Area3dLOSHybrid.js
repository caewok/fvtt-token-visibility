/* globals
*/
"use strict";

import { Area3dLOSGeometric } from "./Area3dLOSGeometric.js";
import { Area3dLOSWebGL2 } from "./Area3dLOSWebGL2.js";
import { addClassGetter, addClassMethod } from "../geometry/util.js";

// Containers, Sprites, RenderTexture.baseTexture have a destroyed property.
// Geometry is probably destroyed if it has a null index buffer.

/**
 * Uses Area3dLOSGeometric unless a tile is encountered, at which point it switches to
 * Area3dLOSWebGL2.
 * To avoid recalculating things, this class copies over code from both and modifies
 * the `percentVisible` method.
 */
export class Area3dLOSHybrid extends Area3dLOSGeometric {

  /**
   * The main class inherits from Geometric. This stored WebGL2 object handles tiles.
   * @type {Area3dLOSWebGL2}
   */
  #webGL2Class;

  constructor(viewer, target, config) {
    super(viewer, target, config);
    this.#webGL2Class = new Area3dLOSWebGL2(viewer, target, config);

    // Link getters to avoid repeated calculations.
    addClassGetter(this.#webGL2Class, "visibleTargetShape", this.#getVisibleTargetShape.bind(this));
    addClassGetter(this.#webGL2Class, "visionPolygon", this.#getVisionPolygon.bind(this));
    addClassGetter(this.#webGL2Class, "blockingObjects", this.#getBlockingObjects.bind(this));

    // Link getters and methods to share the popout.
    addClassGetter(this.#webGL2Class, "popout", this.#getPopout.bind(this));
    addClassGetter(this.#webGL2Class, "popoutIsRendered", this.#getPopoutIsRendered.bind(this));
    addClassMethod(this.#webGL2Class, "_addChildToPopout", this._addChildToPopout.bind(this));
    addClassMethod(this.#webGL2Class, "_clear3dDebug", this._clear3dDebug.bind(this));
  }

  #getVisibleTargetShape() { return this.visibleTargetShape; }

  #getVisionPolygon() { return this.visionPolygon; }

  #getBlockingObjects() { return this.blockingObjects; }

  #getPopout() { return this.popout; }

  #getPopoutIsRendered() { return this.popoutIsRendered; }

  get webGL2() { return this.#webGL2Class; } // For debugging.

  updateConfiguration(config = {}) {
    super.updateConfiguration(config);
    this.#webGL2Class.updateConfiguration(config);
  }

  _clearCache() {
    super._clearCache();
    this.#webGL2Class._clearCache();
  }

  destroy() {
    this.#webGL2Class.destroy();
    super.destroy();
  }

  // Link setters so values between the two classes remain the same.
  // See https://stackoverflow.com/questions/34456194/is-it-possible-to-call-a-super-setter-in-es6-inherited-classes

  get viewer() { return super.viewer; }

  set viewer(value) {
    super.viewer = value;
    this.#webGL2Class.viewer = value;
  }

  set visionOffset(value) {
    super.visionOffset = value;
    this.#webGL2Class.visionOffset = value;
  }

  get target() { return super.target; }

  set target(value) {
    super.target = value;
    this.#webGL2Class.target = value;
  }

  /**
   * Determine percentage area by estimating the blocking shapes geometrically.
   * @returns {number}
   */
  _percentVisible() {
    // Super and percentVisibleWebGL both run the basic visibility test.
    if ( this.blockingObjects.tiles.size ) return this.#webGL2Class._percentVisible();
    return super._percentVisible();
  }

  // ----- NOTE: Debugging methods ----- //

  /**
   * For debugging
   * Switch drawing depending on the algorithm used.
   */
  _draw3dDebug() {
    if ( this.blockingObjects.tiles.size ) this.#webGL2Class._draw3dDebug();
    else super._draw3dDebug();
  }
}
