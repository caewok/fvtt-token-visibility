/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";




/** Tracking buffer

Helper class that creates a typed array buffer:
- Tracks X elements each of N length.
- Access each object in the buffer.
- Delete object and (optionally) shrink the buffer.
- Add objects and expand the buffer.
- Get view of any given object or the entire buffer.
*/

export class VariableLengthTrackingBuffer {
  /** @type {number} */
  static RESIZE_MULTIPLIER = 2; // Must be an integer.

  /** @type {ArrayBuffer} */
  buffer;

  constructor(numFacets, opts) {
    if ( opts.type ) this.#type = opts.type;
    numFacets = Math.max(Math.round(numFacets), 1);

    let facetLengths = opts.facetLengths;
    if ( Number.isNumeric(facetLengths) ) facetLengths = (new Array(numFacets)).fill(facetLengths);
    if ( facetLengths.length !== numFacets ) console.error(`Must have ${numFacets} elements in facetLength array`, { facetLengths });
    this.#facetLengths = facetLengths;

    // Construct a new array bufffer.
    this.calculateOffsets();
    const arrayLength = facetLengths.reduce((acc, curr) => acc + curr, 0);
    const maxByteLength = this.#maxByteLength = arrayLength * this.type.BYTES_PER_ELEMENT;
    this.buffer = new ArrayBuffer(maxByteLength);
  }

  #facetLengths = [];

  #cumulativeFacetLengths = [];

  calculateOffsets() {
    const numFacets = this.numFacets;
    this.#cumulativeFacetLengths.length = this.#facetLengths.length;
    this.#cumulativeFacetLengths[0] = this.#facetLengths[0];
    for ( let i = 1; i < numFacets; i += 1 ) {
      this.#cumulativeFacetLengths[i] = this.#cumulativeFacetLengths[i - 1] + this.#facetLengths[i];
    }
  }

  // ----- NOTE: Properties fixed at construction ----- //

  /** @type {number} */
  #maxByteLength;

  get maxByteLength() { return this.#maxByteLength; }

  /** @type {number} */
  get arrayLength() { return this.#cumulativeFacetLengths.at(-1); }

  /** @type {class} */
  #type = Float32Array;

  get type() { return this.#type; }

  // ----- NOTE: Calculated properties ----- //

  get numFacets() { return this.#facetLengths.length; }


  // ----- NOTE: Other properties ----- //
  facetLengthAtIndex(idx) { return this.#facetLengths[idx]; }

  facetOffsetAtIndex(idx) { return this.#cumulativeFacetLengths[idx] - this.#facetLengths[idx]; }

  setFacetLength(idx, { facetLength, newValues } = {}) {
    facetLength ??= newValues.length;
    if ( !facetLength || facetLength < 0 ) console.error(`setFacetLength|Either valid length or new values must be provided.`, { facetLength, newValues });
    if ( idx < 0 || idx > this.#facetLengths.length ) console.error(`setFacetLength|idx ${idx} is out of bounds.`);

    const oldLength = this.#facetLengths[idx];
    if ( oldLength === facetLength ) return false;

    const oldRemainderOffset = this.#cumulativeFacetLengths[idx + 1];
    const oldFullLength = this.arrayLength;
    let expanded = false;
    if ( oldLength > facetLength ) {
      // Confirm space is available for the move.
      const newSize = (oldFullLength + facetLength) * this.type.BYTES_PER_ELEMENT;
      expanded = newSize > this.maxByteLength;
      if ( expanded ) this.expand();
    }

    // Update the offsets
    this.calculateOffsets();
    const newOffset = this.#cumulativeFacetLengths[idx];
    const newRemainderOffset = this.#cumulativeFacetLengths[idx + 1];

    // Move everything after the idx to its new location.
    const view = this.viewWholeBuffer;
    view.set(view.subarray(oldRemainderOffset, oldFullLength), newRemainderOffset); // TODO: Can use subarray here, right? Seems to work.

    // Copy the new values.
    if ( newValues ) view.set(newValues, newOffset)

    // Return true if the buffer is expanded.
    return expanded;
  }

  // ----- NOTE: Array buffer views ----- //

  /** @type {TypedArray} */
  get viewBuffer() { return new this.#type(this.buffer, 0, this.arrayLength); }

  get viewWholeBuffer() { return new this.#type(this.buffer, 0, Math.floor(this.#maxByteLength / this.#type.BYTES_PER_ELEMENT)); }

  viewFacetAtIndex(idx) {
    if ( idx < 0 || idx > (this.numFacets - 1) ) return null;
    return new this.type(
      this.buffer,
      this.facetOffsetAtIndex(idx) * this.type.BYTES_PER_ELEMENT, // Byte offset to get to this element.
      this.facetLengthAtIndex(idx) // Length of this element.
    );
  }

  viewFacetById(id) {
    if ( !this.facetIdMap.has(id) ) return null;
    return this.viewFacetAtIndex(this.facetIdMap.get(id));
  }

  // ----- NOTE: Facet handling ----- //

  facetIdMap = new Map();

  setFacetId(id, idx) {
    if ( idx < 0 || idx > (this.numFacets - 1) ) console.warn(`idx ${idx} is out of bounds.`);
    this.facetIdMap.set(id, idx);
  }

  deleteFacetById(id) {
    if ( !this.facetIdMap.has(id) ) return false;
    return this.deleteFacet(this.facetIdMap.get(id));
  }

  deleteFacet(idx) {
    const { buffer, facetIdMap, type, numFacets } = this;
    if ( numFacets < idx ) return false;

    // Determine if hanging data needs to be shifted down given the removed facet.
    const numHanging = numFacets - idx - 1;
    if ( numHanging > 0 ) {
      const hangingLength = this.arrayLength - this.facetOffsetAtIndex(idx) - this.facetLengthAtIndex(idx);
      const hangingOffset = this.facetOffsetAtIndex(idx + 1);
      const idxOffset = this.facetOffsetAtIndex(idx);

      // Shift the element values after idx to move down, so the buffer remains contiguous.
      const remainingView = new type(buffer, hangingOffset * type.BYTES_PER_ELEMENT, hangingLength);
      this.viewBuffer.set(remainingView, idxOffset);
    }

    // Remove the facet from the lengths array and recalculate.
    this._removeFacetAtIndex(idx);
    this.calculateOffsets();

    // Change ids to match
    for ( const [id, i] of facetIdMap.entries() ) {
      if ( i < idx ) continue;
      if ( i === idx ) facetIdMap.delete(id);
      facetIdMap.set(id, i - 1);
    }
    return true;
  }

  _removeFacetAtIndex(idx) { this.#facetLengths.splice(idx, 1); }

  /**
   * Add element to the end.
   * Expands array as needed.
   */
  addFacet({ facetLength, id, newValues } = {}) {
    const { type, facetIdMap } = this;
    facetLength ??= newValues.length;
    if ( !facetLength || facetLength < 0 ) console.error(`setFacetLength|Either valid length or new values must be provided.`, { facetLength, newValues });

    // Add the facet length to the tracking array and recalculate.
    this._addFacetWithLength(facetLength);
    this.calculateOffsets();

    // If out of space, double the buffer max size.
    const newSize = this.arrayLength * type.BYTES_PER_ELEMENT;
    const expanded = newSize > this.maxByteLength;
    if ( expanded ) this.expand();

    // Update the element count.
    const idx = this.numFacets - 1;
    if ( id ) facetIdMap.set(id, idx)

    // Copy the new values.
    if ( newValues ) this.viewFacetAtIndex(idx).set(newValues);

    return expanded; // Return expanded so buffer can be swapped out as needed.
  }

  _addFacetWithLength(facetLength) { this.#facetLengths.push(facetLength); }

  /**
   * Double the size of the array buffer.
   */
  expand() {
    const maxByteLength = this.#maxByteLength *= this.constructor.RESIZE_MULTIPLIER;
    this.buffer = this.buffer.transferToFixedLength(maxByteLength);
  }
}


export class FixedLengthTrackingBuffer extends VariableLengthTrackingBuffer {

  constructor(numFacets, { facetLength = 1, ...opts } = {}) {
    opts.facetLengths ??= facetLength;
    super(numFacets, opts);

    this.#numFacets = Math.max(Math.round(numFacets), 1);
    this.#facetLength = opts.facetLengths;
  }

  // ----- NOTE: Properties fixed at construction ----- //

  /** @type {number} */
  #facetLength = 16;

  get facetLength() { return this.#facetLength; }

  #numFacets = 0;

  get numFacets() { return this.#numFacets; }

  // ----- NOTE: Calculated properties ----- //

  get maxN() { return Math.floor(this.maxByteLength / this.facetSize); }

  get facetSize() { return this.#facetLength * this.type.BYTES_PER_ELEMENT; }

  get arrayLength() { return this.#numFacets * this.facetLength; }

  // ----- NOTE: Array buffer views ----- //

  /** @type {TypedArray} */
  get viewBuffer() { return new this.type(this.buffer, 0, this.#numFacets * this.#facetLength); }

  get viewWholeBuffer() { return new this.type(this.buffer, 0, this.maxN * this.#facetLength); }

  viewFacetAtIndex(idx) {
    if ( idx < 0 || idx > (this.numFacets - 1) ) return null;
    return new this.type(this.buffer, idx * this.facetSize, this.facetLength);
  }

  // ----- NOTE: Element handling ----- //

  facetLengthAtIndex(_idx) { return this.#facetLength; }

  facetOffsetAtIndex(idx) { return this.#facetLength * idx; }

  setFacetLength() { console.warn("FixedLengthTrackingBuffer cannot modify facet lengths."); return false; }

  calculateOffsets() { return; } // Unused.

  addFacet(opts = {}) {
    opts.facetLength = this.#facetLength;
    return super.addFacet(opts);
  }

  _removeFacetAtIndex(_idx) { this.#numFacets -= 1; }

  _addFacetWithLength(_facetLength) { this.#numFacets += 1; }
}



/* Testing
MODULE_ID = "tokenvisibility"
api = game.modules.get("tokenvisibility").api
FixedLengthTrackingBuffer = api.placeableHandler.FixedLengthTrackingBuffer
VariableLengthTrackingBuffer = api.placeableHandler.VariableLengthTrackingBuffer
tb = new VariableLengthTrackingBuffer(5, { facetLengths: [3,4,5,5,5] })
tb.viewFacetAtIndex(0).set([1,2,3])
tb.viewFacetAtIndex(1).set([1,2,3,4])
tb.viewFacetAtIndex(2).set([1,2,3,4,5])

tb.deleteFacet(1)

tb = new FixedLengthTrackingBuffer(5, { facetLengths: 4 })
tb.viewFacetAtIndex(0).set([0,1,2,3])
tb.viewFacetAtIndex(1).set([4,5,6,7])
tb.viewFacetAtIndex(2).set([8,9,10,11])
tb.viewFacetAtIndex(3).set([12,13,14,15])
tb.viewFacetAtIndex(4).set([16,17,18,19])

*/
