/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { WebGL2 } from "./WebGL2.js";
import { GeometryNonInstanced, GeometryInstanced } from "../geometry/GeometryDesc.js";

import * as twgl from "./twgl.js";
import { log } from "../util.js";


/**
 * Drawing of a placeable object without instancing.
 */
export class DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass;

  /** @type {class} */
  static geomClass;

  /** @type {string} */
  static vertexFile = "obstacle_vertex_ubo";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment_ubo";

  /** @type {string} */
  static vertexDrawType = "STATIC_DRAW";

  /** @type {boolean} */
  static addUVs = false;

  /** @type {WebGL2} */
  get webGL2() { return this.renderer.webGL2; }

  /** @type {WebGL2RenderingContext} */
  get gl() { return this.renderer.gl; };

  get camera() { return this.renderer.camera; }

  get debugViewNormals() { return this.renderer.debugViewNormals; }

  constructor(renderer) {
    this.renderer = renderer;
  }

  // ----- NOTE: Initialization ----- //

  #initialized = false;

  get initialized() { return this.#initialized; }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize() {
    if ( this.#initialized ) return;
    this.placeableHandler = new this.constructor.handlerClass();
    this.programInfo = await this._createProgram();
    this.placeableHandler.registerPlaceableHooks();
    this._initializePlaceableHandler();
    this._initializeGeoms();
    this._initializeOffsets();
    this._initializeAttributes();
    this._initializeUniforms();

    // Register that we are synced with the current placeable data.
    this.#placeableHandlerBufferId = this.placeableHandler.bufferId;
    this.#placeableHandlerUpdateId = this.placeableHandler.updateId;

    this.#initialized = true;
  }

  // ----- NOTE: Program ----- //

  /** @type {twgl.ProgramInfo} */
  programInfo;

  async _createProgram(opts = {}) {
    // Must include all parameters that could be in the glsl file.
    opts.debugViewNormals ??= this.debugViewNormals;
    opts.isTile ??= false;
    return this.webGL2.cacheProgram(
      this.constructor.vertexFile,
      this.constructor.fragmentFile,
      opts,
    );
  }

  // ----- NOTE: Uniforms ----- //

  _initializeUniforms() {
    this._initializeCameraBuffer();
    this._initializeMaterialBuffer();
  }

  _initializeCameraBuffer() {
    // Set up uniform blocks to use the same binding point.
    const gl = this.gl;
    const program = this.programInfo.program;
    const blockIndex = gl.getUniformBlockIndex(program, "Camera");
    gl.uniformBlockBinding(program, blockIndex, this.renderer.constructor.CAMERA_BIND_POINT);
  }

  _initializeMaterialBuffer() {
    const gl = this.gl;
    const program = this.programInfo.program;
    const blockIndex = gl.getUniformBlockIndex(program, "Material");
    gl.uniformBlockBinding(program, blockIndex, this.renderer.constructor.MATERIAL_BIND_POINT);
  }

  // ----- NOTE: Attributes ----- //

  /** @type {GeometryNonInstanced[]|GeometryNonInstanced} */
  geoms = [];

  /** @type {object} */
  offsetData = {};

  /** @type {ArrayBuffer} */
  verticesBuffer = new ArrayBuffer();

  /** @type {ArrayBuffer} */
  indicesBuffer = new ArrayBuffer();

  /** @type {Float32Array} */
  verticesArray = new Float32Array();

  /** @type {Uint16Array} */
  indicesArray = new Uint16Array();

  /** @type {Float32Array[]} */
  vertices = [];

  /** @type {Uint16Array[]} */
  indices = [];

  /** @type {object} */
  vertexProps = {};

  /** @type {twgl.BufferInfo} */
  attributeBufferInfo = {};

  /** @type {twgl.VertexArrayInfo} */
  vertexArrayInfo = {};

  /**
   * Populate the geoms array.
   * Either define a single geom or define an array.
   */
  _initializeGeoms() {
    console.error("_initializeGeoms must be overriden by child class.");
  }

  _initializeOffsets() {
    this.offsetData = GeometryNonInstanced.computeBufferOffsets(this.geoms);
  }

  _initializeAttributes() {
    this._initializeVertices();
    this.vertexProps = this._defineAttributeProperties();
    this.attributeBufferInfo = twgl.createBufferInfoFromArrays(this.gl, this.vertexProps);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, this.attributeBufferInfo);
  }

  /**
   * Construct data arrays representing vertices and indices.
   */
  _initializeVertices() {
    const offsetData = this.offsetData;
    const numPlaceableIndices = this.placeableHandler.instanceIndexFromId.size;

    // const numPlaceableIndices = Math.max(...this.placeableHandler.placeableFromInstanceIndex.keys()) + 1;
    if ( numPlaceableIndices !== this.geoms.length ) { console.error(`_initializeVertices|Number of placeable indices (${numPlaceableIndices}) and number of geoms (${this.geoms.length}) should match`)}

    // Use one large buffer for the vertices and another for the indices.
    const vClass = this.verticesArray.constructor;
    const iClass = this.indicesArray.constructor;
    this.verticesBuffer = new ArrayBuffer(offsetData.vertex.totalSize);
    this.indicesBuffer = new ArrayBuffer(offsetData.index.totalSize);
    this.verticesArray = new vClass(this.verticesBuffer);
    this.indicesArray = new iClass(this.indicesBuffer);

    // Create distinct views into the vertices and indices buffers, linked to geoms.
    this.vertices = new Array(numPlaceableIndices);
    this.indices = new Array(numPlaceableIndices);
    for ( let i = 0; i < numPlaceableIndices; i += 1 ) {
      const vs = this.vertices[i] = new vClass(this.verticesBuffer, offsetData.vertex.offsets[i], offsetData.vertex.lengths[i]);
      const is = this.indices[i] = new iClass(this.indicesBuffer, offsetData.index.offsets[i], offsetData.index.lengths[i]);

      const geom = this.geoms[i];
      geom.linkModelVertices(vs);
      geom.linkModelIndices(is);
      geom.indexOffset = offsetData.vertex.cumulativeNum[i];
      geom.dirtyModel = true;
      geom.calculateModel();
    }
  }


  /**
   * Build the vertex and index buffers along with any other attributes.
   * @returns {object} The attribute property object passed to twgl.createBufferInfoFromArrays.
   */
  _defineAttributeProperties() {
    // Define a vertex buffer to be shared.
    // https://github.com/greggman/twgl.js/issues/132.
    log (`${this.constructor.name}|_defineAttributeProperties`);
    const gl = this.gl;
    const vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.verticesArray, gl[this.constructor.vertexDrawType]);

    const debugViewNormals = this.debugViewNormals;
    const vertexProps = {
      aPos: {
        numComponents: 3,
        buffer: vBuffer,
        drawType: this.constructor.vertexDrawType,
        stride: this.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3),
        offset: 0,

      },
      indices: this.indicesArray,
    };

    if ( debugViewNormals ) vertexProps.aNorm = {
      numComponents: 3,
      buffer: vBuffer,
      stride: this.verticesArray.BYTES_PER_ELEMENT * 6,
      offset: 3 * this.verticesArray.BYTES_PER_ELEMENT,
    };
    return vertexProps;
  }

  /**
   * Update the vertex data for an instance.
   * @param {number} idx      The placeable index to update
   * @returns {boolean} True if successfully updated; false if array length is off (requiring full rebuild).
   */
  _updateInstanceVertex(idx) {
    const geom = this.geoms[idx];
    geom.dirtyModel = true;
    geom.calculateModel();

    // If the arrays no longer match, that means the model vertices/indices have changed length
    // and so everything must be recalculated.
    return this.indices[idx] === geom.modelIndices && this.vertices[idx] === geom.modelVertices;
  }

  _updateAttributeBuffersForInstance(idx) {
    const gl = this.gl;
    const vBuffer = this.attributeBufferInfo.attribs.aPos.buffer;
    const iBuffer = this.attributeBufferInfo.indices;
    const vOffsets = this.offsetData.vertex.offsets;
    const iOffsets = this.offsetData.index.offsets;

    // See twgl.setAttribInfoBufferFromArray.
    log (`${this.constructor.name}|_updateBuffersForInstance ${idx}`);
    const vOffset = vOffsets[idx];
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vOffset, this.vertices[idx]);

    const iOffset = iOffsets[idx];
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, iOffset, this.indices[idx]);
  }

  // ----- NOTE: Placeable handler ----- //

  /** @type {PlaceableInstanceHandler} */
  placeableHandler;

  /** @type {number} */
  #placeableHandlerUpdateId = 0;

  /** @type {number} */
  #placeableHandlerBufferId = 0;

  /** @type {number} */
  get placeableHandlerUpdateId() { return this.#placeableHandlerUpdateId; }

  /** @type {number} */
  get placeableHandlerBufferId() { return this.#placeableHandlerBufferId; }

  _initializePlaceableHandler() {
    this.placeableHandler.initializePlaceables();
    // Set the ids when initializing the vertices.
    // this.#placeableHandlerUpdateId = this.placeableHandler.updateId;
    // this.#placeableHandlerBufferId = this.placeableHandler.bufferId;
  }

  /**
   * Mark that a rebuild of all instances is necessary.
   * Used to track when a change to a specific instances causes the need to rebuild the entire array.
   */
  #rebuildNeeded = false

  get rebuildNeeded() { return this.#rebuildNeeded; }

  set rebuildNeeded(value) { this.#rebuildNeeded ||= value; }

  /**
   * Check for whether the placeable handler has been updated due to a change in 1+ placeables.
   */
  validateInstances() {
    // Checks for updates for multiple instances but does not rebuild; assumes num instances not changed.
    const placeableHandler = this.placeableHandler;
    if ( this.rebuildNeeded || placeableHandler.bufferId < this.#placeableHandlerBufferId ) return this.updateAllInstances(); // Number of instances changed.
    if ( placeableHandler.updateId <= this.#placeableHandlerUpdateId ) return; // No changes since last update.

    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.#placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      this._updateInstance(idx);
      if ( this.rebuildNeeded ) break; // If _updateInstance set rebuildNeeded to true.
    }
    this.#placeableHandlerUpdateId = placeableHandler.updateId;
    if ( this.rebuildNeeded ) this.updateAllInstances();
  }

  /**
   * Called when a placeable update requires all placeable-specific attributes to be rebuilt.
   */
  updateAllInstances() {
    this._updateAllInstances();
    this.#rebuildNeeded = false;

    // Register that we are synced with the current placeable data.
    this.#placeableHandlerBufferId = this.placeableHandler.bufferId;
    this.#placeableHandlerUpdateId = this.placeableHandler.updateId;
  }

  _updateAllInstances() {
    // TODO: Can we keep some of the original, and call _rebuildAttributes instead?
    this._initializeGeoms();
    this._initializeOffsets();
    this._initializeAttributes();
  }

  _updateInstance(idx) {
    // If vertex array or index array length no longer matches, redo.
    if ( !this._updateInstanceVertex(idx) ) {
      this.rebuildNeeded = true;
      return;
    }
    this._updateAttributeBuffersForInstance(idx);

  }

  // ----- NOTE: Render ----- //

  /** @type {Set<number>} */
  instanceSet = new Set();

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * Camera (viewer/target) are set by the renderer and will not change between now and render.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(_visionTriangle, _opts) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    this.placeableHandler.instanceIndexFromId.values().forEach(idx => instanceSet.add(idx));
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot.
   * Camera (e.g., viewer, target) may still change after prerender
   */
  prerender() {
    this.validateInstances();
  }

  /**
   * Render this drawable.
   */
  render() {
    if ( !this.instanceSet.size ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.attributeBufferInfo);
    // twgl.setBuffersAndAttributes(gl, this.programInfo, this.vertexArrayInfo);
    // twgl.setUniforms(this.programInfo, this.materialUniforms);



    // twgl.bindUniformBlock(gl, this.programInfo, this.renderer.uboInfo.camera);

    log (`${this.constructor.name}|render`);
    if ( CONFIG[MODULE_ID].filterInstances ) this._drawFilteredInstances(this.instanceSet);
    else this._drawUnfilteredInstances();
    gl.bindVertexArray(null);
    // this.gl.flush(); // For debugging
  }

  _drawFilteredInstances(instanceSet) {
    WebGL2.drawSet(this.gl, instanceSet, this.offsetData);
  }

  _drawUnfilteredInstances() {
    const instanceLength = Number.isNumeric(this.offsetData.index.lengths)
        ? this.offsetData.index.lengths : 0;
      WebGL2.draw(this.gl, instanceLength * this.placeableHandler.numInstances);
  }
}

/**
 * Drawing of a placeable object with instancing
 */
export class DrawableObjectsInstancingWebGL2Abstract extends DrawableObjectsWebGL2Abstract {
  /** @type {string} */
  static vertexFile = "instance_vertex_ubo";

  /** @type {class} */
  static geomClass = GeometryInstanced;

  // ----- NOTE: Program ----- //

  /** @type {number} */
  aModelAttribLoc;

  async _createProgram(opts) {
    const programInfo = await super._createProgram(opts);
    this.aModelAttribLoc = this.gl.getAttribLocation(programInfo.program, 'aModel');
    return programInfo;
  }

  // ----- NOTE: Attributes ----- //
  _initializeGeoms(opts = {}) {
    opts.addNormals ??= this.debugViewNormals;
    opts.addUVs ??= false;
    this.geoms = new this.constructor.geomClass(opts);
  }

  _initializeOffsets() {
    this.offsetData = GeometryNonInstanced.computeBufferOffsets((new Array(this.placeableHandler.numInstances)).fill(this.geoms));
  }

  _defineAttributeProperties() {
    const vertexProps = super._defineAttributeProperties();

    // Define the model matrix, which changes 1 per instance.
    vertexProps.aModel = {
      numComponents: 16,
      data: this.placeableHandler.instanceArrayValues,
      drawType: this.gl.DYNAMIC_DRAW,
      // stride: this.placeableHandler.instanceArrayValues.BYTES_PER_ELEMENT * 16,
      offset: 0,
      divisor: 1,
    };
    return vertexProps;
  }

  _initializeVertices() {
    this.verticesArray = this.geoms.vertices;
    this.indicesArray = this.geoms.indices;
  }

  _setVertices() {
    // Handled by _initializeVertices.
  }

  _updateInstanceVertex(_idx) {
    console.error("DrawableObjectsInstancingWebGL2Abstract does not update individual instance vertices.");
  }

  _rebuildModelBuffer() {
    // Update the model attribute with a new buffer.
    const attribs = this.attributeBufferInfo;
    attribs.aModel = twgl.createAttribsFromArray({ aModel: this.vertexProps.aModel });

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
  }

  _updateModelBufferForInstance(idx) {
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;

    // See twgl.setAttribInfoBufferFromArray.
    log (`${this.constructor.name}|_updateBuffersForInstance ${idx}`);
    const mOffset = 4 * 16 * idx;
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, this.placeableHandler.matrices[idx].arr);
  }

  // ----- NOTE: Placeable handler ----- //

  _updateAllInstances() {
    this._rebuildModelBuffer();
  }

  _updateInstance(idx) {
    this._updateModelBufferForInstance(idx);
  }

  // ----- NOTE: Render ----- //

  _drawFilteredInstances(instanceSet) {
    // To draw select instances, modify the buffer offset.
    // const tmp = this.placeableHandler.instanceArrayValues;
    // log(`Buffer size is ${tmp.length} x ${tmp.BYTES_PER_ELEMENT} = ${tmp.byteLength} for ${this.placeableHandler.numInstances} placeables`);
    const nVertices = this.indicesArray.length; // Number of vertices to draw.
    WebGL2.drawInstancedMatrixSet(
      this.gl,
      instanceSet,
      nVertices,
      this.attributeBufferInfo.attribs.aModel,
      this.aModelAttribLoc,
    );
  }

  _drawUnfilteredInstances() {
    // Draw every instance
    const nVertices = this.indicesArray.length; // Number of vertices to draw.
    WebGL2.drawInstanced(this.gl, nVertices, 0, this.placeableHandler.numInstances);
  }
}
