/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { vec3, mat4 } from "../gl_matrix/index.js";

const tmpMat = mat4.create();
const tmpVec3 = vec3.create();

export class Camera {

  static UP = vec3.fromValues(0, 1, 0);

  static CAMERA_BUFFER_SIZE = Float32Array.BYTES_PER_ELEMENT * 56; // Total of projection + view + frustum.

  // TODO: Combine so that the buffer stores the camera values instead of repeating them.
  // Could use MatrixFlat to store the buffer views.
  // Need to update MatrixFlat to handle the WebGPU perspectiveZO.

  /** @type {ArrayBuffer} */
  #cameraArrayBuffer = new ArrayBuffer(this.constructor.CAMERA_BUFFER_SIZE);

  /** @type {Float32Array(16)|mat4} */
  #perspectiveMatrix = new Float32Array(this.#cameraArrayBuffer, 0, 16);

  /** @type {Float32Array(16)|mat4} */
  #viewMatrix = new Float32Array(this.#cameraArrayBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16);

  /** @type {boolean} */
  #dirtyFrustum = true;

  /** @type {boolean} */
  #dirtyView = true;

  /** @type {boolean} */
  #dirtyPerspective = true;

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
    fov: Math.toRadians(60),
    aspect: 1,
    zNear: 1, // Or 0.1?
    zFar: 100,
  }

  /** @type {MatrixFlat<4x4>} */
  get perspectiveMatrix() {
    if ( this.#dirtyPerspective ) {
      mat4.perspectiveZO(this.#perspectiveMatrix, ...Object.values(this.#perspectiveParameters));
      // this.#projectionBuffer.set()

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

  /** @type {Float32Array|mat4} */
  get viewMatrix() {
    if ( this.#dirtyView ) {
      mat4.lookAt(this.#viewMatrix, this.#cameraPosition, this.#targetPosition, this.constructor.UP);
      this.#dirtyView = false;
    }
    return this.#viewMatrix;
  }

  /** @type {ArrayBuffer} */
  get cameraArrayBuffer() {
    // Ensure no updates required.
    const tmp0 = this.viewMatrix;         /* eslint-disable-line no-unused-vars */
    const tmp1 = this.perspectiveMatrix;  /* eslint-disable-line no-unused-vars */
    const tmp2 = this.frustum;           /* eslint-disable-line no-unused-vars */
    return this.#cameraArrayBuffer;
  }

  /** @type {Float32Array(3)|vec3} */
  #cameraPosition = vec3.create();

  /** @type {Float32Array(3)|vec3} */
  #targetPosition = vec3.create();

  get cameraPosition() { return this.#cameraPosition; }

  get targetPosition() { return this.#targetPosition; }

  set cameraPosition(value) {
    if ( !(value instanceof Float32Array) ) value = [value.x, value.y, value.z];
    this.#dirtyView ||= true;
    this.#dirtyFrustum ||= true;
    this.#cameraPosition.set(value);
  }

  set targetPosition(value) {
    if ( !(value instanceof Float32Array) ) value = [value.x, value.y, value.z];
    this.#dirtyView ||= true;
    this.#dirtyFrustum ||= true;
    this.#targetPosition.set(value);
  }

  /** @type {object<Float32Array(4)|vec4>} */
  #frustum = {
    left: new Float32Array(this.#cameraArrayBuffer, 32 * Float32Array.BYTES_PER_ELEMENT, 4),
    right: new Float32Array(this.#cameraArrayBuffer, 36 * Float32Array.BYTES_PER_ELEMENT, 4),
    top: new Float32Array(this.#cameraArrayBuffer, 40 * Float32Array.BYTES_PER_ELEMENT, 4),
    bottom: new Float32Array(this.#cameraArrayBuffer, 44 * Float32Array.BYTES_PER_ELEMENT, 4),
    near: new Float32Array(this.#cameraArrayBuffer, 48 * Float32Array.BYTES_PER_ELEMENT, 4),
    far: new Float32Array(this.#cameraArrayBuffer, 52 * Float32Array.BYTES_PER_ELEMENT, 4),
  };

  get frustum() {
    if ( this.#dirtyFrustum ) {
      mat4.mul(tmpMat, this.perspectiveMatrix, this.viewMatrix);
      let invLVec = vec3.create();
      let invL;

      // Left clipping plane
      vec3.set(tmpVec3, tmpMat[3] + tmpMat[0], tmpMat[7] + tmpMat[4], tmpMat[11] + tmpMat[8]);
      invL = 1 / vec3.length(tmpVec3);
      invLVec = vec3.fromValues(invL, invL, invL);
      this.#frustum.left.set(vec3.multiply(tmpVec3, tmpVec3, invLVec));
      this.#frustum.left.set([(tmpMat[15] + tmpMat[12]) * invL], 3)

      // Right clipping plane
      vec3.set(tmpVec3, tmpMat[3] - tmpMat[0], tmpMat[7] - tmpMat[4], tmpMat[11] - tmpMat[8]);
      invL = 1 / vec3.length(tmpVec3);
      invLVec = vec3.fromValues(invL, invL, invL);
      this.#frustum.right.set(vec3.multiply(tmpVec3, tmpVec3, invLVec));
      this.#frustum.right.set([(tmpMat[15] - tmpMat[12]) * invL], 3)

       // Top clipping plane
      vec3.set(tmpVec3, tmpMat[3] - tmpMat[1], tmpMat[7] - tmpMat[5], tmpMat[11] - tmpMat[9]);
      invL = 1 / vec3.length(tmpVec3);
      invLVec = vec3.fromValues(invL, invL, invL);
      this.#frustum.top.set(vec3.multiply(tmpVec3, tmpVec3, invLVec));
      this.#frustum.top.set([(tmpMat[15] - tmpMat[13]) * invL], 3)

      // Bottom clipping plane
      vec3.set(tmpVec3, tmpMat[3] + tmpMat[1], tmpMat[7] + tmpMat[5], tmpMat[11] + tmpMat[9]);
      invL = 1 / vec3.length(tmpVec3);
      invLVec = vec3.fromValues(invL, invL, invL);
      this.#frustum.bottom.set(vec3.multiply(tmpVec3, tmpVec3, invLVec));
      this.#frustum.bottom.set([(tmpMat[15] + tmpMat[13]) * invL], 3)

      // Near clipping plane
      vec3.set(tmpVec3, tmpMat[2], tmpMat[6], tmpMat[10]);
      invL = 1 / vec3.length(tmpVec3);
      invLVec = vec3.fromValues(invL, invL, invL);
      this.#frustum.near.set(vec3.multiply(tmpVec3, tmpVec3, invLVec));
      this.#frustum.left.set([tmpMat[14] * invL], 3)

      // Far clipping plane
      vec3.set(tmpVec3, tmpMat[3] - tmpMat[2], tmpMat[7] - tmpMat[6], tmpMat[11] - tmpMat[10]);
      invL = 1 / vec3.length(tmpVec3);
      invLVec = vec3.fromValues(invL, invL, invL);
      this.#frustum.far.set(vec3.multiply(tmpVec3, tmpVec3, invLVec));
      this.#frustum.far.set([(tmpMat[15] - tmpMat[14]) * invL], 3)

      this.#dirtyFrustum = false;
    }
    return this.#frustum;
  }

}