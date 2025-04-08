/* globals
foundry,
PIXI,

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { Camera } from "../WebGPU/Camera.js";
import { NonDirectionalWallInstanceHandler, DirectionalWallInstanceHandler } from "../WebGPU/PlaceableInstanceHandler.js";
import { wgsl } from "../WebGPU/wgsl-preprocessor.js";
import * as twgl from "./twgl.js";

/*
PIXI: Only does basic instancing. No apparent way to filter which instances to use.
Could pull instances from a texture maybe.
But for now, just define the instance buffer at render to be only those needed to draw that viewpoint.

For WebGL2, cannot start at a specific instance index:
https://stackoverflow.com/questions/37469193/webgl-drawelementsinstancedangle-with-a-starting-offset-on-the-instanced-array
glDrawElementsInstancedBaseInstance only on GL 4:
https://registry.khronos.org/OpenGL-Refpages/gl4/html/glDrawElementsInstancedBaseInstance.xhtml
From stackoverflow: Could set an offset when binding the instance attribute(s)
See:
https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer
*/

/**
 * Misc functions to assist with WebGL2 rendering.
 */
export class WebGL2 {

  /** @type {WebGL2RenderingContext} */
  gl;

  /** @type {WebGL2Program} */
  program; // Current program to use.

  /** @type {WebGL2VertexArray} */
  vao; // Current vao to use.




  /**
   * @param {WebGL2RenderingContext} gl
   */
  constructor(gl) {
    this.gl = gl;
  }

  /**
   * Bind the current vertex array object.
   */
  bindVAO() { this.gl.bindVertexArray(this.vao); }

  unbindVAO() { this.gl.bindVertexArray(null); }

  /**
   * Use the current program.
   */
  useProgram() { this.gl.useProgram(this.program); }

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
   * Create a WebGL shader.
   * @param {gl.VERTEX_SHADER|gl.FRAGMENT_SHADER} type
   * @param {string} source
   * @returns {WebGL2Shader|undefined}
   */
  static createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if ( success ) return shader;

    // Record the error.
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return undefined;
  }

  createVertexShader(source) { return this.constructor.createShader(this.gl, this.gl.VERTEX_SHADER, source); }

  createFragmentShader(source) { return this.constructor.createShader(this.gl, this.gl.FRAGMENT_SHADER, source); }

  /**
   * Create a WebGL shader program.
   * @param {WebGL2RenderingContext} gl
   * @param {WebGL2Shader} vertexShader
   * @param {WebGL2Shader} fragmentShader
   * @returns {WebGLProgram|undefined}
   */
  createProgram(vertexShader, fragmentShader) {
    const program = this.constructor.createProgram(this.gl, vertexShader, fragmentShader);
    this.program = program;
    return program;
  }

  static createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (success) return program;

    // Record the error.
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return undefined;
  }

  /**
   * Create a WebGL program from vertex and fragment files.
   * @param {string} vertexFileName
   * @param {string} fragmentFileName
   * @param {object} [params]           For interpolation
   * @returns {WebGLProgram|undefined}
   */
  async createProgramFromFiles(shaderFile, fragmentFile, params = {}) {
    const vertexShaderSource = await this.constructor.sourceFromGLSLFile("obstacle_vertex", params)
    const fragmentShaderSource = await this.constructor.sourceFromGLSLFile("obstacle_fragment", params)
    const vertexShader = this.createVertexShader(vertexShaderSource);
    const fragmentShader = this.createFragmentShader(fragmentShaderSource);
    return this.createProgram(vertexShader, fragmentShader);
  }

  /**
   * Bind a framebuffer and set the width/height for the framebuffer.
   * @param {WebGLFramebuffer} fb
   * @param {number} [width]
   * @param {number} [height]
   */
  bindFramebufferAndSetViewport(fb, width, height) { this.constructor.bindFramebufferAndSetViewport(this.gl, fb, width, height); }

  static bindFramebufferAndSetViewport(gl, fb, width, height) {
    width ??= gl.canvas.width;
    height ??= gl.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, width, height);
  }

  /**
   * Create a WebGL texture and set its parameters.
   * Binds the texture to gl.TEXTURE_2D.
   * See https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texParameter
   * Adapted from https://webgl2fundamentals.org/webgl/lessons/webgl-image-processing-continued.html
   * @param {object} params       Passed to gl.texParameteri
   * @param {GLint} [params[gl.TEXTURE_WRAP_S]=gl.CLAMP_TO_EDGE]
   * @param {GLint} [params[gl.TEXTURE_WRAP_T]=gl.CLAMP_TO_EDGE]
   * @param {GLint} [params[gl.TEXTURE_MIN_FILTER]=gl.LINEAR]
   * @param {GLint} [params[gl.TEXTURE_MAG_FILTER]=gl.LINEAR]
   * @returns {WebGLTexture}
   */
  createAndSetupTexture(params = {}) {
    const gl = this.gl;

    // Set defaults.
    params[gl.TEXTURE_WRAP_S] ??= gl.CLAMP_TO_EDGE;
    params[gl.TEXTURE_WRAP_T] ??= gl.CLAMP_TO_EDGE;
    params[gl.TEXTURE_MIN_FILTER] ??= gl.NEAREST;
    params[gl.TEXTURE_MAG_FILTER] ??= gl.NEAREST;

    // Create and bind texture.
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Set provided parameters.
    for ( const [pname, param] of Object.entries(params) ) {
      gl.texParameteri(gl.TEXTURE_2D, pname, param);
    }
    return texture;
  }

  /**
   * Format a texture.
   * Assumes that the texture is already bound using gl.bindTexture, e.g., by calling createAndSetupTexture.
   * Adapted from https://webgl2fundamentals.org/webgl/lessons/webgl-image-processing-continued.html
   * See https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D
   * @param {WebGL2RenderingContext} gl
   * @param {object} [opts]
   * @param {number} [opts.mipLevel=0]                  The largest mip
   * @param {GLint} [opts.internalFormat=gl.RGBA]       Format in the texture
   * @param {GLint} [opts.srcFormat=gl.RGBA]            Format of the data being supplied
   * @param {GLint} [opts.srcType=gl.UNSIGNED_BYTE]     Type of data being supplied
   * @param {TypedArray|ImageBitmap|null} [opts.data]   Data to be uploaded to the texture
   */
  formatTexture({ mipLevel, internalFormat, srcFormat, srcType, data, width, height } = {}) {
    const gl = this.gl;
    mipLevel ??= 0;
    internalFormat ??= gl.RGBA
    srcFormat ??= gl.RGBA;
    srcType ??= gl.UNSIGNED_BYTE;
    data ??= null;
    if ( typeof width === "undefined" ) {
      gl.texImage2D(gl.TEXTURE_2D, mipLevel, internalFormat, srcFormat, srcType, data);
      return;
    }
    const border = 0;
    height ??= width;
    gl.texImage2D(gl.TEXTURE_2D, mipLevel, internalFormat, width, height, border, srcFormat, srcType, data);
  }

  attributes = {};

  /**
   * Add an attribute.
   * See https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer
   * @param {string} attribName
   * @param {WebGLProgram} program
   * @param {object} [opts]
   * @param {number} [opts.size=1]         Attribute length (between 1 and 4)
   * @param {glType} [opts.type=gl.FLOAT]  Type of the attribute
   * @param {number} [opts.stride]         In bytes
   * @param {number} [opts.offset]         In bytes
   * @param {boolean} [opts.normalize=false]
   */
  addAttribute(attribName, { size = 1, type, stride, offset, normalize = false } = {}) {
    const gl = this.gl;
    type ??= gl.FLOAT;
    const loc = gl.getAttribLocation(this.program, attribName);
    this.attributes[attribName] = { loc, size, type, normalize, stride, offset };

    // gl.vertexAttribPointer(loc, size, type, normalize, stride, offset);
  }

  /**
   * Creates the vertex array object and sets atributes on it.
   * Binds the index buffer as well.
   */
  createVAOAndSetAttributes() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    this.bindVAO();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    this._setAttributes();
    if ( this.indexBuffer ) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
    this.unbindVAO(); // Otherwise changes to ELEMENT_ARRAY_BUFFER will mess this up.
  }

  _setAttributes() {
    const gl = this.gl;
    for ( const params of Object.values(this.attributes) ) gl.vertexAttribPointer(...Object.values(params));
  }

  vertexBuffer;

  /**
   * Add a vertex buffer.
   * @param {Float32Array} arr
   * @param {glInt} [drawType=gl.STATIC_DRAW]     Or gl.DYNAMIC_DRAW
   */
  addVertexBuffer(arr, drawType) {
    const gl = this.gl;
    drawType ??= gl.STATIC_DRAW;
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, arr, drawType);
  }

  indexBuffer;

  /**
   * Add an index buffer.
   * @param {Uint16Array|Uint32Array} arr
   * @param {glInt} [drawType=gl.STATIC_DRAW]     Or gl.DYNAMIC_DRAW
   */
  addIndexBuffer(arr, drawType) {
    const gl = this.gl;
    drawType ??= gl.STATIC_DRAW;
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, drawType);
  }

 /**
  * Set the vertex buffer for drawing.
  */
 setVertexBuffer() { this.gl.bindVertexArray(this.gl.ARRAY_BUFFER, this.vertexBuffer); }

 /**
  * Add a uniform.
  * @param {string} uniformName
  * @param {Array|TypedArray|number} data
  * @param {string} type              E.g., "mat4", "uvec2", "sampler2D"
  */
 setUniform(uniformName, type, ...data) {
   // TODO: Could determine most types from data. Easier if data is a TypedArray.
   // Or could use gl.uniform(program, loc) to get the data. Likely slower.
   // TODO: get typeMethod from type string
   const gl = this.gl;
   const loc = gl.getUniformLocation(this.program, uniformName);
   if ( Array.isArray(data[0]) || isTypedArray(data[0]) ) data = data[0];

   if ( type.startsWith("mat") ) {
     const numLabel = type.slice(3);
     const transpose = false;
     return gl[`uniformMatrix${numLabel}fv`](loc, transpose, data);
   } else if ( type.startsWith("sampler") ) return gl.uniform1iv(loc, data);

   // float, int, uint, bool, or ivec[n], bvec[n], uvec[n], vec[n]
   const n = data.length;
   const startValue = type.slice(0, 1);
   switch ( startValue ) {
     case "b":
     case "u": return gl[`uniform${n}uv`](loc, data);
     case "i": return gl[`uniform${n}iv`](loc, data);
     case "f": // float
     case "v": return gl[`uniform${n}fv`](loc, data);
   }
   console.error(`addUniform|Uniform type ${type} unknown.`);
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
    console.table([
      { label: "sum", r: acc[0], g: acc[1], b: acc[2], a: acc[3] },
      { label: "count", r: acc[4], g: acc[5], b: acc[6], a: acc[7] },
      { label: "zeroes", r: acc[8], g: acc[9], b: acc[10], a: acc[11] },
      { label: "min", r: min[0], g: min[1], b: min[2], a: min[3] },
      { label: "max", r: max[0], g: max[1], b: max[2], a: max[3] }
    ])
  }

  /**
   * Extract pixel data from the current gl framebuffer.
   * See https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/readPixels
   * @param {WebGL2RenderingContext} gl
   * @param {TypedArray} data                 Array to store the sta
   * @param {object} [opts]
   * @param {number} [opts.x=0]
   * @param {number} [opts.y=0]
   * @param {number} [opts.width]   Defaults to gl.canvas.width
   * @param {number} [opts.height]  Defaults to gl.canvas.height
   * @param {GLenum} [opts.format=gl.RGBA]          Format of the pixel data
   * @param {GLenum} [opts.type=gl.UNSIGNED_BYTE]   Data type of the pixel data
   * @param {number} [opts.dstOffset=0]             Offset
   * @returns {object}
   * - @prop {number} x
   * - @prop {number} y
   * - @prop {number} width
   * - @prop {number} height
   * - @prop {TypedArray} pixels
   */
  extractPixelData(data, { x = 0, y = 0, width, height, dstOffset = 0, format, type  } = {}) {
    const gl = this.gl;
    width ??= gl.canvas.width;
    height ??= gl.canvas.height;
    format ??= gl.RGBA;
    type ??= gl.UNSIGNED_BYTE;
    const readbackSize = width * height * 4;   // TODO: Change based on format.
    const pixels = new Uint8Array(readbackSize); // TODO: Change based on type.
    gl.readPixels(x, y, width, height, format, type, pixels, dstOffset);
    return { pixels, x, y, width, height };
  }

  /** @type {Array(4)} */
  clearColor = [0, 0, 0, 0];

  /**
   * Clear the draw.
   */
  clearDraw() {
    const gl = this.gl;
    gl.clearColor(...this.clearColor);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /**
   * Draw elements for triangles.
   * @param {number} count
   * @param {number} [offset=0]
   */
  draw(count, offset = 0) { this.constructor.draw(this.gl, count, offset); }

  static draw(gl, count, offset = 0) {
    const primitiveType = gl.TRIANGLES;
    const indexType = gl.UNSIGNED_SHORT;
    gl.drawElements(primitiveType, count, indexType, offset);
  }

  /**
   * Draw for only the specified instances.
   * @param {Set<number>|number[]} instanceSet           Set of positive integers, including 0.
   * @param {object} offsetData                           Offset data from GeometryDesc.computeBufferOffsets
   */
  drawSet(instanceSet, offsetData) { this.constructor.drawSet(this.gl, instanceSet, offsetData); }

  static drawSet(gl, instanceSet, offsetData) {
    if ( !(instanceSet.size || instanceSet.length) ) return;

    // For a consecutive group, draw all at once.
    // So if 0–5, 7–9, 12, should result in 3 draw calls.
    if ( instanceSet instanceof Set ) instanceSet = [...instanceSet.values()];
    instanceSet.sort((a, b) => a - b);

    // Handle either instances all same number of vertices or different number.
    const instanceLength = Number.isNumeric(offsetData.index.lengths) ? offsetData.index.lengths : 0;

    for ( let i = 0, iMax = instanceSet.length; i < iMax; i += 1 ) {
      const firstInstance = instanceSet[i];
      // Count the number of consecutive instances.
      let instanceCount = 1;
      while ( instanceSet[i + 1] === instanceSet[i] + 1 ) { instanceCount += 1; i += 1; }

      // Pull the offset and count from the offsetData.
      const offset = offsetData.index.offsets[firstInstance];
      const count = instanceLength || sumArray(offsetData.index.lengths.slice(firstInstance, firstInstance + instanceCount));
      console.debug(`Drawing ${count} vertices with offset ${offset}; firstInstance at ${firstInstance}; represents ${instanceCount} instances`, new Set([...instanceSet.values()]));
      this.draw(gl, count, offset);
    }
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

export class RenderObstaclesAbstractPIXI {
  /** @type {class} */
  static drawableClasses = [];

  /** @type {Camera} */
  camera = new Camera();

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize(opts) {
    this.drawableObjects.forEach(drawableObject => drawableObject.destroy());
    this.drawableObjects.length = 0;
    // const device = await this.getDevice();
    // this.materials = new MaterialsTracker(device);
    await this._initializeDrawObjects(opts);
    this._allocateRenderTargets();
    this.prerender();
  }

  /**
   * Define one ore more DrawObjects used to render the scene.
   */
  async _initializeDrawObjects(opts) {
    const device = this.device;
    const materials = this.materials;
    this._createCameraBindGroup();

    const senseType = this.senseType;
    const promises = [];
    for ( const cl of this.constructor.drawableClasses ) {
      const drawableObj = new cl(device, materials, this.camera, { senseType });
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

  /**
   * Render the scene to a RenderTexture.
   */
  render(viewerLocation, target, { viewer, targetLocation, targetOnly = false } = {}) {
    const opts = { viewer, target, targetOnly };
    const device = this.device;
    this._setCamera(viewerLocation, target, { viewer, targetLocation });
    // const visionTriangle = targetOnly ? null : VisionTriangle.build(viewerLocation, target);



    return this.device.queue.onSubmittedWorkDone();
  }
}


export class DrawableWallInstancesPIXI {

  static vertexShaderFile = "wall_vertex";

  static fragmentShaderFile = "wall_fragment";

  /** @type {Camera} */
  camera;

  /** @type {TypedArray[]} */
  buffers = {};

  constructor(camera, { senseType = "sight" } = {}) {
    this.camera = camera;
    this.senseType = senseType;
    this.placeableHandler = new this.constructor.handlerClass(this.senseType);
  }

  /** @type {boolean} */
  #debugViewNormals = false;

  get debugViewNormals() { return this.#debugViewNormals; }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize({ debugViewNormals = false } = {}) {
    this.#debugViewNormals = debugViewNormals;


    // Define shader and geometry.
    const { vertexSource, fragmentSource } = await this._getShaderSources();
    this._createShader(vertexSource, fragmentSource);



    this.module = await WebGPUShader.fromGLSLFile(device, this.constructor.shaderFile, `${this.constructor.name} Shader`, { debugViewNormals });
    this._setRenderPipelineOpts();
    this.pipeline = device.createRenderPipeline(this.RENDER_PIPELINE_OPTS);

    // Create static buffers.
    this._createStaticGeometries();
    this._createStaticDrawables();
    this._setStaticGeometriesBuffers();

    // Initialize the changeable buffers.
    this.initializePlaceableBuffers();
  }

  async _getShaderSources() {
    const vertexSrc = await WebGL2.sourceFromGLSLFile(this.vertexShaderFile);
    const fragmentSrc = await WebGL2.sourceFromGLSLFile(this.fragmentShaderFile);
    return { vertexSrc, fragmentSrc };
  }

  _createShader(vertexSource, fragmentSource) {
    const uniforms = {
      uPerspectiveMatrix: this.camera.perspectiveMatrix,
      uLookAtMatrix: this.camera.lookAtMatrix,
    };
    this.shader = new PIXI.Shader(vertexSource, fragmentSource, uniforms);
  }

  /**
   * Set up part of the render chain dependent on the number of placeables.
   * Called whenever a placeable is added or deleted (but not necessarily just updated).
   * E.g., wall is added.
   */
  initializePlaceableBuffers() {
    const senseType = this.senseType;
    // super.initializePlaceableBuffers()
    this._createInstanceBuffer();
  }

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {
    this.geometries.set("wall", new GeometryWallDesc({ directional: false, addNormals: this.debugViewNormals, addUVs: false }));
    this.geometries.set("wall-dir", new GeometryWallDesc({ directional: true, addNormals: this.debugViewNormals, addUVs: false }));
  }

  /** @type {enum} */
  static INSTANCE_TYPES = {
    NON_DIRECTIONAL: 1,
    DIRECTIONAL: 2,
    NORMAL: 4,
    TERRAIN: 8,
    // ND | NORMAL = 5
    // DIR | NORMAL = 6
    // ND | TERRAIN = 9
    // DIR | TERRAIN = 10
  }

  /**
   * Insert drawables that rarely change into the drawables map.
   */
  _createStaticDrawables() {
    const { NON_DIRECTIONAL, DIRECTIONAL, NORMAL, TERRAIN } = this.constructor.INSTANCE_TYPES;
    this.drawables.set(NON_DIRECTIONAL, {
      label: "Non-directional wall",
      geom: this.geometries.get("wall"),
      instanceSet: new Set(),
      placeableHandler: new NonDirectionalWallInstanceHandler({ senseType }),
    });
    this.drawables.set(DIRECTIONAL, {
      label: "Directional wall",
      geom: this.geometries.get("wall-dir"),
      instanceSet: new Set(),
      placeableHandler: new DirectionalWallInstanceHandler({ senseType }),
    });
  }

  /**
   * Define vertex and index buffers for the static geometries.
   */
  _setStaticGeometriesBuffers() {
    if ( !this.geometries.size ) return;
    for ( const drawable of this.drawables ) {
      drawable.geometry = new PIXI.Geometry();
      drawable.geometry.addAttribute("aPos", drawable.geom.vertexBuffer, 3, false, PIXI.TYPES.FLOAT, 0, 0, false);
      drawable.geometry.addIndex(drawable.geom.indexBuffer);
    }
  }

  /**
   * Define instance attributes and related buffers.
   */
  _createInstanceBuffer() {
    if ( !this.geometries.size ) return;
    for ( const drawable of this.drawables ) {
      drawable.placeableHandler.initializePlaceables();
      drawable.geometry.addAttribute("aiModel", drawable.placeableHandler.instanceArrayBuffer, 16, false, PIXI.TYPES.FLOAT, 0, 0, true);

      // Track whether it is terrain or wall setting
      // (In WebGPU, this would be the material buffer; here pass the type.)
      drawable.typeBuffer = new Uint32Array(drawable.placeableHandler.numInstances);
      drawable.geometry.addAttribute("aiType", drawable.typeBuffer, 1, false, PIXI.TYPES.UNSIGNED_INT, 0, 0, true);

      // Define the mesh for each drawable, used for rendering.
      drawable.mesh = this.constructor.buildMesh(drawable.geometry, this.shader);
    }
  }

  static buildMesh(geometry, shader) {
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.state.depthTest = true;
    mesh.state.culling = true;
    mesh.state.clockwiseFrontFace = false;
    mesh.state.depthMask = true;
    return mesh;
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {}

  /**
   * Render this drawable.
   */
  render() {
    this.drawables.forEach(drawable => this._renderDrawable(drawable));
  }
}

function isTypedArray(obj) {
  return ArrayBuffer.isView(obj) && !(obj instanceof DataView);
}