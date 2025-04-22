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
import { Area3dPopoutCanvas, Area3dPopout } from "../Area3dPopout.js";
import { PercentVisibleCalculatorWebGL2, PercentVisibleCalculatorWebGPU, PercentVisibleCalculatorWebGPUAsync } from "./PercentVisibleCalculator.js";
import { buildCustomLOSCalculator } from "../../LOSCalculator.js";
import { Settings, SETTINGS } from "../../settings.js";
import { PointsViewpoint } from "../PointsViewpoint.js";
import { MODULE_ID } from "../../const.js";

/* Debug viewer

If a token is controlled and another is targeted, display a popup with the debug view.
Calculates percentage visible for the viewer/target combo.
*/

class DebugVisibilityViewerAbstract {

  /** @type {string} */
  senseType = "sight";

  constructor({ senseType = "sight" } = {}) {
    this.senseType = senseType;
  }

  async initialize() {
    this.registerHooks();
  }

  /** @type {Token} */
  #viewer;

  get viewer() { return (this.#viewer ??= canvas.tokens.controlled[0]); }

  set viewer(value) { this.#viewer = value; }

  /** @type {Token} */
  #target;

  get target() { return (this.#target ??= game.user.targets.first()); }

  set target(value) { this.#target = value; }

  render(viewerLocation, target, { viewer, targetLocation } = {}) {
    viewer ??= this.viewer;
    target ??= this.target;
    if ( !(viewer && target) ) return;

    viewerLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer);
    this._render(viewer, target, viewerLocation, targetLocation);
    const percentVisible = this.percentVisible(viewer, target, viewerLocation, targetLocation);
    this.updateDebugForPercentVisible(percentVisible, viewer, target, viewerLocation, targetLocation);
  }

  _render(_viewer, _target, _viewerLocation, _targetLocation) {}

  updateDebugForPercentVisible(_percentVisible, _viewer, _target, _viewerLocation, _targetLocation) {}

  percentVisible(_viewer, _target, _viewerLocation, _targetLocation) {}

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
    // if ( !controlled ) return;
    if ( controlled ) this.viewer = token;
    this.render();
  }

  /**
   * Triggered whenever a token is targeted/untargeted.
   * @param {User} user
   * @param {Token} targetToken
   * @param {boolean} targeted      True if targeted
   */
  onTargetToken(user, targetToken, targeted) {
    if ( game.user !== user ) return;
    if ( targeted ) this.target = targetToken;
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
    this.clearDebug();
    this.deregisterHooks();
    canvas.tokens.removeChild(this.#debugGraphics);
    if ( this.#debugGraphics && !this.#debugGraphics.destroyed ) this.#debugGraphics.destroy();
  }

  /* ----- Canvas graphics ----- */

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

  _initializeDebugGraphics() {
    const g = new PIXI.Graphics();
    g.eventMode = "passive"; // Allow targeting, selection to pass through.
    canvas.tokens.addChild(g);
    return g;
  }

  clearDebug() {
    if ( this.#debugGraphics ) this.#debugGraphics.clear();
  }
}

export class DebugVisibilityViewerPoints extends DebugVisibilityViewerAbstract {
  /** @type {class} */
  // static popoutClass = Area3dPopout; // PIXI version

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

  render() {
    const { targets, viewers } = this;

    if ( !(targets.length || viewers.length) ) return this.clearDebug();
    this.clearDebug();

    // Calculate points and pull the debug data.
    for ( const viewer of viewers) {
      this.calc.viewer = viewer;

      for ( const target of targets) {
        if ( viewer === target ) continue;
        this.calc.target = target;
        this.calc._drawCanvasDebug();
        this.calc.percentVisible(target);
      }
    }
  }

  percentVisible(viewer, target, _viewerLocation, _targetLocation) {
    this.calc.viewer = viewer;
    return this.calc.percentVisible(target);
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
}

export class DebugVisibilityViewerWithPopoutAbstract extends DebugVisibilityViewerAbstract {
  /** @type {number} */
  static WIDTH = 400;

  /** @type {number} */
  static HEIGHT = 400;

  /** @type {class} */
  static popoutClass = Area3dPopoutCanvas;

  static CONTEXT_TYPE = "webgl2";

  /** @type {Area3dPopoutCanvas} */
  popout;

  constructor(opts) {
    super(opts);
    this.popout = new this.constructor.popoutClass({ width: this.constructor.WIDTH, height: this.constructor.HEIGHT + 75, resizable: false });
  }

  get gl() { return this.popout.context; }

  async initialize() {
    await super.initialize();
    return this.reinitialize(); // Async.
  }

  async reinitialize() {
    if ( !this.popoutIsRendered ) await this.openPopout();
  }

  async openPopout() {
    await this.popout._render(true, { contextType: this.constructor.CONTEXT_TYPE });
    this._updatePopoutTitle(this.popoutTitle);
  } // Async.

  /** @type {boolean} */
  get popoutIsRendered() { return this.popout && this.popout.rendered; }

  /**
   * Refresh the popout title.
   */
  _updatePopoutTitle(title) {
    if ( !this.popoutIsRendered ) return;
    title ??= this.popoutTitle();
    const popout = this.popout;
    const elem = popout.element.find(".window-title");
    elem[0].textContent = title;
    popout.options.title = title; // Just for consistency.
  }

  /** @type {string} */
  get popoutTitle() {
    const moduleName = game.i18n.localize(`${MODULE_ID}.nameAbbr`);
    return `${moduleName} 3D Debug`;
  }

  updatePopoutFooter({ percentVisible, viewer, target } = {}) {
    viewer ??= this.viewer;
    target ??= this.target;
    const visibleTextElem = this.popout.element[0].getElementsByTagName("p")[0];
    visibleTextElem.innerHTML = `⏿ ${viewer?.name ?? ""} --> ◎ ${target?.name ?? "?"} \t ${Math.round(percentVisible * 100)}% visible`;
    console.debug(`⏿ ${viewer.name} --> ◎ ${target.name} ${Math.round(percentVisible * 100)}%`);
  }

  render(viewerLocation, target, { viewer, targetLocation } = {}) {
    viewer ??= this.viewer;
    target ??= this.target;
    if ( !(viewer && target) ) return;
    if ( !this.popoutIsRendered ) {
      return this.reinitialize().then(() =>
        super.render(viewerLocation, target, { viewer, targetLocation }));
    }
    super.render(viewerLocation, target, { viewer, targetLocation });
  }

  updateDebugForPercentVisible(percentVisible, viewer, target, _viewerLocation, _targetLocation) {
    this.updatePopoutFooter({ viewer, target, percentVisible });
  }

  destroy() {
    this.popout.close();
    super.destroy();
  }
}


export class DebugVisibilityViewerWebGL2 extends DebugVisibilityViewerWithPopoutAbstract {
  static CONTEXT_TYPE = "webgl2";

  /** @type {boolean} */
  debugView = true;

  constructor(opts = {}) {
    super(opts);
    this.debugView = opts.debugView ?? true;
    this.calc = new PercentVisibleCalculatorWebGL2({ senseType: this.senseType });
  }

  async initialize() {
    await super.initialize();
    await this.calc.initialize();
  }

  async openPopout() {
    await super.openPopout();
    if ( this.renderer ) this.renderer.destroy();
    this.renderer = new RenderObstaclesWebGL2({
      senseType: this.senseType,
      debugViewNormals: this.debugView,
      gl: this.gl,
    });
    await this.renderer.initialize();
  }

  _render(viewer, target, viewerLocation, targetLocation) {
    this.renderer.prerender();
    this.renderer.render(viewerLocation, target, { viewer, targetLocation });
  }

  percentVisible(viewer, target, viewerLocation, targetLocation) {
    return this.calc.percentVisible(viewer, target, { viewerLocation, targetLocation });
  }

  destroy() {
    if ( this.calc ) this.calc.destroy();
    if ( this.renderer ) this.renderer.destroy();
    super.destroy();
  }
}

export class DebugVisibilityViewerWebGPU extends DebugVisibilityViewerWithPopoutAbstract {
  static CONTEXT_TYPE = "webgpu";

  /** @type {PercentVisibleCalculator} */
  calc;

  /** @type {RenderObstacles} */
  renderer;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.debugView = opts.debugView ?? true;
    this.device = device;
    this.calc = new PercentVisibleCalculatorWebGPU({ device, senseType: this.senseType });
    this.renderer = new RenderObstacles(this.device, {
      senseType: this.senseType,
      debugViewNormals: this.debugView,
      width: this.constructor.WIDTH,
      height: this.constructor.HEIGHT
    });
  }
  async initialize() {
    await super.initialize();
    await this.calc.initialize();
    await this.renderer.initialize();
  }

  async reinitialize() {
    await super.reinitialize();
    this.renderer.setRenderTextureToCanvas(this.popout.canvas);
  }

  _render(viewer, target, viewerLocation, targetLocation) {
    this.renderer.prerender();
    this.renderer.render(viewerLocation, target, { viewer, targetLocation });
  }

  percentVisible(viewer, target, viewerLocation, targetLocation) {
    return this.calc.percentVisible(viewer, target, { viewerLocation, targetLocation });
  }

  destroy() {
    if ( this.calc ) this.calc.destroy();
    if ( this.renderer ) this.renderer.destroy();
    super.destroy();
  }
}

export class DebugVisibilityViewerWebGPUAsync extends DebugVisibilityViewerWithPopoutAbstract {
  static CONTEXT_TYPE = "webgpu";

  /** @type {PercentVisibleCalculator} */
  calc;

  /** @type {RenderObstacles} */
  renderer;

  /** @type {boolean} */
  debugView = true;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.debugView = opts.debugView ?? true;
    this.calc = new PercentVisibleCalculatorWebGPUAsync({ device, senseType: this.senseType });
    this.renderer = new RenderObstacles(this.device, {
      senseType: this.senseType,
      debugViewNormals: this.debugView,
      width: this.constructor.WIDTH,
      height: this.constructor.HEIGHT
    });
  }

  async initialize() {
    await super.initialize();
    await this.calc.initialize();
    await this.renderer.initialize();
  }

  async reinitialize() {
    await super.reinitialize();
    this.renderer.setRenderTextureToCanvas(this.popout.canvas);
  }

  _render(viewer, target, viewerLocation, targetLocation) {
    this.renderer.prerender();
    this.renderer.render(viewerLocation, target, { viewer, targetLocation });
  }

  percentVisible(viewer, target, viewerLocation, targetLocation) {
    const callback = (percentVisible, viewer, target) => this.updatePopoutFooter({ percentVisible, viewer, target });
    return this.calc.percentVisible(viewer, target, { callback, viewerLocation, targetLocation });
  }

  destroy() {
    if ( this.calc ) this.calc.destroy();
    if ( this.renderer ) this.renderer.destroy();
    super.destroy();
  }
}

export class DebugVisibilityViewerArea3dPIXI extends DebugVisibilityViewerWithPopoutAbstract {
  /** @type {class} */
  static popoutClass = Area3dPopout;

  /** @type {PIXI.Graphics} */
  #popoutGraphics;

  get popoutGraphics() { return (this.#popoutGraphics ??= new PIXI.Graphics()); }

  /** @type {PIXI.Container} */
  #popoutContainer;

  get popoutContainer() { return this.#popoutContainer ??= new PIXI.Container(); }

  /** @type {Draw} */
  #popoutDraw;

  get popoutDraw() { return (this.#popoutDraw ??= new CONFIG.GeometryLib.Draw(this.popoutGraphics)); }

  /**
   * For debugging.
   * Draw the percentage visible.
   * @param {number} percent    The percent to draw in the window.
   */
  _updatePercentVisibleLabel(number) {
    const label = this.percentVisibleLabel;
    label.text = `${(number * 100).toFixed(1)}%`;
    console.log(`${this.calc.constructor.name}|_updatePercentVisibleLabel ${label.text}`);
  }

  algorithm = SETTINGS.LOS.TARGET.TYPES.AREA3D_WEBGL2;

  async openPopout(opts) {
    await super.openPopout(opts);
    this.popout.pixiApp.stage.addChild(this.popoutGraphics);
    this.popout.pixiApp.stage.addChild(this.popoutContainer);
  }

  _render(viewer, target, _viewerLocation, _targetLocation) {
    this.clearDebug();
    this.calc.viewer = this.viewer;
    this.calc.target = target;
    this.calc._drawCanvasDebug();
    this.calc.viewpoints[0]._draw3dDebug(this.popoutDraw, this.popout.pixiApp.renderer, this.popoutContainer);
  }

  percentVisible(viewer, target, _viewerLocation, _targetLocation) {
    this.calc.viewer = this.viewer;
    return this.calc.percentVisible(target);
  }

  /** @type {AbstractViewer} */
  #calc;

  get calc() {
    if ( this.#calc ) return this.#calc;
    this.#calc = buildCustomLOSCalculator(this.viewer, this.algorithm);
    this.#calc.config.debug = true;
    this.#calc.config.debugDraw = this.debugDraw;
    return this.#calc;
  }

  clearDebug() {
    super.clearDebug();
    if ( this.#popoutDraw ) this.#popoutDraw.clearDrawings();
  }

  destroy() {
    if ( this.#calc ) this.#calc.destroy();
    this.#calc = undefined;
    if ( this.#popoutGraphics && !this.#popoutGraphics.destroyed ) {
      this.#popoutGraphics.destroy();
      this.#popoutDraw = undefined;
    }
    if ( this.#popoutContainer && !this.#popoutContainer.destroyed ) this.#popoutContainer.destroy();
    super.destroy();
  }
}
