/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";

// WebGL2
import * as twgl from "./twgl.js";
import { WebGL2 } from "./WebGL2.js";

import {
  InstancedDrawable,
  ModelDrawable,
  MultiModelDrawable,
  DirectionalInstancedDrawable,
  TexturedInstancedDrawable,
  ConstrainedInstancedDrawable,
} from "./Drawable.js";

import { InstancedGeometricPrimitive } from "../../geometry/placeable_geometry/InstancedGeometricPrimitive.js";

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

  async initialize() {
    await this._initializePrograms();
    this._initializeCameraBuffer();
    this._initializeMaterialBuffer();
    this.resize();
  }

   // ----- NOTE: Program ----- //

  /** @type {string} */
  static VERTEX_FILE = "instance_vertex_ubo_v2";

  /** @type {string} */
  static FRAGMENT_FILE = "fragment_v2";

  static SHADER_FLAGS = InstancedDrawable.SHADER_FLAGS;

  /** @type {number} */
  static MAX_CONSTRAINING_WALLS = 5; // Cannot be changed unless the glsl code is changed.

  /** @type {Map<number, twgl.ProgramInfo>} */
  // Because gl (and webGL2) change for debug vs regular canvas, programs cannot be static.
  programs = new Map();

  async _initializePrograms() {
    const SHADER_FLAGS = this.constructor.SHADER_FLAGS;

    // Programs used.
    const requiredVariants = [
      SHADER_FLAGS.NONE, // Non-instanced
      SHADER_FLAGS.TEXTURED, // Tiles
      SHADER_FLAGS.CONSTRAINED, // Tokens
      SHADER_FLAGS.CONSTRAINED, // Polygon tokens
    ]
    // Plus, need debug versions of each.

    // Compile each.
    const promises = requiredVariants.map(flags => this.compileVariant(flags));
    promises.push(...requiredVariants.map(flags => this.compileVariant(flags | SHADER_FLAGS.DEBUG)));
    await Promise.allSettled(promises);
  }

  async compileVariant(flags) {
    if ( this.programs.has(flags) ) return;

    // Bitwise AND to identify if a specific flag is active.
    const SHADER_FLAGS = this.constructor.SHADER_FLAGS;
    const isDebug     = (flags & SHADER_FLAGS.DEBUG) !== 0;
    const isTextured = (flags & SHADER_FLAGS.TEXTURED) !== 0;
    const isConstrained = (flags & SHADER_FLAGS.CONSTRAINED) !== 0;

    // Compile the program and store for later use, keyed to the flags.
    const programInfo = await this._createProgram({
      debugViewNormals: isDebug,
      hasTexture: isTextured,
      maxConstrainingWalls: isConstrained ? this.constructor.MAX_CONSTRAINING_WALLS : 0,
    });
    this.programs.set(flags, programInfo);
  }

  async _createProgram({ vertexFile, fragmentFile, ...opts } = {}) {
    // Must include all parameters that could be in the glsl file.
    vertexFile ??= this.constructor.VERTEX_FILE;
    fragmentFile ??= this.constructor.FRAGMENT_FILE;
    opts.debugViewNormals ??= false;
    opts.hasTexture ??= false;
    opts.maxConstrainingWalls ??= 0;
    return await this.webGL2.cacheProgram(vertexFile, fragmentFile, opts);
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
    const width = CONFIG[MODULE_ID].renderTextureSize || 128;
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
   * Caches of active drawables mapped to lookup keys based on the primitive and shader flags.
   * Because the renderer gl changes for the debug popout canvas vs regular canvas, the cache
   * cannot be static.
   * @type {Map<string, AbstractDrawable>}
   */
  drawableCaches = new Map();

  drawables = {
    target: new Set(),
    solidObstacles: new Set(),
    terrainObstacles: new Set(),
  }

  /**
   * Create and initialize drawables as needed.
   */
  prerender(targetShape, occlusionTester) {
    const tokenObstacles = new Set(["tokens"]);
    const terrainObstacles = new Set(["terrainWalls"]);
    const drawableOpts = { constrained: false, senseType: occlusionTester.senseType, levelId: occlusionTester.levelId };
    const otOpts = { includeObstacles: tokenObstacles, geomSubtype: "full "};

    // Clear the drawables of any old instances.
    this.drawableCaches.forEach(drawable => drawable.clearRenderSet());
    Object.values(this.drawables).forEach(s => s.clear());

    // Helper to process any shape iteration.
    const processShapes = (shapes, targetSet, opts) => {
      for ( const shape of shapes ) {
        const drawable = this.#getOrCacheDrawable(shape, opts);
        targetSet.add(drawable);
        drawable.addToRenderSet(shape);
      }
    }

    // Target, which may be constrained by GPU using 5 or less overlapping walls.
    processShapes([targetShape], this.drawables.target, drawableOpts);

    // Token obstacles. Also may be constrained by GPU.
    processShapes(occlusionTester.iterateObstacleShapes(otOpts), this.drawables.solidObstacles, drawableOpts);

    // Solid obstacles.
    otOpts.includeObstacles = occlusionTester.constructor.OBSTACLE_KEYS.difference(tokenObstacles).difference(terrainObstacles);
    drawableOpts.constrained = false;
    processShapes(occlusionTester.iterateObstacleShapes(otOpts), this.drawables.solidObstacles, drawableOpts);

    // Terrain obstacles.
    otOpts.includeObstacles = terrainObstacles;
    drawableOpts.constrained = false;
    processShapes(occlusionTester.iterateObstacleShapes(otOpts), this.drawables.terrainObstacles, drawableOpts);
  }

  #getOrCacheDrawable(primitive, { senseType = "sight", constrained = false, levelId = "" } = {}) {
    /* Drawables:
    InstancedDrawable -- per primitive
    ModelDrawable -- per object
    MultiModelDrawable -- single drawable for all objects
    TexturedInstancedDrawable -- per primitive but really only TexturedQuadPrimitive
    ConstrainedInstancedDrawable -- per primitive
    ConstrainedModelDrawable
    DirectionalInstancedDrawable -- per primitive but really only TexturedQuadPrimitive, VerticalQuadPrimitive
    */
    const key = this.#drawableKeyForPrimitive(primitive, constrained);
    if ( this.drawableCaches.has(key) ) return this.drawableCaches.get(key);

    const programFlags = this.#drawableProgramFlagsForPrimitive(primitive, constrained);
    const drawableClass = this.#drawableClassForPrimitive(primitive, constrained);
    const drawable = new drawableClass({
      webGL2: this.webGL2,
      programInfo: this.programs.get(programFlags),
      debugProgramInfo: this.programs.get(programFlags | this.constructor.SHADER_FLAGS.DEBUG),
      primitiveClass: primitive.constructor,
      shape: primitive, // For ModelDrawable
    });
    if ( drawable instanceof ConstrainedInstancedDrawable ) {
      drawable.levelId = levelId;
      drawable.senseType = senseType;
    }
    drawable.initialize();
    this.drawableCaches.set(key, drawable);
    return drawable;
  }

  #drawableProgramFlagsForPrimitive(primitive, constrained = false) {
    const SHADER_FLAGS = this.constructor.SHADER_FLAGS;
    let programFlags = SHADER_FLAGS.NONE;
    if ( primitive.constructor.TEXTURED ) programFlags |= SHADER_FLAGS.TEXTURED;
    if ( constrained ) programFlags |= SHADER_FLAGS.CONSTRAINED;
    return programFlags;
  }

  #drawableClassForPrimitive(primitive, constrained = false) {
    const isInstanced = primitive instanceof InstancedGeometricPrimitive;
    const isDirectional = Object.hasOwn(primitive, "direction");
    let drawableClass;
    if ( isInstanced ) {
      drawableClass = InstancedDrawable;
      if ( primitive.constructor.TEXTURED ) drawableClass = TexturedInstancedDrawable;
      else if ( constrained ) drawableClass = ConstrainedInstancedDrawable;
      else if ( isDirectional ) drawableClass = DirectionalInstancedDrawable;
    } else {
      if ( constrained ) new Error(`${this.constructor.name}##drawableClassForPrimitive|Constrained only uses instanced geometry.`);
      drawableClass = this.constructor.USE_MULTI_MODEL ? MultiModelDrawable : ModelDrawable;
    }
    return drawableClass;
  }

  static USE_MULTI_MODEL = false; // For now, just for debugging.

  #drawableKeyForPrimitive(primitive, constrained = false) {
    let key;
    const isInstanced = primitive instanceof InstancedGeometricPrimitive;
    const isDirectional = Object.hasOwn(primitive, "direction");

    if ( !isInstanced ) {
      if ( !this.constructor.USE_MULTI_MODEL ) return primitive; // Primitive shape is the key for single model.
      key = "MultiModelDrawable";
    } else {
      // Instance drawables are split by primitive type.
      key = `InstancedDrawable_${primitive.constructor.name}`;

      // For now, directional is only applied to instance drawables.
      if ( isDirectional ) key += `_directional`;

      // For now, textured is only applied to instance drawables.
      else if ( primitive.constructor.TEXTURED ) key += `_textured`;
    }
    if ( constrained ) key += `_constrained`;
    return key;
  }

  /**
   * Core rendering method.
   * NOTE: user should first set the camera.
   */
  render({ clear = true, debug = false, frame } = {}) {
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
    this._renderTarget(debug);

    // Pass 2: Render hard obstacles
    this._renderHardObstacles(debug);

    // Pass 3: Render terrain (limited wall) obstacle.
    this._renderTerrainObstacles(debug);
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

  _renderTarget(debug = false) {
    const webGL2 = this.webGL2;

    // Set WebGL2 state.
    if ( debug ) {
      webGL2.setColorMask(WebGL2.noColorMask);
      this.setMaterial("target");
    } else webGL2.setColorMask(WebGL2.redAlphaMask);
    webGL2.setBlending(false);

    this.drawables.target.forEach(drawable => drawable.render(debug));
  }

  _renderHardObstacles(debug = false) {
    if ( !this.drawables.solidObstacles.size ) return;
    const webGL2 = this.webGL2;

    // Set color mask to BLUE only.
    // Set WebGL2 state.
    if ( debug ) {
      this.setMaterial("obstacle");
      webGL2.setColorMask(WebGL2.noColorMask);
    } else webGL2.setColorMask(WebGL2.blueAlphaMask);
    webGL2.setBlending(false);
    this.drawables.solidObstacles.forEach(drawable => drawable.render(debug));
  }

  _renderTerrainObstacles(debug = false) {
    if ( !this.drawables.terrainObstacles.size ) return;
    const gl = this.gl;
    const webGL2 = this.webGL2;

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
    this.drawables.terrainObstacles.forEach(drawable => drawable.render(debug));

    // Restore depth mask
    webGL2.setDepthMask(true);
  }

  destroy() {}
}
