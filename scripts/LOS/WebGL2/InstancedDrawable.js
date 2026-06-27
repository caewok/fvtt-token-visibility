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
import { WallGeometry } from "../../geometry/placeable_geometry/WallGeometry.js";
import {
  TokenGeometry,
  TokenSquareGeometry,
  TokenEllipseGeometry,
  TokenHexagonGeometry,
  TokenSphereGeometry,
  TokenPolygonGeometry,
} from "../../geometry/placeable_geometry/TokenGeometry.js";
import { TileGeometry } from "../../geometry/placeable_geometry/TileGeometry.js";
import { LevelForegroundGeometry, LevelBackgroundGeometry } from "../../geometry/placeable_geometry/LevelGeometry.js";
import { RegionGeometry } from "../../geometry/placeable_geometry/RegionGeometry.js";
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

  /** @type {string} */
  static VERTEX_DRAW_TYPE = "STATIC_DRAW";

  /** @type {number} */
  static CAMERA_BIND_POINT = 0;

  /** @type {number} */
  static MATERIAL_BIND_POINT = 1;

  /** @type {number} */
  static stride = 6; // 3d position + 3d normal

  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = null; // Must be defined by child class

  /** @type {WebGL2} */
  webGL2;

  /** @type {WebGL2RenderingContext} */
  get gl() { return this.webGL2.gl; }

  /** @type {boolean} */
  debugView = false;

  constructor({ webGL2 } = {}) {
    this.webGL2 = webGL2;
  }

  // ----- NOTE: Initialization ----- //

  #initialized = false;

  /**
   * Initialize the drawables.
   * Optionally pass geoms to record their last update.
   */
  async initialize(geoms = []) {
    if ( this.#initialized ) return;

    await this._createPrograms();
    this._initializeAttributes();

    geoms ??= this.constructor.activeGeoms();
    this._initializeUniforms(geoms);
    this._recordPlaceableUpdates(geoms);
    this.#initialized = true;
  }

  static get geometryManager() {
    const mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager[this.GEOMETRY_CLASS.LAYER];
    if ( this.GEOMETRY_CLASS.LAYER === "levels" ) return mgr[this.LEVEL_TYPE];
    return mgr;
  }

  static get activeGeoms() {
    if ( !this.GEOMETRY_CLASS ) return [];
    return this.geometryManager.geometryMap.values();
  }

  // ----- NOTE: Program ----- //

  /** @type {string} */
  static VERTEX_FILE = "instance_vertex_ubo_v2";

  /** @type {string} */
  static FRAGMENT_FILE = "fragment_v2";

  // Triggers for enabling pieces of the glsl code.

  /** @type {boolean} */
  static INSTANCED = true;

  /** @type {boolean} */
  static TEXTURED = false;

  /** @type {boolean} */

  /** @type {twgl.ProgramInfo} */
  programInfo;

  /** @type {twgl.ProgramInfo} */
  debugProgramInfo;

  get program() { return this.debugView ? this.debugProgramInfo : this.programInfo; }

  async _createPrograms() {
    this.programInfo = await this._createProgram({ debugViewNormals: false });
    this.debugProgramInfo = await this._createProgram({ debugViewNormals: true });
  }

  async _createProgram({ vertexFile, fragmentFile, ...opts } = {}) {
    // Must include all parameters that could be in the glsl file.
    const { VERTEX_FILE, FRAGMENT_FILE, TEXTURED, INSTANCED } = this.constructor;
    vertexFile ??= VERTEX_FILE;
    fragmentFile ??= FRAGMENT_FILE;
    opts.debugViewNormals ??= false;
    opts.hasTexture ??= TEXTURED;
    opts.isInstanced ??= INSTANCED
    opts.constrainTarget ??= false;
    opts.maxConstrainingWalls ??= 1;
    return await this.webGL2.cacheProgram(vertexFile, fragmentFile, opts);
  }

  // ----- NOTE: Uniforms ----- //

  _initializeUniforms(_geoms) {
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

  /** @type {Map<string, number>} */
  geomLastUpdated = new Map();

  /**
   * Record when geoms were last updated. Run after initialization to capture state of the
   * canvas at first initialization.
   * @param {PlaceableGeometry[]} geoms
   */
  _recordPlaceableUpdates(geoms = []) {
    for ( const geom of geoms ) this.geomLastUpdated.set(geom.placeableId, geom.updateCount);
  }

  /**
   * Update attributes for specific placeable geometry.
   * @param {PlaceableGeometry} geom
   * @returns {boolean} True if updated.
   */
  updateAttributeBuffersForGeom(geom) {
    const id = geom.placeableId;
    const lastUpdate = this.geomLastUpdated.get(id) ?? Number.NEGATIVE_INFINITY;
    if ( lastUpdate >= geom.updateCount ) return false;
    this.geomLastUpdated.set(id, geom.updateCount);
    this._updateAttributeBuffersForId(id);
    return true;
  }

  _updateAttributeBuffersForId(_id) { console.error("_updateAttributeBuffersForId must be defined by child class.");}

  /**
   * Update attributes for all placeables.
   */
  _rebuildAttributeBuffers() { }

  // ----- NOTE: Rendering ----- //

  /** @type {Set<number>} */
  instanceSet = new Set();

  /**
   * Add a specific placeable to the set of placeables to draw.
   */
  addGeomToInstanceSet(geom) {
    this.updateAttributeBuffersForGeom(geom);
    const idx = this._indexForId(geom.placeableId);
    if ( !~idx ) {
      console.warn(`Geometry index not found for ${geom.placeableId}.`, geom);
      return;
    }
    this.instanceSet.add(idx);
  }

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
    const programInfo = this.program;
    this.webGL2.useProgram(programInfo);
    twgl.setBuffersAndAttributes(gl, programInfo, this.attributeBufferInfo);

    this._draw();
    gl.bindVertexArray(null);
    gl.finish(); // For debugging.
  }

  _draw() { console.error("_draw should be defined by child class."); }

  destroy() { }

}
export class AbstractInstancedDrawable extends AbstractDrawable {

  /** @type {ModelMatrixTracker} */
  modelMatrixTracker;

  /** @type {VertexObject} */
  instanceVO;

  /**
   * @param {WebGL2} webGL2                               WebGL2 context
   * @param {twgl.ProgramInfo} shaderProgramInfo          Shader program information
   * @param {VertexObject} instanceVO                     Vertex object containing the vertices and indices for the instance
   * @param {ModelMatrixTracker} modelMatrixTracker       Tracker for all the model matrices.
   */
  constructor({ instanceVO, modelMatrixTracker, ...opts } = {}) {
    super(opts);
    this.instanceVO = instanceVO;
    this.modelMatrixTracker = modelMatrixTracker;
  }

  // ----- NOTE: Attributes ----- //

  get verticesArray() { return this.instanceVO.vertices; }

  get indicesArray() { return this.instanceVO.indices; }

  get modelMatrixArray() { return this.modelMatrixTracker.viewBuffer(); }

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
      // stride: this.placeableHandler.instanceArrayValues.BYTES_PER_ELEMENT * 16,
      // offset: 0,
      divisor: 1,
    };

    // For use in _draw method.
    this.aModelAttribLoc = this.gl.getAttribLocation(this.programInfo.program, 'aModel');

    return attrProps;
  }

  /**
   * Update the model matrix attribute for specific placeable.
   */
  _updateAttributeBuffersForId(id) {
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;

    // See twgl.setAttribInfoBufferFromArray.
    const tracker = this.modelMatrixTracker;
    const modelArr = tracker.viewFacetById(id);
    if ( !modelArr ) console.error(`${this.constructor.name}|_updateModelBufferForInstance|Placeable ${id} not found in model tracker.`);

    const mOffset = tracker.facetOffsetAtId(id) * tracker.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, tracker.viewFacetById(id));
  }

  /**
   * Rebuild attributes.
   */
  _rebuildAttributeBuffers() {
    // Update the model attribute with a new buffer.
    this.attributeProperties.aModel.data = this.modelMatrixArray;
    const attribs = this.attributeBufferInfo.attribs;
    attribs.aModel = twgl.createAttribsFromArrays(this.gl, { aModel: this.attributeProperties.aModel });

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
    this.debugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.debugProgramInfo, attribs);

  }

  _indexForId(id) { return this.modelMatrixTracker.facetIdMap.get(id); }

  _placeableIdForInstanceIndex(idx) { return this.modelMatrixTracker.facetIdMap.getKeyAtIndex(idx); }

  _draw() {
    const nVertices = this.indicesArray.length;
    WebGL2.drawInstancedMatrixSet(
      this.gl,
      this.instanceSet,
      nVertices,
      this.attributeBufferInfo.attribs.aModel,
      this.aModelAttribLoc,);

  }
}

export class AbstractModelDrawable extends AbstractDrawable {

  /** @type {boolean} */
  static INSTANCED = false;

  viTracker;

  /**
   * @param {WebGL2} webGL2                               WebGL2 context
   * @param {twgl.ProgramInfo} shaderProgramInfo          Shader program information
   * @param {VertexObject} instanceVO                     Vertex object containing the vertices and indices for the instance
   * @param {ModelMatrixTracker} modelMatrixTracker       Tracker for all the model matrices.
   */
  constructor({ viTracker, ...opts } = {}) {
    super(opts);
    this.viTracker = viTracker;
  }

  get verticesArray() { return this.viTracker.vertices.viewBuffer(); }

  get indicesArray() { return this.viTracker.indices.viewBuffer(this.viTracker.indicesAdjBuffer); }


  // ----- NOTE: Attributes ----- //

  /**
   * Update the vertices/indices attributes for a specific placeable.
   * Does not handle if the vertices or indices array has changed length.
   */
  _updateAttributeBuffersForId(id) {
    // See twgl.setAttribInfoBufferFromArray.
    const gl = this.gl;
    const vi = this.viTracker;

    // Copy the vertices and adjusted indices to their webGL buffers.
    const { vertices, indicesAdj } = vi.viewFacetById(id);
    if ( !vertices || !indicesAdj ) console.error(`${this.constructor.name}|_updateAttributeBuffersForId|${id} id not found`);
    const vOffset = vi.vertices.facetOffsetAtId(id) * Float32Array.BYTES_PER_ELEMENT;
    const iOffset = vi.indices.facetOffsetAtId(id) * Uint16Array.BYTES_PER_ELEMENT;

    // Vertices.
    const vBuffer = this.attributeBufferInfo.attribs.aPosition.buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vOffset, vertices);

    // Indices.
    const iBuffer = this.attributeBufferInfo.indices;
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

  _indexForId(id) { return this.viTracker.indices.facetIdMap.get(id); }


  _draw() {
    const { facetLength, facetLengths, byteOffsets } = this.viTracker.indices;
    WebGL2.drawSet(this.gl, this.instanceSet, byteOffsets, facetLength || facetLengths);
  }
}

export class AbstractTexturedInstancedDrawable extends AbstractInstancedDrawable {

  /** @type {boolean} */
  static TEXTURED = true;

  /** @type {number} */
  static stride = 8; // Position (3) + Normal (3) + UV (2)

  // ----- NOTE: Attributes ----- //

  /**
   * Build the vertex and index buffers along with any other attributes.
   * Add UVs for textures.
   * @returns {object} The attribute property object passed to twgl.createBufferInfoFromArrays.
   */
  _defineAttributeProperties() {
    const attrProps = super._defineAttributeProperties();
    attrProps.aTexCoord = {
      numComponents: 2,
      buffer: attrProps.aPosition.buffer, // Shared vBuffer
      drawType: this.constructor.VERTEX_DRAW_TYPE,
      stride: this.constructor.stride * Float32Array.BYTES_PER_ELEMENT,
      offset: Float32Array.BYTES_PER_ELEMENT * 6, // Position (3) + Normals (3)
    }
    return attrProps;
  }

  // Because tiles are always quads, don't need to worry about expanding model vertices/indices.

  // ----- NOTE: Textures ----- //

  /** @type {Map<string, WebGLTexture>} */
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

  static textureSource(_geom) { console.error("textureSource getter must be defined by child class."); }

  /**
   * Store texture sources so we know when they change.
   * @type {Map<string, string>} placeable id, url
   */
  textureSourceMap = new Map();

  // TODO: Can we get the texture url from the textures map (WebGLTexture)?
  // Should we store an object there?

  // TODO: Can we store one texture using static because we are reusing this.gl throughout?

  _initializeUniforms(geoms) {
    super._initializeUniforms();
    this._initializeTextures(geoms);
  }

  _initializeTextures(geoms) {
    geoms ??= this.activeGeoms();
    for ( const geom of geoms ) this._initializeTexture(geom);
  }

  _initializeTexture(geom) {
    const textureOpts = this.constructor.textureOptions(this.gl);
    const old = this.textures.get(geom.placeableId);
    if ( old ) old.destroy();
    textureOpts.src = this.constructor.textureSource(geom);
    this.textureSourceMap.set(geom.placeableId, textureOpts.src);
    this.textures.set(geom.placeableId, twgl.createTexture(this.gl, textureOpts));
  }

  _rebuildAttributeBuffers() {
    this.attributeProperties.aTexCoord.data = this.verticesArray;
    super._rebuildAttributeBuffers();
    this._initializeTextures();
  }

  updateAttributeBuffersForGeom(geom) {
    const updated = super.updateAttributeBuffersForGeom(geom);
    if ( !updated ) return;

    // Check if the source changed.
    const src = this.constructor.textureSource(geom);
    if ( this.textureSourceMap.get(geom.placeableId) !== src ) this._initializeTexture(geom);
  }
}

export class DrawableWalls extends AbstractInstancedDrawable {

  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = WallGeometry;

  static create(opts = {}) {
    opts.instanceVO ??= WallGeometry.instanceVO;
    opts.modelMatrixTracker ??= WallGeometry.modelMatrixTracker;
    return new this(opts);
  }

  /**
   * Add a specific placeable to the set of placeables to draw.
   * Add wall segments separately.
   */
  addGeomToInstanceSet(geom, levelId) {
    for ( const segmentGeom of geom.segmentGeoms ) {
      if ( !segmentGeom.isActiveForLevel(levelId) ) continue;
      super.addGeomToInstanceSet(segmentGeom);
    }
  }

  /**
   * Record when geoms were last updated. Run after initialization to capture state of the
   * canvas at first initialization.
   * @param {PlaceableGeometry[]} geoms
   */
  _recordPlaceableUpdates(geoms = []) {
    for ( const geom of geoms ) {
      for ( const segmentGeom of geom.segmentGeoms ) {
        this.geomLastUpdated.set(segmentGeom.placeableId, segmentGeom.updateCount);
      }
    }
  }



}

export class DrawableSquareTokens extends AbstractInstancedDrawable {

  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = TokenSquareGeometry;

  static create(opts = {}) {
    opts.instanceVO ??= TokenSquareGeometry.instanceVO;
    opts.modelMatrixTracker ??= TokenSquareGeometry.modelMatrixTracker;
    return new this(opts);
  }

  /**
   * Add a specific placeable to the set of placeables to draw.
   * Don't add if not square.
   */
  addGeomToInstanceSet(geom) {
    if ( TokenGeometry.shapeTypeForToken(geom.placeableDocument) !== TokenGeometry.SHAPE_TYPES.CUBE ) return;
    super.addGeomToInstanceSet(geom);
  }


}




export class DrawableEllipseTokens extends AbstractInstancedDrawable {

  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = TokenEllipseGeometry;

  static create(opts = {}) {
    opts.instanceVO ??= TokenEllipseGeometry.instanceVO;
    opts.modelMatrixTracker ??= TokenEllipseGeometry.modelMatrixTracker;
    return new this(opts);
  }

  /**
   * Add a specific placeable to the set of placeables to draw.
   * Don't add if not ellipse.
   */
  addGeomToInstanceSet(geom) {
    if ( TokenGeometry.shapeTypeForToken(geom.placeableDocument) !== TokenGeometry.SHAPE_TYPES.ELLIPSE ) return;
    super.addGeomToInstanceSet(geom);
  }
}

export class DrawableHexagonTokens extends AbstractInstancedDrawable {

  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = TokenHexagonGeometry;

  static create(opts = {}) {
    opts.instanceVO ??= TokenHexagonGeometry.instanceVO;
    opts.modelMatrixTracker ??= TokenHexagonGeometry.modelMatrixTracker;
    return new this(opts);
  }

  /**
   * Add a specific placeable to the set of placeables to draw.
   * Don't add if not simple hex.
   */
  addGeomToInstanceSet(geom) {
    const tokenD = geom.placeableDocument;
    if ( TokenGeometry.shapeTypeForToken(tokenD) !== TokenGeometry.SHAPE_TYPES.HEXAGONAL ) return;
    if ( tokenD.w > 1 || tokenD.w !== tokenD.h ) return;
    super.addGeomToInstanceSet(geom);
  }
}

export class DrawableSphereTokens extends AbstractInstancedDrawable {

  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = TokenSphereGeometry;

  static create(opts = {}) {
    opts.instanceVO ??= TokenSphereGeometry.instanceVO;
    opts.modelMatrixTracker ??= TokenSphereGeometry.modelMatrixTracker;
    return new this(opts);
  }
}

export class DrawablePolygonTokens extends AbstractModelDrawable {

  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = TokenPolygonGeometry;

  static create(opts = {}) {
    opts.viTracker ??= TokenPolygonGeometry.viTracker;
    return new this(opts);
  }

  /**
   * Add a specific placeable to the set of placeables to draw.
   * Don't add if simple hexagon.
   */
  addGeomToInstanceSet(geom) {
    const tokenD = geom.placeableDocument;
    if ( TokenGeometry.shapeTypeForToken(tokenD) === TokenGeometry.SHAPE_TYPES.HEXAGONAL
      && !(tokenD.w > 1 || tokenD.w !== tokenD.h) ) return;
    super.addGeomToInstanceSet(geom);
  }
}

// TODO: Regions

export class DrawableTiles extends AbstractTexturedInstancedDrawable {
  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = TileGeometry;

  static textureSource(geom) { return geom.placeableDocument.texture.src; }

  static create(opts = {}) {
    opts.instanceVO ??= TileGeometry.instanceVO;
    opts.modelMatrixTracker ??= TileGeometry.modelMatrixTracker;
    return new this(opts);
  }

  _draw() {
    const instances = new Set(this.instanceSet);

    // Draw each one individually so we can bind the correct texture.
    for ( const idx of instances ) {
      this.instanceSet.clear();
      this.instanceSet.add(idx);
      const id = this._placeableIdForInstanceIndex(idx);
      if ( !id ) continue;
      // gl.bindTexture(gl.TEXTURE_2D, this.textures.get(id));

      // twgl.setUniforms(this.program, { uAlphaThreshold: alphaThreshold }); // TODO: Should be able to bind the texture as well using setUniforms.
      const geom = this.constructor.geometryManager.geomForPlaceableId(id);
      const uniforms = {
        uTexture: this.textures.get(id),
        uAlphaThreshold: geom.alphaThreshold,
      };
      twgl.setUniforms(this.program, uniforms);

      super._draw(); // Draw the single instance.
    }
  }
}

export class DrawableLevelsForeground extends AbstractTexturedInstancedDrawable {
  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = LevelForegroundGeometry;

  static LEVEL_TYPE = "foreground";

  static textureSource(geom) { return geom.placeableDocument.foreground.src; }

  static create(opts = {}) {
    opts.instanceVO ??= LevelForegroundGeometry.instanceVO;
    opts.modelMatrixTracker ??= LevelForegroundGeometry.modelMatrixTracker;
    return new this(opts);
  }
}

export class DrawableLevelsBackground extends AbstractTexturedInstancedDrawable {
  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = LevelBackgroundGeometry;

  static LEVEL_TYPE = "background";

  static textureSource(geom) { return geom.placeableDocument.background.src; }

  static create(opts = {}) {
    opts.instanceVO ??= LevelBackgroundGeometry.instanceVO;
    opts.modelMatrixTracker ??= LevelBackgroundGeometry.modelMatrixTracker;
    return new this(opts);
  }
}

/**
 * Handle constrained token target drawing.
 * Uses a separate fragment shader to test whether a wall segment blocks the viewpoint.
 */
const TokenTargetMixin = superclass => class extends superclass {
  /** @type {number} */
  static NUM_CONSTRAINING_WALLS = 5;

  /**
   * Locate walls that intersect the token border.
   * @param {TokenGeometry} tokenGeom
   * @returns {WallGeometry[]}
   */
  static intersectingWalls(tokenGeom) {
    // For speed, take everything that crosses the token aabb.
    // Shrink by two pixels to avoid walls that simply are on the edge.
    using aabb = tokenGeom.aabb.clone();
    aabb.min.x += 2;
    aabb.min.y += 2;
    aabb.min.z += 2;
    aabb.max.x -= 2;
    aabb.max.y -= 2;
    aabb.max.z -= 2;

    const wallMgr = CONFIG[GEOMETRY_LIB_ID].geometryManager.walls;
    const levelId = tokenGeom.placeableDocument.level;
    const out = [];
    canvas.scene.walls.forEach(wallD => {
      const wallGeom = wallMgr.geomForDocument(wallD);
      if ( wallGeom.segmentGeoms.some(segmentGeom => segmentGeom.isActiveForLevel(levelId)
          && aabb.overlapsConvexPolygon3d(segmentGeom.faces[0])) ) out.push(wallGeom);
    });

    // Sort by closest 2d segment to the 2d center.
    using ctr = tokenGeom.constructor.tokenCenter(tokenGeom.placeableDocument).to2d();
    out.sort((geom0, geom1) => {
      using s0 = WallGeometry.wallSegment2d(geom0.placeableDocument);
      using s1 = WallGeometry.wallSegment2d(geom1.placeableDocument);
      const distA = distanceSquaredToSegment(ctr, s0.a, s0.b);
      const distB = distanceSquaredToSegment(ctr, s1.a, s1.b);
      return distA - distB;
    });

    return out;
  }

  /** @type {twgl.ProgramInfo} */
  targetProgramInfo;

  /** @type {twgl.ProgramInfo} */
  targetDebugProgramInfo;

  async _createPrograms() {
    await super._createPrograms();
    this.targetProgramInfo = await this._createProgram({
      debugViewNormals: false,
      constrainTarget: true,
      maxConstrainingWalls: this.constructor.NUM_CONSTRAINING_WALLS
    });
    this.targetDebugProgramInfo = await this._createProgram({
      debugViewNormals: true,
      constrainTarget: true,
      maxConstrainingWalls: this.constructor.NUM_CONSTRAINING_WALLS
    });
  }

  _initializeUniforms(_geoms) {
    super._initializeUniforms(_geoms);
    const gl = this.gl;

    // Camera used in both debug and regular views.
    const cameraBlockIndex = gl.getUniformBlockIndex(this.targetProgramInfo.program, "Camera");
    if ( cameraBlockIndex !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.targetProgramInfo.program, cameraBlockIndex, this.constructor.CAMERA_BIND_POINT); // 0

    const cameraDebugBlockIndex = gl.getUniformBlockIndex(this.targetDebugProgramInfo.program, "Camera");
    if ( cameraDebugBlockIndex !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.targetDebugProgramInfo.program, cameraDebugBlockIndex, this.constructor.CAMERA_BIND_POINT); // 0

    // Material only used to color the shapes in the debug view.
    const matBlockIdx = gl.getUniformBlockIndex(this.targetDebugProgramInfo.program, "Material");
    if ( matBlockIdx !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.targetDebugProgramInfo.program, matBlockIdx, this.constructor.MATERIAL_BIND_POINT); // 1
  }

  /** @type {twgl.VertexArrayInfo} */
  targetVertexArrayInfo = {};

  /** @type {twgl.VertexArrayInfo} */
  targetDebugVertexArrayInfo = {};

  _initializeAttributes() {
    super._initializeAttributes();
    this.targetVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.targetProgramInfo, this.attributeBufferInfo);
    this.targetDebugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.targetDebugProgramInfo, this.attributeBufferInfo);
  }

  get program() {
    return this.#intersectingWallGeoms.length
      ? (this.debugView ? this.targetDebugProgramInfo : this.targetProgramInfo)
        : super.program;
  }

  #intersectingWallGeoms = [];

  _locateIntersectingWalls() {
    this.#intersectingWallGeoms.length = 0;

    // Find the target geom.
    const id = this._placeableIdForInstanceIndex(this.instanceSet.first());
    if ( !id ) return;
    const targetGeom = this.constructor.geometryManager.geomForPlaceableId(id);

    // Find intersecting walls.
    this.#intersectingWallGeoms = this.constructor.intersectingWalls(targetGeom);
  }

  render(debug = false) {
    if ( !this.instanceSet.size ) return;

    // Determine if walls potentially block the token.
    // Because this is a target, there is only a single instance.
    if ( this.instanceSet.size !== 1 ) console.error("More than one target token instance.");

    this._locateIntersectingWalls();

    super.render(debug);
  }

  _draw() {
    if ( !this.#intersectingWallGeoms.length ) return super._draw();

    // Need the target center.
    const id = this._placeableIdForInstanceIndex(this.instanceSet.first());
    if ( !id ) return;
    const targetGeom = this.constructor.geometryManager.geomForPlaceableId(id);
    using ctr = targetGeom.constructor.tokenCenter(targetGeom.placeableDocument);

    // Set the uniform normals representing planes.
    // All wall segment geoms share the same plane.
    const maxWalls = this.constructor.NUM_CONSTRAINING_WALLS;
    const uNumClipPlanes =  Math.min(maxWalls, this.#intersectingWallGeoms.length);
    const uClipPlanes = new Float32Array(maxWalls * 4);
    for ( let i = 0; i < uNumClipPlanes; i += 1 ) {
      const wallGeom = this.#intersectingWallGeoms[i];
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

    const uniforms = {
      uClipPlanes,
      uNumClipPlanes,
    };
    twgl.setUniforms(this.program, uniforms);
    super._draw();
  }
}

export class DrawableSquareTarget extends mix(DrawableSquareTokens).with(TokenTargetMixin) {}

export class DrawableEllipseTarget extends mix(DrawableEllipseTokens).with(TokenTargetMixin) {}

export class DrawableHexagonTarget extends mix(DrawableHexagonTokens).with(TokenTargetMixin) {}

export class DrawableSphereTarget extends mix(DrawableSphereTokens).with(TokenTargetMixin) {}

export class DrawablePolygonTarget extends mix(DrawablePolygonTokens).with(TokenTargetMixin) {}


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
