/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../../geometry/3d/Point3d.js";

export class Camera {

  static UP = new Point3d(0, 0, 1); // Cannot use CONFIG.GeometryLib.threeD.Point3d in static defs.

  static MIRRORM_DIAG = new Point3d(-1, 1, 1);

  /**
   * @typedef {object} CameraStruct
   * @param {mat4x4f} perspectiveM          The perspective matrix
   * @param {mat4x4f} lookAtM               Matrix to shift world around a camera location
   */

  static CAMERA_BUFFER_SIZE = Float32Array.BYTES_PER_ELEMENT * (16 + 16); // Total size of CameraStruct

  /** @type {object} */
  static CAMERA_LAYOUT = {
    label: "Camera",
    entries: [{
      binding: 0, // Camera/Frame uniforms
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
      buffer: {},
    }]
  };

  /** @type {GPUBindGroupLayout} */
//   bindGroupLayout;

  /** @type {GPUBuffer} */
//   deviceBuffer;

  /** @type {GPUBindGroup} */
//   bindGroup;

  // TODO: Combine so that the buffer stores the camera values instead of repeating them.
  // Could use MatrixFlat to store the buffer views.
  // Need to update MatrixFlat to handle the WebGPU perspectiveZO.

  /** @type {ArrayBuffer} */
  #arrayBuffer = new ArrayBuffer(this.constructor.CAMERA_BUFFER_SIZE);

  /** @type {object<Float32Array(16)|mat4>} */
  #M = {
    perspective: new CONFIG.GeometryLib.MatrixFloat32(new Float32Array(this.#arrayBuffer, 0, 16), 4, 4),
    lookAt: new CONFIG.GeometryLib.MatrixFloat32(new Float32Array(this.#arrayBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16), 4, 4),
  };

  /** @type {MatrixFloat32<4,4>} */
  #cameraM = CONFIG.GeometryLib.MatrixFloat32.empty(4, 4);

  /** @type {MatrixFloat32<4,4>} */
  mirrorM = CONFIG.GeometryLib.MatrixFloat32.identity(4, 4);

  /** @type {boolean} */
  #dirty = {
    perspective: true,
    lookAt: true,
  };

  /** @type {function} */
  #perspectiveFn = CONFIG.GeometryLib.MatrixFloat32.perspectiveZO;

  #internalParams = {};

  UP = new Point3d();



  /**
   * @type {object} [opts]
   * @type {Point3d} [opts.cameraPosition]
   * @type {Point3d} [opts.targetPosition]
   * @type {Point3d} [opts.glType="webGPU"]     Whether the NDC Z range is [-1, 1] ("webGL") or [0, 1] ("webGPU").
   * @type {string} [opts.perspectiveType="perspective"]      Type of perspective: "orthogonal" or "perspective"
   */
  constructor({
    cameraPosition,
    targetPosition,
    glType = "webGPU",
    perspectiveType = "perspective",
    up = this.constructor.UP,
    mirrorMDiag = this.constructor.MIRRORM_DIAG } = {}) {
    if ( cameraPosition ) this.cameraPosition = cameraPosition;
    if ( targetPosition ) this.targetPosition = targetPosition;
    this.UP.copyFrom(up);

    // See https://stackoverflow.com/questions/68912464/perspective-view-matrix-for-y-down-coordinate-system
    this.mirrorM.setIndex(0, 0, mirrorMDiag.x);
    this.mirrorM.setIndex(1, 1, mirrorMDiag.y);
    this.mirrorM.setIndex(2, 2, mirrorMDiag.z);

    const fnName = `${perspectiveType}${glType === "webGPU" ? "ZO" : ""}`;
    this.#perspectiveFn = CONFIG.GeometryLib.MatrixFloat32[fnName];
    this.#internalParams = perspectiveType === "orthogonal"
      ? this.#orthogonalParameters : this.#perspectiveParameters;

//     this.bindGroupLayout = device.createBindGroupLayout(this.constructor.CAMERA_LAYOUT);
//     this._createBindGroup();
  }

//   _createBindGroup() {
//     const buffer = this.deviceBuffer = this.device.createBuffer({
//       label: "Camera",
//       size: Camera.CAMERA_BUFFER_SIZE,
//       usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
//     });
//     // Buffer will be written to GPU prior to render, because the camera view will change.
//     this.bindGroup = this.device.createBindGroup({
//       label: "Camera",
//       layout: this.bindGroupLayout,
//       entries: [{
//         binding: 0,
//         resource: { buffer }
//       }],
//     });
//   }

//   updateDeviceBuffer() {
//     this.device.queue.writeBuffer(this.deviceBuffer, 0, this.arrayBuffer);
//     this.debugBuffer = new Float32Array(this.arrayBuffer)
//   }

  /**
   * Set the field of view and zFar for a target token, to maximize the space the token
   * takes up in the frame.
   * @param {Token} targetToken
   */
  setTargetTokenFrustum(targetToken) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const ctr = Point3d.fromTokenCenter(targetToken);
    this.targetPosition = ctr;

    const targetWidth = targetToken.document.width * canvas.dimensions.size;
    const targetHeight = targetToken.document.height * canvas.dimensions.size;
    const targetZHeight = targetToken.topZ - targetToken.bottomZ;

    const distToTarget = Point3d.distanceBetween(this.cameraPosition, this.targetPosition)
    const halfAngle = Math.atan(Math.max(targetWidth, targetHeight, targetZHeight) / distToTarget)

    // zFar is the straight-line distance to the target.
    // Buffer by adding in half the target diagonal.
    // const targetDiag = Math.sqrt(Math.pow(targetWidth, 2) + Math.pow(targetHeight, 2))
    // const zFar = Point3d.distanceBetween(this.cameraPosition, this.targetPosition) + (targetDiag * 0.5);
    const zFar = Infinity;
    this.perspectiveParameters = { fov: halfAngle * 2, zFar };

    // Just for kicks, calculate orthogonal parameters.
    // Take the bounding box of the target token.
    // Convert to camera space and set max.
    // See https://www.scratchapixel.com/lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/orthographic-projection-matrix.html
    const minWorld = new Point3d(
      targetToken.document.x,
      targetToken.document.y,
      targetToken.elevationZ,
    );
    minWorld.multiplyScalar(0.99, minWorld);
    const maxWorld = new Point3d(
      (targetToken.document.x + targetWidth),
      (targetToken.document.y + targetHeight),
      targetToken.topZ * 1.01,
    );
    maxWorld.multiplyScalar(1.1, maxWorld);
    const minCamera = this.lookAtMatrix.multiplyPoint3d(minWorld);
    const maxCamera = this.lookAtMatrix.multiplyPoint3d(maxWorld);
    const max = Math.max(minCamera.x, minCamera.y, maxCamera.x, maxCamera.y)
    this.orthogonalParameters = {
      left: -max,
      right: max,
      top: max,
      bottom: -max,
      near: 1,
      far: zFar,
    }
  }

  /**
   * @typedef {object} frustumParameters
   * @prop {number} left   Coordinate for left vertical clipping plane
   * @prop {number} right  Coordinate for right vertical clipping plane
   * @prop {number} bottom Coordinate for the bottom horizontal clipping plane
   * @prop {number} top    Coordinate for the top horizontal clipping plane
   * @prop {number} zNear    Distance from the viewer to the near clipping plane (always positive)
   * @prop {number} zFar     Distance from the viewer to the far clipping plane (always positive)
   */
  #perspectiveParameters = {
    fov: Math.toRadians(90),
    aspect: 1,
    zNear: 1,
    zFar: Infinity,
  }

  /** @type {MatrixFloat32<4x4>} */
  get perspectiveMatrix() {
    if ( this.#dirty.perspective ) {
      // mat4.perspective or perspectiveZO?
      // const { fov, aspect, zNear, zFar } = this.#perspectiveParameters;
      // CONFIG.GeometryLib.MatrixFloat32.perspectiveZO(fov, aspect, zNear, zFar, this.#M.perspective);
      this.#perspectiveFn(...Object.values(this.#internalParams), this.#M.perspective);

      // See https://stackoverflow.com/questions/68912464/perspective-view-matrix-for-y-down-coordinate-system
      this.#M.perspective.multiply4x4(this.mirrorM, this.#M.perspective);

      this.#dirty.perspective = false;
    }
    return this.#M.perspective;
  }

  get perspectiveParameters() {
    // Copy so they cannot be modified here.
    return { ...this.#perspectiveParameters };
  }

  set perspectiveParameters(params = {}) {
    for ( const [key, value] of Object.entries(params) ) {
      this.#perspectiveParameters[key] = value;
    }
    this.#dirty.perspective ||= true;
  }

  #orthogonalParameters = {
    left: 100,
    right: 100,
    top: 100,
    bottom: 100,
    near: 1,
    far: 1000,
  };

  get orthogonalParameters() {
    // Copy so they cannot be modified here.
    return { ...this.#orthogonalParameters };
  }

  set orthogonalParameters(params = {}) {
    for ( const [key, value] of Object.entries(params) ) {
      this.#orthogonalParameters[key] = value;
    }
    this.#dirty.perspective ||= true;
  }

  /** @type {Float32Array|mat4} */
  get lookAtMatrix() {
    if ( this.#dirty.lookAt ) {
      CONFIG.GeometryLib.MatrixFloat32.lookAt(this.cameraPosition, this.targetPosition, this.UP, this.#cameraM, this.#M.lookAt);
      this.#dirty.lookAt = false;
    }
    return this.#M.lookAt;
  }

  /** @type {ArrayBuffer} */
  get arrayBuffer() {
    // Ensure no updates required.
    this.refresh();
    return this.#arrayBuffer;
  }

  refresh() {
    return {
      perspectiveMatrix: this.perspectiveMatrix,
      lookAtMatrix: this.lookAtMatrix,
    };
  }

  /** @type {Float32Array(3)|vec3} */
  #positions = {
    camera: new CONFIG.GeometryLib.threeD.Point3d(),
    target: new CONFIG.GeometryLib.threeD.Point3d()
  };

  get cameraPosition() { return this.#positions.camera; }

  get targetPosition() { return this.#positions.target; }

  set cameraPosition(value) {
    this.#positions.camera.copyPartial(value);
    this.#dirty.lookAt ||= true;
  }

  set targetPosition(value) {
    this.#positions.target.copyPartial(value);
    this.#dirty.lookAt ||= true;
  }
}