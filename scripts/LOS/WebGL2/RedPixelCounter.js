/* globals
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import * as twgl from "./twgl-full.js";
import { MODULE_ID } from "../../const.js";
import { readPixelsAsync } from "./read_pixels_async.js";

/**
 * Different approaches count the number of red pixels in the
 * texture or framebuffer used to draw the view to a target.
 * Counts both red pixels and obscured red pixels (red and blue or green pixels present).
 */
export class RedPixelCounter {
  /** @type {WebGL2Context} */
  gl;

  /** @type {number} */
  #width = 0;

  /** @type {number} */
  #height = 0;

  /** @type {twgl.BufferInfo} */
  quadBufferInfo;

  /** @type {object<twgl.ProgramInfo>} */
  programInfos = {};

  /** @type {object<twgl.FramebufferInfo} */
  fbInfos = {};

  /** @type {object<Uint8Array|Float32Array} */
  pixelBuffers = {};

  constructor(gl, width, height) {
    this.gl = gl;
    gl.getExtension("EXT_float_blend");
    gl.getExtension("EXT_color_buffer_float");

    this.#width = width;
    this.#height = height;
  }

  initialize(width, height) {
    if ( width ) this.#width = width;
    if ( height ) this.#height = height;

    // Used by both loop count and reduction count.
    this.quadBufferInfo = twgl.primitives.createXYQuadBufferInfo(this.gl);

    this._initializeReadPixelsCount();
    this._initializeLoopCount();
    this._initializeBlendCount();
    this._initializeReductionCount();

    this._initializeLoopCount2();
    this._initializeBlendCount2();
    this._initializeReductionCount2();
  }

  _initializeLoopCount() {
    const gl = this.gl;
    const { vertex, fragment } = this.constructor.loopCountSource;
    this.programInfos.loopCount = twgl.createProgramInfo(gl, [vertex, fragment]);
    this.fbInfos.loopCount = twgl.createFramebufferInfo(gl, [{
      internalFormat: gl.RGBA32F,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE
    }], 1, 1);
    const NUM_CHANNELS = 4;
    this.pixelBuffers.loopCount = new Float32Array(NUM_CHANNELS); // Width, height of 1.
  }

  _initializeLoopCount2() {
    const gl = this.gl;
    // const { vertex, fragment } = this.constructor.loopCountSource;
    // this.programInfos.loopCount = twgl.createProgramInfo(gl, [vertex, fragment]);
    this.fbInfos.loopCount2 = twgl.createFramebufferInfo(gl, [{
      internalFormat: gl.RG32F,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE
    }], 1, 1);
    const NUM_CHANNELS = 2;
    this.pixelBuffers.loopCount2 = new Float32Array(NUM_CHANNELS); // Width, height of 1.
  }

  _initializeBlendCount() {
    const gl = this.gl;
    const { vertex, fragment } = this.constructor.blendCountSource;
    this.programInfos.blendCount = twgl.createProgramInfo(gl, [vertex, fragment]);
    this.fbInfos.blendCount = twgl.createFramebufferInfo(gl, [{
      internalFormat: gl.RGBA32F,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
    }], 1, 1);
    const NUM_CHANNELS = 4;
    this.pixelBuffers.blendCount = new Float32Array(NUM_CHANNELS); // Width, height of 1.
  }

  _initializeBlendCount2() {
    const gl = this.gl;
    // const { vertex, fragment } = this.constructor.blendCountSource;
    // this.programInfos.blendCount2 = twgl.createProgramInfo(gl, [vertex, fragment]);
    this.fbInfos.blendCount2 = twgl.createFramebufferInfo(gl, [{
      internalFormat: gl.RG32F,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
    }], 1, 1);
    const NUM_CHANNELS = 2;
    this.pixelBuffers.blendCount2 = new Float32Array(NUM_CHANNELS); // Width, height of 1.
  }

  _initializeReductionCount() {
    const gl = this.gl;
    const {
      detectionVertex,
      detectionFragment,
      reductionVertex,
      reductionFragment } = this.constructor.reductionCountSource;
    this.programInfos.reductionCount = {};
    this.programInfos.reductionCount.detector = twgl.createProgramInfo(gl, [detectionVertex, detectionFragment]);
    this.programInfos.reductionCount.reducer = twgl.createProgramInfo(gl, [reductionVertex, reductionFragment]);

    const fb0 = twgl.createFramebufferInfo(gl, [{
      internalFormat: gl.RGBA32F,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE
    }], 128, 128);
    const fb1 = twgl.createFramebufferInfo(gl, [{
        internalFormat: gl.RGBA32F,
        minMag: gl.NEAREST,
        wrap: gl.CLAMP_TO_EDGE
      }], 128, 128);
    this.fbInfos.reductionCount = [fb0, fb1];
    const NUM_CHANNELS = 4;
    this.pixelBuffers.reductionCount = new Float32Array(NUM_CHANNELS); // Width, height of 1.
  }

  _initializeReductionCount2() {
    const gl = this.gl;
//     const {
//       detectionVertex,
//       detectionFragment,
//       reductionVertex,
//       reductionFragment } = this.constructor.reductionCountSource;
//     this.programInfos.reductionCount = {};
//     this.programInfos.reductionCount.detector = twgl.createProgramInfo(gl, [detectionVertex, detectionFragment]);
//     this.programInfos.reductionCount.reducer = twgl.createProgramInfo(gl, [reductionVertex, reductionFragment]);

    const fb0 = twgl.createFramebufferInfo(gl, [{
      internalFormat: gl.RG32F,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE
    }], 128, 128);
    const fb1 = twgl.createFramebufferInfo(gl, [{
        internalFormat: gl.RG32F,
        minMag: gl.NEAREST,
        wrap: gl.CLAMP_TO_EDGE
      }], 128, 128);
    this.fbInfos.reductionCount2 = [fb0, fb1];
    const NUM_CHANNELS = 2;
    this.pixelBuffers.reductionCount2 = new Float32Array(NUM_CHANNELS); // Width, height of 1.
  }

  _initializeReadPixelsCount() {
    const gl = this.gl;
    const NUM_CHANNELS = 4;
    this.fbInfos.readPixelsCount = twgl.createFramebufferInfo(gl, [{
      internalFormat: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE
    }], this.#width, this.#height);
    this.pixelBuffers.readPixelsCount = new Uint8Array(this.#width * this.#height * NUM_CHANNELS);
  }

  #readSinglePixel(pixels, format, type) {
    this.gl.readPixels(0, 0, 1, 1, format, type, pixels);
    return { red: pixels[0], redBlocked: pixels[1] };
  }

  async #readSinglePixelAsync(pixels, format, type) {
    await readPixelsAsync(this.gl, 0, 0, 1, 1, format, type, pixels);
    return { red: pixels[0], redBlocked: pixels[1] };
  }

  #loopCount(tex, type = "loopCount1") {
    const { gl, fbInfos, programInfos, quadBufferInfo } = this;

    twgl.bindFramebufferInfo(gl, fbInfos[type]);
    gl.useProgram(programInfos.loopCount.program);
    twgl.setBuffersAndAttributes(gl, programInfos.loopCount, quadBufferInfo);
    twgl.setUniforms(programInfos.loopCount, { uTexture: tex });
    twgl.drawBufferInfo(gl, quadBufferInfo);
    gl.flush();
  }

  loopCount(tex) {
    const type = "loopCount";
    this.#loopCount(tex, type);
    return this.#readSinglePixel(this.pixelBuffers[type], this.gl.RGBA, this.gl.FLOAT);
  }

  loopCount2(tex) {
    const type = "loopCount2";
    this.#loopCount(tex, type);
    return this.#readSinglePixel(this.pixelBuffers[type], this.gl.RG, this.gl.FLOAT);
  }

  async loopCountAsync(tex) {
    const type = "loopCount";
    this.#loopCount(tex, type);
    return this.#readSinglePixelAsync(this.pixelBuffers[type], this.gl.RGBA, this.gl.FLOAT);
  }

  async loopCount2Async(tex) {
    const type = "loopCount2";
    this.#loopCount(tex, type);
    return this.#readSinglePixelAsync(this.pixelBuffers[type], this.gl.RG, this.gl.FLOAT);
  }

  #blendCount(tex, type) {
    const { gl, fbInfos, programInfos } = this;

    // We're going to render a gl.POINT for each pixel in the source image
    // That point will be positioned based on the color of the source image
    // we're just going to render vec4(1,1,1,1). This blend function will
    // mean each time we render to a specific point that point will get
    // incremented by 1.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);
    twgl.bindFramebufferInfo(gl, fbInfos[type]);
    gl.useProgram(programInfos.blendCount.program);
    twgl.setUniforms(programInfos.blendCount, { uTexture: tex });
    gl.clear(gl.COLOR_BUFFER_BIT);

    // No buffer data needed in WebGL2 as we can use gl_VertexID.
    gl.drawArrays(gl.POINTS, 0, this.#width * this.#height);

    // Reset
    gl.colorMask(true, true, true, true);
    gl.blendFunc(gl.ONE, gl.ZERO);
    gl.disable(gl.BLEND);
    gl.flush();

  }

  blendCount(tex) {
    const type = "blendCount";
    this.#blendCount(tex, type);
    return this.#readSinglePixel(this.pixelBuffers[type], this.gl.RGBA, this.gl.FLOAT)
  }

  blendCount2(tex) {
    const type = "blendCount2";
    this.#blendCount(tex, type);
    return this.#readSinglePixel(this.pixelBuffers[type], this.gl.RG, this.gl.FLOAT)
  }

  async blendCountAsync(tex) {
    const type = "blendCount";
    this.#blendCount(tex, type);
    return this.#readSinglePixelAsync(this.pixelBuffers[type], this.gl.RGBA, this.gl.FLOAT)
  }

  async blendCount2Async(tex) {
    const type = "blendCount2";
    this.#blendCount(tex, type);
    return this.#readSinglePixelAsync(this.pixelBuffers[type], this.gl.RG, this.gl.FLOAT)
  }

  #reductionCount(tex, type) {
    const { gl, fbInfos, programInfos, quadBufferInfo } = this;
    const { detector, reducer } = programInfos.reductionCount;
    const framebuffers = fbInfos[type];

    // First render 1,0 to a texture to indicate whether red pixel is present.
    // Then ping-pong textures to sum, going from 128 -> 64 -> 32 -> ... 1.
    twgl.bindFramebufferInfo(gl, framebuffers[0]);
    gl.useProgram(detector.program);
    twgl.setBuffersAndAttributes(gl, detector, quadBufferInfo);
    twgl.setUniforms(detector, { uTexture: tex });
    twgl.drawBufferInfo(gl, quadBufferInfo);

    // Ping-pong, reducing by x2 each time.
    let readFBO = 0;
    let writeFBO = 1;
    let currentWidth = this.#width;
    let currentHeight = this.#height;
    gl.useProgram(reducer.program);
    twgl.setBuffersAndAttributes(gl, reducer, quadBufferInfo);
    while ( currentWidth > 1 || currentHeight > 1 ) {
      const nextWidth = Math.max(1, Math.ceil(currentWidth * 0.5));
      const nextHeight = Math.max(1, Math.ceil(currentHeight * 0.5));

      twgl.bindFramebufferInfo(gl, framebuffers[writeFBO]);
      gl.viewport(0, 0, nextWidth, nextHeight);
      twgl.setUniforms(reducer, {
        uTexture: framebuffers[readFBO].attachments[0],
        uTextureSize: [currentWidth, currentHeight]
      });
      twgl.drawBufferInfo(gl, quadBufferInfo);
      [readFBO, writeFBO] = [writeFBO, readFBO];
      currentWidth = nextWidth;
      currentHeight = nextHeight;
    }
    gl.flush();
  }

  reductionCount(tex) {
    const type = "reductionCount";
    this.#reductionCount(tex, type);
    return this.#readSinglePixel(this.pixelBuffers[type], this.gl.RGBA, this.gl.FLOAT);
  }

  reductionCount2(tex) {
    const type = "reductionCount2";
    this.#reductionCount(tex, type);
    return this.#readSinglePixel(this.pixelBuffers[type], this.gl.RG, this.gl.FLOAT);
  }

  async reductionCountAsync(tex) {
    const type = "reductionCount";
    this.#reductionCount(tex, type);
    return this.#readSinglePixelAsync(this.pixelBuffers[type], this.gl.RGBA, this.gl.FLOAT);
  }

  async reductionCount2Async(tex) {
    const type = "reductionCount2";
    this.#reductionCount(tex, type);
    return this.#readSinglePixelAsync(this.pixelBuffers[type], this.gl.RG, this.gl.FLOAT);
  }

  readPixelsCount(tex) {
    const gl = this.gl;
    if ( tex ) {
      twgl.bindFramebufferInfo(this.gl, this.fbInfos.readPixelsCount);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, tex, 0);
    }
    const pixels = this.pixelBuffers.readPixelsCount;
    this.gl.readPixels(0, 0, this.#width, this.#height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
    let red = 0;
    let redBlocked = 0;
    const terrainThreshold = CONFIG[MODULE_ID].alphaThreshold * 255;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const hasR = r === 255;
      red += hasR;
      redBlocked += hasR * (b === 255 || g > terrainThreshold);
    }
    return { red, redBlocked };
  }

  async readPixelsCountAsync(tex) {
    const gl = this.gl;
    if ( tex ) {
      twgl.bindFramebufferInfo(gl, this.fbInfos.readPixelsCount);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }
    const pixels = this.pixelBuffers.readPixelsCount;
    await readPixelsAsync (this.gl, 0, 0, this.#width, this.#height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let red = 0;
    let redBlocked = 0;
    const terrainThreshold = CONFIG[MODULE_ID].alphaThreshold * 255;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const hasR = r === 255;
      red += hasR;
      redBlocked += hasR * (b === 255 || g > terrainThreshold);
    }
    return { red, redBlocked };
  }

  static get loopCountSource() {
    return {
      vertex:
`#version 300 es

in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`,
      fragment:
`#version 300 es
precision mediump float;


uniform sampler2D uTexture;
out vec4 fragColor;

const int mipLevel = 0;
const float colorThreshold = 0.95;
const float terrainThreshold = ${CONFIG[MODULE_ID].alphaThreshold};

void main() {
  vec4 sumColor = vec4(0.0);

  // Determine texture size.
  ivec2 size = textureSize(uTexture, mipLevel);
  for ( int y = 0; y < size.y; y += 1 ) {
    for ( int x = 0; x < size.x; x += 1 ) {
      ivec2 uv = ivec2(x, y);
      vec4 texColor = texelFetch(uTexture, uv, mipLevel);
      float hasR = step(colorThreshold, texColor.r);
      sumColor.r += hasR;
      sumColor.g += hasR * float(texColor.b > colorThreshold || texColor.g > terrainThreshold);
    }
  }
  fragColor = sumColor;
}
`};

  }

  static get blendCountSource() {
    return {
      vertex:
`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTexture;

out vec4 texColor;

void main() {
  const int mipLevel = 0;
  ivec2 size = textureSize(uTexture, mipLevel);

  // based on an id (0, 1, 2, 3 ...) compute the pixel x, y for the source image
  ivec2 pixel = ivec2(
      gl_VertexID % size.x,
      gl_VertexID / size.x);

  // get the pixels but 0 out channels we don't want
  // Modify 0-1 to 0-255 to indicate distinct colors.
  texColor = texelFetch(uTexture, pixel, mipLevel);

  // set the position to be over a single pixel in the 256x256 destination texture
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`,
      fragment:
`#version 300 es
precision highp float;

in vec4 texColor;
out vec4 fragColor;

const float colorThreshold = 0.95;
const float terrainThreshold = ${CONFIG[MODULE_ID].alphaThreshold};

void main() {
  float hasR = step(colorThreshold, texColor.r);
  fragColor = vec4(0.0);
  fragColor.r += hasR;
  fragColor.g += hasR * float(texColor.b > colorThreshold || texColor.g > terrainThreshold);
}
`};
  }

  static get reductionCountSource() {
    return {
      detectionVertex:
`#version 300 es
precision highp float;
in vec2 position;
in vec2 texcoord;

out vec2 uv;

void main() {
  uv = texcoord;
  gl_Position = vec4(position, 0.0, 1.0);
}
`,
      detectionFragment:
`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTexture;
in vec2 uv;
out vec4 fragColor;

const int mipLevel = 0;
const float colorThreshold = 0.95;
const float terrainThreshold = ${CONFIG[MODULE_ID].alphaThreshold};

void main() {
  ivec2 size = textureSize(uTexture, mipLevel);
  ivec2 uvI = ivec2(uv * vec2(size));
  vec4 texColor = texelFetch(uTexture, uvI, mipLevel);

  // Check if pixel is red.
  fragColor = vec4(0.0);
  float hasR = step(colorThreshold, texColor.r);
  fragColor.r = hasR;
  fragColor.g = hasR * float(texColor.b > colorThreshold || texColor.g > terrainThreshold);
}
`,

      reductionVertex:
`#version 300 es
precision highp float;
in vec2 position;
in vec2 texcoord;

out vec2 uv;

void main() {
  uv = texcoord;
  gl_Position = vec4(position, 0.0, 1.0);
}
`,

      reductionFragment:
`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTexture;
uniform vec2 uTextureSize;
in vec2 uv;
out vec4 fragColor;

const int mipLevel = 0;

void main() {
  // Using viewport, only half will be drawn
  // Subtract -0.5 to ensure we are in the middle of the pixel.
  // Otherwise, some of the values will be missed.
  ivec2 uvI = ivec2(uv * (uTextureSize - 0.5));
  vec4 sum = vec4(0.0);

  // Sum 2x2 blocks, up to texture size.
  ivec2 size = ivec2(uTextureSize);
  for ( int y = 0; y < 2; y += 1 ) {
    for ( int x = 0; x < 2; x += 1 ) {
      ivec2 texLoc = uvI + ivec2(x, y);
      if ( any(greaterThanEqual(texLoc, size)) ) continue;
      vec4 color = texelFetch(uTexture, texLoc, mipLevel);
      sum += color;
    }
  }
  fragColor = sum;
}
`};
  }

}


function isPowerOfTwo(n) {
  return (n > 0) && ((n & (n - 1)) === 0);
}
