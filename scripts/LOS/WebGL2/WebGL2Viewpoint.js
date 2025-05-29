/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";
import { RedPixelCounter } from "./RedPixelCounter.js";
import * as twgl from "./twgl.js";

// Base folder
import { MODULE_ID } from "../../const.js";

// LOS folder
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { PercentVisibleRenderCalculatorAbstract } from "../PercentVisibleCalculator.js";
import { DebugVisibilityViewerWithPopoutAbstract } from "../DebugVisibilityViewer.js";
import { checkFramebufferStatus } from "../util.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class WebGL2Viewpoint extends AbstractViewpoint {
  static get calcClass() { return PercentVisibleCalculatorWebGL2; }
}

export class PercentVisibleCalculatorWebGL2 extends PercentVisibleRenderCalculatorAbstract {
  static get viewpointClass() { return WebGL2Viewpoint; }

  static defaultConfiguration = {
    ...PercentVisibleRenderCalculatorAbstract.defaultConfiguration,
    alphaThreshold: 0.75,
    useInstancing: false,
  };

  /** @type {number} */
  static WIDTH = 128;

  /** @type {number} */
  static HEIGHT = 128;

  /** @type {Uint8Array} */
  bufferData;

  /** @type {OffscreenCanvas} */
  static glCanvas;

  /** @type {WebGL2Context} */
  gl;

  /** @type {RedPixelCounter} */

  constructor(opts) {
    super(opts);
    const { WIDTH, HEIGHT } = this.constructor;
    this.constructor.glCanvas ??= new OffscreenCanvas(WIDTH, HEIGHT);
    const gl = this.gl = this.constructor.glCanvas.getContext("webgl2");
    this.bufferData = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
    this.redPixelCounter = new RedPixelCounter(this.gl); // Width and heigh tset later
  }

  /** @type {RenderObstaclesWebGL2} */
  renderObstacles;

  #initialized = false;

  async initialize() {
    if ( this.#initialized ) return;
    this.#initialized = true; // Avoids async issues if saved right away.
    await super.initialize();
    const gl = this.gl;
    const size = this.renderTextureSize;
    this.renderObstacles = new RenderObstaclesWebGL2({ gl, senseType: this.config.senseType });
    await this.renderObstacles.initialize();
    this._initializeFramebuffer();
    this.redPixelCounter.initialize(size, size);
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

  _redPixels = 0;

  _redBlockedPixels = 0;

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    // TODO: Fix using a stencil with renderTexture
    const { useStencil, useRenderTexture, pixelCounterType } = CONFIG[MODULE_ID];
    const gl = this.gl;
    this.renderObstacles.prerender();
    let res;
    if ( useRenderTexture ) {
      const { fbInfo, frame } = this;
      twgl.bindFramebufferInfo(gl, fbInfo);
      this.renderObstacles.renderTarget(viewerLocation, target, { targetLocation, useStencil, clear: true, frame});
      this.renderObstacles.renderObstacles(viewerLocation, target, { viewer, targetLocation, useStencil, clear: false, frame });
      res = this.redPixelCounter[pixelCounterType](this.renderTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.renderObstacles.renderTarget(viewerLocation, target, { targetLocation, useStencil, clear: true });
      this.renderObstacles.renderObstacles(viewerLocation, target, { viewer, targetLocation, useStencil, clear: false });
      res = this.redPixelCounter.readPixelsCount();
    }
    this._redPixels = res.red;
    this._redBlockedPixels = res.redBlocked;
    // console.log(`${this.constructor.name}|_calculatePercentVisible`, res);
  }

  async _calculatePercentVisibleAsync (viewer, target, viewerLocation, targetLocation) {
    // TODO: Fix using a stencil with renderTexture
    const { useStencil, useRenderTexture, pixelCounterType } = CONFIG[MODULE_ID];
    const gl = this.gl;
    this.renderObstacles.prerender();
    let res;
    if ( useRenderTexture ) {
      const { fbInfo, frame } = this;
      twgl.bindFramebufferInfo(gl, fbInfo);
      this.renderObstacles.renderTarget(viewerLocation, target, { targetLocation, useStencil, clear: true, frame });
      this.renderObstacles.renderObstacles(viewerLocation, target, { viewer, targetLocation, useStencil, clear: false, frame });
      res = await this.redPixelCounter[`${pixelCounterType}Async`](this.renderTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.renderObstacles.renderTarget(viewerLocation, target, { viewer, targetLocation, useStencil, clear: true });
      this.renderObstacles.renderObstacles(viewerLocation, target, { viewer, targetLocation, useStencil, clear: false });
      res = await this.redPixelCounter.readPixelsCountAsync();
    }
    this._redPixels = res.red;
    this._redBlockedPixels = res.redBlocked;
    // console.log(`${this.constructor.name}|_calculatePercentVisibleAsync`, res);
  }

  /**
   * Grid shape area centered on the target as seen from the viewer location.
   * Used to determine the minimum area needed (denominator) for the largeTarget option.
   * Called after _calculatePercentVisible.
   * @returns {number}
   */
  _gridShapeArea(viewer, target, viewerLocation, targetLocation) {
    const { useRenderTexture, pixelCounterType } = CONFIG[MODULE_ID];
    const gl = this.gl;
    let res;
    if ( useRenderTexture ) {
      const { fbInfo, frame } = this;
      twgl.bindFramebufferInfo(gl, fbInfo);
      this.renderObstacles.renderGridShape(viewerLocation, target, { targetLocation, frame });
      res = this.redPixelCounter[pixelCounterType](this.renderTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.renderObstacles.renderGridShape(viewerLocation, target, { viewer, targetLocation });
      res = this.redPixelCounter.readPixelsCount();
    }
    return res.red;
  }

  async _gridShapeAreaAsync(viewer, target, viewerLocation, targetLocation) {
    const { useRenderTexture, pixelCounterType } = CONFIG[MODULE_ID];
    const gl = this.gl;
    let res;
    if ( useRenderTexture ) {
      const { fbInfo, frame } = this;
      twgl.bindFramebufferInfo(gl, fbInfo);
      this.renderObstacles.renderGridShape(viewerLocation, target, { targetLocation, frame });
      res = await this.redPixelCounter[`${pixelCounterType}Async`](this.renderTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.renderObstacles.renderGridShape(viewerLocation, target, { viewer, targetLocation });
      res = await this.redPixelCounter.readPixelsCountAsync();
    }
    return res.red;
  }

  /**
   * Constrained target area, counting both lit and unlit portions of the target.
   * Used to determine the total area (denominator) when useLitTarget config is set.
   * Called after _calculatePercentVisible.
   * @returns {number}
   */
  _constrainedTargetArea(viewer, target, viewerLocation, targetLocation) {
    const { useRenderTexture, pixelCounterType } = CONFIG[MODULE_ID];
    const gl = this.gl;
    let res;
    if ( useRenderTexture ) {
      const { fbInfo, frame } = this;
      twgl.bindFramebufferInfo(gl, fbInfo);
      this.renderObstacles.renderTarget(viewerLocation, target, { targetLocation, frame });
      res = this.redPixelCounter[pixelCounterType](this.renderTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.renderObstacles.renderTarget(viewerLocation, target, { targetLocation });
      res = this.redPixelCounter.readPixelsCount();
    }
    return res.red;
  }

  async constrainedTargetArea(viewer, target, viewerLocation, targetLocation) {
    const { useRenderTexture, pixelCounterType } = CONFIG[MODULE_ID];
    const gl = this.gl;
    let res;
    if ( useRenderTexture ) {
      const { fbInfo, frame } = this;
      twgl.bindFramebufferInfo(gl, fbInfo);
      this.renderObstacles.renderTarget(viewerLocation, target, { targetLocation, frame });
      res = await this.redPixelCounter[`${pixelCounterType}Async`](this.renderTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.renderObstacles.renderTarget(viewerLocation, target, { targetLocation });
      res = await this.redPixelCounter.readPixelsCountAsync();
    }
    return res.red;
  }

  _viewableTargetArea(_viewer, _target, _viewerLocation, _targetLocation) {
    return this._redPixels - this._redBlockedPixels;
  }

  _totalTargetArea(_viewer, _target, _viewerLocation, _targetLocation) { return this._redPixels; }

  destroy() {
    super.destroy();
    this.renderObstacles.destroy();
  }
}

export class DebugVisibilityViewerWebGL2 extends DebugVisibilityViewerWithPopoutAbstract {
  static viewpointClass = WebGL2Viewpoint;

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
    this.renderer = new RenderObstaclesWebGL2({
      senseType: this.viewerLOS.config.senseType,
      debugViewNormals: this.debugView,
      gl: this.gl,
    });
    await this.renderer.initialize();
  }

  updateDebugForPercentVisible(percentVisible) {
    super.updateDebugForPercentVisible(percentVisible);
    this.renderer.prerender();
    // TODO: Handle multiple viewpoints.

    const frames = this._canvasDimensionsForViewpoints();
    for ( let i = 0, iMax = this.viewerLOS.viewpoints.length; i < iMax; i += 1 ) {
      const { viewer, target, viewpoint: viewerLocation, targetLocation } = this.viewerLOS.viewpoints[i];
      const frame = frames[i];
      const clear = i === 0;
      this.renderer.renderTarget(viewerLocation, target, { targetLocation, frame, clear });
      this.renderer.renderObstacles(viewerLocation, target, { viewer, targetLocation, frame });
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
