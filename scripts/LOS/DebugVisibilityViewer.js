/* globals
canvas,
CONFIG,
game,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base module
import { MODULE_ID, TRACKER_IDS } from "../const.js";
import { log } from "../util.js";

// Geometry
import { Draw } from "../geometry/Draw.js";

// LOS
import { Area3dPopoutV2, Area3dPopoutCanvasV2 } from "./Area3dPopout.js";
import { ENUMS } from "./const.js";
import { ViewerLOS } from "./ViewerLOS.js";
import { LOSRendererWebGL2 } from "./WebGL2/LOSRendererWebGL2.js";
import { WebGL2 } from "./WebGL2/WebGL2.js";

/* Debug viewer
If a token is controlled and another is targeted, display a popup with the debug view.
Calculates percentage visible for the viewer/target combo.
*/

export class DebugVisibilityViewerAbstract {

  /** @type {function} */
  _viewerLOSFn;

  /** @type {ViewerLOS} */
  viewerLOS;

  /** @type {boolean} */
  _destroyed = false;

  /**
   * @param {function|ViewerLOS}       Either a blank viewerLOS or a function that can
   *                                   retrieve a viewerLOS for a viewer token.
   *
   * For example:
   * viewerLOSFn = viewer => viewer.tokenvisiblity.visibility.viewerLOS;
   */
  constructor(viewerLOSFn) {
    if ( viewerLOSFn instanceof ViewerLOS ) {
      // Caller supplied a debug-only ViewerLOS. Use it directly.
      const own = viewerLOSFn;
      this._viewerLOSFn = viewer => {
        own.viewer = viewer;
        own.calculator = CONFIG[MODULE_ID].losCalculator;
        return own;
      };
    } else {
      // Caller supplied a lookup for the token's live ViewerLOS.
      // Never calculate with it. Use it only as the source of calculator and config.
      const own = new ViewerLOS(null, null);
      this._viewerLOSFn = viewer => {
        const source = viewerLOSFn(viewer);
        own.viewer = viewer;
        own.calculator = source.calculator;
        own.config = source.config;   // By reference, so settings changes carry over.
        return own;
      };
    }

    this.registerHooks();
    this._initializeDebugGraphics();
  }

  /** @type {Token} */
  get viewer() { return canvas.tokens.controlled?.[0] ?? null; }

  /** @type {Token} */
  #targetToken = null;

  get target() { return this.#targetToken || game.user.targets.first(); }

  /**
   * Update the viewer and target.
   * @returns {boolean} True if calculation can proceed.
   */
  initializeCalculation() {
    const { viewer, target } = this;
    if ( !(viewer && target) ) return false;
    this.viewerLOS = this._viewerLOSFn(this.viewer);
    this.viewerLOS.target = target;
    return true;
  }

  /**
   * The detection mode used for the last render.
   * @type {object<mode: CONFIG.Canvas.detectionModes|null, range: number>}
   */
  detectionMode = { mode: null, range: Number.POSITIVE_INFINITY };

  /**
   * First enabled detection mode on the viewer token that has a registered DetectionMode.
   * Falls back to basic sight.
   * @param {Token} viewer
   * @returns {object}
   * - @prop {DetectionMode} mode
   * - @prop {number} range
   */
  _firstDetectionMode() {
    const viewer = this.viewer;
    const modes = CONFIG.Canvas.detectionModes;
    const out = { mode: modes.basicSight, range: Number.POSITIVE_INFINITY };
    if ( !viewer?.document?.detectionModes ) return out;
    for ( const [key, m] of Object.entries(viewer.document.detectionModes) ) {
      if ( !m.enabled || !modes[key] ) continue;
      out.mode = modes[key];
      out.range = m.range;
      break;
    }
    return out;
  }

  /**
   * Localized label for the detection mode in use.
   * @type {string}
   */
  get detectionModeLabel() {
    const dm = this.detectionMode.mode;
    if ( !dm ) return "";
    const label = dm.label ? game.i18n.localize(dm.label) : dm.id;
    return label || dm.id || "";
  }

  get moduleDMHandler() {
    const viewer = this.viewer;
    const visionSource = viewer.vision;
    return visionSource?.object?.[MODULE_ID]?.[TRACKER_IDS.VISIBILITY]
      ?? viewer[MODULE_ID]?.[TRACKER_IDS.VISIBILITY];
  }

  render() {
    if ( this._destroyed ) return;

    this.clearDebug();
    if ( !this.initializeCalculation() ) return;


    // Configure the viewer's live LOS handler to use the first available detection mode.
    const atv = this.moduleDMHandler;
    this.detectionMode = this._firstDetectionMode();
    atv?.setConfigForDetectionMode(this.detectionMode.mode, this.detectionMode.range);

    try {
      // Calculate the LOS and draw the canvas debug graphics.
      const viewerLOS = this.viewerLOS;
      viewerLOS.calculate(); // Sets percent visible; may short-circuit.
      if ( !viewerLOS.viewpointsCalculated ) viewerLOS.prepare(); // Debug still needs current viewpoints and target.
      this._drawCanvasDebug();

      // Update debug view for the specific calculator
      this.updateDebugForPercentVisible(viewerLOS.percentVisible);
    } finally {
      atv?.resetConfig();
    }
  }

  updateDebugForPercentVisible(_percentVisible) {}

  percentVisible() {
    if ( !this.viewerLOS ) return 1;
    this.viewerLOS.target = this.target;
    return this.viewerLOS.percentVisible;
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
  onControlToken(_token, _controlled) {
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
    // Update the tracked target when a token is targeted
    if ( targeted && targetToken ) {
      this.#targetToken = targetToken;
    } else if ( !targeted && this.#targetToken ) {
      // Clear target if all targets are removed
      this.#targetToken = null;
    }

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
        || flags.refreshSize
        || flags.refreshRotation ) ) return;

    if ( (flags.refreshRotation || flags.refreshSize) && this.viewerLOS ) this.viewerLOS.dirty = true; // Force viewpoints to update.
    this.render();
  }

  /**
   * Delete this viewer.
   */
  destroy() {
    this._destroyed = true;
    this.deregisterHooks(); // First, so a later throw cannot leave hooks active.
    this.clearDebug();
    this._destroyDebugGraphics();
  }

  /* ----- Canvas graphics ----- */

  /**
   * Container to hold all canvas and viewpoint graphics.
   * @type {PIXI.Container}
   */
  #canvasDebugContainer;

  get canvasDebugContainer() {
    if ( !this.#debugGraphicsReady ) this._initializeDebugGraphics();
    return this.#canvasDebugContainer;
  }

  /**
   * Graphics container to display canvas graphics.
   * @type {PIXI.Graphics}
   */
  #canvasDebugGraphics;

  /**
   * Graphics to hold all viewpoint canvas graphics.
   * @type {PIXI.Container}
   */
  #viewpointDebugGraphics;

  /**
   * Draw class for drawing canvas graphics.
   * @type {Draw}
   */
  #debugCanvasDraw;

  /**
   * Draw class for drawing viewpoint graphics.
   * @type {Draw}
   */
  #debugViewpointDraw;

  #debugGraphicsReady = false;

  _initializeDebugGraphics() {
    if ( this.#debugGraphicsReady ) return;
    this._initializeCanvasDebugGraphics();
    this._initializeViewpointDebugGraphics();
    this.#debugGraphicsReady = true;
  }

  _initializeCanvasDebugGraphics() {
    if ( !this.#canvasDebugContainer ) {
      this.#canvasDebugContainer = new PIXI.Container();
      this.#canvasDebugContainer.eventMode = "passive"; // Allow targeting, selection to pass through.
      canvas.tokens.addChild(this.#canvasDebugContainer);
    }
    if ( !this.#canvasDebugGraphics ) {
      this.#canvasDebugGraphics = new PIXI.Graphics();
      this.#canvasDebugGraphics.eventMode = "passive"; // Allow targeting, selection to pass through.
      this.#canvasDebugContainer.addChild(this.#canvasDebugGraphics);
    }
    this.#debugCanvasDraw = new Draw(this.#canvasDebugGraphics);
  }

  _initializeViewpointDebugGraphics() {
    if ( !this.#viewpointDebugGraphics ) {
      this.#viewpointDebugGraphics = new PIXI.Graphics();
      this.#viewpointDebugGraphics.eventMode = "passive"; // Allow targeting, selection to pass through.
      this.canvasDebugContainer.addChild(this.#viewpointDebugGraphics);
    }
    this.#debugViewpointDraw = new Draw(this.#viewpointDebugGraphics);
  }

  _clearCanvasDebug() {
    if ( this.#debugCanvasDraw ) this.#debugCanvasDraw.clearDrawings();
    if ( this.#debugViewpointDraw ) this.#debugViewpointDraw.clearDrawings();
  }

  _destroyDebugGraphics() {
    if ( this.#canvasDebugContainer ) canvas.tokens?.removeChild(this.#canvasDebugContainer);
    this.#destroyCanvasDebugGraphics();
    this.#destroyViewpointDebugGraphics();
  }

  #destroyCanvasDebugGraphics() {
    if ( this.#canvasDebugContainer
      && !this.#canvasDebugContainer.destroyed ) this.#canvasDebugContainer.destroy({ children: false });
    if ( this.#canvasDebugGraphics
      && !this.#canvasDebugGraphics.destroyed ) this.#canvasDebugGraphics.destroy({ children: true });
    this.#canvasDebugContainer = undefined;
    this.#canvasDebugGraphics = undefined;
    this.#debugCanvasDraw = undefined;
    this.#debugGraphicsReady = false;
  }

  #destroyViewpointDebugGraphics() {
    if ( this.#viewpointDebugGraphics
      && !this.#viewpointDebugGraphics.destroyed ) this.#viewpointDebugGraphics.destroy({ children: true });
    this.#viewpointDebugGraphics = undefined;
    this.#debugViewpointDraw = undefined;
    this.#debugGraphicsReady = false;
  }

  /* ----- NOTE: Debug ----- */

  _drawCanvasDebug() {
    this._initializeDebugGraphics();
    this._clearCanvasDebug();
    this.viewerLOS._drawCanvasDebug(this.#debugCanvasDraw, this.#debugViewpointDraw);
  }

  clearDebug() {
    this._clearCanvasDebug();
  }
}

export class DebugVisibilityViewerWithPopoutAbstract extends DebugVisibilityViewerAbstract {
  /** @type {number} */
  static WIDTH = 400;

  /** @type {number} */
  static HEIGHT = 400;

  /** @type {class} */
  static popoutClass = Area3dPopoutCanvasV2;

  static CONTEXT_TYPE = "webgl2";

  /** @type {Promise|null} The in-flight openPopout call, shared by all callers. */
  _opening = null;

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
    // Defaults:
    // width: this.constructor.WIDTH,
    // height: this.constructor.HEIGHT + 100,
    // resizable: false
    });
  }

  get gl() { return this.popout.context; }

  async initialize() {
    return this.reinitialize(); // Async.
  }

  async reinitialize() {
    if ( this._destroyed || this.popoutIsRendered ) return;
    this._opening ??= this.openPopout().finally(() => { this._opening = null; });
    return this._opening;
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
    const visibleTextElem = this.popout.element.getElementsByTagName("p")[0];
    if ( !visibleTextElem ) return;
    const mode = this.moduleDMHandler ? this.detectionModeLabel : null;
    const modeText = mode ? ` \t [${mode}]` : "";
    visibleTextElem.textContent = `⏿ ${viewer?.name ?? ""} --> ◎ ${target?.name ?? "?"} \t ${Math.round(percentVisible * 100)}% visible${modeText}`;
  }

  render() {
    if ( this._destroyed ) return;

    // Wait while opening; the WebGL2 viewer builds its renderer inside openPopout.
    if ( this._opening || !this.popoutIsRendered ) return this.reinitialize().then(() => super.render());
    super.render();
  }

  updateDebugForPercentVisible(percentVisible) {
    this.updatePopoutFooter(percentVisible);
  }

  destroy() {
    const closing = this.popout?.close(); // Async; callers may await the return value.
    super.destroy();
    return closing;
  }
}

export class DebugVisibilityViewerArea3dPIXI extends DebugVisibilityViewerWithPopoutAbstract {
  /** @type {class} */
  static popoutClass = Area3dPopoutV2;

  /** @type {PIXI.Container} */
  #popoutContainers = [];

  get numViewpoints() { return this.viewerLOS?.viewpoints.length || 1; }

  get popoutStage() { return this.popout?.pixiApp?.stage; }

  _syncPopoutContainers() {
    const stage = this.popoutStage;
    if ( !this.popoutIsRendered || !stage ) return;
    if ( this.numViewpoints === this.#popoutContainers.length ) return;
    this._destroyPopout();
    this.popoutContainers.forEach(c => stage.addChild(c));
  }

  get popoutContainers() {
    if ( !this.#popoutContainers.length ) {
      const { WIDTH, HEIGHT } = this.constructor;

      // Divide in the popout space.
      const positions = [];
      let viewSize;
      switch ( this.numViewpoints ) {
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

        // Debug: console.debug(`Container at ${x},${y} with scale ${scale}, viewSize ${viewSize}, size ${size}.`);

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
      this.popoutGraphics.forEach(g => this.#popoutDraws.push(new Draw(g)));
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
    // Debuggin: console.log(`${this.viewerLOS.calculator.constructor.name}|_updatePercentVisibleLabel ${label.text}`);
  }

  algorithm = ENUMS.ALGORITHM_TYPES.WEBGL2;

  async openPopout(opts) {
    await super.openPopout(opts);
    const stage = this.popoutStage;
    if ( this._destroyed || !stage ) return;   // Destroyed (or closed) while opening.
    this.popoutContainers.forEach(c => stage.addChild(c));
  }

  updateDebugForPercentVisible(percentVisible) {
    this._syncPopoutContainers();
    let width = this.constructor.WIDTH;
    let height = this.constructor.HEIGHT;
    // Keep width and height even.
    switch ( this.numViewpoints ) {
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
      const draw = this.getPopoutDraw(idx);
      const container = this.getPopoutContainer(idx);
      vp._draw3dDebug(draw, { container, width, height });
    });
    super.updateDebugForPercentVisible(percentVisible);   // Footer text.
  }

  clearDebug() {
    super.clearDebug();
    this.#popoutDraws.forEach(d => d.clearDrawings());
  }

  _destroyPopout() {
    this.popoutStage?.removeChildren();
    this.popout.pixiApp.stage.removeChildren();
    this.#popoutGraphics.forEach(g => {
      if ( !g.destroyed ) g.destroy();
    });
    this.#popoutContainers.forEach(c => {
      if ( !c.destroyed ) c.destroy();
    });
    this.#popoutGraphics.length = 0;
    this.#popoutDraws.length = 0;
    this.#popoutContainers.length = 0;
  }

  destroy() {
    this._destroyed = true;
    this._destroyPopout();
    super.destroy();
  }
}


export class DebugVisibilityViewerPoints extends DebugVisibilityViewerArea3dPIXI {
  algorithm = ENUMS.ALGORITHM_TYPES.POINTS;
}

export class DebugVisibilityViewerPerPixel extends DebugVisibilityViewerArea3dPIXI {
  algorithm = ENUMS.ALGORITHM_TYPES.PER_PIXEL;
}

export class DebugVisibilityViewerGeometric extends DebugVisibilityViewerArea3dPIXI {
  algorithm = ENUMS.ALGORITHM_TYPES.GEOMETRIC;
}

export class DebugVisibilityViewerWebGL2 extends DebugVisibilityViewerWithPopoutAbstract {
  static CONTEXT_TYPE = "webgl2";

  /** @type {boolean} */
  debugView = true;

  get calculator() { return CONFIG[MODULE_ID].losCalculator; }

  get camera() { return this.calculator.camera; }

  async openPopout() {
    await super.openPopout();
    if ( this.renderer ) this.renderer.destroy();
    this.renderer = new LOSRendererWebGL2({
      camera: this.camera,
      webGL2: WebGL2.create(this.gl),
    });
    await this.renderer.initialize();
  }

  updateDebugForPercentVisible(percentVisible) {
    super.updateDebugForPercentVisible(percentVisible);
    const calc = this.viewerLOS.calculator;
    const renderer = this.renderer;

    log("\n");
    log("WebGL2Calc|Rendering Debug");
    const frames = this._canvasDimensionsForViewpoints();
    for ( let i = 0, iMax = this.viewerLOS.viewpoints.length; i < iMax; i += 1 ) {
      const vp = this.viewerLOS.viewpoints[i];
      calc.setView(vp);

      const frame = frames[i];
      const clear = i === 0;
      calc._render(renderer, { frame, clear, debug: true }); // Set debug: false to see what the calculator is doing.
    }
  }

  _clearPopoutCanvas() {
    const renderer = this.renderer;
    if ( !renderer?.ready ) return;
    renderer.unbindFramebuffer(); // Default framebuffer, which is the popout canvas.
    renderer.clear();
  }

  _canvasDimensionsForViewpoints() {
    let { width, height } = this.popout.canvas;
    // Does not work as expected: const dpr = window.devicePixelRatio;

    // gl.viewport is from bottom 0, 0.
    const w_1_2 = width * 0.5;
    const h_1_2 = height * 0.5;
    const w_1_3 = width * 1/3;
    const h_1_3 = height * 1/3;
    const w_2_3 = width * 2/3;
    const h_2_3 = height * 2/3;


    switch ( this.viewerLOS.viewpoints.length ) { /* eslint-disable no-multi-spaces */
      case 1: return [new PIXI.Rectangle(0, 0, width, height)];

      // ----- | -----
      case 2: return [
        new PIXI.Rectangle(0,     0, w_1_2, h_1_2),
        new PIXI.Rectangle(w_1_2, 0, w_1_2, h_1_2),
      ];

      //     -----
      // ----- | -----
      case 3: return [
        new PIXI.Rectangle(w_1_3, h_1_2, w_1_2, h_1_2),
        new PIXI.Rectangle(w_1_2, 0,     w_1_2, h_1_2),
        new PIXI.Rectangle(0, 0,     w_1_2, h_1_2),
      ];

      // ----- | -----
      // ----- | -----
      case 4: return [
        new PIXI.Rectangle(0,     0,     w_1_2, h_1_2),
        new PIXI.Rectangle(w_1_2, 0,     w_1_2, h_1_2),
        new PIXI.Rectangle(0,     h_1_2, w_1_2, h_1_2),
        new PIXI.Rectangle(w_1_2, h_1_2, w_1_2, h_1_2),
      ];

      //  ----- | -----
      // --- | --- | ---
      case 5: return [
        new PIXI.Rectangle(w_1_3 * 0.5,           h_1_2, w_1_3, h_1_2),
        new PIXI.Rectangle(w_2_3 - (w_1_3 * 0.5), h_1_2, w_1_3, h_1_2),

        new PIXI.Rectangle(0,     0, w_1_3, h_1_2),
        new PIXI.Rectangle(w_1_3, 0, w_1_3, h_1_2),
        new PIXI.Rectangle(w_2_3, 0, w_1_3, h_1_2),
      ];

      // --- | --- | ---
      // --- | --- | ---
      case 6: return [
        new PIXI.Rectangle(0,     0, w_1_3, h_1_2),
        new PIXI.Rectangle(w_1_3, 0, w_1_3, h_1_2),
        new PIXI.Rectangle(w_2_3, 0, w_1_3, h_1_2),

        new PIXI.Rectangle(0,     h_1_2, w_1_3, h_1_2),
        new PIXI.Rectangle(w_1_3, h_1_2, w_1_3, h_1_2),
        new PIXI.Rectangle(w_2_3, h_1_2, w_1_3, h_1_2),
      ];

      // --- | --- | ---
      //     | --- |
      // --- | --- | ---
      case 7:
        return [
          new PIXI.Rectangle(0,     0, w_1_3, h_1_3),
          new PIXI.Rectangle(w_1_3, 0, w_1_3, h_1_3),
          new PIXI.Rectangle(w_2_3, 0, w_1_3, h_1_3),

          new PIXI.Rectangle(w_1_3, h_1_3, w_1_3, h_1_3),

          new PIXI.Rectangle(0,     h_2_3, w_1_3, h_1_3),
          new PIXI.Rectangle(w_1_3, h_2_3, w_1_3, h_1_3),
          new PIXI.Rectangle(w_2_3, h_2_3, w_1_3, h_1_3),
        ];

      // --- | --- | ---
      // --- |     | ---
      // --- | --- | ---
      case 8: return [
        new PIXI.Rectangle(0,     0, w_1_3, h_1_3),
        new PIXI.Rectangle(w_1_3, 0, w_1_3, h_1_3),
        new PIXI.Rectangle(w_2_3, 0, w_1_3, h_1_3),

        new PIXI.Rectangle(0,     h_1_3, w_1_3, h_1_3),
        new PIXI.Rectangle(w_2_3, h_1_3, w_1_3, h_1_3),

        new PIXI.Rectangle(0,     h_2_3, w_1_3, h_1_3),
        new PIXI.Rectangle(w_1_3, h_2_3, w_1_3, h_1_3),
        new PIXI.Rectangle(w_2_3, h_2_3, w_1_3, h_1_3),

      ];

      // --- | --- | ---
      // --- | --- | ---
      // --- | --- | ---
      case 9:
      default: return [
        new PIXI.Rectangle(0,     0, w_1_3, h_1_3),
        new PIXI.Rectangle(w_1_3, 0, w_1_3, h_1_3),
        new PIXI.Rectangle(w_2_3, 0, w_1_3, h_1_3),

        new PIXI.Rectangle(0,     h_1_3, w_1_3, h_1_3),
        new PIXI.Rectangle(w_1_3, h_1_3, w_1_3, h_1_3),
        new PIXI.Rectangle(w_2_3, h_1_3, w_1_3, h_1_3),

        new PIXI.Rectangle(0,     h_2_3, w_1_3, h_1_3),
        new PIXI.Rectangle(w_1_3, h_2_3, w_1_3, h_1_3),
        new PIXI.Rectangle(w_2_3, h_2_3, w_1_3, h_1_3),
      ];
    } /* eslint-enable no-multi-spaces */
  }

  destroy() {
    if ( this.renderer ) {
      this.renderer?.webGL2.destroy();
      this.renderer.destroy();
      this.renderer = undefined;
    }
    super.destroy();
  }
}
