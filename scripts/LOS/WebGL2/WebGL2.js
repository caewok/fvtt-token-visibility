/* globals
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { wgsl } from "../wgsl-preprocessor.js";
import * as twgl from "./twgl.js";
import { applyConsecutively } from "../util.js";


/**
 * Misc static functions to assist with WebGL2 rendering.
 * Also handles caching and WebGL2 state.
 */
export class WebGL2 {

  /** @type {WebGL2RenderingContext} */
  gl;

  /** @type {boolean} */
  destroyed = false;

  /**
   * @param {WebGL2RenderingContext} gl
   */
  constructor(gl) {
    if ( this.constructor.glContextMap.has(gl) ) throw Error("WebGL2|Use the static create method!");

    this.gl = gl;
    this.#resetGLState();
    this.#registerContextListeners();
  }

  // In order to cache gl state, must use a static creator and only create one instance per gl.
  static glContextMap = new WeakMap();

  /**
   * @param {WebGL2RenderingContext} gl
   * @returns {WebGL2}
   */
  static create(gl) {
    if ( this.glContextMap.has(gl)) return this.glContextMap.get(gl);
    const out = new this(gl);
    this.glContextMap.set(gl, out);
    return out;
  }

  // ----- NOTE: Cache program ----- //

  /** @type {Map<string, twgl.ProgramInfo} */
  programs = new Map();

  /** @type {twgl.ProgramInfo} */
  currentProgramInfo;

  useProgram(programInfo) {
    if ( this.currentProgramInfo === programInfo ) return;
    this.gl.useProgram(programInfo?.program || null);
    this.currentProgramInfo = programInfo;
  }

  /**
   * Debug only: confirm the cached program matches what the driver reports.
   * @returns {boolean}
   */
  validateProgramState() {
    const actual = this.gl.getParameter(this.gl.CURRENT_PROGRAM);
    const expected = this.currentProgramInfo?.program ?? null;
    if ( actual !== expected ) console.error("WebGL2|Cached program does not match gl.CURRENT_PROGRAM.", { actual, expected });
    return actual === expected;
  }

  /**
   * Key to store the drawable's program, allowing it to be reused.
   * @param {DrawableObjectsWebGL2Abstract} drawable
   * @returns {string}
   */
  static programKey(vsFile, fsFile, opts = {}) {
    opts = JSON.stringify(opts);
    return `${vsFile}_${fsFile}_${opts}`;
  }

  /**
   * Create and cache the program info or build a new one
   * @param {DrawableObjectsWebGL2Abstract} drawable
   * @returns {twgl.ProgramInfo} the program info for the drawable
   */
  async cacheProgram(vsFile, fsFile, opts = {}) {
    const key = this.constructor.programKey(vsFile, fsFile, opts);
    if ( this.programs.has(key) ) return this.programs.get(key);
    const programInfo = await this.createProgram(vsFile, fsFile, opts);
    this.programs.set(key, programInfo);
    return programInfo;
  }

  /**
   * Create a WebGL2 program from vertex and fragment files.
   * @param {string} vsFile       Vertex source file
   * @param {string} fsFile       Fragment source file
   * @param {object} [opts]       Options passed to sourceFromGLSLFile used to parse the file
   * @returns {twgl.ProgramInfo}
   */
  async createProgram(vsFile, fsFile, opts = {}) {
    const vertexShaderSource = await WebGL2.sourceFromGLSLFile(vsFile, opts);
    const fragmentShaderSource = await WebGL2.sourceFromGLSLFile(fsFile, opts);
    return twgl.createProgramInfo(this.gl, [vertexShaderSource, fragmentShaderSource]);
  }

  // ----- Cache WebGL2 state ----- //

  static defaultGLState() {
    return {
      viewport: new PIXI.Rectangle(),
      DEPTH_TEST: false,
      STENCIL_TEST: false,
      BLEND: false,
      CULL_FACE: false,
      cullFace: "BACK",
      colorMask: this.noColorMask,
      clearColor: this.blackClearColor,
      blendFuncSeparate: this.defaultBlendFuncSeparate,
      depthMask: true,
    };
  }

  /** @type {object} */
  glState;

  /** @type {boolean} */
  contextLost = false;

  /** @type {Set<function>} */
  #restoreCallbacks = new Set();

  /** @type {Set<function>} */
  #lostCallbacks = new Set();

  /**
   * Run a function after the context is lost.
   * @param {function} fn
   * @returns {function} Call to unregister.
   */
  #onContextLost = event => {
    event.preventDefault(); // Required, or the browser will not attempt a restore.
    this.contextLost = true;
    for ( const fn of this.#lostCallbacks ) {
      try { fn(); } catch(err) { console.error(err); }
    }
    console.warn(`${MODULE_ID}|WebGL2 context lost.`);
  };

  /**
   * Run a function after the context is restored (GL objects must be rebuilt).
   * @param {function} fn
   * @returns {function} Call to unregister.
   */
  #onContextRestored = async () => {
    console.warn(`${MODULE_ID}|WebGL2 context restored; rebuilding.`);
    this.programs.clear();
    this.currentProgramInfo = undefined;
    this.#resetGLState();
    this.contextLost = false;
    for ( const fn of this.#restoreCallbacks ) {
      try { await fn(); } catch(err) { console.error(err); }
    }
  };

  #resetGLState() {
    const { gl } = this;
    this.glState = this.constructor.defaultGLState();
    this.glState.viewport.width = gl.canvas.width;
    this.glState.viewport.height = gl.canvas.height;
    this.initializeGLState();
  }

  #registerContextListeners() {
    const canvas = this.gl.canvas;
    canvas.addEventListener("webglcontextlost", this.#onContextLost);
    canvas.addEventListener("webglcontextrestored", this.#onContextRestored);
  }

  /** Release the context. The instance cannot be used afterward. */
  destroy() {
    if ( this.destroyed ) return;
    this.destroyed = true;
    const gl = this.gl;
    gl.canvas.removeEventListener("webglcontextlost", this.#onContextLost);
    gl.canvas.removeEventListener("webglcontextrestored", this.#onContextRestored);
    this.#lostCallbacks.clear();
    this.#restoreCallbacks.clear();
    this.programs.clear();
    this.currentProgramInfo = undefined;
    this.constructor.glContextMap.delete(gl);
    this.contextLost = true;   // Any stale reader sees "not ready"
    if ( !gl.isContextLost() ) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /**
   * Force gl state to current values.
   */
  initializeGLState() {
    const { gl, glState } = this;
    gl.viewport(glState.viewport.x, glState.viewport.y, glState.viewport.width, glState.viewport.height);
    gl.cullFace(gl[glState.cullFace]);
    gl.colorMask(...glState.colorMask);
    gl.clearColor(...glState.clearColor);
    gl.depthMask(glState.depthMask);
    for ( const name of ["DEPTH_TEST", "STENCIL_TEST", "BLEND", "CULL_FACE"] ) {
      if ( glState[name] ) gl.enable(gl[name]);
      else gl.disable(gl[name]);
    }
    gl.blendFuncSeparate(...glState.blendFuncSeparate);
  }

  /**
   * Set one of the boolean WebGL states and cache the value.
   * @param {string} name         WebGL state name, e.g. "DEPTH_TEST"
   * @param {boolean} [enabled=true]     Whether to enable or disable
   */
  #setGLBooleanState(name, enabled = true) {
    // Debugging:
    // const param = this.gl.getParameter(this.gl[name])
    // if ( param !== this.glState[name] ) console.error(`State ${name} is incorrect. Should be ${param}`);
    if ( this.glState[name] === enabled ) return;
    const gl = this.gl;
    if ( enabled ) gl.enable(gl[name]);
    else gl.disable(gl[name]);
    this.glState[name] = enabled;
  }

  /**
   * Set gl.DEPTH_TEST to enabled or disabled.
   * @param {boolean} [enabled=true]    Whether to enable or disable
   */
  setDepthTest(enabled) { this.#setGLBooleanState("DEPTH_TEST", enabled); }

  setStencilTest(enabled) { this.#setGLBooleanState("STENCIL_TEST", enabled); }

  setBlending(enabled) { this.#setGLBooleanState("BLEND", enabled); }

  setCulling(enabled) { this.#setGLBooleanState("CULL_FACE", enabled); }

  /**
   * Set the viewport to a given rectangle and cache the value.
   * @param {PIXI.Rectangle} rect
   */
  setViewport(rect) {
    //     Debugging
    //     const param = this.gl.getParameter(this.gl.VIEWPORT);
    //     if ( this.glState.viewport.x !== param[0]
    //       || this.glState.viewport.y !== param[1]
    //       || this.glState.viewport.width !== param[2]
    //       || this.glState.viewport.height !== param[3] ) console.error(`Viewport is incorrect. Should be`, param);
    if ( this.glState.viewport.equals(rect) ) return;
    const { gl, glState } = this;
    glState.viewport.copyFrom(rect);
    gl.viewport(glState.viewport.x, glState.viewport.y, glState.viewport.width, glState.viewport.height);
  }

  /**
   * Bind a framebuffer without changing the viewport (unlike twgl.bindFramebufferInfo).
   * @param {twgl.FramebufferInfo|null} fbInfo     null binds the default framebuffer
   */
  bindFramebuffer(fbInfo) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbInfo?.framebuffer ?? null);
  }

  setCullFace(face = "BACK") {
    // Debugging
    // const param = this.gl.getParameter(this.gl.CULL_FACE_MODE)
    // if ( param !== this.gl[this.glState.cullFace] ) console.error(`Cull face mode is incorrect. Should be ${param}`);
    if ( this.glState.cullFace === face ) return;
    this.gl.cullFace(this.gl[face]);
    this.glState.cullFace = face;
  }

  setColorMask(mask = this.constructor.noColorMask) {
    // Debugging
    //     const param = this.gl.getParameter(this.gl.COLOR_WRITEMASK);
    //     if ( !param.equals(this.glState.colorMask) ) console.error(`Color mask is incorrect. Should be`, param);
    if ( this.glState.colorMask.equals(mask) ) return;
    this.gl.colorMask(...mask);
    this.glState.colorMask = mask;
  }

  setClearColor(color = this.constructor.blackClearColor) {
    // Debugging
    //     const param = this.gl.getParameter(this.gl.COLOR_CLEAR_VALUE);
    //     if ( !this.glState.clearColor.every((elem, idx) => elem === param[idx]) ) {
    //   console.error(`Clear color is incorrect. Should be`, param);
    // }
    if ( this.glState.clearColor.equals(color) ) return;
    this.gl.clearColor(...color);
    this.glState.clearColor = color;
  }

  setBlendFuncSeparate(...args) {
    if ( this.glState.blendFuncSeparate.equals(args) ) return;
    this.gl.blendFuncSeparate(...args);
    this.glState.blendFuncSeparate = args;
  }

  setDepthMask(enabled) {
    if ( !(this.glState.depthMask ^ enabled) ) return;
    this.gl.depthMask(enabled);
    this.glState.depthMask = enabled;
  }

  static blackClearColor = [0, 0, 0, 0];

  static redAlphaMask = [true, false, false, true];

  static blueAlphaMask = [false, false, true, true];

  static noColorMask = [true, true, true, true];

  static disableColorMask = [false, false, false, false];

  static alphaMask = [false, false, false, true];

  static greenMask = [false, true, false, false];

  static defaultBlendFuncSeparate = [1, 0, 1, 0]; // [gl.ONE, gl.ZERO, gl.ONE, gl.ZERO]


  // ----- NOTE: Static methods ----- //

  /**
   * Load code from a GLSL file.
   * @param {string} fileName       Name of the GLSL file, found at scripts/glsl/
   * @param {object} params         Parameters used to interpolate the loaded code string
   * @returns {string}
   */
  static async sourceFromGLSLFile(filename, params) {
    const code = await this.fetchGLSLCode(filename);
    return interpolate(code, params);
  }

  /**
   * Fetch GLSL code as text.
   * @param {string} fileName     The file name without extension or directory path.
   * @returns {string}
   */
  static async fetchGLSLCode(fileName) {
    const resp = await foundry.utils.fetchWithTimeout(`modules/${MODULE_ID}/scripts/LOS/WebGL2/glsl/${fileName}.glsl`);
    return resp.text();
  }

  static drawInstanced(gl, elementCount, offset = 0, instanceCount = 1) {
    gl.drawElementsInstanced(gl.TRIANGLES, elementCount, gl.UNSIGNED_SHORT, offset, instanceCount);
  }

  /**
   * Draw instanced for only the specified instances.
   * Cannot simply specify the instance start in webGL2, b/c that extension is barely supported.
   * Instead, move the pointer in the buffer accordingly.
   * This function assumes a single (model) matrix that must be instanced.
   * @param {WebGL2Context} gl
   * @param {Set<number>} instanceSet         Instances to draw
   * @param {number} elementCount             Number of vertices to draw
   * @param {function[]} advanceInstanceFns   Functions called to advance a property at each instance
   */
  static drawInstancedSet(gl, instanceSet, elementCount, advanceInstanceFns = []) {
    applyConsecutively(instanceSet, (firstInstance, instanceCount) => {
      advanceInstanceFns.forEach(fn => fn(firstInstance));
      this.drawInstanced(gl, elementCount, 0, instanceCount);
    });
  }

  static _advanceInstanceFn(gl, instanceBufferInfo, positionLoc) {
    const {
      type = gl.FLOAT,
      stride = 0,
      normalize = false,
      buffer,
      numComponents,
      offset: baseOffset = 0 } = instanceBufferInfo;

    // Calculate effective stride. If stride is 0, assume tightly packed data (4 bytes for FLOAT/INT).
    const effectiveStride = stride || (numComponents * 4);

    switch ( numComponents ) {
      case 16: return firstInstance => {
        const offset = baseOffset + (firstInstance * effectiveStride); // Instance size is 16 x 4 for a 4x4 matrix of floats.
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.vertexAttribPointer(positionLoc, 4, type, normalize, effectiveStride, offset);
        gl.vertexAttribPointer(positionLoc+1, 4, type, normalize, effectiveStride, offset + 16); // 4 elements * 4 bytes
        gl.vertexAttribPointer(positionLoc+2, 4, type, normalize, effectiveStride, offset + 32); // 8 elements * 4 bytes
        gl.vertexAttribPointer(positionLoc+3, 4, type, normalize, effectiveStride, offset + 48); // 12 elements * 4 bytes
      };

      case 1:
      case 2:
      case 3:
      case 4: {
        switch ( type ) {
          case gl.FLOAT: return firstInstance => {
            const offset = baseOffset + (firstInstance * effectiveStride);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.vertexAttribPointer(positionLoc, numComponents, type, normalize, effectiveStride, offset);
          };

          case gl.INT: return firstInstance => {
            const offset = baseOffset + (firstInstance * effectiveStride);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.vertexAttribIPointer(positionLoc, numComponents, type, effectiveStride, offset); // Note the different signature from vertexAttribPointer.
          };

          default: throw Error(`_advanceInstanceFn ${type} type not yet implemented.`);
        }
      }

      default: throw Error(`_advanceInstanceFn ${numComponents} components not yet implemented.`);
    }
  }
}

/**
 * Limited string replacement so the imported glsl code can be treated as a template literal
 * (without using eval).
 * See https://stackoverflow.com/questions/29182244/convert-a-string-to-a-template-string
 * @param {string} str      String with ${} values to replace
 * @param {object} params   Valid objects that can be replaced; either variables or function names
 * @returns {string}
 */
function interpolate(str, params = {}) {
  // Replace the names with the relevant values.
  const names = Object.keys(params);
  const vals = Object.values(params);
  return new Function("wgsl", ...names, `return wgsl\`${str}\`;`)(wgsl, ...vals); /* eslint-disable-line no-new-func */
}
