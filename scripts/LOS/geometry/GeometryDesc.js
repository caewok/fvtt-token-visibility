/* globals
CONFIG,

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { BasicVertices } from "./BasicVertices.js";
import { setTypedArray } from "../util.js";

const STATIC_VERTEX_KEY = {
  0: "position",
  1: "positionNormal",
  2: "positionUV",
  3: "positionNormalUV",
};

/* Example usage.

1. Instanced object, e.g. wall.

Define single geom with wall params. geom = new GeometryWall({ ... });
geom.vertices --> points to instanced vertices
geom.indices --> points to instanced indices
geom.calculateTransformMatrix --> determine the model matrix

Set temporarily for given wall
geom.placeable = wall --> triggers update
geom.modelVertices --> calculate the model vertices
geom.modelIndices --> calculate the model indices
geom.updateModel --> recalculate for given placeable
geom.transformMatrix --> switch matrices; force recalc when modelVertices used again.

2. Non-instanced object, e.g., constrained token.
Define single geom per token. geomToken = new GeometryConstrainedToken({ token, ...});
geom.placeable = token --> change the underlying placeable
geom.vertices --> points to model vertices
geom.indices --> points to model indices

*/

/**
 * Describe a placeable by its vertices, normals, and uvs.
 * Typically 1x1x1 centered at origin 0,0,0.
 * Can be either instanced or not.
 * - instanced: vertices are static
 * - not instanced: vertices based on placeable
 */
export class GeometryNonInstanced {

  constructor({ addNormals = false, addUVs = false, type, placeable } = {}) {
    this.#type = type;
    this.#instanceType = `${this.constructor.name}_${type}`;
    this.#addNormals = addNormals;
    this.#addUVs = addUVs;
    if ( placeable ) {
      this.#placeable = placeable;
      this.id = placeable.sourceId ?? foundry.utils.randomID();
    }
  }

  id = foundry.utils.randomID();

  // ----- NOTE: Properties set at the constructor ----- //

  #instanceType;

  #type;

  get stride() { return 3 + (this.addNormals * 3) + (this.addUVs * 2); }

  get instanceType() { return this.#instanceType; }

  get type() { return this.#type; }

  get instanced() { return false; }

  #addNormals = false;

  #addUVs = false;

  get addNormals() { return this.#addNormals; }

  set addNormals(value) {
    if ( this.#addNormals === value ) return;
    this.dirtyModel = true;
    this.#addNormals = value;
  }

  get addUVs() { return this.#addUVs; }

  // ----- NOTE: Model properties ----- //

  #modelVertices = new Float32Array();

  get vertices() { return this.modelVertices; }

  get modelVertices() {
    if ( this.#dirtyModel ) this.calculateModel();
    return this.#modelVertices;
  }

  // For normal non-instanced, indices change with the vertices.

  #modelIndices = new Uint16Array();

  get indices() { return this.modelIndices; }

  get modelIndices() {
    if ( this.#dirtyModel ) this.calculateModel();
    return this.#modelIndices;
  }

  #placeable;

  get placeable() { return this.#placeable; }

  set placeable(value) {
    this.#placeable = value;
    this.#dirtyModel = true;
  }

  #dirtyModel = true;

  get dirtyModel() { return this.#dirtyModel; }

  set dirtyModel(value) { this.#dirtyModel ||= value; }

  /**
   * How much to offset the model indices; used when this geom is part of a larger group.
   * @type {number}
   */
  #indexOffset = 0;

  get indexOffset() { return this.#indexOffset; }

  set indexOffset(value) {
    if ( this.#indexOffset === value ) return;
    this.#indexOffset = value;
    this.dirtyModel = true;
  }

  // ----- NOTE: Model methods ----- //

  linkModelVertices(vertices) { this.#modelVertices = vertices; }

  linkModelIndices(indices) { this.#modelIndices = indices; }

  calculateModel() {
    const res = this._calculateModel(this.#modelVertices, this.#modelIndices);
    if ( res.vertices ) this.#modelVertices = setTypedArray(this.#modelVertices, res.vertices);
    if ( res.indices ) {
      const is = this.#modelIndices = setTypedArray(this.#modelIndices, res.indices);
      if ( this.indexOffset ) {
        const offset = this.indexOffset;
        is.forEach((elem, idx) => is[idx] += offset);
      }
    }

    this.#dirtyModel = false;
  }

  _calculateModel(vertices, _indices) {
     const { addNormals, addUVs } = this;
     const vs = this._calculateModelVertices(vertices);
     return BasicVertices.trimVertexData(vs, { addNormals, addUVs });
  }

  _calculateModelVertices(_vertices) {
    console.error("_calculateModelVertices must be defined by child class.");
  }


  // ----- NOTE: Other static methods ----- //

  /**
   * Determine the buffer offsets to store vertex data for a given group of geometries.
   * @param {number} idx            Which vertexData index to use.
   * @param {GeometryDesc[]}  geoms The geometries used in the buffer
   * @returns {object}
   * - @prop {array} offsets        In byteLength; sum of the sizes iteratively
   * - @prop {array} sizes          In byteLength
   * - @prop {array} numVertices      Number of vertices in each
   * - @prop {number} totalVertices Sum of the numVertices
   * - @prop {number} totalSize     Sum of the sizes
   */
  static computeBufferOffsets(geoms) {
    const ln = geoms.length;
    const out = {
      vertex: {
        offsets: new Uint16Array(ln), // Byte size of vertices consecutively summed.
        sizes: new Uint16Array(ln),   // Byte size of vertices.
        lengths: new Uint16Array(ln), // Length of vertices (number components * number of vertices).
        num: new Uint16Array(ln),     // Number of vertices.
        cumulativeNum: new Uint16Array(ln), // Cumulative sum of number of vertices.
        totalLength: 0,
        totalSize: 0,
      },
      index: {
        offsets: new Uint16Array(ln),
        sizes: new Uint16Array(ln),
        lengths: new Uint16Array(ln),
        totalLength: 0,
        totalSize: 0,
      }
    };
    if ( !ln ) return out;

    // Set the initial vertex values.
    const geom = geoms[0];
    const vs = geom.vertices;
    out.vertex.totalSize += out.vertex.sizes[0] = vs.byteLength;
    out.vertex.totalLength += out.vertex.lengths[0] = vs.length;
    out.vertex.num[0] = geom.numVertices;

    // Set the optional initial index values.
    const is = geom.indices
    out.index.totalSize += out.index.sizes[0] = is?.byteLength ?? 0;
    out.index.totalLength += out.index.lengths[0] = is?.length ?? 0;

    // Process the remaining geoms and iteratively sum values.
    for ( let i = 1; i < ln; i += 1 ) {
      const geom = geoms[i];
      const vs = geom.vertices;

      out.vertex.totalSize += out.vertex.sizes[i] = vs.byteLength;
      out.vertex.totalLength += out.vertex.lengths[i] = vs.length;
      out.vertex.num[i] = geom.numVertices;

      // Optional indices
      const is = geom.indices
      out.index.totalSize += out.index.sizes[i] = is?.byteLength ?? 0;
      out.index.totalLength += out.index.lengths[i] = is?.length ?? 0;

      // Iterative sum of sizes for the offsets and cumulative number.
      out.vertex.offsets[i] += out.vertex.offsets[i - 1] + out.vertex.sizes[i - 1];
      out.vertex.cumulativeNum[i] += out.vertex.cumulativeNum[i - 1] + out.vertex.num[i - 1];
      out.index.offsets[i] += out.index.offsets[i - 1] + out.index.sizes[i - 1];
    }
    return out;
  }

  // ----- NOTE: Debug ----- //

  debugDrawInstance(opts = {}) {
    const { vertices, indices } = this.instanceVerticesIndices;
    opts.addNormal ??= this.addNormals;
    opts.addUVs ??= this.addUVs;
    BasicVertices.debugDraw(vertices, indices, opts);
  }

  debugDrawModel(opts = {}) {
    const { vertices, indices } = this;
    opts.addNormal ??= this.addNormals;
    opts.addUVs ??= this.addUVs;
    BasicVertices.debugDraw(vertices, indices, opts);
  }
}

export class GeometryInstanced extends GeometryNonInstanced {

  constructor(opts) {
    super(opts);
    this.defineInstance();
  }

  get instanced() { return true; }

  get addNormals() { return super.addNormals; }

  set addNormals(value) {
    super.addNormals = value;
    this.defineInstance(); // Recreate the instance vertices (and indices).
  }

  // ----- NOTE: Instance vertices and indices ---- //

  /**
   * Map of the different instance vertices/indices for different types.
   * e.g. addNormals vs not addNormals
   */
  static instanceMap = new Map();

  #instanceIndices = new Uint16Array();

  #instanceVertices = new Float32Array();

  defineInstance() {
    const map = this.constructor.instanceMap;
    const key = this.instanceKey;
    let trimmed;
    if ( map.has(key) ) trimmed = map.get(key);
    else {
      const vs = this._defineInstanceVertices();
      const { addNormals, addUVs } = this;
      trimmed = BasicVertices.trimVertexData(vs, { addNormals, addUVs });
      map.set(key, trimmed);
    }
    this.#instanceIndices = trimmed.indices;
    this.#instanceVertices = trimmed.vertices;
  }

  _defineInstanceVertices() {
    console.error("calculateTransformMatrix must be overriden by child class.");
  }

  get instanceKey() {
    const i = this.addNormals + (this.addUVs * 2);
    return `${STATIC_VERTEX_KEY[i]}_${this.instanceType}`;
  }

  get instanceIndices() { return this.#instanceIndices; }

  get instanceVertices() { return this.#instanceVertices; }

  // ----- NOTE: Model properties ----- //

  get vertices() { return this.instanceVertices; }

  get indices() { return this.instanceIndices; }

  // ----- NOTE: Transform matrix ----- //

  #transformMatrix = null;

  get transformMatrix() {
    if ( !this.#transformMatrix ) {
      // Cannot calculate the transform in the constructor b/c RegionGeometry will not yet have set the region property.
      this.#transformMatrix = CONFIG.GeometryLib.MatrixFloat32.identity(4, 4);
      this.calculateTransformMatrix();
      this.dirtyModel = true;
    }
    return this.#transformMatrix;
  }

  set transformMatrix(M) {
    M.copyTo(this.#transformMatrix);
    this.dirtyModel = true;
  }

  linkTransformMatrix(arr) {
    if ( !(arr.length === 16 && arr instanceof Float32Array) ) console.warn("linkTransformMatrix|arr should be 16-element Float32Array", arr);
    if ( !this.#transformMatrix ) this.#transformMatrix = CONFIG.GeometryLib.MatrixFloat32.identity(4, 4);
    this.#transformMatrix.arr = arr;
    this.calculateTransformMatrix();
  }

  get placeable() { return super.placeable; }

  set placeable(value) {
    super.placeable = value;
    this.transformMatrix = this.calculateTransformMatrix(value);
  }

  calculateTransformMatrix(_placeable) {
    console.error("calculateTransformMatrix must be overriden by child class.")
    // Child should set transformMatrix (using clone, copyTo, or outMatrix).
  }

  // ----- NOTE: Model methods ----- //

  _calculateModel(vertices, _indices) {
    this.calculateTransformMatrix();
    vertices = setTypedArray(vertices, this.instanceVertices);
    return {
      vertices: BasicVertices.transformVertexPositions(vertices, this.transformMatrix, this.stride),
      indices: this.instanceIndices,
    }
  }
}


