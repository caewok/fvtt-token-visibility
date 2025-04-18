/* globals
CONFIG,
game,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";
import { RenderObstacles } from "../WebGPU/RenderObstacles.js";
import { Area3dPopoutCanvas } from "../Area3dPopout.js";
import { PercentVisibleCalculatorWebGL2, PercentVisibleCalculatorWebGPU, PercentVisibleCalculatorWebGPUAsync } from "./PercentVisibleCalculator.js";

/* Debug viewer

If a token is controlled and another is targeted, display a popup with the debug view.
Calculates percentage visible for the viewer/target combo.
*/

class DebugVisibilityViewerAbstract {

  /** @type {number} */
  static WIDTH = 400;

  /** @type {number} */
  static HEIGHT = 400;

  /** @type {OffscreenCanvas} */
  static glCanvas;

  /** @type {WebGL2Context} */
  gl;

  /** @type {string} */
  senseType = "sight";

  /** @type {boolean} */
  debugView = true;

  /** @type {RenderObstaclesWebGL2} */
  renderObstacles;

  /** @type {Area3dPopoutCanvas} */
  popout;

  /** @type {Token} */
  viewer;

  /** @type {Token} */
  target;

  static CONTEXT_TYPE = "webgl2";

  constructor({ senseType = "sight", debugView = true } = {}) {
    this.senseType = senseType;
    this.debugView = debugView;
    this.popout = new Area3dPopoutCanvas({ width: this.constructor.WIDTH, height: this.constructor.HEIGHT + 75, resizable: false });
  }

  async initialize() {
    await this.calc.initialize()
    this.registerHooks();
    await this.reinitialize();
  }

  async reinitialize() {
    if ( this.popout._state !== this.popout.constructor.RENDER_STATES.RENDERED ) {
      await this.popout._render(true, { contextType: this.constructor.CONTEXT_TYPE });
      this.gl = this.popout.context;
    }
    this.renderObstacles = this._createRenderer();
    await this.renderObstacles.initialize();
  }

  _createRenderer() {
    return new RenderObstaclesWebGL2({ gl: this.gl, senseType: this.senseType, debugViewNormals: this.debugView });
  }

  render(viewerLocation, target, { viewer, targetLocation } = {}) {
    viewer ??= this.viewer;
    target ??= this.target;
    if ( !(viewer || target) ) return;
    if ( this.popout._state !== this.popout.constructor.RENDER_STATES.RENDERED ) {
      return this.reinitialize().then(() =>
        this.render(viewerLocation, target, { viewer, targetLocation } ));
    }

    viewerLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer);
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });

    const percentVis = this.calc.percentVisible(viewer, target);
    const visibleTextElem = this.popout.element[0].getElementsByTagName("p")[0];
    visibleTextElem.innerHTML = `Percent visible:${Math.round(percentVis * 100)}%`;
    console.debug(`${viewer.name} --> ${target.name} ${Math.round(percentVis * 100)}%`);
  }

  /** @type {number[]} */
  hooks = [];

  static HOOKS = [
    { controlToken: "onControlToken" },
    { targetToken: "onTargetToken" },
    { refreshToken: "onRefreshToken" },
    { createWall: "render" },
    { updateWall: "render" },
    { removeWall: "render" },
    { createTile: "render" },
    { updateTile: "render" },
    { removeTile: "render" },
  ];

  /**
   * Register hooks for this placeable to trigger rerendering.
   */
  registerHooks() {
    if ( this.hooks.length ) return; // Only register once.
    for ( const hookDatum of this.constructor.HOOKS ) {
      const [name, methodName] = Object.entries(hookDatum)[0];
      const id = Hooks.on(name, this[methodName].bind(this));
      this.hooks.push({ name, methodName, id });
    }
  }

  /**
   * Deregister hooks that trigger rerendering.
   */
  deregisterHooks() {
    this.hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this.hooks.length = 0;
  }

  /**
   * Triggered whenever a token is controlled / uncontrolled
   * @param {Token} token
   * @param {boolean} controlled      True if controlled
   */
  onControlToken(token, controlled) {
    if ( !controlled ) return;
    this.viewer = token;
    this.render();
  }

  /**
   * Triggered whenever a token is targeted/untargeted.
   * @param {User} user
   * @param {Token} targetToken
   * @param {boolean} targeted      True if targeted
   */
  onTargetToken(user, targetToken, targeted) {
    if ( !targeted || game.user !== user ) return;
    this.target = targetToken;
  }

  /**
   * Triggered whenever a token is refreshed.
   * @param {Token} token
   * @param {RenderFlags} flags
   */
  onRefreshToken(token, flags) {
    if ( token !== this.viewer && token !== this.target ) return;
    if ( !(flags.refreshPosition
        || flags.refreshElevation
        || flags.refreshSize ) ) return;
    this.render();
  }

  /**
   * Delete this viewer.
   */
  destroy() {
    this.deregisterHooks();
    this.popout.close();
    // this.renderObstacles.destroy();
  }
}

export class DebugVisibilityViewerWebGL2 extends DebugVisibilityViewerAbstract {

  constructor(opts) {
    super(opts);
    this.calc = new PercentVisibleCalculatorWebGL2({ senseType: this.senseType });
  }

  _createRenderer() {
    return new RenderObstaclesWebGL2({ gl: this.gl, senseType: this.senseType, debugViewNormals: this.debugView });
  }
}

export class DebugVisibilityViewerWebGPU extends DebugVisibilityViewerAbstract {
  static CONTEXT_TYPE = "webgpu";

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.calc = new PercentVisibleCalculatorWebGPU({ device, senseType: this.senseType });
  }

  _createRenderer() {
    return new RenderObstacles(this.device, {
      senseType: this.senseType,
      debugViewNormals: this.debugView,
      width: this.constructor.WIDTH,
      height: this.constructor.HEIGHT
    });
  }

  async reinitialize() {
    await super.reinitialize();
    this.renderObstacles.setRenderTextureToCanvas(this.popout.canvas);
  }
}

export class DebugVisibilityViewerWebGPUAsync extends DebugVisibilityViewerAbstract {
  static CONTEXT_TYPE = "webgpu";

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.calc = new PercentVisibleCalculatorWebGPUAsync({ device, senseType: this.senseType });
  }

  _createRenderer() {
    return new RenderObstacles(this.device, {
      senseType: this.senseType,
      debugViewNormals: this.debugView,
      width: this.constructor.WIDTH,
      height: this.constructor.HEIGHT
    });
  }

  async reinitialize() {
    await super.reinitialize();
    this.renderObstacles.setRenderTextureToCanvas(this.popout.canvas);
  }

  render(viewerLocation, target, { viewer, targetLocation } = {}) {
    viewer ??= this.viewer;
    target ??= this.target;
    if ( !(viewer || target) ) return;
    if ( this.popout._state !== this.popout.constructor.RENDER_STATES.RENDERED ) {
      return this.reinitialize().then(() =>
        this.render(viewerLocation, target, { viewer, targetLocation } ));
    }

    viewerLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer);
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });

    const visibleTextElem = this.popout.element[0].getElementsByTagName("p")[0];
    const callback = (percentVis, viewer, target) => {
      visibleTextElem.innerHTML = `Percent visible:${Math.round(percentVis * 100)}%`;
      console.debug(`${viewer.name} --> ${target.name} ${Math.round(percentVis * 100)}%`);
    }
    const percentVis = this.calc.percentVisible(viewer, target, { callback });
  }
}

