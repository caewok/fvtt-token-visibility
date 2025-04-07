/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Camera } from "../WebGPU/Camera.js";
import { VisionTriangle } from "../VisionPolygon.js";
import {
  NonDirectionalWallInstanceHandlerWebGL2,
  DirectionalWallInstanceHandlerWebGL2,
  TileInstanceHandlerWebGL2,
  TokenInstanceHandlerWebGL2,
} from "../WebGPU/PlaceableInstanceHandler.js";
import { DrawableNonDirectionalWallWebGL2 } from "./DrawableObjectsWebGL2.js";

class RenderAbstractWebGL2 {
  /** @type {class} */
  static drawableClasses = [];

  /** @type {WebGL2RenderingContext} */
  gl;

  /** @type {DrawObjectsAbstract[]} */
  drawableObjects = []

  /** @type {Camera} */
  camera = new Camera();

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize({ gl, senseType = "sight" } = {}) {
    this.senseType = senseType;
    this.gl = gl;

    const promises = [];
    for ( const cl of this.constructor.drawableClasses ) {
      const drawableObj = new cl(gl, this.camera, { senseType });
      this.drawableObjects.push(drawableObj);
      await drawableObj.initialize();
      // promises.push(drawableObj.initialize());
    }
    return Promise.allSettled(promises);
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {
    for ( const drawableObj of this.drawableObjects ) drawableObj.prerender();
  }

  render(viewerLocation, target, { viewer, targetLocation, targetOnly = false } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    // const opts = { viewer, target, targetOnly };
    this._setCamera(viewerLocation, target, { targetLocation });
    const visionTriangle = targetOnly ? null : VisionTriangle.build(viewerLocation, target);
    this.drawableObjects.forEach(drawableObj => drawableObj.render(viewerLocation, targetLocation, target, visionTriangle));
  }

  /**
   * Set camera for a given render.
   */
  _setCamera(viewerLocation, target, { targetLocation } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    const camera = this.camera;
    camera.cameraPosition = viewerLocation;
    camera.targetPosition = targetLocation;
    camera.setTargetTokenFrustrum(target);
    camera.perspectiveParameters = {
      fov: camera.perspectiveParameters.fov * 2,
      zFar: camera.perspectiveParameters.zFar + 50
    };
  }
}

export class RenderWallsWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableNonDirectionalWallWebGL2];
}