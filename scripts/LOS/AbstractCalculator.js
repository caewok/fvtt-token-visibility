/* globals
*/
"use strict";

import { PointsLOS } from "./PointsLOS.js";
import { Area2dLOS } from "./Area2dLOS.js";
import { Area3dLOSGeometric } from "./Area3dLOSGeometric.js";
import { Area3dLOSWebGL } from "./Area3dLOSWebGL1.js";
import { Area3dLOSWebGL2 } from "./Area3dLOSWebGL2.js";
import { Area3dLOSHybrid } from "./Area3dLOSHybrid.js";


/**
 * @typedef Viewer    Token|MeasuredTemplate|AmbientLight|AmbientSound|Point3d
 * The object that is viewing / attacking.
 */

/**
 * Class that handles calculating line-of-sight between two tokens, or an object and a token, based on current settings.
 * Abstract version does not have anything LOS-specific beyond what can be used by
 * CoverCalculator in Alt. Token Cover.
 */
export class AbstractCalculator {

  /** @enum {AlternativeLOS} */
  static ALGORITHM_CLASS = {
    "los-points": PointsLOS,
    "los-area-2d": Area2dLOS,
    "los-area-3d": Area3dLOSHybrid,
    "los-area-3d-geometric": Area3dLOSGeometric,
    "los-area-3d-webgl1": Area3dLOSWebGL,
    "los-area-3d-webgl2": Area3dLOSWebGL2,
    "los-area-3d-hybrid": Area3dLOSHybrid
  };

  /** @enum {string} */
  static ALGORITHM_CLASS_NAME = {
    "los-points": "PointsLOS",
    "los-area-2d": "Area2dLOS",
    "los-area-3d": "Area3dLOSHybrid",
    "los-area-3d-geometric": "Area3dLOSGeometric",
    "los-area-3d-webgl1": "Area3dLOSWebGL",
    "los-area-3d-webgl2": "Area3dLOSWebGL2",
    "los-area-3d-hybrid": "Area3dLOSHybrid"
  };

  /** @type {AlternativeLOS} */
  calc;

  /**
   * @param {Viewer} viewer        The token or other object that is viewing / attacking
   * @param {Token} target        The token that is being seen / defending
   * @param {object} opts         Options that affect the calculation
   * @param {string} [opts.algorithm]     LOS algorithm to use
   * @param {AlternativeLOSConfig} [opts.config]  Options passed to the LOS calculator configuration
   */
  constructor(viewer, target, { algorithm, ...config } = {} ) {
    const cfg = this.constructor.initialConfiguration(config);
    const cl = this.constructor.ALGORITHM_CLASS[algorithm] ?? PointsLOS;
    this.calc = new cl(viewer, target, cfg);
  }

  static initialConfiguration(cfg = {}) {
    cfg.type ??= "sight";
    cfg.wallsBlock ??= true;
    cfg.tilesBlock ??= true;
    return cfg;
  }

  /** @type {Viewer} */
  get viewer() { return this.calc.viewer; }

  set viewer(value) { this.calc.viewer = value; }

  /** @type {Token} */
  get target() { return this.calc.target; }

  set target(value) { this.calc.target = value; }

  destroy() { return this.calc.destroy(); }

  debug() { return this.calc.updateDebug(); }

  clearDebug() { return this.calc.clearDebug(); }

  async closeDebugPopout() {
    if ( !this.calc.closeDebugPopout ) return;
    return this.calc.closeDebugPopout();
  }

  async openDebugPopout() {
    if ( !this.calc.openDebugPopout ) return;
    return this.calc.openDebugPopout();
  }

  /**
   * Update the calculator algorithm.
   */
  _updateAlgorithm(algorithm) {
    const clName = this.calc.constructor.name;
    if ( clName === this.constructor.ALGORITHM_CLASS_NAME[algorithm] ) return;
    const config = { ...this.calc.config };
    const cl = this.constructor.ALGORITHM_CLASS[algorithm];
    if ( !cl ) return;
    this.calc.destroy();
    this.calc = new cl(this.viewer, this.target, config);
  }

  /**
   * Pass-through to update the calculator configuration.
   */
  updateConfiguration(config = {}) { this.calc.updateConfiguration(config); }

  /**
   * Reset the calculator settings to the current settings.
   * (Used in Settings after settings have changed.)
   * @param {object} config       Initial configurations to pass to `initialConfiguration`
   */
  _resetConfiguration(config = {}) {
    this.calc._initializeConfiguration(this.constructor.initialConfiguration(config));
    this.calc._clearCache();
  }
}
