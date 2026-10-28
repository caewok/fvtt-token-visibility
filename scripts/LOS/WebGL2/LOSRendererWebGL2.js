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
  Drawable,
  TexturedDrawable,
  ConstrainedDrawable,
} from "./Drawable.js";

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

  #initialized = false;

  async initialize() {
    if ( this.#initialized ) return;
    await this._initializePrograms();
    this._initializeCameraBuffer();
    this._initializeMaterialBuffer();
    this.resize();
    this.#initialized = true;
  }

   // ----- NOTE: Program ----- //

  /** @type {string} */
  static VERTEX_FILE = "drawable_vertex";

  /** @type {string} */
  static FRAGMENT_FILE = "drawable_fragment";

  static SHADER_FLAGS = Drawable.SHADER_FLAGS;

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
      maxConstrainingWalls: isConstrained ? ConstrainedDrawable.NUM_CONSTRAINING_WALLS : 0,
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
    this.#deleteFramebuffer();
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

  #deleteFramebuffer() {
    const fb = this.fbInfo;
    if ( !fb ) return;
    const gl = this.gl;
    gl.deleteFramebuffer(fb.framebuffer);
    for ( const attachment of fb.attachments ?? [] ) {
      if ( attachment instanceof WebGLRenderbuffer ) gl.deleteRenderbuffer(attachment);
      else gl.deleteTexture(attachment);
    }
    this.fbInfo = null;
  }

  // ----- NOTE: Render pipeline ----- //

  /**
   * Caches of active drawables mapped to lookup keys based on the primitive and shader flags.
   * Because the renderer gl changes for the debug popout canvas vs regular canvas, the cache
   * cannot be static.
   * @type {Map<string, Map<VO, Drawable>}
   */
  drawableCaches = new Map();

  drawables = {
    target: new Set(),
    solid: new Set(),
    terrain: new Set(),
    partial: new Set(),
  };

  #frame = 0;

  #allDrawables() {
    return [...this.drawableCaches.values()].flatMap(byVO => [...byVO.values()]);
  }

  /**
   * Cache drawables by pass and VO. Pass is part of key b/c the drawable's render set
   * is drawn in one pass, and the same class is used for target, solid, and partial walls.
   * @param {string} pass         Category of the drawable
   * @param {object} datum        From GeometricPrimitive#drawables
   * @param {object} opts
   * @returns {Drawable}
   */
  #drawableFor(pass, datum, { constrained = false, senseType = "sight", levelId = "" } = {}) {
    const key = `${pass}|${Boolean(datum.primitive.constructor.TEXTURED)}|${constrained}`;
    let byVO = this.drawableCaches.get(key);
    if ( !byVO ) this.drawableCaches.set(key, byVO = new Map());
    let drawable = byVO.get(datum.vo);
    if ( !drawable ) byVO.set(datum.vo, drawable = this.#createDrawable(datum, constrained));
    if ( drawable instanceof ConstrainedDrawable ) { drawable.levelId = levelId; drawable.senseType = senseType; }
    drawable.lastUsed = this.#frame;
    this.drawables[pass].add(drawable);
    return drawable;
  }

  #createDrawable(datum, constrained = false) {
    const FLAGS = this.constructor.SHADER_FLAGS;
    const textured = Boolean(datum.primitive.constructor.TEXTURED);
    let flags = FLAGS.NONE;
    if ( textured ) flags |= FLAGS.TEXTURED;
    if ( constrained ) flags |= FLAGS.CONSTRAINED;
    const DrawableClass = textured ? TexturedDrawable : constrained ? ConstrainedDrawable : Drawable;
    const drawable = new DrawableClass({
      webGL2: this.webGL2,
      programInfo: this.programs.get(flags),
      debugProgramInfo: this.programs.get(flags | FLAGS.DEBUG),
      vo: datum.vo,
      voVersion: datum.voVersion,
    });
    drawable.initialize(); // Before add().
    return drawable;
  }

  /**
   * Drop drawables unused for a while.
   * Caps rebuilds and deleted placeables otherwise leak buffers.
   * @param {number} [maxAge=120]
   */
  #prune(maxAge = 120) {
    for ( const byVO of this.drawableCaches.values() ) {
      for ( const [vo, drawable] of byVO ) {
        if ( this.#frame - drawable.lastUsed <= maxAge ) continue;
        drawable.destroy();
        byVO.delete(vo);
      }
    }
  }

  /**
   * Create and initialize drawables as needed.
   */
  prerender(targetShape, occlusionTester, { partial = [], nonBlocking = [] } = {}) {
    this.updateCameraBuffer();

    const tokenObstacles = new Set(["tokens"]);
    const terrainObstacles = new Set(["terrainWalls"]);

    // Partially opaque obstacles get their own pass.
    // Terrain walls keep their overlap logic and stay solid.
    const layered = partial.filter(e => e.subtype !== "terrainWalls");
    const excluded = new Set([...layered, ...nonBlocking].map(e => e.obstacle));

    const drawableOpts = { constrained: true, senseType: occlusionTester.config.senseType, levelId: occlusionTester.levelId };
    const otOpts = { includeObstacles: tokenObstacles, geomSubtypeFn: () => "full", excluded };

    // Clear the drawables of any old instances.
    this.#frame += 1;
    this.#allDrawables().forEach(d => d.clearRenderSet());
    Object.values(this.drawables).forEach(s => s.clear());

    const processShapes = (shapes, pass, opts, opacity = 1) => {
      for ( const shape of shapes ) {
        if ( !shape.faces.length ) continue;
        shape.opacity = opacity; // Always set: the value persists on the shape between calculations.
        for ( const datum of shape.drawables() ) this.#drawableFor(pass, datum, opts).add(datum);
      }
    };

    // Target, which may be constrained by GPU using 5 or less overlapping walls.
    processShapes([targetShape], "target", drawableOpts);

    // Token obstacles. Also may be constrained by GPU.
    processShapes(occlusionTester.iterateObstacleShapes(otOpts), "solid", drawableOpts);

    // Solid obstacles.
    otOpts.includeObstacles = occlusionTester.constructor.OBSTACLE_KEYS.difference(tokenObstacles).difference(terrainObstacles);
    drawableOpts.constrained = false;
    processShapes(occlusionTester.iterateObstacleShapes(otOpts), "solid", drawableOpts);

    // Terrain obstacles.
    otOpts.includeObstacles = terrainObstacles;
    drawableOpts.constrained = false;
    processShapes(occlusionTester.iterateObstacleShapes(otOpts), "terrain", drawableOpts);

    // Partially opaque obstacles: one drawable per shape, so each keeps its own opacity.
    for ( const { obstacle, subtype, opacity } of layered ) {
      const shapes = obstacle.constructor.HAS_SUBTYPES ? obstacle.calculated.shapes : obstacle.shapes;
      processShapes(shapes, "partial", { ...drawableOpts, constrained: subtype === "tokens" }, opacity);
    }
    this.#prune();
  }

  /**
   * Destroy the active drawables that are not held in the cache, and empty the active sets.
   */
  #releaseDrawables() {
    const cached = new Set(this.drawableCaches.values());
    for ( const m of this.drawableCaches.values() ) {
      for ( const drawable of m.values() ) cached.add(drawable);
    }

    for ( const set of Object.values(this.drawables) ) {
      for ( const drawable of set ) {
        if ( !cached.has(drawable) ) drawable.destroy();
      }
      set.clear();
    }
  }

  /**
   * Core rendering method.
   * NOTE: user should first set the camera.
   */
  render({ clear = true, debug = false, frame } = {}) {
    // console.debug(`LOSRendererWebGL2#Render. Debug? ${debug}`);

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

    // Pass 4: Render partially opaque obstacles.
    this._renderPartialObstacles(debug);
  }

  _renderPartialObstacles(debug = false) {
    if ( !this.drawables.partial.size ) return;
    const gl = this.gl;
    const webGL2 = this.webGL2;

    // Test depth against the target and solid obstacles but do not write it, so every layer attenuates.
    webGL2.setDepthTest(true);
    webGL2.setDepthMask(false);
    webGL2.setBlending(true);
    if ( debug ) {
      this.setMaterial("obstacle");
      webGL2.setColorMask(WebGL2.noColorMask);
      webGL2.setBlendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      // Alpha channel only: dst.a = dst.a * (1 - src.a). Overlapping layers multiply.
      webGL2.setColorMask(WebGL2.alphaMask);
      webGL2.setBlendFuncSeparate(gl.ZERO, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    }

    this.drawables.partial.forEach(drawable => drawable.render(debug));

    webGL2.setDepthMask(true);
    webGL2.setBlending(false);
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

    // console.debug(`LOSRendererWebGL2#Rendering target. Debug? ${debug}`);
    this.drawables.target.forEach(drawable => drawable.render(debug));
  }

  _renderHardObstacles(debug = false) {
    if ( !this.drawables.solid.size ) return;
    const webGL2 = this.webGL2;

    // Set color mask to BLUE only.
    // Set WebGL2 state.
    if ( debug ) {
      this.setMaterial("obstacle");
      webGL2.setColorMask(WebGL2.noColorMask);
    } else webGL2.setColorMask(WebGL2.blueAlphaMask);
    webGL2.setBlending(false);

    // console.debug(`LOSRendererWebGL2#Rendering obstacles. Debug? ${debug}`);
    this.drawables.solid.forEach(drawable => drawable.render(debug));
  }

  _renderTerrainObstacles(debug = false) {
    if ( !this.drawables.terrain.size ) return;
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
    // console.debug(`LOSRendererWebGL2#Rendering terrain. Debug? ${debug}`);
    this.drawables.terrain.forEach(drawable => drawable.render(debug));

    // Restore depth mask
    webGL2.setDepthMask(true);
  }

  destroy() {
    this.#releaseDrawables();
    for ( const m of this.drawableCaches.values() ) {
      for ( const drawable of m.values() ) drawable.destroy();
      m.clear();
    }
    this.drawableCaches.clear();

    const gl = this.gl;
    if ( this.buffer.camera ) gl.deleteBuffer(this.buffer.camera);
    if ( this.buffer.material ) gl.deleteBuffer(this.buffer.material);
    this.buffer.camera = null;
    this.buffer.material = null;
    this.#deleteFramebuffer();

  }
}
