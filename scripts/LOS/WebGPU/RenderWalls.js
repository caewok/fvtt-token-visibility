/* globals
canvas,
CONFIG,
CONST
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";
import { Camera } from "./Camera.js";
import { vec4, mat4 } from "../gl_matrix/index.js";

export class RenderWalls {
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
  };

  static VERTEX_LAYOUT = [{
    // See https://toji.dev/webgpu-best-practices/compute-vertex-data.html
    // 3 floats, tightly packed.
    arrayStride: Float32Array.BYTES_PER_ELEMENT * 3,
    stepMode: "vertex",
    attributes: [{
      format: "float32x3",
      offset: 0,
      shaderLocation: 0, // pos
    }]
  }];

  // See https://webgpufundamentals.org/webgpu/lessons/resources/wgsl-offset-computer.html
  /*
  const InstanceDataValues = new ArrayBuffer(24);
  const InstanceDataViews = {
    position: new Float32Array(InstanceDataValues, 0, 2),
    elevation: new Float32Array(InstanceDataValues, 8, 2),
    rotation: new Float32Array(InstanceDataValues, 16, 1),
    length: new Float32Array(InstanceDataValues, 20, 1),
  };
  */
  static INSTANCE_ELEMENT_LENGTH = 24;

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
  edgeVertexPositions;

  /** @type {Uint16Array} */
  edgeVertexIndices;

  async initialize() {
    const device = this.device ??= await WebGPUDevice.getDevice();

    // Define shader.
    this.modules.render = await WebGPUShader.fromGLSLFile(device, "wall", "Wall Render");

    // Define edges.
    // For now, pull geometry data from the edge.
    const edges = [...canvas.edges.values()].filter(edge => this.includeEdge(edge));

    // Combine edges to single buffer.
    this.edgeVertexPositions = new Float32Array(edges.length * 3 * 4);
    this.edgeVertexIndices = new Uint16Array(edges.length * 3 * 4); // Note this is always a multiple of 4.
    let offset = 0;
    let offsetV = 0; // To increment the vertices for each subsequent edge.
    for ( const edge of edges ) {
      const geom = edge.object._atvPlaceableGeometry.geometry;
      const vBuff = geom.getBuffer("aVertex").data;
      const iBuff = geom.indexBuffer.data;
      this.edgeVertexPositions.set(vBuff, offset);
      this.edgeVertexIndices.set(iBuff.map(elem => elem + offsetV), offset);
      offset += 12;
      offsetV += 4
    }

    // Can compare against defined matrices.
    // vp = viewer.vision.tokenvisibility.losCalc.viewpoints[0]
    // vp.shaders.obstacle
    // vp.shaders.obstacle.uniforms

    // Add 1 to each vertex to make a vec4. To avoid the vec3 sizing issue.
    /*
    this.edgeVertexPositions = new Float32Array(edges.length * 4 * 4);
    this.edgeVertexIndices = new Uint16Array(edges.length * 3 * 4);
    let posOffset = 0;
    let idxOffset = 0;
    for ( const edge of edges ) {
      const geom = edge.object._atvPlaceableGeometry.geometry;
      const vBuff = geom.getBuffer("aVertex").data;
      const iBuff = geom.indexBuffer.data;
      for ( let oldI = 0, newP = 0, newI = 0; oldI < 12; oldI += 3, newP += 4, newI += 3 ) {
        this.edgeVertexPositions.set(vBuff.slice(oldI, oldI + 3), newP);
        this.edgeVertexPositions.set([1], newP + 3);
        this.edgeVertexIndices.set(vIndex.slice(oldI, oldI + 3), newI);
        this.edgeVertexIndices.set([1], newI + 2);
      }
    }
    */

    // For debugging, manually apply the camera matrices.
    /*
    for ( let i = 0, n = this.edgeVertexPositions.length; i < n; i += 3 ) {
      const tmpMat = mat4.create();
      const cameraPos = vec4.create();
      const newV = vec4.create();
      const v = this.edgeVertexPositions.slice(i, i + 3);
      vec4.transformMat4(cameraPos, v, this.camera.lookAtMatrix);
      mat4.multiply(tmpMat, this.camera.perspectiveMatrix, this.camera.offsetMatrix);
      vec4.transformMat4(newV, cameraPos, tmpMat);
      this.edgeVertexPositions.set(newV, i);
    }
    */

    // Using Point3d and MatrixFlat
    /*
    const camera = this.camera;
    const edgeVertexPositions = this.edgeVertexPositions;
    Point3d = CONFIG.GeometryLib.threeD.Point3d;
    MatrixFlat = CONFIG.GeometryLib.MatrixFlat;
    lookAtM = MatrixFlat.fromColumnMajorArray(camera.lookAtMatrix, 4, 4)
    perspectiveM = MatrixFlat.fromColumnMajorArray(camera.perspectiveMatrix, 4, 4)
    offsetM = MatrixFlat.fromColumnMajorArray(camera.offsetMatrix, 4, 4)

    pParams = camera.perspectiveParameters;
    MatrixFlat.perspective(pParams.fov, pParams.aspect, pParams.near, pParams.far)

    oldVertices = [];
    newVertices = [];
    for ( let i = 0, n = edgeVertexPositions.length; i < n; i += 3 ) {
      const v = new Point3d(...edgeVertexPositions.slice(i, i + 3));
      const cameraPos = lookAtM.multiplyPoint3d(v);
      const newV = offsetM.multiply(perspectiveM).multiplyPoint3d(cameraPos);
      oldVertices.push(v)
      newVertices.push(newV)
    }
    */

    // For debugging, make a triangle.
    /*
    this.edgeVertexPositions = new Float32Array([
      0.0, 0.5, 0.0,
      -0.5, -0.5, 0.0,
      0.5, -0.5, 0.0,
    ]);
    this.edgeVertexIndices = new Uint16Array([
      0, 1, 2, 0 // Multiple of 4.
    ]);
    */


    // Vertex and index buffers.
    this.buffers.position = device.createBuffer({
      label: "Vertices",
      size: this.edgeVertexPositions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.buffers.position, 0, this.edgeVertexPositions);

    this.buffers.indices = device.createBuffer({
      label: "Indices",
      size: this.edgeVertexIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.buffers.indices, 0, this.edgeVertexIndices);

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
        buffers: this.constructor.VERTEX_LAYOUT,
      },
      fragment: {
        module: this.modules.render,
        entryPoint: "fragmentMain",
        targets: [{ format: WebGPUDevice.presentationFormat }],
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
  async renderScene(viewerLocation, target, vp) {
    const device = this.device ??= await WebGPUDevice.getDevice();
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;

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

    // this.camera.setTargetTokenFrustrum(target);
    this.device.queue.writeBuffer(this.buffers.camera, 0, this.camera.arrayBuffer);

    // Must set the canvas context immediately prior to render.
    const view = this.#context ? this.#context.getCurrentTexture().createView() : this.renderTexture.createView();
    if ( this.sampleCount > 1 ) this.colorAttachment.resolveTarget = view;
    else {
      this.colorAttachment.view = view;
      this.colorAttachment.resolveTarget = undefined;
    }

    const commandEncoder = device.createCommandEncoder({ label: "Render walls" });
    const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
    renderPass.setPipeline(this.pipelines.render);
    renderPass.setBindGroup(0, this.bindGroups.camera);
    renderPass.setVertexBuffer(0, this.buffers.position);
    renderPass.setIndexBuffer(this.buffers.indices, "uint16");

    // renderPass.draw(3);
    // renderPass.drawIndexed(3);
    renderPass.drawIndexed(this.edgeVertexIndices.length);
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    return this.device.queue.onSubmittedWorkDone();
  }

  // ----- Wall placeable handling ----- //

  edgeTypes = new Set(["wall"]);

  /**
   * Should this edge be included in the scene render?
   * Certain edges, like scene borders, are excluded.
   */
  includeEdge(edge) {
    if ( edge[this.senseType] === CONST.WALL_SENSE_TYPES.NONE ) return false;
    if ( !this.edgeTypes.has(edge.type) ) return false;
    return true;
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


