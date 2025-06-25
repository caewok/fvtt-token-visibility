/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { IndexMap } from "../util.js";


/**
 * Helper class that tracks the offsets of a variable length buffer,
 * but does not actually create the buffer or its components (facets).
 * Tracks total buffer size and associates arbitrary ids with indexes along the buffer.
 */
export class VariableLengthAbstractBuffer {
  /** @type {number} */
  static RESIZE_MULTIPLIER = 2; // Must be an integer.

  /**
   * @param {object} [opts]
   * @param {number} [numFacets=0]                  Number of components / facets to represent
   * @param {class} [opts.type=Float32Array]        Class of the typed array; may be modified at any time
   * @param {number|number[]} [opts.facetLengths]   Array identifying the length of each facet or a number if each facet has the same length
   * @param {number} [opts.maxLength]               If set, the buffer will be at least this large; useful if numFacets is 0
   * @param {*[]} [opts.ids]                        Label for each facet; extra labels will be ignored; defaults to index number
   */
  constructor({ numFacets, facetLengths, type, maxLength, ids } = {}) {
    if ( type ) this.#type = type;
    facetLengths ??= [];
    maxLength ??= 0;

    let arrayLength;
    if ( Number.isNumeric(facetLengths) ) {
      numFacets ||= 0;
      arrayLength = facetLengths * numFacets;
      facetLengths = (new Array(numFacets)).fill(facetLengths);
    } else arrayLength = facetLengths.reduce((acc, curr) => acc + curr, 0);
    this.#facetLengths = facetLengths;
    this.#maxLength = Math.max(arrayLength, maxLength);

    // Set the index ids for each facet created thus far.
    numFacets = this.#facetLengths.length;
    ids ??= Array.fromRange(numFacets);
    for ( let i = 0; i < numFacets; i += 1 ) this.facetIdMap.set(ids[i], i);
  }

  calculateOffsets() {
    const numFacets = this.numFacets;
    this.#cumulativeFacetLengths.length = this.#facetLengths.length;
    this.#cumulativeFacetLengths[0] = this.#facetLengths[0];
    for ( let i = 1; i < numFacets; i += 1 ) {
      this.#cumulativeFacetLengths[i] = this.#cumulativeFacetLengths[i - 1] + this.#facetLengths[i];
    }
  }

  // ----- NOTE: Properties ----- //
  #type = Float32Array;

  get type() { return this.#type; }

  set type(value) { this.#type = value; }

  #maxLength = 0;

  get maxLength() { return this.#maxLength; }

  #facetLengths = [];

  get facetLengths() { return [...this.#facetLengths]; }

  #cumulativeFacetLengths = [];

  get cumulativeFacetLengths() { return [...this.#cumulativeFacetLengths]; }

  // ----- NOTE: Calculated properties ----- //

  get maxByteLength() { return this.#maxLength * this.#type.BYTES_PER_ELEMENT; }

  get numFacets() { return this.#facetLengths.length; }

  get arrayLength() { return this.#cumulativeFacetLengths.at(-1) || 0; }

  get arraySize() { return this.arrayLength * this.#type.BYTES_PER_ELEMENT; }

  get byteOffsets() { return this.#cumulativeFacetLengths.map(elem => elem * this.#type.BYTES_PER_ELEMENT); }

  facetLengthAtIndex(idx) { return this.#facetLengths[idx]; }

  facetOffsetAtIndex(idx) { return this.#cumulativeFacetLengths[idx] - this.#facetLengths[idx]; }

  facetOffsetAtId(id) { return this.facetOffsetAtIndex(this.facetIdMap.get(id)); }

  // ----- NOTE: Facet tracking ----- //

  facetIdMap = new IndexMap();

  setFacetId(id, idx) {
    if ( idx < 0 || idx > (this.numFacets - 1) ) console.warn(`idx ${idx} is out of bounds.`);
    this.facetIdMap.set(id, idx);
  }

  /**
   * Add a facet to any spot in the array that has sufficient space.
   * @param {*} id                  Any value that can be a key in a map
   * @param {number} facetLength    Length of the facet / component
   * @param {number[]|TypedArray}   The values to set for this facet
   * @returns {boolean} True if the buffer had to be expanded to add the new facet
   */
  addFacet({ id, facetLength, newValues } = {}) {
    if ( id != null && this.facetIdMap.has(id) ) return this.updateFacet(id, { facetLength, newValues });
    id ??= this.facetIdMap.nextIndex;

    facetLength ??= newValues.length;
    if ( !facetLength || facetLength < 0 ) console.error(`updateFacet|Valid facetLength or newValues must be provided.`, { facetLength, newValues });

    let i;
    for ( i of this.facetIdMap.iterateEmptyIndices() ) {
      const existingLength = this.facetLengthAtIndex[i];
      if ( facetLength === existingLength || !existingLength ) break;
    }

    this.facetIdMap.set(id, i);
    this.#facetLengths[i] = facetLength;
    this.calculateOffsets();
    const expanded = this.arrayLength > this.maxLength;
    if ( expanded ) this.expand();

    // Flag for subclasses that modification should occur.
    if ( newValues ) this._updateFacetAtIndex(i, newValues);
    return expanded;
  }

  /**
   * Update the facet at the given id.
   * Moves it elsewhere if necessary to keep the array.
   * @param {*} id                  Any value that can be a key in a map
   * @param {number} facetLength    Length of the facet / component
   * @param {number[]|TypedArray}   The values to set for this facet
   * @returns {boolean} True if the buffer had to be expanded (because facet length changed).
   */
  updateFacet(id, { facetLength, newValues } = {}) {
    if ( !this.facetIdMap.has(id) ) return this.addFacet({ id, facetLength, newValues });
    facetLength ??= newValues.length;
    if ( !facetLength || facetLength < 0 ) console.error(`updateFacet|Valid facetLength or newValues must be provided.`, { facetLength, newValues });

    const idx = this.facetIdMap.get(id);
    if ( this.facetLengthAtIndex(idx) !== facetLength ) {
      this.deleteFacet(id);
      return this.addFacet({ id, facetLength, newValues });
    }

    // Flag for subclasses that modification should occur.
    if ( newValues ) this._updateFacetAtIndex(idx, newValues);
    return false;
  }

  /**
   * Delete the facet at the given id.
   * Does not otherwise modify the buffer length.
   * @param {*} id                  Any value that can be a key in a map
   */
  deleteFacet(id) {
    if ( !this.facetIdMap.has(id) ) return false;
    const idx = this.facetIdMap.get(id);
    this.facetIdMap.delete(id);
    this._deleteFacetAtIndex(idx);
    this.calculateOffsets();
  }

  deleteFacetAtIndex(idx) {
    const id = this.facetIdMap.index[idx];
    if ( id == null ) return false;
    return this.deleteFacet(id);
  }

  // Force either a facet to be added at the index or override the current.
  updateFacetAtIndex(idx, opts) {
    const id = this.facetIdMap.index[idx];
    if ( id == null ) return this.addFacet(opts);
    return this.updateFacet(id, opts);
  }

  // ----- NOTE: Facet creation/update/deletion ----- //

  _updateFacetAtIndex(_idx, _newValues) { return; }

  _deleteFacetAtIndex(_idx) { return; }

  /**
   * Drop all empty facet slots in the array and make the array contiguous.
   * @returns {boolean} True if the buffer would have to be modified, false otherwise.
   */
  makeContiguous() {
    const mapIndex = this.facetIdMap.index;
    let bufferModified = false;
    for ( let i = 0, iMax = mapIndex.length; i < iMax; i += 1 ) {
      if ( mapIndex[i] != null ) continue;
      bufferModified ||= true;

      // Shift the next non-null facet to the left.
      let j;
      for ( j = i + 1; j < iMax; j += 1 ) {
        const id = mapIndex[j];
        if ( id == null ) continue;
        const hangingLength = this.facetLengthAtIndex(j);
        const hangingOffset = this.facetOffsetAtIndex(j);
        const targetOffset = this.facetOffsetAtIndex(i);
        this._shift(hangingOffset, hangingLength, targetOffset);
        this.facetIdMap.set(id, i);
        mapIndex[j] = null;
        this.#facetLengths[i] = this.#facetLengths[j];
        this.#facetLengths[j] = 0;
        break;
      }
      i = j - 1;

    }
    // Facet lengths were moved so that the end lengths no longer valid.
    this.#facetLengths.length = this.facetIdMap.size;
    this.calculateOffsets();
    return bufferModified;
  }

  // Meant to be used like this:
  // blockToShift = new type(buffer, byteOffset, length);
  // viewBuffer.set(blockToShift, targetOffset)
  _shift(_byteOffset, _length, _targetOffset) { return; }

  expand(minLength) {
    this.#maxLength ||= 1; // So we are not multiplying by 0.
    minLength ||= this.arrayLength;
    while ( this.#maxLength < minLength ) this.#maxLength *= this.constructor.RESIZE_MULTIPLIER;
  }

  // ----- NOTE: Views ----- //

  viewBuffer(buffer) { return new this.type(buffer, 0, this.arrayLength); }

  viewWholeBuffer(buffer) { return new this.type(buffer, 0, Math.floor(this.maxLength)); }

  viewFacetById(id, buffer) {
    if ( !this.facetIdMap.has(id) ) return null;
    return this.viewFacetAtIndex(this.facetIdMap.get(id), buffer);
  }

  viewFacetAtIndex(idx, buffer) {
    if ( idx < 0 || idx > (this.numFacets - 1) ) return null;
    return new this.type(
      buffer,
      this.facetOffsetAtIndex(idx) * this.type.BYTES_PER_ELEMENT, // Byte offset to get to this element.
      this.facetLengthAtIndex(idx) // Length of this element.
    );
  }

  copyToBufferById(id, buffer, newValues) {
    const arr = this.viewFacetById(id, buffer);
    arr.set(newValues);
  }
}

/** Tracking buffer

Helper class that creates a typed array buffer:
- Tracks X elements each of N length.
- Access each object in the buffer.
- Delete object and (optionally) shrink the buffer.
- Add objects and expand the buffer.
- Get view of any given object or the entire buffer.
*/
export class VariableLengthTrackingBuffer extends VariableLengthAbstractBuffer {

  /** @type {ArrayBuffer} */
  buffer;

  /**
   * @param {number} [numFacets=0]    Number of components / facets to represent
   * @param {object} [opts]
   * @param {class} [opts.type=Float32Array]        Class of the typed array
   * @param {number|number[]} [opts.facetLengths]   Array identifying the length of each facet or a number if each facet has the same length
   * @param {number} [opts.maxByteLength]           If set, the buffer will be at least this large; useful if numFacets is 0
   */
  constructor(opts) {
    super(opts);

    // Construct a new array bufffer.
    this.buffer = new ArrayBuffer(this.maxByteLength);
  }

  get type() { return super.type; }

  // ----- NOTE: Views ----- //

  /** @type {TypedArray} */
  viewBuffer(buffer) { return super.viewBuffer(buffer || this.buffer); }

  viewWholeBuffer(buffer) { return super.viewWholeBuffer(buffer || this.buffer); }

  viewFacetAtIndex(idx, buffer) { return super.viewFacetAtIndex(idx, buffer || this.buffer); }

  viewFacetById(id, buffer) { return super.viewFacetById(id, buffer || this.buffer); }

  // ----- NOTE: Facet handling ----- //

  _updateFacetAtIndex(idx, newValues) { this.viewFacetAtIndex(idx).set(newValues); }

  // Don't really need to do anything; just ignore those values.
  // _deleteFacetAtIndex(idx) {}

  _shift(byteOffset, length, targetOffset) {
    const blockToShift = new this.type(this.buffer, byteOffset, length);
    this.viewBuffer().set(blockToShift, targetOffset);
  }

  /**
   * Double the size of the array buffer.
   */
  expand(minLength) {
    super.expand(minLength);
    this.buffer = this.buffer.transferToFixedLength(this.maxByteLength);
  }
}

export class FixedLengthTrackingBuffer extends VariableLengthTrackingBuffer {

  constructor(opts = {}) {
    // Determine the number of facets and facet lengths based on the facetLengths array and other options.
    let facetLength;
    let numFacets;
    if ( Number.isNumeric(opts.facetLengths) ) {
      facetLength = opts.facetLengths;
      numFacets = opts.numFacets;
    } else {  // Must be array.
      facetLength = opts.facetLengths[0];
      numFacets = opts.numFacets ??= opts.facetLengths.length;
    }
    facetLength ||= 1;
    numFacets ||= 0;

    // Use the constructor to build a zero-length array.
    opts.numFacets = 0
    opts.facetLengths = [];
    opts.maxLength = Math.max(facetLength * numFacets, opts.maxLength || 0); // Ensure buffer is sufficiently large to hold the actual number of facets.
    super(opts);

    this.#numFacets = numFacets;
    this.#facetLength = facetLength;

    // Set the index ids for each facet created thus far.
    opts.ids ??= Array.fromRange(numFacets);
    for ( let i = 0; i < numFacets; i += 1 ) this.facetIdMap.set(opts.ids[i], i);
  }

  // Unneeded b/c each offset is the same.
  calculateOffsets() { return; }

  // ----- NOTE: Properties fixed at construction ----- //

  /** @type {number} */
  #facetLength = 16;

  get facetLength() { return this.#facetLength; }

  get facetLengths() { return (new Array(this.#numFacets).fill(this.facetLength)); }

  #numFacets = 0;

  get numFacets() { return this.#numFacets; }

  // ----- NOTE: Calculated properties ----- //

  get arrayLength() { return this.numFacets * this.facetLength; }

  get cumulativeFacetLengths() { return this.facetLength * this.numFacets; }

  facetLengthAtIndex(_idx) { return this.facetLength; }

  facetOffsetAtIndex(idx) { return this.facetLength * idx; }

  // ----- NOTE: Facet tracking ----- //

  /**
   * Add a facet to any spot in the array that has sufficient space.
   * @param {*} id                  Any value that can be a key in a map
   * @param {number[]|TypedArray}   The values to set for this facet; length must equal the preset facet length
   * @returns {boolean} True if the buffer had to be expanded to add the new facet
   */
  addFacet({id, newValues } = {}) {
    if ( newValues && newValues.length !== this.facetLength ) console.error(`New values length must equal ${this.facetLength}`, newValues);
    if ( id != null && this.facetIdMap.has(id) ) return this.updateFacet(id, { newValues });
    id ??= this.facetIdMap.nextIndex;

    const i = this.facetIdMap.nextIndex;
    this.facetIdMap.set(id, i);
    this.#numFacets += 1;
    const expanded = this.arrayLength > this.maxLength;
    if ( expanded ) this.expand();

    // Flag for subclasses that modification should occur.
    if ( newValues ) this._updateFacetAtIndex(i, newValues);
    return expanded;
  }

  /**
   * Update the facet at the given id.
   * Moves it elsewhere if necessary to keep the array.
   * @param {*} id                  Any value that can be a key in a map
   * @param {number[]|TypedArray}   The values to set for this facet; length must equal the preset facet length
   * @returns {boolean} Always false
   */
  updateFacet(id, { newValues } = {}) {
    if ( newValues && newValues.length !== this.facetLength ) console.error(`New values length must equal ${this.facetLength}`, newValues);
    if ( !this.facetIdMap.has(id) ) return this.addFacet({ id, newValues });

    // Flag for subclasses that modification should occur.
    if ( newValues ) this._updateFacetAtIndex(this.facetIdMap.get(id), newValues);
    return false;
  }

  /**
   * Delete the facet at the given id.
   * Does not otherwise modify the buffer length.
   * @param {*} id                  Any value that can be a key in a map
   */
  deleteFacet(id) {
    const res = super.deleteFacet(id);
    if ( res ) this.#numFacets = Math.max(0, this.#numFacets - 1);
  }

   /**
   * Drop all empty facet slots in the array and make the array contiguous.
   * @returns {boolean} True if the buffer would have to be modified, false otherwise.
   */
  makeContiguous() {
    const mapIndex = this.facetIdMap.index;
    let bufferModified = false;
    for ( let i = 0, iMax = mapIndex.length; i < iMax; i += 1 ) {
      if ( mapIndex[i] != null ) continue;
      bufferModified ||= true;

      // Shift the next non-null facet to the left.
      let j;
      for ( j = i + 1; j < iMax; j += 1 ) {
        const id = mapIndex[j];
        if ( id == null ) continue;
        const hangingLength = this.facetLengthAtIndex(j);
        const hangingOffset = this.facetOffsetAtIndex(j);
        const targetOffset = this.facetOffsetAtIndex(i);
        this._shift(hangingOffset, hangingLength, targetOffset);
        this.facetIdMap.set(id, i);
        mapIndex[j] = null;
        break;
      }
      i = j - 1;
    }
    // Facet lengths were moved so that the end lengths no longer valid.
    this.calculateOffsets();
    return bufferModified;
  }
}

/**
 * Track vertices and indices together.
 * Calculate offset for indices.
 * Assumes indices do not reference vertices across facets.
 * (More compressed version could use a single large set of vertices, but then it would require more frequent rebuilds.)
 * Example:
 *   stride = 3 (3 coordinates make up one vertex referenced by a single index)
 *   facetLengths = [9, 12]
 *   facetOffsets = [0, 9]
 *   vertices = [10, 11, 12,  20, 21, 22,  30, 31, 32, | 40, 41, 42,  50, 51, 52,  60, 61, 62,  70, 71, 72]
 *   indices = [0, 1, 2, |  3, 2, 1, 0 ] <-- Add 3 to the second set of vertices, 6 to the third.
 *     --> indices become [0, 1, 2 | 6, 5, 4, 3]
 */
export class VerticesIndicesAbstractTrackingBuffer {
  static vBufferClass = VariableLengthAbstractBuffer;

  static iBufferClass = VariableLengthAbstractBuffer;

  vertices;

  indices;

  get numFacets() { return this.vertices.numFacets; }

  stride = 3;

  indicesOffsetAtId(id) { return Math.floor(this.vertices.facetOffsetAtId(id) / this.stride); }

  indicesOffsetAtIdx(idx) { return Math.floor(this.vertices.facetOffsetAtIdx(idx) / this.stride); }

  constructor({ verticesType = Float32Array, indicesType = Uint16Array, stride = 3 } = {}) {
    this.vertices = new this.constructor.vBufferClass({ type: verticesType });
    this.indices = new this.constructor.iBufferClass({ type: indicesType });
    this.stride = stride;
  }

  addFacet({ id, verticesLength, newVertices, indicesLength, newIndices } = {}) {
    if ( !(indicesLength || newIndices) ) {
      verticesLength ??= newVertices.length;
      newIndices = Array.fromRange(verticesLength / this.stride);
    }
    this.vertices.addFacet({ id, newValues: newVertices, facetLength: verticesLength });
    return this.indices.addFacet({ id, newValues: newIndices, facetLength: indicesLength });
  }

  updateFacet(id, { verticesLength, newVertices, indicesLength, newIndices }) {
    if ( !(indicesLength || newIndices) ) {
      verticesLength ??= newVertices.length;
      newIndices = Array.fromRange(verticesLength / this.stride);
    }
    this.vertices.updateFacet(id, { newValues: newVertices, facetLength: verticesLength });
    return this.indices.updateFacet(id, { newValues: newIndices, facetLength: indicesLength });
  }

  deleteFacet(id) {
    this.vertices.deleteFacet(id);
    this.indices.deleteFacet(id);
  }

  viewBuffer(verticesBuffer, indicesBuffer) {
    return {
      indices: this.indices.viewBuffer(indicesBuffer),
      vertices: this.vertices.viewBuffer(verticesBuffer)
    }
  }

  viewWholeBuffer(verticesBuffer, indicesBuffer) {
    return {
      indices: this.indices.viewBuffer(indicesBuffer),
      vertices: this.vertices.viewBuffer(verticesBuffer)
    }
  }

  viewFacetById(id, verticesBuffer, indicesBuffer) {
   return {
      indices: this.indices.viewFacetById(id, indicesBuffer),
      vertices: this.vertices.viewFacetById(id, verticesBuffer)
    }
  }

  // Copy the index, adjusting by offset.
  copyToIndicesBuffer(buffer) {
    for ( const id of this.indices.facetIdMap.keys() ) {
      this.copyToIndicesBufferById(id, buffer, this.indices.viewFacetById(id, buffer));
    }
  }

  // Copy the index, adjusting by offset.
  copyToIndicesBufferById(id, buffer, newValues) {
    newValues = newValues.map(elem => elem + this.indicesOffsetAtId(id));
    this.indices.copyToBufferById(id, buffer, newValues);
  }
}

export class VerticesIndicesTrackingBuffer extends VerticesIndicesAbstractTrackingBuffer {
  static vBufferClass = VariableLengthTrackingBuffer;

  static iBufferClass = VariableLengthTrackingBuffer;

  indicesAdjBuffer; // With offset applied.

  constructor(opts = {}) {
    super(opts);
    this.indicesAdjBuffer = new ArrayBuffer(this.indices.maxByteLength);
  }

  addFacet(opts = {}) {
    opts.id ??= this.indices.facetIdMap.nextIndex;
    const expanded = super.addFacet(opts);
    if ( expanded ) this.expand();
    this.copyToIndicesBufferById(opts.id, this.indicesAdjBuffer, this.indices.viewFacetById(opts.id));
    return expanded;
    // No change to other facet indices b/c vertices are added at the end or replace vertex facet of equal length.
  }

  updateFacet(id, opts = {}) {
    const expanded = super.updateFacet(id, opts);
    if ( expanded ) this.expand();
    this.copyToIndicesBufferById(id, this.indicesAdjBuffer, this.indices.viewFacetById(id));
    return expanded;
    // No change to other facet indices b/c vertices are added at the end or replace vertex facet of equal length.
  }

  expand() {
    this.indicesAdjBuffer = this.indicesAdjBuffer.transferToFixedLength(this.indices.maxByteLength);
  }

  viewBuffer(_buffer) {
    return {
      indices: this.indices.viewBuffer(),
      vertices: this.vertices.viewBuffer(),
      indicesAdj: this.indices.viewBuffer(this.indicesAdjBuffer),
    };
  }

  viewWholeBuffer(_buffer) {
    return {
      indices: this.indices.viewWholeBuffer(),
      vertices: this.vertices.viewWholeBuffer(),
      indicesAdj: this.indices.viewWholeBuffer(this.indicesAdjBuffer),
    }
  }

  viewFacetById(id, _buffer) {
    return {
      indices: this.indices.viewFacetById(id),
      vertices: this.vertices.viewFacetById(id),
      indicesAdj: this.indices.viewFacetById.call(id, this.indicesAdjBuffer),
    }
  }

  viewFacetAtIndex(idx, _buffer) {
    return {
      indices: this.indices.viewFacetAtIndex(idx),
      vertices: this.vertices.viewFacetAtIndex(idx),
      indicesAdj: this.indices.viewFacetAtIndex(idx, this.indicesAdjBuffer),
    }
  }

  // Not yet implemented: makeContiguous.
  // Requires resetting the indicesAdjBuffer and ensuring indices and vertices stay in sync.

}





/* Testing
MODULE_ID = "tokenvisibility"
api = game.modules.get("tokenvisibility").api
VariableLengthAbstractBuffer = api.placeableTracker.VariableLengthAbstractBuffer
FixedLengthTrackingBuffer = api.placeableTracker.FixedLengthTrackingBuffer
VariableLengthTrackingBuffer = api.placeableTracker.VariableLengthTrackingBuffer
VerticesIndicesAbstractTrackingBuffer = api.placeableTracker.VerticesIndicesAbstractTrackingBuffer
VerticesIndicesTrackingBuffer = api.placeableTracker.VerticesIndicesTrackingBuffer

tb = new VariableLengthTrackingBuffer({ facetLengths: [3,4,5,5,5] })
tb.viewFacetAtIndex(0).set([1,2,3])
tb.viewFacetAtIndex(1).set([1,2,3,4])
tb.viewFacetAtIndex(2).set([1,2,3,4,5])

tb.deleteFacet(1)
tb.addFacet({ newValues: [10,11,12,13]})



tb = new FixedLengthTrackingBuffer({ facetLengths: 4, numFacets: 5 })
tb.viewFacetAtIndex(0).set([0,1,2,3])
tb.viewFacetAtIndex(1).set([4,5,6,7])
tb.viewFacetAtIndex(2).set([8,9,10,11])
tb.viewFacetAtIndex(3).set([12,13,14,15])
tb.viewFacetAtIndex(4).set([16,17,18,19])

tb = new VariableLengthTrackingBuffer()
tb = new VariableLengthAbstractBuffer()
tb.addFacet({ id: "A", facetLength: 5 })
tb.addFacet({ id: "B", facetLength: 10 })
tb.addFacet({ id: "C", facetLength: 5 })
tb.addFacet({ id: "D", facetLength: 7 })
tb.addFacet({ id: "E", facetLength: 9 })

tb.deleteFacet("B")
tb.deleteFacet("D")

tb.makeContiguous()

5 10 5 7 9
5 5 9

ph = new api.placeableTracker.TokenInstanceHandler(

opts = {
      addNormals: false,
      addUVs: false,
      placeable: null,
    };
geoms = []
opts.token = canvas.tokens.placeables[0]
geoms.push(new api.geometry.GeometryConstrainedToken(opts))
opts.token = canvas.tokens.placeables[1]
geoms.push(new api.geometry.GeometryConstrainedToken(opts))

viTracker = new VerticesIndicesTrackingBuffer({ stride: 3})
viTracker.addFacet({ newVertices: [10, 11, 12, 20, 21, 22, 30, 31, 32], newIndices: [0, 1, 2]})
viTracker.addFacet({ newVertices: [40, 41, 42,  50, 51, 52,  60, 61, 62,  70, 71, 72], newIndices: [3, 2, 1, 0]})
*/
