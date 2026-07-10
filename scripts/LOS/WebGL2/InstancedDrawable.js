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
import { ModelGeometricPrimitive } from "../../geometry/placeable_geometry/ModelGeometricPrimitive.js";
import { WallGeometry } from "../../geometry/placeable_geometry/WallGeometry.js";
import { mix } from "../../geometry/mixwith.js";


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
    INSTANCED:    1 << 1, // 2
    TEXTURED:     1 << 2, // 4
    CONSTRAINED:  1 << 3, // 8
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

  get verticesArray() { return console.error("verticesArray must be defined by child class."); }

  get indicesArray() { return console.error("indicesArray must be defined by child class."); }

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
    const vertexProps = {
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
    vertexProps.aNormal = {
      numComponents: 3,
      buffer: vBuffer,
      drawType: this.constructor.VERTEX_DRAW_TYPE,
      stride,
      offset: Float32Array.BYTES_PER_ELEMENT * 3,
    };

    return vertexProps;
  }

  /**
   * Update attributes for specific placeable geometry.
   * @param {PlaceableGeometry} geom
   * @returns {boolean} True if updated.
   */
  updateAttributeBuffersForShape(_shape) {
//     const idx = shape.trackerIndex;
//     const lastUpdate = this.geomLastUpdated.get(id) ?? Number.NEGATIVE_INFINITY;
//     if ( lastUpdate >= geom.updateCount ) return false;
//     this.geomLastUpdated.set(id, geom.updateCount);
//     this._updateAttributeBuffersForShape(shape);
//     return true;
  }

  _updateAttributeBuffersForShape(_shape) { console.error("_updateAttributeBuffersForId must be defined by child class.");}

  /**
   * Update attributes for all placeables.
   */
  _rebuildAttributeBuffers() { }

  // ----- NOTE: Rendering ----- //

  /** @type {Set<number>} */
  instanceSet = new Set();

  /**
   * Pull id index for a given geom id.
   */
  _indexForId(_id) { console.error("Drawable#_indexForId must be implemented by child class."); }

  /**
   * Draw all placeables in the instance set, using the current webGL settings.
   */
  render(debug = false) {
    if ( !this.instanceSet.size ) return;
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

  clearInstances() { this.instanceSet.clear(); }

  _draw() { console.error("_draw should be defined by child class."); }

  destroy() {
    this.clearInstances();
  }

}

export class InstancedDrawable extends AbstractDrawable {

  static SHADER_VARIANT = this.SHADER_FLAGS.INSTANCED;

  /** @type {class<GeometricPrimitive>} */
  primitiveClass;

  constructor({ primitiveClass, ...opts }) {
    super(opts);
    this.primitiveClass = primitiveClass;
  }

  get verticesArray() { return this.primitiveClass.instanceVO.vertices; }

  get indicesArray() { return this.primitiveClass.instanceVO.indices; }

  get modelMatrixArray() { return this.primitiveClass.modelMatrixTracker.viewBuffer(); }

  /** @type {number} */
  aModelAttribLoc = 0;

  /**
   * Build the vertex and index buffers along with any other attributes.
   * @returns {object} The attribute property object passed to twgl.createBufferInfoFromArrays.
   */
  _defineAttributeProperties() {
    const attrProps = super._defineAttributeProperties();

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


  updateTracker = new Map();

  addGeometricShape(shape) {
    if ( !(shape instanceof this.primitiveClass ) ) return false;
    this.instanceSet.add(shape.trackerIndex);
    return true;
  }

  updateAttributeBuffers() {
    this.instanceSet.forEach(idx => this._updateAttributeBufferForIndex(idx));

    // TODO: What if the total buffer size changed?
  }

  /**
   * Update the attributes for a specific index of this geometry.
   */
  _updateAttributeBufferForIndex(idx) {
    const tracker = this.primitiveClass.modelMatrixTracker;
    const facetChangeTracker = tracker.facetChangeTracker;
    if ( !facetChangeTracker.has(idx) ) {
      console.error("_updateAttributeBufferForIndex|Index not found in the geometry buffer.");
      return;
    }

    // If not changed since last time, skip.
    if ( !this.updateTracker.has(idx) ) this.updateTracker.set(idx, -1);
    const curr = facetChangeTracker.get(idx);
    if ( this.updateTracker.get(idx) >= curr ) return;

    // TODO: Use applyConsecutively to update in larger chunks.
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;
    const mOffset = tracker.facetOffsetAtIndex(idx) + tracker.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, tracker.viewFacetAtIndex(idx));

    // Log the update.
    this.updateTracker.set(idx, curr);
  }

  /**
   * Rebuild attributes.
   */
  /*
  _rebuildAttributeBuffers() {
    // Update the model attribute with a new buffer.
    this.attributeProperties.aModel.data = this.modelMatrixArray;
    const attribs = this.attributeBufferInfo.attribs;
    attribs.aModel = twgl.createAttribsFromArrays(this.gl, { aModel: this.attributeProperties.aModel }).aModel;

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
    this.debugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.debugProgramInfo, attribs);
  }
  */

  _draw() {
    this.updateAttributeBuffers(); // TODO: Move to a prerender step?
    const nVertices = this.indicesArray.length;
    WebGL2.drawInstancedMatrixSet(
      this.gl,
      this.instanceSet,
      nVertices,
      this.attributeBufferInfo.attribs.aModel,
      this.aModelAttribLoc,
    );

  }
}

export class ModelDrawable extends AbstractDrawable {

  static SHADER_VARIANT = this.SHADER_FLAGS.NONE;

  /** @type {class<GeometricPrimitive>} */
  primitiveClass = ModelGeometricPrimitive;

  get verticesArray() { return this.primitiveClass.viTracker.vertices.viewBuffer(); }

  get indicesArray() { return this.primitiveClass.viTracker.indices.viewBuffer(this.primitiveClass.viTracker.indicesAdjBuffer); }

  // ----- NOTE: Attributes ----- //

  updateTracker = new Map();

  addGeometricShape(shape) {
    if ( !(shape instanceof this.constructor.primitiveClass ) ) return;
    this.instanceSet.add(shape.trackerIndex);
  }

  updateAttributeBuffers() {
    this.instanceSet.forEach(idx => this._updateAttributeBufferForIndex(idx));

    // TODO: What if the total buffer size changed? Or the buffers get moved?
  }


  /**
   * Update the vertices/indices attributes for a specific geometry index.
   * Does not handle if the vertices or indices array has changed length.
   */
  _updateAttributeBufferForIndex(idx) {
     const tracker = this.constructor.primitiveClass.viTracker;
     const facetChangeTracker = tracker.vertices.facetChangeTracker;
     if ( !facetChangeTracker.has(idx) ) {
      console.error("_updateAttributeBufferForIndex|Index not found in the geometry buffer.");
      return;
    }

    // If not changed since last time, skip.
    if ( !this.updateTracker.has(idx) ) this.updateTracker.set(idx, -1);
    const curr = facetChangeTracker.get(idx);
    if ( this.updateTracker.get(idx) >= curr ) return;

    // TODO: Use applyConsecutively to update in larger chunks.
    // See twgl.setAttribInfoBufferFromArray.
    const gl = this.gl;
    const vi = this.constructor.primitiveClass.viTracker;

    // Copy the vertices and adjusted indices to their webGL buffers.
    const { vertices, indicesAdj } = vi.viewFacetAtIndex(idx);
    if ( !vertices || !indicesAdj ) console.error(`${this.constructor.name}|_updateAttributeBuffersForIdx|${idx} idx not found`);

    // Vertices.
    const vBuffer = this.attributeBufferInfo.attribs.aPosition.buffer;
    const vOffset = vi.vertices.facetOffsetAtIndex(idx) * tracker.type.BYTES_PER_ELEMENT;
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vOffset, vertices);

    // Indices.
    const iBuffer = this.attributeBufferInfo.indices;
    const iOffset = vi.indices.facetOffsetAtIndex(idx) * tracker.type.BYTES_PER_ELEMENT;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, iOffset, indicesAdj);
  }

  /**
   * Rebuild attributes.
   */
  _rebuildAttributeBuffers() {
      // Update the model attribute with a new buffer.
      this.attributeProperties.aPosition.data = this.verticesArray;
      this.attributeProperties.aNormal.data = this.verticesArray;
      this.attributeProperties.indices.data = this.indicesArray;

      // Update the VAO with the new model buffer information.
      const attribs = this.attributeBufferInfo.attribs;
      this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
  }

  _draw() {
    this.updateAttributeBuffers();
    const { facetLength, facetLengths, byteOffsets } = this.viTracker.indices;
    WebGL2.drawSet(this.gl, this.instanceSet, byteOffsets, facetLength || facetLengths);
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
    gl.useProgram(null);
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

  _rebuildAttributeBuffers() {
    /*
    this.attributeProperties.aTexCoord.data = this.verticesArray;
    super._rebuildAttributeBuffers();
    this._initializeTextures();
    */
  }

  updateAttributeBuffersForShape(_shape) {
    /*
    const updated = super.updateAttributeBuffersForGeom(geom);
    if ( !updated ) return;

    // Check if the source changed.
    this._initializeTexture(geom);
    */
  }

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

  addGeometricShape(shape) {
    super.addGeometricShape(shape);

    // Need direction, texture url, texture alphaThreshold
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

  _draw() {
    const maxInstance = Math.max(...this.instanceSet);
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
      const batchInstances = this.instanceSet.intersection(instances);

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

  /** @type {Set<number>} */
  frontDirectional = new Set();

  /** @type {Set<number>} */
  backDirectional = new Set();

  addGeometricShape(shape) {
    if ( !super.addGeometricShape(shape) ) return false;
    if ( shape.direction === QuadPrimitive.CULL_FACES.FRONT ) this.frontDirectional.add(shape.trackerIndex);
    else if ( shape.direction === QuadPrimitive.CULL_FACES.BACK ) this.backDirectional.add(shape.trackerIndex);
  }

  _draw() {
    const webGL2 = this.webGL2;
    const fullSet = this.instanceSet;
    const { frontDirectional, backDirectional } = this;

    const bidirectional = this.instanceSet.difference(frontDirectional).difference(backDirectional);
    if ( bidirectional.size ) {
      webGL2.setCulling(false);
      this.instanceSet = bidirectional;
      super._draw();
    }
    if ( frontDirectional.size ) {
      webGL2.setCulling(true);
      webGL2.setCullFace("BACK");
      this.instanceSet = frontDirectional;
      super._draw();
    }
    if ( backDirectional.size ) {
      webGL2.setCulling(true);
      webGL2.setCullFace("FRONT");
      this.instanceSet = backDirectional;
      super._draw();
    }
    this.instanceSet = fullSet;
  }

  clearInstances() {
    super.clearInstances();
    this.frontDirectional.clear();
    this.backDirectional.clear();
  }
}

/**
 * Handle constrained token target drawing.
 * Uses a separate fragment shader to test whether a wall segment blocks the viewpoint.
 */
const ConstrainedTokenMixin = superclass => class extends superclass {

  static SHADER_VARIANT = super.SHADER_VARIANT | this.SHADER_FLAGS.CONSTRAINED;

  /** @type {number} */
  static NUM_CONSTRAINING_WALLS = 5;

  /**
   * Locate walls that intersect the token border.
   * @param {GeometricPrimitive} tokenShape
   * @returns {WallGeometry[]}
   */
  static intersectingWalls(tokenShape, levelId) {
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
      if ( wallGeom.segmentGeoms.some(segmentGeom => segmentGeom.isActiveForLevel(levelId)
          && aabb.overlapsConvexPolygon3d(segmentGeom.faces[0])) ) out.push(wallGeom);
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

  /** @type {Float32Array} */
  uClipPlanes = new Float32Array(this.constructor.NUM_CONSTRAINING_WALLS * 4);

  /** @type {number} */
  uNumClipPlanes = 0;

  levelId = "";

  addGeometricShape(targetShape) {
    if ( !super.addGeometricShape(targetShape) ) return false;
    const wallGeoms = this.constructor.intersectingWalls(targetShape, this.levelId);
    this._setClippingWallPlanes(targetShape, wallGeoms);
  }

  _setClippingWallPlanes(targetShape, wallGeoms) {
    using ctr = targetShape.center;

    // Set the uniform normals representing planes.
    // All wall segment geoms share the same plane.
    const maxWalls = this.constructor.NUM_CONSTRAINING_WALLS;
    const uNumClipPlanes = this.uNumClipPlanes = Math.min(maxWalls, wallGeoms.length);
    const uClipPlanes = this.uClipPlanes;
    for ( let i = 0; i < uNumClipPlanes; i += 1 ) {
      const wallGeom = wallGeoms[i];
      const plane = wallGeom.segmentGeoms[0].faces[0].plane;
      const n = plane.normal;
      const d = plane.constant;

      // Force the plane to face the token center.
      const mult = -Math.sign(plane.whichSide(ctr)) || -1;
      const j = i * 4;
      uClipPlanes[j] = n.x * mult;
      uClipPlanes[j + 1] = n.y * mult;
      uClipPlanes[j + 2] = n.z * mult;
      uClipPlanes[j + 3] = d;
    }
  }

  _draw() {
    // Set the uniform normals representing planes.
    const uniforms = {
      uClipPlanes: this.uClipPlanes,
      uNumClipPlanes: this.uNumClipPlanes,
    };
    twgl.setUniforms(this.program, uniforms);
    super._draw();
  }
}

export class ConstrainedInstancedDrawable extends mix(InstancedDrawable).with(ConstrainedTokenMixin) {}

export class ConstrainedModelDrawable extends mix(ModelDrawable).with(ConstrainedTokenMixin) {}

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
