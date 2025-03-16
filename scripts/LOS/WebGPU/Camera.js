/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { vec3, mat4 } from "../gl_matrix/index.js";

export class Camera {

  static UP = vec3.fromValues(0, 0, 1);

  /**
   * @typedef {object} CameraStruct
   * @param {mat4x4f} perspectiveM          The perspective matrix
   * @param {mat4x4f} lookAtM               Matrix to shift world around a camera location
   * @param {mat4x4f} offsetM               Offset required to switch from Foundry coordinates
   */

  static CAMERA_BUFFER_SIZE = Float32Array.BYTES_PER_ELEMENT * 16 * 16 * 16; // Total size of CameraStruct

  // TODO: Combine so that the buffer stores the camera values instead of repeating them.
  // Could use MatrixFlat to store the buffer views.
  // Need to update MatrixFlat to handle the WebGPU perspectiveZO.

  /** @type {ArrayBuffer} */
  #arrayBuffer = new ArrayBuffer(this.constructor.CAMERA_BUFFER_SIZE);

  /** @type {Float32Array(16)|mat4} */
  #M = {
    perspective: new Float32Array(this.#arrayBuffer, 0, 16),
    lookAt: new Float32Array(this.#arrayBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16),
    offset: new Float32Array(this.#arrayBuffer, 32 * Float32Array.BYTES_PER_ELEMENT, 16),
  };

  /** @type {boolean} */
  #dirty = {
    perspective: true,
    lookAt: true,
    offset: true,
  };

  constructor({ cameraPosition, targetPosition } = {}) {
    if ( cameraPosition ) this.cameraPosition = cameraPosition;
    if ( targetPosition ) this.targetPosition = targetPosition;
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
    b.set(...this.cameraPosition);
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
    fov: Math.toRadians(90),
    aspect: 1,
    zNear: 1,
    zFar: null,
  }

  /** @type {MatrixFlat<4x4>} */
  get perspectiveMatrix() {
    if ( this.#dirty.perspective ) {
      // mat4.perspective or perspectiveZO?
      mat4.perspectiveZO(this.#M.perspective, ...Object.values(this.#perspectiveParameters));
      this.#dirty.perspective = false;
    }
    return this.#M.perspective;
  }

  get perspectiveParameters() {
    // Copy so they cannot be modified here.
    return { ...this.#perspectiveParameters };
  }

  set perspectiveParameters(params = {}) {
    this.#dirty.perspective ||= true;
    for ( const [key, value] of Object.entries(params) ) {
      this.#perspectiveParameters[key] = value;
    }
  }

  /** @type {Float32Array|mat4} */
  get lookAtMatrix() {
    if ( this.#dirty.lookAt ) {
      mat4.lookAt(this.#M.lookAt, this.cameraPosition, this.targetPosition, this.constructor.UP);
      this.#dirty.lookAt = false;
    }
    return this.#M.lookAt;
  }

  /** @type {Float32Array|mat4} */
  get offsetMatrix() {
    if ( this.#dirty.offset ) {
      mat4.fromScaling(this.#M.offset, [-1, 1, 1]);
      // mat4.fromScaling(this.#M.offset, [1, 1, 1]);
      this.#dirty.offset = false;
    }
    return this.#M.offset;
  }

  /** @type {ArrayBuffer} */
  get arrayBuffer() {
    // Ensure no updates required.
    const tmp0 = this.perspectiveMatrix;      /* eslint-disable-line no-unused-vars */
    const tmp1 = this.lookAtMatrix;           /* eslint-disable-line no-unused-vars */
    const tmp2 = this.offsetMatrix;           /* eslint-disable-line no-unused-vars */
    return this.#arrayBuffer;
  }

  /** @type {Float32Array(3)|vec3} */
  #positions = {
    camera: vec3.create(),
    target: vec3.create(),
  };

  get cameraPosition() { return this.#positions.camera; }

  get targetPosition() { return this.#positions.target; }

  set cameraPosition(value) {
    if ( !(value instanceof Float32Array) ) value = [value.x, value.y, value.z];
    this.#dirty.lookAt ||= true;
    this.#positions.camera.set(value);
  }

  set targetPosition(value) {
    if ( !(value instanceof Float32Array) ) value = [value.x, value.y, value.z];
    this.#dirty.lookAt ||= true;
    this.#positions.target.set(value);
  }
}