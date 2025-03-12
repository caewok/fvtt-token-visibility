/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AttribLocation, Geometry } from "./GeometryObstacles.js";
import { WebGPUDevice, WebGPUShader, WebGPUBuffer } from "./WebGPU.js";
import { vec3, vec4, mat4, quat } from "../gl_matrix/index.js";
import { GeometryCubeDesc } from "./GeometryCube.js";
import { GeometryWallDesc } from "./GeometryWall.js";

/*
Basic approach:
- Define instances for a token cube, wall, directional wall.
- Each object gets a world matrix.
- Camera matrix defines the view. Zoom to fit the target token.
- Color target token red. Color other obstacles something, e.g. blue.
- Render two at once: target only and target + obstacles.
- Use compute to sum red pixels for each RT.

This file handles the rendering of the scene obstacles and target.
*/

export class WebGPUSceneObstacles {
  /** @type {object<GPUBindGroupLayout>} */
  bindgroupLayouts = {};

  /** @type {object<GPUBindGroup>} */
  bindgroups = {};

  /** @type {object<GPUBuffer>} */
  buffers = {};

  /** @type {object<GPUPipeline>} */
  pipelines = {};

  /** @type {Map<string, GPUBindGroupLayout>} */
  materials = new Map();

  /** @type {object<GPUShader>} */
  shaders = {};

  /** @type {map<string, GeometryObject>} */
  geometries = new Map();

  /** @type {string} */
  depthFormat = "depth24plus";

  /** @type {number} */
  sampleCount = 1;

  /** @type {object} */
  clearColor = { r: 0, g: 0, b: 0, a: 1.0 };

  /** @type {object[]} */
  drawables = [];

  /** @type {Float32Array} */
  instanceArray = new Float32Array(0);

  static FRAME_BUFFER_SIZE = Float32Array.BYTES_PER_ELEMENT * 57;

  #frameArrayBuffer = new ArrayBuffer(this.constructor.FRAME_BUFFER_SIZE);
  #projectionMatrix = new Float32Array(this.#frameArrayBuffer, 0, 16);
  #viewMatrix = new Float32Array(this.#frameArrayBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16);
  #frustum = new Float32Array(this.#frameArrayBuffer, 32 * Float32Array.BYTES_PER_ELEMENT, 24);

  static BINDGROUP_OPTS = {
    MATERIAL: {
      layout: "Material", // TODO: What is layout used for here?
      label: "Material",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {},
      }]
    },

    INSTANCE: {
      layout: "Instance",
      label: "Instance",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: "read-only-storage" },
      },
//       {
//         binding: 1,
//         visibility: GPUShaderStage.VERTEX,
//         buffer: { type: "read-only-storage" },
//       }
      ]
    },

    FRAME: {
      label: "Frame BindGroupLayout",
      entries: [{
        binding: 0, // Camera/Frame uniforms
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: {},
      }]
    },
  };

  /** @type {GPUTexture} */
  #renderTexture;

  get renderTexture() {
    if ( !this.#renderTexture ) this.setRenderTextureToNewTexture();
    return this.#renderTexture;
  }

  set renderTexture(value) { this.#renderTexture = value; }

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
    this._allocateRenderTargets();
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
    this._allocateRenderTargets();
  }

  /** @type {number} */
  static INSTANCE_ELEMENT_LENGTH = 12; // Position (vec3), Axis (vec3), Scale (vec3)

  /**
   * @param {GPUDevice} device
   */
  constructor(device) {
    this.device = device;
    this.camera = new Camera();
  }

  /**
   * Initialize the shader and pipelines to render obstacles in the scene.
   */
  async initialize() {
    const device = this.device ??= await WebGPUDevice.getDevice();

    this.buffers.frame = this.device.createBuffer({
      size: this.constructor.FRAME_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const BG_OPTS = this.constructor.BINDGROUP_OPTS;
    this.bindgroupLayouts.frame = device.createBindGroupLayout(BG_OPTS.FRAME);
    this.bindgroupLayouts.material = device.createBindGroupLayout(BG_OPTS.MATERIAL);
    this.bindgroupLayouts.instance = device.createBindGroupLayout(BG_OPTS.INSTANCE);

    this.bindgroups.frame = device.createBindGroup({
      label: "Frame Bindgroup",
      layout: this.bindgroupLayouts.frame,
      entries: [{
        binding: 0, // Camera uniforms
        resource: { buffer: this.buffers.frame },
      }],
    });

    this.materials.set("target", this._createMaterialBindGroup(1, 0, 0, 1, "Target")); // Red target token.
    this.materials.set("obstacle", this._createMaterialBindGroup(0, 0, 1, 1, "Obstacle")); // Blue generic obstacle.
    this.materials.set("terrain", this._createMaterialBindGroup(0, 1, 0, 0.5, "Terrain")); // Transparent green terrain wall.


    // Geometry for tokens, walls.
    // TODO: Tiles, hex tokens, constrained tokens, custom token shapes.
    const batchGeom = Geometry.CreateBatch(device, [
      new GeometryCubeDesc(),
      new GeometryWallDesc(),
      new GeometryWallDesc({ directional: true }),
    ]);

    this.geometries.set("cube", batchGeom[0]);
    this.geometries.set("wall", batchGeom[0]);
    this.geometries.set("directional wall", batchGeom[0]);

    // Geometry shader.
    this.shaders.geometry = await WebGPUShader.fromGLSLFile(device, "obstacle_geometry_shader", "Geometry", { AttribLocation });

    // Geometry pipeline.
    const layout0 = this.geometries.get("cube").layout;
    this.pipelines.geometry = device.createRenderPipeline({
      label: "Geometry",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [
          this.bindgroupLayouts.frame,
          this.bindgroupLayouts.material,
          this.bindgroupLayouts.instance,
        ],
      }),
      vertex: {
        module: this.shaders.geometry,
        entryPoint: "vertexMain",
        buffers: layout0.buffers,
      },
      primitive: {
        topology: layout0.topology,
        stripIndexFormat: layout0.stripIndexFormat,
      },
      fragment: {
        module: this.shaders.geometry,
        entryPoint: "fragmentMain",
        targets: [{
          format: WebGPUDevice.presentationFormat,
        }],
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

    // TODO: Culled module and pipeline.

    // Construct instances.
    this.instanceArray = new Float32Array(this.numDrawables * this.constructor.INSTANCE_ELEMENT_LENGTH);
    this.createDrawable(this.createWallInstances(), this.geometries.get("wall"), this.materials.get("obstacle"));
    this.createDrawable(this.createTokenInstances(), this.geometries.get("cube"), this.materials.get("obstacle"));
    this.updateInstanceBuffer();

    this._allocateRenderTargets();

    // Make sure we have a pipeline before returning.
    // this.pipelines.geometry = await this.pipelines.geometry;
  }

  // TODO: Implement.
  // Clear the render bundle cache any time the instance count changes.
  updateInstanceCount() {
    // this.renderBundles.clear();

  }

  /** @type {object<width: {number}, height: {number}>} */
  #renderSize = { width: 200, height: 200 };

  get renderSize() { return this.#renderSize; }

  set renderSize(value) {
    this.#renderSize.width = value.width;
    this.#renderSize.height = value.height;
    this._allocateRenderTargets();
  }

 /** @type {GPUTexture} */
  msaaColorTexture;

  /** @type {GPUTexture} */
  depthTexture;

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

  _allocateRenderTargets() {
    const size = this.renderSize;

    if ( this.msaaColorTexture ) {
      this.msaaColorTexture.destroy();
      this.msaaColorTexture = undefined;
    }

    if ( this.sampleCount > 1 ) {
      this.msaaColorTexture = this.device.createTexture({
        size,
        sampleCount: this.sampleCount,
        format: WebGPUDevice.presentationFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }

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

    if ( this.sampleCount > 1 ) {
      this.colorAttachment.view = this.msaaColorTexture.createView();
      this.colorAttachment.resolveTarget = this.renderTexture.createView();
    } else {
      this.colorAttachment.resolveTarget = undefined;
      this.colorAttachment.view = this.renderTexture.createView();
    }
    this.colorAttachment.clearValue = this.clearColor;

    this.renderPassDescriptor.colorAttachments[0] = this.colorAttachment;
    this.renderPassDescriptor.depthStencilAttachment.view = this.depthTexture.createView();
  }

  /**
   * Update the instance buffer.
   * Used when a drawable object changes.
   */
  updateInstanceBuffer() {
    const INSTANCE_ELEMENT_LENGTH = this.constructor.INSTANCE_ELEMENT_LENGTH;
    // TODO: Implement; handle single or multiple changes.
    for ( const drawable of this.drawables ) {
      // TODO: Update matrix for 1+ instances.
      // TODO: Update only those necessary.
      this.device.queue.writeBuffer(
        drawable.instanceBuffer, 0, this.instanceArray, 0, drawable.instances.length * INSTANCE_ELEMENT_LENGTH);
    }
  }

  /**
   * Render the scene from a given viewpoint.
   * TODO: Use dirty flag(s) to update 1+ drawable instances?
   * @param {Point3d} viewerLocation
   * @param {Token} target
   */
  renderScene(viewerLocation, target) {
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this.camera.viewerLocation = viewerLocation;
    this.camera.targetLocation = targetLocation;
    this.camera.setTargetTokenFrustrum(target);
    this.#viewMatrix.set(this.camera.viewMatrix);
    this.#projectionMatrix.set(this.camera.perspectiveMatrix);
    this.updateFrustum();
    this.device.queue.writeBuffer(this.buffers.frame, 0, this.#frameArrayBuffer);

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.pushDebugGroup("Outside Render Pass");
    const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
    renderPass.pushDebugGroup('Inside Render Pass');
    this.drawScene(renderPass, this.pipelines.geometry, this.bindgroups.frame);
    renderPass.popDebugGroup();
    renderPass.end();
    commandEncoder.popDebugGroup();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  updateFrustum() {
    const frustum = this.camera.frustum;
    this.#frustum.set(frustum.left);
    this.#frustum.set(frustum.right, 4);
    this.#frustum.set(frustum.top, 4);
    this.#frustum.set(frustum.bottom, 4);
    this.#frustum.set(frustum.near, 4);
    this.#frustum.set(frustum.far, 4);
  }

  /**
   * Render every drawable in the scene.
   * @param {GPURenderEncoder} renderEncoder
   * @param {} mode
   * @param {GPUPipeline} pipeline
   */
  drawScene(renderEncoder, pipeline, frameBindGroup) {
    renderEncoder.pushDebugGroup("Draw Scene");
    renderEncoder.setBindGroup(0, frameBindGroup);
    renderEncoder.setPipeline(pipeline);

    for ( const drawable of this.drawables ) {
      renderEncoder.setBindGroup(1, drawable.material);
      renderEncoder.setBindGroup(2, drawable.instanceBindGroup);
      drawable.geometry.setBuffers(renderEncoder);

      // TODO: use culling.
      // Instanced for now.
      drawable.geometry.draw(renderEncoder, drawable.instances.length);
    }

    renderEncoder.popDebugGroup();
  }



  /** @type {number} */
  get numDrawables() {
    // 1 for each token in the scene (TODO: Version that sets camera to viewer and excludes viewer.)
    // 1 for each wall (either normal, directional, terrain)
    // TODO: Version that handles other wall types, e.g. terrain (region) walls.
    return canvas.walls.placeables.length + canvas.tokens.placeables.length;
  }

  createWallInstances() {
    // TODO: Version that handles other wall types, e.g. terrain (region) walls.
    return canvas.walls.placeables.map(wall => this.constructor.wallInstance(wall));
  }

  createTokenInstances() {
    // TODO: Version that excludes viewer, sets target.
    return canvas.tokens.placeables.map(token => this.constructor.tokenInstance(token));
  }

  createDrawable(instances, geometry, material) {
     // TODO: Sort the instances so that the closest ones to the target are drawn first to improve overdraw.
     // instances.sort((a, b) => vec3.length(a.pos) - vec3.length(b.pos)); // Fix to sort from target center
     const instanceBuffer = this.device.createBuffer({
       label: "Instance",
       size: this.instanceArray.byteLength,
       usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
     });

     const instanceBindGroup = this.device.createBindGroup({
       label: "Instance",
       layout: this.bindgroupLayouts.instance,
       entries: [{
         binding: 0,
          resource: { buffer: instanceBuffer }
       }],
     });

     this.drawables.push({
       material,
       geometry,
       instances,
       // instanceCount: instances.length, // TODO: Fix or remove.
       instanceBuffer,
       instanceBindGroup,
     });
  }

  static wallInstance(wall) { return this.edgeInstance(wall.edge); }

  static edgeInstance(edge) {
    // Move edge from its center point.
    const ctr = this.edgeCenter(edge);

    // Add in a translate to move back to 0,0 if the elevations do not match.
    // E.g., top = 20, bottom = -1e06. Wall is 20 + 1e06 = 1000020 high.
    //   Before translation, it is at 1000020 * 0.5 = 500010 top / -500010 bottom.
    //   Move 500010 - 20 down (-(topHeight - top) == top - topHeight.
    // E.g., top = 1e06, bottom = -20. Wall is 20 + 1e06 = 1000020 high.
    //   Before translation, it is at 1000020 * 0.5 = 500010 top / -500010 bottom.
    //   Move 500010 - 1e06 down (move up).
    const { top, bottom } = this.edgeElevation(edge);
    const topHeight = (top - bottom) * 0.5;
    const z = top !== bottom ? (top - topHeight) : 0;
    const pos = vec3.fromValues(ctr.x, ctr.y, z);

    // Scale wall by its length from its center points.
    const scale = vec3.fromValues(this.edgeLength(edge), 1, (top - bottom) || 1);

    // Rotate along the z axis to match the wall direction.
    const axis = vec3.fromValues(0, 0, this.edgeAngle(edge));
    return { pos, scale, axis };
  }

  static edgeElevation(edge) {
    let { top, bottom } = edge.elevationLibGeometry.a;
    top ??= 1e05;
    bottom ??= -1e05;
    top = CONFIG.GeometryLib.utils.gridUnitsToPixels(top);
    bottom = CONFIG.GeometryLib.utils.gridUnitsToPixels(bottom);
    return { top, bottom };
  }

  static edgeCenter(edge) {
    const ctr = new PIXI.Point();
    return edge.a.add(edge.b, ctr).multiplyScalar(0.5, ctr);
  }

  static edgeLength(edge) { return PIXI.Point.distanceBetween(edge.a, edge.b); }

  static edgeAngle(edge) {
    const delta = edge.b.subtract(edge.a, PIXI.Point._tmp3);
    return Math.atan2(delta.y, delta.x);
  }

  static tokenInstance(token) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const size = canvas.dimensions.size;
    const pos = vec3.fromValues(...Point3d.fromTokenCenter(token));
    const scale = vec3.fromValues(token.document.w * size, token.document.h * size, token.topZ - token.bottomZ);
    const axis = vec3.fromValues(0, 0, 0);
    return { pos, scale, axis };
  }




  /**
   * Create a buffer to store information about obstacle "material," i.e. color or other params.
   */
  _createMaterialBindGroup(r, g, b, a = 1, label = "") {
    label = `Material ${label} (${r}, ${g}, ${b})`;
    this.buffers.material = WebGPUBuffer.initializeUniforms(
      this.device,
      Float32Array,
      arr => {
        arr[0] = r;
        arr[1] = g;
        arr[2] = b;
        arr[3] = a;
      },
      { label },
    );
    return this.device.createBindGroup({
      label,
      layout: this.bindgroupLayouts.material,
      entries: [{
        binding: 0,
        resource: { buffer: this.buffers.material }
      }],
    });
  }

}


const tmpMat = mat4.create();
const tmpVec3 = vec3.create();

class Camera {

  static UP = vec3.fromValues(0, 1, 0);

  constructor({ cameraPosition, targetPosition, frustumParameters } = {}) {
    if ( cameraPosition ) this.cameraPosition = cameraPosition;
    if ( targetPosition ) this.targetPosition = targetPosition;
    if ( frustumParameters ) this.frustum = frustumParameters;
  }

  /**
   * Set the field of view and zFar for a target token, to maximize the space the token
   * takes up in the frame.
   * @param {Token} targetToken
   */
  setTargetTokenFrustrum(targetToken) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(targetToken);
    const a = Point3d._tmp1;
    const b = Point3d._tmp2;
    const c = Point3d._tmp3;
    a.copyFrom(ctr);
    b.set(this.cameraPosition);
    c.copyFrom(ctr);
    b.z = targetToken.topZ;
    c.z = targetToken.bottomZ;
    const fov = Point3d.angleBetween(a, b, c);
    const zFar = Math.sqrt(Math.max(
      Point3d.distanceSquaredBetween(b, a),
      Point3d.distanceSquaredBetween(b, c)));
    this.perspectiveParameters = { fov, zFar };
  }

  /**
   * @typedef {object} frustrumParameters
   * @prop {number} left   Coordinate for left vertical clipping plane
   * @prop {number} right  Coordinate for right vertical clipping plane
   * @prop {number} bottom Coordinate for the bottom horizontal clipping plane
   * @prop {number} top    Coordinate for the top horizontal clipping plane
   * @prop {number} zNear    Distance from the viewer to the near clipping plane (always positive)
   * @prop {number} zFar     Distance from the viewer to the far clipping plane (always positive)
   */
  #perspectiveParameters = {
    fov: Math.toRadians(60),
    aspect: 1,
    zNear: 1, // Or 0.1?
    zFar: 100,
  }

  /** @type {mat4} */
  #perspectiveMatrix = mat4.create();

  #dirtyPerspective = true;

  /** @type {MatrixFlat<4x4>} */
  get perspectiveMatrix() {
    if ( this.#dirtyPerspective ) {
      mat4.perspective(this.#perspectiveMatrix, ...Object.values(this.#perspectiveParameters));
      this.#dirtyPerspective = false;
    }
    return this.#perspectiveMatrix;
  }

  set perspectiveParameters(params = {}) {
    this.#dirtyPerspective ||= true;
    this.#dirtyFrustum ||= true;
    for ( const [key, value] of Object.entries(params) ) {
      this.#perspectiveParameters[key] = value;
    }
  }

  /** @type {mat4} */
  #viewMatrix = mat4.create();

  #dirtyCamera = true;

  get viewMatrix() {
    if ( this.#dirtyCamera ) {
      mat4.lookAt(this.#viewMatrix, this.#cameraPosition, this.#targetPosition, this.constructor.UP);
      this.#dirtyCamera = false;
    }
    return this.#viewMatrix;
  }

  #cameraPosition = vec3.create();

  #targetPosition = vec3.create();

  get cameraPosition() { return this.#cameraPosition; }

  get targetPosition() { return this.#targetPosition; }

  set cameraPosition(value) {
    this.#dirtyCamera ||= true;
    this.#dirtyFrustum ||= true;
    this.#cameraPosition.set(value.x, value.y, value.z);
  }

  set targetPosition(value) {
    this.#dirtyCamera ||= true;
    this.#dirtyFrustum ||= true;
    this.#targetPosition.set(value.x, value.y, value.z);
  }

  /** @type {object<vec4>} */
  #frustum = {
    left: vec4.create(),
    right: vec4.create(),
    top: vec4.create(),
    bottom: vec4.create(),
    near: vec4.create(),
    far: vec4.create(),
  };

  #dirtyFrustum = true;

  get frustum() {
    if ( this.#dirtyFrustum ) {
      mat4.mul(tmpMat, this.perspectiveMatrix, this.viewMatrix);

      // Left clipping plane
      vec3.set(tmpVec3, tmpMat[3] + tmpMat[0], tmpMat[7] + tmpMat[4], tmpMat[11] + tmpMat[8]);
      let invL = 1 / vec3.length(tmpVec3);
      vec3.multiply(tmpVec3, tmpVec3, invL);
      this.#frustum.left.set(tmpVec3[0], tmpVec3[1], tmpVec3[2], (tmpMat[15] + tmpMat[12]) * invL);

      // Right clipping plane
      vec3.set(tmpVec3, tmpMat[3] - tmpMat[0], tmpMat[7] - tmpMat[4], tmpMat[11] - tmpMat[8]);
      invL = 1 / vec3.length(tmpVec3);
      vec3.multiply(tmpVec3, tmpVec3, invL);
      this.#frustum.right.set(tmpVec3[0], tmpVec3[1], tmpVec3[2], (tmpMat[15] - tmpMat[12]) * invL);

       // Top clipping plane
      vec3.set(tmpVec3, tmpMat[3] - tmpMat[1], tmpMat[7] - tmpMat[5], tmpMat[11] - tmpMat[9]);
      invL = 1 / vec3.length(tmpVec3);
      vec3.multiply(tmpVec3, tmpVec3, invL);
      this.#frustum.top.set(tmpVec3[0], tmpVec3[1], tmpVec3[2], (tmpMat[15] - tmpMat[13]) * invL);

      // Bottom clipping plane
      vec3.set(tmpVec3, tmpMat[3] + tmpMat[1], tmpMat[7] + tmpMat[5], tmpMat[11] + tmpMat[9]);
      invL = 1 / vec3.length(tmpVec3);
      vec3.multiply(tmpVec3, tmpVec3, invL);
      this.#frustum.bottom.set(tmpVec3[0], tmpVec3[1], tmpVec3[2], (tmpMat[15] + tmpMat[13]) * invL);

      // Near clipping plane
      vec3.set(tmpVec3, tmpMat[2], tmpMat[6], tmpMat[10]);
      invL = 1 / vec3.length(tmpVec3);
      vec3.multiply(tmpVec3, tmpVec3, invL);
      this.#frustum.near.set(tmpVec3[0], tmpVec3[1], tmpVec3[2], tmpMat[14]  * invL);

      // Far clipping plane
      vec3.set(tmpVec3, tmpMat[3] - tmpMat[2], tmpMat[7] - tmpMat[6], tmpMat[11] - tmpMat[10]);
      invL = 1 / vec3.length(tmpVec3);
      vec3.multiply(tmpVec3, tmpVec3, invL);
      this.#frustum.far.set(tmpVec3[0], tmpVec3[1], tmpVec3[2], (tmpMat[15] - tmpMat[14]) * invL);

      this.#dirtyFrustum = false;
    }
    return this.#frustum;
  }
}

// projection mat4x4f
// view mat4x4f
// position vec3f
// frustrum vec4f, 6



/*
Adapted from https://github.com/toji/webgpu-bundle-culling

MIT License

Copyright (c) 2023 Brandon Jones

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
