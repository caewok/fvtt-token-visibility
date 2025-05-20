/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";
import { readPixelsAsync } from "./read_pixels_async.js";

// Base folder

// LOS folder
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { PercentVisibleRenderCalculatorAbstract } from "../PercentVisibleCalculator.js";
import { DebugVisibilityViewerWithPopoutAbstract } from "../DebugVisibilityViewer.js";

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

  constructor(opts) {
    super(opts);
    const { WIDTH, HEIGHT } = this.constructor;
    this.constructor.glCanvas ??= new OffscreenCanvas(WIDTH, HEIGHT);
    const gl = this.gl = this.constructor.glCanvas.getContext("webgl2");
    this.bufferData = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  }

  /** @type {RenderObstaclesWebGL2} */
  renderObstacles;

  async initialize() {
    const gl = this.gl;
    this.renderObstacles = new RenderObstaclesWebGL2({ gl, senseType: this.config.senseType });
    await this.renderObstacles.initialize();
    this._initializeFramebuffers();
  }

  /** @type {object} */
  // TODO: Stencil buffer options?
  framebuffers = {
    render: {
      frame = null, /** @type {WebGLFramebuffer} */
      depth = null, /** @type {WebGLRenderbuffer} */
      texture = null, /** @type {WebGLTexture} */
    },
    targetShape: {
      frame = null, /** @type {WebGLFramebuffer} */
      depth = null, /** @type {WebGLRenderbuffer} */
      texture = null, /** @type {WebGLTexture} */
    },
    gridShape: {
      frame = null, /** @type {WebGLFramebuffer} */
      depth = null, /** @type {WebGLRenderbuffer} */
      texture = null, /** @type {WebGLTexture} */
    }
  };

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
    if ( this.buffers.frame ) this._initializeFramebuffers();
  }

  /**
   * Initialize all required framebuffers.
   */
  _initializeFramebuffers() {
    this._initializeFramebuffer("render");
    this._initializeFramebuffer("targetShape");
    this._initializeFramebuffer("gridShape");
  }

  /**
   * Initialize the framebuffer and associated depth and stencil buffers.
   */
  _initializeFramebuffer(type = "render") {
    const gl = this.gl;
    const width = height = this.renderTextureSize;
    const fbo = this.framebuffers[type];

    if ( fbo.frame ) fbo.frame.destroy();
    if ( fbo.depth ) fbo.depth.destroy();
    if ( fbo.texture ) fbo.texture.destroy();

    // Create and bind the framebuffer.
    fbo.frame = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.frame);

    // Create and bind the texture.
    fbo.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fbo.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Create and bind the depth buffer.
    fbo.depth = gl.createRenderBuffer();
    gl.bindRenderBuffer(gl.RENDERBUFFER, fbo.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENTS, width, height);

    // TODO: Add second framebuffer to handle depth + stencil.

    // Attach the texture and depth buffer to the framebuffer.
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbo.texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fbo.depth);

    // Check if framebuffer is complete.
    if ( gl.checkFramebufferStatus(gl.FRAMEBUFFER !== gl.FRAMEBUFFER_COMPLETE) ) console.error("Framebuffer incomplete!");

    // Unbind the framebuffer.
     gl.bindFramebuffer(gl.FRAMEBUFFER, null);
     gl.bindTexture(gl.TEXTURE_2D, null);
     gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  _redPixels = 0;

  _redBlockedPixels = 0;

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
    const res = this._countRedBlockedPixels();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._redPixels = res.countRed;
    this._redBlockedPixels = res.countRedBlocked;
  }

  async _calculatePercentVisibleAsync (viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.prerender();
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
    const res = await this._countRedBlockedPixelsAsync();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._redPixels = res.countRed;
    this._redBlockedPixels = res.countRedBlocked;
  }

  /**
   * Grid shape area centered on the target as seen from the viewer location.
   * Used to determine the minimum area needed (denominator) for the largeTarget option.
   * Called after _calculatePercentVisible.
   * @returns {number}
   */
  _gridShapeArea(viewer, target, viewerLocation, targetLocation) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderObstacles.renderGridShape(viewerLocation, target, { viewer, targetLocation });
    return this._countRedPixels();
  }

  async _gridShapeAreaAsync(viewer, target, viewerLocation, targetLocation) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderObstacles.renderGridShape(viewerLocation, target, { viewer, targetLocation });
    return this._countRedPixelsAsync();
  }

  /**
   * Constrained target area, counting both lit and unlit portions of the target.
   * Used to determine the total area (denominator) when useLitTarget config is set.
   * Called after _calculatePercentVisible.
   * @returns {number}
   */
  _constrainedTargetArea(viewer, target, viewerLocation, targetLocation) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderObstacles.renderTarget(viewerLocation, target, { viewer, targetLocation });
    return this._countRedPixels();
  }

  async constrainedTargetArea(viewer, target, viewerLocation, targetLocation) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.renderObstacles.renderTarget(viewerLocation, target, { viewer, targetLocation });
    return this._countRedPixelsAsync();

  }

  _viewableTargetArea(_viewer, _target, _viewerLocation, _targetLocation) {
    return this._redPixels - this._redBlockedPixels;
  }

  _totalTargetArea(_viewer, _target, _viewerLocation, _targetLocation) { return this._redPixels; }

  _countRedPixels() {
    const gl = this.gl;
    this.gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferData);
    const pixels = this.bufferData;
    let countRed = 0;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const hasR = Boolean(r === 255);
      countRed += hasR;
    }
    return countRed;
  }

  _countRedBlockedPixels() {
    const gl = this.gl;
    this.gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferData);
    const pixels = this.bufferData;
    const terrainThreshold = this.config.alphaThreshold * 255;
    let countRed = 0;
    let countRedBlocked = 0;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const hasR = Boolean(r === 255);

      countRed += hasR;
      countRedBlocked += hasR * (Boolean(b === 255) || Boolean(g > terrainThreshold))
    }
    return { countRed, countRedBlocked };
  }

  async _countRedPixelsAsync() {
    const gl = this.gl;
    await readPixelsAsync(gl, 0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferData);
    const pixels = this.bufferData;
    let countRed = 0;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const hasR = Boolean(r === 255);
      countRed += hasR;
    }
    return countRed;
  }

 async _countRedBlockedPixelsAsync() {
    const gl = this.gl;
    await readPixelsAsync(gl, 0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferData);
    const pixels = this.bufferData;
    const terrainThreshold = this.config.alphaThreshold * 255;
    let countRed = 0;
    let countRedBlocked = 0;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const hasR = Boolean(r === 255);

      countRed += hasR;
      countRedBlocked += hasR * (Boolean(b === 255) || Boolean(g > terrainThreshold))
    }
    return { countRed, countRedBlocked };
  }

  destroy() { this.renderObstacles.destroy(); }
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
      this.renderer.render(viewerLocation, target, { viewer, targetLocation, frame, clear });
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
