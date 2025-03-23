/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { combineTypedArrays } from "../util.js";
import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";
import { Camera } from "./Camera.js";
import { GeometryDesc } from "./GeometryDesc.js";
import { GeometryWallDesc } from "./GeometryWall.js";
import {
  WallInstanceHandler,
  // DirectionalWallInstanceHandler,
  // NonDirectionalWallInstanceHandler,
  // TileInstanceHandler,
  // TokenInstanceHandler,
} from "./PlaceableInstanceHandler.js";


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


class RenderAbstract {
  /** @type {GPUDevice} */
  device;

  /** @type {Camera} */
  camera = new Camera();

  /** @type {object<GPUBindGroupLayout>} */
  bindGroupLayouts = {};

  /** @type {Map<string, GPUBindGroup>} */
  bindGroups = new Map();

  /** @type {object<GPUModule>} */
  modules = {};

  /** @type {object<GPUPipeline>} */
  pipelines = {};

  /** @type {object<GPUBuffer>} */
  buffers = {};

  /** @type {object<TypedArray>} */
  rawBuffers = {}; // For debugging.

  /**
   * @typedef {object} Drawable
   * Data to draw a given placeable on the scene.
   * @prop {string} label
   * @prop {GeometryDesc} geom
   * @prop {GPUBuffer} vertexBuffer
   * @prop {GPUBuffer} [indexBuffer]
   * @prop {GPUBuffer} [instanceBuffer]
   * @prop {number} [vOffset]             How far into the vertex buffer to start
   * @prop {number} [iOffset]             How far into the index buffer to start
   * @prop {number} [numInstances=0]
   * @prop {GPUBindGroup} [instanceBG]
   * @prop {GPUBindGroup} [materialBG]
   */
  /** @type {Map<string, drawable>} */
  drawables = new Map();

  static BINDGROUP_OPTS = {
    camera: {
      label: "Camera",
      entries: [{
        binding: 0, // Camera/Frame uniforms
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: {},
      }]
    },
    material: {
      label: 'Material',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {}
      }]
    }
  };

  /** @type {object} */
  RENDER_PIPELINE_OPTS = {
    label: "Render",
    layout: "auto",
    vertex: {
      module: null,
      entryPoint: "vertexMain",
      buffers: [],
    },
    fragment: {
      module: null,
      entryPoint: "fragmentMain",
      targets: [],
    },
    primitive: {
      cullMode: "back",
      frontFace: "ccw",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less-equal",
    },
    multisample: {
      count: 1,
    }
  }

  /**
   * Get the current device or attempt to get a new one if lost.
   */
  async getDevice() {
    if ( this.device ) return this.device;
    this.device = await WebGPUDevice.getDevice();
    return this.device;
  }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize() {
    const device = await this.getDevice();
    for ( const [key, opts] of Object.entries(this.constructor.BINDGROUP_OPTS) ) {
      this.bindGroupLayouts[key] = device.createBindGroupLayout(opts);
    }
    this._createCamera();
    this._createStaticDrawables();
    this._setStaticDrawableBuffers();
    this._createNonStaticDrawables();
    this._setRenderPipelineOpts();

    // TODO: make async.
    this.pipelines.render = device.createRenderPipeline(this.RENDER_PIPELINE_OPTS);
    this._allocateRenderTargets();
  }

  /** @type {override} */
  _createStaticDrawables() { }

  /** @type {override} */
  _setStaticDrawableBuffers() {
    const device = this.device;

    const geoms = Array(this.drawables.size);
    let i = 0;
    this.drawables.forEach(drawable => geoms[i++] = drawable.geom);
    const offsetData = GeometryDesc.computeBufferOffsets(geoms);
    const vertexArray = combineTypedArrays(...geoms.map(g => g.vertices));
    this.buffers.staticVertex = this.device.createBuffer({
        label: `Static Vertex Buffer`,
        size: offsetData.vertex.totalSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    device.queue.writeBuffer(this.buffers.staticVertex, 0, vertexArray);
    this.rawBuffers.staticVertex = vertexArray;

    if ( offsetData.index.totalSize ) {
      const indexArray = combineTypedArrays(...geoms.filter(g => Boolean(g.indices)).map(g => g.indices));
      this.buffers.staticIndex = this.device.createBuffer({
        label: `Static Index Buffer`,
        size: offsetData.index.totalSize,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(this.buffers.staticIndex, 0, indexArray);
      this.rawBuffers.staticIndex = indexArray;
    }

    i = 0;
    for ( const drawable of this.drawables.values() ) {
      drawable.render ??= (renderPass, opts) => this._renderDrawable(renderPass, drawable, opts);
      drawable.vertexBuffer = this.buffers.staticVertex;
      if ( drawable.geom.indices ) drawable.indexBuffer = this.buffers.staticIndex;

      drawable.vOffset = offsetData.vertex.offsets[i];
      drawable.iOffset = offsetData.index.offsets[i];
      i += 1;
    }
  }

  _createNonStaticDrawables() {}

  _updateNonStaticDrawables() {}

  _setRenderPipelineOpts() {
    this.RENDER_PIPELINE_OPTS.vertex.module = this.modules.render;
    this.RENDER_PIPELINE_OPTS.fragment.module = this.modules.render;
    this.RENDER_PIPELINE_OPTS.vertex.buffers = GeometryDesc.buffersLayout;
    this.RENDER_PIPELINE_OPTS.fragment.targets[0] = { format: WebGPUDevice.presentationFormat };
    this.RENDER_PIPELINE_OPTS.layout = this.device.createPipelineLayout({
      bindGroupLayouts: [...Object.values(this.bindGroupLayouts)]
    });
    this.RENDER_PIPELINE_OPTS.multisample.count = this.sampleCount ?? 1;
    this.RENDER_PIPELINE_OPTS.depthStencil.format = this.depthFormat ?? "depth24plus";
  }



  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  async prerender() {
    this._updateNonStaticDrawables();
  }

  async render(viewerLocation, target, { viewer, targetLocation } = {}) {
    const device = this.device;

    // Set up the camera.
    this._setCamera(viewerLocation, target, { viewer, targetLocation });

    // Must set the canvas context immediately prior to render.
    const view = this.#context ? this.#context.getCurrentTexture().createView() : this.renderTexture.createView();
    if ( this.sampleCount > 1 ) this.colorAttachment.resolveTarget = view;
    else {
      this.colorAttachment.view = view;
      this.colorAttachment.resolveTarget = undefined;
    }

    const opts = { viewer, target };
    const commandEncoder = device.createCommandEncoder({ label: "Renderer" });
    const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
    this._initializeRenderPass(renderPass, opts);
    this.drawables.forEach(drawable => drawable.render(renderPass, drawable, opts));
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    return this.device.queue.onSubmittedWorkDone();
  }

  /**
   * Set initial render items that will not be modified during this pass.
   * @param {GPUCommandEncoder} renderPass
   * @override
   */
  _initializeRenderPass(renderPass, _opts = {}) {
    renderPass.setPipeline(this.pipelines.render);
    renderPass.setBindGroup(0, this.bindGroups.get("camera"));
  }

  /**
   * Render a drawable.
   * @param {GPUCommandEncoder} renderPass
   * @param {string} key
   * @param {Drawable} drawable
   */
  _renderDrawable(renderPass, drawable, _opts = {}) {
    if ( drawable.materialBG ) renderPass.setBindGroup(1, drawable.materialBG);
    if ( drawable.instanceBG ) renderPass.setBindGroup(2, drawable.instanceBG);

    drawable.geom.setVertexBuffer(renderPass, drawable.vertexBuffer, drawable.vOffset);
    drawable.geom.setIndexBuffer(renderPass, drawable.indexBuffer, drawable.iOffset);
    drawable.geom.draw(renderPass);
  }


  /**
   * Create the camera buffer.
   */
  _createCamera() {
    const device = this.device;
    const buffer = this.buffers.camera = device.createBuffer({
      label: "Camera",
      size: Camera.CAMERA_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Buffer will be written to GPU prior to render, because the camera view will change.
    this.bindGroups.set("camera", device.createBindGroup({
      label: "Camera",
      layout: this.bindGroupLayouts.camera,
      entries: [{
        binding: 0,
        resource: { buffer }
      }],
    }));
  }

  /**
   * Set camera for a given render.
   */
  _setCamera(viewerLocation, target, { targetLocation } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustrum(target);
    this.device.queue.writeBuffer(this.buffers.camera, 0, this.camera.arrayBuffer);
    this.rawBuffers.camera = new Float32Array(this.camera.arrayBuffer)
  }

 /**
   * Define a material buffer and associated bind group.
   * Stores color associated with a drawable (instance).
   * @param {object} [opts]
   * @param {number} [opts.r=0]         Red; value between [0, 1]
   * @param {number} [opts.g=0]         Green; value between [0, 1]
   * @param {number} [opts.b=0]         Blue; value between [0, 1]
   * @param {number} [opts.a=1]         Alpha; value between [0, 1]
   * @param {string} [opts.label]       Name for the material
   */
  createMaterial({ r, g, b, a, label } = {}) {
    const device = this.device;
    this.buffers.materials ??= {};
    r ??= 0.0;
    g ??= 0.0;
    b ??= 0.0;
    a ??= 1.0;
    label ??= `Material (${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)}, ${a.toFixed(2)});`
    if ( this.bindGroups.has(label) ) return;

    // TODO: Don't really need to store the buffers.materials.
    const buffer = this.buffers.materials[label] = device.createBuffer({
      label,
      size: Float32Array.BYTES_PER_ELEMENT * 4,
      usage: GPUBufferUsage.UNIFORM,
      mappedAtCreation: true,
    });
    const materialArray = new Float32Array(buffer.getMappedRange());
    materialArray[0] = r;
    materialArray[1] = g;
    materialArray[2] = b;
    materialArray[3] = a;
    this.rawBuffers.materials ??= {};
    this.rawBuffers.materials[label] = new Float32Array(materialArray);
    buffer.unmap();

    this.bindGroups.set(label, device.createBindGroup({
      label,
      layout: this.bindGroupLayouts.material,
      entries: [{
        binding: 0,
        resource: { buffer }
      }],
    }));
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

  _allocateRenderTargets() {
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
    this._allocateRenderTargets();
  }
}

// TODO: Is a mixin useful here?
// const instanceMixin = function(Base) {
//   class RenderInstance extends Base {
//     static INSTANCE_ELEMENT_LENGTH = 64;
//
//     static BINDGROUP_OPTS = {
//       ...RenderAbstract.BINDGROUP_OPTS,
//
//       INSTANCE: {
//         label: "Instance",
//         entries: [{
//           binding: 0,
//           visibility: GPUShaderStage.VERTEX,
//           buffer: { type: "read-only-storage" },
//         }]
//       },
//     }
//
//     async initialize() {
//       const device = this.device ??= await WebGPUDevice.getDevice();
//       this.initializePlaceables();
//       return super.initialize();
//     }
//
//     _createInstance(label) {
//       this.buffers.instances = {};
//       this.buffers.instances.label = this.device.createBuffer({
//         label: "Instance",
//         size: this.numInstances * this.constructor.INSTANCE_ELEMENT_LENGTH,
//         usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
//       });
//       device.queue.writeBuffer(this.buffers.instance, 0, this.instanceArrayBuffer); // 0 , this.constructor.INSTANCE_ELEMENT_LENGTH * this.numInstances
//
//       this.bindGroupLayouts.instance = device.createBindGroupLayout(this.constructor.BINDGROUP_OPTS.INSTANCE);
//     }
//
//     /**
//      * Initialize one or more placeables for the scene.
//      * @overide
//      */
//     initializeInstances() {}
//
//     // TODO: updatePlaceable, deletePlaceable, addPlaceable?
//   }
//   return RenderInstance;
// }

// NOTE: For testing, define separate render wall, token, tile, constrained token.


export class RenderWalls extends RenderAbstract {
  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  /** @type {WallInstanceHandler} */
  wallHandler;

  static INSTANCE_ELEMENT_LENGTH = 64;

  static BINDGROUP_OPTS = {
    ...RenderAbstract.BINDGROUP_OPTS,

    instance: {
      label: "Instance",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      }]
    },
  }

  async initialize() {
    const device = await this.getDevice();

    // Define shader.
    this.modules.render = await WebGPUShader.fromGLSLFile(device, "wall", "Wall Render");

    await super.initialize();

    // Build the non-static drawables.
    this.initializeInstances();
  }

  initializeInstances() {
    const device = this.device;
    this.wallHandler = new WallInstanceHandler(this.senseType);
    this.wallHandler.initializePlaceables();

    // Construct the instance buffer and bind group for the non-directional wall drawable.
    const drawable = this.drawables.get("nodirwall");
    const buffer = drawable.instanceBuffer = this.device.createBuffer({
      label: "Non-Directional Wall Instance",
      size: this.wallHandler.instanceArrayBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, this.wallHandler.instanceArrayBuffer)
    this.rawBuffers.instance = new Float32Array(this.wallHandler.instanceArrayBuffer)

    drawable.instanceBG = device.createBindGroup({
      label: "Instance",
      layout: this.bindGroupLayouts.instance,
      entries: [{
        binding: 0,
        resource: { buffer }
      }],
    });

    // TODO: Construct the instance buffer and bind group for the directional wall drawable.
  }

  _createStaticDrawables() {
    this.createMaterial({ b: 1.0, label: "obstacle" });
    this.drawables.set("nodirwall", {
      label: "Non-directional wall",
      geom: new GeometryWallDesc({ directional: false }),
      materialBG: this.bindGroups.get("obstacle"),
    });
    // super._createStaticDrawables(); // Not needed here.
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  async prerender() {
    // TODO: Handle walls flagged as dirty.
    // TODO: Flag to trigger a prerender? E.g., token moves or wall changed...
    await super.prerender();
  }

}

// export class RenderTiles extends InstanceMixin(RenderAbstract) {
//
// }
//
// export class RenderTokens extends InstanceMixin(RenderAbstract) {
//
// }

export class RenderConstrainedTokens extends RenderAbstract {

}

// NOTE: Primary render obstacle class.
export class RenderObstacles extends RenderAbstract {
  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  constructor(device, { senseType = "sight" } = {}) {
    super(device);
    this.senseType = senseType;
  }
}

