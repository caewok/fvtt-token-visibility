/* globals
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { FastBitSet } from "../FastBitSet/FastBitSet.js";


/**
 * Different approaches count the number of red pixels in the
 * texture or framebuffer used to draw the view to a target.
 * Counts both red pixels and obscured red pixels (red and blue or green pixels present).
 */
export class RedPixelCounter {
  /** @type {WebGL2} */
  webGL2;

  /** @type {WebGL2Context} */
  get gl() { return this.webGL2.gl; }

  get width() { return this.gl.drawingBufferWidth; }

  get height() { return this.gl.drawingBufferHeight; }

  /** @type {Uint8Array} CPU-side readback buffer; grows as needed. */
  #pixels = new Uint8Array(0);

  /** For debugging. */
  get pixels() { return this.#pixels; }

  constructor(webGL2) {
    this.webGL2 = webGL2;
  }

  /**
   * Read the lower-left width x height region of the currently bound framebuffer.
   * Caller must bind the framebuffer first.
   * @returns {number} Number of bytes filled.
   */
  #read(width, height) {
    const n = width * height * 4;
    if ( this.#pixels.length < n ) this.#pixels = new Uint8Array(n);
    const gl = this.gl;
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.#pixels);
    return n;
  }

  /**
   * Provide indices of the unblocked, blocked, and partially blocked pixels.
   * @param {number} n      Number of pixels
   * @returns {object}
   * - @prop {FastBitSet} red                         Indices of red pixels
   * - @prop {FastBitSet} redBlocked                  Indices of red pixels blocked by something
   * - @prop {Map<number, number>} transmittance      Index -> transmittance (alpha)
   */
  mapPixels(n) {
    const pixels = this.#pixels;
    const red = new FastBitSet();
    const redBlocked = new FastBitSet();
    const transmittance = new Map();
    const terrainThreshold = CONFIG[MODULE_ID].alphaThreshold * 255;
    for ( let i = 0; i < n; i += 4 ) {
      // Pixel Types: i: red, i+1: green, i+2: blue, i+3: alpha
      const r = pixels[i];
      if ( !(r >> 7) ) continue; // Threshold of 128 given Uint8Array.
      const idx = i / 4;
      red.add(idx);

      // Blocked if:
      // - Red marked as blocked in the fragment shader (alpha 0).
      // - Blue pixel is present (solid obstacle).
      // - Green pixel surpasses the terrain threshold.
      const a = pixels[i + 3];
      if ( a === 0
        || (pixels[i + 2] >> 7)
        || pixels[i + 1] > terrainThreshold ) {

        redBlocked.add(idx);
        continue;
      }

      // Otherwise alpha is the transmittance through partially opaque obstacles.
      const t = pixelTransmittance(r, a);
      if ( t < 1 ) transmittance.set(idx, t);
    }
    return { red, redBlocked, transmittance };
  }

  /**
   * Provide indices of the unblocked pixels.
   * @param {number} n      Number of pixels
   * @returns {object}
   * - @prop {FastBitSet} red                         Indices of red pixels
   * - @prop {null} redBlocked                        Indices of red pixels blocked by something
   * - @prop {null} transmittance                     Index -> transmittance (alpha)
   */
  mapRedPixels(n) {
    const pixels = this.#pixels;
    const red = new FastBitSet();
    for ( let i = 0; i < n; i += 4 ) {
      const r = pixels[i];
      if ( r >> 7 ) red.add(i / 4); // Threshold of 128 given Uint8Array.
    }
    return { red, redBlocked: null, transmittance: null };
  }

  /**
   * Count the number of red and blocked red pixels. Blocked is weighted by transmittance (alpha).
   * @param {number} n    Number of pixels
   * @returns {object}
   * - @param {number} red
   * - @param {number} redBlocked
   */
  countPixels(n) {
    const pixels = this.#pixels;
    let red = 0;
    let redBlocked = 0;
    const terrainThreshold = CONFIG[MODULE_ID].alphaThreshold * 255;
    for ( let i = 0; i < n; i += 4 ) {
      // Pixel Types: i: red, i+1: green, i+2: blue, i+3: alpha
      const r = pixels[i];
      if ( !(r >> 7) ) continue; // Threshold of 128 given Uint8Array.
      red += 1;

      // Blocked if:
      // - Red marked as blocked in the fragment shader (alpha 0).
      // - Blue pixel is present (solid obstacle).
      // - Green pixel surpasses the terrain threshold.
      const a = pixels[i + 3];
      if ( a === 0
        || (pixels[i + 2] >> 7)
        || pixels[i + 1] > terrainThreshold ) {

        redBlocked += 1;
        continue;
      }

      // Otherwise alpha is the transmittance through partially opaque obstacles.
      redBlocked += 1 - pixelTransmittance(r, a);
    }
    return { red, redBlocked };
  }

  /**
   * Count the number of red pixels.
   * @param {number} n    Number of pixels
   * @returns {object}
   * - @param {number} red
   * - @param {null}   redBlocked
   */
  countRedPixels(n) {
    const pixels = this.#pixels;
    let red = 0;
    for ( let i = 0; i < n; i += 4 ) {
      const r = pixels[i];
      const hasR = r >> 7; // Threshold of 128 given Uint8Array.
      red += hasR;
    }
    return { red, redBlocked: null };
  }

  /**
   * Count the number of red and blocked pixels. Blocked is weighted by transmittance (alpha).
   * @param {number} [opts.width]              Framebuffer width
   * @param {number} [opts.height]             Framebuffer height
   * @param {boolean} [opts.redOnly=false]     If true, only count the red pixels; ignore obstacles
   * @returns {object}
   * - @param {number} red
   * - @param {null}   redBlocked
   */
  readPixelsCount({ width = this.width, height = this.height, redOnly = false } = {}) {
    const n = this.#read(width, height);
    return redOnly ? this.countRedPixels(n) : this.countPixels(n);
  }

  /**
   * Provide indices of the unblocked, blocked, and partially blocked pixels.
   * @param {object} [opts]
   * @param {number} [opts.width]              Framebuffer width
   * @param {number} [opts.height]             Framebuffer height
   * @param {boolean} [opts.redOnly=false]     If true, only count the red pixels; ignore obstacles
   * @returns {object}
   * - @prop {FastBitSet} red                               Indices of red pixels
   * - @prop {FastBitSet|null} redBlocked                   Indices of red pixels blocked by something
   * - @prop {Map<number, number>|null} transmittance       Index -> transmittance (alpha)
   */
  mapPixelsCount({ width = this.width, height = this.height, redOnly = false } = {}) {
    const n = this.#read(width, height);
    return redOnly ? this.mapRedPixels(n) : this.mapPixels(n);
  }
}

/**
 * Transmittance of a target pixel from its red and alpha bytes. Normalizing by red keeps antialiased
 * edge pixels, where both are fractional, at 1. The tolerance absorbs 8-bit rounding.
 */
function pixelTransmittance(r, a) { return a >= r - 2 ? 1 : a / r; }
