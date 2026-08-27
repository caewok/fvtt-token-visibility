/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


// webGL2
import * as twgl from "./twgl.js";
import { WebGL2 } from "./WebGL2.js";

import { GEOMETRY_LIB_ID } from "../../geometry/const.js";
import { QuadPrimitive } from "../../geometry/placeable_geometry/InstancedGeometricPrimitive.js";
import { mix } from "../../geometry/mixwith.js";
import { FixedLengthTrackingBuffer, VerticesIndicesTrackingBuffer } from "../../geometry/placeable_tracking/TrackingBuffer.js";

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


/**
 * Manage the state of a given webGL buffer and associated tracker.
 */
class BufferChannel {
  /** @type {WebGL2RenderingContext} */
  gl;

  /** @type {string} */
  attribName;

  /** @type {VariableLengthTrackingBuffer} */
  tracker;

  /** @type {function} */
  dataExtractor; // E.g., shape => ({ newValues: shape.modelMatrix.model.arr })

  /** @type {function} */
  bufferExtractor; // E.g., attributeBufferInfo => attributeBufferInfo.attribs.aModel.buffer

  /** @type {number} */
  layoutVersion = 0;

  /** @type {Set<string>} */
  dirtyIds = new Set();

  /** @type {Map<string, number} */
  dataVersions = new Map(); // shape.id : update counter

  /** @type {gl.BUFFER_TYPE} */
  bufferType;



  /**
   * @param {WebGL2RenderingContext} gl              WebGL2 context
   * @param {string} attribName                      Attribute name; "indices" treated special
   * @param {VariableLengthTrackingBuffer} tracker   Tracking buffer for this attribute's data
   * @param {function} dataExtractor                 How to extract data from a tracked object
   * @param {function} changeTest                    Test whether a tracked object has changed
   */
  constructor(gl, attribName, tracker, dataExtractor, dataChanged) {
    this.gl = gl;
    this.attribName = attribName;
    this.tracker = tracker;
    this.dataExtractor = dataExtractor;
    if ( dataChanged ) this.dataChanged = dataChanged;

    // Treat indices a bit differently due to the structure of the attributeInfo object.
    if ( attribName === "indices" ) {
      this.bufferExtractor = info => info.indices;
      this.bufferType = this.gl.ELEMENT_ARRAY_BUFFER;
    } else {
      this.bufferExtractor = info => info.attribs[this.attribName].buffer;
      this.bufferType = this.gl.ARRAY_BUFFER;
    }

    // Sync update counters for each id that is tracked.
    this._syncAllIds();
  }

  /**
   * @param {object} dataObject
   * @returns {number[]|TypedArray|null} The new data if the data differs from what is in the tracker.
   */
  dataChanged(dataObject) {
    const newData = this.dataExtractor(dataObject);
    const storedData = this.tracker.viewFacetById(dataObject.id);
    const n = storedData.length;
    if ( newData.length !== n ) return newData;
    for ( let i = 0; i < n; i += 1 ) {
      if ( newData[i] !== storedData[i] ) return newData;
    }
    return null;
  }

  /**
   * Add data from a specific data object to the tracker.
   * @param {object} dataObject     Must have an id property and be understood by dataExtractor
   */
  addData(dataObject) {
    this.tracker.addFacet({ id: dataObject.id, newValues: this.dataExtractor(dataObject) });
  }

  /**
   * Update data from a specific data object to the tracker.
   * @param {object} dataObject     Must have an id property and be understood by dataExtractor
   */
  updateData(dataObject) {
    const newValues = this.dataChanged(dataObject, this);
    if ( !newValues ) return;
    this.tracker.updateFacet(dataObject.id, { newValues });
  }

  /**
   * Remove data from a specific data object to the tracker.
   * @param {object} dataObject     Must have an id property and be understood by dataExtractor
   */
  removeData(dataObject) {
    const id = dataObject.id;
    this.tracker.deleteFacet(dataObject.id);
    this.dataVersions.delete(id);
  }

  /**
   * Sync the provided buffer with this tracking data.
   * @param {twgl.BufferInfo}
   */
  sync(attributeBufferInfo) {
    if (this.layoutVersion !== this.tracker.layoutVersion) {
      this.resizeBuffer(attributeBufferInfo);
      this.layoutVersion = this.tracker.layoutVersion;
    } else {
      for ( const [id, updateCounter] of this.tracker.facetChangeTracker.entries() ) {
        if ( updateCounter !== this.dataVersions.get(id) ) this.updateBufferForId(id, attributeBufferInfo);
      }
    }
  }

  /**
   * Sync update counters for each id that is tracked.
   */
  _syncAllIds() {
    for ( const [id, updateCounter] of this.tracker.facetChangeTracker.entries() ) {
      this.dataVersions.set(id, updateCounter);
    }
  }

  /**
   * Resize the provided buffer with this tracking data.
   * @param {twgl.BufferInfo}
   */
  resizeBuffer(attributeBufferInfo) {
    const buffer = this.bufferExtractor(attributeBufferInfo);
    const bufferType = this.bufferType;
    this.gl.bindBuffer(bufferType, buffer);
    this.gl.bufferData(bufferType, this.tracker.viewWholeBuffer(), this.gl.DYNAMIC_DRAW);
    console.debug(`Resizing buffer for ${this.attribName}`, this.tracker.viewWholeBuffer());

    // Entire buffer is updated, so every tracked id is updated.
    this._syncAllIds();
  }

  /**
   * Sync the provided buffer with this tracking data for a given id.
   * @param {string} id
   * @param {twgl.BufferInfo}
   */
  updateBufferForId(id, attributeBufferInfo) {
    const buffer = this.bufferExtractor(attributeBufferInfo);
    const bufferType = this.bufferType;
    const offset = this.tracker.facetOffsetAtId(id) * this.tracker.type.BYTES_PER_ELEMENT;
    this.gl.bindBuffer(bufferType, buffer);
    this.gl.bufferSubData(bufferType, offset, this.tracker.viewFacetById(id));
    console.debug(`Updating buffer for ${this.attribName} at ${id}`, this.tracker.viewFacetById(id));

    // Mark this id as updated.
    this.dataVersions.set(id, this.tracker.facetChangeTracker.get(id));
  }
}



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
  get modelMatrixArray() { return new Error(`${this.constructor.name}|modelMatrix getter must be defined by child class.`); }

  /** @type {object<number>} */
  aModelAttribLoc = { program: 0, debug: 0 };

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
    this.aModelAttribLoc.program = this.gl.getAttribLocation(this.programInfo.program, 'aModel');
    this.aModelAttribLoc.debug = this.gl.getAttribLocation(this.debugProgramInfo.program, 'aModel');
    return attrProps;
  }

  // ----- NOTE: Shape lifecycle ----- //

  /**
   * The set of shape ids tracked by this drawable.
   * @type {Map<string, ids>}
   */
  trackedIds = new Map();

  /**
   * Add a geometric shape to this drawable.
   * @param {GeometricPrimitive} shape
   * @returns {boolean} True if successfully added or updated.
   */
  addGeometricShape(shape) {
    const id = shape.id;
    if ( this.trackedIds.has(id) ) return this.updateGeometricShape(shape);
    console.debug(`Adding shape ${shape.id}`);

    const added = this._onShapeAdded(shape);
    if ( added ) this.trackedIds.set(id, shape);
    return added;
  }

  /**
   * Update an existing geometric shape in this drawable.
   * @param {GeometricPrimitive} shape
   * @returns {boolean} True if successfully added or updated.
   */
  updateGeometricShape(shape) {
    if ( !shape ) return;
    const id = shape.id;
    if ( !this.trackedIds.has(id) ) return this.addGeometricShape(shape);
    console.debug(`Updating shape ${shape.id}`);
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
    console.debug(`Removing shape ${shape.id}`);
    return this._onShapeRemoved(shape);
  }

  /**
   * Add data from the shape to various tracking buffers, if any.
   * @param {GeometricPrimitive} shape
   * @returns {boolean} True if it was added
   */
  _onShapeAdded(shape) {
    let added = false;
    for ( const channel of this.bufferChannels.values() ) {
      channel.addData(shape);
      added = true;
    }
    return added;
  }

  /**
   * Update data from the shape in various tracking buffers, if any.
   * @param {GeometricPrimitive} shape
   * @returns {boolean} True if it was updated (or added)
   */
  _onShapeUpdated(shape) {
    let updated = false;
    for ( const channel of this.bufferChannels.values() ) {
      channel.updateData(shape);
      updated = true;
    }
    return updated;
  }
  _onShapeRemoved(shape) {
    let deleted = false;
    for ( const channel of this.bufferChannels.values() ) {
      channel.removeData(shape);
      deleted = true;
    }
    return deleted;
  }

  // ----- NOTE: Generic buffer synchronization ---- //

  /** @type {Map<string, BufferChannel>} */
  bufferChannels = new Map();

  /**
   * Register a buffer tracker for a given attribute.
   * @param {string} attribName
   * @param {VariableLengthTrackingBuffer} tracker
   * @param {function} dataExtractor
   * @param {function} dataVersionExtractor
   */
  registerBufferChannel(attribName, tracker, dataExtractor, dataChanged) {
    const channel = new BufferChannel(this.gl, attribName, tracker, dataExtractor, dataChanged);
    this.bufferChannels.set(attribName, channel);
  }

  /**
   * Trigger the update of GPU buffers from CPU trackers.
   */
  updateBuffers() {
    for ( const channel of this.bufferChannels.values() ) channel.sync(this.attributeBufferInfo);
  }


  // ----- NOTE: Rendering ----- //

  /**
   * The render set stores shapes to be rendered.
   * When render is called, prerender will upload changes for the shape as needed.
   * To lock in the shape model, call prerender manually after adding shapes.
   * @type {Set<string>}
   */
  _renderSet = new Set();

  addToRenderSet(shape) {
    this.addGeometricShape(shape);
    this._renderSet.add(shape.id);
  }

  removeFromRenderSet(shape) { this._renderSet.delete(shape.id); }

  clearRenderSet() { this._renderSet.clear(); }

  /**
   * Prerender triggers updates to the GPU data as needed prior to rendering.
   */
  prerender() {
    // Handled by addToRenderSet.
    // this._renderSet.forEach(id => this.updateGeometricShape(this.trackedIds.get(id)));
    this.updateBuffers();
  }

  /**
   * Draw all placeables in the instance set, using the current webGL settings.
   */
  render(debug = false) {
    if ( !this._renderSet.size ) return;

    console.debug(`Drawable ${this.constructor.name}|Render. Debug? ${debug}`);

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

  get renderSet() { return this._renderSet; }

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

    this.registerBufferChannel(
      "aModel",
      this.modelMatrixTracker,
      shape => shape.modelMatrix.model.arr,
      (shape, channel) => {
        if ( channel.dataVersions.get(shape.id) === shape.modelMatrix.dataVersion ) return null;
        return channel.dataExtractor(shape);
      }
    );
  }

  /** @type {Float32Array} */
  get verticesArray() { return this.primitiveClass.instanceVO.vertices; }

  /** @type {Uint16Array} */
  get indicesArray() { return this.primitiveClass.instanceVO.indices; }

  get modelMatrixArray() { return this.modelMatrixTracker.viewWholeBuffer(); }


  // ----- NOTE: Shape and model tracking ----- //

  modelMatrixTracker = new FixedLengthTrackingBuffer({ facetLengths: 16 });

  /**
   * Add a geometric shape's model to this drawable.
   * The modelUpdateTracker links ids to indices.
   * @param {GeometricPrimitive} shape
   */
  _onShapeAdded(shape) {
    if ( !(shape instanceof this.primitiveClass ) ) return false;
    return super._onShapeAdded(shape);
  }

  // ----- NOTE: Rendering ----- //

  /** @type {Set<GeometricPrimitive>} */
  get renderSet() {
    // Shapes that do not belong to this primitive are ignored.
    return super.renderSet
      .filter(id => (this.trackedIds.get(id) instanceof this.primitiveClass) && this.modelMatrixTracker.hasId(id))
  }

  /**
   * Indices of the renderSet shapes.
   * @param {Set<GeometricShape>} renderSet
   * @returns {Set<number>}
   */
  getInstanceSet(renderSet) {
    renderSet ??= this.renderSet;
    return renderSet.map(id => this.modelMatrixTracker.facetIdMap.get(id));
  }

  /**
   * Draw a specific set of instances.
   * @param {Set<number>} instances
   */
  _draw(instances) {
    instances ??= this.getInstanceSet();
    if ( !instances.size ) return;

    const nVertices = this.indicesArray.length;
    const aModelAttribLoc = this.debugView ? this.aModelAttribLoc.debug : this.aModelAttribLoc.program;
    WebGL2.drawInstancedMatrixSet(
      this.gl,
      instances,
      nVertices,
      this.attributeBufferInfo.attribs.aModel,
      aModelAttribLoc,
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
    return this.modelVersion !== shape.modelMatrix.dataVersion;
  }

  /**
   * Update the model buffer only as needed.
   * May update the entire buffer if it needs to be resized.
   * Otherwise will update the ids marked as requiring an update.
   */
  updateBuffers() {
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

  constructor(opts) {
    super(opts);

    this.registerBufferChannel(
      "aPosition", // Also the buffer for aNormal
      this.viTracker.vertices,
      shape => shape.modelVO.vertices,
      (shape, channel) => channel.dataExtractor(shape), // Always update
    );
    this.registerBufferChannel(
      "indices",
      this.viTracker.indices,         // Tracker.
      shape => shape.modelVO.indices, // Data.
      (shape, channel) => channel.dataExtractor(shape), // Always update
    );
    this.registerBufferChannel(
      "aModel",
      this.modelMatrixTracker,
      shape => shape.modelMatrix.model.arr,

      // Use simpler test to check if the model data changed.
      (shape, channel) => {
        if ( channel.dataVersions.get(shape.id) === shape.modelMatrix.dataVersion ) return null;
        return channel.dataExtractor(shape);
      }
    );
  }

  // ----- NOTE: Tracking ----- //

  viTracker = new VerticesIndicesTrackingBuffer({ stride: 6 }); // Stride is Position + Normal

  modelMatrixTracker = new FixedLengthTrackingBuffer({ facetLengths: 16 });

  /** @type {Float32Array} */
  get verticesArray() { return this.viTracker.vertices.viewWholeBuffer(); }

  /** @type {Uint16Array} */
  get indicesArray() { return this.viTracker.indices.viewWholeBuffer(); }

  /** @type {Float32Array} */
  get modelMatrixArray() { return this.modelMatrixTracker.viewWholeBuffer(); }

  /**
   * Update the geometric shape's model for this drawable.
   * @param {GeometricPrimitive} shape
   */
  _onShapeUpdated(shape) {
    // Update vertices data. If we already have this data, no need to update it.
    // Ensure these two are updated together.
    let res = false;
    if ( this.bufferChannels.aPosition.dataVersions.get(shape.id) !== shape.modelVerticesVersion ) {
      this.bufferChannels.aPosition.updateData(shape);
      this.bufferChannels.indices.updateData(shape);
      res = true;
    };

    return res;
  }


  // ----- NOTE: Rendering ----- //
  get renderSet() {
    // Get the indices for each shape in the render set.
    // Shapes that do not belong to this primitive are ignored.
    return super.renderSet
      .filter(id => this.modelMatrixTracker.hasId(id))
  }

  /**
   * Indices of the renderSet shapes.
   * @returns {number}
   */
  getInstanceSet() { return this.renderSet.map(id => this.modelMatrixTracker.facetIdMap.get(id));}

  /**
   * Draw a specific set of instances.
   * @param {Set<number>} instances
   */
  _draw(instances) {
    instances ??= this.getInstanceSet();
    if ( !instances.size ) return;

    const nVertices = this.indicesArray.length;
    const aModelAttribLoc = this.debugView ? this.aModelAttribLoc.debug : this.aModelAttribLoc.program;
    WebGL2.drawInstancedMatrixSet(
      this.gl,
      instances,
      nVertices,
      this.attributeBufferInfo.attribs.aModel,
      aModelAttribLoc,
    );
  }
}

export class TexturedInstancedDrawable extends InstancedDrawable {

  static SHADER_VARIANT = super.SHADER_VARIANT | this.SHADER_FLAGS.TEXTURED;

  /** @type {boolean} */
  static TEXTURED = true;

  /** @type {number} */
  static stride = 8; // Position (3) + Normal (3) + UV (2)

  constructor(opts) {
    super(opts);

    this.registerBufferChannel(
      "aAlphaThreshold",
      this.alphaThresholdTracker,
      shape => [shape.alphaThreshold],
    );

    this.registerBufferChannel(
      "aTextureIndex",
      this.textureIndexTracker,
      shape => [this.textureData.indexMap.get(shape.textureURL)?.index || 0],
    );
  }

  // ----- NOTE: Attributes ----- //

  alphaThresholdTracker = new FixedLengthTrackingBuffer({ facetLengths: 1 });

  get alphaThresholdArray() { return this.alphaThresholdTracker.viewWholeBuffer(); }

  textureIndexTracker = new FixedLengthTrackingBuffer({ facetLengths: 1, type: Int32Array });

  get textureIndexArray() { return this.textureIndexTracker.viewWholeBuffer(); }

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
      stride: Float32Array.BYTES_PER_ELEMENT * 1,
      divisor: 1, // CRITICAL: This tells WebGL it is a per-instance attribute
    }

    // Texture index, handled by this class.
    attrProps.aTextureIndex = {
      numComponents: 1, // It's just a single int (0 to 15)
      data: this.textureIndexArray,
      type: this.gl.INT, // Force WebGL to use vertexAttribIPointer,
      drawType: this.gl.DYNAMIC_DRAW, // We will update this every frame/batch
      divisor: 1, // CRITICAL: This tells WebGL it is a per-instance attribute
    };

    // For use in _draw method.
    this.aTextureIndexLoc.program = this.gl.getAttribLocation(this.programInfo.program, 'aTextureIndex');
    this.aAlphaThresholdLoc.program = this.gl.getAttribLocation(this.programInfo.program, 'aAlphaThreshold');

    this.aTextureIndexLoc.debug = this.gl.getAttribLocation(this.debugProgramInfo.program, 'aTextureIndex');
    this.aAlphaThresholdLoc.debug = this.gl.getAttribLocation(this.debugProgramInfo.program, 'aAlphaThreshold');

    return attrProps;
  }

  // Because tiles are always quads, don't need to worry about expanding model vertices/indices.

  // ----- NOTE: Textures ----- //

  #fallbackTexture;

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
    this.textureData.sourceMap.set("", this.#fallbackTexture);

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

  /** @type {object<number>} */
  aTextureIndexLoc = { program: 0, debug: 0 };

  /** @type {object<number>} */
  aAlphaThresholdLoc = { program: 0, debug: 0 };

  // ----- NOTE: Texture batching ------ //

  /**
   * Link a specific texture url to a specific batch index.
   * @type {string[][]} Batch and index number.
   */
  textureData = {
    batchIndices: [[]], /** @type {url[15][]} */
    sourceMap: new Map(), /** @type {Map<url, WebGLTexture>} */
    indexMap: new Map(), /** @type {Map<url, { batch: number, index: number}>} */
    idMap: new Map(), /** @type {Map<string, url>} */
  }

  /**
   * Add a texture to the tracking set.
   * @param {GeometricPrimitive} shape
   * @returns {object}
   * - @prop {number} index
   * - @prop {number} batch
   */
  trackTexture(shape) {
    const id = shape.id;
    if ( this.textureData.idMap.has(id) ) return;

    const src = shape.textureURL;
    this.textureData.idMap.set(id, src);
    if ( this.textureData.indexMap.has(src) ) return;

    this._initializeWebGLTexture(shape);
    this.addToNextTextureSlot(src);
  }

  /**
   * @returns {object<batch: {number}, index: {number}>}
   */
  addToNextTextureSlot(src) {
    const batchIndices = this.textureData.batchIndices;
    const numBatches = batchIndices.length;
    for ( let batch = 0; batch < numBatches; batch += 1 ) {
      const batchArr = batchIndices[batch];
      const index = batchArr.length;
      if ( index < 16 ) {
        batchArr.push(src);
        return;
      }
    }
    batchIndices.push([src]);
    const slot = { batch: numBatches, index: 0 };
    this.textureData.indexMap.set(src, slot);
  }

  _initializeWebGLTexture(shape) {
    const src = shape.textureURL;
    if ( this.textureData.sourceMap.has(src) ) return;

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
    this.textureData.sourceMap.set(src, twgl.createTexture(this.gl, textureOpts));
  }


  // ----- NOTE: Shape and model tracking ----- //

  _onShapeAdded(shape) {
    if ( !super._onShapeAdded(shape) ) return false;

    // Track this shape's texture information, for batch drawing of the textures.
    this.trackTexture(shape);

    return true;
  }

  _onShapeUpdated(shape) {
    // Did this source change? If so, its index likely changed.
    if ( this.textureData.idMap.get(shape.id) !== shape.textureURL ) this.trackTexture(shape);
    return super._onShapeUpdated(shape);
  }

  // _onShapeRemoved(shape) {} // Keep the indexed texture url indefinitely.

  getInstanceSet(renderSet, batchURLs) {
    const batchRenderSet = new Set();
    for ( const id of renderSet ) {
      const shape = this.trackedIds.get(id);
      if ( !shape ) continue;
      const src = shape.textureURL;
      if ( batchURLs.has(src) ) batchRenderSet.add(id);
    }
    return super.getInstanceSet(batchRenderSet);
  }

  _draw() {
    const gl = this.gl;
    const renderSet = this.renderSet;

    // Construct the functions needed to advance the instance attributes.
    const aModelAttribLoc = this.debugView ? this.aModelAttribLoc.debug : this.aModelAttribLoc.program;
    const aTextureIndexLoc = this.debugView ? this.aTextureIndexLoc.debug : this.aTextureIndexLoc.program;
    const aAlphaThresholdLoc = this.debugView ? this.aAlphaThresholdLoc.debug : this.aAlphaThresholdLoc.program;
    const advanceFns = [
      WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs.aModel, aModelAttribLoc),
      WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs.aTextureIndex, aTextureIndexLoc),
      WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs.aAlphaThreshold, aAlphaThresholdLoc),
    ];
    const nVertices = this.indicesArray.length;

    // No culling b/c the tile is viewable from both sides.
    this.webGL2.setCulling(false);

    // Draw the textures in batches.
    for ( let i = 0, n = this.textureData.batchIndices.length; i < n; i += 1 ) {
      const batchURLArray = this.textureData.batchIndices[i];
      for ( let i = 0, iMax = batchURLArray.length; i < iMax; i += 1 ) {
        const url = batchURLArray[i];
        gl.activeTexture(gl.TEXTURE0 + i);

        // Use cached texture or an initialized fallback.
        const tex = this.textureData.sourceMap.get(url) || this.#fallbackTexture;
        gl.bindTexture(gl.TEXTURE_2D, tex);
      }

      // Determine which instances, of the entire instance set, we can draw with this batch of textures.
      const batchURLs = new Set(batchURLArray);
      const batchInstances = this.getInstanceSet(renderSet, batchURLs);
      if ( !batchInstances.size ) break;

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
    this.textureData.batchIndices.length = 0;
    this.textureData.sourceMap.clear();
    this.textureData.indexMap.clear();
    this.textureData.idMap.clear();
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
    return true;
  }

  _onShapeUpdated(shape) {
    if ( !super._onShapeUpdated(shape) ) return false;
    this._updateDirection(shape);
    return true;
  }

  _onShapeRemoved(shape) {
    if ( !super._onShapeRemoved(shape) ) return false;
    this._removeDirection(shape);
    return true;
  }

  _updateDirection(shape) {
    const id = shape.id;
    this._removeDirection(id);
    if ( shape.direction === QuadPrimitive.CULL_FACES.FRONT ) this.frontDirectional.add(id);
    else if ( shape.direction === QuadPrimitive.CULL_FACES.BACK ) this.backDirectional.add(id);
    else this.biDirectional.add(id);
  }

  _removeDirection(shape) {
    const id = shape.id;
    this.frontDirectional.delete(id);
    this.backDirectional.delete(id);
    this.biDirectional.delete(id);
  }

  getInstanceSet(directionSet) {
    const renderSet = this.renderSet;
    const ixSet = renderSet.intersection(directionSet);
    return super.getInstanceSet(ixSet);
  }

  _draw(_instances) {
    const webGL2 = this.webGL2;
    const { frontDirectional, backDirectional, biDirectional } = this;

    // Bidirectional
    webGL2.setCulling(false);
    super._draw(this.getInstanceSet(biDirectional));

    // Front
    webGL2.setCulling(true);
    webGL2.setCullFace("BACK");
    super._draw(this.getInstanceSet(frontDirectional));

    // Back
    webGL2.setCulling(true);
    webGL2.setCullFace("FRONT");
    super._draw(this.getInstanceSet(backDirectional));
  }
}

/**
 * Handle constrained token target drawing.
 * Uses a separate fragment shader to test whether a wall segment blocks the viewpoint.
 * The shader tests if a 2d ray from the fragment location to the token center intersects the 2d wall.
 */
const ConstrainedTokenMixin = superclass => class extends superclass {

  static SHADER_VARIANT = super.SHADER_VARIANT | this.SHADER_FLAGS.CONSTRAINED;

  /** @type {number} */
  static NUM_CONSTRAINING_WALLS = 5; // Should be 6 or less to fit with maximum number of attributes.

  /**
   * Locate walls that intersect the token border.
   * @param {GeometricPrimitive} tokenShape
   * @returns {number[][]} Array of [x1, y1, x2, y2]
   */
  static intersectingWallSegments(tokenShape, levelId, senseType = "sight") {
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
      if ( !wallGeom.constructor.couldBlock(wallD, { levelId, senseType: "move" }) ) return;

      // For each wall, we ultimately only need the plane from the wall.
      for ( const shape of wallGeom.iterateShapes({ senseType, levelId }) ) {
        const testFace = shape.faces[0];
        if ( aabb.overlapsConvexPolygon3d(testFace) ) {
          const wallD = wallGeom.placeableDocument;
          out.push({ plane: testFace.plane, coords: wallD.c });
          break;
        }
      }
    });

    // Sort by closest plane to the center of the token.
    using ctr = tokenShape.center;
    out.sort((obj0, obj1) => obj0.plane.distanceToPoint(ctr) - obj1.plane.distanceToPoint(ctr));
    return out.map(obj => obj.coords);
  }

  constructor(opts) {
    super(opts);

    this.registerBufferChannel(
      "aNumClipPlanes",
      this.numClipPlanesTracker,
      shape => [this._calculateNumberClippingPlanes(shape)],
    );

    this.registerBufferChannel(
      "aClipPlanes_0",
      this.clipPlanesTracker,
      shape => this._calculateClippingWallPlanes(shape),
    );

    this.registerBufferChannel(
      "aTokenCenter",
      this.tokenCenterTracker,
      shape => {
        const ctr = shape.center;
        return [ctr.x, ctr.y];
      },
    );
  }

  _defineAttributeProperties() {
    const attrProps = super._defineAttributeProperties();
    const gl = this.gl;

    // Should use gl.vertexAttribIPointer.
    attrProps.aNumClipPlanes = {
      numComponents: 1,
      data: this.numClipPlanesArray,
      type: this.gl.INT, // Force WebGL to use glVertexAttribIPointer.
      drawType: this.gl.DYNAMIC_DRAW,
      stride: Int32Array.BYTES_PER_ELEMENT * 1,
      offset: 0,
      divisor: 1,
    };

    attrProps.aTokenCenter = {
      numComponents: 2,
      data: this.tokenCenterArray,
      type: this.gl.FLOAT,
      drawType: this.gl.DYNAMIC_DRAW,
      stride: Float32Array.BYTES_PER_ELEMENT * 2,
      offset: 0,
      divisor: 1,
    };

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

    this.aTokenCenterLoc.program = this.gl.getAttribLocation(this.programInfo.program, "aTokenCenter");
    this.aNumClipPlanesLoc.program = this.gl.getAttribLocation(this.programInfo.program, "aNumClipPlanes");

    this.aTokenCenterLoc.debug = this.gl.getAttribLocation(this.debugProgramInfo.program, "aTokenCenter");
    this.aNumClipPlanesLoc.debug = this.gl.getAttribLocation(this.debugProgramInfo.program, "aNumClipPlanes");

    this.aClipPlanesLocs.program.length = this.constructor.NUM_CONSTRAINING_WALLS;
    this.aClipPlanesLocs.debug.length = this.constructor.NUM_CONSTRAINING_WALLS;
    for ( let i = 0; i < this.constructor.NUM_CONSTRAINING_WALLS; i += 1 ) {
      this.aClipPlanesLocs.program[i] = this.gl.getAttribLocation(this.programInfo.program, `aClipPlanes_${i}`);
      this.aClipPlanesLocs.debug[i] = this.gl.getAttribLocation(this.debugProgramInfo.program, `aClipPlanes_${i}`);
    }

    return attrProps;
  }

  /** @type {object<number>} */
  aTokenCenterLoc = { program: 0, debug: 0 };

  /** @type {object<number>} */
  aNumClipPlanesLoc = { program: 0, debug: 0 };

  /** @type {object<number[]>} */
  aClipPlanesLocs = { program: [], debug: [] };

  /** @type {FixedLengthTrackingBuffer} */
  clipPlanesTracker = new FixedLengthTrackingBuffer({ facetLengths: 4 * this.constructor.NUM_CONSTRAINING_WALLS });

  /** @type {FixedLengthTrackingBuffer} */
  numClipPlanesTracker = new FixedLengthTrackingBuffer({ type: Int32Array, facetLengths: 1 });

  /** @type {FixedLengthTrackingBuffer} */
  tokenCenterTracker = new FixedLengthTrackingBuffer({ facetLengths: 2 });

  /** @type {Float32Array} */
  get clipPlanesArray() { return this.clipPlanesTracker.viewWholeBuffer(); }

  /** @type {Int32Array} */
  get numClipPlanesArray() { return this.numClipPlanesTracker.viewWholeBuffer(); }

  /** @type {Float32Array} */
  get tokenCenterArray() { return this.tokenCenterTracker.viewWholeBuffer(); }

  levelId = "";

  senseType = "sight";

  _calculateNumberClippingPlanes(tokenShape, wallSegments) {
    wallSegments ??= this.constructor.intersectingWallSegments(tokenShape, this.levelId, this.senseType);
    return Math.min(this.constructor.NUM_CONSTRAINING_WALLS, wallSegments.length);
  }

  _calculateClippingWallPlanes(tokenShape) {
    const wallSegments = this.constructor.intersectingWallSegments(tokenShape, this.levelId, this.senseType);
    const numClipPlanes = this._calculateNumberClippingPlanes(tokenShape, wallSegments);

    // Define the normals representing planes.
    // All wall segment geoms share the same plane.
    const clipPlanes = new Float32Array(4 * this.constructor.NUM_CONSTRAINING_WALLS);
    for ( let i = 0; i < numClipPlanes; i += 1 ) clipPlanes.set(wallSegments[i], i * 4);
    return clipPlanes;
  }

  // ----- NOTE: Rendering ----- //

  _draw(instances) {
    instances ??= this.getInstanceSet();
    if ( !instances.size ) return;

    // Construct the functions needed to advance the instance attributes.
    const gl = this.gl;
    const advanceFns = Array(this.constructor.NUM_CONSTRAINING_WALLS + 3);
    let i = 0;
    const aModelAttribLoc = this.debugView ? this.aModelAttribLoc.debug : this.aModelAttribLoc.program;
    const aTokenCenterLoc = this.debugView ? this.aTokenCenterLoc.debug : this.aTokenCenterLoc.program;
    const aNumClipPlanesLoc = this.debugView ? this.aNumClipPlanesLoc.debug : this.aNumClipPlanesLoc.program;

    advanceFns[i++] = WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs.aModel, aModelAttribLoc);
    advanceFns[i++] = WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs.aTokenCenter, aTokenCenterLoc);
    advanceFns[i++] = WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs.aNumClipPlanes, aNumClipPlanesLoc);
    for ( let j = 0; j < this.constructor.NUM_CONSTRAINING_WALLS; j += 1 ) {
      const aClipPlanesLocs = this.debugView ? this.aClipPlanesLocs.debug : this.aClipPlanesLocs.program;
      advanceFns[i++] = WebGL2._advanceInstanceFn(gl, this.attributeBufferInfo.attribs[`aClipPlanes_${j}`], aClipPlanesLocs[j]);
    }
    const nVertices = this.indicesArray.length;

    // From super._draw.
    WebGL2.drawInstancedSet(
      gl,
      instances,
      nVertices,
      advanceFns,
    );

  }
}

export class ConstrainedInstancedDrawable extends mix(InstancedDrawable).with(ConstrainedTokenMixin) {}


// Currently constrained with model drawable is not needed.
// export class ConstrainedModelDrawable extends mix(ModelDrawable).with(ConstrainedTokenMixin) {}
// export class ConstrainedMultiModelDrawable extends mix(MultiModelDrawable).with(ConstrainedTokenMixin) {}

export class DirectionalInstancedDrawable extends mix(InstancedDrawable).with(DirectionalWallMixin) {}
