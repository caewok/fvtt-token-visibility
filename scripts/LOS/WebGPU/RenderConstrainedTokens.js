/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";
import { Camera } from "./Camera.js";
import { GeometryConstrainedTokenDesc } from "./GeometryToken.js";
import { combineTypedArrays } from "../util.js";

export class RenderConstrainedTokens {
  /** @type {GPUDevice} */
  device;

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  /** @type {Camera} */
  camera = new Camera();

  /** @type {Geometry} */
  geometry;

  /** @type {object<GPUBindGroupLayout>} */
  bindGroupLayouts = {};

  /** @type {object<GPUBindGroup>} */
  bindGroups = {};

  /** @type {object<GPUModule>} */
  modules = {};

  /** @type {object<GPUPipeline>} */
  pipelines = {};

  /** @type {object<GPUBuffer>} */
  buffers = {};

  /**
   * @typedef {object} Drawable
   * Information needed to render a given object.
   * E.g., wall (as instance) or token (as instance) or constrained token (single instance)
   * @prop {GeometryDesc} geometry
   * @prop {string} label
   * @prop {}
   */

  /** @type {object[]} */
  drawables = [];

  /**
   * Maximum number of polygon points that can be accommodated using the current buffer.
   * If over this amount, buffer is re-sized.
   */
  maxVertices = 10;

  // See https://webgpufundamentals.org/webgpu/lessons/resources/wgsl-offset-computer.html
  static BINDGROUP_OPTS = {
    CAMERA: {
      label: "Camera",
      entries: [{
        binding: 0, // Camera/Frame uniforms
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: {},
      }]
    },
  };


  /**
   * @param {GPUDevice} device
   * @param {object} opts
   * @param {CONST.WALL_RESTRICTION_TYPES} senseType    What type of walls to use
   */
  constructor(device, { senseType = "sight"} = {}) {
    this.device = device;
    this.senseType = senseType;
  }

  /** @type {Float32Array} */
  tokenVertexPositions;

  /** @type {Uint16Array} */
  tokenVertexIndices;

  async initialize() {
    const device = this.device ??= await WebGPUDevice.getDevice();

    // Define shader.
    this.modules.render = await WebGPUShader.fromGLSLFile(device, "constrained_token", "Token Render");

    // For constrained tokens, all their vertices are one-off, and can be expected to change
    // at each render. (Depending on which token moves.) And each one could have a different
    // number of vertices, so the vertex array length will change (plus some will get removed).
    // We can either:
    // 1. Create and upload the vertex buffer on render each time.
    //  -- simpler
    // 2. Create a very large work buffer, and use offsets to update as needed.
    //  -- Likely more performant
    //

    // Set up the vertex buffer for the tokens.
    /*
    this.initializeTokens();

    // Vertex buffer
    this.buffers.vertex = device.createBuffer({
      label: `Token Vertices Buffer`,
      size: this.vertexArrayBuffer.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.buffers.vertex, 0, this.vertexArrayBuffer);

    // Index buffer
    */



    // Uniform buffers.
    this.buffers.camera = device.createBuffer({
      label: "Camera",
      size: Camera.CAMERA_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Will be written to GPU prior to render, because the camera view will change.


    // Define bind group layouts.
    const BG_OPTS = this.constructor.BINDGROUP_OPTS;
    this.bindGroupLayouts.camera = device.createBindGroupLayout(BG_OPTS.CAMERA);

    // Define pipelines.
    // TODO: Make async.
    // this.modules.render = await this.modules.render;
    this.pipelines.render = device.createRenderPipeline({
      label: "Render",
      layout: device.createPipelineLayout({ bindGroupLayouts: [
        this.bindGroupLayouts.camera,
      ]}),
      vertex: {
        module: this.modules.render,
        entryPoint: "vertexMain",
        buffers: GeometryConstrainedTokenDesc.buffersLayout,
      },
      fragment: {
        module: this.modules.render,
        entryPoint: "fragmentMain",
        targets: [{ format: WebGPUDevice.presentationFormat }],
      },
      primitive: {
        cullMode: "back",
        frontFace: "ccw",
      },
      depthStencil: {
        format: this.depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
        multisample: {
        count: this.sampleCount ?? 1,
      }
    });

    // Define bind groups.
    this.bindGroups.camera = device.createBindGroup({
      label: "Camera",
      layout: this.bindGroupLayouts.camera,
      entries: [{
        binding: 0,
        resource: { buffer: this.buffers.camera }
      }],
    });

    this.#allocateRenderTargets();
    // this.pipelines.render = await this.pipelines.render;
  }



  /**
   * Render the scene from a given viewpoint.
   * TODO: Use dirty flag(s) to update 1+ drawable instances?
   * @param {Point3d} viewerLocation
   * @param {Token} target
   */
  async renderScene(viewerLocation, target, { _vp, viewer } = {}) {
    const device = this.device ??= await WebGPUDevice.getDevice();
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustrum(target);

    // For debugging, copy from existing viewer viewpoint uniforms.


//     this.camera.perspectiveParameters = {
//       fov: vp.shaders.obstacle.fovy,
//       aspect: 1,
//       zNear: vp.shaders.obstacle.near,
//       zFar: vp.shaders.obstacle.far,
//     };


//     this.camera.perspectiveParameters = {
//       fov: Math.toRadians(30),
//       aspect: 1,
//       zNear: 1,
//       zFar: 2000,
//     };

    // vp.shaders.obstacle.uniforms.uLookAtMatrix
    // vp.shaders.obstacle.uniforms.uPerspectiveMatrix
    // vp.shaders.obstacle.uniforms.uOffsetMatrix

    this.device.queue.writeBuffer(this.buffers.camera, 0, this.camera.arrayBuffer);

    // Version 1. Create and upload the vertex buffer on render each time.
    // Don't draw the viewer token.
    const tokens = canvas.tokens.placeables
      .filter(token => token !== viewer && this.includeToken(token));
    const geoms = this.geoms = Array(tokens.length);
    for ( let i = 0, n = tokens.length; i < n; i += 1 ) {
      const token = tokens[i];
      geoms[i] = new GeometryConstrainedTokenDesc(token, { label: `Constrained Token ${token}` });
    }

    const offsetData = GeometryConstrainedTokenDesc.computeTotalVertexBufferOffsets(geoms);
    this.vertexArrayBuffer = combineTypedArrays(...geoms.map(g => g.verticesData[0]));
    this.indexArrayBuffer = combineTypedArrays(...geoms.map(g => g.indicesData[0]));

    this.buffers.vertex = device.createBuffer({
      label: `Constrained Token Vertices Buffer`,
      size: this.vertexArrayBuffer.byteLength, // Or offsetData.vertex.totalSize
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.buffers.vertex, 0, this.vertexArrayBuffer);

    this.buffers.index = device.createBuffer({
      label: `Constrained Token Vertices Buffer`,
      size: this.indexArrayBuffer.byteLength, // Or offsetData.index.totalSize
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(this.buffers.index, 0, this.indexArrayBuffer);


    // Must set the canvas context immediately prior to render.
    const view = this.#context ? this.#context.getCurrentTexture().createView() : this.renderTexture.createView();
    if ( this.sampleCount > 1 ) this.colorAttachment.resolveTarget = view;
    else {
      this.colorAttachment.view = view;
      this.colorAttachment.resolveTarget = undefined;
    }

    const commandEncoder = device.createCommandEncoder({ label: "Render tokens" });
    const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
    renderPass.setPipeline(this.pipelines.render);
    renderPass.setBindGroup(0, this.bindGroups.camera);

    for ( let i = 0, n = tokens.length; i < n; i += 1 ) {
      const token = tokens[i];
      // if ( token === viewer ) continue;
      const geom = geoms[i];
      const vOffset = offsetData.vertex.offsets[i];
      const iOffset = offsetData.index.offsets[i];
      geom.setVertexBuffer(renderPass, this.buffers.vertex, vOffset);
      geom.setIndexBuffer(renderPass, this.buffers.index, iOffset);
      geom.draw(renderPass);
    }

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    return this.device.queue.onSubmittedWorkDone();
  }

  // ----- Token placeable handling ----- //

  /** @type {Map<string, Edge>} */
  instanceIndexFromId = new Map();

  /** @type {Map<string, Token>} */
  #tokenFromInstanceIndex = new Map();

  /** @type {number} */
  get numTokens() { return this.instanceIndexFromId.size; }

  /** @type {ArrayBuffer} */
  instanceArrayBuffer;

  get vertexArrayValues() { return new Float32Array(this.vertexArrayBuffer); }

  /**
   * 32 vertex entries per edge for top, bottom; 48 for sides.
   * @type {number}
   */
  get maxInstanceSize() { return this.maxVertices * (32 + 32 + 48) * Float32Array.BYTES_PER_ELEMENT; }

  /**
   * For a given token id, return the token object, if it exists.
   * @param {string} id
   * @returns {Token|undefined}
   */
  tokenForId(tokenId) { return canvas.tokens.documentCollection.get(tokenId)?.object; }

  /**
   * Initialize all tokens.
   * TODO: Handle tokens in hex grids
   */
  initializeTokens() {
    this.instanceIndexFromId.clear();
    this.#tokenFromInstanceIndex.clear();
    const tokens = canvas.tokens.placeables.filter(token => this.includeToken(token));

    // Create a vertex buffer.
    // Confirm the maximum polygon points and thus maximum buffer size per token.
    // Buffer will be sized accordingly, e.g.,
    // T0 T0 T0 • • • T1 T1 • • • • T2 T2 T2 T2 T2 T2...
    this.maxVertices = Math.max(this.maxVertices, ...tokens.map(t => {
      const border = t.constrainedTokenBorder;
      if ( border instanceof PIXI.Rectangle ) return 4;
      return Math.floor(border.toPolygon().points.length / 2);
    }));

    // 32 vertex entries per edge for top, bottom; 48 for sides.
    this.vertexArrayBuffer = new ArrayBuffer(tokens.length * this.maxInstanceSize);

    tokens.forEach((token, idx) => {
      // Not instances per se, but offsets in the vertex buffer.
      this.instanceIndexFromId.set(token.id, idx);
      this.#tokenFromInstanceIndex.set(idx, token);
      this.updateTokenVertexData(token.id, idx, token);
    });
  }

  /**
   * Should this token be included in the scene render?
   * TODO: Filter out constrained tokens.
   */
  includeToken(_token) {
    return true;
  }

  // ----- Instances ----- //

  /**
   * @typedef {object} TokenInstanceData
   * @prop {Float32Array[16]} model           Model matrix (translation, rotation, scale)
   */

  /** @type {MatrixFlat<4,4>} */
  #translationM = CONFIG.GeometryLib.MatrixFloat32.empty(4, 4);

  /** @type {MatrixFlat<4,4>} */
  #scaleM = CONFIG.GeometryLib.MatrixFloat32.empty(4, 4);

  /**
   * Update the vertex array of a specific token.
   * @param {string} tokenId       Id of the token
   * @param {number} [idx]        Optional token id; will be looked up using tokenId otherwise
   * @param {Token} [token]         The token associated with the id; will be looked up otherwise
   */
  updateTokenVertexData(tokenId, idx, token) {
    idx ??= this.instanceIndexFromId(tokenId);
    token ??= this.tokenForId(tokenId);
    const vertexArr = this.getTokenInstanceData(tokenId, idx);
    const geom = new GeometryConstrainedTokenDesc(token, { label: `Constrained Token ${tokenId}` });
    if ( geom.arr.length > vertexArr.length ) throw Error("updateTokenVertexData|Geometry is longer than maximum vertex array."); // TODO: Fix so this triggers a full rebuild. Set a #dirty flag?

//     vertexArr.fill(0); // Clear in case the new geom is less.
//     vertexArr.set(geom.vertices);
//
//     indexArr.fill(0);
//     indexArr.set(geom.indices)
  }

  /**
   * Retrieve the array views associated with a given token.
   * @param {string} tokenId       Id of the token
   * @param {number} [idx]        Optional token id; will be looked up using tokenId otherwise
   */
  getTokenInstanceData(tokenId, idx) {
    idx ??= this.instanceIndexFromId.get(tokenId);
    const i = idx * this.maxInstanceSize;
    return new Float32Array(this.instanceArrayBuffer, i, this.maxInstanceSize);
  }

  /**
   * Update the instance buffer on the GPU for a specific token.
   * @param {string} tokenId
   * @param {Float32Array} dat      Buffer from tokenInstanceData method
   * @param {number} [idx]          Instance index of this token
   */
  partialUpdateInstanceBuffer(tokenId, idx) {
    idx ??= this.instanceIndexFromId.get(tokenId);
    const dat = this.getEdgeInstanceData(tokenId, idx);
    this.device.queue.writeBuffer(
      this.buffers.instance, idx * this.constructor.INSTANCE_ELEMENT_LENGTH, dat.buffer,
    );
  }

  /**
   * Determine the token 3d dimensions, in pixel units.
   * @param {Token} token
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} zHeight     In z direction
   */
  static tokenDimensions(token) {
    return {
      width: token.document.width * canvas.dimensions.size,
      height: token.document.height * canvas.dimensions.size,
      zHeight: token.topZ - token.bottomZ,
    };
  }

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
    this.#renderTexture = value;
    this.#context = undefined;
  }

  #allocateRenderTargets() {
    const sampleCount = this.sampleCount;

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
    label: "Wall RenderPass",
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
      size: this.renderSize,
      sampleCount: this.sampleCount,
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
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
  #renderSize = { width: 200, height: 200 };

  get renderSize() { return this.#renderSize; }

  set renderSize(value) {
    this.#renderSize.width = value.width;
    this.#renderSize.height = value.height;
    this.#allocateRenderTargets();
  }
}


