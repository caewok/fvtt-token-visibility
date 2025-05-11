/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstacles } from "./RenderObstacles.js";
import { WebGPUDevice } from "./WebGPU.js";
import { WebGPUSumRedPixels } from "./SumPixels.js";
import { AsyncQueue } from "./AsyncQueue.js";

// Base folder
import { MODULE_ID } from "../../const.js";

// LOS folder
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { PercentVisibleCalculatorWebGL2, DebugVisibilityViewerWebGL2 } from "../WebGL2/WebGL2Viewpoint.js";
import { PercentVisibleRenderCalculatorAbstract }  from "../PercentVisibleCalculator.js";
import { DebugVisibilityViewerWithPopoutAbstract } from "../DebugVisibilityViewer.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class WebGPUViewpoint extends AbstractViewpoint {
  static get calcClass() { return PercentVisibleCalculatorWebGPU; }
}

export class WebGPUViewpointAsync extends AbstractViewpoint {
  static get calcClass() { return PercentVisibleCalculatorWebGPUAsync; }
}

export class PercentVisibleCalculatorWebGPU extends PercentVisibleCalculatorWebGL2 {
  static viewpointClass = WebGPUViewpoint;

  /** @type {OffScreenCanvas} */
  static gpuCanvas;

  /** @type {GPUCanvasContext} */
  gpuCtx;

  constructor({ device, ...opts } = {}) {
    super(opts);
    device ??= CONFIG[MODULE_ID].webGPUDevice;
    this.renderObstacles = new RenderObstacles(device,
      { senseType: this.config.senseType, width: this.constructor.WIDTH, height: this.constructor.HEIGHT });

    this.constructor.gpuCanvas ??= new OffscreenCanvas(this.constructor.WIDTH, this.constructor.HEIGHT);
    this.gpuCtx = this.constructor.gpuCanvas.getContext("webgpu");

    if ( !device ) {
      const self = this;
      WebGPUDevice.getDevice().then(device => {
        self.device = device
        self.gpuCtx.configure({
          device,
          format: WebGPUDevice.presentationFormat,
          alphamode: "premultiplied", // Instead of "opaque"
        });
      });
    } else {
      this.device = device
      this.gpuCtx.configure({
        device,
        format: WebGPUDevice.presentationFormat,
        alphamode: "premultiplied", // Instead of "opaque"
      });
    }

    const gl = this.gl;
    this.texture = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();
  }

  async initialize() {
    await super.initialize();
    this.renderObstacles.setRenderTextureToCanvas(this.constructor.gpuCanvas);
  }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    // Same as PercentVisibleCalculatorAbstract.prototype._calculatePercentVisible
    // Skip the PercentVisibleCalculatorWebGL2 parent class.
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
  }

  /**
   * Must first render to the gpuCanvas.
   * Then call this to retrieve the pixel data.
   */
  _percentRedPixels() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.constructor.gpuCanvas);
    return super._percentRedPixels();
  }
}

export class PercentVisibleCalculatorWebGPUAsync extends PercentVisibleRenderCalculatorAbstract {
  static viewpointClass = WebGPUViewpointAsync;

  /** @type {WebGPUSumRedPixels} */
  sumPixels;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.queue = new AsyncQueue();
    device ??= CONFIG[MODULE_ID].webGPUDevice;
    if ( !device ) {
      const self = this;
      WebGPUDevice.getDevice().then(device => {
        self.device = device
        self.renderObstacles = new RenderObstacles(device,
          { senseType: self.senseType, width: self.constructor.WIDTH, height: self.constructor.HEIGHT })
        self.sumPixels = new WebGPUSumRedPixels(device);
      });
    } else {
      this.device = device;
      this.renderObstacles = new RenderObstacles(device,
        { senseType: this.config.senseType, width: this.constructor.WIDTH, height: this.constructor.HEIGHT })
      this.sumPixels = new WebGPUSumRedPixels(device);
    }
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

export class DebugVisibilityViewerWebGPU extends DebugVisibilityViewerWithPopoutAbstract {
  static viewpointClass = WebGPUViewpoint;

  static CONTEXT_TYPE = "webgpu";

  /** @type {RenderObstacles} */
  renderer;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.debugView = opts.debugView ?? true;
    this.device = device || CONFIG[MODULE_ID].webGPUDevice;
    this.renderer = new RenderObstacles(this.device, {
      senseType: this.viewerLOS.config.senseType,
      debugViewNormals: this.debugView,
      width: this.constructor.WIDTH,
      height: this.constructor.HEIGHT
    });
  }
  async initialize() {
    await super.initialize();
    await this.renderer.initialize();
  }

  async reinitialize() {
    await super.reinitialize();
    this.renderer.setRenderTextureToCanvas(this.popout.canvas);
  }

  updateDebugForPercentVisible(percentVisible) {
    super.updateDebugForPercentVisible(percentVisible);
    this.renderer.prerender();
    // TODO: Handle multiple viewpoints.

    const frames = DebugVisibilityViewerWebGL2.prototype._canvasDimensionsForViewpoints.call(this);
    for ( let i = 0, iMax = this.viewerLOS.viewpoints.length; i < iMax; i += 1 ) {
      const { viewer, target, viewpoint: viewerLocation, targetLocation } = this.viewerLOS.viewpoints[i];
      const frame = frames[i];
      const clear = i === 0;
      this.renderer.render(viewerLocation, target, { viewer, targetLocation, frame, clear });
    }
  }

  destroy() {
    if ( this.renderer ) this.renderer.destroy();
    super.destroy();
  }
}

export class DebugVisibilityViewerWebGPUAsync extends DebugVisibilityViewerWithPopoutAbstract {
  static viewpointClass = WebGPUViewpointAsync;

  static CONTEXT_TYPE = "webgpu";

  /** @type {RenderObstacles} */
  renderer;

  /** @type {boolean} */
  debugView = true;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device || CONFIG[MODULE_ID].webGPUDevice;
    this.debugView = opts.debugView ?? true;
    this.renderer = new RenderObstacles(this.device, {
      senseType: this.viewerLOS.config.senseType,
      debugViewNormals: this.debugView,
      width: this.constructor.WIDTH,
      height: this.constructor.HEIGHT
    });
  }

  async initialize() {
    await super.initialize();
    await this.renderer.initialize();
  }

  async reinitialize() {
    await super.reinitialize();
    this.renderer.setRenderTextureToCanvas(this.popout.canvas);
  }

  percentVisible() {
    return this.viewerLOS.percentVisibleAsync(this.target);
  }

  updateDebugForPercentVisible(percentVisible) {
    percentVisible.then(value => super.updateDebugForPercentVisible(value));

    this.renderer.prerender();
    // TODO: Handle multiple viewpoints.
    const { viewer, target, viewpoint: viewerLocation, targetLocation } = this.viewerLOS.viewpoints[0];
    this.renderer.render(viewerLocation, target, { viewer, targetLocation });
  }

  destroy() {
    if ( this.renderer ) this.renderer.destroy();
    super.destroy();
  }
}

