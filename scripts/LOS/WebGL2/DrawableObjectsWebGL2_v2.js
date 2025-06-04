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
import { applyConsecutively, log } from "../util.js";

/* WebGL2 improved with better instancing.

- Every object has a model matrix.
- Use UBOs for camera matrices, color, and texture.
- Except for constrained/lit/custom tokens, avoid defining geometries in the render cycle
- For constrained/lit/custom hex tokens, set the model matrix to identity and don't update
- Track all tokens except lit/custom using single instance
- Overall class to share the camera buffers and material buffers
- token class ignores the lit/custom in the instance set but otherwise uploads their data

- Constrained/lit tokens still require separate instance. Otherwise would be combining regular geometry
  with custom, and that would fail b/c the custom has undefined length.
  This is not terrible b/c
  (1) placeable handler is just a link to a single instance and
  (2) not uploading the placeable instance matrices like with the regular token instances
      (we could but the size transform is problematic)
- Only keep those instances that are constrained/lit/custom; ignore regular tokens
- Custom tokens could use the same placeable matrix with translation only, but just keep distinct
- Lit custom tokens are problematic, b/c it is hard to determine the lit shape without a lot of work.
  - Need to more or less intersect the light shape against the 3d shape.
  - Constrained custom tokens also problematic
*/

export class RenderPlaceablesWebGL2 {

  /** @type {WebGL2} */
  webGL2;



  /** @type {twgl.UniformBlockInfo} */
  uboInfo = {
    camera: null,
    material: null,
  };

  buffer = {
    camera: null,
    material: null,
  }

  bufferData = {
    camera: null,
    material: null,
  }

  constructor({ webGL2, senseType = "sight", debugViewNormals = false } = {}) {

  }

  initialize() {

  }


  render(viewerLocation, target, { targetLocation, frame } = {}) {
    this._setCamera(viewerLocation, target, { targetLocation });

  }

  // Must be called after render; assumes the camera is set.
  renderTarget() {

  }

  // Must be called after render; assumes the camera is set.
  renderGridShape() {

  }





  static MATERIAL_COLORS = {
    target = new Float32Array([1, 0, 0, 1]),
    obstacle = new Float32Array(0, 0, 1, 1),
    terrain = new Float32Array(1, 0.5, 0, 0.5),
  };

  static MATERIAL_BIND_POINT = 1;

  _initializeMaterialBuffer() {
    const gl = this.gl;

    // Create a shared UBO
    const dat = this.bufferData.material = new Float32Array(4);
    this.buffer.material = gl.createBuffer();

    // Create and initialize the UBO
    const size = dat.BYTES_PER_ELEMENT * dat.length
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.material);
    gl.bufferData(gl.UNIFORM_BUFFER, size, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    // Bind the UBO to the binding point
    gl.bindBufferBase(gl.UNIFORM_BUFFER, this.constructor.MATERIAL_BIND_POINT, this.buffer.material);
  }

  static CAMERA_BIND_POINT = 0;

  _initializeCameraBuffer() {
    const gl = this.gl;

    // Already have a shared buffer data from the camera object: camera.arrayBuffer.
    this.buffer.camera = gl.createBuffer();

    // Create and initialize it.
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.camera);
    gl.bufferData(gl.UNIFORM_BUFFER, this.camera.constructor.CAMERA_BUFFER_SIZE, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    // Bind the UBO to the binding point
    gl.bindBufferBase(gl.UNIFORM_BUFFER, this.constructor.CAMERA_BIND_POINT, this.buffer.camera);
  }

  /**
   * Set camera for a given render.
   */
  _setCamera(viewerLocation, target, { targetLocation } = {}) {
    targetLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    const camera = this.camera;
    camera.cameraPosition = viewerLocation;
    camera.setTargetTokenFrustum(target);
    camera.refresh();

    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffers.camera);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.camera.arrayView);
  }

  _setMaterial(materialType = "obstacle") {
    // Cache the current value and only change as necessary.
    if ( this.webGL2._materialType === materialType ) return;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffers.material);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.constructor.MATERIAL_COLORS[materialType]);
    this.webGL2._materialType = materialType;
  }
}

class DrawablePlaceableAbstract {
  /** @type {class} */
  static handlerClass;

  /** @type {class} */
  static geomClass;

  /** @type {string} */
  static vertexFile = "instance_vertex_ubo";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment_ubo";

  /** @type {RenderPlaceablesWebGL2} */
  renderer;

  get webGL2() { return this.renderer.webGL2; }

  get gl() { return this.webGL2.gl; }

  get camera() { return this.renderer.camera; }

  get debugViewNormals() { return this.renderer.debugViewNormals; }

  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.placeableHandler = new this.constructor.handlerClass();
  }

  // ----- NOTE: Initialization ----- //

  #initialized = false;

  aModelAttribLoc = -1;

  async initialize() {
    if ( this.#initialized ) return;
    this.programInfo = await this._createProgram();
    this.placeableHandler.registerPlaceableHooks();
    this._initializePlaceableHandler();
    this._initializeGeom();
    this._initializeAttributes();
    this._initializeCameraBuffer();
    this._initializeMaterialBuffer();
    this.aModelAttribLoc = this.gl.getAttribLocation(this.programInfo.program, 'aModel');
    this.#initialized = true;
  }

  _initializeGeom() {
    this.geom = new this.constructor.geomClass({ addNormals: this.debugViewNormals, addUVs: this.constructor.addUVs });
  }

  async _createProgram() {
    return this.webGL2.cacheProgram(
      this.constructor.vertexFile,
      this.constructor.fragmentFile,
      { debugViewNormals: this.debugViewNormals } // isTile?
    );
  }

  // ----- NOTE: Uniforms ----- //

  _initializeCameraBuffer() {
    const program = this.programInfo.program;
    const gl = this.gl;

    // Set up uniform blocks to use the same binding point.
    const blockIndex = gl.getUniformBlockIndex(program, "Camera");
    gl.uniformBlockBinding(program, blockIndex, RenderPlaceablesWebGL2.CAMERA_BIND_POINT)
  }

  _initializeMaterialBuffer() {
    const program = this.programInfo.program;
    const gl = this.gl;

    // Set up uniform blocks to use the same binding point.
    const blockIndex = gl.getUniformBlockIndex(program, "Material");
    gl.uniformBlockBinding(program, blockIndex, RenderPlaceablesWebGL2.MATERIAL_BIND_POINT);

  }

  // ----- NOTE: Attributes ----- //

  /** @type {object} */
  vertexProps = {};

  /** @type {twgl.BufferInfo} */
  attributeBufferInfo = {};

  /** @type {twgl.VertexArrayInfo} */
  vertexArrayInfo = {};

  _initializeAttributes() {
    this._initializeVerticesAndArrays();
    this.vertexProps = this._defineAttributeProperties();
    this.attributeBufferInfo = twgl.createBufferInfoFromArrays(gl, this.vertexProps);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(gl, this.programInfo, this.attributeBufferInfo);

    // Register that we are synced with the current placeable data.
    this.#placeableHandlerBufferId = placeableHandler.bufferId;
    this.#placeableHandlerUpdateId = placeableHandler.updateId;
  }

  _rebuildModelBuffer() {
    // Update the model attribute with a new buffer.
    const attribs = this.attributeBufferInfo;
    attribs.aModel = twgl.createAttribsFromArray({ aModel: this.vertexProps.aModel });

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(gl, this.programInfo, attribs);
    // const vaoInfo = this.vertexArrayInfo;
//     gl.bindVertexArray(vaoInfo.vertexArrayObject);

    // createBufferInfoFromArrays(gl, programInfos, bufferInfo)
    //   -> twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo (buffers));
    //      -> setAttributes(programInfo.attribSetters || programInfo, buffers.attribs);
    //   -> gl.bindVertexArray(null)

//     twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
//     twgl.setAttributes(programInfo.attribSetters || programInfo, buffers.attribs);
//     gl.bindVertexArray(null);

    // Register that we are synced with the current placeable data.
    this.#placeableHandlerBufferId = placeableHandler.bufferId;
    this.#placeableHandlerUpdateId = placeableHandler.updateId;
  }

  verticesArray;

  indicesArray;

  /**
   * Construct data arrays representing vertices and indices.
   */
  _initializeVerticesAndArrays() {
    this.verticesArray = this.geom.vertices;
    this.indicesArray = this.geom.indices;
  }

  _defineAttributeProperties() {
    // Define a vertex buffer to be shared.
    // https://github.com/greggman/twgl.js/issues/132.
    log (`${this.constructor.name}|_defineVertexAttributeProperties`);
    const gl = this.gl;
    const vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.verticesArray, gl.STATIC_DRAW);

    const debugViewNormals = this.debugViewNormals;
    const vertexProps = {
      aPos: {
        numComponents: 3,
        buffer: vBuffer,
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

    // Define the model matrix, which changes 1 per instance.
    vertexProps.aModel = {
      numComponents: 16,
      data: this.placeableHandler.instanceArrayValues,
      drawType: gl.DYNAMIC_DRAW,
      divisor: 1,
    };

    return vertexProps;
  }

  _updateModelBufferForInstance(idx) {
    const gl = this.gl;
    const mBuffer = this.bufferInfo.attribs.aModel.buffer;

    // See twgl.setAttribInfoBufferFromArray.
    log (`${this.constructor.name}|_updateBuffersForInstance ${idx}`);
    const mOffset = 4 * 16 * idx;
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, this.placeableHandler.matrices[idx].arr);
  }

  // ----- NOTE: Placeable handler ----- //

  _initializePlaceableHandler() {
    this.placeableHandler.initializePlaceables();
    this.#placeableHandlerUpdateId = this.placeableHandler.updateId;
    this.#placeableHandlerBufferId = this.placeableHandler.bufferId;
  }

  /**
   * Check for whether the placeable handler has been updated due to a change in 1+ placeables.
   */
  validateInstances() {
    // Checks for updates for multiple instances but does not rebuild; assumes num instances not changed.
    const placeableHandler = this.placeableHandler;
    if ( placeableHandler.bufferId < this.#placeableHandlerBufferId ) return this._updateAllInstances(); // Number of instances changed.
    if ( placeableHandler.updateId <= this.#placeableHandlerUpdateId ) return; // No changes since last update.

    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.#placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      this._updateInstance(idx);
    }
    this.#placeableHandlerUpdateId = placeableHandler.updateId;
  }

  /**
   * Called from updateInstances whenever the number of instances have changed
   * or the placeable handler has otherwise changed.
   */
  _updateAllInstances() {
    // Recreate only the model buffer and relink it.
    this._rebuildModelBuffer();
  }

  _updateInstance(idx) {
    this._updateModelBufferForInstance(idx);
  }

  // ----- NOTE: Render ----- //

  /** @type {Set<number>} */
  instanceSet = new Set();

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
   * Render this drawable.
   */
  render() {
    if ( !this.instanceSet.size ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);

    // TODO: Can we set this up using twgl and use something like the following?
    // See https://twgljs.org/examples/uniform-buffer-objects.html
    twgl.bindUniformBlock(gl, programInfo, this.bufferInfo.material); // TODO: Fix
    twgl.bindUniformBlock(gl, programInfo, this.bufferInfo.camera); // TODO: Fix

    log (`${this.constructor.name}|render ${this.instanceSet.size} tokens`);
    if ( CONFIG[MODULE_ID].filterInstances ) {
      // To draw select instances, modify the buffer offset.
      // const tmp = this.placeableHandler.instanceArrayValues;
      // log(`Buffer size is ${tmp.length} x ${tmp.BYTES_PER_ELEMENT} = ${tmp.byteLength} for ${this.placeableHandler.numInstances} placeables`);
      drawInstancedMatrixSet(
        gl,
        this.instanceSet,
        this.geom.numVertices,
        this.bufferInfo.attribs.aModel,
        this.aModelAttribLoc,
      );
    } else {
      // Draw every instance
      const nVertices = this.geom.numVertices;
      WebGL2.drawInstanced(gl, nVertices, 0, this.placeableHandler.numInstances);
    }
  }

}

class DrawableWall extends DrawablePlaceableAbstract {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryWallDesc;

  /** @type {boolean} */
  static directional = false;

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  get senseType() { return this.renderer.senseType; }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * Camera (viewer/target) are set by the renderer and will not change between now and render.
   * Adds indices of instances that are within the viewing triangle to the instanceSet for rendering.
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


class DrawableToken {

  /** @type {class} */
  static handlerClass = TokenInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryCubeDesc;

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
    // const custom = this.constructor.tokenIsCustom();
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      // if ( this.constructor.tokenIsCustom() ) continue;
      if ( tokens.has(token )) instanceSet.add(idx);
    }
  }

  // static tokenIsCustom() { return false; }

  #tmpSet = new Set();


  renderTarget(target) {
    if ( !target.litTokenBorder.equals(target.constrainedTokenBorder) ) return; // Must use DrawableLitToken

    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx === "undefined" ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);

    // TODO: Can we set this up using twgl and use something like the following?
    // See https://twgljs.org/examples/uniform-buffer-objects.html
    twgl.bindUniformBlock(gl, programInfo, this.bufferInfo.material); // TODO: Fix
    twgl.bindUniformBlock(gl, programInfo, this.bufferInfo.camera); // TODO: Fix

    this.#tmpSet.clear();
    this.#tmpSet.add(idx);

    log(`${this.constructor.name}|renderTarget ${target.name}, ${target.id}`);
    drawInstancedMatrixSet(
      gl,
      this.#tmpSet,
      this.geom.numVertices,
      this.bufferInfo.attribs.aModel,
      this.aModelAttribLoc,
    );
    gl.bindVertexArray(null);
  }

  // Possible that renderTarget was just called, and so the program may still be in correct state.
  // If so, setting and binding can be skipped in render. Would need to have the renderer determine this,
  // Or otherwise cache setBuffersAndAttributes and setBuffersAndAttributes.
  // Will also need to not use gl.bindVertexArray(null) in renderTarget.
  // render() {}

}

/**
 * Handle all the token hex types.
 * Rebuilds geometry when token sizes change b/c the hex shape will be modified.
 */
class DrawableHexToken {

}

/**
 * Handle constrained tokens.
 * These are used for render and drawing the target.
 */
class DrawableConstrainedToken {
  /** @type {string} */
  static vertexFile = "constrained_token_vertex_ubo";

  /**
   * Indices of tokens that have a distinct constrained token border.
   * @type {Set<number>}
   */
  _constrainedTokenPHIndices = new Set();

  _updateConstrainedTokenIndices() {
    let setChanged = false;
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      const isConstrained = token.isConstrained;
      setChanged ||= hasLitBorder ^ this._constrainedTokenPHIndices.has(idx);
      if ( hasLitBorder ) this._constrainedTokenPHIndices.add(idx);
      else this._constrainedTokenPHIndices.delete(idx);
    }
    return setChanged;
  }

}

/**
 * Handle lit tokens.
 * These are not used for render, just drawing the target.
 */
class DrawableLitToken {
  renderTarget(target) {
    if ( target.litTokenBorder.equals(target.constrainedTokenBorder) ) return;

    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx === "undefined" ) return;


  }

  /**
   * Indices of tokens that have a distinct lit token border.
   * @type {Set<number>}
   */
  _litTokenPHIndices = new Set();

  _litTokenVertexGroups = [];

  geoms = [];

  vertices = [];

  indices = [];

  verticesBuffer;

  indicesBuffer;

  verticesArray;

  indicesArray;

  _initializeAttributes() {
    this._updateLitTokenIndices();
    super._initializeAttributes();
  }

  /**
   * Construct data arrays representing vertices and indices.
   */
  _initializeVerticesAndArrays() {
    this._litTokenVertexGroups = [...this._litTokenPHIndices];
    // this._litTokenVertexGroups.sort((a, b) => a - b); Is sorting useful or necessary?

    const addNormals = this.debugViewNormals;
    const addUVs = false;
    const n = this.geoms.length = this._litTokenPHIndices.size;
    for ( let i = 0; i < n; i += 1 ) {
      const idx = this._litTokenVertexGroups[i];
      const token = this.placeableHandler.placeableFromInstanceIndex.get(idx);
      this.geoms[i] = new GeometryLitTokenDesc({ token, addUVs, addNormals });
    }
    const offsetData = this.offsetData = GeometryDesc.computeBufferOffsets(this.geoms);

    // Combine the different geoms' vertices and indices.
    const vClass = this.verticesArray.constructor;
    const iClass = this.indicesArray.constructor;

    this.verticesBuffer = new ArrayBuffer(offsetData.vertex.totalSize);
    this.indicesBuffer = new ArrayBuffer(offsetData.index.totalSize);
    this.verticesArray = new vClass(this.verticesBuffer);
    this.indicesArray = new iClass(this.indicesBuffer);

    // Create distinct views into the vertices and indices buffers
    this.vertices = new Array(n);
    this.indices = new Array(n);
    for ( let i = 0; i < n; i += 1 ) {
      this.vertices[i] = new vClass(this.verticesBuffer, offsetData.vertex.offsets[i], offsetData.vertex.lengths[i]);
      this.indices[i] = new iClass(this.indicesBuffer, offsetData.index.offsets[i], offsetData.index.lengths[i]);
    }
  }

  _updateLitTokenIndices() {
    let setChanged = false;
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      const hasLitBorder = token.litTokenBorder && !token.litTokenBorder.equals(token.constrainedTokenBorder);
      setChanged ||= hasLitBorder ^ this._litTokenIndices.has(idx);
      if ( hasLitBorder ) this._litTokenIndices.add(idx);
      else this._litTokenIndices.delete(idx);
    }
    return setChanged;
  }

  _defineAttributeProperties() {
    const vertexProps = super._defineAttributeProperties();

    // Reset the placeable values to an identity matrix of the correct size.
    const identityMat4 = MatrixFloat32.identity(4, 4);
    const numInstances = this.placeableHandler.numInstances;
    for ( let i = 0; i < numInstances; i += 1 ) vertexProps.aModel.data.set(identityMat4, i * 16);
    return vertexProps;
  }

  _updateAllInstances() {
    this._initializeAttributes();
  }

  #rebuildNeeded = false;

  validateInstances() {
    super.validateInstances();
    if ( this.#rebuildNeeded ) this._initializeAttributes(); // Set in _updateInstance when 1+ tokens flagged as newly lit.
    this.#rebuildNeeded = false;
  }

  _updateInstance(idx) {
    const token = this.placeableHandler.placeableFromInstanceIndex.get(idx);
    if ( !token ) return;

    // If token is no longer lit, can ignore (eventually will be removed in next updateAll).
    if ( !token.litTokenBorder || token.litTokenBorder.equals(token.constrainedTokenBorder) ) return;

    // TODO: The token is lit, but its geometry has changed versus last time.
    // Either redo the entire attributes b/c the geometry vertices/indices length has changed or
    // update the vertex in place.

    // If the token is newly lit, must update all.
    if ( token.litTokenBorder && !this._litTokenIndices.has(idx) ) this.#rebuildNeeded = true;
  }

  render() { return; }

  filterObjects() { return; }

  renderTarget(target) {
    if ( target.litTokenBorder.equals(target.constrainedTokenBorder) ) return; // Must use DrawableLitToken

    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx === "undefined" ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);

    // TODO: Can we set this up using twgl and use something like the following?
    // See https://twgljs.org/examples/uniform-buffer-objects.html
    twgl.bindUniformBlock(gl, programInfo, this.bufferInfo.material); // TODO: Fix
    twgl.bindUniformBlock(gl, programInfo, this.bufferInfo.camera); // TODO: Fix

    // Convert idx to the

    this.#tmpSet.clear();
    this.#tmpSet.add(idx);

    log(`${this.constructor.name}|renderTarget ${target.name}, ${target.id}`);
    drawInstancedMatrixSet(
      gl,
      this.#tmpSet,
      this.geom.numVertices,
      this.bufferInfo.attribs.aModel,
      this.aModelAttribLoc,
    );
    gl.bindVertexArray(null);
  }
}

/**
 * Custom token geometry.
 */
// class TokenCustom {
//
// }











