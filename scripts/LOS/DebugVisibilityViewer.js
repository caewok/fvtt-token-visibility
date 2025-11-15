/* globals
canvas,
CONFIG,
game,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Area3dPopoutCanvas, Area3dPopout, Area3dPopoutV2 } from "./Area3dPopout.js";
import { SETTINGS } from "../settings.js";
import { MODULE_ID } from "../const.js";
import { ViewerLOS } from "./ViewerLOS.js";

/* Debug viewer

If a token is controlled and another is targeted, display a popup with the debug view.
Calculates percentage visible for the viewer/target combo.
*/

export class DebugVisibilityViewerAbstract {

  /** @type {ViewerLOS} */
  viewerLOS;

  constructor(viewerLOS) {
    this.viewerLOS = viewerLOS
    this.viewerLOS.debug = true;

    // Try to set viewer to the first controlled token if undefined.
    if ( !this.viewerLOS.viewer ) this.viewerLOS.viewer = canvas.tokens.controlled[0];

    // Try to set target to the first targeted token if undefined.
    if ( !this.viewerLOS.target ) this.target = game.user.targets.first();

    this.registerHooks();
    this._initializeDebugGraphics();
  }

  static fromCalculator(calculator, viewer) {
    return new this(new ViewerLOS(viewer, calculator));
  }

  /** @type {Token} */
  get viewer() { return this.viewerLOS.viewer; }

  set viewer(value) { this.viewerLOS.viewer = value; }

  /** @type {Token} */
  get target() { return this.viewerLOS.target; }

  set target(value) { this.viewerLOS.target = value; }

  render() {
    this.clearDebug();
    if ( !(this.viewer && this.target ) ) return;

    // First draw the basic debugging graphics for the canvas.
    this.viewerLOS.calculate();
    this._drawCanvasDebug();

    // Then determine the percent visible using the algorithm and
    // update debug view specific to that algorithm.
    const percentVisible = this.viewerLOS.percentVisible;
    this.updateDebugForPercentVisible(percentVisible);
  }

  updateDebugForPercentVisible(_percentVisible) {}

  percentVisible() {
    return this.viewerLOS.percentVisible(this.target);
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
    else if ( this.viewer === token ) this.viewer = undefined;
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
    else if ( this.target === targetToken ) this.target = undefined;
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
    canvas.tokens.removeChild(this.#debugContainer);
    if ( this.#debugContainer && !this.#debugContainer.destroyed ) this.#debugContainer.destroy();
    this.viewerLOS.destroy();
  }

  /* ----- Canvas graphics ----- */

  /** @type {PIXI.Container} */
  #debugContainer;

  get debugContainer() {
    if ( !this.#debugContainer || this.#debugContainer.destroyed ) this._initializeDebugGraphics();
    return this.#debugContainer;
  }

  _initializeDebugGraphics() {
    this.#debugContainer = new PIXI.Container;
    this.#debugContainer.eventMode = "passive"; // Allow targeting, selection to pass through.
    canvas.tokens.addChild(this.#debugContainer);
    this.#debugContainer.addChild(this.viewerLOS.canvasDebugContainer);
  }

  /* ----- NOTE: Debug ----- */

  _drawCanvasDebug() { this.viewerLOS._drawCanvasDebug(); }

  clearDebug() {
    this.viewerLOS._clearCanvasDebug();
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

  // See https://toji.dev/webgpu-best-practices/webgl-performance-comparison.html
  static CONTEXT_OPTS = {
    powerPreference: "high-performance",
    antialias: false,
    depth: true,
    stencil: true,
    alpha: true,  // Equivalent to alpha: "premultiplied" in WebGPU.
    premultiplied: true,
  };

  /** @type {Area3dPopoutCanvas} */
  popout;

  constructor(opts) {
    super(opts);
    this.popout = new this.constructor.popoutClass({
//       width: this.constructor.WIDTH,
//       height: this.constructor.HEIGHT + 100,
//       resizable: false
    });
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
    await this.popout.render(true, {
      contextType: this.constructor.CONTEXT_TYPE,
      contextConfiguration: this.constructor.CONTEXT_OPTS,
    });
    this._updatePopoutTitle(this.popoutTitle);
  } // Async.

  /** @type {boolean} */
  get popoutIsRendered() { return this.popout && this.popout.rendered; }

  /**
   * Refresh the popout title.
   */
  _updatePopoutTitle(title) {
    if ( !this.popoutIsRendered ) return;
    title ??= this.popoutTitle;
    const popout = this.popout;
    const titleElem = this.popout.element.getElementsByClassName("window-title")[0];
    if ( titleElem ) titleElem.textContent = title;
  }

  /** @type {string} */
  get popoutTitle() {
    const moduleName = game.i18n.localize(`${MODULE_ID}.nameAbbr`);
    return `${moduleName}|${this.constructor.name}`;
  }

  updatePopoutFooter(percentVisible) {
    const viewer = this.viewer;
    const target = this.target;
    const elem = this.popout instanceof Application ? this.popout.element[0] : this.popout.element;
    const visibleTextElem = elem.getElementsByTagName("p")[0];
    visibleTextElem.innerHTML = `⏿ ${viewer?.name ?? ""} --> ◎ ${target?.name ?? "?"} \t ${Math.round(percentVisible * 100)}% visible`;
    // console.debug(`⏿ ${viewer.name} --> ◎ ${target.name} ${Math.round(percentVisible * 100)}%`);
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
  static popoutClass = Area3dPopoutV2;

  /** @type {PIXI.Container} */
  #popoutContainers = [];

  get popoutContainers() {
    if ( !this.#popoutContainers.length ) {
      const { WIDTH, HEIGHT } = this.constructor;

      // Divide in the popout space.
      const positions = [];
      let viewSize;
      switch ( this.viewerLOS.viewpoints.length ) {
        case 1: positions.push([0, 0]); viewSize = WIDTH; break;

        // ----- | -----
        case 2: positions.push(
          [WIDTH * -0.25, 0],
          [WIDTH * 0.25, 0],
        ); viewSize = WIDTH / 2; break;

        //     -----
        // ----- | -----
        case 3: positions.push(
          [0, HEIGHT * -0.25],
          [WIDTH * -0.25, HEIGHT * 0.25],
          [WIDTH * 0.25, HEIGHT * 0.25],
        ); viewSize = WIDTH / 3; break;

        // ----- | -----
        // ----- | -----
        case 4: positions.push(
          [WIDTH * -0.25, HEIGHT * -0.25],
          [WIDTH * 0.25, HEIGHT * -0.25],
          [WIDTH * -0.25, HEIGHT * 0.25],
          [WIDTH * 0.25, HEIGHT * 0.25],
        ); viewSize = WIDTH / 2; break;

        //  ----- | -----
        // --- | --- | ---
        case 5: positions.push(
          [WIDTH * -0.25, HEIGHT * -0.25],
          [WIDTH * 0.25, HEIGHT * -0.25],
          [WIDTH * -0.33, HEIGHT * 0.25],
          [0, HEIGHT * 0.25],
          [WIDTH * 0.33, HEIGHT * 0.25],
        ); viewSize = WIDTH / 3; break;

        // --- | --- | ---
        // --- |     | ---
        // --- | --- | ---
        case 6:
        case 7:
        case 8: positions.push(
          [WIDTH * -0.33, HEIGHT * -0.33],
          [WIDTH * 0, HEIGHT * -0.33],
          [WIDTH * 0.33, HEIGHT * -0.33],

          [WIDTH * -0.33, HEIGHT * 0],
          // [0, 0],
          [WIDTH * 0.33, HEIGHT * 0],

          [WIDTH * -0.33, HEIGHT * 0.33],
          [0, HEIGHT * 0.33],
          [WIDTH * 0.33, HEIGHT * 0.33],
        ); viewSize = WIDTH / 3; break;

        // --- | --- | ---
        // --- | --- | ---
        // --- | --- | ---
        case 9:
        default: positions.push(
          [WIDTH * -0.33, HEIGHT * -0.33],
          [WIDTH * 0, HEIGHT * -0.33],
          [WIDTH * 0.33, HEIGHT * -0.33],

          [WIDTH * -0.33, HEIGHT * 0],
          [WIDTH * 0, HEIGHT * 0],
          [WIDTH * 0.33, HEIGHT * 0],

          [WIDTH * -0.33, HEIGHT * 0.33],
          [WIDTH * 0, HEIGHT * 0.33],
          [WIDTH * 0.33, HEIGHT * 0.33],
        ); viewSize = WIDTH / 3; break;
      }

      /* For 2, width = 400, height = 400
      [-100, 0], [100, 0]
      #1
      viewSize = 400 / 2 = 200
      scale = 200 / 400 = 0.5
      size = 100

      scale = 100 / 400 * 2 = 0.5
      size = 100 * 1 / 0.5 = 200
      */

      positions.forEach(([x, y]) => {
        const c = new PIXI.Container();
        c.position.set(x, y);

        // Shrink the scale if there are more items to display.
        const scale = viewSize / Math.max(WIDTH, HEIGHT);
        c.scale.set(scale, scale);
        const size = viewSize / scale;

        // Mask the container so it only displays over a portion of the canvas.
        // See https://pixijs.com/7.x/guides/components/containers
        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff);
        mask.drawRect(-size * 0.5, -size * 0.5, size, size);
        mask.endFill();
        c.mask = mask;
        c.addChild(mask);

        this.#popoutContainers.push(c);

        // console.debug(`Container at ${x},${y} with scale ${scale}, viewSize ${viewSize}, size ${size}.`);

      });
    }
    return this.#popoutContainers;
  }

  getPopoutContainer(idx) {
    return this.popoutContainers[idx];
  }

  /** @type {PIXI.Graphics} */
  #popoutGraphics = [];

  get popoutGraphics() {
    if ( !this.#popoutGraphics.length ) {
      this.popoutContainers.forEach(c => {
        const g = new PIXI.Graphics();
        this.#popoutGraphics.push(g);
        c.addChild(g);
      });
    }
    return this.#popoutGraphics;
  }

  getPopoutGraphic(idx) { return this.popoutGraphics[idx]; }


  /** @type {Draw} */
  #popoutDraws = [];

  get popoutDraws() {
    if ( !this.#popoutDraws.length ) {
      this.popoutGraphics.forEach(g => {
        const d = new CONFIG.GeometryLib.Draw(g);
        this.#popoutDraws.push(d);
      });
    }
    return this.#popoutDraws;
  }

  getPopoutDraw(idx) { return this.popoutDraws[idx]; }

  /**
   * For debugging.
   * Draw the percentage visible.
   * @param {number} percent    The percent to draw in the window.
   */
  _updatePercentVisibleLabel(number) {
    const label = this.percentVisibleLabel;
    label.text = `${(number * 100).toFixed(1)}%`;
    // console.log(`${this.viewerLOS.calculator.constructor.name}|_updatePercentVisibleLabel ${label.text}`);
  }

  algorithm = SETTINGS.LOS.TARGET.TYPES.WEBGL2;

  async openPopout(opts) {
    await super.openPopout(opts);
    this.popoutContainers.forEach(c => this.popout.pixiApp.stage.addChild(c));
  }

  updateDebugForPercentVisible(percentVisible) {
    let width = this.constructor.WIDTH;
    let height = this.constructor.HEIGHT;

    // Keep width and height even.
    switch ( this.viewerLOS.viewpoints.length ) {
      case 1: width *= 0.5; height *= 0.5; break;
      case 2:
      case 4:
      case 6: width *= .25; height *= .25; break;
      case 3:
      case 5:
      case 7:
      case 8:
      case 9: width *= (0.5 / 3); height *= (0.5 / 3); break;
    }

    this.viewerLOS.viewpoints.forEach((vp, idx) => {
      // vp.calculate();
      const draw = this.getPopoutDraw(idx);
      const container = this.getPopoutContainer(idx);
      vp._draw3dDebug(draw, { container, width, height });
      // vp._draw3dDebug(draw, this.popout.pixiApp.renderer, c, { width, height });
    })
    super.updateDebugForPercentVisible(percentVisible);
  }

  clearDebug() {
    super.clearDebug();
    this.#popoutDraws.forEach(d => d.clearDrawings());
  }

  destroy() {
    this.#popoutGraphics.forEach(g => {
      if ( !g.destroyed ) g.destroy();
    });
    this.#popoutContainers.forEach(c => {
      if ( !c.destroyed ) c.destroy();
    });
    this.#popoutGraphics.length = 0;
    this.#popoutDraws.length = 0;
    this.#popoutContainers.length = 0;
    super.destroy();
  }
}
