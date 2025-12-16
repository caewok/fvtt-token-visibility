/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// WebGL2 folder
import { WebGL2 } from "../WebGL2/WebGL2.js";
import { RenderObstaclesWebGL2 } from "../WebGL2/RenderObstacles.js";
import { RedPixelCounter } from "../WebGL2/RedPixelCounter.js";
import * as twgl from "../WebGL2/twgl.js";

// LOS folder
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerWithPopoutAbstract } from "../DebugVisibilityViewer.js";
import { checkFramebufferStatus, log } from "../util.js";

// Base folder
import { MODULE_ID } from "../../const.js";

/**
 * @typedef {object} WebGL2CalculatorConfig
 * ...{CalculatorConfig}
 * @property {number} alphaThreshold                    Threshold value for testing alpha of tiles
 * @property {boolean} useInstancing                    Use instancing with webGL2
 */


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
    if ( this.data.blocked ) out.data.blocked.and(other.data.target);
    if ( this.data.blockedCount != null ) out.data.blockedCount = Math.min(this.data.blockedCount, other.data.blockedCount);
    if ( this.data.targetCount != null ) out.data.blockedCount = Math.max(this.data.targetCount, other.data.targetCount);
    return out;
  }
}


export class PercentVisibleCalculatorWebGL2 extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisibleWebGL2Result;

  static defaultConfiguration = {
    ...super.defaultConfiguration,
    alphaThreshold: 0.75,
  };

  /** @type {number} */
  static WIDTH = 128;

  /** @type {number} */
  static HEIGHT = 128;

  /** @type {Uint8Array} */
  bufferData;

  /** @type {OffscreenCanvas} */
  static glCanvas;

  /** @type {WebGL2} */
  static webGL2;

  /** @type {WebGL2Context} */
  get gl() { return this.constructor.webGL2.gl; };

  /** @type {RedPixelCounter} */

  constructor(opts) {
    super(opts);
    const { WIDTH, HEIGHT } = this.constructor;
    this.constructor.glCanvas ??= new OffscreenCanvas(WIDTH, HEIGHT);
    const webGL2 = this.constructor.webGL2 ??= new WebGL2(this.constructor.glCanvas.getContext("webgl2"));
    const gl = this.gl;
    this.bufferData = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    this.redPixelCounter = new RedPixelCounter(webGL2); // Width and heigh tset later
  }

  /** @type {RenderObstaclesWebGL2} */
  renderer;

  #initialized = false;

  async initialize() {
    if ( this.#initialized ) return;
    await super.initialize();
    const size = this.renderTextureSize;
    this.renderer = new RenderObstaclesWebGL2({ webGL2: this.constructor.webGL2, senseType: this.config.senseType });
    await this.renderer.initialize();
    this._initializeFramebuffer();
    this.redPixelCounter.initialize(size, size);
    this.#initialized = true;
  }

  /** @type {twgl.FramebufferInfo} */
  fbInfo;

  /** @type {PIXI.Rectangle} */
  frame = new PIXI.Rectangle();

  get renderTexture() { return this.fbInfo.attachments[0]; }

  // TODO: It might be beneficial to use differing width/heights for wide or tall targets.
  //       But, to avoid a lot of work at render, would need to construct multiple FBs at different aspect ratios.
  //       E.g., 2x1, 1x2, 3x1, 1x3, 3x2, 2x3.
  //       Upside would be a better fit to the camera. But would be complex and require fixing the camera target frustum function.
  // Width and height of the render texture.
  #renderTextureSize = 0;

  get renderTextureSize() {
    if ( !this.#renderTextureSize ) this.#renderTextureSize = CONFIG[MODULE_ID].renderTextureSize;
    return this.#renderTextureSize;
  }

  set renderTextureSize(value) {
    if ( this.#renderTextureSize === value ) return;
    this.#renderTextureSize = value;
    if ( this.fbInfo ) this._initializeFramebuffer();
    this.redPixelCounter.initialize(value, value);
  }

  /**
   * Initialize all required framebuffers.
   */
  _initializeFramebuffer() {
    const gl = this.gl;
    const width = this.renderTextureSize;
    const height = width;
    this.frame.width = width;
    this.frame.height = height;

    this.fbInfo = twgl.createFramebufferInfo(gl, [
      {
        internalFormat: gl.RGBA,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
      },
      {
        format: gl.DEPTH_STENCIL
      }
    ], width, height);

    // Check if framebuffer is complete.
    checkFramebufferStatus(this.gl, this.fbInfo.framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  static nonRTCountTypes = new Set([])

  _calculate() {
    const result = super._calculate(); // Test radius between viewpoint and target.
    if ( result.visibility === PercentVisibleResult.VISIBILITY.NONE ) return result; // Outside of radius.
    if ( !this.#initialized ) return result.makeFullyNotVisible();
    result.visibility = PercentVisibleResult.VISIBILITY.MEASURED;

    this.renderer.prerender();
    const { viewpoint, target, targetLocation } = this;
    const { useRenderTexture, pixelCounterType } = CONFIG[MODULE_ID];
    const gl = this.gl;
    let res;
    log("\n");
    log("WebGL2Calc|Rendering For Calculation");
    this.renderer.setCamera(viewpoint, target, { targetLocation });

    if ( useRenderTexture ) {
      const { fbInfo, frame } = this;
      twgl.bindFramebufferInfo(gl, fbInfo);
      this._renderTarget({ frame });
      this._renderObstacles({ frame });
      res = this.redPixelCounter[pixelCounterType](this.renderTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._renderTarget();
      this._renderObstacles();
      const type = pixelCounterType === "readPixelsCount" || pixelCounterType === "readPixelsCount2"
        ? pixelCounterType : "readPixelsCount" ;
      res = this.redPixelCounter[type]();
    }

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

  /**
   * Render the target.
   * Assumes camera has been set for the renderer.
   * Assumes prerender has already been done.
   * Clears the prior render, if any.
   * @param {PIXI.Rectangle} [frame]        Dimensions in which to draw the target
   */
  _renderTarget(opts = {}, renderer = this.renderer) {
    opts.clear ??= true;
    opts.useStencil = CONFIG[MODULE_ID].useStencil;
    renderer.renderTarget(this.target, opts);
  }

  /**
   * Render all obstacles within the viewable frustum.
   * Assumes camera has been set for the renderer.
   * Assumes prerender has already been done.
   * @param {PIXI.Rectangle} [frame]        Dimensions in which to draw the obstacles
   */
  _renderObstacles(opts = {}, renderer = this.renderer) {
    opts.viewer = this.viewer;
    opts.clear = false;
    opts.useStencil = CONFIG[MODULE_ID].useStencil;
    const { walls, terrainWalls, proximateWalls, reverseProximateWalls, tokens, tiles, regions } = this.occlusionTester.obstacles;
    renderer.renderObstacles(this.viewpoint, this.target, opts);
  }

  /**
   * Constrained target area, counting both lit and unlit portions of the target.
   * Used to determine the total area (denominator) when useLitTarget config is set.
   * Called after _calculatePercentVisible.
   * @returns {number}
   */
//   _constrainedTargetArea(viewer, target, viewpoint, targetLocation) {
//     const { useRenderTexture, pixelCounterType } = CONFIG[MODULE_ID];
//     const gl = this.gl;
//     let res;
//     const redOnly = true;
//     if ( useRenderTexture ) {
//       const { fbInfo, frame } = this;
//       twgl.bindFramebufferInfo(gl, fbInfo);
//       this.renderer.renderTarget(viewpoint, target, { targetLocation, frame });
//       res = this.redPixelCounter[pixelCounterType](this.renderTexture, redOnly);
//       gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//     } else {
//       const type = pixelCounterType === "readPixelsCount" || pixelCounterType === "readPixelsCount2" ? pixelCounterType : "readPixelsCount" ;
//       gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//       this.renderer.renderTarget(viewpoint, target, { targetLocation });
//       res = this.redPixelCounter[type](undefined, redOnly);
//     }
//     return res.red;
//   }

//   async constrainedTargetArea(viewer, target, viewpoint, targetLocation) {
//     const { useRenderTexture, pixelCounterType } = CONFIG[MODULE_ID];
//     const gl = this.gl;
//     let res;
//     const redOnly = true;
//     if ( useRenderTexture ) {
//       const { fbInfo, frame } = this;
//       twgl.bindFramebufferInfo(gl, fbInfo);
//       this.renderer.renderTarget(viewpoint, target, { targetLocation, frame });
//       res = await this.redPixelCounter[`${pixelCounterType}Async`](this.renderTexture, redOnly);
//       gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//     } else {
//       const type = pixelCounterType === "readPixelsCount" || pixelCounterType === "readPixelsCount2" ? pixelCounterType : "readPixelsCount" ;
//       gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//       this.renderer.renderTarget(viewpoint, target, { targetLocation });
//       res = await this.redPixelCounter[`${type}Async`](undefined, redOnly);
//     }
//     return res.red;
//   }

  destroy() {
    super.destroy();
    this.renderer.destroy();
  }
}

export class DebugVisibilityViewerWebGL2 extends DebugVisibilityViewerWithPopoutAbstract {
  static CONTEXT_TYPE = "webgl2";

  /** @type {boolean} */
  debugView = true;

  constructor(opts = {}) {
    super(opts);
    this.debugView = opts.debugView ?? true;
  }

  async openPopout() {
    await super.openPopout();
    if ( this.renderer ) this.renderer.destroy();
    const webGL2 = new WebGL2(this.gl);
    this.renderer = new RenderObstaclesWebGL2({
      senseType: this.viewerLOS?.config.senseType ?? "sight",
      debugViewNormals: this.debugView,
      webGL2,
    });
    await this.renderer.initialize();
  }

  updateDebugForPercentVisible(percentVisible) {
    this.renderer.config = { senseType: this.viewerLOS?.config.senseType ?? "sight" };
    const calc = this.viewerLOS.calculator;

    super.updateDebugForPercentVisible(percentVisible);
    this.renderer.prerender();

    log("\n");
    log("WebGL2Calc|Rendering Debug");
    const frames = this._canvasDimensionsForViewpoints();
    for ( let i = 0, iMax = this.viewerLOS.viewpoints.length; i < iMax; i += 1 ) {
      const { viewer, target, viewpoint, targetLocation } = this.viewerLOS.viewpoints[i];
      const frame = frames[i];
      const clear = i === 0;

      calc.initializeView({ viewer, target, viewpoint, targetLocation });
      calc._initializeCalculation();
      this.renderer.setCamera(viewpoint, target, { targetLocation });
      calc._renderTarget({ frame, clear }, this.renderer);
      calc._renderObstacles({ frame }, this.renderer);
    }
  }

  // Same as calculator.
  _renderTarget(opts = {}) {
    opts.clear ??= true;
    this.renderer.renderTarget(this.target, opts);
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
