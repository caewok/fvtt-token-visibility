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

  /** @type {RenderObstaclesWebGL2} */
  renderObstacles;

  /** @type {Token} */
  viewer;

  /** @type {Token} */
  target;

  constructor({ senseType = "sight" } = {}) {
    this.senseType = senseType;
  }

  async initialize() {
    this.registerHooks();
  }

  _createRenderer() {
    return new RenderObstaclesWebGL2({ gl: this.gl, senseType: this.senseType, debugViewNormals: this.debugView });
  }

  render(viewerLocation, target, { viewer, targetLocation } = {}) {
    viewer ??= this.viewer;
    target ??= this.target;
    if ( !(viewer || target) ) return;

    viewerLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer);
    this._render(viewer, target, viewerLocation, targetLocation);
    const percentVisible = this.percentVisible(viewer, target, viewerLocation, targetLocation);
    this.updateDebugForPercentVisible(percentVisible, viewer, target, viewerLocation, targetLocation);
  }

  _render(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
  }

  updateDebugForPercentVisible(_percentVisible, _viewer, _target, _viewerLocation, _targetLocation) {}

  percentVisible(viewer, target, _viewerLocation, _targetLocation) {
    return this.calc.percentVisible(viewer, target);
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
    this.clearDebug();
    this.deregisterHooks();
    canvas.tokens.removeChild(this.#debugGraphics);
    if ( this.#debugGraphics && !this.#debugGraphics.destroyed ) this.#debugGraphics.destroy();
    // this.renderObstacles.destroy();
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

export class DebugVisibilityViewerWithPopoutAbstract extends DebugVisibilityViewerAbstract {
  /** @type {number} */
  static WIDTH = 400;

  /** @type {number} */
  static HEIGHT = 400;

  /** @type {class} */
  static popoutClass = Area3dPopoutCanvas;

  /** @type {Area3dPopoutCanvas} */
  popout;

  /** @type {WebGL2Context} */
  gl;

  constructor(opts) {
    super(opts);
    this.popout = new this.constructor.popoutClass({ width: this.constructor.WIDTH, height: this.constructor.HEIGHT + 75, resizable: false });
  }

  async initialize() {
    await super.initialize();
    return this.reinitialize(); // Async.
  }

  async reinitialize() {
    if ( !this.popoutIsRendered ) {
      await this.openPopout();
      this.gl = this.popout.context;
    }
    this.renderObstacles = this._createRenderer();
    return this.renderObstacles.initialize(); // Async
  }

  async openPopout(opts) {
    await this.popout._render(true, opts);
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
    if ( !(viewer || target) ) return;
    if ( !this.popoutIsRendered ) {
      return this.reinitialize().then(() =>
        super.render(viewerLocation, target, { viewer, targetLocation }));
    }
    super.render(viewerLocation, target, { viewer, targetLocation });
  }

  _render(viewer, target, viewerLocation, targetLocation) {
    super._render(viewer, target, viewerLocation, targetLocation);
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

  constructor(opts) {
    super(opts);
    this.debugView = opts.debugView ?? true;
    this.calc = new PercentVisibleCalculatorWebGL2({ senseType: this.senseType });
  }

  async initialize() {
    await this.calc.initialize()
    await super.initialize();
  }

  async openPopout(opts = {}) {
    opts.contextType = this.constructor.CONTEXT_TYPE;
    return super.openPopout(opts); // Async.
  }


  _createRenderer() {
    return new RenderObstaclesWebGL2({ gl: this.gl, senseType: this.senseType, debugViewNormals: this.debugView });
  }
}

export class DebugVisibilityViewerWebGPU extends DebugVisibilityViewerWithPopoutAbstract {
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

export class DebugVisibilityViewerWebGPUAsync extends DebugVisibilityViewerWithPopoutAbstract {
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

  percentVisible(viewer, target, viewerLocation, targetLocation) {
    const callback = (percentVisible, viewer, target) => this.updatePopoutFooter({ percentVisible, viewer, target });
    const percentVis = this.calc.percentVisible(viewer, target, { callback, viewerLocation, targetLocation });
    return 0;
  }

  updateDebugForPercentVisible(_percentVisible, _viewer, _target, _viewerLocation, _targetLocation) {}
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
      this.calc.viewpoints = this.calc.initializeViewpoints();

      for ( const target of targets) {
        if ( viewer === target ) continue;
        this.calc.target = target;
        this.calc._drawCanvasDebug();
        this.calc.percentVisible(target);
      }
    }
  }

  percentVisible(viewer, target, viewerLocation, targetLocation) {
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

export class DebugVisibilityViewerArea3dPIXI extends DebugVisibilityViewerWithPopoutAbstract {
  /** @type {class} */
  static popoutClass = Area3dPopout;

  static ALGORITHMS = {
    AREA3D_GEOMETRIC: SETTINGS.LOS.TARGET.TYPES.AREA3D_GEOMETRIC,
    AREA3D_WEBGL1: SETTINGS.LOS.TARGET.TYPES.AREA3D_WEBGL1,
    AREA3D_WEBGL2: SETTINGS.LOS.TARGET.TYPES.AREA3D_WEBGL2,
    AREA3D_HYBRID: SETTINGS.LOS.TARGET.TYPES.AREA3D_HYBRID,
  };

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

  algorithm = this.constructor.ALGORITHMS.AREA3D_WEBGL2;

  async openPopout(opts) {
    await super.openPopout(opts);
    this.popout.pixiApp.stage.addChild(this.popoutGraphics);
    this.popout.pixiApp.stage.addChild(this.popoutContainer);
  }

  _render(viewer, target, viewerLocation, targetLocation) {
    this.clearDebug();
    this.calc.viewer = this.viewer;
    this.calc.target = target;
    this.calc._drawCanvasDebug();
    this.calc.viewpoints[0]._draw3dDebug(this.popoutDraw, this.popout.pixiApp.renderer, this.popoutContainer);
  }

  percentVisible(viewer, target, viewerLocation, targetLocation) {
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

  clearCalc() {
    if ( this.#calc ) this.#calc.destroy();
    this.#calc = undefined;
  }

  clearDebug() {
    super.clearDebug();
    this.popoutDraw.clearDrawings();
  }

  destroy() {
    this.clearCalc();
    if ( this.#popoutGraphics && !this.#popoutGraphics.destroyed ) this.#popoutGraphics.destroy();
    if ( this.#popoutContainer && !this.#popoutContainer.destroyed ) this.#popoutContainer.destroy();
    super.destroy();
  }
}
