/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../geometry/3d/Point3d.js";
import { MODULE_ID } from "../const.js";
import { AbstractPolygonTrianglesID } from "./placeable_tracking/PlaceableGeometryTracker.js";

const pt3d_0 = new Point3d();

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
    model: true,
    inverse: true,
  };

  /** @type {function} */
  #perspectiveFn = CONFIG.GeometryLib.MatrixFloat32.perspectiveZO;

  UP = new Point3d();

  #perspectiveType = "perspective";

  #glType = "webGPU";

  get glType() { return this.#glType; }

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
    this.#dirty.perspective ||= true;
    this.#dirty.model ||= true;
    this.#dirty.inverse ||= true;
  }

  #modelMatrix = CONFIG.GeometryLib.MatrixFloat32.identity(4);

  #inverseModelMatrix = CONFIG.GeometryLib.MatrixFloat32.identity(4);

  get modelMatrix() {
    if ( this.#dirty.model ) {
      this.lookAtMatrix.multiply4x4(this.perspectiveMatrix, this.#modelMatrix);
      this.#dirty.model = false;
    }
    return this.#modelMatrix;
  }

  get inverseModelMatrix() {
    if ( this.#dirty.inverse ) {
      this.modelMatrix.invert(this.#inverseModelMatrix);
      this.#dirty.inverse = false;
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
    this.mirrorM.setIndex(0, 0, mirrorMDiag.x);
    this.mirrorM.setIndex(1, 1, mirrorMDiag.y);
    this.mirrorM.setIndex(2, 2, mirrorMDiag.z);

    this.#glType = glType;
    this.perspectiveType = perspectiveType;
  }

  setTargetTokenFrustum(targetToken) {
    const geometry = targetToken[MODULE_ID][AbstractPolygonTrianglesID];
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
    const boxCenter = aabb3d.getCenter(pt3d_0);
    this.targetLocation = boxCenter;
    return this.perspectiveType === "perspective"
      ? this._setPerspectiveFrustumForAABB3d(aabb3d, boxCenter) : this._setOrthogonalFrustumForAABB3d(aabb3d);
  }

  /**
   * Set the parameters for the perspective frustum given an axis-aligned bounding box,
   * such that the box is fully contained with in the view and takes up the view completely.
   * @param {AABB3d} aabb3d           Bounding box; must use finite coordinates
   * @param {Point3d} [boxCenter]     Box center; typically the targetLocation should be set to this
   * @returns {object} Parameters, for convenience; also set internally.
   */
  _setPerspectiveFrustumForAABB3d(aabb3d, boxCenter) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    boxCenter ??= aabb3d.getCenter(pt3d_0);

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
    for ( const pt of iter ) {
      const txPt = lookAtM.multiplyPoint3d(pt);
      xMinMax = Math.minMax(xMinMax.min, xMinMax.max, txPt.x);
      yMinMax = Math.minMax(yMinMax.min, yMinMax.max, txPt.y);
      zMinMax = Math.minMax(zMinMax.min, zMinMax.max, txPt.z);
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
    this.#dirty.model ||= true;
    this.#dirty.inverse ||= true;
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
    this.#dirty.model ||= true;
    this.#dirty.inverse ||= true;
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

  // ----- NOTE: Debug ----- //

  invertFrustum() {
    const M = this.lookAtMatrix.multiply4x4(this.perspectiveMatrix);
    const Minv = M.invert();
    const minCoord = this.glType === "webGPU" ? 0 : -1;

    const Quad3d = CONFIG.GeometryLib.threeD.Quad3d;
    const front = [new Point3d(1, minCoord, 0),  new Point3d(minCoord, minCoord, 0), new Point3d(minCoord, 1, 0), new Point3d(1, 1, 0)];
    const back = [new Point3d(1, minCoord, -1),  new Point3d(minCoord, minCoord, -1), new Point3d(minCoord, 1, -1), new Point3d(1, 1, -1)];

    // back TL, TR, front TR, TL
    const top = [back[0], back[1], front[1], front[0]];

    // front BR, BL, back BL, BR
    const bottom = [front[2], front[3], back[3], back[2]];

    // If this were used for something other than debug, would be more efficient to
    // invert the vertices and share them among the quads.

    return {
      front: Quad3d.from4Points(...front.map(pt => Minv.multiplyPoint3d(pt))),
      back: Quad3d.from4Points(...back.map(pt => Minv.multiplyPoint3d(pt))),
      top: Quad3d.from4Points(...top.map(pt => Minv.multiplyPoint3d(pt))),
      bottom: Quad3d.from4Points(...bottom.map(pt => Minv.multiplyPoint3d(pt))),
    };
  }

  drawCanvasFrustum2d(opts) {
    const sides = this.invertFrustum();
    Object.values(sides).forEach(side => side.draw2d(opts));
  }
}
