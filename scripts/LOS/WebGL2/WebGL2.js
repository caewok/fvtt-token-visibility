/* globals
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { wgsl } from "../WebGPU/wgsl-preprocessor.js";
import * as twgl from "./twgl.js";
import { applyConsecutively } from "../util.js";



/**
 * Misc static functions to assist with WebGL2 rendering.
 * Also handles caching and WebGL2 state.
 */
export class WebGL2 {

  /** @type {WebGL2RenderingContext} */
  gl;

  /**
   * @param {WebGL2RenderingContext} gl
   */
  constructor(gl) {
    this.gl = gl;
    this.initializeGLState();
  }

  // ----- NOTE: Cache program ----- //

  /** @type {Map<string, twgl.ProgramInfo} */
  programs = new Map();

  /** @type {twgl.ProgramInfo} */
  currentProgramInfo;

  useProgram(programInfo) {
    if ( this.currentProgramInfo !== programInfo ) this.gl.useProgram(programInfo.program);
    this.currentProgramInfo = programInfo;
    if ( this.currentProgramInfo.program !== this.gl.getParameter(this.gl.CURRENT_PROGRAM) ) console.error("Current program is incorrect.");
    // else console.debug("Current program is correct.")
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
    const vertexShaderSource = await WebGL2.sourceFromGLSLFile(vsFile, opts)
    const fragmentShaderSource = await WebGL2.sourceFromGLSLFile(fsFile, opts)
    return twgl.createProgramInfo(this.gl, [vertexShaderSource, fragmentShaderSource]);
  }

  // ----- Cache gl state ----- //

  glState = {
    viewport: new PIXI.Rectangle(),
    DEPTH_TEST: false,
    STENCIL_TEST: false,
    BLEND: false,
    CULL_FACE: false,
    cullFace: "BACK",
    colorMask: [true, true, true, true],
  }

  /**
   * Force gl state to current values.
   */
  initializeGLState() {
    const { gl, glState } = this;
    gl.viewport(glState.viewport.x, glState.viewport.y, glState.viewport.width, glState.viewport.height);
    gl.cullFace(gl[glState.cullFace]);
    gl.colorMask(...glState.colorMask);
    for ( const name of ["DEPTH_TEST", "STENCIL_TEST", "BLEND", "CULL_FACE"] ) {
      glState[name] ? gl.enable(gl[name]) : gl.disable(gl[name]);
    }
  }

  setViewport(rect) {
    if ( this.glState.viewport.equals(rect) ) return;
    const { gl, glState } = this;
    gl.viewport(glState.viewport.x, glState.viewport.y, glState.viewport.width, glState.viewport.height);
    glState.viewport.copyFrom(rect);
  }

  #setGLBooleanState(name, enabled = true) {
    const param = this.gl.getParameter(this.gl[name])
    if ( param !== this.glState[name] ) console.error(`State ${name} is incorrect. Should be ${param}`);
    if ( this.glState[name] === enabled ) return;
    const gl = this.gl;
    enabled ? gl.enable(gl[name]) : gl.disable(gl[name]);
    this.glState[name] = enabled;
  }

  setDepthTest(enabled) { this.#setGLBooleanState("DEPTH_TEST", enabled); }

  setStencilTest(enabled) { this.#setGLBooleanState("STENCIL_TEST", enabled); }

  setBlending(enabled) { this.#setGLBooleanState("BLEND", enabled); }

  setCulling(enabled) { this.#setGLBooleanState("CULL_FACE", enabled); }

  setCullFace(face = "BACK") {
    const param = this.gl.getParameter(this.gl.CULL_FACE_MODE)
    if ( param !== this.gl[this.glState.cullFace] ) console.error(`Cull face mode is incorrect. Should be ${param}`);
    if ( this.glState.cullFace === face ) return;
    this.gl.cullFace(this.gl[face]);
    this.glState.cullFace = face;
  }

  setColorMask(mask = [true, true, true, true]) {
    const param = this.gl.getParameter(this.gl.COLOR_WRITEMASK);
    if ( !param.equals(this.glState.colorMask) ) console.error(`Color mask is incorrect. Should be`, param);
    if ( this.glState.colorMask.equals(mask) ) return;
    this.gl.colorMask(...mask);
    this.glState.colorMask = mask;
  }

  static redAlphaMask = [true, false, false, true];

  static blueAlphaMask = [false, false, true, true];

  static greenAlphaMask = [false, true, false, true];

  static noColorMask = [true, true, true, true];


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




 /**
  * Draw representation of pixels
  */
 static drawPixels(imgData, { minX = 0, maxX, minY = 0, maxY, channel = 0 } = {}) {
   let str = "";
   maxX ??= imgData.width;
   maxY ??= imgData.height;

   // 0,0 is bottom left
   // pixel is data[(width * height - 1) * pixelSize]
   for ( let y = imgData.height - 1; y >= 0; y -= 1 ) {
     for ( let x = 0; x < imgData.width; x += 1 ) {
       if ( x < minX || x > maxX ) continue;
       if ( y < minY || y > maxY ) continue;
       const px = imgData.pixels[(x * y * 4) + channel];
       const nStr = `${px}`;
       const paddingLn = 3 - nStr.length;
       const paddedStr = "0".repeat(paddingLn) + nStr;
       str += `${paddedStr} `;
     }
     str += "\n";
   }
   console.log(str);
   // return str;
 }


  /**
   * Given image data or image pixels, print summary of the 4 color channels to console.
   * @param {object|TypedArray} pixels      Object with pixels parameter or an array of pixels
   */
  static summarizePixelData(pixels) {
    if ( Object.hasOwn(pixels, "pixels") ) pixels = pixels.pixels;
    const acc = Array(12).fill(0);
    const max = Array(4).fill(0);
    const min = Array(4).fill(0)
    pixels.forEach((px, idx) => {
      acc[idx % 4] += px;
      acc[idx % 4 + 4] += Boolean(px);
      acc[idx % 4 + 8] += !px;
      max[idx % 4] = Math.max(px, max[idx % 4])
      min[idx % 4] = Math.min(px, min[idx % 4])
    });
    let redBlocked = 0;
    const terrainThreshold = 255 * 0.75;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      redBlocked += Boolean(r) * Boolean(b || (g > terrainThreshold))
    }

    console.table([
      { label: "sum", r: acc[0], g: acc[1], b: acc[2], a: acc[3] },
      { label: "count", r: acc[4], g: acc[5], b: acc[6], a: acc[7] },
      { label: "zeroes", r: acc[8], g: acc[9], b: acc[10], a: acc[11] },
      { label: "min", r: min[0], g: min[1], b: min[2], a: min[3] },
      { label: "max", r: max[0], g: max[1], b: max[2], a: max[3] },
      { label: "redBlocked", r: redBlocked, g: redBlocked, b: redBlocked, a: redBlocked}
    ])
  }



  static draw(gl, count, offset = 0) {
    const primitiveType = gl.TRIANGLES;
    const indexType = gl.UNSIGNED_SHORT;
    gl.drawElements(primitiveType, count, indexType, offset);
  }


  static drawSet(gl, instanceSet, offsetData) {
    if ( !(instanceSet.size || instanceSet.length) ) return;

    // Handle either instances all same number of vertices or different number.
    const instanceLength = Number.isNumeric(offsetData.index.lengths)
      ? offsetData.index.lengths : 0;

    // For a consecutive group, draw all at once.
    // So if 0–5, 7–9, 12, should result in 3 draw calls.
    applyConsecutively(instanceSet, (firstInstance, instanceCount) => {
      // Pull the offset and count from the offsetData.
      const offset = offsetData.index.offsets[firstInstance];
      const count = (instanceLength * instanceCount)
        || sumArray(offsetData.index.lengths.slice(firstInstance, firstInstance + instanceCount));
      this.draw(gl, count, offset);
    });
  }

  static drawInstanced(gl, elementCount, offset = 0, instanceCount = 1) {
    const primitiveType = gl.TRIANGLES;
    const indexType = gl.UNSIGNED_SHORT;
    gl.drawElementsInstanced(primitiveType, elementCount, indexType, offset, instanceCount);
  }
}

function sumArray(arr) { return arr.reduce((acc, curr) => acc + curr, 0); }


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
  return new Function("wgsl", ...names, `return wgsl\`${str}\`;`)(wgsl, ...vals);
}



