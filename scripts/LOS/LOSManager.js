/* globals
canvas,
CONFIG,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { ENUMS } from "./const.js"

export class LOSManager {
  static debugViewer;

  static registerHooks() {
    Hooks.on(`${MODULE_ID}.webGL2ContextChanged`, lost => this.onGLContextChanged(lost));
  }

  static initializeDebugViewer() {
    this.debugViewer?.render();
  }

  static destroyDebugViewer() {
    this.debugViewer?.destroy();
    this.debugViewer = undefined;
  }

  static toggleLOSDebugGraphics(enabled = false) {
    if ( enabled ) this.initializeDebugViewer();
    else this.destroyDebugViewer();
  }


  // Should be defined by child class to handle settings.
  static algorithm() { return ENUMS.ALGORITHM_TYPES.WEBGL2; }

  static onGLContextChanged(lost) {
    CONFIG[MODULE_ID].webGL2Unavailable = lost;
    const msg = lost
      ? "WebGL2 context lost; using the geometric line-of-sight calculator until it recovers."
      : "WebGL2 context restored; using the WebGL2 line-of-sight calculator again.";
    ui.notifications[lost ? "warn" : "info"](`${MODULE_ID} | ${msg}`);
    this.algorithmChange();
  }

  static algorithmChange() { }
}
