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

  getVisibleTargetShape(target) {
    return this.config.useLitTargetShape ? target.litTokenBorder : target.constrainedTokenBorder;
  }

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
    if ( !this.getVisibleTargetShape(target) ) return 0; // Target is not lit.

    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation);
    return this._percentUnobscured(viewer, target, viewerLocation, targetLocation);
  }

  async percentVisibleAsync(viewer, target, { viewerLocation, targetLocation, ..._opts } = {}) {
    if ( !this.getVisibleTargetShape(target) ) return 0; // Target is not lit.

    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    await this._calculatePercentVisibleAsync(viewer, target, viewerLocation, targetLocation);
    return this._percentUnobscuredAsync(viewer, target, viewerLocation, targetLocation);
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

  async _calculatePercentVisibleAsync(viewer, target, viewerLocation, targetLocation) {
    return this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation);
  }

  /**
   * Determine the percent unobscured view.
   * @returns {number}
   * @override
   */
  _percentUnobscured(_viewer, _target, _viewerLocation, _targetLocation) { return 0; }

  async _percentUnobscuredAsync(viewer, target, viewerLocation, targetLocation) {
    return this._percentUnobscured(viewer, target, viewerLocation, targetLocation);
  }

  destroy() { return; }
}

/**
 * Handles classes that use RenderObstacles to draw a 3d view of the scene from the viewer perspective.
 */
export class PercentVisibleRenderCalculatorAbstract extends PercentVisibleCalculatorAbstract {
  /**
   * Determine the percent unobscured view.
   * @returns {number}
   * @override
   */
  _percentUnobscured(viewer, target, viewerLocation, targetLocation) {
    // Calculate the denominator for percent seen: the target area without obstacles.
    // - Large target: 100% viewable if area equal to one grid square is viewable.
    // - Lit target: Unlit portions of the target are treated as obscured.
    let totalArea;
    if ( this.config.useLitTargetShape
      && target.litTokenBorder
      && !target.litTokenBorder.equals(target.constrainedTokenBorder) ) totalArea = this._constrainedTargetArea(viewer, target, viewerLocation, targetLocation);
    else totalArea = this._totalTargetArea(viewer, target, viewerLocation, targetLocation);
    if ( this.config.largeTarget ) totalArea = Math.min(totalArea, this._gridShapeArea(viewer, target, viewerLocation, targetLocation))
    if ( !totalArea ) {
      console.error(`${this.constructor.name}|_percentUnobscured total area should not be 0.`);
      return 0;
    }
    const viewableArea = this._viewableTargetArea(viewer, target, viewerLocation, targetLocation);
    const percentSeen = viewableArea / totalArea;

    // Round the percent seen so that near-zero areas are 0.
    // Because of trimming walls near the vision triangle, a small amount of token area can poke through
    if ( percentSeen.almostEqual(0, 1e-02) ) return 0;
    return Math.clamp(percentSeen, 0, 1);
  }

  /**
   * Grid shape area centered on the target as seen from the viewer location.
   * Used to determine the minimum area needed (denominator) for the largeTarget option.
   * Called after _calculatePercentVisible.
   * @returns {number}
   */
  _gridShapeArea(_viewer, _target, _viewerLocation, _targetLocation) { return 0; }

  async _gridShapeAreaAsync(viewer, target, viewerLocation, targetLocation) {
    return this._gridShapeArea(viewer, target, viewerLocation, targetLocation);
  }

  /**
   * Constrained target area, counting both lit and unlit portions of the target.
   * Used to determine the total area (denominator) when useLitTarget config is set.
   * Called after _calculatePercentVisible.
   * @returns {number}
   */
  _constrainedTargetArea(_viewer, _target, _viewerLocation, _targetLocation) { return 0; }

  async _constrainedTargetAreaAsync(viewer, target, viewerLocation, targetLocation) {
    return this._constrainedTargetArea(viewer, target, viewerLocation, targetLocation);
  }

  /**
   * How much of the target area is viewable, considering obstacles.
   * Called after _calculatePercentVisible.
   * @returns {number}
   */
  _viewableTargetArea(_viewer, _target, _viewerLocation, _targetLocation) { return 0; }

  async _viewableTargetAreaAsync(viewer, target, viewerLocation, targetLocation) {
    return this._viewableTargetArea(viewer, target, viewerLocation, targetLocation);
  }

  /**
   * The target area as seen from the viewer location, ignoring all obstacles.
   * Called after _calculatePercentVisible.
   * @param {Token} target    For convenience, the target token
   * @returns {number}
   */
  _totalTargetArea(_viewer, _target, _viewerLocation, _targetLocation) { return 0; }

  async _totalTargetAreaAsync(viewer, target, viewerLocation, targetLocation) {
    return this._totalTargetArea(viewer, target, viewerLocation, targetLocation);
  }
}
