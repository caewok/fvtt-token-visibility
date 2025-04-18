/* globals
canvas,
CONFIG,
game,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";
import { RenderObstacles } from "../WebGPU/RenderObstacles.js";
import { Area3dPopoutCanvas } from "../Area3dPopout.js";
import { PercentVisibleCalculatorWebGL2, PercentVisibleCalculatorWebGPU, PercentVisibleCalculatorWebGPUAsync } from "./PercentVisibleCalculator.js";
import { buildCustomLOSCalculator } from "../../LOSCalculator.js";
import { Settings } from "../../settings.js";
import { PointsViewpoint } from "../PointsViewpoint.js";

/* Debug viewer

If a token is controlled and another is targeted, display a popup with the debug view.
Calculates percentage visible for the viewer/target combo.
*/

class DebugVisibilityViewerAbstract {

  /** @type {number} */
  static WIDTH = 400;

  /** @type {number} */
  static HEIGHT = 400;

  /** @type {class} */
  static popoutClass = Area3dPopoutCanvas;

  /** @type {WebGL2Context} */
  gl;

  /** @type {string} */
  senseType = "sight";

  /** @type {RenderObstaclesWebGL2} */
  renderObstacles;

  /** @type {Area3dPopoutCanvas} */
  popout;

  /** @type {Token} */
  viewer;

  /** @type {Token} */
  target;

  static CONTEXT_TYPE = "webgl2";

  constructor({ senseType = "sight" } = {}) {
    this.senseType = senseType;
    if ( this.constructor.popoutClass ) this.popout = new this.constructor.popoutClass({ width: this.constructor.WIDTH, height: this.constructor.HEIGHT + 75, resizable: false });
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
  onControlToken(token, _controlled) {
    // if ( !controlled ) return;
    this.viewer = token;
    this.render();
  }

  /**
   * Triggered whenever a token is targeted/untargeted.
   * @param {User} user
   * @param {Token} targetToken
   * @param {boolean} targeted      True if targeted
   */
  onTargetToken(user, targetToken, _targeted) {
    if ( game.user !== user ) return;
    this.target = targetToken;
    this.render();
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

  /** @type {boolean} */
  debugView = true;

  constructor(opts) {
    super(opts);
    this.debugView = opts.debugView ?? true;
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
    this.debugView = opts.debugView ?? true;
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

export class DebugVisibilityViewerPoints extends DebugVisibilityViewerAbstract {
  /** @type {class} */
  // static popoutClass = Area3dPopout; // PIXI version

  /** @type {PIXI.Graphics} */
  #debugGraphics;

  get debugGraphics() {
    if ( !this.#debugGraphics || this.#debugGraphics.destroyed ) this.#debugGraphics = this._initializeDebugGraphics();
    return this.#debugGraphics;
  }

  /** @type {Draw} */
  #debugDraw;

  get debugDraw() {
    const Draw = CONFIG.GeometryLib.Draw;
    if ( !this.#debugDraw
      || !this.#debugGraphics
      || this.#debugGraphics.destroyed ) this.#debugDraw = new Draw(this.debugGraphics);
    return this.#debugDraw || (this.#debugDraw = new Draw(this.debugGraphics));
  }

  /** @type {Token[]} */
  get viewers() { return canvas.tokens.controlled; }

  /** @type {Token[]} */
  get targets() { return game.user.targets.values(); }

  /** @type {object} */
  config = {
    useLitTargetShape: false,
  };

  constructor(opts) {
    super(opts);
  }

  async initialize() {
    this.registerHooks();
  }

  render() {
    const { targets, viewers } = this;

    if ( !(targets.length || viewers.length) ) return this.clearDebug();
    this.clearDebug();

    // Calculate points and pull the debug data.
    for ( const viewer of viewers) {
      this.calc.viewer = viewer;
      this.calc.viewpoints = this.calc.initializeViewpoints();

      for ( const target of targets) {
        if ( viewer === target ) continue;
        this.calc.target = target;
        this.calc._drawCanvasDebug();
        this.calc.percentVisible(target);
      }
    }
  }

  /** @type {AbstractViewer} */
  #calc;

  get calc() {
    if ( this.#calc ) return this.#calc;
    this.#calc = buildCustomLOSCalculator(this.viewers[0], Settings.KEYS.LOS.TARGET.TYPES.POINTS);
    this.#calc.config.viewpointClass = PointsViewpoint;
    this.#calc.config.debug = true;
    this.#calc.config.debugDraw = this.debugDraw;
    return this.#calc;
  }

  initializeCalc() {
    this.calc ??= buildCustomLOSCalculator(this.viewers[0], Settings.KEYS.LOS.TARGET.TYPES.POINTS);
    this.calc.config.debug = true;
    this.calc.config.debugDraw = this.debugDraw;
  }

  _initializeDebugGraphics() {
    const g = new PIXI.Graphics();
    g.eventMode = "passive"; // Allow targeting, selection to pass through.
    canvas.tokens.addChild(g);
    return g;
  }

  clearDebug() {
    if ( this.#debugGraphics ) this.#debugGraphics.clear();
  }

  /**
   * Triggered whenever a token is refreshed.
   * @param {Token} token
   * @param {RenderFlags} flags
   */
  onRefreshToken(token, flags) {
    if ( !(this.viewers.some(viewer => viewer === token)
        || this.targets.some(target => target === token)) ) return;
    if ( !(flags.refreshPosition
        || flags.refreshElevation
        || flags.refreshSize ) ) return;
    this.render();
  }

  destroy() {
    this.clearDebug();
    canvas.tokens.removeChild(this.#debugGraphics);
    if ( this.#debugGraphics ) this.#debugGraphics.destroy();
    super.destroy();
  }

}
