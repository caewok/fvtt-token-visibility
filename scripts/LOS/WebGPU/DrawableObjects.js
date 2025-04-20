/* globals
CONFIG,
CONST,
foundry,
Hooks,
Wall,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "../../const.js";
import { combineTypedArrays, tokensOverlap } from "../util.js";
import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";
import { GeometryDesc } from "./GeometryDesc.js";
import { GeometryWallDesc } from "./GeometryWall.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc } from "./GeometryToken.js";
import { GeometryHorizontalPlaneDesc } from "./GeometryTile.js";
import {
  WallInstanceHandler,
  TerrainWallInstanceHandler,
  NonTerrainWallInstanceHandler,
  // DirectionalWallInstanceHandler,
  // NonDirectionalWallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
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

DrawableObjects:
- All objects that can be rendered using a single shader.
  - Tiles: Require a sampler
  - Instances of Walls, Tokens.
  - Constrained tokens (Could use the instance shader but would have to pass identity matrix, useless instance code)

async initialize: All operations that only need happen at start.
- _createStaticGeometries: Add to this.geometries array any instance geometries that won't change.
- _setStaticGeometriesBuffers: Define static vertex and index buffers, geometry offsets for those buffers.
- _createStaticDrawables: define combinations of drawables and materials that don't change.
vertices and indices that don't change, instance geometries.

initializePlaceableBuffers: All operations that must occur when the number of placeables change, but not necessarily data for a placeable.
--> Called at initialize and whenever object is added or deleted.
--> instance buffers, indirect buffer, culling buffers


prerender: Changes whenever a placeable is updated.

async render:

*/

class DrawableObjectsAbstract {
  static handlerClass;

  static shaderFile = "";

  static GROUP_NUM = {
    CAMERA: 0,
    MATERIALS: 1
  };


  placeableHandler;

  /** @type {GPUDevice} */
  device;

  /** @type {GPUModule} */
  module;

  /** @type {object<GPUPipeline>} */
  pipeline = {};

  /** @type {object<GPUBindGroupLayout>} */
  bindGroupLayouts = {};

  /** @type {GPUBindGroupLayout[]} */
  bindGroupLayoutsArray = Array(2);

  /** @type {object<GPUBindGroup>} */
  bindGroups = {};

  /** @type {object<GPUBuffer>} */
  buffers = {};

  /** @type {object<TypedArray>} */
  rawBuffers = {}; // For debugging.

  /** @type {MaterialTracker} */
  materials;

  /** @type {Camera} */
  camera;

  /** @type {GPUSampler} */
  samplers = {};

  /** @type {Map<GeometryDesc>} */
  geometries = new Map;

  /**
   * @typedef {object} Drawable
   * Data to draw a given placeable on the scene.
   * @prop {string} label
   * @prop {GeometryDesc} geom
   * @prop {number} [numInstances=0]
   * @prop {Set|[]} [instanceSet]
   * @prop {GPUBindGroup} [materialBG]
   * @prop {function} render
   */
  /** @type {Map<string, drawable>} */
  drawables = new Map();

  /** @type {object} */
  static BINDGROUP_LAYOUT_OPTS = {}

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
  };

  /**
   * @type {GPUDevice} device
   * @type {MaterialsTracker} materials
   * @type {object} [opts]
   */
  constructor(device, materials, camera, { debugViewNormals = false } = {}) {
    this.device = device;
    this.materials = materials;
    this.camera = camera;
    this.#debugViewNormals = debugViewNormals;
    this.placeableHandler = new this.constructor.handlerClass();
  }

  /** @type {boolean} */
  #debugViewNormals = false;

  get debugViewNormals() { return this.#debugViewNormals; }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize() {
    const device = this.device;
    this.placeableHandler.registerPlaceableHooks();

    for ( const [key, opts] of Object.entries(this.constructor.BINDGROUP_LAYOUT_OPTS) ) {
      this.bindGroupLayouts[key] = device.createBindGroupLayout(opts);
    }

    // Define shader and pipeline.
    const debugViewNormals = this.debugViewNormals;
    this.module = await WebGPUShader.fromGLSLFile(device, this.constructor.shaderFile, `${this.constructor.name} Shader`, { debugViewNormals });
    this._createPipeline();

    // Create static buffers.
    this._createStaticGeometries();
    this._createStaticDrawables();
    this._setStaticGeometriesBuffers();

    // Initialize the changeable buffers.
    this.initializePlaceableBuffers();
  }

  _createPipeline() {
    this._setRenderPipelineOpts();
    this.pipeline.default = this.device.createRenderPipeline(this.RENDER_PIPELINE_OPTS);
  }

  /**
   * Set up part of the render chain dependent on the number of placeables.
   * Called whenever a placeable is added or deleted (but not necessarily just updated).
   * E.g., wall is added.
   */
  initializePlaceableBuffers() {
    this.placeableHandler.initializePlaceables();
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {
    if ( this.placeableHandler.bufferId < this.#placeableHandlerBufferId ) {
      // One or more placeables were added/removed. Re-do the buffers.
      this.#placeableHandlerBufferId = this.placeableHandler.bufferId;
      this.initializePlaceableBuffers();
    }
  }

  /**
   * Render this drawable.
   * @param {CommandEncoder} renderPass
   */
  render(renderPass) {
    this.drawables.forEach(drawable => {
      this._initializeRenderPass(renderPass);
      this._renderDrawable(renderPass, drawable);
    });
  }

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {}

  /**
   * Define vertex and index buffers for the static geometries.
   * Geometries will share a single vertex buffer and single index buffer, with offsets.
   */
  _setStaticGeometriesBuffers() {
    if ( !this.geometries.size ) return;
    const geoms = [...this.geometries.values()];

    const offsetData = GeometryDesc.computeBufferOffsets(geoms);
    const vertexArray = combineTypedArrays(...geoms.map(g => g.vertices));
    this.buffers.staticVertex = this.device.createBuffer({
        label: "Static Vertex Buffer",
        size: offsetData.vertex.totalSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    this.device.queue.writeBuffer(this.buffers.staticVertex, 0, vertexArray);
    this.rawBuffers.staticVertex = vertexArray;

    if ( offsetData.index.totalSize ) {
      const indexArray = combineTypedArrays(...geoms.filter(g => Boolean(g.indices)).map(g => g.indices));
      this.buffers.staticIndex = this.device.createBuffer({
        label: "Static Index Buffer",
        size: offsetData.index.totalSize,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(this.buffers.staticIndex, 0, indexArray);
      this.rawBuffers.staticIndex = indexArray;
    }

    for ( let i = 0, n = geoms.length; i < n; i += 1 ) {
      const geom = geoms[i];
      geom.vertexBuffer = this.buffers.staticVertex;
      if ( geom.indices ) geom.indexBuffer = this.buffers.staticIndex;
      geom.vOffset = offsetData.vertex.offsets[i];
      geom.iOffset = offsetData.index.offsets[i];
    }
  }

  /**
   * Define the drawables, associating each with a geometry and other values, such as
   * materials.
   */
  _createStaticDrawables() {}

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   */
  filterObjects(_visionTriangle, _opts) {}

  /**
   * Called after pass has begun for this render object.
   * @param {CommandEncoder} renderPass
   */
  _initializeRenderPass(renderPass, pipelineName = "default") {
    renderPass.setPipeline(this.pipeline[pipelineName]);
    renderPass.setBindGroup(this.constructor.GROUP_NUM.CAMERA, this.camera.bindGroup);
  }

  /**
   * Called on each drawable for this render object.
   * @param {CommandEncoder} renderPass
   * @param {Drawable} drawable
   */
  _renderDrawable(renderPass, drawable) {
    if ( !drawable.instanceSet.size ) return;
    renderPass.setBindGroup(this.constructor.GROUP_NUM.MATERIAL, drawable.materialBG);

    drawable.geom.setVertexBuffer(renderPass);
    drawable.geom.setIndexBuffer(renderPass);
    drawable.geom.drawSet(renderPass, drawable.instanceSet);
  }

  /**
   * Called after the render pass has ended for this render object (at given viewpoint, target).
   * @param {object} [opts]
   */
  _postRenderPass(_opts = {}) {}

  /**
   * Define the settings used for the render pipeline.
   */
  _setRenderPipelineOpts() {
    this.bindGroupLayoutsArray[this.constructor.GROUP_NUM.CAMERA] = this.camera.bindGroupLayout;
    this.bindGroupLayoutsArray[this.constructor.GROUP_NUM.MATERIALS] = this.materials.bindGroupLayout;

    this.RENDER_PIPELINE_OPTS.label = `${this.constructor.name}`;
    this.RENDER_PIPELINE_OPTS.vertex.module = this.module;
    this.RENDER_PIPELINE_OPTS.fragment.module = this.module;
    this.RENDER_PIPELINE_OPTS.vertex.buffers = this.debugViewNormals ? GeometryDesc.buffersLayoutNormals : GeometryDesc.buffersLayout;
    this.RENDER_PIPELINE_OPTS.fragment.targets[0] = {
      format: WebGPUDevice.presentationFormat,
      writeMask: this.debugViewNormals ? GPUColorWrite.ALL : (GPUColorWrite.BLUE | GPUColorWrite.ALPHA),
    };
    this.RENDER_PIPELINE_OPTS.layout = this.device.createPipelineLayout({
      label: `${this.constructor.name}`,
      bindGroupLayouts: this.bindGroupLayoutsArray,
    });
    this.RENDER_PIPELINE_OPTS.multisample.count = this.sampleCount ?? 1;
    this.RENDER_PIPELINE_OPTS.depthStencil.format = this.depthFormat ?? "depth24plus";
  }

  // ----- NOTE: Placeable updating ----- //

  #placeableHandlerUpdateId = 0;

  #placeableHandlerBufferId = 0;

  get placeableHandlerUpdateId() { return this.#placeableHandlerUpdateId; }

  get placeableHandlerBufferId() { return this.#placeableHandlerBufferId; }

  set placeableHandlerUpdateId(value) { this.#placeableHandlerUpdateId = value; }

  _hooks = [];

  registerPlaceableHooks() {}

  deregisterPlaceableHooks() { this._hooks.forEach(hook => Hooks.off(hook.name, hook.id)); }

  destroy() {
    this.deregisterPlaceableHooks();
    Object.values(this.buffers).forEach(buffer => {
      if ( Array.isArray(buffer) ) buffer.forEach(elem => elem.destroy());
      else buffer.destroy();
    });
  }
}

export class DrawableObjectInstancesAbstract extends DrawableObjectsAbstract {
  static BINDGROUP_LAYOUT_OPTS = {
    ...DrawableObjectsAbstract.BINDGROUP_LAYOUT_OPTS,

    instance: {
      label: "Instance",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      }]
    },
  };

  static GROUP_NUM = {
    ...DrawableObjectsAbstract.GROUP_NUM,
    INSTANCE: 2,
  };

  bindGroupLayoutsArray = new Array(3);

  _setRenderPipelineOpts() {
    this.bindGroupLayoutsArray[this.constructor.GROUP_NUM.INSTANCE] = this.bindGroupLayouts.instance;
    super._setRenderPipelineOpts();
  }

  initializePlaceableBuffers() {
    super.initializePlaceableBuffers();
    this._createInstanceBuffer();
    this._createInstanceBindGroup();
  }

  _createInstanceBuffer() {
    if ( this.buffers.instance ) this.buffers.instance.destroy();
    if ( !this.placeableHandler.numInstances ) return;
    const device = this.device;

    this.buffers.instance = this.device.createBuffer({
      label: `${this.constructor.name}`,
      size: this.placeableHandler.instanceArrayBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.buffers.instance, 0, this.placeableHandler.instanceArrayBuffer)
    this.rawBuffers.instance = new Float32Array(this.placeableHandler.instanceArrayBuffer)
  }

  _createInstanceBindGroup() {
    if ( !this.placeableHandler.numInstances ) return;
    this.bindGroups.instance = this.device.createBindGroup({
      label: `${this.constructor.name} Instance`,
      layout: this.bindGroupLayouts.instance,
      entries: [{
        binding: 0,
        resource: { buffer: this.buffers.instance }
      }],
    });
  }

  _initializeRenderPass(renderPass, pipelineName) {
    super._initializeRenderPass(renderPass, pipelineName);
    renderPass.setBindGroup(this.constructor.GROUP_NUM.INSTANCE, this.bindGroups.instance);
  }

  prerender() {
    super.prerender();
    const placeableHandler = this.placeableHandler;
    if ( placeableHandler.updateId <= this.placeableHandlerUpdateId ) return; // No changes since last update.
    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      this.partialUpdateInstanceBuffer(idx);
    }
    this.placeableHandlerUpdateId = placeableHandler.updateId;
  }

  /**
   * Update the instance buffer on the GPU for a specific placeable.
   * @param {string} placeableId    Id of the placeable
   * @param {number} [idx]          Optional placeable index; will be looked up using placeableId otherwise
   */
  partialUpdateInstanceBuffer(idx) {
    const h = this.placeableHandler
    const M = h.matrices[idx];
    this.device.queue.writeBuffer(this.buffers.instance, idx * h.constructor.INSTANCE_ELEMENT_SIZE, M.arr);
  }
}

export class DrawableObjectCulledInstancesAbstract extends DrawableObjectInstancesAbstract {
  static BINDGROUP_LAYOUT_OPTS = {
    ...DrawableObjectInstancesAbstract.BINDGROUP_LAYOUT_OPTS,

    culled: {
      label: "Culled",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      }]
    },
  };

  static GROUP_NUM = {
    ...DrawableObjectInstancesAbstract.GROUP_NUM,
    CULLED: 3,
  };

  bindGroupLayoutsArray = new Array(4);

  _setRenderPipelineOpts() {
    this.bindGroupLayoutsArray[this.constructor.GROUP_NUM.CULLED] = this.bindGroupLayouts.culled;
    super._setRenderPipelineOpts();
  }

  initializePlaceableBuffers() {
    super.initializePlaceableBuffers();
    this._createIndirectBuffer();
    this._createCulledBuffer();
  }

  _createIndirectBuffer() {
    // Track the indirect draw commands for each drawable.
    // Used in conjunction with the culling buffer.
    // The indirect buffer sets the number of instances while the culling buffer defines which instances.

    if ( this.buffers.indirect ) this.buffers.indirect.destroy();
    if ( !this.placeableHandler.numInstances ) return;
    const size = 5 * Uint32Array.BYTES_PER_ELEMENT;
    this.buffers.indirect = this.device.createBuffer({
      label: "Indirect Buffer",
      size: size * this.drawables.size,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.rawBuffers.indirect = new ArrayBuffer(size * this.drawables.size);

    let indirectOffset = 0;
    for ( const drawable of this.drawables.values() ) {
      drawable.indirectOffset = indirectOffset;
      drawable.indirectBuffer = new Uint32Array(this.rawBuffers.indirect, indirectOffset, 5);
      indirectOffset += size;
    }
  }

  /**
   * Store the indices that should be rendered in an indirect buffer.
   * This allows use of Render Bundles for the wall rendering.
   * Set up just like the indirect buffer.
   * See https://toji.dev/webgpu-best-practices/render-bundles
   *     https://github.com/toji/webgpu-bundle-culling/blob/main/index.html
   */
  _createCulledBuffer() {
    if ( this.buffers.culled ) this.buffers.culled.destroy();
    if ( !this.placeableHandler.numInstances ) return;

    // To create a single buffer the offset must be a multiple of 256.
    // As each element is only u32 (or u16), that means 64 (u32) or 128 (u16) entries per drawable.
    // So 64 or 128 walls minimum.
    // For 4 wall drawables, need 1 culling buffer of min size 256 * 4 = 1024.
    // Ensure size is divisible by 256.
    const minSize = 256;
    const size = (Math.ceil((this.placeableHandler.numInstances * Uint32Array.BYTES_PER_ELEMENT) / minSize) * minSize);

    this.buffers.culled = this.device.createBuffer({
      label: "Culled Buffer",
      size: size * this.drawables.size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.rawBuffers.culled = new ArrayBuffer(size * this.drawables.size);

    let culledBufferOffset = 0;
    for ( const drawable of this.drawables.values() ) {
      drawable.culledBufferOffset = culledBufferOffset;
      drawable.culledBufferRaw = new Uint32Array(
        this.rawBuffers.culled,
        culledBufferOffset,
        this.placeableHandler.numInstances, // Alt: Math.floor(size / Uint32Array.BYTES_PER_ELEMENT),
      );
      drawable.culledBG = this.device.createBindGroup({
        label: `${this.constructor.name} ${drawable.label}`,
        layout: this.bindGroupLayouts.culled,
        entries: [{
          binding: 0,
          resource: { buffer: this.buffers.culled, offset: culledBufferOffset, size }
        }]
      });
      culledBufferOffset += size;
    }
  }

//   _createCulledBindGroup() {
//     this.bindGroups.culled = this.device.createBindGroup({
//       label: `${this.constructor.name} Culled`,
//       layout: this.bindGroupLayouts.culled,
//       entries: [{
//         binding: 0,
//         resource: { buffer: this.buffers.culled }
//       }],
//     });
//   }

  filterObjects(visionTriangle, opts) {
    super.filterObjects(visionTriangle, opts);
    this._updateCulledValues();
  }


  /**
   * Set the culled instance buffer and indirect buffer for each drawable.
   * The indirect buffer determines how many elements in the culled instance buffer are drawn.
   * Prior to this, the drawable instanceSet should be updated.
   */
  _updateCulledValues() {
    // Set the culled instance buffer and indirect buffer for each drawable.
    // The indirect buffer determines how many elements in the culled instance buffer are drawn.
    for ( const drawable of this.drawables.values() ) {
      if ( !drawable.instanceSet.size ) continue;
      let i = 0;
      drawable.instanceSet.forEach(idx => drawable.culledBufferRaw[i++] = idx);

      // https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPassEncoder/drawIndexedIndirect
      // indexCount, instanceCount, firstIndex, baseVertex, firstInstance
      drawable.indirectBuffer[0] = drawable.geom.indices.length;
      drawable.indirectBuffer[1] = drawable.instanceSet.size;
    }
    this.device.queue.writeBuffer(this.buffers.indirect, 0, this.rawBuffers.indirect);
    this.device.queue.writeBuffer(this.buffers.culled, 0, this.rawBuffers.culled);
  }

  /**
   * Called on each drawable for this render object.
   * @param {CommandEncoder} renderPass
   * @param {Drawable} drawable
   */
  _renderDrawable(renderPass, drawable) {
    renderPass.setBindGroup(this.constructor.GROUP_NUM.MATERIALS, drawable.materialBG);
    renderPass.setBindGroup(this.constructor.GROUP_NUM.CULLED, drawable.culledBG);

    drawable.geom.setVertexBuffer(renderPass);
    drawable.geom.setIndexBuffer(renderPass);
    renderPass.drawIndexedIndirect(this.buffers.indirect, drawable.indirectOffset);
  }
}

// Use a render bundle for this object's render.
// See https://github.com/toji/webgpu-bundle-culling/blob/main/index.html
export class DrawableObjectRBCulledInstancesAbstract extends DrawableObjectCulledInstancesAbstract {
  /** @type {WebGPURenderBundle} */
  renderBundle;

  // TODO: Pass colorFormat, depthStencilFormat, and sampleCount.
  // Could pass from prerender or other method.
  _createRenderBundle(opts) {
    const encoder = this.device.createRenderBundleEncoder({
      colorFormats: [ WebGPUDevice.presentationFormat ],
      depthStencilFormat: "depth24plus",
      sampleCount: 1
    });

    // Call the exact same function as the non-bundled draw
    // Call the parent so executeBundles is not called.
    super.render(encoder, opts);
    this.renderBundle = encoder.finish();
    this._postRenderPass(opts)
  }

  initializePlaceableBuffers() {
    super.initializePlaceableBuffers();
    this.renderBundle = undefined;
  }

  render(renderPass, opts) {
    if ( !this.renderBunder ) this._createRenderBundle(opts);
    renderPass.executeBundles([this.renderBundle]);
  }
}

// Instances of walls. Could include tokens but prefer to keep separate both for simplicity
// and because tokens get updated much more often.
export class DrawableWallInstances extends DrawableObjectRBCulledInstancesAbstract {
  /** @type {WallInstanceHandler} */
  static handlerClass = WallInstanceHandler;

  /** @type {string} */
  static shaderFile = "wall";

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  constructor(device, materials, camera, { senseType = "sight", ...opts } = {}) {
    super(device, materials, camera, opts);
    this.senseType = senseType;
  }

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {
    this.geometries.set("wall", new GeometryWallDesc({ directional: false, addNormals: this.debugViewNormals, addUVs: false }));
    this.geometries.set("wall-dir", new GeometryWallDesc({ directional: true, addNormals: this.debugViewNormals, addUVs: false }));
  }

  /**
   * Insert drawables that rarely change into the drawables map.
   */
  _createStaticDrawables() {
    this.materials.create({ b: 1.0, label: "obstacle" });
    this.materials.create({ g: 0.5, a: 0.5, label: "terrain" });
    this.drawables.set("wall", {
      label: "Non-directional wall",
      geom: this.geometries.get("wall"),
      materialBG: this.materials.bindGroups.get("obstacle"),
      instanceSet: new Set(),
    });
    this.drawables.set("wall-dir", {
      label: "Directional wall",
      geom: this.geometries.get("wall-dir"),
      materialBG: this.materials.bindGroups.get("obstacle"),
      instanceSet: new Set(),
    });
    this.drawables.set("wall-terrain", {
      label: "Non-directional terrain wall",
      geom: this.geometries.get("wall"),
      materialBG: this.materials.bindGroups.get("terrain"),
      instanceSet: new Set(),
    });
    this.drawables.set("wall-dir-terrain", {
      label: "Directional terrain wall",
      geom: this.geometries.get("wall-dir"),
      materialBG: this.materials.bindGroups.get("terrain"),
      instanceSet: new Set(),
    });

    // Determine the initial distribution of placeables among the drawable types.
//     for ( const [idx, edge] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
//       this.drawables.get(this.edgeDrawableKey(edge)).instanceSet.add(idx);
//     }
  }

  edgeDrawableKey(edge) {
    const props = ["wall"];
    if ( edge.direction !== CONST.WALL_DIRECTIONS.BOTH ) props.push("dir");
    if ( edge[this.senseType] === CONST.WALL_SENSE_TYPES.LIMITED ) props.push("terrain");
    return props.join("-");
  }

  static FILTER_KEYS = ["wall", "wall-dir", "wall-terrain", "wall-dir-terrain"];

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   */
  filterObjects(visionTriangle) {
    const keys = this.constructor.FILTER_KEYS;
    const instanceSets = {};
    for ( const key of keys ) instanceSets[key] = this.drawables.get(key).instanceSet
    Object.values(instanceSets).forEach(s => s.clear());

    // Put each edge in one of four drawable sets if viewable; skip otherwise.
    for ( const [idx, edge] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      // If the edge is an open door or non-blocking wall, ignore.
      if ( edge.object instanceof Wall && edge.object.isOpen ) continue;
      if ( !this.placeableHandler.isBlocking(edge, this.senseType) ) continue;

      if ( visionTriangle.containsEdge(edge) ) instanceSets[this.edgeDrawableKey(edge)].add(idx);
    }
    super.filterObjects(visionTriangle);
  }

  registerPlaceableHooks() {
    this._hooks.push({ name: "createWall", id: Hooks.on("createWall", this._onPlaceableCreation.bind(this)) });
    this._hooks.push({ name: "updateWall", id: Hooks.on("updateWall", this._onPlaceableUpdate.bind(this)) });
    this._hooks.push({ name: "deleteWall", id: Hooks.on("deleteWall", this._onPlaceableDeletion.bind(this)) });
//     this._hooks.push({ name: "drawWall", id: Hooks.on("drawWall", this._onPlaceableDraw.bind(this)) });
//     this._hooks.push({ name: "refreshWall", id: Hooks.on("refreshWall", this._onPlaceableRefresh.bind(this)) });
//     this._hooks.push({ name: "destroyWall", id: Hooks.on("destroyWall", this._onPlaceableDestroy.bind(this)) });
  }

  /**
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * @param {Document} document                       The new Document instance which has been created
   * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
   * @param {string} userId                           The ID of the User who triggered the creation workflow
   */
  _onPlaceableCreation(document, _options, _userId) {
    this.addPlaceable(document.object.edge);
    // TODO: How to detect non-wall edge creation?
  }

  /**
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * @param {Document} document                       The existing Document which was updated
   * @param {object} changed                          Differential data that was used to update the document
   * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
   * @param {string} userId                           The ID of the User who triggered the update workflow
   */
  _onPlaceableUpdate(document, changed, _options, _userId) {
    const changeKeys = new Set(Object.keys(foundry.utils.flattenObject(changed)));
    const updateNeeded = this.placeableHandler.constructor.docUpdateKeys.some(key => changeKeys.has(key));
    this.updatePlaceable(document.object.edge, updateNeeded);
  }
}

// Instances of walls. Could include tokens but prefer to keep separate both for simplicity
// and because tokens get updated much more often.
export class DrawableNonTerrainWallInstances extends DrawableWallInstances {
  /** @type {WallInstanceHandler} */
  static handlerClass = NonTerrainWallInstanceHandler;

  /**
   * Insert drawables that rarely change into the drawables map.
   */
  _createStaticDrawables() {
    this.materials.create({ b: 1.0, label: "obstacle" });
    this.drawables.set("wall", {
      label: "Non-directional wall",
      geom: this.geometries.get("wall"),
      materialBG: this.materials.bindGroups.get("obstacle"),
      instanceSet: new Set(),
    });
    this.drawables.set("wall-dir", {
      label: "Directional wall",
      geom: this.geometries.get("wall-dir"),
      materialBG: this.materials.bindGroups.get("obstacle"),
      instanceSet: new Set(),
    });
  }

  static FILTER_KEYS = ["wall", "wall-dir"];
}

// Instances of walls. Could include tokens but prefer to keep separate both for simplicity
// and because tokens get updated much more often.
export class DrawableTerrainWallInstances extends DrawableWallInstances {
  /** @type {WallInstanceHandler} */
  static handlerClass = TerrainWallInstanceHandler;

  /**
   * Insert drawables that rarely change into the drawables map.
   */
  _createStaticDrawables() {
    this.materials.create({ g: 0.5, a: 0.5, label: "terrain" });
    this.drawables.set("wall-terrain", {
      label: "Non-directional terrain wall",
      geom: this.geometries.get("wall"),
      materialBG: this.materials.bindGroups.get("terrain"),
      instanceSet: new Set(),
    });
    this.drawables.set("wall-dir-terrain", {
      label: "Directional terrain wall",
      geom: this.geometries.get("wall-dir"),
      materialBG: this.materials.bindGroups.get("terrain"),
      instanceSet: new Set(),
    });
  }

  static FILTER_KEYS = ["wall-terrain", "wall-dir-terrain"];

  _setRenderPipelineOpts() {
    super._setRenderPipelineOpts();
    const target = this.RENDER_PIPELINE_OPTS.fragment.targets[0];
    target.blend ??= {};
    if ( this.debugViewNormals ) {
      target.blend.alpha = {
        dstFactor: "one-minus-src-alpha",
        srcFactor: "one-minus-src-alpha",
      };
      target.blend.color = {
        dstFactor: "src-alpha",
        srcFactor: "src-alpha",
      };

    } else {
      target.writeMask = GPUColorWrite.GREEN | GPUColorWrite.ALPHA;
      target.blend.alpha = {
        dstFactor: "zero",
        srcFactor: "one",
      };
      target.blend.color = {
        dstFactor: "one",
        srcFactor: "one",
      };
    }

    this.RENDER_PIPELINE_OPTS.depthStencil.depthCompare = "always"; // Effectively turn off depth testing.
    this.RENDER_PIPELINE_OPTS.depthStencil.depthWriteEnabled = false;
  }
}

export class DrawableTokenInstances extends DrawableObjectRBCulledInstancesAbstract {
  /** @type {TokenInstanceHandler} */
  static handlerClass = TokenInstanceHandler;

  /** @type {string} */
  static shaderFile = "token";

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {
    this.geometries.set("token", new GeometryCubeDesc({ addNormals: this.debugViewNormals, addUVs: false }));
  }

  /**
   * Insert drawables that rarely change into the drawables map.
   */
  _createStaticDrawables() {
    this.materials.create({ b: 1.0, label: "obstacle" });
    this.materials.create({ r: 1.0, label: "target" });
    this.drawables.set("token", {
      label: "Token obstacle",
      geom: this.geometries.get("token"),
      materialBG: this.materials.bindGroups.get("obstacle"),
      instanceSet: new Set(),
    });
    this.drawables.set("target", {
      label: "Token target",
      geom: this.geometries.get("token"),
      materialBG: this.materials.bindGroups.get("target"),
      instanceSet: new Set(),
    });
  }

  #unconstrainedTokenIndices = new Map();

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {
    super.prerender();

    // Determine the number of constrained tokens and separate from instance set.
    // Essentially subset the instance set.
    this.#unconstrainedTokenIndices.clear();
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( !token.isConstrainedTokenBorder ) this.#unconstrainedTokenIndices.set(idx, token);
    }
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   */
  filterObjects(visionTriangle, opts = {}) {
    const { viewer, target } = opts;
    opts.tokens ??= {};
    opts.tokens.dead ??= true;
    opts.tokens.live ??= true;
    opts.tokens.prone ??= true;

    // Limit tokens as obstacles.
    const drawable = this.drawables.get("token");
    drawable.instanceSet.clear();

    if ( opts.tokens.dead || opts.tokens.live ) {
      // Add in all viewable tokens.
      const api = MODULES_ACTIVE.API.RIDEABLE;
      for ( const [idx, token] of this.#unconstrainedTokenIndices.entries() ) {
        if ( token === viewer || token === target ) continue;
        if ( !this.constructor.includeToken(token, opts.tokens) ) continue;

        // Filter tokens that directly overlaps the viewer.
        if ( tokensOverlap(token, viewer) ) continue;

        // Filter all mounts and riders of both viewer and target. Possibly covered by overlap test.
        if ( api && (api.RidingConnection(token, viewer) || api.RidingConnection(token, target)) ) continue;

        if ( visionTriangle.containsToken(token) ) drawable.instanceSet.add(idx);
      }
    }

    // Add target as a distinct drawable.
    const targetDrawable = this.drawables.get("target");
    targetDrawable.instanceSet.clear();
    if ( target ) {
      const targetIdx = this.placeableHandler.instanceIndexFromId.get(target.id);
      drawable.instanceSet.delete(targetIdx);

      // If the target is not constrained, set it here.
      if ( !target.isConstrainedTokenBorder ) targetDrawable.instanceSet.add(targetIdx);
    }
    super.filterObjects(visionTriangle);
  }

  static includeToken(token, { dead = true, live = true, prone =  true } = {}) {
    if ( !dead && CONFIG[MODULE_ID].tokenIsDead(token) ) return false;
    if ( !live && CONFIG[MODULE_ID].tokenIsAlive(token) ) return false;
    if ( !prone && token.isProne ) return false;
    return true;
  }

  _createPipeline() {
    super._createPipeline();
    if ( !this.debugViewNormals ) {
      const target = this.RENDER_PIPELINE_OPTS.fragment.targets[0];
      target.writeMask = GPUColorWrite.RED | GPUColorWrite.ALPHA;
    }
    this.pipeline.target = this.device.createRenderPipeline(this.RENDER_PIPELINE_OPTS);
  }

  // Skipped until render.
  _initializeRenderPass(_renderPass) { return; }

  /**
   * Render only the target token.
   */
  renderTarget(renderPass, _target) {
    const drawable = this.drawables.get("target");
    if ( !drawable ) return;
    this._renderDrawable(renderPass, drawable);
  }

  /**
   * Render all but the target
   */
  renderObstacles(renderPass, _target) {
    const drawable = this.drawables.get("obstacle");
    if ( !drawable ) return;
    this._renderDrawable(renderPass, drawable);
  }

  _renderDrawable(renderPass, drawable) {
    if ( !drawable.instanceSet.size ) return;

    // Skipped initialize, so do here. Change if drawing the target.
    const pipelineName = drawable.label === "Token target" ? "target" : "default";
    super._initializeRenderPass(renderPass, pipelineName);
    super._renderDrawable(renderPass, drawable);
  }

  registerPlaceableHooks() {
//     this._hooks.push({ name: "createToken", id: Hooks.on("createToken", this._onPlaceableCreation.bind(this)) });
//     this._hooks.push({ name: "updateToken", id: Hooks.on("updateToken", this._onPlaceableUpdate.bind(this)) });
//     this._hooks.push({ name: "deleteToken", id: Hooks.on("deleteToken", this._onPlaceableDeletion.bind(this)) });
    this._hooks.push({ name: "drawToken", id: Hooks.on("drawToken", this._onPlaceableDraw.bind(this)) });
    this._hooks.push({ name: "refreshToken", id: Hooks.on("refreshToken", this._onPlaceableRefresh.bind(this)) });
    this._hooks.push({ name: "destroyToken", id: Hooks.on("destroyToken", this._onPlaceableDestroy.bind(this)) });
  }

}

// Tile instances.
export class DrawableTileInstances extends DrawableObjectInstancesAbstract {
  /** @type {TokenInstanceHandler} */
  static handlerClass = TileInstanceHandler;

  /** @type {string} */
  static shaderFile = "tile";

  static BINDGROUP_LAYOUT_OPTS = {
    ...DrawableObjectInstancesAbstract.BINDGROUP_LAYOUT_OPTS,

    tileTexture: {
      label: "Tile Texture",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { multisampled: false, sampleType: "float", viewDimension: "2d" },
      }
      ]
    },
  };

  static GROUP_NUM = {
    ...DrawableObjectInstancesAbstract.GROUP_NUM,
    TILE_TEXTURE: 3,
  };


  bindGroupLayoutsArray = new Array(4);

  _setRenderPipelineOpts() {
    this.bindGroupLayoutsArray[this.constructor.GROUP_NUM.TILE_TEXTURE] = this.bindGroupLayouts.tileTexture;
    super._setRenderPipelineOpts();
    this.RENDER_PIPELINE_OPTS.vertex.buffers = this.debugViewNormals ? GeometryDesc.buffersLayoutNormalsUVs : GeometryDesc.buffersLayoutUVs;
  }

  async initialize() {
    await super.initialize();
    await this._addTileTextures();
  }

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {
    this.geometries.set("tile", new GeometryHorizontalPlaneDesc({ addNormals: this.debugViewNormals, addUVs: true }));
  }

  /**
   * Insert drawables that rarely change into the drawables map.
   */
  _createStaticDrawables() {
    this.materials.create({ b: 1.0, label: "obstacle" });
    this.drawables.set("tile", {
      label: "Tile instance",
      geom: this.geometries.get("tile"),
      materialBG: this.materials.bindGroups.get("obstacle"),
      numInstances: 1,
      texture: null,
      textureBG: null,
    });
  }

  async _addTileTextures() {
    const device = this.device;
    this.samplers.tileTexture = device.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
    });

    // For each tile, add a drawable with its specific texture and bindgroup.
    const numTiles = this.placeableHandler.numInstances;
    this.bindGroups.tileTextures = Array(numTiles);
    // this.textures = Array(numTiles);
    const defaultDrawable = this.drawables.get("tile");
    this.drawables.delete("tile");
    for ( const [idx, tile] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      const drawable = { ...defaultDrawable };
      const source = this.constructor.tileSource(tile);
      const url = tile.document.texture.src;
      /*
      const source = await loadImageBitmap(url, {
        imageOrientation: "flipY",
        premultiplyAlpha: "premultiply", // Will display alpha as white if "none" selected.
        // colorSpaceConversion: "none", // Unclear if this is helpful or more performant.
        // resizeQuality: "high", // Probably not needed
       }); // TODO: shrink size to something more manageable?
      */
      const texture = drawable.texture = device.createTexture({
        label: url,
        format: "rgba8unorm",
        size: [source.width, source.height],
        usage: GPUTextureUsage.TEXTURE_BINDING |
               GPUTextureUsage.COPY_DST |
               GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture(
        { source, flipY: true },
        { texture },
        { width: source.width, height: source.height },
      );
      drawable.textureBG = device.createBindGroup({
        label: `Tile Texture ${idx}`,
        layout: this.bindGroupLayouts.tileTexture,
        entries: [
          { binding: 0, resource: this.samplers.tileTexture },
          { binding: 1, resource: texture.createView() },
        ]
      });
      this.drawables.set(tile.id, drawable);
    }
  }

  static tileSource(tile) { return tile.texture.baseTexture.resource.source; }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   */
  filterObjects(visionTriangle) {
    // Filter non-viewable tiles.
    for ( const tile of this.placeableHandler.placeableFromInstanceIndex.values() ) {
      const drawable = this.drawables.get(tile.id);
      drawable.numInstances = Boolean(visionTriangle.containsTile(tile));
    }
    super.filterObjects(visionTriangle);
  }

  _renderDrawable(renderPass, drawable) {
    if ( !drawable.numInstances ) return;
    renderPass.setBindGroup(this.constructor.GROUP_NUM.MATERIALS, drawable.materialBG);
    renderPass.setBindGroup(this.constructor.GROUP_NUM.TILE_TEXTURE, drawable.textureBG);

    drawable.geom.setVertexBuffer(renderPass);
    drawable.geom.setIndexBuffer(renderPass);
    drawable.geom.draw(renderPass, { instanceCount: drawable.numInstances });
  }

  registerPlaceableHooks() {
    this._hooks.push({ name: "createTile", id: Hooks.on("createTile", this._onPlaceableCreation.bind(this)) });
    this._hooks.push({ name: "updateTile", id: Hooks.on("updateTile", this._onPlaceableUpdate.bind(this)) });
    this._hooks.push({ name: "deleteTile", id: Hooks.on("deleteTile", this._onPlaceableDeletion.bind(this)) });
//     this._hooks.push({ name: "drawTile", id: Hooks.on("drawTile", this._onPlaceableDraw.bind(this)) });
//     this._hooks.push({ name: "refreshTile", id: Hooks.on("refreshTile", this._onPlaceableRefresh.bind(this)) });
//     this._hooks.push({ name: "destroyTile", id: Hooks.on("destroyTile", this._onPlaceableDestroy.bind(this)) });
  }
}

// Handle constrained tokens and the target token in red.
export class DrawableConstrainedTokens extends DrawableObjectsAbstract {
  /** @type {WallInstanceHandler} */
  static handlerClass = TokenInstanceHandler;

  /** @type {string} */
  static shaderFile = "constrained_token";

  _createStaticDrawables() {
    this.materials.create({ b: 1.0, label: "obstacle" });
    this.materials.create({ r: 1.0, label: "target" });
  }

  prerender() {
    super.prerender();

    // Create a geometry for each constrained token.
    this.geometries.clear();
    this.drawables.clear();
    const materialBG = this.materials.bindGroups.get("obstacle");
    const numInstances = 1;
    for ( const token of this.placeableHandler.placeableFromInstanceIndex.values() ) {
      if ( !token.isConstrainedTokenBorder ) return;
      const geom = new GeometryConstrainedTokenDesc({ token, addNormals: this.debugViewNormals, addUVs: false })
      this.geometries.set(token.id, geom);
      this.drawables.set(token.id, {
        label: `Token drawable ${token.id}`,
        geom,
        materialBG,
        numInstances,
      });
    }
    this._setStaticGeometriesBuffers();
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   */
  filterObjects(visionTriangle, opts = {}) {
    const { viewer, target } = opts;
    opts.tokens ??= {};
    opts.tokens.dead ??= true;
    opts.tokens.live ??= true;
    opts.tokens.prone ??= true;

    const api = MODULES_ACTIVE.API.RIDEABLE;
    for ( const token of this.placeableHandler.placeableFromInstanceIndex.values() ) {
      const drawable = this.drawables.get(token.id);
      if ( !drawable ) continue;
      drawable.numInstances = 0; // Default to not drawing this token.
      if ( token === viewer || token === target ) continue;
      if ( !this.constructor.includeToken(token, opts.tokens) ) continue;

      // Filter tokens that directly overlaps the viewer.
      if ( tokensOverlap(token, viewer) ) continue;

      // Filter all mounts and riders of both viewer and target. Possibly covered by overlap test.
      if ( api && (api.RidingConnection(token, viewer) || api.RidingConnection(token, target)) ) continue;

      drawable.numInstances = Number(visionTriangle.containsToken(token));
    }

    // Set material for target and set it to be drawn.
    if ( target && this.drawables.has(target.id) ) {
      const drawable = this.drawables.get(target.id);
      drawable.numInstances = 1;
      drawable.materialBG = this.materials.bindGroups.get("target");
    }
    super.filterObjects(visionTriangle, opts);
  }

  static includeToken(token, { dead = true, live = true, prone = true } = {}) {
    if ( !dead && CONFIG[MODULE_ID].tokenIsDead(token) ) return false;
    if ( !live && CONFIG[MODULE_ID].tokenIsAlive(token) ) return false;
    if ( !prone && token.isProne ) return false;
    return true;
  }

  /**
   * Called after the render pass has ended for this render object (at given viewpoint, target).
   * @param {object} [opts]
   */
  _postRenderPass({ viewer, target } = {}) {
    // Reset viewer and target in the drawables.
    if ( viewer && this.drawables.has(viewer.id) ) {
      const drawable = this.drawables.get(viewer.id);
      drawable.numInstances = 1;
    }

    if ( target && this.drawables.has(target.id) ) {
      const drawable = this.drawables.get(target.id);
      drawable.materialBG = this.materials.bindGroups.get("obstacles");
    }
  }

  _createPipeline() {
    super._createPipeline();
    if ( !this.debugViewNormals ) {
      const target = this.RENDER_PIPELINE_OPTS.fragment.targets[0];
      target.writeMask = GPUColorWrite.RED | GPUColorWrite.ALPHA;
    }
    this.pipeline.target = this.device.createRenderPipeline(this.RENDER_PIPELINE_OPTS);
  }

  // Skipped until render.
  _initializeRenderPass(_renderPass) { return; }

  /**
   * Render only the target token.
   */
  renderTarget(renderPass, target) {
    const drawable = this.drawables.get(target.id);
    if ( !drawable ) return;
    this._renderDrawable(renderPass, drawable);
  }

  /**
   * Render all but the target
   */
  renderObstacles(renderPass, target) {
    for ( const [key, drawable] of this.drawables.entries() ) {
      if ( key === target.id ) continue;
      this._renderDrawable(renderPass, drawable);
    }
  }

  _renderDrawable(renderPass, drawable) {
    if ( !drawable.numInstances ) return;

    // Skipped initialize, so do here. Change if drawing the target.
    const pipelineName = drawable.label === "Token target" ? "target" : "default";
    super._initializeRenderPass(renderPass, pipelineName);
    renderPass.setBindGroup(this.constructor.GROUP_NUM.MATERIALS, drawable.materialBG);

    drawable.geom.setVertexBuffer(renderPass);
    drawable.geom.setIndexBuffer(renderPass);
    drawable.geom.draw(renderPass, { instanceCount: drawable.numInstances });
  }


  registerPlaceableHooks() {
//     this._hooks.push({ name: "createToken", id: Hooks.on("createToken", this._onPlaceableCreation.bind(this)) });
//     this._hooks.push({ name: "updateToken", id: Hooks.on("updateToken", this._onPlaceableUpdate.bind(this)) });
//     this._hooks.push({ name: "deleteToken", id: Hooks.on("deleteToken", this._onPlaceableDeletion.bind(this)) });
    this._hooks.push({ name: "drawToken", id: Hooks.on("drawToken", this._onPlaceableDraw.bind(this)) });
    this._hooks.push({ name: "refreshToken", id: Hooks.on("refreshToken", this._onPlaceableRefresh.bind(this)) });
    this._hooks.push({ name: "destroyToken", id: Hooks.on("destroyToken", this._onPlaceableDestroy.bind(this)) });
  }
}