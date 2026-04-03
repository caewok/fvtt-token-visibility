/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { WebGL2 } from "./WebGL2.js";
import { VerticesIndicesTrackingBuffer } from "../../geometry/placeable_tracking/TrackingBuffer.js";
import { MatrixFloat32 } from "../../geometry/Matrix.js";
import * as twgl from "./twgl.js";
import { log } from "../util.js";


/**
 * Drawing of a placeable object without instancing.
 */
export class DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static vertexClass;

  /** @type {string} */
  static vertexFile;

  /** @type {string} */
  static fragmentFile;

  /** @type {string} */
  static vertexDrawType = "STATIC_DRAW";

  /** @type {boolean} */
  static addUVs = false;

  /** @type {WebGL2} */
  get webGL2() { return this.renderer.webGL2; }

  /** @type {WebGL2RenderingContext} */
  get gl() { return this.renderer.gl; };

  // get frustum() { return this.renderer.frustum; }

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
    log(`${this.constructor.name}|initialize`);
    await this._initializeProgram();
    this._initializeUniforms();
    this._initializeOffsetTrackers();

    this._initializePlaceableHandler();
    this._initializeAttributes();
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

  /** @type {object} */
  offsetData = {};

  trackers = { };

  buffers = {
    indices: null,
    vertices: null,
  };

  /** @type {Float32Array} */
  get verticesArray() { return this.trackers.vi.vertices.viewBuffer(); }

  /** @type {Uint16Array} */
  get indicesArray() {
    // See VerticesIndicesTrackingBuffer#viewBuffer.
    const vi = this.trackers.vi;
    return vi.indices.viewBuffer(vi.indicesAdjBuffer);
  }

  /** @type {object} */
  vertexProps = {};

  /** @type {twgl.BufferInfo} */
  attributeBufferInfo = {};

  /** @type {twgl.VertexArrayInfo} */
  vertexArrayInfo = {};

  async _initializeProgram() {
    this.programInfo = await this._createProgram();
  }

  get stride() {
    return 3 + (this.debugViewNormals * 3) + (this.constructor.addUVs * 2);
  }

  _initializeOffsetTrackers() { }

  _initializeAttributes() {
    this.vertexProps = this._defineAttributeProperties();
    log(`${this.constructor.name}|_initializeAttributes`, { aModel: this.vertexProps.aModel?.data, indices: this.vertexProps.indices })

    this.attributeBufferInfo = twgl.createBufferInfoFromArrays(this.gl, this.vertexProps);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, this.attributeBufferInfo);
  }

  /**
   * Build the vertex and index buffers along with any other attributes.
   * @returns {object} The attribute property object passed to twgl.createBufferInfoFromArrays.
   */
  _defineAttributeProperties() {
    // Define a vertex buffer to be shared.
    // https://github.com/greggman/twgl.js/issues/132.
    const gl = this.gl;
    const vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    log (`${this.constructor.name}|_defineAttributeProperties`, { vertices: this.verticesArray });
    gl.bufferData(gl.ARRAY_BUFFER, this.verticesArray, gl[this.constructor.vertexDrawType]);

    const stride = this.stride * Float32Array.BYTES_PER_ELEMENT;
    const vertexProps = {
      aPos: {
        numComponents: 3,
        buffer: vBuffer,
        drawType: this.constructor.vertexDrawType,
        stride,
        offset: 0,
      },
      indices: this.indicesArray,
    };

    if ( this.debugViewNormals ) vertexProps.aNorm = {
      numComponents: 3,
      buffer: vBuffer,
      stride,
      offset: Float32Array.BYTES_PER_ELEMENT * 3,
    };

    if ( this.constructor.addUVs ) vertexProps.aUV = {
      numComponents: 2,
      buffer: vBuffer,
      stride,
      offset: Float32Array.BYTES_PER_ELEMENT * (this.debugViewNormals ? 6 : 3),
    }

    // this.bufferSizes.vertices = this.verticesArray.byteLength;
    // this.bufferSizes.indices = this.indicesArray.byteLength;

    return vertexProps;
  }

  _updateAttributeBuffersForId(id) {}

  // ----- NOTE: Placeable handler ----- //

  get placeables() { return console.error("DrawableObjectsWebGL2Abstract|getPlaceables must be defined by child class."); }

  /**
   * Track when each placeable was last updated.
   * @type {Map<PlaceableObject, number>}
   */
  placeableLastUpdated = new WeakMap();

  getPlaceableFromId(id) {
    // const suffix = ".preview$";
    // const escapedSuffix = suffix.replace(/\./g, "\\.");
    // const regex = new RegExp(escapedSuffix);
    const isPreview = id.endsWith(".preview");
    const regexSuffix = /\.preview$/;
    id = id.replace(regexSuffix, "");

    // const regexPrefix = /^.*\./ // Drop prefixes like Wall., Region., etc.
    const regexPrefix = /^(Wall|Region|Token|Tile)\./;
    id = id.replace(regexPrefix, "");

    const doc = canvas[this.constructor.layer].documentCollection.get(id);
    if ( !doc ) return null;
    return isPreview ? (doc.object._preview ?? doc.object) : doc.object;
  }

  hasPlaceable(placeable) { return this.placeableLastUpdated.has(placeable); }

  _initializePlaceableHandler() {
    for ( const placeable of this.placeables ) {
      const obj = placeable[MODULE_ID] || {};
      this.placeableLastUpdated.set(placeable, obj.updateId || 0);
    }
  }

  /**
   * Mark that a rebuild of all instances is necessary.
   * Used to track when a change to a specific instances causes the need to rebuild the entire array.
   */
  #rebuildNeeded = true;

  get rebuildNeeded() { return this.#rebuildNeeded; }

  set rebuildNeeded(value) { this.#rebuildNeeded ||= value; }

  /**
   * Check for whether the placeable handler has been updated due to a change in 1+ placeables.
   */
  validateInstances() {
    log(`${this.constructor.name}|validateInstances`);
    if ( this.rebuildNeeded ) return this.updateAllPlaceableData();

    // Checks for updates for multiple instances but does not rebuild; assumes num instances not changed.
    const placeables = this.filterObjects(this.placeables);
    for ( const placeable of placeables ) {
      const updateId = this.placeableLastUpdated.get(placeable);
      if ( typeof updateId === "undefined" ) return this.updateAllPlaceableData(); // Missing a placeable in the map.

      // Check when the placeable was last updated in the renderer.
      const obj = placeable[MODULE_ID] || {};
      const lastUpdate = obj.updateId || 0;
      if ( lastUpdate <= updateId ) continue; // No changes for this instance since last update.
      if ( !this.updatePlaceableData(placeable) ) return this.updateAllPlaceableData(); // If _updateInstance set rebuildNeeded to true.
      this.placeableLastUpdated.set(placeable, lastUpdate);
    }
  }

  /**
   * Called when a placeable update requires all placeable-specific attributes to be rebuilt.
   */
  updateAllPlaceableData() {
    log(`${this.constructor.name}|updateAllPlaceableData`);
    this._initializePlaceableHandler();
    this._updateAllPlaceableData();
    this.#rebuildNeeded = false;
  }

  _updateAllPlaceableData() { }

  /**
   * Attempt to update a single placeable instance.
   * @param {PlaceableObject} placeable
   * @returns {boolean} True if update was successful; false otherwise.
   */
  updatePlaceableData(placeable) {
    log(`${this.constructor.name}|updatePlaceableData`);
    // If vertex array or index array length no longer matches, redo.
    if ( !this._updatePlaceableData(placeable) ) return false;
    this.updatePlaceableBuffer(placeable);
  }

  _updatePlaceableData(_placeable) { return true; } // Expect to be overridden by subclass.

  updatePlaceableBuffer(placeable) { }

  // ----- NOTE: Render ----- //

  get numObjectsToDraw() { return this.instanceSet.size; }

  /** @type {Set<number>} */
  instanceSet = new Set();

  /**
   * Filter the objects to be rendered.
   * Called after prerender, immediately prior to rendering.
   * @param {PlaceableObject[]} placeables      Placeable objects to be drawn
   * @returns {PlaceableObject[]} Objects that can be rendered by this drawable.
   */
  filterObjects(placeables) {
    return placeables.filter(placeable => this.hasPlaceable(placeable));
  }

  /**
   * Clear previous instances to be drawn.
   */
  clearInstances() { this.instanceSet.clear(); }

  /**
   * Add a specific placeable to the set of placeables to draw.
   */
  addPlaceableToInstanceSet(placeable) {
    const idx = this._indexForPlaceable(placeable);
    this.instanceSet.add(idx);
  }

  // Pull from the index for the indices.
  _indexForPlaceable(placeable) { return this.trackers.vi.indices.facetIdMap.get(placeable.sourceId); }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot.
   * Camera (e.g., viewer, target) may still change after prerender
   */
  prerender() {
    log(`${this.constructor.name}|prerender`);
    this.validateInstances();
  }

  /**
   * Render this drawable.
   */
  render() {
    if ( !this.numObjectsToDraw ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.attributeBufferInfo);
    log(`${this.constructor.name}|render`);
    if ( CONFIG[MODULE_ID].filterInstances ) this._drawFilteredInstances(this.instanceSet);
    else this._drawUnfilteredInstances();
    gl.bindVertexArray(null);
    this.gl.finish(); // For debugging
  }

  _drawFilteredInstances(instanceSet) {
    // Debug: what model are we rendering?
    // Debug: what model are we rendering?
    if ( CONFIG[MODULE_ID].debug ) {
      for ( const i of instanceSet ) {
        const { vertices, indices, indicesAdj } = this.trackers.vi.viewFacetAtIndex(i);
        log(`${this.constructor.name}|_drawFilteredInstances|${i}`);
        console.table({ vertices: [...vertices], indices: [...indices], indicesAdj: [...indicesAdj] });
      }
    }

    const { facetLength, facetLengths, byteOffsets } = this.trackers.vi.indices;
    WebGL2.drawSet(this.gl, instanceSet, byteOffsets, facetLength || facetLengths);
  }

  _drawUnfilteredInstances() {
    const n = this.trackers.vi.numFacets;

    // Debug: what model are we rendering?
    if ( CONFIG[MODULE_ID].debug ) {
      for ( let i = 0; i < n; i += 1 ) {
        const { vertices, indices, indicesAdj } = this.trackers.vi.viewFacetAtIndex(i);
        log(`${this.constructor.name}|_drawUnfilteredInstances|${i}`);
        console.table({ vertices: [...vertices], indices: [...indices], indicesAdj: [...indicesAdj] });
      }
    }

    WebGL2.draw(this.gl, n);
  }
}

export class DrawableObjectsNonInstancingWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {string} */
  static vertexFile = "obstacle_vertex_ubo";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment_ubo";

  trackers = {
    vi: null,
  };

  vertexDataMap = new Map();

  _initializePlaceableData() {
    this.vertexDataMap.clear();
    const placeables = this.filterObjects(this.placeables);
    for ( const placeable of placeables ) {
      const obj = new this.constructor.vertexClass(placeable);
      this.vertexDataMap.set(placeable.sourceId, obj);
    }
  }

  _initializeOffsetTrackers() {
    // TODO: Use VariableLengthAbstractBuffer and don't copy over the geometry indices and vertices.
    this.trackers.vi = new VerticesIndicesTrackingBuffer({ stride: this.stride });
  }

  _updateAllPlaceableData() {
    this._initializePlaceableData();
    this._initializeOffsetTrackers();
    this._updateAllVertices();
    this._initializeAttributes();
  }

  /**
   * Update the vertex data for a single placeable.
   * @param {number} id      The id of the placeable update
   * @returns {boolean} True if successfully updated; false if array length is off (requiring full rebuild).
   */
  _updatePlaceableData(placeable) {
    const obj = this.vertexDataMap.get(placeable.sourceId);
    if ( !obj ) return false;

    // Obtain the (updated) vertex data.
    const opts = { addNormals: this.debugViewNormals, addUVs: this.constructor.addUVs };
    const vo = obj.calculateModel(opts);

    // Update the vertex tracker and determine if the size of the vertex data changed.
    const vi = this.trackers.vi;
    const expanded = vi.updateFacet(placeable.sourceId, { newVertices: vo.vertices, newIndices: vo.indices });
    return !expanded;
  }

  updatePlaceableBuffer(placeable) { this._updateAttributeBuffersForId(placeable.sourceId); }

  _updateAttributeBuffersForId(id) {
    // See twgl.setAttribInfoBufferFromArray.
    const gl = this.gl;
    const vi = this.trackers.vi;

    // Copy the vertices and adjusted indices to their webGL buffers.
    const { vertices, indicesAdj } = vi.viewFacetById(id);
    if ( !vertices || !indicesAdj ) console.error(`${this.constructor.name}|_updateAttributeBuffersForId|${id} id not found`);
    const vOffset = vi.vertices.facetOffsetAtId(id) * Float32Array.BYTES_PER_ELEMENT;
    const iOffset = vi.indices.facetOffsetAtId(id) * Uint16Array.BYTES_PER_ELEMENT;

    // Vertices.
    const vBuffer = this.attributeBufferInfo.attribs.aPos.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vOffset, vertices);

    // Indices.
    const iBuffer = this.attributeBufferInfo.indices;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, iOffset, indicesAdj);
    log (`${this.constructor.name}|_updateAttributeBuffersForId ${id} with vOffset ${vOffset} and iOffset ${iOffset}`, { vertices, indicesAdj });
  }

  /**
   * Construct and update data arrays representing vertices and indices.
   */
  _updateAllVertices() {
    const vi = this.trackers.vi;

    // Remove missing/deleted ids from the trackers.
    // Assume id is same in indices and vertices.
    for ( const id of vi.indices.facetIdMap.keys() ) {
      const placeable = this.getPlaceableFromId(id);
      if ( this.hasPlaceable(placeable) ) continue;
      vi.deleteFacet(id);
    }

    // Rebuild the trackers.
    const opts = { addNormals: this.debugViewNormals, addUVs: this.constructor.addUVs };
    for ( const [id, vData] of this.vertexDataMap.entries() ) {
      const vo = vData.calculateModel(opts);
      vi.updateFacet(id, { newVertices: vo.vertices, newIndices: vo.indices });
    }
  }

  _drawUnfilteredInstances() {
    const gl = this.gl;
    const nIndices = this.indicesArray.length;
    if ( !nIndices ) return;

    // Debug: what model are we rendering?
    if ( CONFIG[MODULE_ID].debug ) {
      for ( let i = 0; i < n; i += 1 ) {
        const { vertices, indices, indicesAdj } = this.trackers.vi.viewFacetAtIndex(i);
        log(`${this.constructor.name}|_drawUnfilteredInstances|${i}`);
        console.table({ vertices: [...vertices], indices: [...indices], indicesAdj: [...indicesAdj] });
      }
    }

    WebGL2.draw(this.gl, nIndices, gl.UNSIGNED_SHORT, 0);
  }
}

/**
 * Drawing of a placeable object with instancing
 */
export class DrawableObjectsInstancingWebGL2 extends DrawableObjectsWebGL2Abstract {

  /** @type {class} */
  static geomClass;

  /** @type {string} */
  static vertexFile = "instance_vertex_ubo";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment_ubo";

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

  _initializeOffsetTrackers() {
    // Don't need indices or vertices trackers.
    // Model matrices stored in placeable tracker static class.
    this.trackers.model = this.constructor.geomClass.modelMatrixTracker;
  }

  _defineAttributeProperties() {
    const vertexProps = super._defineAttributeProperties();

    // Define the model matrix, which changes 1 per instance.
    const data = this.modelMatrixArray;
    vertexProps.aModel = {
      numComponents: 16,
      data,
      drawType: this.gl.DYNAMIC_DRAW,
      // stride: this.placeableHandler.instanceArrayValues.BYTES_PER_ELEMENT * 16,
      // offset: 0,
      divisor: 1,
    };
    // this.bufferSizes.model = data.byteLength;

    return vertexProps;
  }

  _updateModelProperties() {
    const vertexProps = this.vertexProps;
    vertexProps.aModel.data = this.modelMatrixArray;
  }

  _updateAttributes() {
    this._updateModelProperties();
    this.attributeBufferInfo = twgl.createBufferInfoFromArrays(this.gl, this.vertexProps);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, this.attributeBufferInfo);
  }

  get verticesArray() {
    const vo = this.constructor.vertexClass.getVertexObject({ addNormals: this.debugViewNormals, addUVs: this.constructor.addUVs });
    return vo.vertices;
  }

  get indicesArray() {
    const vo = this.constructor.vertexClass.getVertexObject({ addNormals: this.debugViewNormals, addUVs: this.constructor.addUVs });
    return vo.indices;
  }

  get modelMatrixArray() { return this.trackers.model.viewBuffer(); }

  _rebuildModelBuffer() {
    // Update the model attribute with a new buffer.
    const attribs = this.attributeBufferInfo.attribs;
    attribs.aModel = twgl.createAttribsFromArrays(this.gl, { aModel: this.vertexProps.aModel });

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
  }

  _updateModelBufferForInstance(placeable) {
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;

    // See twgl.setAttribInfoBufferFromArray.
    const tracker = this.trackers.model;
    const modelArr = tracker.viewFacetById(placeable.sourceId);
    if ( !modelArr ) console.error(`${this.constructor.name}|_updateModelBufferForInstance|Placeable ${placeable.name}, ${placeable.sourceId} not found in model tracker.`);

    const mOffset = tracker.facetOffsetAtId(placeable.sourceId) * tracker.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    log (`${this.constructor.name}|_updateModelBufferForInstance ${placeable.sourceId} with offset ${mOffset}`, { model: tracker.viewFacetById(placeable.sourceId) });
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, tracker.viewFacetById(placeable.sourceId));
  }

  // ----- NOTE: Placeable handler ----- //

  _updateAllPlaceableData() {
    // this._rebuildModelBuffer();
    this._updateAttributes();
  }

  _updatePlaceableData(placeable) {
    return this.trackers.model.facetIdMap.has(placeable.sourceId);
  }

  /**
   * Attempt to update a single placeable instance.
   * @param {PlaceableObject} placeable
   * @returns {boolean} True if update was successful; false otherwise.
   */
  updatePlaceableBuffer(placeable) {
    log(`${this.constructor.name}|_updateInstance`);
    return this._updateModelBufferForInstance(placeable);
  }

  // ----- NOTE: Render ----- //

  // Pull from the placeable tracker matrix indexes.
  _indexForPlaceable(placeable) { return this.trackers.model.facetIdMap.get(placeable.sourceId); }

  _drawFilteredInstances(instanceSet) {
    // To draw select instances, modify the buffer offset.
    // log(`Buffer size is ${tmp.length} x ${tmp.BYTES_PER_ELEMENT} = ${tmp.byteLength} for ${this.placeableTracker.numInstances} placeables`);
    const nVertices = this.indicesArray.length; // Number of vertices to draw.

    if ( CONFIG[MODULE_ID].debug ) {
      log(`${this.constructor.name}|_drawFilteredInstances`);
      const vertices = this.verticesArray;
      const indices = this.indicesArray;
      console.table({ vertices: [...vertices], indices: [...indices] });

      for ( const i of instanceSet ) {
        log(`${this.constructor.name}|_drawFilteredInstances|${i}`);
        const model = this.trackers.model.viewFacetAtIndex(i);
        const mat = new MatrixFloat32(4, 4, model.buffer, model.byteOffset / model.BYTES_PER_ELEMENT);
        mat.print()
      }
    }

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
    const n = this.trackers.model.numFacets;
    const nVertices = this.indices.length; // Number of vertices to draw.

    if ( CONFIG[MODULE_ID].debug ) {
      log(`${this.constructor.name}|_drawUnfilteredInstances`);
      const vertices = this.verticesArray;
      const indices = this.indicesArray;
      console.table({ vertices: [...vertices], indices: [...indices] });

      for ( const i of this.instanceSet ) {
        log(`${this.constructor.name}|_drawUnfilteredInstances|${i}`);
        const model = this.trackers.model.viewFacetAtIndex(i);
        const mat = new MatrixFloat32(4, 4, model.buffer, model.byteOffset / model.BYTES_PER_ELEMENT);
        mat.print()
      }
    }

    WebGL2.drawInstanced(this.gl, nVertices, 0, n);
  }
}
