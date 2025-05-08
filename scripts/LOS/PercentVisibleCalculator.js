/* globals
CONFIG,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/* Percent visible calculator

Calculate percent visibility for a token viewer looking at a target token.

*/

export class PercentVisibleCalculatorAbstract {

  getVisibleTargetShape(target) {
    return this.config.useLitTargetShape ? target.litTokenBorder : target.constrainedTokenBorder;
  }

  static defaultConfiguration = {
    blocking: {
      walls: true,
      tiles: true,
      tokens: {
        dead: true,
        live: true,
        prone: true,
      }
    },
    useLitTargetShape: false,
    senseType: "sight",
    debug: false,
  };

  /**
   * The configuration object, if provided, will be kept and can be updated externally.
   * For example, it can be dynamically updated based on settings and shared among multiple
   * calculators.
   */
  constructor(cfg = {}) {
    // First merge in the default configuration, overriding where appropriate.
    const tmp = foundry.utils.mergeObject(this.constructor.defaultConfiguration, cfg, { inplace: false })
    this._config = cfg; // Link the configuration object.
    this.config = tmp; // Update in place with the merged configuration file.
  }

  _config = {};

  get config() { return this._config; }

  set config(cfg = {}) {
    // Copy the config in place so the linked configuration object is not broken.
    foundry.utils.mergeObject(this._config, cfg, { inplace: true})
  }

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
    if ( !this.getVisibleTargetShape(target) ) return 0;

    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation);
    return this._percentRedPixels(viewer, target, viewerLocation, targetLocation);
  }

  async percentVisibleAsync(viewer, target, { viewerLocation, targetLocation, ..._opts } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation);
    return this._percentRedPixelsAsync(viewer, target, viewerLocation, targetLocation);
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
  _percentRedPixels(_viewer, _target, _viewerLocation, _targetLocation) { console.error("PercentVisibleCalculator|Must be overriden by child class.") }

  async _percentRedPixelsAsync(viewer, target, viewerLocation, targetLocation) { return this._percentRedPixels(viewer, target, viewerLocation, targetLocation); }

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
