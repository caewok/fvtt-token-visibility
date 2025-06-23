/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { WebGL2 } from "./WebGL2.js";
import { GeometryInstanced } from "../geometry/GeometryDesc.js";
import { VariableLengthAbstractBuffer } from "../placeable_tracking/TrackingBuffer.js";
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
    this.placeableTracker ??= new this.constructor.handlerClass();
    this.programInfo = await this._createProgram();
    this.placeableTracker.registerPlaceableHooks();
    this._initializePlaceableHandler();
    this._initializeGeoms();
    this._initializeOffsetTrackers();
    this._initializeAttributes();
    this._initializeUniforms();
    this._updateAllVertices();

    // Register that we are synced with the current placeable data.
    this.#placeableTrackerBufferId = this.placeableTracker.bufferId;
    this.#placeableTrackerUpdateId = this.placeableTracker.updateId;

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

  /** @type {Map<string, GeometryNonInstanced>} */
  geoms = new Map();

  /** @type {object} */
  offsetData = {};

  trackers = {
    indices: null,
    vertices: null,
  };

  buffers = {
    indices: null,
    vertices: null,
  };

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

  _initializeOffsetTrackers() {
    this.trackers.indices = new VariableLengthAbstractBuffer({ type: Uint16Array });
    this.trackers.vertices = new VariableLengthAbstractBuffer({ type: Float32Array });
    for ( const geom of this.geoms ) {
      this.trackers.indices.addFacet({ id: geom.id, facetLength: geom.indices.length });
      this.trackers.vertices.addFacet({ id: geom.id, facetLength: geom.vertices.length });
    }
    // this.offsetData = GeometryNonInstanced.computeBufferOffsets(this.geoms);
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
  _updateAllVertices() {
    const { indices, vertices } = this.trackers;
    const ph = this.placeableTracker;

    // Remove missing/deleted ids from the trackers.
    // Can assume id set is same in indices and vertices.
    for ( const id of indices.facetIdMap.keys() ) {
      if ( ph.instanceIndexFromId.has(id) ) continue;
      indices.deleteFacet(id);
      vertices.deleteFacet(id);
    }

    // Update the geometry and rebuild the trackers.
    // TODO: Can this be done elsewhere to avoid updating all geometry here?
    for ( const [id, geom] of this.geoms.entries() ) {
      geom.calculateModel();
      indices.updateFacet(id, { newValues: geom.modelIndices });
      vertices.updateFacet(id, { newValues: geom.modelVertices });
    }

    // Copy to JS buffer first to avoid calling bufferSubData repeatedly.
    const iArrayBuffer = new ArrayBuffer(indices.arraySize);
    const vArrayBuffer = new ArrayBuffer(vertices.arraySize);
    for ( const [id, geom] of this.geoms.entries() ) {
      // Update the index numbers based on the location in the index and update the geometry.
      geom.indices.offset = indices.facetOffsetAtId(id);

      // Copy the index data to the temporary JS buffer.
      const iView = indices.viewFacetById(iArrayBuffer, id);
      iView.set(geom.modelIndices);

      // Copy the vertex data to the temporary JS buffer.
      const vView = vertices.viewFacetById(vArrayBuffer, id);
      vView.set(geom.modelVertices);
    }

    // Redo the GPU buffers, whose size may have changed.
    const gl = this.gl;
    const iWebGLBuffer = this.buffers.indices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, iWebGLBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, indices.viewBuffer(iArrayBuffer), gl[this.constructor.vertexDrawType]);

    const vWebGLBuffer = this.buffers.vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vWebGLBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices.viewBuffer(vArrayBuffer), gl[this.constructor.vertexDrawType]);

    this.vertexProps.aPos.buffer = this.buffers.vertices;
    this.vertexProps.indices.buffer = this.buffers.indices;
    if ( this.debugViewNormals ) this.vertexProps.aNorm.buffer = this.buffers.vertices;
  }

  /**
   * Build the vertex and index buffers along with any other attributes.
   * @returns {object} The attribute property object passed to twgl.createBufferInfoFromArrays.
   */
  _defineAttributeProperties() {
    // Define a vertex buffer to be shared.
    // https://github.com/greggman/twgl.js/issues/132.
    log (`${this.constructor.name}|_defineAttributeProperties`);
    const vSize = this.trackers.vertices.type.BYTES_PER_ELEMENT;
    const debugViewNormals = this.debugViewNormals;
    const vertexProps = {
      aPos: {
        numComponents: 3,
        buffer: this.buffers.vertices,
        drawType: this.constructor.vertexDrawType,
        stride: vSize * (debugViewNormals ? 6 : 3),
        offset: 0,
      },
      indices: {
        buffer: this.buffers.indices,
      },
    };

    if ( debugViewNormals ) vertexProps.aNorm = {
      numComponents: 3,
      buffer: this.buffers.vertices,
      stride: vSize * 6,
      offset: 3 * vSize,
    };
    return vertexProps;
  }

  /**
   * Update the vertex data for an instance.
   * @param {number} id      The id of the placeable update
   * @returns {boolean} True if successfully updated; false if array length is off (requiring full rebuild).
   */
  _updateInstanceVertex(id) {
    const geom = this.geoms.get(id);
    geom.dirtyModel = true;
    geom.calculateModel();

    const { indices, vertices } = this.trackers;
    let needFullBufferUpdate = vertices.updateFacet(id, { newValues: geom.modelVertices });
    needFullBufferUpdate = indices.updateFacet(id, { newValues: geom.modelIndices }) || needFullBufferUpdate; // Note order so the updateFacet will be triggered.
    geom.indices.offset = indices.facetOffsetAtId(id);
    return needFullBufferUpdate;
  }

  _updateAttributeBuffersForPlaceableId(id) {
    const gl = this.gl;
    const { vertices: vBuffer, indices: iBuffer } = this.buffers;
    const { vertices, indices } = this.trackers;
    const geom = this.geoms.get(id);

    // See twgl.setAttribInfoBufferFromArray.
    log (`${this.constructor.name}|_updateAttributeBuffersForPlaceableId ${id}`);
    const vOffset = vertices.facetOffsetAtId(id);
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vOffset, geom.modelVertices);

    const iOffset = indices.facetOffsetAt(id);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, iOffset, geom.modelIndices);
  }

  // ----- NOTE: Placeable handler ----- //

  /** @type {PlaceableInstanceHandler} */
  placeableTracker;

  /** @type {number} */
  #placeableTrackerUpdateId = 0;

  /** @type {number} */
  #placeableTrackerBufferId = 0;

  /** @type {number} */
  get placeableTrackerUpdateId() { return this.#placeableTrackerUpdateId; }

  /** @type {number} */
  get placeableTrackerBufferId() { return this.#placeableTrackerBufferId; }

  _initializePlaceableHandler() {
    this.placeableTracker.initializePlaceables();
    // Set the ids when initializing the vertices.
    // this.#placeableTrackerUpdateId = this.placeableTracker.updateId;
    // this.#placeableTrackerBufferId = this.placeableTracker.bufferId;
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
    const placeableTracker = this.placeableTracker;
    if ( this.rebuildNeeded || placeableTracker.bufferId < this.#placeableTrackerBufferId ) return this.updateAllInstances(); // Number of instances changed.
    if ( placeableTracker.updateId <= this.#placeableTrackerUpdateId ) return; // No changes since last update.

    for ( const [placeable, lastUpdate] of placeableTracker.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.#placeableTrackerUpdateId ) continue; // No changes for this instance since last update.
      this._updateInstance(placeable);
      if ( this.rebuildNeeded ) break; // If _updateInstance set rebuildNeeded to true.
    }
    this.#placeableTrackerUpdateId = placeableTracker.updateId;
    if ( this.rebuildNeeded ) this.updateAllInstances();
  }

  /**
   * Called when a placeable update requires all placeable-specific attributes to be rebuilt.
   */
  updateAllInstances() {
    this._updateAllInstances();
    this.#rebuildNeeded = false;

    // Register that we are synced with the current placeable data.
    this.#placeableTrackerBufferId = this.placeableTracker.bufferId;
    this.#placeableTrackerUpdateId = this.placeableTracker.updateId;
  }

  _updateAllInstances() {
    // TODO: Can we keep some of the original, and call _rebuildAttributes instead?
//     this._initializeGeoms();
//     this._initializeOffsetTrackers();
//     this._initializeAttributes();

    this._updateAllVertices();
  }

  _updateInstance(placeable) {
    // If vertex array or index array length no longer matches, redo.
    if ( !this._updateInstanceVertex(placeable) ) {
      this.rebuildNeeded = true;
      return;
    }
    this._updateAttributeBuffersForPlaceableId(placeable);

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
    this.instanceSet.clear();
    this.placeableTracker.placeables.forEach(p => {
      const idx = this.trackers.indices.facetIdMap.get(p.id);
      this.instanceSet.add(idx);
    });
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot.
   * Camera (e.g., viewer, target) may still change after prerender
   */
  prerender() { this.validateInstances(); }

  /**
   * Render this drawable.
   */
  render() {
    if ( !this.instanceSet.size ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.attributeBufferInfo);
    log (`${this.constructor.name}|render`);
    if ( CONFIG[MODULE_ID].filterInstances ) this._drawFilteredInstances();
    else this._drawUnfilteredInstances();
    gl.bindVertexArray(null);
    // this.gl.flush(); // For debugging
  }

  _drawFilteredInstances() {
    const { facetLength, facetLengths, byteOffsets } = this.indices.tracker;
    WebGL2.drawSet(this.gl, this.instanceSet, facetLength || facetLengths, byteOffsets);
  }

  _drawUnfilteredInstances() {
    const n = this.tracker.indices.arrayLength;
    WebGL2.draw(this.gl, n);
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

  static MODEL_MATRIX_LENGTH = 16;

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

  _initializeOffsetTrackers() {
    // Unused for instances.

    // this.offsetData = GeometryNonInstanced.computeBufferOffsets((new Array(this.placeableTracker.numInstances)).fill(this.geoms));
  }

  _defineAttributeProperties() {
    const vertexProps = super._defineAttributeProperties();

    // Define the model matrix, which changes 1 per instance.
    vertexProps.aModel = {
      numComponents: this.constructor.MODEL_MATRIX_LENGTH,
      data: this.placeableTracker.tracker.buffer,
      drawType: this.gl.DYNAMIC_DRAW,
      // stride: Float32Array.BYTES_PER_ELEMENT * 16,
      // stride: this.placeableTracker.instanceArrayValues.BYTES_PER_ELEMENT * 16,
      offset: 0,
      divisor: 1,
    };
    return vertexProps;
  }

  _initializeVertices() { return; }

  _setVertices() { return; }

  _updateInstanceVertex(_placeable) {
    console.error("DrawableObjectsInstancingWebGL2Abstract does not update individual instance vertices.");
  }

  _rebuildModelBuffer() {
    // Update the model attribute with a new buffer.
    const attribs = this.attributeBufferInfo;
    attribs.aModel = twgl.createAttribsFromArray({ aModel: this.vertexProps.aModel });

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
  }

  _updateModelBufferForInstance(placeable) {
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;

    // See twgl.setAttribInfoBufferFromArray.
    log (`${this.constructor.name}|_updateModelBufferForInstance ${placeable.id}`);
    const tracker = this.placeable.tracker;
    const mOffset = tracker.facetOffsetAtId(placeable.id) * tracker.type.BYTES_PER_ELEMENT;
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, tracker.viewFacetById(placeable.id));
  }

  // ----- NOTE: Placeable handler ----- //

  _updateAllInstances() {
    this._rebuildModelBuffer();
  }

  _updateInstance(placeable) {
    this._updateModelBufferForInstance(placeable);
  }

  // ----- NOTE: Render ----- //

  _drawFilteredInstances() {
    // To draw select instances, modify the buffer offset.
    // const tmp = this.placeableTracker.instanceArrayValues;
    // log(`Buffer size is ${tmp.length} x ${tmp.BYTES_PER_ELEMENT} = ${tmp.byteLength} for ${this.placeableTracker.numInstances} placeables`);
    const nVertices = this.geoms.indices.length; // Number of vertices to draw.
    WebGL2.drawInstancedMatrixSet(
      this.gl,
      this.instanceSet,
      nVertices,
      this.attributeBufferInfo.attribs.aModel,
      this.aModelAttribLoc,
    );
  }

  _drawUnfilteredInstances() {
    // Draw every instance
    const n = this.tracker.indices.arrayLength;
    const nVertices = this.geoms.indices.length; // Number of vertices to draw.
    WebGL2.drawInstanced(this.gl, nVertices, 0, n);
  }
}
