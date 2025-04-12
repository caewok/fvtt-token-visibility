/* globals
CONFIG,
foundry,
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

export class RenderObstaclesAbstractWebGL2 {
  /** @type {targetClass} */
  static targetClass = DrawableTokenWebGL2;

  /** @type {class} */
  static obstacleClasses = [];

  /** @type {class} */
  static terrainClasses = [];

  static sceneFloorClass = null;

  /** @type {WebGL2RenderingContext} */
  gl;

  /** @type {DrawObjectsAbstract} */
  drawableTarget;

  /** @type {DrawObjectsAbstract[]} */
  drawableObstacles = []

  /** @type {DrawableObjectsAbstract[]} */
  drawableTerrain = [];

  /** @type {DrawableObjectsAbstract[]} */
  drawableFloor;

  /** @type {Camera} */
  camera = new Camera({ glType: "webGL2", perspectiveType: "perspective" });

  /** @type {object} */
  debugViewNormals = false;

  constructor({ gl, senseType = "sight", debugViewNormals = false } = {}) {
    this.debugViewNormals = debugViewNormals;
    this.senseType = senseType;
    this.gl = gl;

    // Construct the various drawable instances.
    const clOpts = { senseType, debugViewNormals };
    this.drawableTarget = new this.constructor.targetClass(gl, this.camera, clOpts);
    for ( const cl of this.constructor.obstacleClasses ) {
      const drawableObj = new cl(gl, this.camera, clOpts);
      this.drawableObstacles.push(drawableObj);
    }
    this.drawableObstacles.push(this.drawableTarget);
    for ( const cl of this.constructor.terrainClasses ) {
      const drawableObj = new cl(gl, this.camera, clOpts);
      this.drawableTerrain.push(drawableObj);
    }
    if ( this.constructor.sceneFloorClass ) {
      this.drawableFloor = this.constructor.sceneFloorClass(gl, this.camera, clOpts);
    }
  }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize() {
    const promises = [];
    for ( const drawableObstacle of this.drawableObstacles ) {
      promises.push(drawableObstacle.initialize());
    }
    for ( const drawableTerrain of this.drawableTerrain ) {
      promises.push(drawableTerrain.initialize());
    }
    if ( this.drawableFloor ) promises.push(this.drawableFloor.initialize());
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

    const renderFn = this.debugViewNormals ? this._renderDebug : this._renderColorCoded;
    renderFn.call(this, target, viewer, visionTriangle);
  }

  /**
   * Render the scene using select color channels to encode vision information.
   * Target is rendered red first and nothing else touches the red channel.
   * Obstacles are rendered into the blue channel.
   * Terrain is rendered into the green channel at 50%, such that 2+ terrain === full green.
   */
  _renderColorCoded(target, viewer, visionTriangle) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // gl.cullFace(gl.FRONT);

    gl.colorMask(true, false, false, true); // Red, alpha channels for the target object.
    this.drawableTarget.renderTarget(target);

    gl.colorMask(false, false, true, true); // Blue, alpha channels for obstacles.
    this.drawableObstacles.forEach(drawableObj => drawableObj.render(target, viewer, visionTriangle));

    // Draw terrain walls.
    // Blend so that 2+ walls exceed a value in the green channel
    // Preserve R and B for the destination.
    gl.colorMask(false, true, false, true); // Green, alpha channels for terrains.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    // Blend by adding the r, g, and b channels, Alpha basically ignored.
    const srcRGB = gl.ONE;
    const dstRGB = gl.ONE;
    const srcAlpha = gl.ZERO;
    const dstAlpha = gl.ONE;
    gl.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);

    this.drawableTerrain.forEach(drawableObj => drawableObj.render(target, viewer, visionTriangle));

    // Reset
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
  }

  /**
   * Render the scene in a manner that makes sense for a human viewer.
   */
  _renderDebug(target, viewer, visionTriangle) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // gl.cullFace(gl.FRONT);

    // Draw the scene floor to orient the viewer.
    if ( this.drawableFloor ) this.drawableFloor.render();

    this.drawableTarget.renderTarget(target);
    this.drawableObstacles.forEach(drawableObj => drawableObj.render(target, viewer, visionTriangle));

    // Draw terrain walls.
    // Blend so that 2+ walls exceed a value in the green channel
    // Preserve R and B for the destination.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    // Blend the terrain walls.
    const srcRGB = gl.SRC_ALPHA;
    const dstRGB = gl.SRC_ALPHA;
    const srcAlpha = gl.ONE_MINUS_SRC_ALPHA;
    const dstAlpha = gl.ONE_MINUS_SRC_ALPHA;
    gl.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);

    this.drawableTerrain.forEach(drawableObj => drawableObj.render(target, viewer, visionTriangle));

    // Reset
     gl.disable(gl.BLEND);
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
      zFar: Infinity, // camera.perspectiveParameters.zFar + 50
    };
    camera.refresh();
  }
}

export class RenderWallObstaclesWebGL2 extends RenderObstaclesAbstractWebGL2 {
  /** @type {class} */
  static obstacleClasses = [
    DrawableNonDirectionalWallWebGL2,
    DrawableDirectionalWallWebGL2,
  ];

  /** @type {class} */
  static terrainClasses = [
    DrawableNonDirectionalTerrainWallWebGL2,
    DrawableDirectionalTerrainWallWebGL2,
  ];
}

export class RenderTileObstaclesWebGL2 extends RenderObstaclesAbstractWebGL2 {
  /** @type {class} */
  static obstacleClasses = [
    DrawableTileWebGL2,
  ];
}


export class RenderObstaclesWebGL2 extends RenderObstaclesAbstractWebGL2 {
  /** @type {class} */
  static obstacleClasses = [
    DrawableNonDirectionalWallWebGL2,
    DrawableDirectionalWallWebGL2,
    DrawableTileWebGL2,
  ];

  /** @type {class} */
  static terrainClasses = [
    DrawableNonDirectionalTerrainWallWebGL2,
    DrawableDirectionalTerrainWallWebGL2,
  ];
}

export class RenderObstaclesWithBackgroundWebGL2 extends RenderObstaclesWebGL2 {
  static sceneFloorClass = DrawableSceneBackground;
}