/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { WebGL2 } from "./WebGL2.js";
import { GeometryDesc } from "../WebGPU/GeometryDesc.js";
import { GeometryWallDesc } from "../WebGPU/GeometryWall.js";
import { GeometryHorizontalPlaneDesc } from "../WebGPU/GeometryTile.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc, GeometryGridDesc, GeometryLitTokenDesc } from "../WebGPU/GeometryToken.js";
import {
  NonDirectionalWallInstanceHandler,
  DirectionalWallInstanceHandler,
  NonDirectionalTerrainWallInstanceHandler,
  DirectionalTerrainWallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
  SceneInstanceHandler,
} from "../WebGPU/PlaceableInstanceHandler.js";

import * as twgl from "./twgl.js";
import { log } from "../util.js";

// Set that is used for temporary values.
// Not guaranteed to have any specific value.
const TMP_SET = new Set();

/**
 * Drawing of a placeable object without instancing.
 */
class DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass;

  /** @type {class} */
  static geomClass;

  /** @type {string} */
  static vertexFile = "obstacle_vertex_ubo";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment";

  /** @type {number[4]} */
  static obstacleColor = [0, 0, 1, 1];

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
    this._initializeCameraBuffer();
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

  materialUniforms = {};


  _initializeUniforms() {
    this.materialUniforms = {
      uColor: new Float32Array(this.constructor.obstacleColor),
    };
  }

  _initializeCameraBuffer() {
    // Set up uniform blocks to use the same binding point.
    const gl = this.gl;
    const program = this.programInfo.program;
    const blockIndex = gl.getUniformBlockIndex(program, "Camera");
    gl.uniformBlockBinding(program, blockIndex, this.renderer.constructor.CAMERA_BIND_POINT);
  }

  // ----- NOTE: Attributes ----- //

  /** @type {GeometryDesc[]|GeometryDesc} */
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
    this.offsetData = GeometryDesc.computeBufferOffsets(this.geoms);
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
    const numPlaceableIndices = Math.max(...this.placeableHandler.placeableFromInstanceIndex.keys()) + 1;
    const vClass = this.verticesArray.constructor;
    const iClass = this.indicesArray.constructor;

    this.verticesBuffer = new ArrayBuffer(offsetData.vertex.totalSize);
    this.indicesBuffer = new ArrayBuffer(offsetData.index.totalSize);
    this.verticesArray = new vClass(this.verticesBuffer);
    this.indicesArray = new iClass(this.indicesBuffer);

    // Create distinct views into the vertices and indices buffers
    this.vertices = new Array(numPlaceableIndices);
    this.indices = new Array(numPlaceableIndices);
    for ( let i = 0; i < numPlaceableIndices; i += 1 ) {
      this.vertices[i] = new vClass(this.verticesBuffer, offsetData.vertex.offsets[i], offsetData.vertex.lengths[i]);
      this.indices[i] = new iClass(this.indicesBuffer, offsetData.index.offsets[i], offsetData.index.lengths[i]);
    }

    // Copy data to the vertices for all instances.
    for ( const idx of this.placeableHandler.placeableFromInstanceIndex.keys() ) this._updateInstanceVertex(idx);
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
     const offset = this.offsetData.vertex.cumulativeNum[idx];
     const currIndices = this.indices[idx];
     const currVertices = this.vertices[idx];
     const { vertices, indices } = this.geoms[idx];
     if ( currIndices.length !== indices.length
       || currVertices.length !== vertices.length ) return false;

     // Copy over the geometry (presumed changed elsewhere).
     currVertices.set(vertices);
     currIndices.set(indices);
     currIndices.forEach((elem, idx) => indices[idx] += offset); // Renumber
     return true;
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
    twgl.setUniforms(this.programInfo, this.materialUniforms);



    // twgl.bindUniformBlock(gl, this.programInfo, this.renderer.uboInfo.camera);

    log (`${this.constructor.name}|render`);
    if ( CONFIG[MODULE_ID].filterInstances ) this._drawFilteredInstances(this.instanceSet);
    else this._drawUnfilteredInstances();
    gl.bindVertexArray(null);
    this.gl.flush(); // For debugging
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
class DrawableObjectsInstancingWebGL2Abstract extends DrawableObjectsWebGL2Abstract {
  /** @type {string} */
  static vertexFile = "instance_vertex_ubo";

  /** @type {class} */
  static geomClass = GeometryDesc;

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
    this.offsetData = GeometryDesc.computeBufferOffsets((new Array(this.placeableHandler.numInstances)).fill(this.geoms));
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

export class DrawableWallWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryWallDesc;

  /** @type {boolean} */
  static directional = false;

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  get senseType() { return this.renderer.senseType; }

  _initializeGeoms() {
    super._initializeGeoms({ directional: this.constructor.directional });
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]                     Options from BlockingConfig (see AbstractViewerLOS)
   */
  filterObjects(visionTriangle, { blocking = {} } = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    blocking.walls ??= true;
    if ( !blocking.walls ) return;

    // Limit to walls within the vision triangle
    // Drop open doors.
    const edges = AbstractViewpoint.filterEdgesByVisionTriangle(visionTriangle, { senseType: this.senseType });
    for ( const [idx, wall] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( edges.has(wall.edge) ) instanceSet.add(idx);
    }
  }
}

export class DrawableNonDirectionalWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandler;

  /** @type {boolean} */
  static directional = false;
}

export class DrawableDirectionalWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = DirectionalWallInstanceHandler;

  /** @type {boolean} */
  static directional = true;
}

export class DrawableNonDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = NonDirectionalTerrainWallInstanceHandler;

  /** @type {boolean} */
  static directional = false;

  static obstacleColor = [0, 0.5, 0.0, 0.5];
}

export class DrawableDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = DirectionalTerrainWallInstanceHandler;

  /** @type {boolean} */
  static directional = true;

  static obstacleColor = [0, 0.5, 0.0, 0.5];
}

export class DrawableTileWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TileInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryHorizontalPlaneDesc;

  // ----- NOTE: Program ----- //
  async _createProgram(opts = {}) {
    opts.isTile = true;
    return super._createProgram(opts);
  }

  // ----- NOTE: Uniforms ----- //

  _initializeUniforms() {
    super._initializeUniforms();
    this._initializeTextures();
  }

  // ----- NOTE: Attributes ----- //

  /** @type {WebGLTexture[]} */
  textures = [];

  _initializeGeoms(opts = {}) {
    opts.addUVs = true;
    super._initializeGeoms(opts);
  }

  _defineAttributeProperties() {
    const vertexProps = super._defineAttributeProperties();
    const debugViewNormals = this.debugViewNormals;

    // coords (3), normal (3), uv (2)
    let stride = this.verticesArray.BYTES_PER_ELEMENT * 5;
    if ( debugViewNormals ) {
      stride = this.verticesArray.BYTES_PER_ELEMENT * 8;
      vertexProps.aNorm.stride = stride;
    }
    vertexProps.aPos.stride = stride;
    vertexProps.aUV = {
      numComponents: 2,
      buffer: vertexProps.aPos.buffer,
      stride,
      offset: this.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3),
    }
    return vertexProps;
  }

  // ----- NOTE: Tile texture ----- //

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

  static tileSource(tile) { return tile.texture.baseTexture.resource.source; }

  _initializeTextures() {
    const textureOpts = this.constructor.textureOptions(this.gl);
    const placeableHandler = this.placeableHandler;
    this.textures.length = placeableHandler.numInstances;
    for ( const [idx, tile] of placeableHandler.placeableFromInstanceIndex.entries() ) {
      textureOpts.src = this.constructor.tileSource(tile);
      this.textures[idx] = twgl.createTexture(this.gl, textureOpts)
    }
  }

  _rebuildModelBuffer() {
    super._rebuildModelBuffer();
    this._initializeTextures();
  }

  _drawFilteredInstances(instanceSet) {
    // TODO: Bind instead of setting textures.
/*
// Create textures
const textures = [];
for (let i = 0; i < numImages; ++i) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  textures.push(texture);
}

// Load images and upload to textures
for (let i = 0; i < numImages; ++i) {
  const image = new Image();
  image.src = imageUrls[i];
  image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, textures[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D); // If using mipmaps
  };
}

// Draw with different textures
for (let i = 0; i < numImages; ++i) {
  // Activate the texture unit
  gl.activeTexture(gl[`TEXTURE${i}`]);  // e.g., gl.TEXTURE0, gl.TEXTURE1
  // Bind the texture
  gl.bindTexture(gl.TEXTURE_2D, textures[i]);
  // Set the shader uniform (assuming u_sampler is the uniform name)
  gl.uniform1i(shaderProgram.uSampler, i); // or whatever index matches the texture unit

  // Draw the scene using the current texture
  gl.drawArrays(gl.TRIANGLES, 0, numVertices);  // Or drawElements
}


*/

    const uniforms = { uTileTexture: -1 };
    for ( const idx of instanceSet ) {
      TMP_SET.clear();
      TMP_SET.add(idx);
      uniforms.uTileTexture = this.textures[idx];
      twgl.setUniforms(this.programInfo, uniforms);
      super._drawFilteredInstances(TMP_SET);
    }
  }

  _drawUnfilteredInstances() {
    // Still need to draw each one at a time so texture uniform can be changed.
    const instanceSet = this.placeableHandler.placeableFromInstanceIndex.keys(); // Not a set but works in the for/of loop above.
    super._drawFilteredInstances(instanceSet);
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]                     Options from BlockingConfig (see AbstractViewerLOS)
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(visionTriangle, { blocking = {} } = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    blocking.tiles ??= true;
    if ( !blocking.tiles ) return;

    // Limit to tiles within the vision triangle
    const tiles = AbstractViewpoint.filterTilesByVisionTriangle(visionTriangle, { senseType: this.senseType });
    for ( const [idx, tile] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( tiles.has(tile) ) instanceSet.add(idx);
    }
  }
}

// TODO: Fix DrawableSceneBackgroundWebGL2.
export class DrawableSceneBackgroundWebGL2 extends DrawableTileWebGL2 {
  /** @type {class} */
  static handlerClass = SceneInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryHorizontalPlaneDesc;

  /** @type ImageBitMap */
  backgroundImage;

  async initialize() {
    const promises = [this._createProgram()];
    this.placeableHandler.registerPlaceableHooks();
    this._initializePlaceableHandler();

    const sceneObj = this.placeableHandler.placeableFromInstanceIndex.get(0);
    if ( sceneObj && sceneObj.src ) {
      this.backgroundImage = await loadImageBitmap(sceneObj.src, {
        //imageOrientation: "flipY",
        // premultiplyAlpha: "premultiply",
        premultiplyAlpha: "none",
      });
      this.instanceSet.add(0);
    }

    this._initializeGeoms();
    await Promise.allSettled(promises); // Prior to updating buffers, etc.
    this._updateAllInstances();
  }

  validateInstances() { return; } // Nothing to change.

  filterObjects() { return; }

  _sourceForTile() { return this.backgroundImage; }
}

export class DrawableTokenWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TokenInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryCubeDesc;

  static targetColor = [1, 0, 0, 1];

  static vertexDrawType = "STATIC_DRAW";

  static constrained = false;

  static lit = null; // Draw tokens

  static tokenHasCustomLitBorder(token) { return token.litTokenBorder && !token.litTokenBorder.equals(token.constrainedTokenBorder); }

  static includeToken(token) {
    const { constrained, lit, tokenHasCustomLitBorder } = this
    if ( constrained !== null && (constrained ^ token.isConstrainedTokenBorder) ) return false;
    if ( lit !== null && (lit ^ tokenHasCustomLitBorder(token)) ) return false;
    return true;
  }

  renderTarget(target) {
    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx === "undefined" ) return;
    if ( !this.constructor.includeToken(target) ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.attributeBufferInfo);
    // twgl.setBuffersAndAttributes(gl, this.programInfo, this.vertexArrayInfo);
    // twgl.bindUniformBlock(gl, this.programInfo, this.renderer.uboInfo.camera);


    // Render the target red.
    for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.targetColor[i];
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    log (`${this.constructor.name}|renderTarget ${target.name}, ${target.id}`);
    TMP_SET.clear();
    TMP_SET.add(idx);
    this._drawFilteredInstances(TMP_SET)
    gl.bindVertexArray(null);
    this.gl.flush(); // For debugging
  }

  // TODO: Handle material uniform using binding; avoid setUniforms here.
  render() {
    if ( !this.instanceSet.size ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.vertexArrayInfo);
    // twgl.bindUniformBlock(gl, this.programInfo, this.renderer.uboInfo.camera);


    for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.obstacleColor[i];
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    log (`${this.constructor.name}|render ${this.instanceSet.size} tokens`);
    if ( CONFIG[MODULE_ID].filterInstances ) this._drawFilteredInstances(this.instanceSet);
    else this._drawUnfilteredInstances();
    gl.bindVertexArray(null)
    this.gl.flush(); // For debugging
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(visionTriangle, { viewer, target, blocking = {} } = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    blocking.tokens ??= {};
    blocking.tokens.dead ??= true;
    blocking.tokens.live ??= true;
    blocking.tokens.prone ??= true;
    if ( !(blocking.tokens.dead || blocking.tokens.live) ) return;

    // Limit to tokens within the vision triangle.
    // Drop excluded token categories.
    const tokens = AbstractViewpoint.filterTokensByVisionTriangle(visionTriangle,
      { viewer, target, blockingTokensOpts: blocking.tokens });
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( !this.constructor.includeToken(token) ) continue;
      if ( tokens.has(token )) instanceSet.add(idx);
    }
  }
}

export class DrawableGridShape extends DrawableTokenWebGL2 {
  /** @type {class} */
  static geomClass = GeometryGridDesc;

  static vertexDrawType = "STATIC_DRAW";

  static constrained = null;

  static lit = null;

  filterObjects() { return; }

  render() { return; }

  get debugViewNormals() { return false; } // No normals.
}

// TODO: Fix.
// Should group tokens into distinct hex instances.
// So draw 1x1, 2x2, etc.
export class DrawableHexTokenWebGL2 extends DrawableTokenWebGL2 {

}

export class ConstrainedDrawableTokenWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TokenInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryConstrainedTokenDesc;

  static targetColor = [1, 0, 0, 1];

  static vertexDrawType = "DYNAMIC_DRAW";

  static constrained = true;

  static lit = null;

  static includeToken(token) { return DrawableTokenWebGL2.includeToken.call(this, token); }

  static tokenHasCustomLitBorder(token) { return DrawableTokenWebGL2.tokenHasCustomLitBorder(token); }

  // ----- NOTE: Attributes ----- //

  /**
   * Indices of tokens that should be include in this render set.
   * E.g., constrained token indices.
   * Link the PH index to the number for this geom.
   * @type {Map<number, number>}
   */
  _includedPHIndices = new Map();

  /**
   * Indices of tokens that have a geometry but are not currently used.
   */
  // _inactivePHIndices = new Map();

  _initializeGeoms() {
    const geomClass = this.constructor.geomClass;
    const geoms = this.geoms;
    let geomIndex = 0;
    geoms.length = 0;
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( this.constructor.includeToken(token) ) this._includedPHIndices.set(idx, geomIndex);
      geomIndex += 1;
      geoms.push(new geomClass({ token }));
    }
  }

  // ----- NOTE: Placeable Handler ----- //

  _updateAllInstances() {
    this._initializeGeoms();
    super._updateAllInstances();
  }

  _updateInstance(idx) {
    // TODO: Keep a map of inactive indices?


    const token = this.placeableHandler.placeableFromInstanceIndex.get(idx);
    const shouldInclude = this.constructor.includeToken(token);

    // If a constrained geometry is already created, either remove from set or update.
    if ( this._includedPHIndices.has(idx) ) {
      if ( !shouldInclude ) {
        this._includePHIndices.delete(idx);
        return true;
      }
      const geom = new this.constructor.geomClass({ token });
      if ( geom.vertices.length !== this.vertices[idx].length
        || geom.indices.length !== this.indices[idx].length ) return false;

      // Update the vertices (buffer updated later).
      this.vertices[idx].set(geom.vertices);
      this.indices[idx].set(geom.indices);

    } else if ( shouldInclude ) return false; // Must insert a new geometry.
    // TODO: Add new tokens on the end without redoing every geometry?

    else return true;
  }

  // ----- NOTE: Rendering ----- //

  filterObjects(...args) { DrawableTokenWebGL2.prototype.filterObjects.call(this, ...args); }

  renderTarget(target) { DrawableTokenWebGL2.prototype.renderTarget.call(this, target); }

  render() { DrawableTokenWebGL2.prototype.render.call(this); }

}

export class LitDrawableTokenWebGL2 extends ConstrainedDrawableTokenWebGL2 {
  /** @type {class} */
  static geomClass = GeometryLitTokenDesc;

  static constrained = null;

  static lit = true;
}

export class ConstrainedDrawableHexTokenWebGL2 extends ConstrainedDrawableTokenWebGL2 {
  renderTarget(target) {
    DrawableTokenWebGL2.prototype.renderTarget.call(this, target); // Render all, not just constrained tokens.
  }

  validateInstances() {
    const placeableHandler = this.placeableHandler;
    if ( placeableHandler.updateId <= this.placeableHandlerUpdateId ) return DrawableTokenWebGL2.prototype.validateInstances.call(this); // No changes since last update.

    // If any constrained token has changed, need to rebuild.
    // If the token is now unconstrained, that is fine (will be skipped).
    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      const token = placeableHandler.placeableFromInstanceIndex.get(idx);
      if ( token?.isConstrainedTokenBorder ) this._updateAllInstances();
    }
    DrawableTokenWebGL2.prototype.validateInstances.call(this);
  }
}

export class LitDrawableHexTokenWebGL2 extends ConstrainedDrawableTokenWebGL2 {
  static constrained = null;

  renderTarget(target) {
    DrawableTokenWebGL2.prototype.renderTarget.call(this, target); // Render all, not just constrained tokens.
  }

  validateInstances() {
    const placeableHandler = this.placeableHandler;
    if ( placeableHandler.updateId <= this.placeableHandlerUpdateId ) return DrawableTokenWebGL2.prototype.validateInstances.call(this); // No changes since last update.

    // If any constrained token has changed, need to rebuild.
    // If the token is now unconstrained, that is fine (will be skipped).
    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      const token = placeableHandler.placeableFromInstanceIndex.get(idx);
      if ( token?.litTokenBorder ) this._updateAllInstances();
    }
    DrawableTokenWebGL2.prototype.validateInstances.call(this);
  }
}

/**
 * From http://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html
 * Load an image bitmap from a url.
 * @param {string} url
 * @param {object} [opts]       Options passed to createImageBitmap
 * @returns {ImageBitmap}
 */
async function loadImageBitmap(url, opts = {}) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await createImageBitmap(blob, opts);
}
