/* globals
canvas,
CONFIG,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { WebGPUDevice } from "./WebGPU.js";
import { Camera } from "./Camera.js";
import { VisionTriangle } from "../VisionTriangle.js";
import { MaterialsTracker } from "./MaterialsTracker.js";
import {
  DrawableTokenInstances,
  DrawableHexTokenInstances,
  DrawableTileInstances,
  DrawableConstrainedTokens,
  DrawableNonTerrainWallInstances,
  DrawableTerrainWallInstances,
  DrawableLitTokens,
  DrawableGridInstances,
  } from "./DrawableObjects.js";

/*
walls and tiles seldom change.
tokens change often.

Instance array, defining the matrix for instances of walls, tiles, tokens:
- define 1 array for each: wall, directional wall, tiles, tokens.
- Update the walls and tiles instances as needed (seldom).
- For simplicity, keep walls, tiles instance buffers distinct. (Could combine but why bother?)
- Update token instance data at prerender.

Vertex/Index arrays for instances of walls, directional walls, tiles, tokens (model vertices)
- These don't change. (Token model only changes upon scene change / grid type change)
- TODO: May need multiple token models for hex grids and weird token sizes.
- Write one vertex and one index buffer, with defined offsets.

Constrained tokens
- Single instance; no instance array.
- Defined at prerender.
- Use pre-defined vertex/index buffers that can handle tokens with X polygon vertices.
- Expand buffers as needed. Define offsets so each constrained token uses same underlying buffer
- Trigger draws for only select tokens.
- Other tokens trigger draw using the model token shape.

Drawable.
- instance buffer (may be shared among the same type, e.g., tiles)
- material buffer (may be shared among different drawables)
- vertex buffer (shared among same model type)
- index buffer (shared among same model type)
- vOffset
- iOffset
- numInstances
-


*/


export class RenderObstacles {
  /** @type {class} */
  static drawableClasses = [
    DrawableTerrainWallInstances,
    DrawableNonTerrainWallInstances,
    DrawableTileInstances,
    DrawableTokenInstances,
    DrawableConstrainedTokens,
    DrawableHexTokenInstances,
    DrawableLitTokens,
  ];

  /** @type {object} */
  static CAMERA_LAYOUT = {
    label: "Camera",
    entries: [{
      binding: 0, // Camera/Frame uniforms
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
      buffer: {},
    }]
  };

  /** @type {GPUDevice} */
  device;

  /** @type {DrawObjectsAbstract[]} */
  drawableObjects = []; // Instantiations of all drawableClasses.

  /** @type {DrawObjectsAbstract[]} */
  drawableObstacles = []; // All drawable objects that should be filtered by vision triangle.

  /** @type {DrawableObjectsAbstract} */
  drawableGridShape; // The unit grid shape as a drawable object.

  /** @type {object<DrawableObjectsAbstract>} */
  drawableToken; // Unconstrained token drawable object.

  /** @type {DrawableObjectsAbstract} */
  drawableConstrainedToken; // Constrained token drawable object.

  /** @type {DrawableObjectsAbstract} */
  drawableLitToken; // Lit token drawable object.

  /** @type {Camera} */
  camera = new Camera({ glType: "webGPU", perspectiveType: "perspective" });

  /** @type {MaterialTracker} */
  materials;

  /** @type {VisionTriangle} */
  visionTriangle = new VisionTriangle();

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  #senseType = "sight";

  get senseType() { return this.#senseType; } // Don't allow modifications.

  /** @type {boolean} */
  #debugViewNormals = false;

  get debugViewNormals() { return this.#debugViewNormals; } // Don't allow modifications.

  constructor(device, { senseType = "sight", debugViewNormals = false, width = 256, height = 256 } = {}) {
    this.#senseType = senseType;
    this.#debugViewNormals = debugViewNormals;
    this.device = device;
    this.materials = new MaterialsTracker(this.device);
    this._buildDrawableObjects();

    this.#renderSize.width = width;
    this.#renderSize.height = height;
  }

  _buildDrawableObjects() {
    this.drawableObjects.forEach(obj => obj.destroy());
    this.drawableObjects.length = 0;
    const opts = { senseType: this.senseType, debugViewNormals: this.debugViewNormals };

    for ( const cl of this.constructor.drawableClasses ) {
      // Use hex-specific classes for non-constrained token drawing as necessary.
      if ( !canvas.grid.isHexagonal && cl === DrawableHexTokenInstances ) continue;
      if ( canvas.grid.isHexagonal && cl === DrawableTokenInstances ) continue;

      const drawableObj = new cl(this.device, this.materials, this.camera, opts);
      this.drawableObjects.push(drawableObj);
      switch ( cl ) {
        // Lit tokens not used as obstacles; only targets
        case DrawableLitTokens:
          this.drawableLitToken = drawableObj; break;

        // Same for the unit grid shape; not a filtered obstacle.
        case DrawableGridInstances:
          this.drawableGridShape = drawableObj; break;

        case DrawableTokenInstances:
        case DrawableHexTokenInstances:
          this.drawableToken = drawableObj;
          this.drawableObstacles.push(drawableObj);
          break;

        case DrawableConstrainedTokens:
          this.drawableConstrainedToken = drawableObj;
          this.drawableObstacles.push(drawableObj);
          break;

        default:
          this.drawableObstacles.push(drawableObj);
      }
    }
  }

  /** @type {WebGPUDevice} */
  static device;

  /**
   * Get the current device or attempt to get a new one if lost.
   */
  static async getDevice() {
    if ( this.device ) return this.device;
    this.device = await WebGPUDevice.getDevice();
    return this.device;
  }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize() {
    await this._initializeDrawObjects();
    this._allocateRenderTargets();
  }

  /**
   * Define one ore more DrawObjects used to render the scene.
   */
  async _initializeDrawObjects() {
    this._createCameraBindGroup();
    /*
    const promises = [];
    for ( const drawableObj of this.drawableObjects ) promises.push(drawableObj.initialize());
    return Promise.allSettled(promises);
    */

    for ( const drawableObj of this.drawableObjects ) {
      await drawableObj.initialize();
    }
  }

  /** @type {ViewerLOSConfig} */
  _config = {
    blocking: {
      walls: true,
      tiles: true,
      tokens: {
        dead: true,
        live: true,
        prone: true,
      }
    },
    debug: false,
    useLitTargetShape: false,
    largeTarget: false,
  }

  get config() { return this._config; }

  set config(cfg = {}) {
    foundry.utils.mergeObject(this._config, cfg);
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {
    for ( const drawableObj of this.drawableObjects ) drawableObj.prerender();
  }

  async renderAsync(viewerLocation, target, opts) {
    this.render(viewerLocation, target, opts);
    return this.device.queue.onSubmittedWorkDone();
  }

  renderGridShape(viewerLocation, target, { frame } = {}) {
    const device = this.device;

    // Must set the canvas context immediately prior to render.
    const view = this.#context ? this.#context.getCurrentTexture().createView() : this.renderTexture.createView();
    if ( this.sampleCount > 1 ) this.colorAttachment.resolveTarget = view;
    else {
      this.colorAttachment.view = view;
      this.colorAttachment.resolveTarget = undefined;
    }

    // When using viewport, may want to prevent clearing of the texture between renders.
    // FYI, cannot set clearValue of the attachment to null.
    const renderPassDesc = this.renderPassDescriptor;

    // Render each drawable object.
    const commandEncoder = device.createCommandEncoder({ label: "Renderer" });
    const renderPass = commandEncoder.beginRenderPass(renderPassDesc);

    if ( frame ) renderPass.setViewport(frame.x, frame.y, frame.width, frame.height, 0, 1);

    this.drawableGridShape.renderTarget(renderPass, target);
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  renderTarget(viewerLocation, target, { frame, useLitTargetShape = false } = {}) {
    const device = this.device;

    // Must set the canvas context immediately prior to render.
    const view = this.#context ? this.#context.getCurrentTexture().createView() : this.renderTexture.createView();
    if ( this.sampleCount > 1 ) this.colorAttachment.resolveTarget = view;
    else {
      this.colorAttachment.view = view;
      this.colorAttachment.resolveTarget = undefined;
    }

    // When using viewport, may want to prevent clearing of the texture between renders.
    // FYI, cannot set clearValue of the attachment to null.
    const renderPassDesc = this.renderPassDescriptor;

    // Render each drawable object.
    const commandEncoder = device.createCommandEncoder({ label: "Renderer" });
    const renderPass = commandEncoder.beginRenderPass(renderPassDesc);

    if ( frame ) renderPass.setViewport(frame.x, frame.y, frame.width, frame.height, 0, 1);

    if ( useLitTargetShape && target.litTokenBorder ) this.drawableLitToken.renderTarget(renderPass, target);
    else if ( target.isConstrainedTokenBorder ) this.drawableConstrainedToken.renderTarget(renderPass, target);
    else this.drawableToken.renderTarget(renderPass, target);

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  render(viewerLocation, target, { viewer, targetLocation, frame, clear = true, useLitTargetShape = false } = {}) {
    const opts = { viewer, target, blocking: this.config.blocking, useLitTargetShape: this.config.useLitTargetShape };
    const device = this.device;
    this._setCamera(viewerLocation, target, { viewer, targetLocation });
    const visionTriangle = this.visionTriangle.rebuild(viewerLocation, target);
    this.drawableObstacles.forEach(drawable => drawable.filterObjects(visionTriangle, opts));

    // Must set the canvas context immediately prior to render.
    const view = this.#context ? this.#context.getCurrentTexture().createView() : this.renderTexture.createView();
    if ( this.sampleCount > 1 ) this.colorAttachment.resolveTarget = view;
    else {
      this.colorAttachment.view = view;
      this.colorAttachment.resolveTarget = undefined;
    }

    // When using viewport, may want to prevent clearing of the texture between renders.
    // FYI, cannot set clearValue of the attachment to null.
    const renderPassDesc = this.renderPassDescriptor;
    let loadOp;
    if ( !clear ) {
      loadOp = renderPassDesc.colorAttachments[0].loadOp;
      renderPassDesc.colorAttachments[0].loadOp = "load";
    }

    // Render each drawable object.
    const commandEncoder = device.createCommandEncoder({ label: "Renderer" });
    const renderPass = commandEncoder.beginRenderPass(renderPassDesc);

    if ( frame ) renderPass.setViewport(frame.x, frame.y, frame.width, frame.height, 0, 1);

    // Render the target.
    // Render first so full red of target is recorded.
    // (Could be either constrained or not constrained.)
    if ( useLitTargetShape && target.litTokenBorder ) this.drawableLitToken.renderTarget(renderPass, target);
    else if ( target.isConstrainedTokenBorder ) this.drawableConstrainedToken.renderTarget(renderPass, target);
    else this.drawableToken.renderTarget(renderPass, target);

    // Render the obstacles
    for ( const drawableObj of this.drawableObstacles ) drawableObj.render(renderPass, opts);

    // TODO: Do we need to render terrains last?
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);

    if ( !clear ) renderPassDesc.colorAttachments[0].loadOp = loadOp; // Reset to default value.

  }

  /**
   * Set camera for a given render.
   */
  _setCamera(viewerLocation, target, { targetLocation } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustrum(target);
    this._updateCameraBuffer();
  }

  _updateCameraBuffer() {
    this.device.queue.writeBuffer(this.camera.deviceBuffer, 0, this.camera.arrayBuffer);
    this.debugBuffer = new Float32Array(this.camera.arrayBuffer)
  }

  _createCameraBindGroup() {
    const device = this.device;
    this.camera.bindGroupLayout = device.createBindGroupLayout(Camera.CAMERA_LAYOUT);
    const buffer = this.camera.deviceBuffer = device.createBuffer({
      label: "Camera",
      size: Camera.CAMERA_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Buffer will be written to GPU prior to render, because the camera view will change.
    this.camera.bindGroup = device.createBindGroup({
      label: "Camera",
      layout: this.camera.bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer }
      }],
    });
  }

  registerPlaceableHooks() { this.drawableObjects.forEach(obj => obj.registerPlaceableHooks()); }

  deregisterPlaceableHooks() { this.drawableObjects.forEach(obj => obj.deregisterPlaceableHooks()); }

  // ----- NOTE: Rendering ----- //

  /** @type {number} */
  sampleCount = 1; // Must be set prior to initialization.

  /** @type {string} */
  depthFormat = "depth24plus";

  /** @type {GPUTexture} */
  depthTexture;

  /** @type {GPUTexture} */
  #renderTexture;

  /** @type {GPUTexture} */
  msaaColorTexture;

  get renderTexture() {
    return this.#renderTexture || (this.#renderTexture = this._createRenderTexture());
  }

  set renderTexture(value) {
    if ( this.#renderTexture && this.#renderTexture !== value ) this.#renderTexture.destroy();
    this.#renderTexture = value;
    this.#context = undefined;
  }

  _allocateRenderTargets() {
    const sampleCount = this.sampleCount;

    if ( this.#renderTexture ) {
      this.#renderTexture.destroy();
      this.#renderTexture = this._createRenderTexture();
    }

    // Update the multi-sample texture if needed.
    if ( this.msaaColorTexture ) this.msaaColorTexture = this.msaaColorTexture.destroy(); // Sets to undefined.
    if ( sampleCount > 1 ) this.msaaColorTexture = this._createMSAAColorTexture();

    // Update the depth texture.
    if ( this.depthTexture ) this.depthTexture = this.depthTexture.destroy();
    this.depthTexture = this._createDepthTexture();
    this.depthStencilAttachment.view = this.depthTexture.createView();

    this.colorAttachment.view = sampleCount > 1 ? this.msaaColorTexture.createView() : undefined;
    this.colorAttachment.resolveTarget = undefined;
    this.colorAttachment.storeOp = sampleCount > 1 ? "discard" : "store";
  }

  #context;

  setRenderTextureToCanvas(canvas) {
    const context = canvas.getContext("webgpu");
    if ( !context ) throw new Error("setRenderTextureToCanvas|Canvas does not have a valid webgpu context!");
    this.#context = context;
    this.#context.configure({
      device: this.device,
      format: WebGPUDevice.presentationFormat,
    });
    this.renderSize = { width: canvas.width, height: canvas.height };
  }

  setRenderTextureToInternalTexture() {
    this.removeCanvasRenderTexture();
    if ( !this.#renderTexture ) this.#renderTexture = this._createRenderTexture();
  }

  removeCanvasRenderTexture() { this.#context = undefined; }

  /** @type {object} */
  colorAttachment = {
     // Appropriate target will be populated in onFrame
    view: undefined,
    resolveTarget: undefined,
    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
    loadOp: "clear",
    storeOp: "store",
  };

  /** @type {object} */
  depthStencilAttachment = {
    view: undefined,
    depthClearValue: 1.0,
    depthLoadOp: "clear",
    depthStoreOp: "discard",
  };

  /** @type {object} */
  renderPassDescriptor = {
    label: "Token RenderPass",
    colorAttachments: [this.colorAttachment],
    depthStencilAttachment: this.depthStencilAttachment,
  };

  /**
   * Create a render texture that can be used to store the output of this render.
   * @returns {GPUTexture}
   */
  _createRenderTexture() {
    return this.device.createTexture({
      label: "Render Tex",
      size: [this.renderSize.width, this.renderSize.height, 1],
      dimension: "2d",
      format: WebGPUDevice.presentationFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, // Unneeded: GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  /**
   * Create a depth texture that can be used to store depth for this render.
   * @returns {GPUTexture}
   */
  _createDepthTexture() {
    return this.device.createTexture({
      label: "Render Depth",
      size: [this.renderSize.width, this.renderSize.height, 1],
      sampleCount: this.sampleCount,
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  async readTexturePixels() {
    const texture = this.renderTexture;

    // copyTextureToBuffer requires 256 byte widths for bytesPerRow
    const width = Math.ceil((texture.width * 4) / 256) * (256 / 4);
    const height = texture.height;
    const renderResult = this.device.createBuffer({
      label: "renderResult",
      size: width * height * 4, // 1 bytes per (u8)
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder({ label: 'Read texture pixels' });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: renderResult, bytesPerRow: width * 4 },
      { width: texture.width, height: texture.height },
    );
    this.device.queue.submit([encoder.finish()]);

    await renderResult.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(renderResult.getMappedRange());

    // Do a second copy so the original buffer can be unmapped.
    const imgData = {
      pixels: new Uint8Array(pixels),
      x: 0,
      y: 0,
      width,
      height,
    };
    renderResult.unmap();
    renderResult.destroy();
    return imgData;
  }

  /**
   * Creates a mult-sample anti-aliased texture for rendering.
   * @returns {GPUTexture}
   */
  _createMSAAColorTexture() {
    return this.device.createTexture({
      label: "MSAA Color Tex",
      size: this.renderSize,
      sampleCount: this.sampleCount,
      format: WebGPUDevice.presentationFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /** @type {object<width: {number}, height: {number}>} */
  #renderSize = { width: 256, height: 256 };

  get renderSize() { return this.#renderSize; }

  set renderSize(value) {
    this.#renderSize.width = value.width;
    this.#renderSize.height = value.height;
    this._allocateRenderTargets();
  }

  destroy() {
    if ( this.#renderTexture ) this.#renderTexture = this.#renderTexture.destroy(); // Sets to undefined.
    if ( this.msaaColorTexture ) this.msaaColorTexture = this.msaaColorTexture.destroy();
    if ( this.depthTexture ) this.depthTexture = this.depthTexture.destroy();
  }
}
