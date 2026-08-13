/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


// webGL2
import * as twgl from "./twgl.js";
import { WebGL2 } from "./WebGL2.js";

import { GEOMETRY_LIB_ID } from "../../geometry/const.js";
import { QuadPrimitive } from "../../geometry/placeable_geometry/InstancedGeometricPrimitive.js";
import { WallGeometry } from "../../geometry/placeable_geometry/WallGeometry.js";
import { mix } from "../../geometry/mixwith.js";
import { FixedLengthTrackingBuffer, VerticesIndicesAbstractTrackingBuffer } from "../../geometry/placeable_tracking/TrackingBuffer.js";

/* Drawables

Two basic types:
1. Model
- Variable vertices (but fixed length for tiles)
- Variable indices (but fixed length for tiles)
- Tiles: texture
- Uses verticesIndicesTracker for buffer

Requires:
- webGL2 context
- viTracker
- Ideally, some way to update all geoms.

2. Instance
- Fixed vertices.
- Fixed indices.
- Variable aModel per INSTANCED
- Uses modelMatrixTracker for buffer




*/


class AbstractDrawable {

  static SHADER_FLAGS = {
    NONE:         0,
    DEBUG:        1 << 0, // 1
    TEXTURED:     1 << 1, // 4
    CONSTRAINED:  1 << 2, // 8
  };

  /** @type {string} */
  static VERTEX_DRAW_TYPE = "STATIC_DRAW";

  /** @type {number} */
  static CAMERA_BIND_POINT = 0;

  /** @type {number} */
  static MATERIAL_BIND_POINT = 1;

  /** @type {number} */
  static stride = 6; // 3d position + 3d normal

  /** @type {WebGL2} */
  webGL2;

  /** @type {WebGL2RenderingContext} */
  get gl() { return this.webGL2.gl; }

  /** @type {boolean} */
  debugView = false;

  constructor({ webGL2, programInfo, debugProgramInfo } = {}) {
    this.webGL2 = webGL2;
    this.programInfo = programInfo;
    this.debugProgramInfo = debugProgramInfo;
  }

  // ----- NOTE: Initialization ----- //

  #initialized = false;

  /**
   * Initialize the drawables.
   */
  initialize() {
    if ( this.#initialized ) return;
    this._initializeAttributes();
    this._initializeUniforms();
    this.#initialized = true;
  }

  // ----- NOTE: Program ----- //

  get program() { return this.debugView ? this.debugProgramInfo : this.programInfo; }

  // ----- NOTE: Uniforms ----- //

  _initializeUniforms() {
    const gl = this.gl;

    // Camera used in both debug and regular views.
    const cameraBlockIndex = gl.getUniformBlockIndex(this.programInfo.program, "Camera");
    if ( cameraBlockIndex !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.programInfo.program, cameraBlockIndex, this.constructor.CAMERA_BIND_POINT); // 0

    const cameraDebugBlockIndex = gl.getUniformBlockIndex(this.debugProgramInfo.program, "Camera");
    if ( cameraDebugBlockIndex !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.debugProgramInfo.program, cameraDebugBlockIndex, this.constructor.CAMERA_BIND_POINT); // 0

    // Material only used to color the shapes in the debug view.
    const matBlockIdx = gl.getUniformBlockIndex(this.debugProgramInfo.program, "Material");
    if ( matBlockIdx !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.debugProgramInfo.program, matBlockIdx, this.constructor.MATERIAL_BIND_POINT); // 1
  }

  // ----- NOTE: Attributes ----- //

  /** @type {Float32Array} */
  get verticesArray() { return new Error(`${this.constructor.name}|verticesArray getter must be defined by child class.`); }

  /** @type {Float32Array} */
  get indicesArray() { return new Error(`${this.constructor.name}|indicesArray getter must be defined by child class.`); }

  /** @type {Float32Array} */
  get modelMatrixArray() { return new Error(`${this.constructor.name}|indicesArray getter must be defined by child class.`); }

  /** @type {number} */
  aModelAttribLoc = 0;

  /** @type {object} */
  attributeProperties = {};

  /** @type {twgl.BufferInfo} */
  attributeBufferInfo = {};

  /** @type {twgl.VertexArrayInfo} */
  vertexArrayInfo = {};

  /** @type {twgl.VertexArrayInfo} */
  debugVertexArrayInfo = {};

  get VAI() { return this.debugView ? this.debugVertexArrayInfo : this.vertexArrayInfo; }

  /**
   * Initialize attributes for the shader.
   * Requires that programInfo be defined.
   */
  _initializeAttributes() {
    this.attributeProperties = this._defineAttributeProperties();
    this.attributeBufferInfo = twgl.createBufferInfoFromArrays(this.gl, this.attributeProperties);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, this.attributeBufferInfo);
    this.debugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.debugProgramInfo, this.attributeBufferInfo);
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
    gl.bufferData(gl.ARRAY_BUFFER, this.verticesArray, gl[this.constructor.VERTEX_DRAW_TYPE]);
    const stride = this.constructor.stride * Float32Array.BYTES_PER_ELEMENT;

    // Vertices.
    const attrProps = {
     aPosition: {
       numComponents: 3,
       buffer: vBuffer,
       drawType: this.constructor.VERTEX_DRAW_TYPE,
       stride,
       offset: 0,
     },
     indices: this.indicesArray,
    }

    // Normal, for debugging view.
    attrProps.aNormal = {
      numComponents: 3,
      buffer: vBuffer,
      drawType: this.constructor.VERTEX_DRAW_TYPE,
      stride,
      offset: Float32Array.BYTES_PER_ELEMENT * 3,
    };

    // Define the model matrix, which changes 1 per instance.
    attrProps.aModel = {
      numComponents: 16,
      data: this.modelMatrixArray,
      drawType: this.gl.DYNAMIC_DRAW,
      stride: Float32Array.BYTES_PER_ELEMENT * 16,
      offset: 0,
      divisor: 1,
    };

    // For use in _draw method.
    this.aModelAttribLoc = this.gl.getAttribLocation(this.programInfo.program, 'aModel');
    return attrProps;
  }

  // ----- NOTE: Shape lifecycle hooks ----- //

  /**
   * The set of shape ids tracked by this drawable.
   * @type {Set<string>}
   */
  trackedIds = new Set();

  /**
   * The set of shape ids that may require a WebGPU buffer update.
   * @type {Set<string>}
   */
  idsToUpdate = new Set();

  /**
   * Add a geometric shape to this drawable.
   * @param {GeometricPrimitive} shape
   * @returns {boolean} True if successfully added or updated.
   */
  addGeometricShape(shape) {
    const id = shape.id;
    if ( this.trackedIds.has(id) ) return this.updateGeometricShape(shape);

    const added = this._onShapeAdded(shape);
    if ( added ) this.trackedIds.add(id);
    return added;
  }

  /**
   * Update an existing geometric shape in this drawable.
   * @param {GeometricPrimitive} shape
   * @returns {boolean} True if successfully added or updated.
   */
  updateGeometricShape(shape) {
    const id = shape.id;
    if ( !this.trackedIds.has(id) ) return this.addGeometricShape(shape);
    return this._onShapeUpdated(shape);
  }

  /**
   * Remove a geometric shape from this drawable.
   * @param {GeometricPrimitive} shape
   * @returns {boolean} True if successfully removed. If not present, returns false.
   */
  removeGeometricShape(shape) {
    const id = shape.id;
    if ( !this.trackedIds.has(id) ) return false;
    this.trackedIds.delete(id);
    return this._onShapeRemoved(shape);
  }

  /**
   * Protected lifecycle hooks for subclasses/mixins to implement
   * @param {GeometricPrimitive} shape
   * @returns {boolean} True if it should be added/updated/deleted
   */
  _onShapeAdded(_shape) { console.error(`${this.constructor.name}#_onShapeAdded must be implemented by subclass.`); }
  _onShapeUpdated(_shape) { console.error(`${this.constructor.name}#_onShapeAdded must be implemented by subclass.`); }
  _onShapeRemoved(_shape) { console.error(`${this.constructor.name}#_onShapeAdded must be implemented by subclass.`); }

  // ----- NOTE: Generic buffer synchronization ---- //

  /**
   * Trigger the update of GPU buffers from CPU trackers.
   * Expected that child classes will update as needed.
   */
  updateBuffers() { }

  /**
   * Synchronize a CPU tracking buffer to its WebGL GPU buffer.
   * Should be called by subclasses.
   * @param {object} config
   * @param {VariableLengthAbstractBuffer} config.tracker     The tracking buffer instance
   * @param {Set<string>} config.idsToUpdate                  Set of shape ids requiring sub-data updates
   * @param {string} config.layoutStateKey                    The property name tracking the layout version for this class
   */
  _syncTrackerToBuffer({ tracker, idsToUpdate, layoutStateKey } = {}) {
    // If the layout version changed (e.g., buffer grew), resize and upload the whole buffer.
    if ( this[layoutStateKey] !== tracker.layoutVersion ) {
      this._resizeBuffer(tracker);
      this[layoutStateKey] = tracker.layoutVersion;
    }

    // Otherwise, selectively update only the modified ids.
    else idsToUpdate.forEach(id => this._updateBufferForId(id, tracker));
    idsToUpdate.clear();
  }

  /**
   * Resize a WebGL GPU buffer to match its CPU tracking buffer.
   * To be implemented by subclass.
   * @param {VariableLengthAbstractBuffer} tracker
   */
  _resizeBuffer(_tracker) { new Error(`${this.constructor.name}#_onShapeAdded must be implemented by subclass.`); }

  /**
   * Update a WebGL GPU buffer for a specific id to match its CPU tracking buffer.
   * To be implemented by subclass.
   * @param {string} id
   * @param {VariableLengthAbstractBuffer} tracker
   */
  _updateBufferForId(_id, _tracker) { new Error(`${this.constructor.name}#_onShapeAdded must be implemented by subclass.`); }


  // ----- NOTE: Rendering ----- //

  /**
   * The render set stores shapes to be rendered.
   * When render is called, prerender will upload changes for the shape as needed.
   * To lock in the shape model, call prerender manually after adding shapes.
   * @type {Set<GeometricPrimitive>}
   */
  renderSet = new Set();

  /**
   * Prerender triggers updates to the GPU data as needed prior to rendering.
   */
  prerender() {
    this.renderSet.forEach(shape => this.updateGeometricShape(shape));
    this.updateBuffers();
  }

  /**
   * Draw all placeables in the instance set, using the current webGL settings.
   */
  render(debug = false) {
    if ( !this.renderSet.size ) return;
    this.prerender();
    this.debugView = debug;

    const gl = this.gl;
    const webGL2 = this.webGL2;
    const programInfo = this.program;
    webGL2.useProgram(programInfo);
    webGL2.setCulling(true);
    webGL2.setCullFace("BACK");

    gl.bindVertexArray(this.VAI.vertexArrayObject);

    // twgl.setBuffersAndAttributes(gl, programInfo, this.attributeBufferInfo);

    this._draw();
    gl.bindVertexArray(null);
    // gl.finish(); // For debugging.
  }

  _draw() { console.error("_draw should be defined by child class."); }

  destroy() {}

}

export class InstancedDrawable extends AbstractDrawable {

  static SHADER_VARIANT = this.SHADER_FLAGS.NONE;

  /** @type {class<GeometricPrimitive>} */
  primitiveClass;

  constructor({ primitiveClass, ...opts }) {
    super(opts);
    this.primitiveClass = primitiveClass;
  }

  /** @type {Float32Array} */
  get verticesArray() { return this.primitiveClass.instanceVO.vertices; }

  /** @type {Uint16Array} */
  get indicesArray() { return this.primitiveClass.instanceVO.indices; }


   // ----- NOTE: Shape and model tracking ----- //

  modelMatrixTracker = new FixedLengthTrackingBuffer({ facetLengths: 16 });

  get modelMatrixArray() { return this.modelMatrixTracker.viewWholeBuffer(); }

  /**
   * Track the layoutVersion of the modelMatrixTracker.
   * When it changes, the entire model buffer must be updated.
   * @type {number}
   */
  modelLayoutVersion = 0;

  /**
   * Track the data version of the model.
   * When it changes, the model buffer for that id must be updated.
   * @type {Map<string, number>}
   */
  modelUpdateTracker = new Map();

  /**
   * Track the ids whose model buffer must  be uploaded before rendering.
   * @type {Set<string>}
   */
  idsToUpdate = new Set();

  /**
   * Add a geometric shape's model to this drawable.
   * The modelUpdateTracker links ids to indices.
   * @param {GeometricPrimitive} shape
   */
  _onShapeAdded(shape) {
    if ( !(shape instanceof this.primitiveClass ) ) return false;
    const id = shape.id;

    this.modelMatrixTracker.addFacet({ id, newValues: shape.modelMatrix.model.arr });
    this.modelUpdateTracker.set(id, shape.modelMatrix.dataVersion);
    this.idsToUpdate.add(id);
    return true;
  }

  /**
   * Update the geometric shape's model for this drawable.
   * @param {GeometricPrimitive} shape
   */
  _onShapeUpdated(shape) {
    const id = shape.id;

    // If we already have this data, no need to update it.
    if ( this.modelUpdateTracker.get(id) === shape.modelMatrix.dataVersion ) return false;

    this.modelMatrixTracker.updateFacet(id, { newValues: shape.modelMatrix.model.arr });
    this.modelUpdateTracker.set(id, shape.modelMatrix.dataVersion);
    this.idsToUpdate.add(id);
    return true;
  }

  /**
   * Delete the geometric shape's model for this drawable.
   * @param {GeometricPrimitive} shape
   */
  _onShapeRemoved(shape) {
    const id = shape.id;
    this.modelMatrixTracker.deleteFacet(id);
    this.modelUpdateTracker.delete(id);
    // this.idsToUpdate.add(id); Unneeded for deletion b/c it will get skipped by instancing.
    return true;
  }

  // ----- NOTE: Model buffer updating ----- //

  /**
   * Update the buffer only as needed.
   * May update the entire buffer if it needs to be resize.
   * Otherwise will update the ids marked as requiring an update.
   */
  updateBuffers() {
    this._syncTrackerToBuffer({
      tracker: this.modelMatrixTracker,
      layoutStateKey: "modelLayoutVersion",
      idsToUpdate: this.idsToUpdate,
    });
    this.idsToUpdate.clear();
  }

  /**
   * Resize and update the entire model buffer on the GPU.
   */
  _resizeBuffer() {
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;

    // Resize the GPU buffer.
    // Use gl.bufferData instead of subData to reallocate the GPU memory to the new size.
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.modelMatrixArray, gl.DYNAMIC_DRAW);

    /*
    // Update the model attribute with a new buffer.
    this.attributeProperties.aModel.data = this.modelMatrixArray;
    const attribs = this.attributeBufferInfo.attribs;
    attribs.aModel = twgl.createAttribsFromArrays(this.gl, { aModel: this.attributeProperties.aModel }).aModel;

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
    this.debugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.debugProgramInfo, attribs);
    */
  }

  /**
   * Update the model buffer on the GPU for a specific id.
   * TODO: Use applyConsecutively to update in larger chunks.
   * @param {string} id
   */
  _updateBufferForId(id) {
    const tracker = this.modelMatrixTracker;
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;
    const mOffset = tracker.facetOffsetAtId(id) + tracker.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, tracker.viewFacetById(id));
  }

  // ----- NOTE: Rendering ----- //

  _draw() {
    // Get the indices for each shape in the render set.
    // Shapes that do not belong to this primitive are ignored.
    const instanceSet = this.renderSet
      .filter(shape => (shape instanceof this.primitiveClass) && this.modelMatrixTracker.hasId(shape.id))
      .map(shape => this.modelMatrixTracker.facetIdMap.get(shape.id))

    const nVertices = this.indicesArray.length;
    WebGL2.drawInstancedMatrixSet(
      this.gl,
      instanceSet,
      nVertices,
      this.attributeBufferInfo.attribs.aModel,
      this.aModelAttribLoc,
    );

  }
}

/**
 * A model drawable is unique, representing a singular geometric primitive.
 * Like the InstanceDrawable, it has instance vertices/indices and a model matrix.
 * But it will never be drawn instanced; it is a 1-to-1 link.
 */
export class ModelDrawable extends AbstractDrawable {

  static SHADER_VARIANT = this.SHADER_FLAGS.NONE;

  /** @type {GeometricPrimitive} */
  shape;

  /**
   * @param {GeometricPrimitive} shape      Shape to draw
   * @param {object} [opts]                 Passed to Drawable constructor
   */
  constructor({ shape, ...opts } = {}) {
    super(opts);
    this.shape = shape;
  }

  /** @type {Float32Array} */
  get verticesArray() { return this.shape.modelVO.vertices; }

  /** @type {Float32Array} */
  get indicesArray() { return this.shape.modelVO.indices; }

  /** @type {Float32Array} */
  get modelMatrixArray() { return this.shape.modelMatrix.model.arr; }

  // ----- NOTE: Shape and model tracking ----- //

  /**
   * Track the data version of the model.
   * When it changes, the model buffer for that id must be updated.
   * @type {Map<string, number>}
   */
  modelVersion = 0;

  // ----- NOTE: Model buffer updating ----- //

  _onShapeAdded(_shape) { return false; }

  _onShapeUpdated(shape) {
    return this.modelVersion !== shape.modelMatrix.dataVersion
  }

  /**
   * Update the model buffer only as needed.
   * May update the entire buffer if it needs to be resized.
   * Otherwise will update the ids marked as requiring an update.
   */
  updateBuffers() {
    if ( !this.idsToUpdate.size ) return;
    this._updateModelBuffer();
    super.updateBuffers();
  }

  _updateModelBuffer() {
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.modelMatrixArray);
  }

  // ----- NOTE: Rendering ----- //

  _draw() {
    WebGL2.draw(this.gl, this.indicesArray.length);
  }
}

/**
 * Group together several model drawables and draw together.
 * Each drawable has its own vertices, indices, and model matrix, which are all tracked.
 * Ostensibly faster than setting the buffers one-by-one using ModelDrawable.
 */
export class MultiModelDrawable extends AbstractDrawable {

  // ----- NOTE: Tracking ----- //

  viTracker = new VerticesIndicesAbstractTrackingBuffer({ stride: 6 }); // Stride is Position + Normal

  modelMatrixTracker = new FixedLengthTrackingBuffer({ facetLengths: 16 });

  /** @type {Float32Array} */
  get verticesArray() { return this.viTracker.vertices.viewWholeBuffer(); }

  /** @type {Uint16Array} */
  get indicesArray() { return this.viTracker.indices.viewWholeBuffer(this.viTracker.indicesAdjBuffer); }

  /** @type {Float32Array} */
  get modelMatrixArray() { return this.modelMatrixTracker.viewWholeBuffer(); }

  /**
   * Track the layout version of the vertices tracker.
   * When it changes, the entire model buffer must be updated.
   * @type {number}
   */
  viLayoutVersion = 0;

  /**
   * Track the data version of the vertices.
   * When it changes, the vi buffer for that id must be updated.
   * @type {Map<string, number>}
   */
  viUpdateTracker = new Map();

  /**
   * Track the data version of the model.
   * When it changes, the model buffer for that id must be updated.
   * @type {Map<string, number>}
   */
  modelUpdateTracker = new Map();

  /**
   * Track the layout version of the model tracker.
   * When it changes, the entire model buffer must be updated.
   * @type {number}
   */
  modelLayoutVersion = 0;

  /**
   * Track the ids whose vi buffer must  be uploaded before rendering.
   * @type {Set<string>}
   */
  idsToUpdateVI = new Set();

  /**
   * Track the ids whose model buffer must  be uploaded before rendering.
   * @type {Set<string>}
   */
  idsToUpdateModel = new Set();

  /**
   * Add a geometric shape's model to this drawable.
   * The modelUpdateTracker links ids to indices.
   * @param {GeometricPrimitive} shape
   */
  _onShapeAdded(shape) {
    // Add the shape id to vertices/indices tracking.
    const id = shape.id;
    const vo = shape.modelVO;
    this.viTracker.addFacet({ id, newVertices: vo.vertices, newIndices: vo.indices });
    this.viUpdateTracker.set(id, shape.modelVerticesVersion);
    this.idsToUpdateVI.add(id);

    // Add the shape id to model tracking.
    this.modelMatrixTracker.addFacet({ id, newValues: shape.modelMatrix.model.arr });
    this.modelUpdateTracker.set(id, shape.modelMatrix.dataVersion);
    this.idsToUpdateModel.add(id);
    return true;
  }

  /**
   * Update the geometric shape's model for this drawable.
   * @param {GeometricPrimitive} shape
   */
  _onShapeUpdated(shape) {
    const id = shape.id;

    // Update vertices data. If we already have this data, no need to update it.
    let res = false;
    if ( this.viUpdateTracker.get(id) !== shape.modelVerticesVersion ) {
      const vo = shape.modelVO;
      this.viTracker.updateFacet(id, { newIndices: vo.indices, newVertices: vo.vertices });
      this.viUpdateTracker.set(id, shape.modelVerticesVersion);
      this.idsToUpdateVI.add(id);
      res = true;
    };

    // Update model data. If we already have this data, no need to update it.
    if ( this.modelUpdateTracker.get(id) !== shape.modelMatrix.dataVersion ) {
      this.modelMatrixTracker.updateFacet(id, { newValues: shape.modelMatrix.model.arr });
      this.modelUpdateTracker.set(id, shape.modelMatrix.dataVersion);
      this.idsToUpdateModel.add(id);
      res = true;
    };
    return res;
  }

  /**
   * Delete the geometric shape's model for this drawable.
   * @param {GeometricPrimitive} shape
   */
  _onShapeRemoved(shape) {
    const id = shape.id;
    this.viTracker.deleteFacet(id);
    this.viUpdateTracker.delete(id);
    this.modelMatrixTracker.deleteFacet(id);
    this.modelUpdateTracker.delete(id);
    return true;
    // Don't need to update a deleted id; will be ignored by instancing.
  }

  // ----- NOTE: buffer updating ----- //

  updateBuffers() {
    this._syncTrackerToBuffer({
      tracker: this.viTracker,
      layoutStateKey: "viLayoutVersion",
      idsToUpdate: this.idsToUpdateVI,
    });
    this._syncTrackerToBuffer({
      tracker: this.modelMatrixTracker,
      layoutStateKey: "modelLayoutVersion",
      idsToUpdate: this.idsToUpdateModel,
    });
  }

  _resizeBuffer(tracker) {
    if ( tracker === this.viTracker ) this._resizeVIBuffer();
    else this._resizeModelBuffer();
  }

  _updateBufferForId(id, tracker) {
    if ( tracker === this.viTracker ) this._updateVIBufferForId(id);
    else this._updateModelBufferForId(id);
  }

  /**
   * Resize and update the entire model buffer on the GPU.
   */
  _resizeVIBuffer() {
    const gl = this.gl;
    const { vertices, indicesAdj } = this.viTracker.viewWholeBuffer();

    // Resize the vertices buffer.
    const vBuffer = this.attributeBufferInfo.attribs.aPosition.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

    // Resize the indices buffer.
    const iBuffer = this.attributeBufferInfo.indices;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indicesAdj, gl.DYNAMIC_DRAW);

    /*
    // Update the model attribute with a new buffer.
    this.attributeProperties.aPosition.data = this.verticesArray;
    this.attributeProperties.aNormal.data = this.verticesArray;
    this.attributeProperties.indices.data = this.indicesArray;

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
    this.debugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.debugProgramInfo, attribs);
    */
  }

  /**
   * Update the model buffer on the GPU for a specific id.
   * TODO: Use applyConsecutively to update in larger chunks.
   * @param {string} id
   */
  _updateVIBufferForId(id) {
    const tracker = this.viTracker;
    const gl = this.gl;
    const vi = this.viTracker;
    const { vertices, indicesAdj } = vi.viewFacetById(id);

    // Vertices
    const vBuffer = this.attributeBufferInfo.attribs.aPosition.buffer;
    const vOffset = tracker.vertices.facetOffsetAtId(id) + tracker.vertices.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vOffset, vertices);

    const iBuffer = this.attributeBufferInfo.indices;
    const iOffset = tracker.indices.facetOffsetAtId(id) + tracker.indices.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, iOffset, indicesAdj);
  }


  // ----- NOTE: Model buffer updating ----- //

  /**
   * Resize and update the entire model buffer on the GPU.
   */
  _resizeModelBuffer() {
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;
    const mArray = this.modelMatrixTracker.viewWholeBuffer();

    // Resize the GPU buffer.
    // Use gl.bufferData instead of subData to reallocate the GPU memory to the new size.
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mArray, gl.DYNAMIC_DRAW);

    /*
    // Update the model attribute with a new buffer.
    this.attributeProperties.aModel.data = this.modelMatrixArray;
    const attribs = this.attributeBufferInfo.attribs;
    attribs.aModel = twgl.createAttribsFromArrays(this.gl, { aModel: this.attributeProperties.aModel }).aModel;

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
    this.debugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.debugProgramInfo, attribs);
    */
  }

  /**
   * Update the model buffer on the GPU for a specific id.
   * TODO: Use applyConsecutively to update in larger chunks.
   * @param {string} id
   */
  _updateModelBufferForId(id) {
    const tracker = this.modelMatrixTracker;
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;
    const mOffset = tracker.facetOffsetAtId(id) + tracker.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, tracker.viewFacetById(id));
  }

  // ----- NOTE: Rendering ----- //

  _draw() {
    // Get the indices for each shape in the render set.
    // Shapes that do not belong to this primitive are ignored.
    const instanceSet = this.renderSet
      .filter(shape => this.modelMatrixTracker.hasId(shape.id))
      .map(shape => this.modelMatrixTracker.facetIdMap.get(shape.id))

    const nVertices = this.indicesArray.length;
    WebGL2.drawInstancedMatrixSet(
      this.gl,
      instanceSet,
      nVertices,
      this.attributeBufferInfo.attribs.aModel,
      this.aModelAttribLoc,
    );
  }
}

export class TexturedInstancedDrawable extends InstancedDrawable {

  static SHADER_VARIANT = super.SHADER_VARIANT | this.SHADER_FLAGS.TEXTURED;

  /** @type {boolean} */
  static TEXTURED = true;

  /** @type {number} */
  static stride = 8; // Position (3) + Normal (3) + UV (2)

  // ----- NOTE: Attributes ----- //

  /** @type {Float32Array} */
  textureIndicesArray = new Int32Array(16);

  get alphaThresholdArray() { return this.primitiveClass.alphaThresholdTracker.viewBuffer(); }

  /**
   * Build the vertex and index buffers along with any other attributes.
   * Add UVs for textures.
   * @returns {object} The attribute property object passed to twgl.createBufferInfoFromArrays.
   */
  _defineAttributeProperties() {
    const attrProps = super._defineAttributeProperties();

    // UV coordinates.
    attrProps.aTexCoord = {
      numComponents: 2,
      buffer: attrProps.aPosition.buffer, // Shared vBuffer
      drawType: this.constructor.VERTEX_DRAW_TYPE,
      stride: this.constructor.stride * Float32Array.BYTES_PER_ELEMENT,
      offset: Float32Array.BYTES_PER_ELEMENT * 6, // Position (3) + Normals (3)
    }

    // Alpha threshold.
    attrProps.aAlphaThreshold = {
      numComponents: 1, // It's just a single float (0.0 to 1.0)
      data: this.alphaThresholdArray,
      type: this.gl.FLOAT,
      drawType: this.gl.DYNAMIC_DRAW, // We will update this every frame/batch
      divisor: 1, // CRITICAL: This tells WebGL it is a per-instance attribute
    }

    // Texture index, handled by this class.
    attrProps.aTextureIndex = {
      numComponents: 1, // It's just a single int (0 to 15)
      data: this.textureIndicesArray,
      type: this.gl.INT, // Force WebGL to use vertexAttribIPointer,
      drawType: this.gl.DYNAMIC_DRAW, // We will update this every frame/batch
      divisor: 1, // CRITICAL: This tells WebGL it is a per-instance attribute
    };

    // For use in _draw method.
    this.aTextureIndexLoc = this.gl.getAttribLocation(this.programInfo.program, 'aTextureIndex');
    this.aAlphaThresholdLoc = this.gl.getAttribLocation(this.programInfo.program, 'aAlphaThreshold');

    return attrProps;
  }

  // Because tiles are always quads, don't need to worry about expanding model vertices/indices.

  // ----- NOTE: Textures ----- //

  #fallbackTexture;

  /** @type {Map<url, WebGLTexture>} */
  textures = new Map();

  static textureOptions(gl) {
    return {
      target: gl.TEXTURE_2D,
      level: 0,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
    };
  }


  // TODO: Can we get the texture url from the textures map (WebGLTexture)?
  // Should we store an object there?

  // TODO: Can we store one texture using static because we are reusing this.gl throughout?

  _initializeUniforms() {
    super._initializeUniforms();

    // Set a fallback texture.
    const gl = this.gl;
    this.#fallbackTexture ??= twgl.createTexture(gl, { src: [0, 0, 0, 0] });

    // Array of hardware texture units we will use for batching.
    // Use Int32 to match what gl.uniform1iv expects.
    const textureUnits = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    // Tell the normal shader program to map the uTextures array to texture units 0–15.
    const uTexturesLoc = gl.getUniformLocation(this.programInfo.program, "uTextures[0]");
    if ( uTexturesLoc !== null ) {
      gl.useProgram(this.programInfo.program);
      gl.uniform1iv(uTexturesLoc, textureUnits);
    }

    /* Doesn't work:
    twgl.setUniforms(this.programInfo, {
      uTextures: textureUnits,
    });
    */

    // Same for debug program.
    const uTexturesDebugLoc = gl.getUniformLocation(this.debugProgramInfo.program, "uTextures[0]");
    if ( uTexturesDebugLoc !== null ) {
      gl.useProgram(this.debugProgramInfo.program);
      gl.uniform1iv(uTexturesDebugLoc, textureUnits);
    }

    // Reset program state.
    this.webGL2.useProgram(null);
  }

  _initializeTexture(shape) {
    const src = shape.textureURL;
    if ( this.textures.has(src) ) return;

    const textureOpts = this.constructor.textureOptions(this.gl);

    // Attempt to pull the pre-loaded image from Foundry's PIXI cache.
    const pixiTexture = PIXI.Assets.get(src);

    // Pass the HTMLImageElement directly for a synchronous upload.
    // This avoids the blue solid image when the texture is first displayed.
    if ( pixiTexture
      && pixiTexture.baseTexture.resource.source ) textureOpts.src = pixiTexture.baseTexture.resource.source;

    // Fallback to async URL loading.
    else textureOpts.src = src;

    // Could pass a third callback argument to createTexture to rerender if async loading, but challenging to implement here.
    this.textures.set(src, twgl.createTexture(this.gl, textureOpts));
  }

  /** @type {number} */
  aTextureIndexLoc = 0;

  /** @type {number} */
  aAlphaThresholdLoc = 0;

  _resizeTextureAttributeArrays(requiredSize) {
    let newSize = this.textureIndicesArray.length * 2;
    while ( newSize < requiredSize ) newSize *= 2;
    if ( this.textureIndicesArray.length >= requiredSize ) return;

    const newIndicesArray = new Int32Array(newSize);
    newIndicesArray.set(this.textureIndicesArray);
    this.textureIndicesArray = newIndicesArray;

    const newAlphaArray = new Float32Array(newSize);
    newAlphaArray.set(this.alphaThresholdArray);
    this.alphaThresholdArray = newAlphaArray;

    this.#resizeNeeded = true;
  }

  #resizeNeeded = false;

  _ensureBufferCapacity(requiredSize) {
    // Resize the CPU array if necessary.
    this._resizeTextureAttributeArrays(requiredSize);

    if ( !this.#resizeNeeded ) return;

    // Resize the GPU buffer.
    const gl = this.gl;
    const tBuffer = this.attributeBufferInfo.attribs.aTextureIndex.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, tBuffer);

    // Use gl.bufferData instead of subData to reallocate the GPU memory to the new size.
    gl.bufferData(gl.ARRAY_BUFFER, this.textureIndicesArray, gl.DYNAMIC_DRAW);

    const aBuffer = this.attributeBufferInfo.attribs.aAlphaThreshold.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, aBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.alphaThresholdArray, gl.DYNAMIC_DRAW);

    this.#resizeNeeded = false;
  }

  _onShapeAdded(shape) {
    if ( !super._onShapeAdded(shape) ) return false;

    // Need direction, texture url, texture alphaThreshold
    // TODO: Fix
    const idx = shape.trackerIndex;

    // Assign the index to a texture url.
    const src = shape.textureURL;
    let texUnit = -1;
    for ( const { textureUnits, instances } of this.textureBatches ) {
      texUnit = textureUnits.indexOf(src);
      if ( !~texUnit ) {
        if ( textureUnits.length < 16 ) {
          // Add the geom's texture to this batch.
          texUnit = textureUnits.length;
          textureUnits.push(src);
        } else continue;
      }
      instances.add(idx);
      break;
    }
    if ( !~texUnit ) {
      texUnit = 0;
      this.textureBatches.push({ instances: new Set([idx]), textureUnits: [src] });
    }

    // Update the CPU array size if necessary.
    // (Save the GPU upload for later.)
    this._resizeTextureAttributeArrays(idx + 1); // Add 1 to account for 0-indexing.

    // Update the texture arrays.
    this.textureIndicesArray[idx] = texUnit;
  }

  // _onShapeUpdated(shape) {}

  // _onShapeRemoved(shape) {}



  prerender() {
    super.prerender();

    const instanceSet = this.renderSet
      .filter(shape => (shape instanceof this.primitiveClass) && this.modelMatrixTracker.hasId(shape.id))
      .map(shape => this.modelMatrixTracker.facetIdMap.get(shape.id))

    const maxInstance = Math.max(...instanceSet);
    this._ensureBufferCapacity(maxInstance + 1); // Add 1 to account for 0-indexing.

    // Upload the updated texture indices.
    const gl = this.gl;
    const tBuffer = this.attributeBufferInfo.attribs.aTextureIndex.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, tBuffer);

    // Only the portion relevant for these instances.
    const tDataSubArray = this.textureIndicesArray.subarray(0, maxInstance + 1);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, tDataSubArray);

    // Same for alpha threshold.
    const aBuffer = this.attributeBufferInfo.attribs.aAlphaThreshold.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, aBuffer);
    const aDataSubArray = this.alphaThresholdArray.subarray(0, maxInstance + 1);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, aDataSubArray);
  }

  _draw() {
    const gl = this.gl;
    const instanceSet = this.renderSet
      .filter(shape => (shape instanceof this.primitiveClass) && this.modelMatrixTracker.hasId(shape.id))
      .map(shape => this.modelMatrixTracker.facetIdMap.get(shape.id))

    // Construct the functions needed to advance the instance attributes.
    const advanceFns = [
      WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs.aModel, this.aModelAttribLoc),
      WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs.aTextureIndex, this.aTextureIndexLoc),
      WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs.aAlphaThreshold, this.aAlphaThresholdLoc),
    ];
    const nVertices = this.indicesArray.length;

    // No culling b/c the tile is viewable from both sides.
    this.webGL2.setCulling(false);

    // Draw the textures in batches.
    for ( const { instances, textureUnits } of this.textureBatches ) {
      // Bind the texture units for the batch.
      for ( let i = 0, iMax = textureUnits.length; i < iMax; i += 1 ) {
        const url = textureUnits[i];
        gl.activeTexture(gl.TEXTURE0 + i);

        // Use cached texture or an initialized fallback.
        const tex = this.textures.get(url) || this.#fallbackTexture;
        gl.bindTexture(gl.TEXTURE_2D, tex);
      }

      // Draw all the instances for this batch.
      const batchInstances = instanceSet.intersection(instances);

      // From super._draw.
      WebGL2.drawInstancedSet(
        gl,
        batchInstances,
        nVertices,
        advanceFns,
      );
    }
  }

  clearInstances() {
    super.clearInstances();
    this.textureBatches.length = 0;
    this.textureIndicesArray.fill(0);
    this.alphaThresholdArray.fill(0);
  }
}


/**
 * Handle directional walls
 */
const DirectionalWallMixin = superclass => class extends superclass {

  /** @type {Set<string>} */
  frontDirectional = new Set();

  /** @type {Set<string>} */
  backDirectional = new Set();

  /** @type {Set<string>} */
  biDirectional = new Set();

  _onShapeAdded(shape) {
    if ( !super._onShapeAdded(shape) ) return false;
    this._updateDirection(shape);
  }

  _onShapeUpdated(shape) {
    if ( !super._onShapeUpdated(shape) ) return false;
    this._updateDirection(shape);
  }

  _onShapeRemoved(shape) {
    if ( !super._onShapeRemoved(shape) ) return false;
    this._removeDirection(shape);
  }

  _updateDirection(shape) {
    this._removeDirection(shape);
    if ( shape.direction === QuadPrimitive.CULL_FACES.FRONT ) this.frontDirectional.add(shape);
    else if ( shape.direction === QuadPrimitive.CULL_FACES.BACK ) this.backDirectional.add(shape);
    else this.biDirectional.add(shape);
  }

  _removeDirection(shape) {
    this.frontDirectional.delete(shape);
    this.backDirectional.delete(shape);
    this.biDirectional.delete(shape);
  }

  _draw() {
    const webGL2 = this.webGL2;
    const { frontDirectional, backDirectional, biDirectional, renderSet } = this;

    const renderFront = this.renderSet.intersection(frontDirectional);
    const renderBack = this.renderSet.intersection(backDirectional);
    const renderBi = this.renderSet.intersection(biDirectional);

    if ( renderBi.size ) {
      webGL2.setCulling(false);
      this.renderSet = renderBi;
      super._draw();
    }
    if ( renderFront.size ) {
      webGL2.setCulling(true);
      webGL2.setCullFace("BACK");
      this.renderSet = renderFront;
      super._draw();
    }
    if ( renderBack.size ) {
      webGL2.setCulling(true);
      webGL2.setCullFace("FRONT");
      this.renderSet = renderBack;
      super._draw();
    }
    this.renderSet = renderSet;
  }
}

/**
 * Handle constrained token target drawing.
 * Uses a separate fragment shader to test whether a wall segment blocks the viewpoint.
 */
const ConstrainedTokenMixin = superclass => class extends superclass {

  static SHADER_VARIANT = super.SHADER_VARIANT | this.SHADER_FLAGS.CONSTRAINED;

  /** @type {number} */
  static NUM_CONSTRAINING_WALLS = 4; // Should be 6 or less to fit with maximum number of attributes.

  /**
   * Locate walls that intersect the token border.
   * @param {GeometricPrimitive} tokenShape
   * @returns {WallGeometry[]}
   */
  static intersectingWalls(tokenShape, levelId, senseType = "sight") {
    // For speed, take everything that crosses the token aabb.
    // Shrink by two pixels to avoid walls that simply are on the edge.
    using aabb = tokenShape.aabb.clone();
    aabb.min.x += 2;
    aabb.min.y += 2;
    aabb.min.z += 2;
    aabb.max.x -= 2;
    aabb.max.y -= 2;
    aabb.max.z -= 2;

    const wallMgr = CONFIG[GEOMETRY_LIB_ID].geometryManager.walls;
    const out = [];
    canvas.scene.walls.forEach(wallD => {
      const wallGeom = wallMgr.geomForDocument(wallD);
      if ( !wallGeom.blocksFromLevel(levelId) ) return;
      if ( wallGeom.iterateShapes({ senseType, levelId })
        .some(shape => aabb.overlapsConvexPolygon3d(shape.faces[0])) ) out.push(wallGeom);
    });

    // Sort by closest 2d segment to the 2d center.
    using ctr = tokenShape.center;
    out.sort((geom0, geom1) => {
      using s0 = WallGeometry.wallSegment2d(geom0.placeableDocument);
      using s1 = WallGeometry.wallSegment2d(geom1.placeableDocument);
      const distA = distanceSquaredToSegment(ctr, s0.a, s0.b);
      const distB = distanceSquaredToSegment(ctr, s1.a, s1.b);
      return distA - distB;
    });

    // TODO: Return QuadPrimitive instead of GEOM.
    return out;
  }

  _defineAttributeProperties() {
    const attrProps = super._defineAttributeProperties();
    const gl = this.gl;

    // Should use gl.vertexAttribIPointer.
    attrProps.aNumClipPlanes = {
      numComponents: 1,
      data: this.numClipPlanesArray,
      drawType: this.gl.DYNAMIC_DRAW,
      stride: Int32Array.BYTES_PER_ELEMENT * 1,
      offset: 0,
      divisor: 1,
    }

    // To avoid duplicating the buffer used for this.clipPlanesArray,
    // create the buffer first.
    const clipPlanesBuffer = twgl.createBufferFromTypedArray(
      gl,
      this.clipPlanesArray,
      gl.ARRAY_BUFFER,
      gl.DYNAMIC_DRAW,
    );

    // Map each index of the GLSL array to the shared buffer.
    for ( let i = 0; i < this.constructor.NUM_CONSTRAINING_WALLS; i += 1 ) {
      // To jump from instance A to instance B, stride must cover all planes for instance A.
      // To find, e.g., aClipPlanes[1] for a given instance, offset by a single plane (4 floats).
      attrProps[`aClipPlanes_${i}`] = {
        numComponents: 4,                 // Each plane is a vec4.
        buffer: clipPlanesBuffer,         // Point to the shared buffer.
        type: this.gl.FLOAT,              // Required when passing a buffer instead instead of "data" property.
        drawType: this.gl.DYNAMIC_DRAW,
        stride: Float32Array.BYTES_PER_ELEMENT * (this.constructor.NUM_CONSTRAINING_WALLS * 4),
        offset: Float32Array.BYTES_PER_ELEMENT * (i * 4),
        divisor: 1,
      };
    }
    return attrProps;
  }

  /** @type {FixedLengthTrackingBuffer} */
  clipPlanesTracker = new FixedLengthTrackingBuffer({ facetLengths: 4 * this.constructor.NUM_CONSTRAINING_WALLS });

  /** @type {FixedLengthTrackingBuffer} */
  numClipPlanesTracker = new FixedLengthTrackingBuffer({ type: Int32Array, facetLengths: 1 });

  /**
   * Track the ids whose clip tracker buffer must  be uploaded before rendering.
   * @type {Set<string>}
   */
  idsToUpdateClipPlanes = new Set();

  /**
   * Track the layoutVersion of the clipPlanesTracker.
   * When it changes, the entire buffer must be updated.
   * @type {number}
   */
  clipPlanesLayoutVersion = 0;

  /**
   * Track the data version of the clipPlanesTracker.
   * When it changes, the buffer for that id must be updated.
   * @type {Map<string, number>}
   */
  clipPlanesUpdateTracker = new Map();

  /** @type {Float32Array} */
  get clipPlanesArray() { return this.clipPlanesTracker.viewWholeBuffer(); }

  /** @type {Int32Array} */
  get numClipPlanesArray() { return this.clipPlanesTracker.viewWholeBuffer(); }

  levelId = "";

  senseType = "sight";

  _onShapeAdded(shape) {
    if ( !super._onShapeAdded(shape) ) return false;
    const wallGeoms = this.constructor.intersectingWalls(shape, this.levelId, this.senseType);
    this._setClippingWallPlanes(shape, wallGeoms);
    this.idsToUpdateClipPlanes.add(shape.id);
  }

  _onShapeUpdated(shape) {
    if ( !super._onShapeUpdated(shape) ) return false;
    const wallGeoms = this.constructor.intersectingWalls(shape, this.levelId, this.senseType);
    this._setClippingWallPlanes(shape, wallGeoms);
    this.idsToUpdateClipPlanes.add(shape.id);
  }

  _onShapeRemoved(shape) {
    if ( !super._onShapeRemoved(shape) ) return false;
    const id = shape.id;
    this.numClipPlanesTracker.deleteFacet(id);
    this.clipPlanesTracker.deleteFacet(id);
  }

  _setClippingWallPlanes(shape, wallGeoms) {
    using ctr = shape.center;

    // Define the normals representing planes.
    // All wall segment geoms share the same plane.
    const maxWalls = this.constructor.NUM_CONSTRAINING_WALLS;
    const numClipPlanes = Math.min(maxWalls, wallGeoms.length);
    const id = shape.id;
    const clipPlanes = new Float32Array(4 * this.constructor.NUM_CONSTRAINING_WALLS);
    for ( let i = 0; i < numClipPlanes; i += 1 ) {
      const wallGeom = wallGeoms[i];
      const plane = wallGeom.segmentGeoms[0].faces[0].plane;
      const n = plane.normal;
      const d = plane.constant;

      // Force the plane to face the token center.
      const mult = -Math.sign(plane.whichSide(ctr)) || -1;
      const j = i * 4;
      clipPlanes[j] = n.x * mult;
      clipPlanes[j + 1] = n.y * mult;
      clipPlanes[j + 2] = n.z * mult;
      clipPlanes[j + 3] = d * mult;
    }

    // Update the trackers.
    this.numClipPlanesTracker.updateFacet(id, { newValues: [numClipPlanes] });
    this.clipPlanesTracker.updateFacet(id, { newValues: clipPlanes });
  }

  // ----- NOTE: numClipPlanes buffer updating ----- //

  /**
   * Update the model buffer only as needed.
   * May update the entire buffer if it needs to be resize.
   * Otherwise will update the ids marked as requiring an update.
   */
  updateClipPlanesBuffer() {
    if ( this.clipPlanesLayoutVersion !== this.clipPlanesTracker.layoutVersion ) {
      this._resizeClipPlanesBuffer();
      this.clipPlanesLayoutVersion = this.clipPlanesUpdateTracker.layoutVersion;
    } else this.idsToUpdateClipPlanes.forEach(id => this._updateClipPlanesBufferForId(id));
    this.idsToUpdateClipPlanes.clear();
  }

  /**
   * Resize and update the entire model buffer on the GPU.
   */
  _resizeClipPlanesBuffer() {
    const gl = this.gl;

    // Clip planes buffer
    // Resize the GPU buffer.
    // Use gl.bufferData instead of subData to reallocate the GPU memory to the new size.
    for ( let i = 0; i < this.constructor.NUM_CONSTRAINING_WALLS; i += 1 ) {
      const cBuffer = this.attributeBufferInfo.attribs[`aClipPlanes_${i}`].buffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.clipPlanesArray, gl.DYNAMIC_DRAW);
    }

    // Number of clip planes buffer
    const ncBuffer = this.attributeBufferInfo.attribs.aNumClipPlanes.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, ncBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.numClipPlanesArray, gl.DYNAMIC_DRAW);

    /*
    // Update the model attribute with a new buffer.
    this.attributeProperties.aModel.data = this.modelMatrixArray;
    const attribs = this.attributeBufferInfo.attribs;
    attribs.aModel = twgl.createAttribsFromArrays(this.gl, { aModel: this.attributeProperties.aModel }).aModel;

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
    this.debugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.debugProgramInfo, attribs);
    */
  }

  /**
   * Update the model buffer on the GPU for a specific id.
   * TODO: Use applyConsecutively to update in larger chunks.
   * @param {string} id
   */
  _updateClipPlanesBufferForId(id) {
    const gl = this.gl;

    // Clip planes buffer
    const cpTracker = this.clipPlanesTracker;
    const cpOffset = cpTracker.facetOffsetAtId(id) + cpTracker.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    for ( let i = 0; i < this.constructor.NUM_CONSTRAINING_WALLS; i += 1 ) {
      const cpBuffer = this.attributeBufferInfo.attribs[`aClipPlanes_${i}`].buffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, cpBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, cpOffset, cpTracker.viewFacetById(id));
    }


    // Number of clip planes buffer
    const ncTracker = this.numClipPlanesTracker;
    const ncBuffer = this.attributeBufferInfo.attribs.aNumClipPlanes.buffer;
    const ncOffset = ncTracker.facetOffsetAtId(id) + ncTracker.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    gl.bindBuffer(gl.ARRAY_BUFFER, ncBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, ncOffset, ncTracker.viewFacetById(id));
  }

  // ----- NOTE: Rendering ----- //

  /**
   * Prerender triggers updates to the GPU data for shapes in the render set.
   */
  prerender() {
    super.prerender();
    this.updateClipPlanesBuffer();
  }
}

export class ConstrainedInstancedDrawable extends mix(InstancedDrawable).with(ConstrainedTokenMixin) {}


// Currently constrained with model drawable is not needed.
// export class ConstrainedModelDrawable extends mix(ModelDrawable).with(ConstrainedTokenMixin) {}
// export class ConstrainedMultiModelDrawable extends mix(MultiModelDrawable).with(ConstrainedTokenMixin) {}

export class DirectionalInstancedDrawable extends mix(InstancedDrawable).with(DirectionalWallMixin) {}

/**
 * Identify the t-value on segment A|B closest to C.
 * @param {Point} c     The reference point C
 * @param {Point} a     Point A on segment AB
 * @param {Point} b     Point B on segment AB
 * @returns {number}    T-value, where 0 is a and 1 is b. Negative numbers are before a; >1 is after b.
 * @see {@link https://en.wikipedia.org/wiki/Distance_from_a_point_to_a_line#Line_defined_by_two_points}
 */
/*
function closestPointToSegmentT(c, a, b) {
  using d = b.subtract(a);
  if ( d.x === 0 && d.y === 0 ) return 0;

  using ca = c.subtract(a);
  return ca.dot(d) / d.dot(d);
}
*/

/**
 * Distance squared to a segment A|B.
 * @param {Point} c     The reference point C
 * @param {Point} a     Point A on segment AB
 * @param {Point} b     Point B on segment AB
 * @returns {number}
 */

function distanceSquaredToSegment(c, a, b) {
  if ( a.almostEqual(b) ) return PIXI.Point.distanceBetweenSquared(a, c);
  const x = a.almostEqual(b) ? a : foundry.utils.closestPointToSegment(c, a, b);
  return PIXI.Point.distanceSquaredBetween(x, c);
}
