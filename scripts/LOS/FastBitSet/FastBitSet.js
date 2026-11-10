/* FastBitSet.js : a fast bit set implementation in JavaScript.
 * (c) the authors
 * Licensed under the Apache License, Version 2.0.
 *
 * Speed-optimized BitSet implementation for modern browsers and JavaScript engines.
 *
 * A BitSet is an ideal data structure to implement a Set when values being stored are
 * reasonably small integers. It can be orders of magnitude faster than a generic set implementation.
 * The FastBitSet implementation optimizes for speed, leveraging commonly available features
 * like typed arrays.
 *
 * Simple usage :
 *  // const FastBitSet = require("fastbitset");// if you use node
 *  const b = new FastBitSet();// initially empty
 *  b.add(1);// add the value "1"
 *  b.has(1); // check that the value is present! (will return true)
 *  b.add(2);
 *  console.log(""+b);// should display {1,2}
 *  b.add(10);
 *  b.array(); // would return [1,2,10]
 *
 *  let c = new FastBitSet([1,2,3,10]); // create bitset initialized with values 1,2,3,10
 *  c.difference(b); // from c, remove elements that are in b (modifies c)
 *  c.difference2(b); // from c, remove elements that are in b (modifies b)
 *  c.change(b); // c will contain elements that are in b or in c, but not both
 *  const su = c.union_size(b);// compute the size of the union (bitsets are unchanged)
 *  c.union(b); // c will contain all elements that are in c and b
 *  const s1 = c.intersection_size(b);// compute the size of the intersection (bitsets are unchanged)
 *  c.intersection(b); // c will only contain elements that are in both c and b
 *  c = b.clone(); // create a (deep) copy of b and assign it to c.
 *  c.equals(b); // check whether c and b are equal
 *
 *   See README.md file for a more complete description.
 *
 * You can install the library under node with the command line
 *   npm install fastbitset
 */

// (Converted to class.)

"use strict";

export class FastBitSet {
  /** @type {number[]} */
  words = [];

  constructor(iterable) {
    if ( iterable ) { for ( const value of iterable ) this.add(value); }
  }

  // Creates a bitmap from words
  static fromWords(words) {
    const bitSet = new this();
    bitSet.words = words;
    return bitSet;
  }

  // Add the value (Set the bit at index to true)
  add(index) {
    this.resize(index);
    this.words[index >>> 5] |= 1 << index;
  }

  // If the value was not in the set, add it, otherwise remove it (flip bit at index)
  flip(index) {
    this.resize(index);
    this.words[index >>> 5] ^= 1 << index;
  }

  // Remove all values, reset memory usage
  clear() {
    this.words.length = 0;
  }

  // Set the bit at index to false
  remove(index) {
    this.resize(index);
    this.words[index >>> 5] &= ~(1 << index);
  }

  // Return true if no bit is set
  get isEmpty() {
    const c = this.words.length;
    for (let i = 0; i < c; i++) {
      if (this.words[i] !== 0) return false;
    }
    return true;
  }

  // Is the value contained in the set? Is the bit at index true or false? Returns a boolean
  has(index) {
    return (this.words[index >>> 5] & (1 << index)) !== 0;
  }

  // Tries to add the value (Set the bit at index to true), return 1 if the
  // value was added, return 0 if the value was already present
  checkedAdd(index) {
    this.resize(index);
    const word = this.words[index >>> 5];
    const newword = word | (1 << index);
    this.words[index >>> 5] = newword;
    return (newword ^ word) >>> index;
  }

  // Reduce the memory usage to a minimum
  trim() {
    let nl = this.words.length;
    while (nl > 0 && this.words[nl - 1] === 0) {
      nl--;
    }
    this.words.length = nl;
  }

  // Resize the bitset so that we can write a value at index
  resize(index) {
    const count = (index + 32) >>> 5; // just what is needed
    for (let i = this.words.length; i < count; i++) this.words[i] = 0;
  }

  // Fast function to compute the Hamming weight of a 32-bit unsigned integer
  hammingWeight(v) {
    v -= (v >>> 1) & 0x55555555; // works with signed or unsigned shifts
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24;
  }

  // Fast function to compute the Hamming weight of four 32-bit unsigned integers
  hammingWeight4(v1, v2, v3, v4) {
    v1 -= (v1 >>> 1) & 0x55555555;
    v2 -= (v2 >>> 1) & 0x55555555;
    v3 -= (v3 >>> 1) & 0x55555555;
    v4 -= (v4 >>> 1) & 0x55555555;

    v1 = (v1 & 0x33333333) + ((v1 >>> 2) & 0x33333333);
    v2 = (v2 & 0x33333333) + ((v2 >>> 2) & 0x33333333);
    v3 = (v3 & 0x33333333) + ((v3 >>> 2) & 0x33333333);
    v4 = (v4 & 0x33333333) + ((v4 >>> 2) & 0x33333333);

    v1 = (v1 + (v1 >>> 4)) & 0xf0f0f0f;
    v2 = (v2 + (v2 >>> 4)) & 0xf0f0f0f;
    v3 = (v3 + (v3 >>> 4)) & 0xf0f0f0f;
    v4 = (v4 + (v4 >>> 4)) & 0xf0f0f0f;
    return ((v1 + v2 + v3 + v4) * 0x1010101) >>> 24;
  }

  // How many values stored in the set? How many set bits?
  size() {
    let answer = 0;
    const c = this.words.length;
    const w = this.words;
    for (let i = 0; i < c; i++) answer += this.hammingWeight(w[i]);
    return answer;
  }

  get cardinality() { return this.size(); }

  // Return an array with the set bit locations (values)
  array() {
    const answer = new Array(this.size());
    let pos = 0 | 0;
    const c = this.words.length;
    for (let k = 0; k < c; ++k) {
      let w = this.words[k];
      while (w != 0) {
        const t = w & -w;
        answer[pos++] = (k << 5) + this.hammingWeight((t - 1) | 0);
        w ^= t;
      }
    }
    return answer;
  }

  // Iterate over set bit locations
  forEach(fnc) {
    const c = this.words.length;
    for (let k = 0; k < c; ++k) {
      let w = this.words[k];
      while (w != 0) {
        const t = w & -w;
        fnc((k << 5) + this.hammingWeight((t - 1) | 0));
        w ^= t;
      }
    }
  }

  // Returns an iterator of set bit locations (values)
  [Symbol.iterator]() {
    const c = this.words.length;
    let k = 0;
    let w = this.words[k];
    const hw = this.hammingWeight.bind(this);
    const words = this.words;
    return {
      [Symbol.iterator]() {
        return this;
      },
      next() {
        while (k < c) {
          if (w !== 0) {
            const t = w & -w;
            const value = (k << 5) + hw((t - 1) | 0);
            w ^= t;
            return { done: false, value };
          } else {
            k++;
            if (k < c) {
              w = words[k];
            }
          }
        }
        return { done: true, value: undefined };
      },
    };
  }

  // Creates a copy of this bitmap
  clone() {
    const clone = new this.constructor();
    clone.words = this.words.slice();
    return clone;
  }

  // Check if this bitset intersects with another one, no bitmap is modified
  intersects(otherbitmap) {
    const newcount = Math.min(this.words.length, otherbitmap.words.length);
    for (let k = 0 | 0; k < newcount; ++k) {
      if ((this.words[k] & otherbitmap.words[k]) !== 0) return true;
    }
    return false;
  }

  // Computes the intersection between this bitset and another one (modifies current bitmap)
  intersection(otherbitmap) {
    const newcount = Math.min(this.words.length, otherbitmap.words.length);
    let k = 0 | 0;
    for (; k + 7 < newcount; k += 8) {
      this.words[k] &= otherbitmap.words[k];
      this.words[k + 1] &= otherbitmap.words[k + 1];
      this.words[k + 2] &= otherbitmap.words[k + 2];
      this.words[k + 3] &= otherbitmap.words[k + 3];
      this.words[k + 4] &= otherbitmap.words[k + 4];
      this.words[k + 5] &= otherbitmap.words[k + 5];
      this.words[k + 6] &= otherbitmap.words[k + 6];
      this.words[k + 7] &= otherbitmap.words[k + 7];
    }
    for (; k < newcount; ++k) {
      this.words[k] &= otherbitmap.words[k];
    }
    const c = this.words.length;
    for (k = newcount; k < c; ++k) {
      this.words[k] = 0;
    }
    return this;
  }

  // Computes the size of the intersection between this bitset and another one
  intersection_size(otherbitmap) {
    const newcount = Math.min(this.words.length, otherbitmap.words.length);
    let answer = 0 | 0;
    for (let k = 0 | 0; k < newcount; ++k) {
      answer += this.hammingWeight(this.words[k] & otherbitmap.words[k]);
    }
    return answer;
  }

  // Computes the intersection between this bitset and another one, generating a new bitmap
  new_intersection(otherbitmap) {
    const answer = Object.create(FastBitSet.prototype);
    const count = Math.min(this.words.length, otherbitmap.words.length);
    answer.words = new Array(count);
    let k = 0 | 0;
    for (; k + 7 < count; k += 8) {
      answer.words[k] = this.words[k] & otherbitmap.words[k];
      answer.words[k + 1] = this.words[k + 1] & otherbitmap.words[k + 1];
      answer.words[k + 2] = this.words[k + 2] & otherbitmap.words[k + 2];
      answer.words[k + 3] = this.words[k + 3] & otherbitmap.words[k + 3];
      answer.words[k + 4] = this.words[k + 4] & otherbitmap.words[k + 4];
      answer.words[k + 5] = this.words[k + 5] & otherbitmap.words[k + 5];
      answer.words[k + 6] = this.words[k + 6] & otherbitmap.words[k + 6];
      answer.words[k + 7] = this.words[k + 7] & otherbitmap.words[k + 7];
    }
    for (; k < count; ++k) {
      answer.words[k] = this.words[k] & otherbitmap.words[k];
    }
    return answer;
  }

  // Checks equality with another bitset
  equals(otherbitmap) {
    const mcount = Math.min(this.words.length, otherbitmap.words.length);
    for (let k = 0 | 0; k < mcount; ++k) {
      if (this.words[k] != otherbitmap.words[k]) return false;
    }
    if (this.words.length < otherbitmap.words.length) {
      const c = otherbitmap.words.length;
      for (let k = this.words.length; k < c; ++k) {
        if (otherbitmap.words[k] != 0) return false;
      }
    } else if (otherbitmap.words.length < this.words.length) {
      const c = this.words.length;
      for (let k = otherbitmap.words.length; k < c; ++k) {
        if (this.words[k] != 0) return false;
      }
    }
    return true;
  }

  // Computes difference A = A - B (modifies current set)
  difference(otherbitmap) {
    const newcount = Math.min(this.words.length, otherbitmap.words.length);
    let k = 0 | 0;
    for (; k + 7 < newcount; k += 8) {
      this.words[k] &= ~otherbitmap.words[k];
      this.words[k + 1] &= ~otherbitmap.words[k + 1];
      this.words[k + 2] &= ~otherbitmap.words[k + 2];
      this.words[k + 3] &= ~otherbitmap.words[k + 3];
      this.words[k + 4] &= ~otherbitmap.words[k + 4];
      this.words[k + 5] &= ~otherbitmap.words[k + 5];
      this.words[k + 6] &= ~otherbitmap.words[k + 6];
      this.words[k + 7] &= ~otherbitmap.words[k + 7];
    }
    for (; k < newcount; ++k) {
      this.words[k] &= ~otherbitmap.words[k];
    }
    return this;
  }

  // Computes difference in a new bitmap
  new_difference(otherbitmap) {
    return this.clone().difference(otherbitmap);
  }

  // Computes difference B = A - B (modifies and returns other set)
  difference2(otherbitmap) {
    const mincount = Math.min(this.words.length, otherbitmap.words.length);
    let k = 0 | 0;
    for (; k + 7 < mincount; k += 8) {
      otherbitmap.words[k] = this.words[k] & ~otherbitmap.words[k];
      otherbitmap.words[k + 1] = this.words[k + 1] & ~otherbitmap.words[k + 1];
      otherbitmap.words[k + 2] = this.words[k + 2] & ~otherbitmap.words[k + 2];
      otherbitmap.words[k + 3] = this.words[k + 3] & ~otherbitmap.words[k + 3];
      otherbitmap.words[k + 4] = this.words[k + 4] & ~otherbitmap.words[k + 4];
      otherbitmap.words[k + 5] = this.words[k + 5] & ~otherbitmap.words[k + 5];
      otherbitmap.words[k + 6] = this.words[k + 6] & ~otherbitmap.words[k + 6];
      otherbitmap.words[k + 7] = this.words[k + 7] & ~otherbitmap.words[k + 7];
    }
    for (; k < mincount; ++k) {
      otherbitmap.words[k] = this.words[k] & ~otherbitmap.words[k];
    }
    for (k = this.words.length - 1; k >= mincount; --k) {
      otherbitmap.words[k] = this.words[k];
    }
    otherbitmap.words.length = this.words.length;
    return otherbitmap;
  }

  // Computes the size of the difference
  difference_size(otherbitmap) {
    const newcount = Math.min(this.words.length, otherbitmap.words.length);
    let answer = 0 | 0;
    let k = 0 | 0;
    for (; k < newcount; ++k) {
      answer += this.hammingWeight(this.words[k] & ~otherbitmap.words[k]);
    }
    const c = this.words.length;
    for (; k < c; ++k) {
      answer += this.hammingWeight(this.words[k]);
    }
    return answer;
  }

  // Computes changed elements (XOR) (modifies current bitset)
  change(otherbitmap) {
    const mincount = Math.min(this.words.length, otherbitmap.words.length);
    let k = 0 | 0;
    for (; k + 7 < mincount; k += 8) {
      this.words[k] ^= otherbitmap.words[k];
      this.words[k + 1] ^= otherbitmap.words[k + 1];
      this.words[k + 2] ^= otherbitmap.words[k + 2];
      this.words[k + 3] ^= otherbitmap.words[k + 3];
      this.words[k + 4] ^= otherbitmap.words[k + 4];
      this.words[k + 5] ^= otherbitmap.words[k + 5];
      this.words[k + 6] ^= otherbitmap.words[k + 6];
      this.words[k + 7] ^= otherbitmap.words[k + 7];
    }
    for (; k < mincount; ++k) {
      this.words[k] ^= otherbitmap.words[k];
    }
    for (k = otherbitmap.words.length - 1; k >= mincount; --k) {
      this.words[k] = otherbitmap.words[k];
    }
    return this;
  }

  // Computes changed elements in a new bitmap
  new_change(otherbitmap) {
    const answer = Object.create(FastBitSet.prototype);
    const count = Math.max(this.words.length, otherbitmap.words.length);
    answer.words = new Array(count);
    const mcount = Math.min(this.words.length, otherbitmap.words.length);
    let k = 0;
    for (; k + 7 < mcount; k += 8) {
      answer.words[k] = this.words[k] ^ otherbitmap.words[k];
      answer.words[k + 1] = this.words[k + 1] ^ otherbitmap.words[k + 1];
      answer.words[k + 2] = this.words[k + 2] ^ otherbitmap.words[k + 2];
      answer.words[k + 3] = this.words[k + 3] ^ otherbitmap.words[k + 3];
      answer.words[k + 4] = this.words[k + 4] ^ otherbitmap.words[k + 4];
      answer.words[k + 5] = this.words[k + 5] ^ otherbitmap.words[k + 5];
      answer.words[k + 6] = this.words[k + 6] ^ otherbitmap.words[k + 6];
      answer.words[k + 7] = this.words[k + 7] ^ otherbitmap.words[k + 7];
    }
    for (; k < mcount; ++k) {
      answer.words[k] = this.words[k] ^ otherbitmap.words[k];
    }

    const c = this.words.length;
    for (k = mcount; k < c; ++k) {
      answer.words[k] = this.words[k];
    }
    const c2 = otherbitmap.words.length;
    for (k = mcount; k < c2; ++k) {
      answer.words[k] = otherbitmap.words[k];
    }
    return answer;
  }

  // Computes the number of changed elements
  change_size(otherbitmap) {
    const mincount = Math.min(this.words.length, otherbitmap.words.length);
    let answer = 0 | 0;
    let k = 0 | 0;
    for (; k < mincount; ++k) {
      answer += this.hammingWeight(this.words[k] ^ otherbitmap.words[k]);
    }
    const longer =
      this.words.length > otherbitmap.words.length ? this : otherbitmap;
    const c = longer.words.length;
    for (; k < c; ++k) {
      answer += this.hammingWeight(longer.words[k]);
    }
    return answer;
  }

  // Returns a string representation
  toString() { return "{" + this.array().join(",") + "}"; }

  // Computes union (modifies current set)
  union(otherbitmap) {
    const mcount = Math.min(this.words.length, otherbitmap.words.length);
    let k = 0 | 0;
    for (; k + 7 < mcount; k += 8) {
      this.words[k] |= otherbitmap.words[k];
      this.words[k + 1] |= otherbitmap.words[k + 1];
      this.words[k + 2] |= otherbitmap.words[k + 2];
      this.words[k + 3] |= otherbitmap.words[k + 3];
      this.words[k + 4] |= otherbitmap.words[k + 4];
      this.words[k + 5] |= otherbitmap.words[k + 5];
      this.words[k + 6] |= otherbitmap.words[k + 6];
      this.words[k + 7] |= otherbitmap.words[k + 7];
    }
    for (; k < mcount; ++k) {
      this.words[k] |= otherbitmap.words[k];
    }
    if (this.words.length < otherbitmap.words.length) {
      this.resize((otherbitmap.words.length << 5) - 1);
      const c = otherbitmap.words.length;
      for (let k = mcount; k < c; ++k) {
        this.words[k] = otherbitmap.words[k];
      }
    }
    return this;
  }

  // Computes union in a new bitmap
  new_union(otherbitmap) {
    const answer = Object.create(FastBitSet.prototype);
    const count = Math.max(this.words.length, otherbitmap.words.length);
    answer.words = new Array(count);
    const mcount = Math.min(this.words.length, otherbitmap.words.length);
    let k = 0;
    for (; k + 7 < mcount; k += 8) {
      answer.words[k] = this.words[k] | otherbitmap.words[k];
      answer.words[k + 1] = this.words[k + 1] | otherbitmap.words[k + 1];
      answer.words[k + 2] = this.words[k + 2] | otherbitmap.words[k + 2];
      answer.words[k + 3] = this.words[k + 3] | otherbitmap.words[k + 3];
      answer.words[k + 4] = this.words[k + 4] | otherbitmap.words[k + 4];
      answer.words[k + 5] = this.words[k + 5] | otherbitmap.words[k + 5];
      answer.words[k + 6] = this.words[k + 6] | otherbitmap.words[k + 6];
      answer.words[k + 7] = this.words[k + 7] | otherbitmap.words[k + 7];
    }
    for (; k < mcount; ++k) {
      answer.words[k] = this.words[k] | otherbitmap.words[k];
    }
    const c = this.words.length;
    for (k = mcount; k < c; ++k) {
      answer.words[k] = this.words[k];
    }
    const c2 = otherbitmap.words.length;
    for (k = mcount; k < c2; ++k) {
      answer.words[k] = otherbitmap.words[k];
    }
    return answer;
  }

  // Computes the size of the union
  union_size(otherbitmap) {
    const mcount = Math.min(this.words.length, otherbitmap.words.length);
    let answer = 0 | 0;
    for (let k = 0 | 0; k < mcount; ++k) {
      answer += this.hammingWeight(this.words[k] | otherbitmap.words[k]);
    }
    if (this.words.length < otherbitmap.words.length) {
      const c = otherbitmap.words.length;
      for (let k = this.words.length; k < c; ++k) {
        answer += this.hammingWeight(otherbitmap.words[k] | 0);
      }
    } else {
      const c = this.words.length;
      for (let k = otherbitmap.words.length; k < c; ++k) {
        answer += this.hammingWeight(this.words[k] | 0);
      }
    }
    return answer;
  }
}
