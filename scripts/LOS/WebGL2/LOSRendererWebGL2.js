/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";

// LibGeometry
import { Point3d } from "../../geometry/3d/Point3d.js";
import { GEOMETRY_LIB_ID } from "../../geometry/const.js";

// WebGL2
import * as twgl from "./twgl.js";
import { WebGL2 } from "./WebGL2.js";

// TODO: Add regions.
import {
  DrawableWalls,

  DrawableSquareTokens,
  DrawableEllipseTokens,
  DrawableHexagonTokens,
  DrawableSphereTokens,
  DrawablePolygonTokens,

  DrawableSquareTarget,
  DrawableEllipseTarget,
  DrawableHexagonTarget,
  DrawableSphereTarget,
  DrawablePolygonTarget,

  DrawableTiles,

  // DrawableRegions,
} from "./InstancedDrawable.js";


export class LOSRendererWebGL2 {

  /** @type {WebGL2} */
  webGL2;

  /** @type {WebGL2RenderingContext} */
  get gl() { return this.webGL2.gl; }

  /** @type {PIXI.Rectangle} */
  frame = new PIXI.Rectangle();

  /** @type {Camera} */
  camera;

  /** @type {boolean} */
  normals = false;

  framebuffer;

  constructor({ camera, webGL2 } = {}) {
    this.camera = camera;
    this.webGL2 = webGL2;
  }

  drawables = {
    walls: null,
    tiles: null,
    regions: null,
    tokens: [],
    targets: [],
  }

  async initialize() {
    this._initializeCameraBuffer();
    this._initializeMaterialBuffer();
    this.resize();

    // Initialize handlers to draw different canvas placeables.
    // Keep each parameter object separate so they don't get mixed up between calls.

    for ( const cl of this.constructor._tokenDrawableClasses() ) {
      this.drawables.tokens.push(cl.create({ webGL2: this.webGL2 }));
    };
    for ( const cl of this.constructor._targetDrawableClasses() ) {
      this.drawables.targets.push(cl.create({ webGL2: this.webGL2 }));
    }

    this.drawables.walls = DrawableWalls.create({ webGL2: this.webGL2 });
    this.drawables.tiles = DrawableTiles.create({ webGL2: this.webGL2 });

    // this.drawables.regions = DrawableRegions.create({ this.webGL2 });

    // Initialize each drawable
    const promises = [];
    promises.push(this.drawables.walls.initialize());
    promises.push(this.drawables.tiles.initialize());
    // promises.push(this.drawables.regions.initialize());
    this.drawables.tokens.forEach(drawable => promises.push(drawable.initialize()));
    this.drawables.targets.forEach(drawable => promises.push(drawable.initialize()));

    await Promise.allSettled(promises);
  }

  static _tokenDrawableClasses() {
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere )  return [DrawableSphereTokens];
    const GRID = CONST.GRID_TYPES;
    switch ( canvas.grid.type ) {
      case GRID.SQUARE: return [DrawableSquareTokens];
      case GRID.GRIDLESS: return [DrawableSquareTokens, DrawableEllipseTokens];
      default: return [DrawableHexagonTokens, DrawablePolygonTokens];
    }
  }

  static _targetDrawableClasses() {
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere )  return [DrawableSphereTarget];
    const GRID = CONST.GRID_TYPES;
    switch ( canvas.grid.type ) {
      case GRID.SQUARE: return [DrawableSquareTarget];
      case GRID.GRIDLESS: return [DrawableSquareTarget, DrawableEllipseTarget];
      default: return [DrawableHexagonTarget, DrawablePolygonTarget];
    }
  }

  // ----- NOTE: Camera uniform buffer object ----- //

  static CAMERA_BIND_POINT = 0;

  /** @type {object<WebGLBuffer>} */
  buffer = {
    camera: null,
    material: null,
  };

  _initializeCameraBuffer() {
    const gl = this.gl;

    // Already have a shared buffer data from the camera object: camera.arrayBuffer.
    this.buffer.camera = gl.createBuffer();

    // Create and initialize it.
    // See https://learnopengl.com/Advanced-OpenGL/Advanced-GLSL
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.camera);
    gl.bufferData(gl.UNIFORM_BUFFER, this.camera.constructor.CAMERA_BUFFER_SIZE, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    // Bind the UBO to the binding point
    gl.bindBufferBase(gl.UNIFORM_BUFFER, this.constructor.CAMERA_BIND_POINT, this.buffer.camera);
  }

  /**
   * Set camera for a given render.
   */
  updateCameraBuffer() {
    this.camera.refresh(); // Ensure the camera buffer is up-to-date.
    const gl = this.gl;
    const cameraData = this.camera.arrayView;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.camera);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cameraData);
    gl.bindBufferRange(gl.UNIFORM_BUFFER, this.constructor.CAMERA_BIND_POINT, this.buffer.camera, 0, cameraData.BYTES_PER_ELEMENT * cameraData.length);
  }

  // ----- NOTE: Material uniform buffer object (for debug) ----- //

  static MATERIAL_BIND_POINT = 1;

  static MATERIAL_BUFFER = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4 * 3);

  static MATERIAL_COLORS = {
    target: new Float32Array(this.MATERIAL_BUFFER, 0, 4),
    obstacle: new Float32Array(this.MATERIAL_BUFFER, Float32Array.BYTES_PER_ELEMENT * 4, 4),
    terrain: new Float32Array(this.MATERIAL_BUFFER, Float32Array.BYTES_PER_ELEMENT * 4 * 2, 4),
  };

  // Run on class load
  static {
    this.MATERIAL_COLORS.target.set([1.0, 0.0, 0.0, 1.0]); // Red.
    this.MATERIAL_COLORS.obstacle.set([0.0, 0.0, 1.0, 1.0]); // Blue.
    this.MATERIAL_COLORS.terrain.set([0.0, 0.5, 0.0, 0.5]); // Green, transparent.
  }

  _initializeMaterialBuffer() {
    const gl = this.gl;

    // Buffer to hold every color variation.
    this.buffer.material = gl.createBuffer();

    // Create and initialize it.
    // See https://learnopengl.com/Advanced-OpenGL/Advanced-GLSL
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.material);
    gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array(this.constructor.MATERIAL_BUFFER), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    // Bind the UBO to the binding point
    gl.bindBufferBase(gl.UNIFORM_BUFFER, this.constructor.MATERIAL_BIND_POINT, this.buffer.material);
  }

  #currentMaterial = null;

  /**
   * Set material for a given render.
   * @param {string} type             Key from MATERIAL_COLORS
   */
  setMaterial(type = "obstacle") {
    if ( this.#currentMaterial === type ) return;

    let offset = 0;
    switch ( type ) {
      case "target": offset = 0; break;
      case "obstacle": offset = Float32Array.BYTES_PER_ELEMENT * 4; break;
      case "terrain": offset = Float32Array.BYTES_PER_ELEMENT * 4 * 2; break;
      default: console.error("setMaterial|Material type not recognized.");
    }
    // gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.material);
    this.gl.bindBufferRange(this.gl.UNIFORM_BUFFER, this.constructor.MATERIAL_BIND_POINT, this.buffer.material, offset, Float32Array.BYTES_PER_ELEMENT * 4);
    this.#currentMaterial = type;
  }

  // ----- NOTE: Framebuffer and render texture ----- //

  /** @type {twgl.FramebufferInfo} */
  fbInfo;

  get renderTexture() { return CONFIG[MODULE_ID].useRenderTexture ? this.fbInfo.attachments[0] : null; }

  resize(width, height) {
    width ||= CONFIG[MODULE_ID].renderTextureSize || 128;
    height ||= CONFIG[MODULE_ID].renderTextureSize || 128;
    this.frame.width = width;
    this.frame.height = height;
    this._initializeFramebuffer();
  }

  /**
   * Initialize all required framebuffers.
   */
  _initializeFramebuffer() {
    const gl = this.gl;
    const width = this.renderTextureSize;
    const height = width;
    this.frame.width = width;
    this.frame.height = height;

    this.fbInfo = twgl.createFramebufferInfo(gl, [
      {
        internalFormat: gl.RGBA,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
      },
      {
        format: gl.DEPTH_STENCIL
      }
    ], width, height);

    // Check if framebuffer is complete is done by twgl.createFramebufferInfo.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ----- NOTE: Render pipeline ----- //




  /**
   * Core rendering method.
   * Should first set the camera.
   */
  render(occlusionTester, targetGeom, { clear = true, debug = false, frame } = {}) {
    const gl = this.gl;
    const webGL2 = this.webGL2;
    frame ??= this.frame;

    // Set default WebGL2 state.
    webGL2.setViewport(frame);
    webGL2.setDepthTest(true);
    webGL2.setCulling(true);
    webGL2.setCullFace("BACK");
    webGL2.setDepthMask(true);
    webGL2.setColorMask(WebGL2.noColorMask);
    if ( clear ) { // Clear = false used for rendering debug multiple viewpoints.
      webGL2.setColorMask(WebGL2.noColorMask); // Force all channels true.
      webGL2.setClearColor(WebGL2.blackClearColor);  // Clear everything to black.
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    }

    // Pass 1: Render target.
    this._renderTarget(targetGeom, debug);

    // Pass 2: Render hard obstacles
    this._renderHardObstacles(occlusionTester, targetGeom, debug);

    // Pass 3: Render terrain (limited wall) obstacle.
    this._renderTerrainObstacles(occlusionTester, targetGeom, debug);
  }

  bindFramebuffer() {
    // Depending on CONFIG, use either a renderTexture or render to the canvas.
    const gl = this.gl;
    if ( CONFIG[MODULE_ID].useRenderTexture ) twgl.bindFramebufferInfo(gl, this.fbInfo);
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  unbindFramebuffer() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  _renderTarget(targetGeom, debug = false) {
    const webGL2 = this.webGL2;

    // Set WebGL2 state.
    if ( debug ) {
      webGL2.setColorMask(WebGL2.noColorMask);
      this.setMaterial("target");
    } else webGL2.setColorMask(WebGL2.redAlphaMask);
    webGL2.setBlending(false);

    // Add the target instance.
    for ( const drawable of this.drawables.targets ) {
      drawable.instanceSet.clear();
      drawable.addGeomToInstanceSet(targetGeom);
      drawable.render(debug);
    }
  }

  /**
   * Set the drawables to the hard obstacles in preparation for rendering.
   * Walls, tiles, regions, levels, tokens.
   * @param {ObstacleOcclusionTester} occlusionTester
   */
  #setAndRenderHardObstacles(occlusionTester, targetGeom, debug) {
    const geoms = occlusionTester.obstacleGeometries;

    // Add walls
    const hardWalls = [
      ...geoms.walls,
      ...geoms.proximateWalls,
      ...geoms.reverseProximateWalls
    ];
    this.drawables.walls.instanceSet.clear()
    this.#addWallInstances(hardWalls, targetGeom);
    this.drawables.walls.render(debug);

    // Add tokens
    // TODO: Handle constrained tokens.
    for ( const drawable of this.drawables.tokens ) {
       drawable.instanceSet.clear();
       for ( const geom of geoms.tokens ) drawable.addGeomToInstanceSet(geom);
       drawable.render(debug);
    }

    // Add tiles and levels
    this.drawables.tiles.instanceSet.clear();
    for ( const geom of geoms.tiles ) this.drawables.tiles.addGeomToInstanceSet(geom);
    for ( const geom of geoms.foregroundLevels ) this.drawables.tiles.addGeomToInstanceSet(geom);
    for ( const geom of geoms.backgroundLevels ) this.drawables.tiles.addGeomToInstanceSet(geom);
    this.drawables.tiles.render(debug);

    // TODO: Add regions.
  }

  #addWallInstances(wallGeoms, targetGeom) {
    const levelId = targetGeom ? targetGeom.placeableDocument.level : null;
    for ( const wallGeom of wallGeoms ) this.drawables.walls.addGeomToInstanceSet(wallGeom, levelId);
  }

  _renderHardObstacles(occlusionTester, targetGeom, debug = false) {
    const webGL2 = this.webGL2;

    // Set color mask to BLUE only.
    // Set WebGL2 state.
    if ( debug ) {
      this.setMaterial("obstacle");
      webGL2.setColorMask(WebGL2.noColorMask);
    } else webGL2.setColorMask(WebGL2.blueAlphaMask);
    webGL2.setBlending(false);
    this.#setAndRenderHardObstacles(occlusionTester, targetGeom, debug);
  }

  _renderTerrainObstacles(occlusionTester, targetGeom, debug = false) {
    const gl = this.gl;
    const webGL2 = this.webGL2;
    this.drawables.walls.instanceSet.clear()
    this.#addWallInstances(occlusionTester.obstacleGeometries.terrainWalls, targetGeom);
    if ( !this.drawables.walls.instanceSet.size ) return;

    // Set WebGL state.
    webGL2.setBlending(true); // Enable Additive Blending
    if ( debug ) {
      this.setMaterial("terrain");
      webGL2.setColorMask(WebGL2.noColorMask);

      // srcRGB, dstRGB, srcAlpha, dstAlpha
      webGL2.setBlendFuncSeparate(gl.SRC_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      webGL2.setColorMask(WebGL2.greenAlphaMask);  // Set color mask to GREEN only.
      webGL2.setBlendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ZERO);
    }

    // Disable depth writing so multiple terrain walls can overlap and sum their green values
    webGL2.setDepthMask(false);

    // Draw terrain geometry
    this.drawables.walls.render(debug);

    // Restore depth mask
    webGL2.setDepthMask(true);
  }

  destroy() {}


}