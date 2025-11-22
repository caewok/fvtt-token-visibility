/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../geometry/3d/Point3d.js";
import { Quad3d } from "../geometry/3d/Polygon3d.js";
import { MatrixFloat32 } from "../geometry/MatrixFlat.js";

import { MODULE_ID, TRACKER_IDS } from "../const.js";

export class Camera {

  static UP = new Point3d(0, 0, 1); // Cannot use Point3d in static defs.

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
    perspective: new MatrixFloat32(new Float32Array(this.#arrayBuffer, 0, 16), 4, 4),
    lookAt: new MatrixFloat32(new Float32Array(this.#arrayBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16), 4, 4),
  };

  /** @type {Float32Array(32)} */
  #arrayView = new Float32Array(this.#arrayBuffer, 0, 32);

  /** @type {MatrixFloat32<4,4>} */
  #cameraM = MatrixFloat32.empty(4, 4);

  /** @type {MatrixFloat32<4,4>} */
  #mirrorM = MatrixFloat32.identity(4, 4);

  /** @type {boolean} */
  #dirtyPerspective = true;

  #dirtyLookAt = true;

  #dirtyModel = true;

  #dirtyInverse = true;

  get dirtyPerspective() { return this.#dirtyPerspective }

  set dirtyPerspective(value) {
    this.#dirtyPerspective ||= value;
    this.#dirtyModel ||= value;
    this.#dirtyInverse ||= value;
  }

  get dirtyLookAt() { return this.#dirtyLookAt; }

  set dirtyLookAt(value) {
    this.#dirtyLookAt ||= value;
    this.#dirtyModel ||= value;
    this.#dirtyInverse ||= value;
  }

  get dirtyModel() { return this.#dirtyModel; }

  set dirtyModel(value) {
    this.#dirtyModel ||= value;
    this.#dirtyInverse ||= value;
  }

  get dirtyInverse() { return this.#dirtyInverse; }

  set dirtyInverse(value) { this.#dirtyInverse ||= value; }


  /** @type {function} */
  #perspectiveFn = MatrixFloat32.perspectiveZO;

  #UP = new Point3d();

  #perspectiveType = "perspective";

  #glType = "webGPU";

  get glType() { return this.#glType; }

  get perspectiveType() { return this.#perspectiveType; }

  set perspectiveType(value) {
    if ( value !== "perspective"
      && value !== "orthogonal" ) console.error(`${this.constructor.name}|Perspective type ${value} not recognized.`);
    this.#perspectiveType = value;

    // Update the relevant internal parameters.
    const fnName = `${this.#perspectiveType}${this.#glType === "webGPU" ? "ZO" : ""}`;
    this.#perspectiveFn = MatrixFloat32[fnName];
    this.#internalParams = value === "orthogonal" ? this.#orthogonalParameters : this.#perspectiveParameters;
    this.dirtyPerspective = true;
  }

  #modelMatrix = MatrixFloat32.identity(4);

  #inverseModelMatrix = MatrixFloat32.identity(4);

  get modelMatrix() {
    if ( this.dirtyModel ) {
      // See https://stackoverflow.com/questions/68912464/perspective-view-matrix-for-y-down-coordinate-system
      this.lookAtMatrix.multiply4x4(this.perspectiveMatrix, this.#modelMatrix);
      this.#dirtyModel = false;
    }
    return this.#modelMatrix;
  }

  get inverseModelMatrix() {
    if ( this.dirtyInverse ) {
      this.modelMatrix.invert(this.#inverseModelMatrix);
      this.#dirtyInverse = false;
    }
    return this.#inverseModelMatrix;
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
    this.#mirrorM.setIndex(0, 0, mirrorMDiag.x);
    this.#mirrorM.setIndex(1, 1, mirrorMDiag.y);
    this.#mirrorM.setIndex(2, 2, mirrorMDiag.z);

    this.#glType = glType;
    this.perspectiveType = perspectiveType;
  }

  setTargetTokenFrustum(targetToken) {
    const geometry = targetToken[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE];
    const aabb3d = geometry.aabb;
    this.setFrustumForAABB3d(aabb3d);
  }

  /**
   * Set the field of view and zFar for a given axis-aligned bounding box, ensuring it is viewable and
   * takes up the entire frame. The target location for the camera will be set to the bounding box center;
   * Use _setPerspectiveFrustumForAABB3d or _setOrthogonalFrustumForAABB3d to override.
   * @param {AABB3d} aabb3d       The bounding box; will be cloned to ensure a finite bounding box
   * @returns {object} The frustum parameters for convenience; also set internally.
   */
  setFrustumForAABB3d(aabb3d) {
    aabb3d = aabb3d.toFinite();
    const boxCenter = aabb3d.getCenter();
    this.targetPosition = boxCenter;
    const out = this.perspectiveType === "perspective"
      ? this._setPerspectiveFrustumForAABB3d(aabb3d, boxCenter) : this._setOrthogonalFrustumForAABB3d(aabb3d);
    boxCenter.release();
    aabb3d.release();
    return out;
  }

  /**
   * Set the parameters for the perspective frustum given an axis-aligned bounding box,
   * such that the box is fully contained with in the view and takes up the view completely.
   * @param {AABB3d} aabb3d           Bounding box; must use finite coordinates
   * @param {Point3d} [boxCenter]     Box center; typically the targetLocation should be set to this
   * @returns {object} Parameters, for convenience; also set internally.
   */
  _setPerspectiveFrustumForAABB3d(aabb3d, boxCenter) {

    // Calculate the radius of a sphere that encloses the bounding box.
    // This is the distance from the center to one of the corners (e.g., the max corner).
    const boxRadius = Point3d.distanceBetween(aabb3d.max, boxCenter);
    const cameraDist = Point3d.distanceBetween(this.cameraPosition, boxCenter);

    // Distance from the viewpoint to the farthest point on the bounding sphere.
    // Ignore zNear, which would be Math.max(0.01, cameraDist - boxRadius) if only concerned with rendering the box.
    const zFar = cameraDist + boxRadius;

    // Calculate the Field of View (FOV).
    // Use trigonometry: the sine of half the FOV angle is the ratio of the
    // sphere's radius to the distance from the camera to the sphere's center.
    // sin(fov/2) = rad ius / distance
    // fov = 2 * asin(radius / distan
    // If the camera is inside the bounding sphere, the FOV would need to be 180 degrees
    // to see the whole sphere. Handle as a special case.
    const fov = cameraDist <= boxRadius ? Math.PI
      : 2 * Math.asin(boxRadius / cameraDist); // Radians

    this.perspectiveParameters = { fov, zFar };
    return this.perspectiveParameters;
  }

  /**
   * Set the parameters for the orthogonal frustum given an axis-aligned bounding box,
   * such that the box is fully contained with in the view and takes up the view completely.
   * @param {AABB3d} aabb3d     Bounding box; must use finite coordinates
   * @returns {object} Parameters, for convenience; also set internally.
   */
  _setOrthogonalFrustumForAABB3d(aabb3d) {
    // Project the box corners onto the camera's local axes.
    // Determine the minimum and maximum for each coordinate in the camera view.
    const lookAtM = this.lookAtMatrix;
    const iter = aabb3d.iterateVertices();
    const p0 = lookAtM.multiplyPoint3d(iter.next().value);
    let xMinMax = Math.minMax(p0.x);
    let yMinMax = Math.minMax(p0.y);
    let zMinMax = Math.minMax(p0.z);
    p0.release();
    for ( const pt of iter ) {
      const txPt = lookAtM.multiplyPoint3d(pt);
      xMinMax = Math.minMax(xMinMax.min, xMinMax.max, txPt.x);
      yMinMax = Math.minMax(yMinMax.min, yMinMax.max, txPt.y);
      zMinMax = Math.minMax(zMinMax.min, zMinMax.max, txPt.z);
      txPt.release();
      pt.release();
    }

    // The min/max projected values define the clipping planes.
    // The values are negated for the near/far planes because they represent
    // distances along the negative view direction in some conventions (like OpenGL).
    // However, for constructing a projection matrix, we typically need the distances
    // along the forward vector, so we keep them as they are.
    this.orthogonalParameters = {
      left: xMinMax.min,
      right: xMinMax.max,
      top: yMinMax.max,
      bottom: yMinMax.min,
      far: zMinMax.max,
      // Near would be zMinMax.min but we also want obstacles in view, so it should be left to something small, like 1.
    };
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

  get UP() { return this.#UP; }

  set UP(value) {
    this.#UP.copyFrom(value);
    this.dirtyLookAt = true;
  }

  get mirrorMatrix() { return this.#mirrorM; }

  set mirrorM(value) {
    this.#mirrorM.setIndex(0, 0, value.x);
    this.#mirrorM.setIndex(1, 1, value.y);
    this.#mirrorM.setIndex(2, 2, value.z);
    this.dirtyPerspective = true
  };

  /** @type {MatrixFloat32<4x4>} */
  get perspectiveMatrix() {
    if ( this.dirtyPerspective ) {
      // mat4.perspective or perspectiveZO?
      // const { fov, aspect, zNear, zFar } = this.#perspectiveParameters;
      // MatrixFloat32.perspectiveZO(fov, aspect, zNear, zFar, this.#M.perspective);
      this.#perspectiveFn(...Object.values(this.#internalParams), this.#M.perspective);
      this.#M.perspective.multiply4x4(this.mirrorMatrix, this.#M.perspective);
      this.#dirtyPerspective = false;
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
    this.dirtyPerspective = true;
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
    this.dirtyPerspective = true;
  }

  /** @type {Float32Array|mat4} */
  get lookAtMatrix() {
    if ( this.dirtyLookAt ) {
      MatrixFloat32.lookAt(this.cameraPosition, this.targetPosition, this.UP, this.#cameraM, this.#M.lookAt);
      this.#dirtyLookAt = false;
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
    camera: new Point3d(),
    target: new Point3d()
  };

  get cameraPosition() { return this.#positions.camera; }

  get targetPosition() { return this.#positions.target; }

  set cameraPosition(value) {
    if ( this.#positions.camera.equals(value) ) return;
    this.#positions.camera.copyPartial(value);
    this.dirtyLookAt = true;
  }

  set targetPosition(value) {
    if ( this.#positions.target.equals(value) ) return;
    this.#positions.target.copyPartial(value);
    this.dirtyLookAt = true;
  }

  // ----- NOTE: Debug ----- //

  invertFrustum() {
    const M = this.lookAtMatrix.multiply4x4(this.perspectiveMatrix);
    const Minv = M.invert();
    const minCoord = this.glType === "webGPU" ? 0 : -1;

    const front = [
      Point3d.tmp.set(1, minCoord, 0),
      Point3d.tmp.set(minCoord, minCoord, 0),
      Point3d.tmp.set(minCoord, 1, 0),
      Point3d.tmp.set(1, 1, 0)
    ];
    const back = [
      Point3d.tmp.set(1, minCoord, -1),
      Point3d.tmp.set(minCoord, minCoord, -1),
      Point3d.tmp.set(minCoord, 1, -1),
      Point3d.tmp.set(1, 1, -1)
    ];

    // back TL, TR, front TR, TL
    const top = [back[0], back[1], front[1], front[0]];

    // front BR, BL, back BL, BR
    const bottom = [front[2], front[3], back[3], back[2]];

    // If this were used for something other than debug, would be more efficient to
    // invert the vertices and share them among the quads.

    const out = {
      front: Quad3d.from4Points(...front.map(pt => Minv.multiplyPoint3d(pt))),
      back: Quad3d.from4Points(...back.map(pt => Minv.multiplyPoint3d(pt))),
      top: Quad3d.from4Points(...top.map(pt => Minv.multiplyPoint3d(pt))),
      bottom: Quad3d.from4Points(...bottom.map(pt => Minv.multiplyPoint3d(pt))),
    };
    front.forEach(pt => pt.release());
    back.forEach(pt => pt.release());
    return out;
  }

  drawCanvasFrustum2d(opts) {
    const sides = this.invertFrustum();
    Object.values(sides).forEach(side => side.draw2d(opts));
  }
}
