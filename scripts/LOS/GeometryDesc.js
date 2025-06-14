/* globals
CONFIG,

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { BasicVertices } from "./BasicVertices.js";
import { setTypedArray } from "./util.js";

const STATIC_VERTEX_KEY = {
  0: "position",
  1: "positionNormal",
  2: "positionUV",
  3: "positionNormalUV",
};

/**
 * Describe a placeable by its vertices, normals, and uvs.
 * Typically 1x1x1 centered at origin 0,0,0.
 *
 */
export class GeometryDesc {

  /**
   * Each class stores its unit vertices and indices statically
   */
  /* Define in child class; otherwise will be linked to this version.
  static verticesIndices = {
    position: null,
    positionUV: null,
    positionNormal: null,
    positionNormalUV: null,
  };
  */

  /**
   * Each instance can store specific indices and vertices for an object, which may vary
   * from the static versions.
   */
  /** @type {Float32Array} */
  _vertices = new Float32Array();

  /** @type {Uint16Array} */
  _indices = new Uint16Array();

  /** @type {Placeable} */
  placeable;

  #addNormals = false;

  #addUVs = false;

  get addNormals() { return this.#addNormals; }

  get addUVs() { return this.#addUVs; }

  get stride() { return 3 + (this.addNormals * 3) + (this.addUVs * 2); }

  static verticesIndicesMap = new Map();

  /**
   * @param {Placeable} [placeable]     The placeable object, if needed to customize the vertices.
   * @param {object} [opts]
   * @param {boolean} [opts.addNormals]  True adds normals to the vertex data
   * @param {boolean} [opts.addUVS]      True adds UVs to the vertex data
   */
  constructor(placeable, { addNormals = false, addUVs = false} = {}) {
    this.placeable = placeable;
    this.#addNormals = addNormals;
    this.#addUVs = addUVs;
  }

  /**
   * Need not be called directly.
   */
  #initialized = false;

  get initialized() { return this.#initialized; }

  initialize(force = false) {
    if ( !force && this.#initialized ) return;
    this.defineStaticVerticesIndices();
    if ( this.placeable ) this.calculateTransformMatrix();
    this.#initialized = true;
  }

  get staticVertexKey() {
    const i = this.addNormals + (this.addUVs * 2);
    return STATIC_VERTEX_KEY[i];
  }

  get instanceVerticesIndices() {
    const key = this.staticVertexKey;
    const map = this.constructor.verticesIndicesMap;
    if ( !map.has(key) ) this.initialize(true);
    return map.get(key) ?? {};
  }

  get instanceVertices() { return this.instanceVerticesIndices.vertices; }

  get instanceIndices() { return this.instanceVerticesIndices.indices; }

  defineStaticVerticesIndices(addNormals = false, addUVs = false) {
    const vs = this._defineStaticVertices();
    const trimmed = BasicVertices.trimVertexData(vs, { addNormals, addUVs });
    this._indices = setTypedArray(this._indices, trimmed.indices);
    this.constructor.verticesIndicesMap.set(this.staticVertexKey, trimmed);
  }

  _defineStaticVertices() {
    console.error("_defineStaticVertices must be overriden by child class.")
  }

  get vertices() {
    if ( !this.placeable ) return [];
    if ( !this.constructor.verticesIndicesMap.has(this.staticVertexKey) ) this.defineStaticVerticesIndices();
    if ( !this._vertices.length ) this.updateModelVertices();
    return this._vertices;
  }

  set vertices(value) { this._vertices = value; }

  get indices() {
    if ( !this.placeable ) return [];
    if ( !this._indices.length
      || !this.constructor.verticesIndicesMap.has(this.staticVertexKey) ) this.defineStaticVerticesIndices();
    return this._indices;
  }

  set indices(value) { this._indices = value; }

  #transformMatrix = CONFIG.GeometryLib.MatrixFlat.identity(4, 4);

  get transformMatrix() { return this.#transformMatrix; }

  set transformMatrix(M) { M.copyTo(this.#transformMatrix); }

  calculateTransformMatrix() {
    console.error("calculateTransformMatrix must be overriden by child class.")
    // Child should set transformMatrix (using clone, copyTo, or outMatrix).
  }

  updateModelVertices(M) {
    if ( M ) M.copyTo(this.#transformMatrix);
    else this.calculateTransformMatrix();
    this.calculateModelVertices();
    // Indices already set in defineStaticVerticesIndices.
  }

  calculateModelVertices() {
    this._vertices = setTypedArray(this._vertices, this.instanceVertices);
    return BasicVertices.transformVertexPositions(this._vertices, this.transformMatrix, this.stride);
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