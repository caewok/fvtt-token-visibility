/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { Camera } from "../WebGPU/Camera.js";
import { VisionTriangle } from "../VisionTriangle.js";
import {
  DrawableNonDirectionalWallWebGL2,
  DrawableDirectionalWallWebGL2,
  DrawableNonDirectionalTerrainWallWebGL2,
  DrawableDirectionalTerrainWallWebGL2,
  DrawableTileWebGL2,
  DrawableTokenWebGL2,
  ConstrainedDrawableTokenWebGL2,
  DrawableSceneBackgroundWebGL2,
  ConstrainedDrawableHexTokenWebGL2,
  DrawableGridShape,
  DrawableNonDirectionalWallInstance,
  DrawableDirectionalWallInstance,
  DrawableNonDirectionalTerrainWallInstance,
  DrawableDirectionalTerrainWallInstance,
  DrawableTokenInstance,
  LitDrawableTokenWebGL2,
  LitDrawableHexTokenWebGL2,
} from "./DrawableObjectsWebGL2.js";

import { FragmentCounter } from "./FragmentCounter.js";

export class RenderObstaclesWebGL2 {

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

  /** @type {DrawableTokenWebGL2} */
  drawableUnconstrainedToken;

  /** @type {DrawableTokenWebGL2} */
  drawableConstrainedToken;

  /** @type {DrawableTokenWebGL2} */
  drawableLitToken;

  /** @type {DrawableObjectsAbstract} */
  drawableFloor;

  /** @type {DrawableObjectsAbstract} */
  drawableGridShape;

  /** @type {VisionTriangle} */
  visionTriangle = new VisionTriangle();

  /** @type {Camera} */
  camera = new Camera({ glType: "webGL2", perspectiveType: "perspective" });

  /** @type {object} */
  debugViewNormals = false;

  /** @type {FragmentCounter} */
  counter;

  constructor({ gl, senseType = "sight", debugViewNormals = false, useInstancing = false, useSceneBackground = false } = {}) {
    this.debugViewNormals = debugViewNormals;
    this.senseType = senseType;
    this.gl = gl;
    this._buildDrawableObjects(useInstancing, useSceneBackground);
  }

  _buildDrawableObjects(useInstancing = false, useSceneBackground = false) {
    this.drawableObjects.length = 0;
    this.drawableFloor = undefined;

    // Construct the various drawable instances.
    const drawableClasses = [
      DrawableTileWebGL2,
      ConstrainedDrawableTokenWebGL2,
      ConstrainedDrawableHexTokenWebGL2,
      DrawableGridShape,
      LitDrawableTokenWebGL2,
      LitDrawableHexTokenWebGL2,
    ];
    if ( canvas.grid.isHexagonal  ) drawableClasses.push(
      ConstrainedDrawableHexTokenWebGL2,
      LitDrawableHexTokenWebGL2,
    );
    else drawableClasses.push(
      ConstrainedDrawableTokenWebGL2,
      LitDrawableTokenWebGL2,
    );

    if ( useInstancing ) {
      drawableClasses.push(
        DrawableTokenInstance,
        DrawableNonDirectionalWallInstance,
        DrawableDirectionalWallInstance,
        DrawableNonDirectionalTerrainWallInstance,
        DrawableDirectionalTerrainWallInstance,
      )
    } else {
      drawableClasses.push(
        DrawableTokenWebGL2,
        DrawableNonDirectionalWallWebGL2,
        DrawableDirectionalWallWebGL2,
        DrawableNonDirectionalTerrainWallWebGL2,
        DrawableDirectionalTerrainWallWebGL2,
      );
    }
    if ( useSceneBackground ) drawableClasses.push(DrawableSceneBackgroundWebGL2);

    const clOpts = { senseType: this.senseType, debugViewNormals: this.debugViewNormals };
    for ( const cl of drawableClasses) {
      const drawableObj = new cl(this.gl, this.camera, clOpts);
      this.drawableObjects.push(drawableObj);

      switch ( cl ) {
        // Lit tokens not used as obstacles; only targets.
        case LitDrawableTokenWebGL2:
        case LitDrawableHexTokenWebGL2:
          this.drawableLitToken = drawableObj; break;

        // Constrained tokens used as obstacles but handled separately.
        case ConstrainedDrawableTokenWebGL2:
        case ConstrainedDrawableHexTokenWebGL2:
          this.drawableConstrainedToken = drawableObj; break;

        case DrawableTokenWebGL2:
        case DrawableTokenInstance:
          this.drawableUnconstrainedToken = drawableObj;
          this.drawableObstacles.push(drawableObj);
          break;

        // Scene background not an obstacle; handled separately.
        case DrawableSceneBackgroundWebGL2:
          this.drawableFloor = drawableObj;
          break;

        // Grid shape not an obstacle; handled separately.
        case DrawableGridShape:
          this.drawableGridShape = drawableObj;
          break;

        // Terrain walls have special rendering considerations.
        case DrawableNonDirectionalTerrainWallWebGL2:
        case DrawableNonDirectionalTerrainWallInstance:
        case DrawableDirectionalTerrainWallInstance:
        case DrawableDirectionalTerrainWallWebGL2:
          this.drawableTerrain.push(drawableObj);
          break;

        default:
          this.drawableObstacles.push(drawableObj);
      }
    }
  }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize() {
    const promises = [];
    this.drawableObjects.forEach(drawableObj => promises.push(drawableObj.initialize()));
    this.counter = new FragmentCounter(this.gl);
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

    if ( this.config.useLitTargetShape ) this.drawableLitToken.prerender();
    this.drawableConstrainedToken.prerender();
  }

  /**
   * If using the query config option, this object stores the gl.createQuery objects
   * - targetUnblocked: The target in _renderColorCoded.
   * - targetBlocked: The target after obstacles are applied in _renderColorCoded
   * - gridShape: The grid shape in renderGridShape
   * - targetShape: The target shape in renderTarget
    @type {object}
  */
  queries = {
    targetUnblocked: null,
    targetBlocked: null,
    targetShape: null,
    gridShape: null,
  };

  renderGridShape(viewerLocation, target, { targetLocation, frame } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this._setCamera(viewerLocation, target, { targetLocation });
    frame ??= new PIXI.Rectangle(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    const useQuery = CONFIG[MODULE_ID].useQuery;

    const gl = this.gl;
    // gl.viewport(0, 0, gl.canvas.clientWidth || gl.canvas.width, gl.canvas.clientHeight || gl.canvas.height)
    gl.viewport(frame.x, frame.y, frame.width, frame.height);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // gl.cullFace(gl.FRONT);

    gl.colorMask(true, false, false, true); // Red, alpha channels for the target object.

    if ( useQuery ) this.counter.begin();
    this.drawableGridShape.renderTarget(target);
    if ( useQuery ) this.queries.gridShape = this.counter.end();

    // Reset
//     gl.colorMask(true, true, true, true);
//     gl.disable(gl.BLEND);
    this.gl.flush();
  }

  /**
   * Renders a specific target alone, without any obstacles. Similar to renderGridShape.
   * @param {Token} token
   * @param {boolean} [useLitTargetShape=false]
   */
  renderTarget(viewerLocation, target, { targetLocation, frame, useLitTargetShape = false } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    this._setCamera(viewerLocation, target, { targetLocation });
    frame ??= new PIXI.Rectangle(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    const useQuery = CONFIG[MODULE_ID].useQuery;

    const gl = this.gl;
    // gl.viewport(0, 0, gl.canvas.clientWidth || gl.canvas.width, gl.canvas.clientHeight || gl.canvas.height)
    gl.viewport(frame.x, frame.y, frame.width, frame.height);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // gl.cullFace(gl.FRONT);

    gl.colorMask(true, false, false, true); // Red, alpha channels for the target object.

    if ( useQuery ) this.counter.begin();
    this._drawTarget(target, useLitTargetShape);
    if ( useQuery ) this.queries.targetShape = this.counter.end();

    // Reset
//     gl.colorMask(true, true, true, true);
//     gl.disable(gl.BLEND);
    this.gl.flush();
  }

  _drawTarget(target, useLitTargetShape = false) {
    // Draw the target using one of the drawable object options.
    // Prefer the unconstrained token when possible.
    // If token border is a rectangle, can use unconstrained.
    // If the target lit token border is undefined, use a different border to avoid throwing error.
    // Percent visible should have tested and rejected this possibility already.
    const border = (useLitTargetShape ? target.litTokenBorder : undefined)
      ?? target.constrainedTokenBorder ?? target.tokenBorder;

    if ( border.equals(target.tokenBorder) ) this.drawableUnconstrainedToken.renderTarget(target);
    else if ( useLitTargetShape ) this.drawableLitToken.renderTarget(target);
    else this.drawableConstrainedToken.renderTarget(target);
  }

  render(viewerLocation, target, { viewer, targetLocation, frame, clear = true, useLitTargetShape = false } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    const opts = { viewer, target, blocking: this.config.blocking };
    this._setCamera(viewerLocation, target, { targetLocation });
    const visionTriangle = this.visionTriangle.rebuild(viewerLocation, target);
    this.drawableObstacles.forEach(drawable => drawable.filterObjects(visionTriangle, opts));
    this.drawableConstrainedToken.filterObjects(visionTriangle, opts);
    const renderFn = this.debugViewNormals ? this._renderDebug : this._renderColorCoded;

    // See https://webgl2fundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html
    // Ignore dpr.
    frame ??= new PIXI.Rectangle(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    renderFn.call(this, target, viewer, visionTriangle, frame, clear, useLitTargetShape);
    this.gl.flush();
  }

  /**
   * Render the scene using select color channels to encode vision information.
   * Target is rendered red first and nothing else touches the red channel.
   * Obstacles are rendered into the blue channel.
   * Terrain is rendered into the green channel at 50%, such that 2+ terrain === full green.
   */
  _renderColorCoded(target, viewer, visionTriangle, frame, clear = true, useLitTargetShape = false) {
    const gl = this.gl;
    // gl.viewport(0, 0, gl.canvas.clientWidth || gl.canvas.width, gl.canvas.clientHeight || gl.canvas.height)

    const useStencil = CONFIG[MODULE_ID].useStencil;
    const useQuery = CONFIG[MODULE_ID].useQuery;

    gl.viewport(frame.x, frame.y, frame.width, frame.height);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    if ( clear ) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // gl.cullFace(gl.FRONT);

    // Use the stencil buffer to identify target pixels.
    if ( useStencil ) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.stencilFunc(gl.ALWAYS, 1, 0xFF); // All fragments should pass stencil test.
      gl.stencilMask(0xFF); // Enable writing to the stencil buffer.
    }

    // TODO: Does color masking screw up the queries?
    gl.colorMask(true, false, false, true); // Red, alpha channels for the target object.

    if ( useQuery ) this.counter.begin();
    this._drawTarget(target, useLitTargetShape);
    if ( useQuery ) {
      this.queries.targetUnblocked = this.counter.end();

      // Clear the target b/c we need to draw it *after* the obstacles in order to query occlusion.
      // TODO: This will fail if multiple viewpoints due to clearing. How better to handle?
      if ( !clear ) console.warn(`${this.constructor.name}|_renderColorCoded must clear when using queries`);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // Do not clear the stencil!
    }

    // Performance: Use the stencil buffer to discard pixels outside the target shape.
    if ( useStencil ) {
      gl.stencilFunc(gl.EQUAL, 1, 0xFF); // Draw only where the target shape is present.
      gl.stencilMask(0x00); // Disable writing to the stencil buffer.
    }
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

    if ( useQuery ) {
      // Redraw the target. Should only pass depth test where it is in front of obstacles.
      // Use query to determine which pixels pass.
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.colorMask(true, false, false, true); // Red, alpha channels for the target object.
      this.counter.begin();
      this._drawTarget(target, useLitTargetShape);
      this.queries.targetBlocked = this.counter.end();
    }

    // Reset
    if ( useStencil ) {
//       gl.stencilMask(0x00); // Disable writing to stencil buffer.
//       gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.disable(gl.STENCIL_TEST);
    }
//     gl.colorMask(true, true, true, true);
//     gl.disable(gl.BLEND);
  }

  /**
   * Render the scene in a manner that makes sense for a human viewer.
   */
  _renderDebug(target, viewer, visionTriangle, frame, clear = true, useLitTargetShape = false) {
    const gl = this.gl;
    // gl.viewport(0, 0, gl.canvas.clientWidth || gl.canvas.width, gl.canvas.clientHeight || gl.canvas.height)
    gl.viewport(frame.x, frame.y, frame.width, frame.height)
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    if ( clear ) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // gl.cullFace(gl.FRONT);

    // Draw the scene floor to orient the viewer.
    if ( this.drawableFloor ) this.drawableFloor.render();

    this._drawTarget(target, useLitTargetShape);
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
//     gl.disable(gl.BLEND);
  }

  /**
   * Set camera for a given render.
   */
  _setCamera(viewerLocation, target, { targetLocation } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    const camera = this.camera;
    camera.cameraPosition = viewerLocation;
    // camera.targetPosition = targetLocation; // Set by setTargetTokenFrustum.

    /*
    camera.perspectiveParameters = {
      fov: Math.toRadians(90),
      aspect: 1,
      zNear: 1,
      zFar: Infinity,
    };
    */


    camera.setTargetTokenFrustum(target);

    /*
    camera.perspectiveParameters = {
      fov: camera.perspectiveParameters.fov * 2,
      zFar: Infinity, // camera.perspectiveParameters.zFar + 50
    };
    */

    camera.refresh();
  }

  destroy() {
    // const gl = this.gl;
    this.counter.destroy();


    // TODO: Implement storing framebuffer and writing to texture instead of canvas.
    // gl.deleteFramebuffer(this.fbo);
    // gl.deleteTexture(this.texture);
    // this.drawableObjects.forEach(drawable => drawable.destroy()); // gl.deleteProgram
  }
}
