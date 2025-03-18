/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";
import { Camera } from "./Camera.js";
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
  edgeVertexPositions;

  /** @type {Uint16Array} */
  edgeVertexIndices;

  async initialize() {
    const device = this.device ??= await WebGPUDevice.getDevice();

    // Define shader.
    this.modules.render = await WebGPUShader.fromGLSLFile(device, "wall", "Wall Render");

    this.initializeEdges();

    // Vertex buffer
    const geometryDesc = new GeometryWallDesc({ label: "Wall Geometry", directional: false });
    this.geometryDesc = geometryDesc;
    const numVertexBuffers = geometryDesc.verticesData.length;
    this.buffers.vertex = Array(numVertexBuffers);
    for ( let i = 0; i < numVertexBuffers; i += 1 ) {
      const data = geometryDesc.verticesData[i];
      this.buffers.vertex[i] = device.createBuffer({
        label: `Wall Vertices Buffer ${i}`,
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
      label: "Wall Instance",
      size: this.numEdges * this.constructor.INSTANCE_ELEMENT_LENGTH,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.buffers.instance, 0, this.instanceArrayBuffer); // 0 , this.constructor.INSTANCE_ELEMENT_LENGTH * this.numEdges


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
//
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

    const commandEncoder = device.createCommandEncoder({ label: "Render walls" });
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
    // renderPass.drawIndexed(this.edgeVertexIndices.length);
    renderPass.draw(this.geometryDesc.numVertices, this.numEdges);
    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
    return this.device.queue.onSubmittedWorkDone();
  }

  // ----- Wall placeable handling ----- //

  /** @type {Map<string, Edge>} */
  edges = new Map();

  /** @type {Map<string, number>} */
  #edgeInstanceIndices = new Map();

  /** @type {number} */
  get numEdges() { return this.edges.size; }

  /** @type {ArrayBuffer} */
  instanceArrayBuffer;

  get instanceArrayValues() { return new Float32Array(this.instanceArrayBuffer); }

  /**
   * Initialize all edges.
   */
  initializeEdges() {
    this.edges.clear();
    this.#edgeInstanceIndices.clear();
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

  /** @type {MatrixFlat<4,4>} */
  #translationM = CONFIG.GeometryLib.MatrixFloat32.empty(4, 4);

  /** @type {MatrixFlat<4,4>} */
  #scaleM = CONFIG.GeometryLib.MatrixFloat32.empty(4, 4);

  /** @type {MatrixFlat<4,4>} */
  #rotationM = CONFIG.GeometryLib.MatrixFloat32.empty(4, 4);

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
    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;
    const pos = this.constructor.edgeCenter(edge);
    const { top, bottom } = this.constructor.edgeElevation(edge);
    const rot = this.constructor.edgeAngle(edge);
    const ln = this.constructor.edgeLength(edge);

    // Add in translate to center to 0,0 if elevations do not match.
    // e.g., bottom elevation -1e05, top elevation 200.
    let z = 0.0;
    let scaleZ = 1.0;
    if ( top != bottom ) {
      z = ((0.5 * top) + (0.5 * bottom));
      scaleZ = top - bottom;
    }

    // Move from center of wall.
    MatrixFloat32.translation(pos.x, pos.y, z, this.#translationM);

    // Scale by its length and elevation (height).
    MatrixFloat32.scale(ln, 1.0, scaleZ, this.#scaleM);

    // Rotate around Z axis to match wall direction.
    MatrixFloat32.rotationZ(rot, true, this.#rotationM);

    // Combine and update the instance matrix.
    // This is uploaded as row-major.
    // See the confusion discussed here: https://glmatrix.net/
    // glMatrix uses the same convention and should be identical.
    const arrM = this.getEdgeInstanceData(edgeId, idx);
    const M = new MatrixFloat32(arrM, 4, 4);

    this.#scaleM
      .multiply4x4(this.#rotationM, M)
      .multiply4x4(this.#translationM, M);

    // Return only for debugging.
    return {
      translation: this.#translationM,
      scale: this.#scaleM,
      rotation: this.#rotationM,
      out: M
    };
  }
  /*
  MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;
  Point3d = CONFIG.GeometryLib.threeD.Point3d;
  api = game.modules.get("tokenvisibility").api
  GeometryWallDesc = api.webgpu.GeometryWallDesc;
  let [[edgeId, edge]] = renderWalls.edges;
  tmpMat = MatrixFloat32.empty(4, 4)
  res = renderWalls.updateEdgeInstanceData(edgeId);
  res.scale.print()
  res.rotation.print()
  res.translation.print()

  res.scale
      .multiply4x4(res.rotation, tmpMat)
      .multiply4x4(res.translation, tmpMat);
  tmpMat.print()
  tmpMat.toColumnMajorArray()

  geom = new GeometryWallDesc();
  arr = geom.verticesData[0];

  edgeElev = renderWalls.constructor.edgeElevation(edge);
  console.log(`Edge ${edge.a.x},${edge.a.y} -> ${edge.b.x},${edge.b.y} | top ${edgeElev.top} | bottom ${edgeElev.bottom}`)
  for ( let i = 0; i < arr.length; i += 8) {
    console.log(tmpMat.multiplyPoint3d(new Point3d(arr[i], arr[i + 1], arr[i + 2])))
  }


  i = 0
  tmpMat.multiplyPoint3d(new Point3d(arr[i * 8], arr[(i * 8) + 1], arr[(i * 8) + 2]))
  */

  /*
  pos = renderWalls.constructor.edgeCenter(edge);
  let edgeElev = renderWalls.constructor.edgeElevation(edge);

  rot = renderWalls.constructor.edgeAngle(edge);
  ln = renderWalls.constructor.edgeLength(edge);
  let z = 0.0;
  let scaleZ = 1.0;
  if ( edgeElev.top != edgeElev.bottom ) {
    z = ((0.5 * edgeElev.top) + (0.5 * edgeElev.bottom));
    scaleZ = edgeElev.top - edgeElev.bottom;
  }

  MatrixFlat = CONFIG.GeometryLib.MatrixFlat;
  Point3d = CONFIG.GeometryLib.threeD.Point3d;

  tMat = MatrixFlat.translation(pos.x, pos.y, z)
  rMat = MatrixFlat.rotationZ(rot)
  sMat = MatrixFlat.scale(ln, 1.0, scaleZ)
  outMat = sMat.multiply(rMat).multiply(tMat)
  tMat.print()
  rMat.print()
  sMat.print()
  outMat.print()

  rMat.multiplyPoint3d(new Point3d(0.5, 0, 0.5))
  rMat.multiplyPoint3d(new Point3d(-0.5, 0, 0.5))
  rMat.multiplyPoint3d(new Point3d(-0.5, 0, -0.5))

  outMat.multiplyPoint3d(new Point3d(0.5, 0, 0.5))
  outMat.multiplyPoint3d(new Point3d(-0.5, 0, 0.5))
  outMat.multiplyPoint3d(new Point3d(-0.5, 0, -0.5))

  renderWalls.updateEdgeInstanceData("kDONy9fhzUd0jFyi")
  dat = renderWalls.getEdgeInstanceData("kDONy9fhzUd0jFyi")

  mat4.identity(M);
  mat4.multiply(M, dat.rotationM, dat.scaleM);
  mat4.multiply(M, dat.translationM, M);

  */

  /**
   * Retrieve the array views associated with a given edge.
   * @param {string} edgeId       Id of the edge
   * @param {number} [idx]        Optional edge id; will be looked up using edgeId otherwise
   */
  getEdgeInstanceData(edgeId, idx) {
    idx ??= this.#edgeInstanceIndices.get(edgeId);
    const i = idx * this.constructor.INSTANCE_ELEMENT_LENGTH;
    return new Float32Array(this.instanceArrayBuffer, i, 16);
  }

  /**
   * Update the instance buffer on the GPU for a specific edge.
   * @param {string} edgeId
   * @param {Float32Array} dat      Buffer from edgeInstanceData method
   * @param {number} [idx]          Instance index of this edge
   */
  partialUpdateInstanceBuffer(edgeId, idx) {
    idx ??= this.#edgeInstanceIndices.get(edgeId);
    const M = this.getEdgeInstanceData(edgeId, idx).M;
    this.device.queue.writeBuffer(
      this.buffers.instance, idx * this.constructor.INSTANCE_ELEMENT_LENGTH, M,
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


