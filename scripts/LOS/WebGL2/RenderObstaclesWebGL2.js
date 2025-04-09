/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Camera } from "../WebGPU/Camera.js";
import { VisionTriangle } from "../VisionPolygon.js";
import {
  DrawableNonDirectionalWallWebGL2,
  DrawableDirectionalWallWebGL2,
  DrawableNonDirectionalTerrainWallWebGL2,
  DrawableDirectionalTerrainWallWebGL2,
  DrawableTileWebGL2,
  DrawableTokenWebGL2,
  DrawableSceneBackground,
} from "./DrawableObjectsWebGL2.js";

export class RenderAbstractWebGL2 {
  /** @type {class} */
  static drawableClasses = [];

  /** @type {class} */
  static terrainDrawableClasses = [];

  /** @type {WebGL2RenderingContext} */
  gl;

  /** @type {DrawObjectsAbstract[]} */
  drawableObjects = []

  /** @type {DrawableObjectsAbstract[]} */
  drawableTerrain = [];

  /** @type {Camera} */
  camera = new Camera({ glType: "webGL2", perspectiveType: "perspective" });

  debugViewNormals = false;

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize({ gl, senseType = "sight", debugViewNormals = false } = {}) {
    this.senseType = senseType;
    this.gl = gl;
    this.debugViewNormals = debugViewNormals;

    const promises = [];
    for ( const cl of this.constructor.drawableClasses ) {
      const drawableObj = new cl(gl, this.camera, { senseType });
      this.drawableObjects.push(drawableObj);
      await drawableObj.initialize({ debugViewNormals });
      // promises.push(drawableObj.initialize({ debugViewNormals }));
    }

    for ( const cl of this.constructor.terrainDrawableClasses ) {
      const drawableObj = new cl(gl, this.camera, { senseType });
      this.drawableTerrain.push(drawableObj);
      await drawableObj.initialize({ debugViewNormals });
      // promises.push(drawableObj.initialize({ debugViewNormals }));
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
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    this.drawableObjects.forEach(drawableObj => drawableObj.render(target, viewer, visionTriangle));

    // Draw terrain walls.
    // Blend so that 2+ walls exceed a value in the green channel
    // Preserve R and B for the destination.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    // Blend by adding the r, g, and b channels, Alpha basically ignored.
    const srcRGB = gl.ONE;
    const dstRGB = gl.ONE;
    const srcAlpha = gl.ZERO;
    const dstAlpha = gl.ONE;
    gl.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);

    this.drawableTerrain.forEach(drawableObj => drawableObj.render(target, viewer, visionTriangle));

    // For terrain color, could use either [0, .5, 0, alpha] or [0, 0, 0.5, alpha]



    // color(RGB) = (sourceColor * srcRGB) + (destinationColor * dstRGB)
    // color(A) = (sourceAlpha * srcAlpha) + (destinationAlpha * dstAlpha)

    // srcRGB: gl.ONE
    // dstRGB: gl.ONE

    // B/c we only care about terrain that already is over a target red area, we can ignore source alpha
    // srcAlpha: gl.ZERO
    // dstAlpha: gl.ONE
//     src, dst
//     r: 0 * 1 + 1 * 1 = 1
//     g: .5 * 1 + 0 * 1 = .5
//     b: 0 * 1 + 1 * 1 = 1
//     a: .5 * 0 + 1 * 1 = 1
//
//     // two terrains
//     dst: 1, .5, 0, 1
//     src: 0, .5, 0, .5?
//     r: 0 * 1 + 1 * 1 = 1
//     g: .5 * 1 + .5 * 1 = 1
//     b: 0 * 1 + 0 * 1 = 0
//     a: .5 * 0 + 1 * 1 = 1
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
  static drawableClasses = [DrawableNonDirectionalWallWebGL2];
}

export class RenderTilesWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableTileWebGL2];
}

export class RenderTokensWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableTokenWebGL2];
}

export class RenderTerrainWallsWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableTokenWebGL2];

  static terrainDrawableClasses = [DrawableNonDirectionalTerrainWallWebGL2]
}


export class RenderSceneBackgroundWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableSceneBackground];
}

export class RenderObstaclesWebGL2 extends RenderAbstractWebGL2 {
  static drawableClasses = [DrawableTokenWebGL2, DrawableNonDirectionalWallWebGL2, DrawableDirectionalWallWebGL2, DrawableTileWebGL2];
}