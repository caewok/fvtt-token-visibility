/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/* Bit ops

Bitwise AND (&) Returns 1 if both corresponding bits are 1; otherwise, returns 0.
Bitwise OR (|) Returns 1 if at least one of the corresponding bits is 1; otherwise, returns 0.
Bitwise XOR (^) Returns 1 if the corresponding bits are different; otherwise, returns 0.
Bitwise NOT (~) Inverts all the bits of its single operand. This is a unary operator.
Left Shift (<<) Shifts bits to the left, filling new positions with zeros from the right.
Signed Right Shift (>>) Shifts bits to the right, preserving the sign bit by filling new positions on the left with the value of the sign bit.
Zero-fill Right Shift (>>>) Shifts bits to the right, filling new positions with zeros from the left, regardless of the sign bit.

Max 32-bit signed: ± 2.14 billion (2 ** 32)

Note that 2 ** idx is equivalent to 1 << idx. Latter is likely faster.

*/

/**
 * Small bit math class that uses a single word.
 * Must not exceed 32 indices.
 */
export class SmallBitSet {

  /** @type {Number} */
  word = 0;

  static fromNumber(n = 0) {
    const out = new this();
    out.word = n;
    return out;
  }

  static fromIndices(arr = []) {
    const out = new this();
    arr.forEach(elem => out.word |= (1 << elem) );
    return out;
  }

  static fromString(binaryString) {
    const out = new this();
    out.word = parseInt(binaryString, 2);
    return out;
  }

  clone() {
    const out = new this();
    out.word = this.word;
    return out;
  }

  and(value) { this.word &= value; return this; }

  or(value) { this.word |= value; return this; }

  xor(value) { this.word ^= value; return this; }

  invert() { this.word = ~this.word; }

  andNew(value) { return this.constructor.fromNumber(this.word & value); }

  orNew(value) { return this.constructor.fromNumber(this.word | value); }

  xorNew(value) { return this.constructor.fromNumber(this.word ^ value); }

  invertNew() { return this.constructor.fromNumber(~this.word); }

  hasIndex(idx) { return (this.word & (1 << idx)) !== 0; }

  union(other) { this.word ||= other.word; return this; }

  unionNew(other) { return this.constructor.fromNumber(this.word | other.word); }

  intersection(other) { this.word &= other.word; return this; }

  intersectionNew(other) { return this.constructor.fromNumber(this.word & other.word); }

  intersects(other) { return this.word & other.word !== 0; }

  equals(other) { return this.word === other.word; }

  get isEmpty() { return this.word === 0; }

  set(idx, enable = true) {
    if ( enable ) return this.setIndex(idx);
    else return this.unsetIndex(idx);
  }

  setIndex(idx) {
    this.word |= (1 << idx);
    return this;
  }

  unsetIndex(idx) {
    if ( this.hasIndex(idx) ) this.word ^= (1 << idx);
    return this;
  }

  fillToIndex(idx) {
    this.word = (1 << idx) - 1;
    return this;
  }

  clear() { this.word = 0; return this; }

  toIndices() { return [...this]; }

  toString() { return this.word.toString(2); }

  get cardinality() {
    // Kernighan's Algorithm
    // Alt: n.toString(2).split('0').join('').length;
    let count = 0;
    let n = this.word;
    while ( n > 0 ) {
      n &= (n - 1); // Clears the least significant set bit
      count++;
    }
    return count;
  }

  *[Symbol.iterator]() {
    let i = 0; // Represents the current bit position (0-indexed)

    // Iterate while the number is greater than 0
    let num = this.word;
    while ( num > 0 ) {
      // Check if the rightmost bit is set (i.e., odd number)
      if ( (num & 1) === 1 ) yield i;

      // Right-shift the number to check the next bit
      num >>= 1;
      i++;
    }
  }

  forEach(callback) { for ( const idx of this ) callback(idx); }
}

SmallBitSet.prototype.union = SmallBitSet.prototype.or;
SmallBitSet.prototype.intersection = SmallBitSet.prototype.and;


