/* globals
canvas,
CONFIG,
PIXI,
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

  /** @type {Float32Array(32)} */
  #arrayView = new Float32Array(this.#arrayBuffer, 0, 32);

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

  UP = new Point3d();

  #perspectiveType = "perspective";

  #glType = "webGPU";

  get perspectiveType() { return this.#perspectiveType; }

  set perspectiveType(value) {
    if ( value !== "perspective"
      && value !== "orthogonal" ) console.error(`${this.constructor.name}|Perspective type ${value} not recognized.`);
    if ( this.#perspectiveType === value ) return;
    this.#perspectiveType = value;

    // Update the relevant internal parameters.
    const fnName = `${this.#perspectiveType}${this.#glType === "webGPU" ? "ZO" : ""}`;
    this.#perspectiveFn = CONFIG.GeometryLib.MatrixFloat32[fnName];
    this.#internalParams = value === "orthogonal" ? this.#orthogonalParameters : this.#perspectiveParameters;
    this.#dirty.perspective = true;
  }

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

    this.#glType = glType;
    this.perspectiveType = perspectiveType;
  }

  /**
   * Set the field of view and zFar for a target token, to maximize the space the token
   * takes up in the frame.
   * @param {Token} targetToken
   */
  setTargetTokenFrustum(targetToken) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const ctr = Point3d.fromTokenCenter(targetToken);
    this.targetPosition = ctr;

    // Assume axis-aligned cube.
    const targetWidth = targetToken.document.width * canvas.dimensions.size;
    const targetHeight = targetToken.document.height * canvas.dimensions.size;
    const targetZHeight = targetToken.topZ - targetToken.bottomZ;
    const halfSize = Math.max(targetWidth, targetHeight, targetZHeight) * 0.5; // From cube center to furthest face.
    // const diagSize = Math.sqrt(Math.pow(halfSize, 2) + Math.pow(halfSize, 2)); // From center to corner in 2d.
    // const diag3dSize = Math.sqrt(Math.pow(halfSize, 2) + Math.pow(diagSize, 2)); // From center to corner in 3d.

    /* Simplify
    diagSize = Math.sqrt(h**2 + h**2)
             = Math.sqrt(2 * (h**2))
             = Math.sqrt(2) * h
             = Math.SQRT2 * h
    diag3dSize = Math.sqrt(h**2 + Math.sqrt(h**2 + h**2)**2)
                = Math.sqrt(h**2 + h**2 + h**2)
                = Math.sqrt(3*(h**2))
                = Math.sqrt(3) * h
                = Math.SQRT3 * h
    */



    // Furthest corner of the cube from the camera.
    // Worst case is the camera is aligned along a cube diagonal, so must add on the full
    // diagonal distance to reach a back corner. In 3d, could be (rarely) the full 3d diagonal.
    // E.g., looking directly down at a corner so the camera viewline runs through two opposite corners.
    const distToTarget = Point3d.distanceBetween(this.cameraPosition, this.targetPosition)
    const diag3dSize = Math.SQRT3 * halfSize;
    const maxCornerDistance = distToTarget + diag3dSize;

    // zFar needs to be at least the distance to the farthest corner.
    // const zFar = Infinity;
    const zFar = maxCornerDistance;

    if ( this.perspectiveType === "perspective" ) {
      const maxAngle = maximumViewAngle(this.cameraPosition, targetToken);
      const fov = Math.min(maxAngle, 2.5) + 0.02; // Math.toDegrees(2.5) ~ 143º. Keep well under 180º.
      // console.debug(`Camera|${targetToken.name}`, { maxAngle, fov })

      // Calculate field-of-view.
      // Worst case: In 2d top-down, the cube diagonals form the furthest point.
      // tan(fov/2) = opposite/adjacent = (cube.size/2) / distance
      // const diagSize = Math.SQRT2 * halfSize;
      // const fov = 2 * Math.atan(diagSize / (distToTarget - diagSize)); // Measure from front of token to ensure sufficiently large viewing angle.
      this.perspectiveParameters = { fov, zFar };
      return;
    }

    // Calculate orthogonal parameters.
    // Take the bounding box of the target token.
    // Convert to camera space and set max.
    // See https://www.scratchapixel.com/lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/orthographic-projection-matrix.html
    const minWorld = new Point3d(
      targetToken.document.x,
      targetToken.document.y,
      targetToken.bottomZ,
    );
    minWorld.multiplyScalar(0.99, minWorld);
    const maxWorld = new Point3d(
      (targetToken.document.x + targetWidth),
      (targetToken.document.y + targetHeight),
      targetToken.topZ,
    );
    maxWorld.multiplyScalar(1.01, maxWorld);
    const minCamera = this.lookAtMatrix.multiplyPoint3d(minWorld);
    const maxCamera = this.lookAtMatrix.multiplyPoint3d(maxWorld);
    const max = Math.max(minCamera.x, minCamera.y, maxCamera.x, maxCamera.y)
    this.orthogonalParameters = {
      left: -max,
      right: max,
      top: max,
      bottom: -max,
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

  #internalParams = this.#perspectiveParameters;

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

  get arrayView() {
    this.refresh();
    return this.#arrayView;
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
    if ( this.#positions.camera.equals(value) ) return;
    this.#positions.camera.copyPartial(value);
    this.#dirty.lookAt ||= true;
  }

  set targetPosition(value) {
    if ( this.#positions.target.equals(value) ) return;
    this.#positions.target.copyPartial(value);
    this.#dirty.lookAt ||= true;
  }
}

/**
 * Determine the maximum angle from a viewpoint to a token border.
 * @param {Point3d} viewpoint
 * @param {Token} targetToken
 *
 * @returns {number} Angle in radians.
 */
function maximumViewAngle(viewpoint, targetToken) {
  const Point3d = CONFIG.GeometryLib.threeD.Point3d;
  const ctr = Point3d.fromTokenCenter(targetToken);

  // 2d x-y dimensions.
  const tokenBorder = targetToken.tokenBorder;
  const vps = tokenBorder.viewablePoints(viewpoint, { outermostOnly: true });
  if ( !vps ) return Math.PI;

  // Two angles, on either side of the center line.
  const b = viewpoint.to2d();
  const c = ctr.to2d()
  const angle0 = PIXI.Point.angleBetween(vps[0], b, c);
  const angle1 = PIXI.Point.angleBetween(vps[1], b, c);

  // Height.
  // Using cutaway.
  /*
  const cutawayPoly = CutawayPolygon.cutawayBasicShape(tokenBorder, b, c, {
    topElevationFn: () => targetToken.topZ,
     bottomElevationFn: () => targetToken.bottomZ
  })[0];
  const cutawayCameraPosition = cutawayPoly._to2d(viewpoint)
  const cutawayVPs = cutawayPoly.viewablePoints(cutawayCameraPosition, { outermostOnly: true })
  cutawayVPs[0].x = Math.sqrt(cutawayVPs[0].x);
  cutawayVPs[1].x = Math.sqrt(cutawayVPs[1].x);
  const cutawayC = cutawayPoly._to2d(ctr);
  cutawayC.x = Math.sqrt(cutawayC.x)
  const heightAngle0 = PIXI.Point.angleBetween(cutawayVPs[0], cutawayCameraPosition, cutawayC);
  const heightAngle1 = PIXI.Point.angleBetween(cutawayVPs[1], cutawayCameraPosition, cutawayC);
  */

  // Using border intersection and 3d angle.
  let ix = tokenBorder.segmentIntersections(viewpoint, ctr)[0]; // Only 1 b/c measuring from poly center.
  if ( !ix ) return Math.PI;

  const heightVPS = [new Point3d(ix.x, ix.y, targetToken.topZ), new Point3d(ix.x, ix.y, targetToken.bottomZ)];
  const heightAngle0 = Point3d.angleBetween(heightVPS[0], viewpoint, ctr);
  const heightAngle1 = Point3d.angleBetween(heightVPS[1], viewpoint, ctr);
  return Math.max(angle0, angle1, heightAngle0, heightAngle1) * 2;
}