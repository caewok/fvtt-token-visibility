/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";

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
  }


  _redPixels = 0;

  _redBlockedPixels = 0;

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.prerender();
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
    const res = this._countRedBlockedPixels();
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
