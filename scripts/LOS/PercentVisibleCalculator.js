/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/* Percent visible calculator

Track percent visibility for tokens.
Caches values based on the viewer, viewer location, target, target location.
- Cache is tied to the placeable updates.
*/


export class PercentVisibleCalculatorAbstract {

  /** @type {number} */
  static TERRAIN_THRESHOLD = 255 * 0.75;

  /** @type {string} */
  senseType = "sight";

  constructor({ senseType = "sight", blocking = {} } = {}) {
    this.senseType = senseType;
    foundry.utils.mergeObject(this.config, { blocking });
  }

  config = {
    blocking: {
      walls: true,
      tiles: true,
      tokens: {
        dead: true,
        live: true,
        prone: true,
      }
    }
  };

  async initialize() { return; }

  // ----- NOTE: Visibility testing ----- //

  /**
   * Determine percent visible based on 3d view or return cached value.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {object} [opts]
   * @param {Point3d} [opts.viewerLocation]   Where the camera is located
   * @param {Point3d} [opts.targetLocation]   Where the camera is looking to in 3d space
   * @returns {number}
   */
  percentVisible(viewer, target, { viewerLocation, targetLocation, ..._opts } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
    return this._percentRedPixels();
  }

  async percentVisibleAsync(viewer, target, { viewerLocation, targetLocation, ..._opts } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
    return this._percentRedPixelsAsync();
  }

  /**
   * Do any preparatory calculations for determining the percent visible.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @override
   */
  _calculatePercentVisible(_viewer, _target, _viewerLocation, _targetLocation) { return; }

  /**
   * Determine the percentage red pixels for the current view.
   * @returns {number}
   * @override
   */
  _percentRedPixels() { console.error("PercentVisibleCalculator|Must be overriden by child class.") }

  async _percentRedPixelsAsync() { return this._percentRedPixels(); }

  destroy() { return; }

}

/**
 * Handles classes that use RenderObstacles to draw a 3d view of the scene from the viewer perspective.
 */
export class PercentVisibleRenderCalculatorAbstract extends PercentVisibleCalculatorAbstract {
  /** @type {number} */
  static WIDTH = 128;

  /** @type {number} */
  static HEIGHT = 128;

  /** @type {RenderObstaclesWebGL2|RenderObstacles} */
  renderObstacles;

  async initialize() {
    await this.renderObstacles.initialize();
  }

  percentVisible(...args) {
    this.renderObstacles.prerender();
    return super.percentVisible(...args);
  }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
  }

  destroy() {
    if ( this.renderObstacles ) this.renderObstacles.destroy();
  }
}
