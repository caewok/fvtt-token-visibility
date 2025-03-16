/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";
import { Camera } from "./Camera.js";
import { mat4, vec3 } from "../gl_matrix/index.js";
import { GeometryTokenDesc } from "./GeometryToken.js";

const vec3Tmp = vec3.create();

export class RenderTokens {
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

    INSTANCE: {
      label: "Instance",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      }]
    },
  };


  // See https://webgpufundamentals.org/webgpu/lessons/resources/wgsl-offset-computer.html
  /*
  const InstanceDataValues = new ArrayBuffer(64);
  const InstanceDataViews = {
    model: new Float32Array(InstanceDataValues)
  };
  */
  static INSTANCE_ELEMENT_LENGTH = 64;

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
    this.modules.render = await WebGPUShader.fromGLSLFile(device, "token", "Token Render");

    this.initializeTokens();

    // Vertex buffer
    const geometryDesc = new GeometryTokenDesc({ label: "Token Geometry", directional: false });
    this.geometryDesc = geometryDesc;
    const numVertexBuffers = geometryDesc.verticesData.length;
    this.buffers.vertex = Array(numVertexBuffers);
    for ( let i = 0; i < numVertexBuffers; i += 1 ) {
      const data = geometryDesc.verticesData[i];
      this.buffers.vertex[i] = device.createBuffer({
        label: `Token Vertices Buffer ${i}`,
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(this.buffers.vertex[i], 0, data);
    }

    // Uniform buffers.
    this.buffers.camera = device.createBuffer({
      label: "Camera",
      size: Camera.CAMERA_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Will be written to GPU prior to render, because the camera view will change.

    this.buffers.instance = this.device.createBuffer({
      label: "Token Instance",
      size: this.numTokens * this.constructor.INSTANCE_ELEMENT_LENGTH,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.buffers.instance, 0, this.instanceArrayBuffer); // 0 , this.constructor.INSTANCE_ELEMENT_LENGTH * this.numTokens


    // Define bind group layouts.
    const BG_OPTS = this.constructor.BINDGROUP_OPTS;
    this.bindGroupLayouts.camera = device.createBindGroupLayout(BG_OPTS.CAMERA);
    this.bindGroupLayouts.instance = device.createBindGroupLayout(BG_OPTS.INSTANCE);

    // Define pipelines.
    // TODO: Make async.
    // this.modules.render = await this.modules.render;
    this.pipelines.render = device.createRenderPipeline({
      label: "Render",
      layout: device.createPipelineLayout({ bindGroupLayouts: [
        this.bindGroupLayouts.camera,
        this.bindGroupLayouts.instance,
      ]}),
      vertex: {
        module: this.modules.render,
        entryPoint: "vertexMain",
        buffers: geometryDesc.buffersLayout,
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

    this.bindGroups.instance = this.device.createBindGroup({
      label: "Instance",
      layout: this.bindGroupLayouts.instance,
      entries: [{
        binding: 0,
        resource: { buffer: this.buffers.instance }
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
  async renderScene(viewerLocation, target, vp) {
    const device = this.device ??= await WebGPUDevice.getDevice();
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustrum(target);

    // For debugging, copy from existing viewer viewpoint uniforms.

    this.camera.perspectiveParameters = {
      fov: vp.shaders.obstacle.fovy,
      aspect: 1,
      zNear: vp.shaders.obstacle.near,
      zFar: vp.shaders.obstacle.far,
    };

    // vp.shaders.obstacle.uniforms.uLookAtMatrix
    // vp.shaders.obstacle.uniforms.uPerspectiveMatrix
    // vp.shaders.obstacle.uniforms.uOffsetMatrix


    this.device.queue.writeBuffer(this.buffers.camera, 0, this.camera.arrayBuffer);

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
    renderPass.setBindGroup(1, this.bindGroups.instance);

    for ( let i = 0, n = this.buffers.vertex.length; i < n; i += 1 ) {
      renderPass.setVertexBuffer(0, this.buffers.vertex[i]);
    }

    // renderPass.setIndexBuffer(this.buffers.indices, "uint16");

    // renderPass.draw(3);
    // renderPass.drawIndexed(3);
    // renderPass.drawIndexed(this.tokenVertexIndices.length);
    renderPass.draw(this.geometryDesc.numVertices, this.numTokens);
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    return this.device.queue.onSubmittedWorkDone();
  }

  // ----- Token placeable handling ----- //

  /** @type {Map<string, Edge>} */
  tokens = new Map();

  /** @type {Map<string, number>} */
  #tokenInstanceIndices = new Map();

  /** @type {number} */
  get numTokens() { return this.tokens.size; }

  /** @type {ArrayBuffer} */
  instanceArrayBuffer;

  get instanceArrayValues() { return new Float32Array(this.instanceArrayBuffer); }

  /**
   * Initialize all tokens.
   * TODO: Handle tokens in hex grids
   */
  initializeTokens() {
    this.tokens.clear();
    const tokens = canvas.tokens.placeables.filter(token => this.includeToken(token));
    this.instanceArrayBuffer = new ArrayBuffer(tokens.length * this.constructor.INSTANCE_ELEMENT_LENGTH);
    tokens.forEach((token, idx) => {
      this.tokens.set(token.id, token);
      this.#tokenInstanceIndices.set(token.id, idx);
      this.updateTokenInstanceData(token.id, idx, token);
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

  /** @type {mat4} */
  #translationM = mat4.create();

  /** @type {mat4} */
  #scaleM = mat4.create();

  /**
   * Update the instance array of a specific token.
   * @param {string} tokenId       Id of the token
   * @param {number} [idx]        Optional token id; will be looked up using tokenId otherwise
   * @param {Token} [token]         The token associated with the id; will be looked up otherwise
   */
  updateTokenInstanceData(tokenId, idx, token) {
    token ??= this.tokens.get(tokenId);
    const ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
    const { width, height, zHeight } = this.constructor.tokenDimensions(token);

    // Move from center of token.
    const translateVec = vec3Tmp;
    translateVec[0] = ctr.x;
    translateVec[1] = ctr.y;
    translateVec[2] = ctr.z;
    mat4.fromTranslation(this.#translationM, translateVec);

    // Scale based on width, height, zHeight of token.
    const scaleVec = vec3Tmp;
    scaleVec[0] = width * 0.5;
    scaleVec[1] = height * 0.5;
    scaleVec[2] = zHeight * 0.5;
    mat4.fromScaling(this.#scaleM, scaleVec);

    // Combine and update the instance matrix. Multiplies right-to-left.
    // scale --> rotate --> translate.
    const M = this.getTokenInstanceData(tokenId, idx);
    mat4.multiply(M, this.#translationM, this.#scaleM);

    return {
      translation: this.#translationM,
      scale: this.#scaleM,
      out: M
    };
  }

  /**
   * Retrieve the array views associated with a given token.
   * @param {string} tokenId       Id of the token
   * @param {number} [idx]        Optional token id; will be looked up using tokenId otherwise
   */
  getTokenInstanceData(tokenId, idx) {
    idx ??= this.#tokenInstanceIndices.get(tokenId);
    const i = idx * this.constructor.INSTANCE_ELEMENT_LENGTH;
    return new Float32Array(this.instanceArrayBuffer, i, 16);
  }

  /**
   * Update the instance buffer on the GPU for a specific token.
   * @param {string} tokenId
   * @param {Float32Array} dat      Buffer from tokenInstanceData method
   * @param {number} [idx]          Instance index of this token
   */
  partialUpdateInstanceBuffer(tokenId, idx) {
    idx ??= this.#tokenInstanceIndices.get(tokenId);
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


