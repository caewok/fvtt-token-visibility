/* globals
Application,
game,
Hooks
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder.
import { MODULE_ID } from "../const.js";

// Viewpoint algorithms.
import { Area3dGeometricViewpoint } from "./Area3dGeometricViewpoint.js";
import { Area3dWebGL1Viewpoint } from "./Area3dWebGL1Viewpoint.js";
import { Area3dWebGL2Viewpoint } from "./Area3dWebGL2Viewpoint.js";
import { Area3dHybridViewpoint } from "./Area3dHybridViewpoint.js";
import { AbstractViewerLOS } from "./AbstractViewerLOS.js";
import { WebGL2Viewpoint } from "./WebGL2/WebGL2Viewpoint.js";
import { WebGPUViewpoint, WebGPUViewpointAsync } from "./WebGPU/WebGPUViewpoint.js";

// Debug
import { Area3dPopout } from "./Area3dPopout.js";

/**
 * Add 3d debugging for this viewer.
 */
export class Area3dViewerLOS extends AbstractViewerLOS {

  is3d = true;

  /** @type {enum<class>} */
  static VIEWPOINT_CLASSES = {
    "los-area-3d": Area3dGeometricViewpoint,
    "los-area-3d-geometric": Area3dGeometricViewpoint,
    "los-area-3d-webgl1": Area3dWebGL1Viewpoint,
    "los-area-3d-webgl2": Area3dWebGL2Viewpoint,
    "los-area-3d-hybrid": Area3dHybridViewpoint,
    "los-webgl2": WebGL2Viewpoint,
    "los-webgpu": WebGPUViewpoint,
    "los-webgpu-async": WebGPUViewpointAsync,
  };

  /**
   * Determine percentage of the token visible using the class methodology.
   * @returns {number}
   */
  _percentVisible(target) {
    if ( this.config.debug ) this._clear3dDebug();
    const percent = super._percentVisible(target);
    if ( this.config.debug && this.viewer.controlled && game.user.targets.has(target) ) this._draw3dDebug();
    return percent;
  }

  async _percentVisibleAsync(target) {
    if ( this.config.debug ) this._clear3dDebug();
    const percent = await super._percentVisibleAsync(target);
    if ( this.config.debug && this.viewer.controlled && game.user.targets.has(target) ) this._draw3dDebug();
    return percent;
  }

  /** @type {Map<string, number>} */
  #hookIds = new Map();

  /**
   * Add hook so that if this token is controlled, the debug window pops up.
   */
  _initializeDebugHooks() {
    this.#hookIds.set("renderArea3dPopout", Hooks.on("renderArea3dPopout", this._renderArea3dPopoutHook.bind(this)));
    this.#hookIds.set("closeArea3dPopout", Hooks.on("closeArea3dPopout", this._closeArea3dPopoutHook.bind(this)));
    this.#hookIds.set("updateWall", Hooks.on("updateWallHook", this._updateWallHook.bind(this)));
  }

  /** @type {string} */
  get popoutTitle() {
    const moduleName = game.i18n.localize(`${MODULE_ID}.nameAbbr`);
    return `${moduleName} 3D Debug: ⏿ ${this.viewer?.name ?? ""} → ◎ ${this.target?.name ?? "?"}`;
  }

  /** @type {Area3dPopout} */
  #popout;

  // TODO: Use grid to separate views of different viewpoints.
  get popout() {
    return this.#popout || (this.#popout = new Area3dPopout({ title: this.popoutTitle }));
  }

  /** @type {boolean} */
  get popoutIsRendered() { return this.#popout && this.#popout.rendered; }

  /**
   * Refresh the popout title to the current viewer/target.
   */
  #updatePopoutTitle() {
    if ( !this.popoutIsRendered ) return;
    const popout = this.popout;
    const title = this.popoutTitle;
    const elem = popout.element.find(".window-title");
    elem[0].textContent = title;
    popout.options.title = title; // Just for consistency.
  }

  /**
   * Draw the 3d debug.
   */
  updateDebug() {
    super.updateDebug();

    // Only draw in the popout for the targeted token(s).
    // Otherwise, it is really unclear to what the debug is referring.
    if ( !game.user.targets.has(this.target) ) return;
    this._draw3dDebug();
  }

  /**
   * Clear the 3d debug.
   */
  clearDebug() {
    super.clearDebug();
    this._clear3dDebug();
  }

  /**
   * For debugging.
   * Draw debugging objects (typically, 3d view of the target) in a pop-up window.
   * Must be extended by subclasses. This version pops up a blank window.
   */
  _draw3dDebug() {
    console.log("Area3dViewerLOS|_draw3dDebug")
    this.#updatePopoutTitle();
    this.openDebugPopout(); // Go last so prior can be skipped if popout not active.
  }

  /**
   * For debugging.
   * Clear existing debug.
   * Must be extended by subclasses.
   */
  _clear3dDebug() {
    if ( !this.popoutIsRendered ) return;
    console.log("Area3dViewerLOS|_clear3dDebug")
    this.viewpoints.forEach(vp => vp._clear3dDebug());
  }

  /**
   * Add a PIXI container object to the popout, causing it to render in the popout.
   * Will force the popout to render if necessary, and is async for that purpose.
   * @param {PIXI.Container} container
   */
  _addChildToPopout(container) {
    if ( !this.popoutIsRendered ) return;
    this.#popout.pixiApp.stage.addChild(container);
  }

  /**
   * Open the debug popout window, rendering if necessary.
   */
  async openDebugPopout() {
    if ( this.popout._state < 2 ) await this.popout._render(true);
    this.viewpoints.forEach(vp => vp.openDebugPopout());
  }

  /**
   * For debugging.
   * Close the popout window.
   */
  async closeDebugPopout() {
    const popout = this.#popout; // Don't trigger creating new popout app on close.
    if ( !popout || popout._state < Application.RENDER_STATES.RENDERING ) return;
    this._clear3dDebug();
    this.#popout.pixiApp.stage.removeChildren();
    return popout.close(); // Async
  }

  destroy() {
    this.closeDebugPopout();
    this.#hookIds.forEach((id, fnName) => Hooks.off(fnName, id));
    this.#hookIds.clear();
    super.destroy();
  }
}