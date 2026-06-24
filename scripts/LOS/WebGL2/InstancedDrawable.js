/* globals
CONFIG,
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

  /** @type {boolean} */
  static INSTANCED = true;

  /** @type {boolean} */
  static TEXTURED = false;

  /** @type {string} */
  static VERTEX_FILE = "instance_vertex_ubo_v2";

  /** @type {string} */
  static FRAGMENT_FILE = "fragment_v2";

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
    this.programInfo = await this._createProgram();
    this.debugProgramInfo = await this._createDebugProgram();
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

  /** @type {twgl.ProgramInfo} */
  programInfo;

  /** @type {twgl.ProgramInfo} */
  debugProgramInfo;

  get program() { return this.debugView ? this.debugProgramInfo : this.programInfo; }

  async _createProgram(opts = {}) {
    // Must include all parameters that could be in the glsl file.
    opts.debugViewNormals = false;
    opts.hasTexture ??= this.constructor.TEXTURED;
    opts.isInstanced ??= this.constructor.INSTANCED;
    return this.webGL2.cacheProgram(
      this.constructor.VERTEX_FILE,
      this.constructor.FRAGMENT_FILE,
      opts,
    );
  }

  async _createDebugProgram(opts = {}) {
    // Must include all parameters that could be in the glsl file.
    opts.debugViewNormals = true;
    opts.hasTexture ??= this.constructor.TEXTURED;
    opts.isInstanced ??= this.constructor.INSTANCED;
    return this.webGL2.cacheProgram(
      this.constructor.VERTEX_FILE,
      this.constructor.FRAGMENT_FILE,
      opts,
    );
  }

  // ----- NOTE: Uniforms ----- //

  _initializeUniforms(_geoms) {
    // Material only used to color the shapes in the debug view.
    const matBlockIdx = gl.getUniformBlockIndex(this.debugProgramInfo, "Material");
    if ( matBlockIdx !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.debugProgramInfo, matBlockIdx, 1);
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
    const attribs = this.attributeBufferInfo.attrib;
    attribs.aModel = twgl.createAttribsFromArrays(this.gl, { aModel: this.attributeProperties.aModel });

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
    this.debugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.debugProgramInfo, attribs);

  }

  _indexForId(id) { return this.modelMatrixTracker.facetIdMap.get(id); }

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

  get indicesArray() { return this.viTracker.indicesAdjBuffer; }


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
    const vBuffer = this.attributeBufferInfo.attribs.aPos.buffer;
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

    const attribs = this.attributeBufferInfo.attrib;
    attribs.aModel = twgl.createAttribsFromArrays(this.gl, { aModel: this.attributeProperties.aModel });

    // Update the VAO with the new model buffer information.
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, attribs);
  }

  _indexForId(id) { return this.viTracker.indices.facetIdMap.get(id); }


  _draw() {
    const { facetLength, facetLengths, byteOffsets } = this.viTracker.indices;
    WebGL2.drawSet(this.gl, this.instanceSet, byteOffsets, facetLength || facetLengths);
  }
}

// Set that is used for temporary values.
// Not guaranteed to have any specific value.
const TMP_SET = new Set();

export class AbstractTexturedModelDrawable extends AbstractModelDrawable {

  /** @type {boolean} */
  static TEXTURED = true;

  /** @type {number} */
  static stride = 8; // Postion (3) + Normal (3) + UV (2)

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
      buffer: attrProps.buffer, // Shared vBuffer
      stride: this.constructor.stride,
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
    const old = this.textures.get(geom.sourceId);
    if ( old ) old.destroy();
    textureOpts.src = this.constructor.textureSource(geom);
    this.textureSourceMap.set(geom.placeableId, textureOpts.src);
    this.textures.set(geom.sourceId, twgl.createTexture(this.gl, textureOpts));
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

  _draw(alphaThreshold = 0.75) {
    // Same as super._draw.
    const gl = this.gl;
    const { facetLength, facetLengths, byteOffsets } = this.viTracker.indices;

    // Draw each one individually so we can bind the correct texture.
    for ( const idx of this.instanceSet ) {
      TMP_SET.clear();
      TMP_SET.add(idx);
      const id = this.viTracker.facetIdMap.getKeyAtIndex(idx);
      if ( !id ) continue;
      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(id));

      twgl.setUniforms(this.program, { uAlphaThreshold: alphaThreshold }); // TODO: Should be able to bind the texture as well using setUniforms.

      // uniforms.uTexture = this.textures.get(idx);
      // twgl.setUniforms(this.programInfo, uniforms);

      // Same as super.draw, using the TMP_SET
      WebGL2.drawSet(gl, TMP_SET, byteOffsets, facetLength || facetLengths);
    }
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

export class DrawableTiles extends AbstractTexturedModelDrawable {
  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = TileGeometry;

  static textureSource(geom) { return geom.placeableDocument.texture.src; }

  static create(opts = {}) {
    opts.viTracker ??= TileGeometry.viTracker;
    return new this(opts);
  }

  _draw() {
    // Same as super._draw.
    const gl = this.gl;
    const { facetLength, facetLengths, byteOffsets } = this.viTracker.indices;

    // Draw each one individually so we can bind the correct texture.
    for ( const idx of this.instanceSet ) {
      TMP_SET.clear();
      TMP_SET.add(idx);
      const id = this.viTracker.facetIdMap.getKeyAtIndex(idx);
      if ( !id ) continue;
      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(id));

      // Get the geom for the placeable.
      const geom = this.constructor.geometryManager.geomForPlaceableId(id);

      twgl.setUniforms(this.program, { uAlphaThreshold: geom.alphaThreshold }); // TODO: Should be able to bind the texture as well using setUniforms.

      // uniforms.uTileTexture = this.textures.get(idx);
      // twgl.setUniforms(this.programInfo, uniforms);

      // Same as super.draw, using the TMP_SET
      WebGL2.drawSet(gl, TMP_SET, byteOffsets, facetLength || facetLengths);
    }
  }
}

export class DrawableLevelsForeground extends AbstractTexturedModelDrawable {
  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = LevelForegroundGeometry;

  static LEVEL_TYPE = "foreground";

  static textureSource(geom) { return geom.placeableDocument.foreground.src; }

  static create(opts = {}) {
    opts.viTracker ??= LevelForegroundGeometry.viTracker;
    return new this(opts);
  }
}

export class DrawableLevelsBackground extends AbstractTexturedModelDrawable {
  /** @type {class<PlaceableGeometry>} */
  static GEOMETRY_CLASS = LevelBackgroundGeometry;

  static LEVEL_TYPE = "background";

  static textureSource(geom) { return geom.placeableDocument.background.src; }

  static create(opts = {}) {
    opts.viTracker ??= LevelBackgroundGeometry.viTracker;
    return new this(opts);
  }
}