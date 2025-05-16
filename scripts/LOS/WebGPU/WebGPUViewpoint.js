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

  device;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.constructor.gpuCanvas ??= new OffscreenCanvas(this.constructor.WIDTH, this.constructor.HEIGHT);
    this.gpuCtx = this.constructor.gpuCanvas.getContext("webgpu");

    const gl = this.gl;
    this.texture = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();
  }

  async initialize() {
    this.device ??= CONFIG[MODULE_ID].webGPUDevice ?? (await WebGPUDevice.getDevice());
    this.gpuCtx.configure({
      device: this.device,
      format: WebGPUDevice.presentationFormat,
      alphamode: "premultiplied", // Instead of "opaque"
    });

    this.renderObstacles = new RenderObstacles(this.device,
      { senseType: this.config.senseType, width: this.constructor.WIDTH, height: this.constructor.HEIGHT });
    await this.renderObstacles.initialize();
    this.renderObstacles.setRenderTextureToCanvas(this.constructor.gpuCanvas);
  }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
//     console.debug('First render - initial state:', {
//       viewer: `${viewer?.name}, ${viewer?.id}`,
//       target: `${target?.name}, ${target?.id}`,
//       viewerLocation: `${viewerLocation}`,
//       targetLocation: `${targetLocation}`,
//     });

    // TODO: Move prerender outside so we can trigger it only when things move.
    const useLitTargetShape = this.config.useLitTargetShape;
    this.renderObstacles.prerender({ useLitTargetShape });

    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation, useLitTargetShape });
    const res = this._countRedBlockedPixels();
    // console.debug('Pixel computation result:', res);
    this._redPixels = res.countRed;
    this._redBlockedPixels = res.countRedBlocked;
  }

  _gridShapeArea(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.renderGridShape(viewer, target, viewerLocation, targetLocation);
    return this._countRedPixels();
  }

  /**
   * Constrained target area, counting both lit and unlit portions of the target.
   * Used to determine the total area (denominator) when useLitTarget config is set.
   * Called after _calculatePercentVisible.
   * @returns {number}
   */
  _constrainedTargetArea(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.renderTarget(viewer, target, viewerLocation, targetLocation);
    return this._countRedPixels();
  }

  _countRedPixels() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.constructor.gpuCanvas);
    return super._countRedPixels();
  }

  /**
   * Must first render to the gpuCanvas.
   * Then call this to retrieve the pixel data.
   */
  _countRedBlockedPixels() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.constructor.gpuCanvas);
    return super._countRedBlockedPixels();
  }

  destroy() { this.renderObstacles.destroy(); }
}

export class PercentVisibleCalculatorWebGPUAsync extends PercentVisibleRenderCalculatorAbstract {
  static viewpointClass = WebGPUViewpointAsync;

  /** @type {number} */
  static WIDTH = 128;

  /** @type {number} */
  static HEIGHT = 128;

  /** @type {RenderObstaclesWebGL2|RenderObstacles} */
  renderObstacles;

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
    await this.renderObstacles.initialize();
    await this.sumPixels.initialize();
    this.renderObstacles.setRenderTextureToInternalTexture()
  }

  #redPixels = 0;

  #redBlockedPixels = 0;

  #gridArea = 0;

  #constrainedTargetArea = 0;

  _gridShapeArea() { return this.#gridArea; }

  _viewableTargetArea() { return this.#redBlockedPixels; }

  _totalTargetArea() { return this.#redPixels; }

  _constrainedTargetArea() { return this.#constrainedTargetArea; }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
//     console.debug('First render - initial state:', {
//       viewer: viewer?.id,
//       target: target?.id,
//       viewerLocation,
//       targetLocation
//     });

    // TODO: Move prerender outside the loop so it can be updated only when things move.
    const useLitTargetShape = this.config.useLitTargetShape;
    this.renderObstacles.prerender({ useLitTargetShape });
//     console.debug('After prerender - drawable objects state:',
//       this.renderObstacles.drawableObjects.map(obj => obj.constructor.name)
//     );

    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation, useLitTargetShape });
//     console.debug('Render completed');

    const res = this.sumPixels.computeSync(this.renderObstacles.renderTexture);
//    console.debug('Pixel computation result:', res);

    this.#redPixels = res.red;
    this.#redBlockedPixels = res.redBlocked;

    if ( this.config.largeTarget ) {
      this.#gridArea = this._calculateGridShapeArea(viewer, target, viewerLocation, targetLocation);
    }

    if ( this.config.useLitTargetShape ) {
       this.#constrainedTargetArea = this._calculateConstrainedTargetArea(viewer, target, viewerLocation, targetLocation);
    }

//     console.log('Final state:', {
//       redPixels: this.#redPixels,
//       redBlockedPixels: this.#redBlockedPixels,
//       gridArea: this.#gridArea,
//       constrainedTargetArea: this.#constrainedTargetArea
//     });
  }

  async _calculatePercentVisibleAsync(viewer, target, viewerLocation, targetLocation) {
    const useLitTargetShape = this.config.useLitTargetShape;
    this.renderObstacles.prerender({ useLitTargetShape });
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation, useLitTargetShape });
    const res = await this.sumPixels.compute(this.renderObstacles.renderTexture);
    this.#redPixels = res.red;
    this.#redBlockedPixels = res.redBlocked;

    if ( this.config.largeTarget ) {
      this.#gridArea = await this._calculateGridShapeAreaAsync(viewer, target, viewerLocation, targetLocation);
    }

    if ( this.config.useLitTargetShape ) {
       this.#constrainedTargetArea = await this._calculateConstrainedTargetArea(viewer, target, viewerLocation, targetLocation)
    }
  }

  _calculateGridShapeArea(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.renderGridShape(viewerLocation, target, { viewer, targetLocation });
    const res = this.sumPixels.computeSync(this.renderObstacles.renderTexture);
    return res.red;
  }

  async _calculateGridShapeAreaAsync(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.renderGridShape(viewerLocation, target, { viewer, targetLocation });
    const res = await this.sumPixels.compute(this.renderObstacles.renderTexture);
    return res.red;
  }

  _calculateConstrainedTargetArea(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.renderTarget(viewerLocation, target, { viewer, targetLocation });
    const res = this.sumPixels.computeSync(this.renderObstacles.renderTexture);
    return res.red;
  }

  async _calculateConstrainedTargetAreaAsync(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.renderTarget(viewerLocation, target, { viewer, targetLocation });
    const res = await this.sumPixels.compute(this.renderObstacles.renderTexture);
    return res.red;
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

    // Render once for each viewpoint.
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

    // Render once for each viewpoint.
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

