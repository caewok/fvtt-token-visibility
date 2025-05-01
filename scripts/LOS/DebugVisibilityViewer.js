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
import { buildCustomLOSCalculator } from "../LOSCalculator.js";
import { SETTINGS } from "../settings.js";
import { MODULE_ID } from "../const.js";

/* Debug viewer

If a token is controlled and another is targeted, display a popup with the debug view.
Calculates percentage visible for the viewer/target combo.
*/

export class DebugVisibilityViewerAbstract {

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

    // Draw the canvas debug.
    this.clearDebug();
    this._drawLineOfSight(viewerLocation, targetLocation);
    this._drawDetectedObjects(viewer, viewerLocation, target);
    this._drawVisionTriangle(viewerLocation, target);

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

  /* ----- NOTE: Debug ----- */

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight(viewerLocation, targetLocation) {
    this.debugDraw.segment({ A: viewerLocation, B: targetLocation });
  }

  /**
   * For debugging.
   * Draw outlines for the various objects that can be detected on the canvas.
   */
  _drawDetectedObjects(viewer, viewerLocation, target) {
    // if ( !this.#blockingObjects.initialized ) return;
    const debugDraw = this.debugDraw;
    const colors = Draw.COLORS;
    const { walls, tiles, terrainWalls, tokens } = AbstractViewpoint
      .findBlockingObjects(viewerLocation, target, { viewer, senseType: this.senseType });
    walls.forEach(w => debugDraw.segment(w, { color: colors.red, fillAlpha: 0.3 }));
    terrainWalls.forEach(w => debugDraw.segment(w, { color: colors.lightgreen }));
    tiles.forEach(t =>
      t[MODULE_ID].triangles.forEach(tri =>
        tri.draw2d({ draw: debugDraw, color: colors.yellow, fillAlpha: 0.3 })));
    tokens.forEach(t => debugDraw.shape(t.constrainedTokenBorder, { color: colors.orange, fillAlpha: 0.3 }));
  }

  /**
   * For debugging.
   * Draw the vision triangle between viewer point and target.
   */
  _drawVisionTriangle(viewerLocation, target) {
    const visionTriangle = AbstractViewpoint.visionTriangle.rebuild(viewerLocation, target);
    this.debugDraw.shape(visionTriangle, { width: 0, fill: Draw.COLORS.gray, fillAlpha: 0.1 });
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
    console.log(`${this.calc.constructor.name}|_updatePercentVisibleLabel ${label.text}`);
  }

  algorithm = SETTINGS.LOS.TARGET.TYPES.AREA3D_WEBGL2;

  async openPopout(opts) {
    await super.openPopout(opts);
    this.popout.pixiApp.stage.addChild(this.popoutContainer);
  }

  _render(viewer, target, _viewerLocation, _targetLocation) {
    this.clearDebug();
    this.calc.viewer = this.viewer;
    this.calc.target = target;
    this.calc._drawCanvasDebug();
    this.calc.viewpoints[0]._draw3dDebug(this.popoutDraw, this.popout.pixiApp.renderer, this.popoutContainer,
      { width: this.constructor.WIDTH * .5, height: this.constructor.HEIGHT * .5 });
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
