/* globals
canvas,
CONFIG,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TRACKER_IDS, ENUMS } from "./const.js";
import { Settings } from "./settings.js";
import { buildDebugViewer, currentDebugViewerClass, buildLOSCalculator } from "./LOSCalculator.js";
import { LightStatusTracker } from "./LightStatusTracker.js";
import { LOSManager } from "./LOS/LOSManager.js";

export class ATVLOSManager extends LOSManager {
  static debugViewer;

  static registerHooks() {
    super.registerHooks();
    Hooks.on(`${MODULE_ID}.losDebugRangeChanged`, value => this.toggleRangeDebugGraphics(value));
    Hooks.on(`${MODULE_ID}.lightMonitorChanged`, value => this.updateLightMonitor(value));
  }

  static async initializeDebugViewer() {
    this.debugViewer ??= buildDebugViewer(currentDebugViewerClass());
    return super.initializeDebugViewer();
  }

  static onGLContextChanged(lost) {
    CONFIG[MODULE_ID].webGL2Unavailable = lost;
    const { ALGORITHM, TYPES } = Settings.KEYS.LOS.TARGET;
    if ( Settings.get(ALGORITHM) !== TYPES.WEBGL2 ) return;
    super.onGLContextChanged(lost);
  }

  static async _algorithmChange() {
    CONFIG[MODULE_ID].losCalculator?.destroy();
    const calc = CONFIG[MODULE_ID].losCalculator = buildLOSCalculator(); // Already calls initialize().
    for ( const token of canvas.tokens?.placeables ?? [] ) {
      const losViewer = token[MODULE_ID]?.[TRACKER_IDS.VISIBILITY]?.losViewer;
      if ( losViewer ) losViewer.calculator = calc;
    }
    if ( !Settings.get(Settings.KEYS.DEBUG.LOS) ) return;
    const type = Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM);
    if ( this.debugViewer?.constructor === currentDebugViewerClass(type) ) return this.debugViewer.render();
    await this.destroyDebugViewer();
    await this.initializeDebugViewer();
  }

  /** @type {PIXI.Graphics} */
  static #DEBUG_RANGE;

  static get DEBUG_RANGE() { return canvas.tokens?.children?.find(c => c[`${MODULE_ID}_rangeDebug`]); }

  static initializeDebugGraphics() {
    this.#DEBUG_RANGE = new PIXI.Graphics();
    this.#DEBUG_RANGE.eventMode = "passive";

    this.#DEBUG_RANGE[`${MODULE_ID}_rangeDebug`] = true;
    canvas.tokens.addChild(this.#DEBUG_RANGE);
  }

  // Don't need to destroy b/c they are destroyed as part of canvas.tokens.
  //   static destroyDebugGraphics() {
  //     if ( !this.#DEBUG_LOS.destroyed() ) this.#DEBUG_LOS.destroy();
  //     if ( !this.#DEBUG_RANGE.destroyed() ) this.#DEBUG_RANGE.destroy();
  //   }

  static toggleRangeDebugGraphics(_enabled) {
    this.DEBUG_RANGE.clear();
  }

  /** @type {LightStatusTracker} */
  static lightMonitor;

  static updateLightMonitor(value) {
    const TYPES = ENUMS.LIGHT_ALGORITHM_TYPES;
    switch ( value ) {
      case TYPES.NONE:
        if ( !this.lightMonitor ) break;
        this.lightMonitor.destroy();
        this.lightMonitor = undefined;
        break;
      case TYPES.TOKENS:
        this.lightMonitor ??= new LightStatusTracker();
        this.lightMonitor.stopLocalIconMonitor();
        this.lightMonitor.startLightMonitor();
        break;
      case TYPES.VIEWPOINT:
        this.lightMonitor ??= new LightStatusTracker();
        this.lightMonitor.stopLightMonitor();
        this.lightMonitor.startLocalIconMonitor();
        break;
    }
  }

}
