/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Camera } from "../WebGPU/Camera.js";
import { VisionTriangle } from "../VisionTriangle.js";
import { Settings } from "../../settings.js";
import {
  DrawableNonDirectionalWallWebGL2,
  DrawableDirectionalWallWebGL2,
  DrawableNonDirectionalTerrainWallWebGL2,
  DrawableDirectionalTerrainWallWebGL2,
  DrawableTileWebGL2,
  DrawableTokenWebGL2,
  UnconstrainedDrawableTokenWebGL2,
  ConstrainedDrawableTokenWebGL2,
  DrawableSceneBackgroundWebGL2,
  ConstrainedDrawableHexTokenWebGL2,
} from "./DrawableObjectsWebGL2.js";

export class RenderObstaclesAbstractWebGL2 {

  /** @type {class} */
  static drawableClasses = [];

  /** @type {WebGL2RenderingContext} */
  gl;

  /** @type {DrawObjectsAbstract[]} */
  drawableObjects = [];

  /** @type {DrawObjectsAbstract} */
  drawableTargets = [];

  /** @type {DrawObjectsAbstract[]} */
  drawableObstacles = []

  /** @type {DrawableObjectsAbstract[]} */
  drawableTerrain = [];

  /** @type {DrawableObjectsAbstract[]} */
  drawableFloor;

  /** @type {VisionTriangle} */
  visionTriangle = new VisionTriangle();

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
    for ( const cl of this.constructor.drawableClasses ) {
      if ( cl === ConstrainedDrawableHexTokenWebGL2 && !canvas.grid.isHexagonal ) continue;
      if ( canvas.grid.isHexagonal
        && (cl === ConstrainedDrawableTokenWebGL2
         || cl === UnconstrainedDrawableTokenWebGL2) ) continue;

      const drawableObj = new cl(gl, this.camera, clOpts);
      this.drawableObjects.push(drawableObj);
      switch ( cl ) {
        case DrawableTokenWebGL2:
        case UnconstrainedDrawableTokenWebGL2:
        case ConstrainedDrawableHexTokenWebGL2:
        case ConstrainedDrawableTokenWebGL2: this.drawableTargets.push(drawableObj); this.drawableObstacles.push(drawableObj); break;
        case DrawableSceneBackgroundWebGL2: this.drawableFloor = drawableObj; break;
        case DrawableNonDirectionalTerrainWallWebGL2:
        case DrawableDirectionalTerrainWallWebGL2: this.drawableTerrain.push(drawableObj); break;
        default: this.drawableObstacles.push(drawableObj);
      }
    }
  }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize() {
    const promises = [];
    this.drawableObjects.forEach(drawableObj => promises.push(drawableObj.initialize()));
    return Promise.allSettled(promises);
  }

  /** @type {ViewerLOSConfig} */
  _config = {
    blocking: {
      walls: true,
      tiles: true,
      tokens: {
        dead: true,
        live: true,
        prone: true,
      }
    },
    debug: false,
    useLitTargetShape: false,
    largeTarget: false,
  }

  get config() { return this._config; }

  set config(cfg = {}) {
    foundry.utils.mergeObject(this._config, cfg);
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {
    for ( const drawableObj of this.drawableObjects ) drawableObj.prerender();
  }

  render(viewerLocation, target, { viewer, targetLocation } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    const opts = { viewer, target, blocking: this.config.blocking };
    this._setCamera(viewerLocation, target, { targetLocation });
    const visionTriangle = this.visionTriangle.rebuild(viewerLocation, target);
    this.drawableObjects.forEach(drawable => drawable.filterObjects(visionTriangle, opts));
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
    gl.viewport(0, 0, gl.canvas.clientWidth || gl.canvas.width, gl.canvas.clientHeight || gl.canvas.height)
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // gl.cullFace(gl.FRONT);

    gl.colorMask(true, false, false, true); // Red, alpha channels for the target object.
    this.drawableTargets.forEach(drawableTarget => drawableTarget.renderTarget(target));

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
    gl.viewport(0, 0, gl.canvas.clientWidth || gl.canvas.width, gl.canvas.clientHeight || gl.canvas.height)
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // gl.cullFace(gl.FRONT);

    // Draw the scene floor to orient the viewer.
    if ( this.drawableFloor ) this.drawableFloor.render();

    this.drawableTargets.forEach(drawableTarget => drawableTarget.renderTarget(target));
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

  destroy() {

  }
}


export class RenderWallObstaclesWebGL2 extends RenderObstaclesAbstractWebGL2 {
  /** @type {class} */
  static drawableClasses = [
    DrawableNonDirectionalWallWebGL2,
    DrawableDirectionalWallWebGL2,
    DrawableNonDirectionalTerrainWallWebGL2,
    DrawableDirectionalTerrainWallWebGL2,
    DrawableTokenWebGL2,
  ];
}

export class RenderTileObstaclesWebGL2 extends RenderObstaclesAbstractWebGL2 {
  /** @type {class} */
  static drawableClasses = [
    DrawableTileWebGL2,
    DrawableTokenWebGL2,
  ];
}


export class RenderObstaclesWebGL2 extends RenderObstaclesAbstractWebGL2 {
  /** @type {class} */
  static drawableClasses = [
    DrawableNonDirectionalWallWebGL2,
    DrawableDirectionalWallWebGL2,
    DrawableTileWebGL2,
    DrawableNonDirectionalTerrainWallWebGL2,
    DrawableDirectionalTerrainWallWebGL2,
    UnconstrainedDrawableTokenWebGL2,
    ConstrainedDrawableTokenWebGL2,
    ConstrainedDrawableHexTokenWebGL2,
  ];
}

export class RenderObstaclesWithBackgroundWebGL2 extends RenderObstaclesWebGL2 {
  static drawableClasses = [
    DrawableNonDirectionalWallWebGL2,
    DrawableDirectionalWallWebGL2,
    DrawableTileWebGL2,
    DrawableNonDirectionalTerrainWallWebGL2,
    DrawableDirectionalTerrainWallWebGL2,
    DrawableSceneBackgroundWebGL2,
    UnconstrainedDrawableTokenWebGL2,
    ConstrainedDrawableTokenWebGL2,
    ConstrainedDrawableHexTokenWebGL2,
  ];
}