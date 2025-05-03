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
import { PercentVisibleCalculatorWebGL2 } from "../WebGL2/WebGL2Viewpoint.js";
import { PercentVisibleRenderCalculatorAbstract }  from "../PercentVisibleCalculator.js";
import { DebugVisibilityViewerWithPopoutAbstract } from "../DebugVisibilityViewer.js";


/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class WebGPUViewpoint extends AbstractViewpoint {
  // TODO: Handle config and filtering obstacles.

  constructor(...args) {
    super(...args);
    this.calc = CONFIG[MODULE_ID].sightCalculators.webGPU;
  }

  _percentVisible() {
    // TODO: Handle configuration options.
    const viewer =  this.viewerLOS.viewer;
    const target = this.viewerLOS.target;
    const viewerLocation = this.viewpoint;
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    return this.calc.percentVisible(viewer, target, { viewerLocation, targetLocation });
  }
}

export class WebGPUViewpointAsync extends AbstractViewpoint {
  // TODO: Handle config and filtering obstacles.

  constructor(...args) {
    super(...args);
    this.calc = CONFIG[MODULE_ID].sightCalculators.webGPUAsync;
  }

  _percentVisible() {
    // TODO: Handle configuration options.
    const viewer =  this.viewerLOS.viewer;
    const target = this.viewerLOS.target;
    const viewerLocation = this.viewpoint;
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    return this.calc.percentVisible(viewer, target, { viewerLocation, targetLocation });
  }

  async _percentVisibleAsync() {
    // TODO: Handle configuration options.
    const viewer =  this.viewerLOS.viewer;
    const target = this.viewerLOS.target;
    const viewerLocation = this.viewpoint;
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    return this.calc.percentVisibleAsync(viewer, target, { viewerLocation, targetLocation });
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

export class DebugVisibilityViewerWebGPU extends DebugVisibilityViewerWithPopoutAbstract {
  static CONTEXT_TYPE = "webgpu";

  /** @type {PercentVisibleCalculator} */
  calc;

  /** @type {RenderObstacles} */
  renderer;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.debugView = opts.debugView ?? true;
    this.device = device;
    this.calc = new PercentVisibleCalculatorWebGPU({ device, senseType: this.senseType });
    this.renderer = new RenderObstacles(this.device, {
      senseType: this.senseType,
      debugViewNormals: this.debugView,
      width: this.constructor.WIDTH,
      height: this.constructor.HEIGHT
    });
  }
  async initialize() {
    await super.initialize();
    await this.calc.initialize();
    await this.renderer.initialize();
  }

  async reinitialize() {
    await super.reinitialize();
    this.renderer.setRenderTextureToCanvas(this.popout.canvas);
  }

  _render(viewer, target, viewerLocation, targetLocation) {
    this.renderer.prerender();
    this.renderer.render(viewerLocation, target, { viewer, targetLocation });
  }

  percentVisible(viewer, target, viewerLocation, targetLocation) {
    return this.calc.percentVisible(viewer, target, { viewerLocation, targetLocation });
  }

  destroy() {
    if ( this.calc ) this.calc.destroy();
    if ( this.renderer ) this.renderer.destroy();
    super.destroy();
  }
}

export class DebugVisibilityViewerWebGPUAsync extends DebugVisibilityViewerWithPopoutAbstract {
  static CONTEXT_TYPE = "webgpu";

  /** @type {PercentVisibleCalculator} */
  calc;

  /** @type {RenderObstacles} */
  renderer;

  /** @type {boolean} */
  debugView = true;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.debugView = opts.debugView ?? true;
    this.calc = new PercentVisibleCalculatorWebGPUAsync({ device, senseType: this.senseType });
    this.renderer = new RenderObstacles(this.device, {
      senseType: this.senseType,
      debugViewNormals: this.debugView,
      width: this.constructor.WIDTH,
      height: this.constructor.HEIGHT
    });
  }

  async initialize() {
    await super.initialize();
    await this.calc.initialize();
    await this.renderer.initialize();
  }

  async reinitialize() {
    await super.reinitialize();
    this.renderer.setRenderTextureToCanvas(this.popout.canvas);
  }

  _render(viewer, target, viewerLocation, targetLocation) {
    this.renderer.prerender();
    this.renderer.render(viewerLocation, target, { viewer, targetLocation });
  }

  percentVisible(viewer, target, viewerLocation, targetLocation) {
    const callback = (percentVisible, viewer, target) => this.updatePopoutFooter({ percentVisible, viewer, target });
    return this.calc.percentVisible(viewer, target, { callback, viewerLocation, targetLocation });
  }

  destroy() {
    if ( this.calc ) this.calc.destroy();
    if ( this.renderer ) this.renderer.destroy();
    super.destroy();
  }
}

