/* globals
canvas,
CONFIG,
Hooks,
PIXI,
ui,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { ENUMS, LOS_HOOKS } from "./const.js"

export class LOSManager {
  static debugViewer;

  static registerHooks() {
    Hooks.on(`${MODULE_ID}.${LOS_HOOKS.DEBUG_LOS}`, value => this.toggleLOSDebugGraphics(value));
    Hooks.on(`${MODULE_ID}.${LOS_HOOKS.ALGORITHM}`, value => this.algorithmChange(value));
    Hooks.on(`${MODULE_ID}.${LOS_HOOKS.WEBGL2_CONTEXT}`, lost => this.onGLContextChanged(lost));
  }

  static _chain = null;

  /** Run async work one at a time, so overlapping setting changes cannot interleave. */
  static _enqueue(fn) {
    return this._chain = (this._chain ?? Promise.resolve()).then(fn).catch(err => console.error(err));
  }

  static async initializeDebugViewer() {
    if ( !this.debugViewer ) return; // Child class must build it.
    await this.debugViewer.initialize();
    return this.debugViewer?.render();
  }

  static async destroyDebugViewer() {
    const viewer = this.debugViewer;
    this.debugViewer = undefined;
    await viewer?.destroy();
  }

  static toggleLOSDebugGraphics(enabled = false) {
    return this._enqueue(() => enabled
      ? this.initializeDebugViewer()
        : this.destroyDebugViewer());
  }

  static algorithmChange(...args) {
    return this._enqueue(() => this._algorithmChange(...args));
  }


  static onGLContextChanged(lost) {
    CONFIG[MODULE_ID].webGL2Unavailable = lost;
    const msg = lost
      ? "WebGL2 context lost; using the geometric line-of-sight calculator until it recovers."
      : "WebGL2 context restored; using the WebGL2 line-of-sight calculator again.";
    ui.notifications[lost ? "warn" : "info"](`${MODULE_ID} | ${msg}`);
    this.algorithmChange();
  }

  /** Override in the module-specific manager. */
  static async _algorithmChange() { }

}
