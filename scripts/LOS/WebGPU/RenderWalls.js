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
    this.edgeVertexIndices = new Uint16Array(edges.length * 3 * 4);
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
//     this.pipelines.render = device.createRenderPipeline({
//       label: "Render",
//       layout: device.createPipelineLayout({ bindGroupLayouts: [
//         this.bindGroupLayouts.camera,
//       ]}),
//       vertex: {
//         module: this.modules.render,
//         entryPoint: "vertexMain",
//         buffers: this.constructor.VERTEX_LAYOUT,
//       },
//       fragment: {
//         module: this.modules.render,
//         entryPoint: "fragmentMain",
//         targets: [{
//           format: WebGPUDevice.presentationFormat,
//         }],
//       },
//       depthStencil: {
//         format: this.depthFormat,
//         depthWriteEnabled: true,
//         depthCompare: "less-equal",
//       }
//     });

    this.pipelines.render = device.createRenderPipeline({
      label: 'our hardcoded red triangle pipeline',
      layout: 'auto',
      vertex: {
        entryPoint: 'vs',
        module: this.modules.render,
      },
      fragment: {
        entryPoint: 'fs',
        module: this.modules.render,
        targets: [{ format: WebGPUDevice.presentationFormat }],
      },
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

    // this.pipelines.render = await this.pipelines.render;

    this.setDepthTexture();
  }

  /**
   * Render the scene from a given viewpoint.
   * TODO: Use dirty flag(s) to update 1+ drawable instances?
   * @param {Point3d} viewerLocation
   * @param {Token} target
   */
  async renderScene(viewerLocation, target) {
    const device = this.device ??= await WebGPUDevice.getDevice();

    /*
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    // this.camera.setTargetTokenFrustrum(target);
    this.device.queue.writeBuffer(this.buffers.camera, 0, this.camera.arrayBuffer);
     */

    /*
    if ( context ) {
      context.configure({
        device: this.device,
        format: WebGPUDevice.presentationFormat,
      });
      // Storing context.getCurrentTexture() does not work.
      this.colorAttachment.view = context.getCurrentTexture().createView();
    } else this.colorAttachment.view = renderTexture.createView();
    */
    // this.renderPassDescriptor.colorAttachments[0].view = popout.context.getCurrentTexture().createView();

    /*
    const renderPassDescriptor = {
      label: 'our basic canvas renderPass',
      colorAttachments: [
        {
          view: renderTexture.createView(),
          clearValue: [0.3, 0.3, 0.3, 1],
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],

    };
    */

    // Must set the canvas context immediately prior to render.
    if ( this.#context ) this.colorAttachment.view = this.#context.getCurrentTexture().createView();


    const commandEncoder = device.createCommandEncoder({ label: "Render walls" });
    // const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
    const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
    renderPass.setPipeline(this.pipelines.render);
    // renderPass.setBindGroup(0, this.bindGroups.camera);
    // renderPass.setVertexBuffer(0, this.buffers.position);
    // renderPass.setIndexBuffer(this.buffers.indices, "uint16");

    renderPass.draw(3);
    // renderPass.drawIndexed(this.edgeVertexIndices.length);
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

  /** @type {string} */
  depthFormat = "depth24plus";

  /** @type {GPUTexture} */
  depthTexture;

  /** @type {GPUTexture} */
  #renderTexture;

  get renderTexture() {
    // if ( !this.#renderTexture ) this.setRenderTextureToInternalTexture();
    return this.#renderTexture;
  }

  set renderTexture(value) {
    this.#renderTexture = value;
    this.colorAttachment.view = this.renderTexture.createView();
    this.#context = undefined;
  }

  #context;

  setRenderTextureToCanvas(context) {
    this.#context = context;
    this.#context.configure({
      device: this.device,
      format: WebGPUDevice.presentationFormat,
    });
  }

  removeCanvasRenderTexture() { this.#context = undefined; }

  /** @type {object} */
  colorAttachment = {
     // Appropriate target will be populated in onFrame
    view: undefined,
    clearValue: [0.3, 0.3, 0.3, 1],
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
    // depthStencilAttachment: this.depthStencilAttachment,
  };

  /**
   * Create a render texture that can be used to store the output of this render.
   * @returns {GPUTexture}
   */
  createRenderTexture() {
    return this.device.createTexture({
      size: [this.renderSize.width, this.renderSize.height, 1],
      dimension: "2d",
      format: WebGPUDevice.presentationFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, // Unneeded: GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  /** @type {object<width: {number}, height: {number}>} */
  #renderSize = { width: 200, height: 200 };

  get renderSize() { return this.#renderSize; }

  set renderSize(value) {
    this.#renderSize.width = value.width;
    this.#renderSize.height = value.height;
    this.allocateRenderTargets();
  }

  setDepthTexture() {
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

    this.depthStencilAttachment.view = this.depthTexture.createView();
  }
}


