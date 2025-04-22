/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { Camera } from "../WebGPU/Camera.js";
import { combineTypedArrays } from "../util.js";
import { VisionTriangle } from "../VisionPolygon.js";
import { DrawableWallInstancesPIXI } from "./DrawableObjectsPIXI.js";

class RenderObstaclesAbstractPIXI {
  /** @type {class} */
  static drawableClasses = [];

  /** @type {DrawObjectsAbstract[]} */
  drawableObjects = []

  /** @type {Camera} */
  camera = new Camera();

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize(opts) {
    this.drawableObjects.forEach(drawableObject => drawableObject.destroy());
    this.drawableObjects.length = 0;
    await this._initializeDrawObjects(opts);
    this.prerender();
  }

  /**
   * Define one ore more DrawObjects used to render the scene.
   */
  async _initializeDrawObjects(opts) {
    const senseType = this.senseType;
    const promises = [];
    for ( const cl of this.constructor.drawableClasses ) {
      const drawableObj = new cl(this.camera, { senseType });
      this.drawableObjects.push(drawableObj);
      await drawableObj.initialize(opts);
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

  render(viewerLocation, target, { viewer, targetLocation, targetOnly = false, obstaclesOnly = false } = {}) {
    const opts = { viewer, target, targetOnly };
    this._setCamera(viewerLocation, target, { viewer, targetLocation });
    // const visionTriangle = targetOnly ? null : VisionTriangle.build(viewerLocation, target);

//     const drawableObjects = targetOnly
//       ? this.drawableObjects.filter(drawableObject =>
//         drawableObject instanceof DrawableConstrainedTokens || drawableObject instanceof DrawableTokenInstances)
//       : this.drawableObjects;
    // drawableObjects.forEach(drawable => drawable._filterObjects(visionTriangle, opts));

    for ( const drawableObj of this.drawableObjects ) {
      drawableObj.initializeRender(opts);
      drawableObj.render(this.obstacleContainer);
    }

    const renderer = canvas.app.renderer;
    renderer.render(this.obstacleContainer, { renderTexture: this.renderTexture, clear: true });
    // renderer.render(obstacleContainer, { renderTexture, clear: false });

    // Clean up.
    this.drawableObjects.forEach(drawableObj => drawableObj._postRender(opts));
  }

  /**
   * Set camera for a given render.
   */
  _setCamera(viewerLocation, target, { targetLocation } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustrum(target);
  }

  /** @type {PIXI.Container} */
  #obstacleContainer;

  get obstacleContainer() {
    if ( !this.#obstacleContainer
      || this.#obstacleContainer.destroyed ) this.#obstacleContainer = new PIXI.Container();
    return this.#obstacleContainer;
  }

  /** @type {PIXI.Container} */
  #debugObstacleContainer;

  get debugObstacleContainer() {
    if ( !this.#debugObstacleContainer
      || this.#debugObstacleContainer.destroyed ) this.#debugObstacleContainer = new PIXI.Container();
    return this.#debugObstacleContainer;
  }

  /** @type {PIXI.RenderTexture} */
  #renderTexture;

  get renderTexture() {
    if ( !this.#renderTexture || this.#renderTexture.destroyed ) {
      const cfg = this._renderTextureConfiguration();
      this.#renderTexture = PIXI.RenderTexture.create(cfg);
      this.#renderTexture.framebuffer.enableDepth();
    }
    return this.#renderTexture;
  }

  /** @type {PIXI.RenderTexture} */
  #debugRenderTexture;

  get debugRenderTexture() {
    if ( !this.#debugRenderTexture || this.#debugRenderTexture.destroyed ) {
      const cfg = this._renderTextureConfiguration();
      cfg.width = 400;
      cfg.height = 400;
      this.#debugRenderTexture = PIXI.RenderTexture.create(cfg);
      this.#debugRenderTexture.framebuffer.enableDepth();
    }
    return this.#debugRenderTexture;
  }

  _renderTextureConfiguration() {
    const { renderTextureResolution, renderTextureSize } = CONFIG[MODULE_ID];
    return {
      resolution: renderTextureResolution,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
      width: renderTextureSize,
      height: renderTextureSize
    };
  }

  destroy() {
    if ( this.#obstacleContainer ) this.#obstacleContainer.destroy();
    if ( this.#debugObstacleContainer ) this.#debugObstacleContainer.destroy();
    if ( this.#renderTexture ) this.#renderTexture.destroy();
    if ( this.#debugRenderTexture ) this.#debugRenderTexture.destroy();
    this.#obstacleContainer = undefined;
    this.#renderTexture = undefined;
    this.#debugObstacleContainer = undefined;
    this.#debugRenderTexture = undefined;
  }
}

export class RenderWallsPIXI extends RenderObstaclesAbstractPIXI {
  static drawableClasses = [DrawableWallInstancesPIXI];
}

// export class RenderTilesPIXI extends RenderObstaclesAbstractPIXI {
//   static drawableClasses = [DrawableTileInstances];
// }
//
// export class RenderTokensPIXI extends RenderObstaclesAbstractPIXI {
//   static drawableClasses = [DrawableTokenInstances, DrawableConstrainedTokens];
// }
//
// export class RenderObstaclesPIXI extends RenderObstaclesAbstractPIXI {
//   static drawableClasses = [
//     DrawableWallInstances,
//     DrawableTileInstances,
//     DrawableTokenInstances,
//     DrawableConstrainedTokens,
//   ];
// }
