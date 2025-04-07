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
} from "./PlaceableInstanceHandlerWebGL2.js";
import {
  DrawableNonDirectionalWallWebGL2,
  DrawableDirectionalWallWebGL2,
  DrawableTileWebGL2,
  DrawableTokenWebGL2,
} from "./DrawableObjectsWebGL2.js";

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

    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.drawableObjects.forEach(drawableObj => drawableObj.render(target, viewer, visionTriangle));
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
    camera.refresh();
  }
}

export class RenderWallsWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableNonDirectionalWallWebGL2, DrawableDirectionalWallWebGL2];
}

export class RenderTilesWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableTileWebGL2];
}

export class RenderTokensWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableTokenWebGL2];
}

export class RenderObstaclesWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableNonDirectionalWallWebGL2, DrawableDirectionalWallWebGL2, DrawableTileWebGL2, DrawableTokenWebGL2];
}