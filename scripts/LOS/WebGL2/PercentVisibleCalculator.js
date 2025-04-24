/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";
import { RenderObstacles } from "../WebGPU/RenderObstacles.js";
import { WebGPUDevice } from "../WebGPU/WebGPU.js";
import { AsyncQueue } from "../WebGPU/AsyncQueue.js";
import { WebGPUSumRedPixels } from "../WebGPU/SumPixels.js";

/* Percent visible calculator

Track percent visibility for tokens.
Caches values based on the viewer, viewer location, target, target location.
- Cache is tied to the placeable updates.
*/

class PercentVisibleCalculatorAbstract {

  /** @type {number} */
  static TERRAIN_THRESHOLD = 255 * 0.75;

  /** @type {string} */
  senseType = "sight";

  constructor({ senseType = "sight" } = {}) {
    this.senseType = senseType;
  }

  async initialize() { return; }

  // ----- NOTE: Visibility testing ----- //

  /**
   * Determine percent visible based on 3d view or return cached value.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {object} [opts]
   * @param {Point3d} [opts.viewerLocation]   Where the camera is located
   * @param {Point3d} [opts.targetLocation]   Where the camera is looking to in 3d space
   * @returns {number}
   */
  percentVisible(viewer, target, { viewerLocation, targetLocation, ...opts } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
    return this._percentRedPixels();
  }

  async percentVisibleAsync(viewer, target, { viewerLocation, targetLocation, ...opts } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
    return this._percentRedPixelsAsync();
  }

  /**
   * Do any preparatory calculations for determining the percent visible.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @override
   */
  _calculatePercentVisible(_viewer, _target, _viewerLocation, _targetLocation) { return; }

  /**
   * Determine the percentage red pixels for the current view.
   * @returns {number}
   * @override
   */
  _percentRedPixels() { console.error("PercentVisibleCalculator|Must be overriden by child class.") }

  async _percentRedPixelsAsync() { return this._percentRedPixels(); }

  destroy() { return; }
}

/**
 * Handles classes that use RenderObstacles to draw a 3d view of the scene from the viewer perspective.
 */
export class PercentVisibleRenderCalculatorAbstract extends PercentVisibleCalculatorAbstract {
  /** @type {number} */
  static WIDTH = 128;

  /** @type {number} */
  static HEIGHT = 128;

  /** @type {RenderObstaclesWebGL2|RenderObstacles} */
  renderObstacles;

  async initialize() {
    await this.renderObstacles.initialize();
  }

  percentVisible(...args) {
    this.renderObstacles.prerender();
    return super.percentVisible(...args);
  }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
  }

  destroy() {
    if ( this.renderObstacles ) this.renderObstacles.destroy();
  }
}

export class PercentVisibleCalculatorWebGL2 extends PercentVisibleRenderCalculatorAbstract {
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
    this.renderObstacles = new RenderObstaclesWebGL2({ gl, senseType: this.senseType });
    this.bufferData = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    super._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
  }

  _percentRedPixels() {
    const gl = this.gl;
    this.gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferData);
    const pixels = this.bufferData;
    const terrainThreshold = this.constructor.TERRAIN_THRESHOLD;
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
    return (countRed - countRedBlocked) / countRed;
  }
}

export class PercentVisibleCalculatorWebGPU extends PercentVisibleCalculatorWebGL2 {

  /** @type {OffScreenCanvas} */
  static gpuCanvas;

  /** @type {GPUCanvasContext} */
  gpuCtx;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.renderObstacles = new RenderObstacles(device,
      { senseType: this.senseType, width: this.constructor.WIDTH, height: this.constructor.HEIGHT });

    this.constructor.gpuCanvas ??= new OffscreenCanvas(this.constructor.WIDTH, this.constructor.HEIGHT);
    this.gpuCtx = this.constructor.gpuCanvas.getContext("webgpu");
    this.gpuCtx.configure({
      device,
      format: WebGPUDevice.presentationFormat,
      alphamode: "premultiplied", // Instead of "opaque"
    });
  }

  async initialize() {
    await super.initialize();
    this.renderObstacles.setRenderTextureToCanvas(this.constructor.gpuCanvas);
  }

  /**
   * Must first render to the gpuCanvas.
   * Then call this to retrieve the pixel data.
   */
  _percentRedPixels() {
    const gl = this.gl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.constructor.gpuCanvas);
    return super._percentRedPixels();
  }
}

export class PercentVisibleCalculatorWebGPUAsync extends PercentVisibleRenderCalculatorAbstract {
  /** @type {WebGPUSumRedPixels} */
  sumPixels;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.renderObstacles = new RenderObstacles(device,
      { senseType: this.senseType, width: this.constructor.WIDTH, height: this.constructor.HEIGHT })
    this.sumPixels = new WebGPUSumRedPixels(device);
    this.queue = new AsyncQueue();
  }

  async initialize() {
    await super.initialize();
    await this.sumPixels.initialize();
    this.renderObstacles.setRenderTextureToInternalTexture()
  }

  async _percentRedPixelsAsync() {
    const res = await this.sumPixels.compute(this.renderObstacles.renderTexture);
    return (res.red - res.redBlocked) / res.red;
  }

  _percentRedPixels() {
    const res = this.sumPixels.computeSync(this.renderObstacles.renderTexture);
    return (res.red - res.redBlocked) / res.red;
  }
}