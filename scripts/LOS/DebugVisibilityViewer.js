/* globals
canvas,
CONFIG,
game,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Area3dPopoutCanvas, Area3dPopout } from "./Area3dPopout.js";
import { SETTINGS } from "../settings.js";
import { MODULE_ID } from "../const.js";
import { AbstractViewerLOS } from "./AbstractViewerLOS.js";

/* Debug viewer

If a token is controlled and another is targeted, display a popup with the debug view.
Calculates percentage visible for the viewer/target combo.
*/

export class DebugVisibilityViewerAbstract {

  /** @type {class} */
  viewpointClass;

  /** @type {PercentVisibleCalculator} */
  viewerLOS;

  constructor(config = {}) {
    config.debug = true;
    config.viewpointKey = this.viewpointClass;
    this.viewerLOS = new AbstractViewerLOS(undefined, config);
  }

  async initialize() {
    this.registerHooks();
    return this.viewerLOS.initialize();
  }

  /** @type {Token} */
  #viewer;

  get viewer() { return (this.#viewer ??= canvas.tokens.controlled[0]); }

  set viewer(value) {
    this.#viewer = value;
    this.viewerLOS.viewer = value;
  }


  /** @type {Token} */
  #target;

  get target() { return (this.#target ??= game.user.targets.first()); }

  set target(value) {
    this.#target = value;
    this.viewerLOS.target = value;
  }

  render() {
    this.clearDebug();

    if ( !(this.viewer && this.target ) ) return;

    // First draw the basic debugging graphics for the canvas.
    this._drawCanvasDebug();

    // Then determine the percent visible using the algorithm and
    // update debug view specific to that algorithm.
    const percentVisible = this.percentVisible();
    this.updateDebugForPercentVisible(percentVisible);
  }

  updateDebugForPercentVisible(_percentVisible) {}

  percentVisible() {
    return this.losViewer.percentVisible();
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
    this.viewerLOS.calculator.destroy();
    this.viewerLOS.destroy();
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

  /* ----- NOTE: Debug ----- */

  _drawCanvasDebug() { this.viewerLOS._drawCanvasDebug(this.debugDraw); }
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

  updatePopoutFooter(percentVisible) {
    const viewer = this.viewer;
    const target = this.target;
    const visibleTextElem = this.popout.element[0].getElementsByTagName("p")[0];
    visibleTextElem.innerHTML = `⏿ ${viewer?.name ?? ""} --> ◎ ${target?.name ?? "?"} \t ${Math.round(percentVisible * 100)}% visible`;
    console.debug(`⏿ ${viewer.name} --> ◎ ${target.name} ${Math.round(percentVisible * 100)}%`);
  }

  render() {
    if ( !(this.viewer && this.target) ) return;
    if ( !this.popoutIsRendered ) return this.reinitialize().then(() => super.render());
    super.render();
  }

  updateDebugForPercentVisible(percentVisible) {
    this.updatePopoutFooter(percentVisible);
  }

  destroy() {
    this.popout.close();
    super.destroy();
  }
}

export class DebugVisibilityViewerArea3dPIXI extends DebugVisibilityViewerWithPopoutAbstract {
  /** @type {class} */
  static popoutClass = Area3dPopout;

  /** @type {PIXI.Graphics} */
  #popoutGraphics;

  get popoutGraphics() {
    if ( !this.#popoutGraphics ) {
      this.#popoutGraphics = new PIXI.Graphics();
      this.popoutContainer.addChild(this.#popoutGraphics);
    }
    return (this.#popoutGraphics ??= new PIXI.Graphics());
  }

  /** @type {PIXI.Container} */
  #popoutContainer;

  get popoutContainer() { return (this.#popoutContainer ??= new PIXI.Container()); }

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
    console.log(`${this.calculator.constructor.name}|_updatePercentVisibleLabel ${label.text}`);
  }

  algorithm = SETTINGS.LOS.TARGET.TYPES.AREA3D_WEBGL2;

  async openPopout(opts) {
    await super.openPopout(opts);
    this.popout.pixiApp.stage.addChild(this.popoutContainer);
  }

  _render(viewer, target, _viewerLocation, _targetLocation) {
    this.clearDebug();
    this.calculator.viewer = this.viewer;
    this.calculator.target = target;
    this.calculator._drawCanvasDebug();
    this.calculator.viewpoints[0]._draw3dDebug(this.popoutDraw, this.popout.pixiApp.renderer, this.popoutContainer,
      { width: this.constructor.WIDTH * .5, height: this.constructor.HEIGHT * .5 });
  }

  percentVisible(viewer, target, _viewerLocation, _targetLocation) {
    this.calculator.viewer = this.viewer;
    return this.calculator.percentVisible(target);
  }

  updateDebugForPercentVisible(percentVisible) {
    this.losViewer._draw3dDebug();

    super.updateDebugForPercentVisible(percentVisible);
  }

  clearDebug() {
    super.clearDebug();
    if ( this.#popoutDraw ) this.#popoutDraw.clearDrawings();
  }

  destroy() {
    if ( this.#popoutGraphics && !this.#popoutGraphics.destroyed ) {
      this.#popoutGraphics.destroy();
      this.#popoutDraw = undefined;
    }
    if ( this.#popoutContainer && !this.#popoutContainer.destroyed ) this.#popoutContainer.destroy();
    super.destroy();
  }
}
