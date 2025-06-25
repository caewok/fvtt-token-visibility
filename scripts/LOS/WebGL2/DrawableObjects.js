/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { WebGL2 } from "./WebGL2.js";
import { GeometryInstanced } from "../geometry/GeometryDesc.js";
import { VariableLengthAbstractBuffer, VariableLengthTrackingBuffer, VerticesIndicesTrackingBuffer } from "../placeable_tracking/TrackingBuffer.js";
import * as twgl from "./twgl.js";
import { log } from "../util.js";


/**
 * Drawing of a placeable object without instancing.
 */
export class DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static trackerClass;

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
    log(`${this.constructor.name}|intialize`);
    this.placeableTracker = this.constructor.trackerClass.cachedBuild();
    this.placeableTracker.registerPlaceableHooks();
    this.programInfo = await this._createProgram();
    this._initializePlaceableHandler();
    this._initializeGeoms();
    this._initializeOffsetTrackers();
    this._initializeAttributes();
    this._initializeUniforms();
    // this._updateAllVertices();

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
    vi: null
  };

  buffers = {
    indices: null,
    vertices: null,
  };

  /** @type {ArrayBuffer} */
  get verticesBuffer() { return this.trackers.vertices.buffer; }

  /** @type {ArrayBuffer} */
  get indicesBuffer() { return this.trackers.indices.buffer; }

  /** @type {Float32Array} */
  get verticesArray() { return this.trackers.vi.vertices.viewBuffer(); }

  /** @type {Uint16Array} */
  get indicesArray() {
    // See VerticesIndicesTrackingBuffer#viewBuffer.
    const vi = this.trackers.vi;
    return vi.indices.viewBuffer(vi.indicesAdjBuffer);
  }

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

  _initializeOffsetTrackers() {
    // TODO: Use VariableLengthAbstractBuffer and don't copy over the geometry indices and vertices.
    const stride = this.debugViewNormals ? 6 : 3;
    this.trackers.vi = new VerticesIndicesTrackingBuffer({ stride });
    for ( const [id, geom] of this.geoms.entries() ) this.trackers.vi.addFacet({
      id,
      newVertices: geom.vertices,
      newIndices: geom.indices
    });

    // this.offsetData = GeometryNonInstanced.computeBufferOffsets(this.geoms);
  }

  _initializeAttributes() {
    this._initializeVertices();
    // this._initializeAttributeBuffers();
    this.vertexProps = this._defineAttributeProperties();
    log(`${this.constructor.name}|_initializeAttributes`, { aModel: this.vertexProps.aModel?.data, indices: this.vertexProps.indices })

    this.attributeBufferInfo = twgl.createBufferInfoFromArrays(this.gl, this.vertexProps);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, this.attributeBufferInfo);
  }

//   _initializeAttributeBuffers() {
//     const gl = this.gl;
//     this.buffers.indices = gl.createBuffer();
//     this.buffers.vertices = gl.createBuffer();
//   }

  /**
   * Construct data arrays representing vertices and indices.
   */
  _initializeVertices() {
    const vi = this.trackers.vi;
    // const pt = this.placeableTracker;
    this._updateAllVertices();

    // Create distinct views into the vertices and indices buffers
    const n = vi.numFacets;
    this.vertices.length = n;
    this.indices.length = n;
    for ( let i = 0; i < n; i += 1 ) {
      const { vertices, indicesAdj } = vi.viewFacetAtIndex(i);
      this.vertices[i] = vertices;
      this.indices[i] = indicesAdj;
    }
  }

  _updateAllVertices() {
    const vi = this.trackers.vi;
    const pt = this.placeableTracker;

    // Remove missing/deleted ids from the trackers.
    // Assume id is same in indices and vertices.
    for ( const id of vi.indices.facetIdMap.keys() ) {
      const placeable = pt.getPlaceableFromId(id);
      if ( pt.placeables.has(placeable) ) continue;
      vi.deleteFacet(id);
    }

    // Update the geometry and rebuild the trackers.
    // TODO: Can this be done elsewhere to avoid updating all geometry here?
    for ( const [id, geom] of this.geoms.entries() ) {
      geom.calculateModel();
      vi.updateFacet(id, { newVertices: geom.modelVertices, newIndices: geom.modelIndices });
    }

    // Update all the views.
    const n = vi.numFacets;
    this.vertices.length = n;
    this.indices.length = n;
    for ( let i = 0; i < n; i += 1 ) {
      const { vertices, indicesAdj } = vi.viewFacetAtIndex(i);
      this.vertices[i] = vertices;
      this.indices[i] = indicesAdj;
    }
  }

  /*
  _updateAllVertices() {
    const { indices, vertices } = this.trackers;
    const pt = this.placeableTracker;

    // Remove missing/deleted ids from the trackers.
    // Can assume id set is same in indices and vertices.
    for ( const id of indices.facetIdMap.keys() ) {
      const placeable = pt.getPlaceableFromId(id);
      if ( pt.placeables.has(placeable) ) continue;
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
      const iView = indices.viewFacetById(id, iArrayBuffer);
      iView.set(geom.modelIndices);

      // Copy the vertex data to the temporary JS buffer.
      const vView = vertices.viewFacetById(id, vArrayBuffer);
      vView.set(geom.modelVertices);
    }

    // Redo the GPU buffers, whose size may have changed.
    const gl = this.gl;
    const iWebGLBuffer = this.buffers.indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iWebGLBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.viewBuffer(iArrayBuffer), gl[this.constructor.vertexDrawType]);

    const vWebGLBuffer = this.buffers.vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vWebGLBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices.viewBuffer(vArrayBuffer), gl[this.constructor.vertexDrawType]);

    this.vertexProps.aPos.buffer = this.buffers.vertices;
    this.vertexProps.indices.buffer = this.buffers.indices;
    if ( this.debugViewNormals ) this.vertexProps.aNorm.buffer = this.buffers.vertices;
  }
  */

  /**
   * Build the vertex and index buffers along with any other attributes.
   * @returns {object} The attribute property object passed to twgl.createBufferInfoFromArrays.
   */
  _defineAttributeProperties() {
    // Define a vertex buffer to be shared.
    // https://github.com/greggman/twgl.js/issues/132.
    const vSize = Float32Array.BYTES_PER_ELEMENT;
    const debugViewNormals = this.debugViewNormals;
    const gl = this.gl;
    const vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    log (`${this.constructor.name}|_defineAttributeProperties`, { vertices: this.verticesArray });
    gl.bufferData(gl.ARRAY_BUFFER, this.verticesArray, gl[this.constructor.vertexDrawType]);

    const vertexProps = {
      aPos: {
        numComponents: 3,
        buffer: vBuffer,
        drawType: this.constructor.vertexDrawType,
        stride: vSize * (debugViewNormals ? 6 : 3),
        offset: 0,
      },
      indices: this.indicesArray,
    };

    if ( debugViewNormals ) vertexProps.aNorm = {
      numComponents: 3,
      buffer: vBuffer,
      stride: vSize * 6,
      offset: 3 * vSize,
    };
    return vertexProps;
  }

  /*
  _defineAttributeProperties() {
    // Define a vertex buffer to be shared.
    // https://github.com/greggman/twgl.js/issues/132.
    log (`${this.constructor.name}|_defineAttributeProperties`);
    const vSize = Float32Array.BYTES_PER_ELEMENT;
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
  */

  /**
   * Update the vertex data for an instance.
   * @param {number} id      The id of the placeable update
   * @returns {boolean} True if successfully updated; false if array length is off (requiring full rebuild).
   */
  _updateInstanceVertex(id) {
    const geom = this.geoms.get(id);
    geom.dirtyModel = true;
    geom.calculateModel();

    const vi = this.trackers.vi;
    const needFullBufferUpdate = vi.updateFacet(id, { newVertices: geom.modelVertices, newIndices: geom.modelIndices });
    return !needFullBufferUpdate;
  }

  _updateAttributeBuffersForPlaceable(placeable) {
    // See twgl.setAttribInfoBufferFromArray.
    const gl = this.gl;
    const id = placeable.id;
    const vi = this.trackers.vi;

    // Copy the vertices and adjusted indices to their webGL buffers.
    const { vertices, indicesAdj } = vi.viewFacetById(id);
    const vOffset = vi.vertices.facetOffsetAtId(id);
    const iOffset = vi.indices.facetOffsetAtId(id);

    // Vertices.
    const vBuffer = this.attributeBufferInfo.attribs.aPos.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vOffset, vertices);

    // Indices.
    const iBuffer = this.attributeBufferInfo.indices;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, iOffset, indicesAdj);
    log (`${this.constructor.name}|_updateAttributeBuffersForPlaceable ${placeable.name}, ${placeable.id} with vOffset ${vOffset} and iOffset ${iOffset}`, { vertices, indicesAdj });
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

    for ( const [placeable, lastUpdate] of placeableTracker.placeableLastUpdated.entries() ) {
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
    this._initializeGeoms();
    this._initializeOffsetTrackers();
//     this._initializeAttributes();

    this._updateAllVertices();
  }

  _updateInstance(placeable) {
    // If vertex array or index array length no longer matches, redo.
    if ( !this._updateInstanceVertex(placeable) ) {
      this.rebuildNeeded = true;
      return;
    }
    this._updateAttributeBuffersForPlaceable(placeable);

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
      const idx = this._indexForPlaceable(p);
      this.instanceSet.add(idx);
    });
  }

  // Pull from the index for the indices.
  _indexForPlaceable(placeable) { return this.trackers.indices.facetIdMap.get(placeable.id); }

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
    log(`${this.constructor.name}|render`);
    if ( CONFIG[MODULE_ID].filterInstances ) this._drawFilteredInstances();
    else this._drawUnfilteredInstances();
    gl.bindVertexArray(null);
    this.gl.finish(); // For debugging
  }

  _drawFilteredInstances() {
    // Debug: what model are we rendering?
    // Debug: what model are we rendering?
    if ( CONFIG[MODULE_ID].debug ) {
      for ( const i of this.instanceSet ) {
        const { vertices, indices, indicesAdj } = this.trackers.vi.viewFacetAtIdx(i);
        log(`${this.constructor.name}|_drawUnfilteredInstances|${i}`);
        console.table({ vertices: [...vertices], indices: [...indices], indicesAdj: [...indicesAdj] });
      }
    }

    const { facetLength, facetLengths, byteOffsets } = this.indices.tracker;
    WebGL2.drawSet(this.gl, this.instanceSet, facetLength || facetLengths, byteOffsets);
  }

  _drawUnfilteredInstances() {
    const n = this.tracker.indices.arrayLength;

    // Debug: what model are we rendering?
    if ( CONFIG[MODULE_ID].debug ) {
      for ( let i = 0; i < n; i += 1 ) {
        const { vertices, indices, indicesAdj } = this.trackers.vi.viewFacetAtIdx(i);
        log(`${this.constructor.name}|_drawUnfilteredInstances|${i}`);
        console.table({ vertices: [...vertices], indices: [...indices], indicesAdj: [...indicesAdj] });
      }
    }

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
    // Don't need indices or vertices trackers.
    // Model matrices stored in placeableTracker.
    this.trackers.model = this.placeableTracker.tracker;
  }

  _defineAttributeProperties() {
    const vertexProps = super._defineAttributeProperties();

    // Define the model matrix, which changes 1 per instance.
    vertexProps.aModel = {
      numComponents: 16,
      data: this.trackers.model.viewBuffer(),
      drawType: this.gl.DYNAMIC_DRAW,
      // stride: this.placeableHandler.instanceArrayValues.BYTES_PER_ELEMENT * 16,
      offset: 0,
      divisor: 1,
    };

    return vertexProps;
  }

  get verticesArray() { return this.geoms.instanceVertices; }

  get indicesArray() { return this.geoms.instanceIndices; }

  get modelMatrixArray() { return this.trackers.model.viewBuffer(); }

  _initializeVertices() {
//     const gl = this.gl;
//     const iWebGLBuffer = this.buffers.indices = gl.createBuffer();
//     gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iWebGLBuffer);
//     gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.geoms.instanceIndices, gl[this.constructor.vertexDrawType]);
//
//     const vWebGLBuffer = this.buffers.vertices = gl.createBuffer();
//     gl.bindBuffer(gl.ARRAY_BUFFER, vWebGLBuffer);
//     gl.bufferData(gl.ARRAY_BUFFER, this.geoms.instanceVertices, gl[this.constructor.vertexDrawType]);
  }

  _updateAllVertices() {
    console.error("DrawableObjectsInstancingWebGL2Abstract does not update instance vertices.");
  }

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
    const tracker = this.trackers.model;
    const mOffset = tracker.facetOffsetAtId(placeable.id) * tracker.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    log (`${this.constructor.name}|_updateModelBufferForInstance ${placeable.id} with offset ${mOffset}`, { model: tracker.viewFacetById(placeable.id) });
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

  // Pull from the placeable tracker matrix indexes.
  _indexForPlaceable(placeable) { return this.placeableTracker.tracker.facetIdMap.get(placeable.id); }

  _drawFilteredInstances() {
    // To draw select instances, modify the buffer offset.
    // const tmp = this.placeableTracker.instanceArrayValues;
    // log(`Buffer size is ${tmp.length} x ${tmp.BYTES_PER_ELEMENT} = ${tmp.byteLength} for ${this.placeableTracker.numInstances} placeables`);
    const nVertices = this.geoms.indices.length; // Number of vertices to draw.

    if ( CONFIG[MODULE_ID].debug ) {
      log(`${this.constructor.name}|_drawUnfilteredInstances`);
      const vertices = this.verticesArray;
      const indices = this.indicesArray;
      console.table({ vertices: [...vertices], indices: [...indices] });

      for ( const i of this.instanceSet ) {
        const model = this.tracker.model.viewFacetAtIdx(i);
        log(`${this.constructor.name}|_drawUnfilteredInstances|${i}`);
        console.table({  model: [...model] });
      }
    }

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

    if ( CONFIG[MODULE_ID].debug ) {
      log(`${this.constructor.name}|_drawUnfilteredInstances`);
      const vertices = this.verticesArray;
      const indices = this.indicesArray;
      console.table({ vertices: [...vertices], indices: [...indices] });

      for ( const i of this.instanceSet ) {
        const model = this.tracker.model.viewFacetAtIdx(i);
        log(`${this.constructor.name}|_drawUnfilteredInstances|${i}`);
        console.table({  model: [...model] });
      }
    }

    WebGL2.drawInstanced(this.gl, nVertices, 0, n);
  }
}
