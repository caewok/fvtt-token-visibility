/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder

// LOS folder
import { GeometricViewpoint } from "./GeometricViewpoint.js";
import { PIXIViewpoint } from "./PIXIViewpoint.js";

// Geometry folder
import { addClassGetter } from "../geometry/util.js";


// Debug


export class Area3dHybridViewpoint extends GeometricViewpoint {

  /**
   * The main class inherits from Geometric. This stored WebGL2 object handles tiles.
   * @type {Area3dLOSWebGL2}
   */
  #webGL2Class;

  /**
   * @param {ViewerLOS} viewerLOS      The viewer that controls this "eye"
   * @param {Point3d} viewpointDiff     The location of the eye relative to the viewer
   */
  constructor(viewerLOS, viewpoint) {
    super(viewerLOS, viewpoint);
    this.#webGL2Class = new PIXIViewpoint(viewerLOS, viewpoint);

    // Link getters to avoid repeated calculations.
    addClassGetter(this.#webGL2Class, "visionPolygon", this.#getVisionPolygon.bind(this));
    addClassGetter(this.#webGL2Class, "blockingObjects", this.#getBlockingObjects.bind(this));
  }

  #getVisionPolygon() { return this.visionPolygon; }

  #getBlockingObjects() { return this.blockingObjects; }

  get webGL2() { return this.#webGL2Class; } // For debugging.

  clearCache() {
    super.clearCache();
    this.#webGL2Class.clearCache();
  }

  destroy() {
    super.destroy();
    this.#webGL2Class.destroy();
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
  _draw3dDebug(drawTool, renderer) {
    if ( this.blockingObjects.tiles.size ) this.#webGL2Class._draw3dDebug(drawTool, renderer);
    else super._draw3dDebug(drawTool, renderer);
  }
}