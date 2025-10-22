/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";



/**
 * The number of bits of a word
 * @const
 * @type number
 */
const WORD_LENGTH = 32;

/**
 * The log base 2 of WORD_LENGTH
 * @const
 * @type number
 */
const WORD_LOG = 5;


export class BitSet {
  /** 
   * Holds the actual bits in form of a 32bit integer array.
   * @type {Array} 
   */
  data = [0];
  
  /**
   * Holds the MSB flag information to make indefinitely large bitsets inversion-proof
   * @type {number}
   */
  #msbFlag = 0; 
  
  get _msbFlag() { return this.#msbFlag; }
  
  set _msbFlag(value) { this.#msbFlag = value; }
     
  /**
   * @constructor
   * @param {string|BitSet|number=} param
   * @returns {BitSet}
   */
  constructor(param) {
    this.#parse(param);
    this.data = this.data.slice();
  }
  
	/**
	 * Parses the parameters and set variable P
	 *
	 * @param {Object} P
	 * @param {string|BitSet|Array|Uint8Array|number=} val
	 */
	#parse(val) {
		if ( val == null ) return;
		switch ( typeof val ) {
	
			case 'number':
				this.data = [val | 0];
				break;
	
			case 'string': {
				let base = 2;
				let len = WORD_LENGTH;
				if ( val.indexOf('0b') === 0 ) val = val.substr(2);
				else if ( val.indexOf('0x') === 0 ) {
					val = val.substr(2);
					base = 16;
					len = 8;
				}
	
				this.data = [];
				let a = val.length - len;
				let b = val.length;
				do {
					const num = parseInt(val.slice(a > 0 ? a : 0, b), base);
					if ( isNaN(num) ) throw SyntaxError('Invalid param');
					this.data.push(num | 0);
					if ( a <= 0 ) break;
					a -= len;
					b -= len;
				} while ( true );
				break;
			}
	
			default:
				this.data = [0];
				if ( val instanceof Array ) {
					for ( let i = val.length - 1; i >= 0; i-- ) {
						const ndx = val[i];
						if ( ndx === Infinity ) {
							this.#msbFlag = -1;
						} else {
							this.#scale(ndx);
							this.data[ndx >>> WORD_LOG] |= 1 << ndx;
						}
					}
					break;
				}
	
				if ( Uint8Array && val instanceof Uint8Array ) {
					const bits = 8;
					this.#scale(val.length * bits);
					for ( let i = 0; i < val.length; i++ ) {
						const n = val[i];
						for ( let j = 0; j < bits; j++ ) {
							const k = i * bits + j;
							this.data[k >>> WORD_LOG] |= (n >> j & 1) << k;
						}
					}
					break;
				}
				throw SyntaxError('Invalid param');
		}
	}
	
	/** ----- NOTE: Get/Set methods ----- */

  /**
   * Get a single bit flag of a certain bit position
   *
   * Ex:
   * bs1 = new BitSet();
   * var isValid = bs1.get(12);
   *
   * @param {number} ndx the index to be fetched
   * @returns {number} The binary flag
   */
  get(ndx) {
    ndx |= 0;
    const d = this.data;
    const n = ndx >>> WORD_LOG;
    if ( n >= d.length ) return this._msbFlag & 1;
    return (d[n] >>> ndx) & 1;
  }
	
  /**
   * Set a single bit flag
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * bs1.set(3, 1);
   *
   * @param {number} ndx The index of the bit to be set
   * @param {number=} value Optional value that should be set on the index (0 or 1)
   * @returns {BitSet} this
   */
  set(ndx, value) {
    ndx |= 0;
    this.#scale(ndx);
    if ( value === undefined || value ) this.data[ndx >>> WORD_LOG] |= (1 << ndx);
    else this.data[ndx >>> WORD_LOG] &= ~(1 << ndx);
    return this;
  }
  
  /** ----- NOTE: Bit property getters ----- */
  
  /**
   * Calculates the number of bits set
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * var num = bs1.cardinality();
   *
   * @returns {number} The number of bits set
   */
  get cardinality() {
    if ( this._msbFlag !== 0 ) return Infinity;
    let s = 0;
    const d = this.data;
    const len = d.length;
    for ( let i = 0; i < len; i++ ) {
      const n = d[i];
      if ( n !== 0 ) s += popCount(n);
    }
    return s;
  }

  /**
   * Calculates the Most Significant Bit / log base two
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * var logbase2 = bs1.msb();
   *
   * var truncatedTwo = Math.pow(2, logbase2); // May overflow!
   *
   * @returns {number} The index of the highest bit set
   */
  get msb() {
    if ( this._msbFlag !== 0 ) return Infinity;
    const data = this.data;
    
    // Different approach using clz32 library.
    const clz32Fn = i => {
      const c = Math.clz32(data[i]);
      if ( c !== WORD_LENGTH ) return (i * WORD_LENGTH) + WORD_LENGTH - 1 - c;
      return null;
    }
    const nonClz32Fn = i => {
      let v = data[i];
      let c = 0;
      if ( v ) {
        for ( ; (v >>>= 1) > 0; c++ ) { } /* eslint-disable-line no-empty */
        return (i * WORD_LENGTH) + c;
      }
      return null;
    }
    const fn = Math.clz32 ? clz32Fn : nonClz32Fn;
    
    for ( let i = data.length; i-- > 0; ) {
      const out = fn(i);
      if ( out !== null ) return out;
    }
    return Infinity;
  }
    
  
  /**
   * Calculates the number of trailing zeros
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * var ntz = bs1.ntz();
   *
   * @returns {number} The index of the lowest bit set
   */
  get ntz() {
    const data = this.data;
    for ( let j = 0; j < data.length; j++ ) {
      let v = data[j];
      if ( v !== 0 ) {
        v = (v ^ (v - 1)) >>> 1; // Set v's trailing 0s to 1s and zero rest
        return (j * WORD_LENGTH) + popCount(v);
      }
    }
    return Infinity;
  }
  
  /**
   * Calculates the Least Significant Bit
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * var lsb = bs1.lsb();
   *
   * @returns {number} The index of the lowest bit set
   */
  get lsb() {
    const data = this.data;
    const len = data.length;
    for ( let i = 0; i < len; i++ ) {
      const v = data[i];
      if ( v ) {
        let c = 0;
        let bit = (v & -v);
        for ( ; (bit >>>= 1); c++ ) {} /* eslint-disable-line no-empty */
        return WORD_LENGTH * i + c;
      }
    }
    return this._msbFlag & 1;
  }

  
  /** ----- NOTE: Factory methods ----- */
  
  static fromBinaryString(str) { return new BitSet("0b" + str); }
  
  static fromHexString(str) { return new BitSet("0x" + str); }
  
  static random(n) {
    if ( n === undefined || n < 0 ) n = WORD_LENGTH;
    const m = n % WORD_LENGTH;
    
    // Create an array, large enough to hold the random bits
		const len = Math.ceil(n / WORD_LENGTH);
	
		// Create an bitset instance
		const s = new BitSet();
		const t = s.data;
			
		// Fill the vector with random data, uniformly distributed
		for ( let i = 0; i < len; i++ ) t.push(Math.random() * 4294967296 | 0);
	
		// Mask out unwanted bits
		if ( m > 0 ) t[len - 1] &= (1 << m) - 1;
		return s;
  }
  
  static empty(n) {
    if ( n === undefined || n < 0 ) n = WORD_LENGTH;
    const m = n % WORD_LENGTH;
    
    // Create an array, large enough to hold the random bits
		const len = Math.ceil(n / WORD_LENGTH);
	
		// Create an bitset instance
		const s = new BitSet();
		const t = s.data;
		t.length = len;
				
		// Mask out unwanted bits
		if ( m > 0 ) t[len - 1] &= (1 << m) - 1;
		return s;
  }
  
  /**
   * Clones the actual object
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = bs1.clone();
   *
   * @returns {BitSet|Object} A new BitSet object, containing a copy of the actual object
   */
  clone() {
    const im = new this.constructor();
    im.data = this.data.slice();
    im._msbFlag = this._msbFlag;
    return im;
  }
 
  /**
   * Gets an entire range as a new bitset object
   *
   * Ex:
   * bs1 = new BitSet();
   * bs1.slice(4, 8);
   *
   * @param {number=} from The start index of the range to be get
   * @param {number=} to The end index of the range to be get
   * @returns {BitSet} A new smaller bitset object, containing the extracted range
   */
  slice(from, to) {
    if ( from === undefined ) return this.clone();
    if ( to === undefined ) {
      to = this.data.length * WORD_LENGTH;
      const im = new BitSet();
      im._msbFlag = this._msbFlag;
      for ( let i = from; i <= to; i++ ) im.set(i - from, this.get(i));
      return im;
    }
    if ( from <= to && 0 <= from ) {
      const im = new BitSet();
      for ( let i = from; i <= to; i++ ) im.set(i - from, this.get(i));
      return im;
    }
    return null;
  }
  
  /** ----- NOTE: Conversions ----- */
  
  /**
   * Gets a list of set bits
   *
   * @returns {Array}
   */
  toArray() {
    const ret = [];
    const data = this.data;
  
    // Different approach depending on whether Math.clz32 is present.
    if ( Math.clz32 ) {
      for ( let i = data.length - 1; i >= 0; i-- ) {
        let num = data[i];
        while ( num !== 0 ) {
          const t = 31 - Math.clz32(num);
          num ^= 1 << t;
          ret.unshift((i * WORD_LENGTH) + t);
        }
      }
    } else {
      for ( let i = 0; i < data.length; i++ ) {
        let num = data[i];
        while (num !== 0) {
					const t = num & -num;
					num ^= t;
					ret.push((i * WORD_LENGTH) + popCount(t - 1));
				}
      }
    }
    if ( this._msbFlag !== 0 ) ret.push(Infinity);
    return ret;
  }
    
  /**
   * Overrides the toString method to get a binary representation of the BitSet
   *
   * @param {number=} base
   * @returns string A binary string
   */
  toString(base) {
    const data = this.data;
    base ||= 2;
    
    // If base is power of two
    if ( (base & (base - 1)) === 0 && base < 36 ) {
      let ret = '';
      const len = 2 + Math.log(4294967295/*Math.pow(2, WORD_LENGTH)-1*/) / Math.log(base) | 0;
      for ( let i = data.length - 1; i >= 0; i-- ) {
        let cur = data[i];

        // Make the number unsigned
        if ( cur < 0 ) cur += 4294967296 /*Math.pow(2, WORD_LENGTH)*/;
        const tmp = cur.toString(base);
        
        // Fill small positive numbers with leading zeros. The +1 for array creation is added outside already
        if ( ret !== '' ) ret += '0'.repeat(len - tmp.length - 1);
        ret += tmp;
      }

      if ( this._msbFlag === 0 ) {
        ret = ret.replace(/^0+/, '');
        if ( ret === '' ) ret = '0';
        return ret;
      } 
      
      // Pad the string with ones
      ret = '1111' + ret;
      return ret.replace(/^1+/, '...1111');
    
    } else {
      if ( (2 > base || base > 36) ) throw SyntaxError('Invalid base');
      const ret = [];
      const arr = [];

      // Copy every single bit to a new array
      for ( let i = data.length; i--; ) {
        for ( let j = WORD_LENGTH; j--; ) arr.push(data[i] >>> j & 1);
      }

      do {
        ret.unshift(divide(arr, base).toString(base));
      } while ( !arr.every(function (x) {
        return x === 0;
      }) );

      return ret.join('');
    }
  }
  
  /** ----- NOTE: Bit math methods ----- */

  /**
   * Check if the BitSet is empty, means all bits are unset
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * bs1.isEmpty() ? 'yes' : 'no'
   *
   * @returns {boolean} Whether the bitset is empty
   */
  isEmpty() {
    if (this._msbFlag !== 0 ) return false;
    const d = this.data;
    for ( let i = d.length - 1; i >= 0; i-- ) {
      if ( d[i] !== 0 ) return false;
    }
    return true;
  }

  /**
   * Creates the bitwise NOT of a set.
   *
   * Ex:
   * bs1 = new BitSet(10);
   *
   * res = bs1.not();
   *
   * @returns {BitSet} A new BitSet object, containing the bitwise NOT of this
   */
  not() { // invert()
    const T = this.clone();
    const t = T.data;
    for ( let i = 0; i < t.length; i++ ) t[i] = ~t[i];
    T._msbFlag = ~T._msbFlag;
    return t;
  }
  
  /**
   * Creates the bitwise AND of two sets.
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = new BitSet(10);
   *
   * res = bs1.and(bs2);
   *
   * @param {BitSet} value A bitset object
   * @returns {BitSet} A new BitSet object, containing the bitwise AND of this and value
   */
  and(value) {// intersection
    const T = this.clone();
    const t = T.data;
    const p = value.data;
    const pl = p.length;
    var p_ = value._msbFlag;
    const t_ = T._msbFlag;

    // If this is infinite, we need all bits from P
    if ( t_ !== 0 ) T.scale(pl * WORD_LENGTH - 1);
    
    // Add the two bit sets.
    const tl = t.length;
    const l = Math.min(pl, tl);
    let i = 0;
    for ( ; i < l; i++ ) t[i] &= p[i];
    for ( ; i < tl; i++ ) t[i] &= p_;
    T._msbFlag &= p_;
    return T;
  }
  
  /**
   * Creates the bitwise OR of two sets.
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = new BitSet(10);
   *
   * res = bs1.or(bs2);
   *
   * @param {BitSet} val A bitset object
   * @returns {BitSet} A new BitSet object, containing the bitwise OR of this and val
   */
  or(value) { // union
    const T = this.clone();
    const t = T.data;
    const p = value.data;
    var pl = p.length - 1;
    const tl = t.length - 1;
    const minLength = Math.min(tl, pl);

    // Append backwards, extend array only once
    let i = pl;
    for ( ; i > minLength; i-- ) t[i] = p[i];
    for ( ; i >= 0; i-- ) t[i] |= p[i];
    T._msbFlag |= value._msbFlag;
    return T;
  }
  
  /**
   * Creates the bitwise XOR of two sets.
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = new BitSet(10);
   *
   * res = bs1.xor(bs2);
   *
   * @param {BitSet} val A bitset object
   * @returns {BitSet} A new BitSet object, containing the bitwise XOR of this and val
   */
  xor(value) { // symmetric difference
    const T = this.clone();
    const t = T.data;
    const p = value.data;
    const t_ = T._msbFlag;
    const p_ = value._msbFlag;
    const tl = t.length - 1;
    const pl = p.length - 1;

    // Cut if tl > pl
    let i;
    for ( i = tl; i > pl; i-- ) t[i] ^= p_;

    // Cut if pl > tl
    for ( i = pl; i > tl; i-- ) t[i] = t_ ^ p[i];

    // XOR the rest
    for ( ; i >= 0; i-- ) t[i] ^= p[i];

    // XOR infinity
    T._msbFlag ^= value._msbFlag;

    return t;
  }
  
  /**
   * Creates the bitwise AND NOT (not confuse with NAND!) of two sets.
   *
   * Ex:
   * bs1 = new BitSet(10);
   * bs2 = new BitSet(10);
   *
   * res = bs1.notAnd(bs2);
   *
   * @param {BitSet} val A bitset object
   * @returns {BitSet} A new BitSet object, containing the bitwise AND NOT of this and other
   */
  andNot(val) { // difference
    return this.and(val.clone().flip());
  }
  
  /** -----NOTE: Methods to modify in place ----- */

  /**
   * Set a range of bits
   *
   * Ex:
   * bs1 = new BitSet();
   *
   * bs1.setRange(10, 15, 1);
   *
   * @param {number} from The start index of the range to be set
   * @param {number} to The end index of the range to be set
   * @param {number} value Optional value that should be set on the index (0 or 1)
   * @returns {BitSet} this
   */
  setRange(from, to, value) {
    for ( let i = from; i <= to; i++ ) this.set(i, value);
    return this;
  }


  /**
   * Flip/Invert a range of bits by setting
   *
   * Ex:
   * bs1 = new BitSet();
   * bs1.flip(); // Flip entire set
   * bs1.flip(5); // Flip single bit
   * bs1.flip(3,10); // Flip a bit range
   *
   * @param {number=} from The start index of the range to be flipped
   * @param {number=} to The end index of the range to be flipped
   * @returns {BitSet} this
   */
  flip(from, to) {
    if (from === undefined) {
      const d = this.data;
      for ( let i = 0; i < d.length; i++ ) d[i] = ~d[i];
      this.#msbFlag = ~this.#msbFlag;

    } else if ( to === undefined ) {
      this.#scale(from);
      this.data[from >>> WORD_LOG] ^= (1 << from);

    } else if ( 0 <= from && from <= to ) {
      this.#scale(to);
      for ( let i = from; i <= to; i++ ) this.data[i >>> WORD_LOG] ^= (1 << i);
  
    }
    return this;
  }

  /**
   * Clear a range of bits by setting it to 0
   *
   * Ex:
   * bs1 = new BitSet();
   * bs1.clear(); // Clear entire set
   * bs1.clear(5); // Clear single bit
   * bs1.clear(3,10); // Clear a bit range
   *
   * @param {number=} from The start index of the range to be cleared
   * @param {number=} to The end index of the range to be cleared
   * @returns {BitSet} this
   */
  clear(from, to) {
    const d = this.data;
    if ( from === undefined ) {
      for ( let i = d.length - 1; i >= 0; i-- ) d[i] = 0;
      this.#msbFlag = 0;

    } else if ( to === undefined ) {
      from |= 0;
      this.#scale(from);
      d[from >>> WORD_LOG] &= ~(1 << from);

    } else if ( from <= to ) {
      this.#scale(to);
      for ( let i = from; i <= to; i++ ) d[i >>> WORD_LOG] &= ~(1 << i);
  
    }
    return this;
  }
    	
	/** ----- NOTE: Private methods ----- */
	#scale(ndx) {	  	  
		const d = this.data;
		const len = d.length
		const v = this._msbFlag;
		for ( let l = ndx >>> WORD_LOG; l >= len; l-- ) d.push(v);
	}
	
  /** ----- NOTE: Static methods ----- */
  

}

/** ----- NOTE: Helper functions ----- */

/**
 * Calculates the number of set bits
 *
 * @param {number} v
 * @returns {number}
 */
function popCount(v) {

	// Warren, H. (2009). Hacker`s Delight. New York, NY: Addison-Wesley

	v -= ((v >>> 1) & 0x55555555);
	v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
	return (((v + (v >>> 4) & 0xF0F0F0F) * 0x1010101) >>> 24);
}

/**
 * Divide a number in base two by B
 *
 * @param {Array} arr
 * @param {number} B
 * @returns {number}
 */
function divide(arr, B) {
  let r = 0;
  for (var i = 0; i < arr.length; i++) {
    r *= 2;
    const d = (arr[i] + r) / B | 0;
    r = (arr[i] + r) % B;
    arr[i] = d;
  }
  return r;
}

