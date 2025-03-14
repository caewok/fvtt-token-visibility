/* globals
canvas,
CONFIG,
CONST,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";
import { Camera } from "./Camera.js";
import { Geometry } from "./Geometry.js";
import { GeometryWallDesc } from "./GeometryWall.js";

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

  static BINDGROUP_OPTS = {
    INSTANCE: {
      label: "Instance",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      }]
    },

    CAMERA: {
      label: "Camera BindGroupLayout",
      entries: [{
        binding: 0, // Camera/Frame uniforms
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: {},
      }]
    },
  }


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

  async initialize() {
    const device = this.device ??= await WebGPUDevice.getDevice();

    // Define shader.
    this.modules.render = await WebGPUShader.fromGLSLFile(device, "wall", "Wall Render");

    // Define bind group layouts.
    const BG_OPTS = this.constructor.BINDGROUP_OPTS;
    this.bindGroupLayouts.camera = device.createBindGroupLayout(BG_OPTS.CAMERA);
    this.bindGroupLayouts.instance = device.createBindGroupLayout(BG_OPTS.INSTANCE);

    // Determine the wall geometry.
    this.geometry = new Geometry(device, new GeometryWallDesc());

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
        buffers: this.geometry.buffers,
      },
      fragment: {
        module: this.modules.render,
        entryPoint: "fragmentMain",
        targets: [{
          format: WebGPUDevice.presentationFormat,
        }],
      },
      depthStencil: {
        format: this.depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      }
    });

    // Identify edges in the scene.
    this.initializeEdges();

    // Define buffers and instances.
    this.buffers.camera = this.device.createBuffer({
      label: "Camera",
      size: Camera.CAMERA_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.buffers.instance = this.device.createBuffer({
      label: "Instance",
      size: this.numEdges * this.constructor.INSTANCE_ELEMENT_LENGTH,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    })
    this.updateInstanceBuffer();

    // Define bind groups.
    this.bindGroups.camera = this.device.createBindGroup({
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

    // this.pipelines.render = await this.pipelines.render;
  }

  /**
   * Render the scene from a given viewpoint.
   * TODO: Use dirty flag(s) to update 1+ drawable instances?
   * @param {Point3d} viewerLocation
   * @param {Token} target
   */
  async renderScene(viewerLocation, target) {
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustrum(target);
    this.device.queue.writeBuffer(this.buffers.camera, 0, this.camera.cameraArrayBuffer);

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.pushDebugGroup("Outside Render Pass");
    const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
    renderPass.pushDebugGroup('Inside Render Pass');
    this.drawScene(renderPass);
    renderPass.popDebugGroup();
    renderPass.end();
    commandEncoder.popDebugGroup();
    this.device.queue.submit([commandEncoder.finish()]);
    return this.device.queue.onSubmittedWorkDone();
  }

  /**
   * Render every drawable in the scene.
   * @param {GPURenderEncoder} renderEncoder
   */
  drawScene(renderEncoder) {
    renderEncoder.pushDebugGroup("Draw Scene");
    renderEncoder.setBindGroup(0, this.bindGroups.camera);
    renderEncoder.setPipeline(this.pipelines.render);
    renderEncoder.setBindGroup(1, this.bindGroups.instance);
    this.geometry.setBuffers(renderEncoder);

    // TODO: use culling.
    // Instanced for now.
    this.geometry.draw(renderEncoder, this.numEdges);
    renderEncoder.popDebugGroup();
  }


  // ----- Wall placeable handling ----- //

  /** @type {Map<string, Edge>} */
  edges = new Map();

  /** @type {Map<string, number>} */
  #edgeInstanceIndices = new Map();

  /** @type {number} */
  get numEdges() { return this.edges.size; }

  /**
   * Initialize all edges.
   */
  initializeEdges() {
    this.edges.clear();
    const edges = [...canvas.edges.values()].filter(edge => this.includeEdge(edge));
    this.instanceArrayBuffer = new ArrayBuffer(edges.length * this.constructor.INSTANCE_ELEMENT_LENGTH);
    edges.forEach((edge, idx) => {
      this.edges.set(edge.id, edge);
      this.#edgeInstanceIndices.set(edge.id, idx);
      this.updateEdgeInstanceData(edge.id, idx, edge);
    });
  }

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


  // ----- Instances ----- //

  /**
   * @typedef {object} EdgeInstanceData
   * @prop {Float32Array[2]} position         From wall center (vec2f)
   * @prop {Float32Array[2]} elevation        In pixel units (vec2f)
   * @prop {Float32Array[1]} rotation         In radians (float)
   * @prop {Float32Array[1]} length           2d length from vertex A to B (float)
   */

  /**
   * Update the instance array of a specific edge.
   * @param {string} edgeId       Id of the edge
   * @param {number} [idx]        Optional edge id; will be looked up using edgeId otherwise
   * @param {Edge} [edge]         The edge associated with the id; will be looked up otherwise
   */
  updateEdgeInstanceData(edgeId, idx, edge) {
    edge ??= this.edges.get(edgeId);
    const pos = this.constructor.edgeCenter(edge);
    const elev = this.constructor.edgeElevation(edge);
    const rot = this.constructor.edgeAngle(edge);
    const ln = this.constructor.edgeLength(edge);
    const dat = this.getEdgeInstanceData(edgeId, idx);
    dat.position.set([pos.x, pos.y]);
    dat.elevation.set([elev.top, elev.bottom]);
    dat.rotation.set([rot]);
    dat.length.set([ln]);
  }

  /**
   * Retrieve the array views associated with a given edge.
   * @param {string} edgeId       Id of the edge
   * @param {number} [idx]        Optional edge id; will be looked up using edgeId otherwise
   */
  getEdgeInstanceData(edgeId, idx) {
    idx ??= this.#edgeInstanceIndices.get(edgeId);
    const i = idx * this.constructor.INSTANCE_ELEMENT_LENGTH;
    return {
      position: new Float32Array(this.instanceArrayBuffer, i, 2),       // vec2f
      elevation: new Float32Array(this.instanceArrayBuffer, i + 8, 2),  // vec2f
      rotation: new Float32Array(this.instanceArrayBuffer, i + 16, 1),  // f32
      length: new Float32Array(this.instanceArrayBuffer, i + 20, 1),    // f32
      buffer: new Float32Array(this.instanceArrayBuffer, i, 6)          // combined
    };
  }

  /**
   * Update the instance buffer on the GPU for all instances.
   */
  updateInstanceBuffer() {
    this.device.queue.writeBuffer(
      this.buffers.instance, 0, this.instanceArrayBuffer, // 0 , this.constructor.INSTANCE_ELEMENT_LENGTH * this.numEdges
    );
  }

  /**
   * Update the instance buffer on the GPU for a specific edge.
   * @param {string} edgeId
   * @param {Float32Array} dat      Buffer from edgeInstanceData method
   * @param {number} [idx]          Instance index of this edge
   */
  partialUpdateInstanceBuffer(edgeId, idx) {
    idx ??= this.#edgeInstanceIndices.get(edgeId);
    const dat = this.getEdgeInstanceData(edgeId, idx);
    this.device.queue.writeBuffer(
      this.buffers.instance, idx * this.constructor.INSTANCE_ELEMENT_LENGTH, dat.buffer,
    );
  }

  /**
   * Determine the top and bottom edge elevations. Null values will be given large constants.
   * @param {Edge} edge
   * @returns {object}
   * - @prop {number} top         1e05 if null
   * - @prop {number} bottom      -1e05 if null
   */
  static edgeElevation(edge) {
    let { top, bottom } = edge.elevationLibGeometry.a;
    top ??= 1e05;
    bottom ??= -1e05;
    top = CONFIG.GeometryLib.utils.gridUnitsToPixels(top);
    bottom = CONFIG.GeometryLib.utils.gridUnitsToPixels(bottom);
    return { top, bottom };
  }

  /**
   * Determine the 2d center point of the edge.
   * @param {Edge} edge
   * @returns {PIXI.Point}
   */
  static edgeCenter(edge) {
    const ctr = new PIXI.Point();
    return edge.a.add(edge.b, ctr).multiplyScalar(0.5, ctr);
  }

  /**
   * Determine the 2d length of the edge.
   * @param {Edge} edge
   * @returns {number}
   */
  static edgeLength(edge) { return PIXI.Point.distanceBetween(edge.a, edge.b); }

  /**
   * Angle of the edge on the 2d canvas.
   * @param {Edge} edge
   * @returns {number} Angle in radians
   */
  static edgeAngle(edge) {
    const delta = edge.b.subtract(edge.a, PIXI.Point._tmp3);
    return Math.atan2(delta.y, delta.x);
  }

  // ----- NOTE: Rendering ----- //

  /** @type {string} */
  depthFormat = "depth24plus";

  /** @type {GPUTexture} */
  depthTexture;

  /** @type {GPUTexture} */
  #renderTexture;

  get renderTexture() {
    if ( !this.#renderTexture ) this.setRenderTextureToNewTexture();
    return this.#renderTexture;
  }

  set renderTexture(value) { this.#renderTexture = value; }

  /** @type {object} */
  colorAttachment = {
     // Appropriate target will be populated in onFrame
    view: undefined,
    resolveTarget: undefined,
    clearValue: this.clearColor,
    loadOp: "clear",
    storeOp: "discard",
  };

  /** @type {object} */
  renderPassDescriptor = {
    colorAttachments: [],
    depthStencilAttachment: {
      view: undefined,
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "discard"
    }
  };

  /**
   * Create a new texture to store the render.
   */
  setRenderTextureToNewTexture() {
   // TODO: Set alphaMode to "opaque"?
    this.#renderTexture = this.device.createTexture({
      size: [this.renderSize.width, this.renderSize.height, 1],
      dimension: "2d",
      format: WebGPUDevice.presentationFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, // Unneeded: GPUTextureUsage.TEXTURE_BINDING,
    });
    this.allocateRenderTargets();
  }

  /**
   * Set the render destination to a scene context, primarily for debugging.
   * @param {}
   */
  setRenderTextureToCanvas(context) {
    // TODO: Set alphaMode to "opaque"?
    context.configure({
      device: this.device,
      format: WebGPUDevice.presentationFormat,
    });
    this.#renderTexture = context.getCurrentTexture();
    this.renderSize = { width: this.#renderTexture.width, height: this.#renderTexture.height };
    this.allocateRenderTargets();
  }

  /** @type {object<width: {number}, height: {number}>} */
  #renderSize = { width: 200, height: 200 };

  get renderSize() { return this.#renderSize; }

  set renderSize(value) {
    this.#renderSize.width = value.width;
    this.#renderSize.height = value.height;
    this.allocateRenderTargets();
  }

  allocateRenderTargets() {
    const size = this.renderSize;

    if ( this.depthTexture ) {
      this.depthTexture.destroy();
      this.depthTexture = undefined;
    }

    this.depthTexture = this.device.createTexture({
      size,
      sampleCount: this.sampleCount,
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.colorAttachment.resolveTarget = undefined;
    this.colorAttachment.view = this.renderTexture.createView();
    this.colorAttachment.clearValue = this.clearColor;

    this.renderPassDescriptor.colorAttachments[0] = this.colorAttachment;
    this.renderPassDescriptor.depthStencilAttachment.view = this.depthTexture.createView();
  }
}


