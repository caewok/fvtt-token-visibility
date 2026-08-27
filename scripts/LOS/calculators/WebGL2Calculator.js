/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// WebGL2 folder
import { WebGL2 } from "../WebGL2/WebGL2.js";
import { LOSRendererWebGL2 } from "../WebGL2/LOSRendererWebGL2.js";
import { RedPixelCounter } from "../WebGL2/RedPixelCounter.js";

// LOS folder
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerWithPopoutAbstract } from "../DebugVisibilityViewer.js";
import { log } from "../util.js";

// Base folder
import { MODULE_ID } from "../../const.js";


export class PercentVisibleWebGL2Result extends PercentVisibleResult {

  data = {
    blocked: null,
    target: null,
    blockedCount: null,
    targetCount: null,
  };

  logData() {
    console.log(`Total Blocked: ${this.data.blockedCount}\tTotal Target: ${this.data.targetCount}`)
    console.table({
      blocked: this.data.blocked.map(bs => bs?.cardinality),
      target: this.data.target.map(bs => bs?.cardinality),
    });
  }

  clone() {
    const out = super.clone();
    for ( let i = 0, iMax = this.data.blocked.length; i < iMax; i += 1 ) {
      if ( !this.data.blocked[i] ) continue;
      out.data.blocked[i] = this.data.blocked[i].clone();
      out.data.target[i] = this.data.target[i].clone();
      // blockedCount, targetCount should have already been cloned.
    }
    return out;
  }

  get totalTargetArea() {
    return this.data.targetCount ?? (this.data.target.cardinality || 0);
  }

  get blockedArea() {
    return this.data.blockedCount ?? (this.data.blocked.cardinality || 0);
  }

  // Handled by the calculator, which combines multiple results.
  get largeTargetArea() { return this.totalTargetArea; }

  get visibleArea() { return this.targetArea - this.blockedArea; }

  /**
   * Blend this result with another result, taking the maximum values at each test location.
   * Used to treat viewpoints as "eyes" in which 2+ viewpoints are combined to view an object.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMaximize(other) {
    let out = super.blendMaximize();
    if ( out ) return out;

    // The target area could change, given the different views.
    // Combine the visible target paths.
    out = this.clone();
    if ( this.data.target ) out.data.target.or(other.data.target);
    if ( this.data.blocked ) out.data.blocked.and(other.data.blocked);
    if ( this.data.blockedCount != null ) out.data.blockedCount = Math.min(this.data.blockedCount, other.data.blockedCount);
    if ( this.data.targetCount != null ) out.data.targetCount = Math.max(this.data.targetCount, other.data.targetCount);
    return out;
  }
}

export class PercentVisibleCalculatorWebGL2 extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisibleWebGL2Result;



  /** @type {WebGL2} */
  static webGL2;

  /** @type {WebGL2Context} */
  get gl() { return this.constructor.webGL2.gl; };

  /** @type {LOSRendererWebGL2} */
  get renderer() { return this.constructor.defaultRenderer; };

  /** @type {RedPixelCounter} */
  get redPixelCounter() { return this.constructor.redPixelCounter; }

  constructor(opts) {
    super(opts);


    // Fix the camera values.
    this.camera.UP = this.camera.constructor.UP;
    this.camera.mirrorM = this.camera.constructor.MIRRORM_DIAG;

    this.constructor.createOffscreenCanvas();

     // Create the renderer and related objects, as needed.
    this.constructor.createDefaultRenderer(this.camera);
  }

  // ----- NOTE: Default Renderer ----- //

  /** @type {OffscreenCanvas} */
  static glCanvas;

  /** @type {RedPixelCounter} */
  static redPixelCounter;

  static createOffscreenCanvas() {
    if ( !this.glCanvas ) {
      const size = CONFIG[MODULE_ID].renderTextureSize || 128;
      this.glCanvas ??= new OffscreenCanvas(size, size);
    }
  }

  static createDefaultRenderer(camera) {
    if ( this.defaultRenderer ) return;
    if ( !this.glCanvas ) this.createOffscreenCanvas();
    const gl = this.glCanvas.getContext("webgl2");
    const webGL2 = WebGL2.create(gl);
    this.defaultRenderer = new LOSRendererWebGL2({ webGL2, camera });
    this.redPixelCounter = new RedPixelCounter(webGL2);
  }

  // ----- NOTE: Initialize ----- //

  #initialized = false;

  async initialize() {
    if ( this.#initialized ) return;
    await super.initialize();

    const size = CONFIG[MODULE_ID].renderTextureSize || 128;
    await this.renderer.initialize();
    this.redPixelCounter.initialize(size, size);
    this.#initialized = true;
  }

  /**
   * Render the current view from the viewer.
   * Used both for calculation and debugging views.
   * @param {LOSRendererWebGL2}
   * @param {object} [opts]       Options passed to the renderer
   */
  _render(renderer, opts) {
    console.debug(`WebGL2Calc|Rendering`)
    renderer ??= this.renderer;
    renderer.camera = this.camera;
    renderer.updateCameraBuffer();
    renderer.prerender(this.targetShape, this.occlusionTester);
    renderer.render(opts);
  }


  _calculate() {
    const result = super._calculate(); // Test radius between viewpoint and target.
    if ( result.visibility === PercentVisibleResult.VISIBILITY.NONE ) return result; // Outside of radius.
    if ( !this.#initialized ) return result.makeFullyNotVisible();
    result.visibility = PercentVisibleResult.VISIBILITY.MEASURED;

    // Render the target and obstacles.
    this.renderer.bindFramebuffer();
    this._render(this.renderer);

    // Calculate the resulting area of the target and target with obstacles.
    const pixelCounterType = CONFIG[MODULE_ID].pixelCounterType
    const res = this.redPixelCounter[pixelCounterType](this.renderer.renderTexture); // RT may be null.
    this.renderer.unbindFramebuffer();

    const lastResult = this._createResult();
    if ( pixelCounterType.startsWith("map") ) {
      lastResult.data.blocked = res.redBlocked;
      lastResult.data.target = res.red;
    } else {
      lastResult.data.blockedCount = res.redBlocked;
      lastResult.data.targetCount = res.red
    }
    return lastResult;
  }

  _drawCanvasDebug(result, debugDraw, otOpts = {}) {
    otOpts.tileSubtype ??= "boundarySubtype";
    otOpts.levelSubtype ??= "boundarySubtype";
    super._drawCanvasDebug(result, debugDraw, otOpts);
  }

  static destroy() {
    this.renderer.destroy();
  }
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

  _canvasDimensionsForViewpoints() {
    let { width, height } = this.popout.canvas;
     // const dpr = window.devicePixelRatio; // Does not work as expected.

    // gl.viewport is from bottom 0, 0.
    const w_1_2 = width * 0.5;
    const h_1_2 = height * 0.5;
    const w_1_3 = width * 1/3;
    const h_1_3 = height * 1/3;
    const w_2_3 = width * 2/3;
    const h_2_3 = height * 2/3;

    switch ( this.viewerLOS.viewpoints.length ) {
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
        new PIXI.Rectangle(w_2_3, 0,     w_1_2, h_1_2),
        new PIXI.Rectangle(w_1_2, 0,     w_1_2, h_1_2),
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
        new PIXI.Rectangle(w_1_3 * 0.5,           h_2_3, w_1_3, h_1_3),
        new PIXI.Rectangle(w_2_3 - (w_1_3 * 0.5), h_2_3, w_1_3, h_1_3),

        new PIXI.Rectangle(0,     0, w_1_3, h_1_3),
        new PIXI.Rectangle(w_1_3, 0, w_1_3, h_1_3),
        new PIXI.Rectangle(w_2_3, 0, w_1_3, h_1_3),
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
      case 9: return [
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
    }
  }

  destroy() {
    if ( this.renderer ) this.renderer.destroy();
    super.destroy();
  }
}
