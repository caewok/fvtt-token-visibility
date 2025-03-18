/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULES_ACTIVE } from "../../const.js";

import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";
import { Camera } from "./Camera.js";
import { GeometryTileDesc } from "./GeometryTile.js";


export class RenderTiles {
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

  /** @type {object<GPUTexture>} */
  texture = [];

  /** @type {object<GPUSampler>} */
  samplers = {};

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

    TILE_TEXTURE: {
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
    }
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
  tileVertexPositions;

  /** @type {Uint16Array} */
  tileVertexIndices;

  async initialize() {
    const device = this.device ??= await WebGPUDevice.getDevice();

    // Define shader.
    this.modules.render = await WebGPUShader.fromGLSLFile(device, "tile", "Tile Render");

    this.initializeTiles();

    // Vertex buffer
    const geometryDesc = new GeometryTileDesc({ label: "Tile Geometry", directional: false });
    this.geometryDesc = geometryDesc;
    const numVertexBuffers = geometryDesc.verticesData.length;
    this.buffers.vertex = Array(numVertexBuffers);
    for ( let i = 0; i < numVertexBuffers; i += 1 ) {
      const data = geometryDesc.verticesData[i];
      this.buffers.vertex[i] = device.createBuffer({
        label: `Tile Vertices Buffer ${i}`,
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
      label: "Tile Instance",
      size: this.numTiles * this.constructor.INSTANCE_ELEMENT_LENGTH,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.buffers.instance, 0, this.instanceArrayBuffer); // 0 , this.constructor.INSTANCE_ELEMENT_LENGTH * this.numTiles


    // Define bind group layouts.
    const BG_OPTS = this.constructor.BINDGROUP_OPTS;
    this.bindGroupLayouts.camera = device.createBindGroupLayout(BG_OPTS.CAMERA);
    this.bindGroupLayouts.instance = device.createBindGroupLayout(BG_OPTS.INSTANCE);
    this.bindGroupLayouts.tileTexture = device.createBindGroupLayout(BG_OPTS.TILE_TEXTURE);

    // Define pipelines.
    // TODO: Make async.
    // this.modules.render = await this.modules.render;
    this.pipelines.render = device.createRenderPipeline({
      label: "Render",
      layout: device.createPipelineLayout({ bindGroupLayouts: [
        this.bindGroupLayouts.camera,
        this.bindGroupLayouts.instance,
        this.bindGroupLayouts.tileTexture,
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
        binding: 0, resource: { buffer: this.buffers.camera }
      }],
    });

    this.bindGroups.instance = this.device.createBindGroup({
      label: "Instance",
      layout: this.bindGroupLayouts.instance,
      entries: [
        { binding: 0, resource: { buffer: this.buffers.instance } },
      ],
    });

    // Process each tile texture.
    this.samplers.tileTexture = device.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
    });

    const numTiles = this.numTiles;
    this.bindGroups.tileTextures = Array(numTiles);
    this.textures = Array(numTiles);
    for ( const [idx, tile] of this.#tileFromInstanceIndex ) {
      const url = tile.document.texture.src;
      const source = await loadImageBitmap(url, {
        imageOrientation: "flipY"
        // premultiplyAlpha: "none",
        // colorSpaceConversion: "none",
        // resizeQuality: "high",
       }); // TODO: colorSpaceConversion, shrink size to something more manageable
      this.textures[idx] = device.createTexture({
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
      this.bindGroups.tileTextures[idx] = device.createBindGroup({
        label: `Tile Texture ${idx}`,
        layout: this.bindGroupLayouts.tileTexture,
        entries: [
          { binding: 0, resource: this.samplers.tileTexture },
          { binding: 1, resource: this.textures[idx].createView() },
        ]
      });
    }

    this.#allocateRenderTargets();
    // this.pipelines.render = await this.pipelines.render;
  }

  /**
   * Render the scene from a given viewpoint.
   * TODO: Use dirty flag(s) to update 1+ drawable instances?
   * @param {Point3d} viewerLocation
   * @param {Token} target
   */
  async renderScene(viewerLocation, target, { vp, viewer } = {}) {
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

    // Must set the canvas context immediately prior to render.
    const view = this.#context ? this.#context.getCurrentTexture().createView() : this.renderTexture.createView();
    if ( this.sampleCount > 1 ) this.colorAttachment.resolveTarget = view;
    else {
      this.colorAttachment.view = view;
      this.colorAttachment.resolveTarget = undefined;
    }

    const commandEncoder = device.createCommandEncoder({ label: "Render tiles" });
    const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
    renderPass.setPipeline(this.pipelines.render);
    renderPass.setBindGroup(0, this.bindGroups.camera);
    renderPass.setBindGroup(1, this.bindGroups.instance);

    for ( let i = 0, n = this.buffers.vertex.length; i < n; i += 1 ) {
      renderPass.setVertexBuffer(0, this.buffers.vertex[i]);
    }

    for ( let i = 0, n = this.numTiles; i < n; i += 1 ) {
      // Set each bind group in turn and draw that instance.
      // This probably kills most benefits of the tile instance, but...
      renderPass.setBindGroup(2, this.bindGroups.tileTextures[i]);
      renderPass.draw(this.geometryDesc.numVertices, 1, 0, i);
    }

    // renderPass.setIndexBuffer(this.buffers.indices, "uint16");

    // renderPass.draw(3);
    // renderPass.drawIndexed(3);
    // renderPass.drawIndexed(this.tileVertexIndices.length);
    // renderPass.draw(this.geometryDesc.numVertices, this.numTiles);
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    return this.device.queue.onSubmittedWorkDone();
  }

  // ----- Tile placeable handling ----- //

  /**
   * Tile id mapped to its instance index.
   * @type {Map<string, number>}
   */
  instanceIndexFromId = new Map();

  /**
   * Tile instance index mapped to tile object.
   * @type {Map<string, Tile>}
   */
  #tileFromInstanceIndex = new Map();

  /** @type {number} */
  get numTiles() { return this.instanceIndexFromId.size; }

  /** @type {ArrayBuffer} */
  instanceArrayBuffer;

  get instanceArrayValues() { return new Float32Array(this.instanceArrayBuffer); }

  /**
   * For a given tile id, return the tile object, if it exists.
   * @param {string} id
   * @returns {Tile|undefined}
   */
  tileForId(tileId) { return canvas.tiles.documentCollection.get(tileId)?.object; }

  /**
   * Initialize all tiles.
   * TODO: Handle foreground as a tile.
   * TODO: Optionally render the scene floor as a tile for debugging.
   */
  initializeTiles() {
    this.instanceIndexFromId.clear();
    this.#tileFromInstanceIndex.clear();
    const tiles = canvas.tiles.placeables.filter(tile => this.includeTile(tile));
    this.instanceArrayBuffer = new ArrayBuffer(tiles.length * this.constructor.INSTANCE_ELEMENT_LENGTH);
    tiles.forEach((tile, idx) => {
      this.instanceIndexFromId.set(tile.id, idx);
      this.#tileFromInstanceIndex.set(idx, tile);
      this.updateTileInstanceData(tile.id, idx, tile);
    });
  }

  /**
   * Should this tile be included in the scene render?
   * TODO: Filter out constrained tiles.
   */
  includeTile(tile) {
    // Exclude tiles at elevation 0 because these overlap the ground.
    if ( !tile.elevationZ ) return false;

    // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
    if ( MODULES_ACTIVE.LEVELS
      && this.senseType === "sight"
      && tile.document?.flags?.levels?.noCollision ) return false;

    return true;
  }

  // ----- Instances ----- //

  /**
   * @typedef {object} TileInstanceData
   * @prop {Float32Array[16]} model           Model matrix (translation, rotation, scale)
   */

  /** @type {mat4} */
  #translationM = CONFIG.GeometryLib.MatrixFloat32.empty(4, 4);

  /** @type {mat4} */
  #scaleM = CONFIG.GeometryLib.MatrixFloat32.empty(4, 4);

  /** @type {mat4} */
  #rotationM = CONFIG.GeometryLib.MatrixFloat32.empty(4, 4);

  /**
   * Update the instance array of a specific tile.
   * @param {string} tileId       Id of the tile
   * @param {number} [idx]        Optional tile id; will be looked up using tileId otherwise
   * @param {Tile} [tile]         The tile associated with the id; will be looked up otherwise
   */
  updateTileInstanceData(tileId, idx, tile) {
    tile ??= this.tileForId(tileId);
    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;
    const ctr = this.constructor.tileCenter(tile);
    const { width, height } = this.constructor.tileDimensions(tile);

    // Move from center of tile.
    MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, this.#translationM);

    // Scale based on width, height of tile.
    MatrixFloat32.scale(width, height, 1.0, this.#scaleM);

    // Rotate based on tile rotation.
    MatrixFloat32.rotationZ(Math.toRadians(tile.document.rotation), true, this.#rotationM);

    // Combine and update the instance matrix. Multiplies right-to-left.
    // scale --> rotate --> translate.
    const arrM = this.getTileInstanceData(tileId, idx);
    const M = new MatrixFloat32(arrM, 4, 4);
    this.#scaleM.multiply4x4(this.#rotationM, M).multiply4x4(this.#translationM, M);

    return {
      translation: this.#translationM,
      rotation: this.#rotationM,
      scale: this.#scaleM,
      out: M,
    };
  }

  /**
   * Retrieve the array views associated with a given tile.
   * @param {string} tileId       Id of the tile
   * @param {number} [idx]        Optional tile id; will be looked up using tileId otherwise
   */
  getTileInstanceData(tileId, idx) {
    idx ??= this.instanceIndexFromId.get(tileId);
    const i = idx * this.constructor.INSTANCE_ELEMENT_LENGTH;
    return new Float32Array(this.instanceArrayBuffer, i, 16);
  }

  /**
   * Update the instance buffer on the GPU for a specific tile.
   * @param {string} tileId
   * @param {Float32Array} dat      Buffer from tileInstanceData method
   * @param {number} [idx]          Instance index of this tile
   */
  partialUpdateInstanceBuffer(tileId, idx) {
    idx ??= this.instanceIndexFromId.get(tileId);
    const dat = this.getEdgeInstanceData(tileId, idx);
    this.device.queue.writeBuffer(
      this.buffers.instance, idx * this.constructor.INSTANCE_ELEMENT_LENGTH, dat.buffer,
    );
  }

  /**
   * Determine the tile 3d dimensions, in pixel units.
   * @param {Tile} tile
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} elevation   In z direction
   */
  static tileDimensions(tile) {
    return {
      width: tile.document.width,
      height: tile.document.height,
    };
  }

  /**
   * Determine the center of the tile, in pixel units.
   * @param {Tile} tile
   * @returns {Point3d}
   */
  static tileCenter(tile) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const out = new Point3d();
    const elev = tile.elevationZ;
    const TL = Point3d._tmp2.set(tile.document.x, tile.document.y, elev);
    const BR = TL.add(out.set(tile.document.width, tile.document.height, 0), out);
    return TL.add(BR, out).multiplyScalar(0.5, out)
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



