/* globals
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { combineTypedArrays } from "../util.js";
import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";
import { GeometryDesc } from "./GeometryDesc.js";
import { GeometryWallDesc } from "./GeometryWall.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc } from "./GeometryToken.js";
import { GeometryHorizontalPlaneDesc } from "./GeometryTile.js";
import {
  WallInstanceHandler,
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
*/

export class MaterialsTracker {
  /** @type {GPUDevice} */
  device;

  /** @type {Map<string, GPUBindGroup>} */
  bindGroups = new Map();

  /** @type {GPUBindGroupLayout} */
  bindGroupLayout;

  /** @type {object} */
  static MATERIAL_LAYOUT = {
    label: 'Material',
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {}
    }]
  };

  /**
   * @type {GPUDevice} device
   */
  constructor(device) {
    this.device = device;
    this.bindGroupLayout = device.createBindGroupLayout(this.constructor.MATERIAL_LAYOUT);
  }

  /**
   * Create singleton material for a given label.
   * Currently does not check if r,g,b,a are same/different for given label.
   * @param {object} [opts]
   * @param {number} [opts.r]     Red value (0–1)
   * @param {number} [opts.g]     Green value (0–1)
   * @param {number} [opts.b]     Blue value (0–1)
   * @param {number} [opts.a]     Alpha value (0–1)
   * @param {string} [opts.label] Name/key of the material
   */
  create({ r, g, b, a, label }) {
    r ??= 0.0;
    g ??= 0.0;
    b ??= 0.0;
    a ??= 1.0;
    label ??= `Material (${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)}, ${a.toFixed(2)})`;
    if ( this.bindGroups.has(label) ) return;

    const buffer = this.device.createBuffer({
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
    buffer.unmap();

    this.bindGroups.set(label, this.device.createBindGroup({
      label,
      layout: this.bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer }
      }],
    }));
  }
}


class DrawableObjectsAbstract {
  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  static handlerClass;

  static shaderFile;

  static GROUP_NUM = {
    CAMERA: 0,
    MATERIAL: 1
  };

  placeableHandler;

  /** @type {GPUDevice} */
  device;

  /** @type {GPUModule} */
  module;

  /** @type {GPUPipeline} */
  pipeline;

  /** @type {object<GPUBindGroupLayout>} */
  bindGroupLayouts = {};

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
  }

  /**
   * @type {GPUDevice} device
   * @type {MaterialsTracker} materials
   * @type {object} [opts]
   * @type {CONST.WALL_RESTRICTION_TYPES} [opts.senseType="sight"]
   */
  constructor(device, materials, camera, { senseType = "sight" }) {
    this.device = device;
    this.materials = materials;
    this.camera = camera;
    this.senseType = senseType;
    this.placeableHandler = new this.constructor.handlerClass(this.senseType);
  }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize() {
    const device = this.device;

    for ( const [key, opts] of Object.entries(this.constructor.BINDGROUP_LAYOUT_OPTS) ) {
      this.bindGroupLayouts[key] = device.createBindGroupLayout(opts);
    }

    // Define shader and pipeline.
    this.module = await WebGPUShader.fromGLSLFile(device, this.constructor.shaderFile, `${this.constructor.name} Shader`);
    this._setRenderPipelineOpts();
    this.pipeline = device.createRenderPipeline(this.RENDER_PIPELINE_OPTS);

    // Define placeables handled by this class.
    this.placeableHandler.initializePlaceables();

    // Create static buffers.
    this._createStaticGeometries();
    this._setStaticGeometriesBuffers();
    this._createStaticDrawables();
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
        label: `Static Vertex Buffer`,
        size: offsetData.vertex.totalSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    this.device.queue.writeBuffer(this.buffers.staticVertex, 0, vertexArray);
    this.rawBuffers.staticVertex = vertexArray;

    if ( offsetData.index.totalSize ) {
      const indexArray = combineTypedArrays(...geoms.filter(g => Boolean(g.indices)).map(g => g.indices));
      this.buffers.staticIndex = this.device.createBuffer({
        label: `Static Index Buffer`,
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
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  async prerender() {}

  /**
   * Called after pass has begun for this render object.
   * @param {CommandEncoder} renderPass
   */
  _initializeRenderPass(renderPass) {
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(this.constructor.GROUP_NUM.CAMERA, this.camera.bindGroup);
  }

  /**
   * Called on each drawable for this render object.
   * @param {CommandEncoder} renderPass
   * @param {Drawable} drawable
   */
  _renderDrawable(renderPass, drawable) {
    if ( !drawable.numInstances ) return;
    renderPass.setBindGroup(this.constructor.GROUP_NUM.MATERIAL, drawable.materialBG);

    drawable.geom.setVertexBuffer(renderPass);
    drawable.geom.setIndexBuffer(renderPass);
    drawable.geom.draw(renderPass, { instanceCount: drawable.numInstances });
  }

  /**
   * Called after the render pass has ended for this render object (at given viewpoint, target).
   * @param {object} [opts]
   */
  _postRenderPass(_opts = {}) {}

  _setRenderPipelineOpts() {
    this.RENDER_PIPELINE_OPTS.label = `${this.constructor.name}`;
    this.RENDER_PIPELINE_OPTS.vertex.module = this.module;
    this.RENDER_PIPELINE_OPTS.fragment.module = this.module;
    this.RENDER_PIPELINE_OPTS.vertex.buffers = GeometryDesc.buffersLayout;
    this.RENDER_PIPELINE_OPTS.fragment.targets[0] = { format: WebGPUDevice.presentationFormat };
    this.RENDER_PIPELINE_OPTS.layout = this.device.createPipelineLayout({
      label: `${this.constructor.name}`,
      bindGroupLayouts: [
        this.camera.bindGroupLayout,     // 0
        this.materials.bindGroupLayout,  // 1
        ...Object.values(this.bindGroupLayouts),
      ]
    });
    this.RENDER_PIPELINE_OPTS.multisample.count = this.sampleCount ?? 1;
    this.RENDER_PIPELINE_OPTS.depthStencil.format = this.depthFormat ?? "depth24plus";
  }
}

export class DrawableObjectInstancesAbstract extends DrawableObjectsAbstract {
  static INSTANCE_ELEMENT_LENGTH = 64;

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
  }

  static GROUP_NUM = {
    ...DrawableObjectsAbstract.GROUP_NUM,
    INSTANCE: 2,
  };

  _setStaticGeometriesBuffers() {
    if ( !this.placeableHandler.numInstances ) return;
    const device = this.device;

    const buffer = this.buffers.instance = this.device.createBuffer({
      label: `${this.constructor.name}`,
      size: this.placeableHandler.instanceArrayBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, this.placeableHandler.instanceArrayBuffer)
    this.rawBuffers.instance = new Float32Array(this.placeableHandler.instanceArrayBuffer)

    this.bindGroups.instance = device.createBindGroup({
      label: `${this.constructor.name}`,
      layout: this.bindGroupLayouts.instance,
      entries: [{
        binding: 0,
        resource: { buffer }
      }],
    });

    super._setStaticGeometriesBuffers();
  }

  _initializeRenderPass(renderPass) {
    super._initializeRenderPass(renderPass);
    renderPass.setBindGroup(this.constructor.GROUP_NUM.INSTANCE, this.bindGroups.instance);
  }
}

// Instances of walls. Could include tokens but prefer to keep separate both for simplicity
// and because tokens get updated much more often.
export class DrawableWallInstances extends DrawableObjectInstancesAbstract {
  /** @type {WallInstanceHandler} */
  static handlerClass = WallInstanceHandler;

  /** @type {string} */
  static shaderFile = "wall";

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {
    this.geometries.set("wall", new GeometryWallDesc({ directional: false }));
    this.geometries.set("wall-dir", new GeometryWallDesc({ directional: true }));
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
    for ( const [idx, edge] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      this.drawables.get(this.edgeDrawableKey(edge)).instanceSet.add(idx);
    }
  }

  edgeDrawableKey(edge) {
    const props = ["wall"];
    if ( edge.direction !== CONST.WALL_DIRECTIONS.BOTH ) props.push("dir");
    if ( edge[this.senseType] === CONST.WALL_SENSE_TYPES.LIMITED ) props.push("terrain");
    return props.join("-");
  }

  _renderDrawable(renderPass, drawable) {
    if ( !drawable.instanceSet.size ) return;
    renderPass.setBindGroup(this.constructor.GROUP_NUM.MATERIAL, drawable.materialBG);

    drawable.geom.setVertexBuffer(renderPass);
    drawable.geom.setIndexBuffer(renderPass);
    drawable.geom.drawSet(renderPass, drawable.instanceSet);
  }
}

export class DrawableTokenInstances extends DrawableObjectInstancesAbstract {
  /** @type {TokenInstanceHandler} */
  static handlerClass = TokenInstanceHandler;

  /** @type {string} */
  static shaderFile = "token";

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {
    this.geometries.set("token", new GeometryCubeDesc());
  }

  /**
   * Insert drawables that rarely change into the drawables map.
   */
  _createStaticDrawables() {
    this.materials.create({ b: 1.0, label: "obstacle" });
    this.materials.create({ r: 1.0, label: "target" });
    this.drawables.set("token", {
      label: "Token instance",
      geom: this.geometries.get("token"),
      materialBG: this.materials.bindGroups.get("obstacle"),
      instanceSet: new Set(),
    });
    this.drawables.set("target", {
      label: "Token instance",
      geom: this.geometries.get("token"),
      materialBG: this.materials.bindGroups.get("target"),
      instanceSet: new Set(),
    });
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  async prerender() {
    // Determine the number of constrained tokens and separate from instance set.
    const tokenDrawable = this.drawables.get("token");
    tokenDrawable.instanceSet.clear();
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( !token.isConstrainedTokenBorder ) tokenDrawable.instanceSet.add(idx);
    }
  }

  _initializeRenderPass(renderPass, opts = {}) {
    // Remove viewer and target
    const { viewer, target } = opts;
    const drawable = this.drawables.get("token");
    if ( viewer ) {
      const viewerIdx = this.placeableHandler.instanceIndexFromId.get(viewer.id);
      drawable.instanceSet.delete(viewerIdx);
    }

    const targetDrawable = this.drawables.get("target");
    targetDrawable.instanceSet.clear();
    if ( target ) {
      const targetIdx = this.placeableHandler.instanceIndexFromId.get(target.id);
      drawable.instanceSet.delete(targetIdx);

      // If the target is not constrained, set it here.
      if ( !target.isConstrainedTokenBorder ) targetDrawable.instanceSet.add(targetIdx);
    }
    super._initializeRenderPass(renderPass, opts)
  }

  /**
   * Called after the render pass has ended for this render object (at given viewpoint, target).
   * @param {object} [opts]
   */
  _postRenderPass({ viewer, target } = {}) {
    // Add back the viewer and target to the instance drawable if they are not constrained.
    const drawable = this.drawables.get("token");
    if ( viewer
      && !viewer.isConstrainedTokenBorder ) drawable.instanceSet.add(this.placeableHandler.instanceIndexFromId.get(viewer.id));
    if ( target
      && !target.isConstrainedTokenBorder ) drawable.instanceSet.add(this.placeableHandler.instanceIndexFromId.get(target.id));
  }

  _renderDrawable(renderPass, drawable) {
    if ( !drawable.instanceSet.size ) return;
    renderPass.setBindGroup(1, drawable.materialBG);

    drawable.geom.setVertexBuffer(renderPass);
    drawable.geom.setIndexBuffer(renderPass);
    drawable.geom.drawSet(renderPass, drawable.instanceSet);
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


  async initialize() {
    await super.initialize();
    await this._addTileTextures();
  }

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {
    this.geometries.set("tile", new GeometryHorizontalPlaneDesc());
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
      numInstances: 1, // Each has unique tile texture.
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
    this.textures = Array(numTiles);
    const defaultDrawable = this.drawables.get("tile");
    this.drawables.delete("tile");
    for ( const [idx, tile] of this.placeableHandler.placeableFromInstanceIndex ) {
      const drawable = { ...defaultDrawable };
      const url = tile.document.texture.src;
      const source = await loadImageBitmap(url, {
        imageOrientation: "flipY",
        premultiplyAlpha: "premultiply", // Will display alpha as white if "none" selected.
        // colorSpaceConversion: "none", // Unclear if this is helpful or more performant.
        // resizeQuality: "high", // Probably not needed
       }); // TODO: shrink size to something more manageable?
      drawable.texture = device.createTexture({
        label: url,
        format: "rgba8unorm",
        size: [source.width, source.height],
        usage: GPUTextureUsage.TEXTURE_BINDING |
               GPUTextureUsage.COPY_DST |
               GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture(
        { source, flipY: true },
        { texture: this.textures[idx] },
        { width: source.width, height: source.height },
      );
      drawable.textureBG = device.createBindGroup({
        label: `Tile Texture ${idx}`,
        layout: this.bindGroupLayouts.tileTexture,
        entries: [
          { binding: 0, resource: this.samplers.tileTexture },
          { binding: 1, resource: drawable.texture.createView() },
        ]
      });
      this.drawables.set(`tile_${idx}`, drawable);
    }
  }

  _renderDrawable(renderPass, drawable) {
    if ( !drawable.numInstances ) return;
    renderPass.setBindGroup(this.constructor.GROUP_NUM.TILE_TEXTURE, drawable.textureBG);
    super._renderDrawable(renderPass, drawable);
  }
}

// Handle constrained tokens and the target token in red.
// TODO: Reference a single placeable handler instead of creating a new one.
export class DrawableConstrainedTokens extends DrawableObjectsAbstract {
  /** @type {WallInstanceHandler} */
  static handlerClass = TokenInstanceHandler;

  /** @type {string} */
  static shaderFile = "constrained_token";

  _createStaticDrawables() {
    this.materials.create({ b: 1.0, label: "obstacle" });
    this.materials.create({ r: 1.0, label: "target" });
  }

  async prerender() {
    // Create a geometry for each constrained token.
    this.geometries.clear();
    this.drawables.clear();
    const materialBG = this.materials.bindGroups.get("obstacle");
    const numInstances = 1;
    for ( const token of this.placeableHandler.placeableFromInstanceIndex.values() ) {
      if ( !token.isConstrainedTokenBorder ) return;
      const geom = new GeometryConstrainedTokenDesc(token)
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

  _initializeRenderPass(renderPass, opts = {}) {
    const { viewer, target } = opts;

    // Remove viewer.
    if ( viewer && this.drawables.has(viewer.id) ) {
      const drawable = this.drawables.get(viewer.id);
      drawable.numInstances = 0;
    }

    // Set material for target.
    if ( target && this.drawables.has(target.id) ) {
      const drawable = this.drawables.get(target.id);
      drawable.materialBG = this.materials.bindGroups.get("target");
    }
    super._initializeRenderPass(renderPass, opts)
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
      drawable.materialBG = this.materials.bindGroups.get("obstacles");;
    }
  }
}

/**
 * From http://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html
 * Load an image bitmap from a url.
 * @param {string} url
 * @param {object} [opts]       Options passed to createImageBitmap
 * @returns {ImageBitmap}
 */
async function loadImageBitmap(url, opts = {}) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await createImageBitmap(blob, opts);
}