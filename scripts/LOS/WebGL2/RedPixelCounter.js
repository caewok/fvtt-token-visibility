/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import * as twgl from "./LOS/WebGL2/twgl-full.js";

/**
 * Different approaches count the number of red pixels in the
 * texture or framebuffer used to draw the view to a target.
 * Counts both red pixels and obscured red pixels (red and blue or green pixels present)
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
    const { vertex, fragment } = this.constructor.shaderSource.loopCount;
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
    // const { vertex, fragment } = this.constructor.shaderSource.loopCount;
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
    const { vertex, fragment } = this.constructor.shaderSource.blendCount;
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
    // const { vertex, fragment } = this.constructor.shaderSource.blendCount;
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
      reductionFragment } = this.constructor.shaderSource.reductionCount;
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
//       reductionFragment } = this.constructor.shaderSource.reductionCount;
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

  loopCount(tex) {
    const { gl, fbInfos, programInfos, quadBufferInfo, pixelBuffers } = this;

    twgl.bindFramebufferInfo(gl, fbInfos.loopCount);
    gl.useProgram(programInfos.loopCount.program);
    twgl.setBuffersAndAttributes(gl, programInfos.loopCount, quadBufferInfo);
    twgl.setUniforms(programInfos.loopCount, { uTexture: tex });
    twgl.drawBufferInfo(gl, quadBufferInfo);
    gl.flush();

    const pixels = pixelBuffers.loopCount;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixels);
    return pixels[0];
  }

  loopCount2(tex) {
    const { gl, fbInfos, programInfos, quadBufferInfo, pixelBuffers } = this;

    twgl.bindFramebufferInfo(gl, fbInfos.loopCount2);
    gl.useProgram(programInfos.loopCount.program);
    twgl.setBuffersAndAttributes(gl, programInfos.loopCount, quadBufferInfo);
    twgl.setUniforms(programInfos.loopCount, { uTexture: tex });
    twgl.drawBufferInfo(gl, quadBufferInfo);
    gl.flush();

    const pixels = pixelBuffers.loopCount2;
    gl.readPixels(0, 0, 1, 1, gl.RG, gl.FLOAT, pixels);
    return pixels[0];
  }

  blendCount(tex) {
    const { gl, fbInfos, programInfos, pixelBuffers } = this;

    // We're going to render a gl.POINT for each pixel in the source image
    // That point will be positioned based on the color of the source image
    // we're just going to render vec4(1,1,1,1). This blend function will
    // mean each time we render to a specific point that point will get
    // incremented by 1.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);
    twgl.bindFramebufferInfo(gl, fbInfos.blendCount);
    gl.useProgram(programInfos.blendCount.program);
    twgl.setUniforms(programInfos.blendCount, { uTexture: tex });

    // No buffer data needed in WebGL2 as we can use gl_VertexID.
    gl.drawArrays(gl.POINTS, 0, this.#width * this.#height);

    // Reset
    gl.colorMask(true, true, true, true);
    gl.blendFunc(gl.ONE, gl.ZERO);
    gl.disable(gl.BLEND);
    gl.flush();

    const pixels = pixelBuffers.blendCount;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixels);
    return pixels[0];
  }

  blendCount2(tex) {
    const { gl, fbInfos, programInfos, pixelBuffers } = this;

    // We're going to render a gl.POINT for each pixel in the source image
    // That point will be positioned based on the color of the source image
    // we're just going to render vec4(1,1,1,1). This blend function will
    // mean each time we render to a specific point that point will get
    // incremented by 1.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);
    twgl.bindFramebufferInfo(gl, fbInfos.blendCount2);
    gl.useProgram(programInfos.blendCount.program);
    twgl.setUniforms(programInfos.blendCount, { uTexture: tex });

    // No buffer data needed in WebGL2 as we can use gl_VertexID.
    gl.drawArrays(gl.POINTS, 0, this.#width * this.#height);

    // Reset
    gl.colorMask(true, true, true, true);
    gl.blendFunc(gl.ONE, gl.ZERO);
    gl.disable(gl.BLEND);
    gl.flush();

    const pixels = pixelBuffers.blendCount2;
    gl.readPixels(0, 0, 1, 1, gl.RG, gl.FLOAT, pixels);
    return pixels[0];
  }

  reductionCount(tex) {
    const { gl, fbInfos, programInfos, quadBufferInfo, pixelBuffers } = this;
    const { detector, reducer } = programInfos.reductionCount;
    const framebuffers = fbInfos.reductionCount;

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

    const pixels = pixelBuffers.reductionCount;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixels);
    return pixels[0];
  }

  reductionCount2(tex) {
    const { gl, fbInfos, programInfos, quadBufferInfo, pixelBuffers } = this;
    const { detector, reducer } = programInfos.reductionCount;
    const framebuffers = fbInfos.reductionCount2;

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

    const pixels = pixelBuffers.reductionCount2;
    gl.readPixels(0, 0, 1, 1, gl.RG, gl.FLOAT, pixels);
    return pixels[0];
  }

  readPixelsCount(tex) {
    const gl = this.gl;
    if ( tex ) {
      twgl.bindFramebufferInfo(gl, this.fbInfos.readPixelsCount);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }
    const pixels = this.pixelBuffers.readPixelsCount;
    gl.readPixels(0, 0, this.#width, this.#height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let countRed = 0;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) countRed += Boolean(pixels[i] === 255);
    return countRed;
  }

  static shaderSource = {
    loopCount: {
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

void main() {
  vec4 sumColor = vec4(0.0);

  // Determine texture size.
  ivec2 size = textureSize(uTexture, mipLevel);
  for ( int y = 0; y < size.y; y += 1 ) {
    for ( int x = 0; x < size.x; x += 1 ) {
      ivec2 uv = ivec2(x, y);
      vec4 texColor = texelFetch(uTexture, uv, mipLevel);
      bvec4 isSaturated = greaterThan(texColor, vec4(0.5));
      sumColor += vec4(isSaturated);
    }
  }
  fragColor = sumColor;
}
`
    },
    blendCount: {
      vertex:
`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTexture;

out vec4 color;

void main() {
  const int mipLevel = 0;
  ivec2 size = textureSize(uTexture, mipLevel);

  // based on an id (0, 1, 2, 3 ...) compute the pixel x, y for the source image
  ivec2 pixel = ivec2(
      gl_VertexID % size.x,
      gl_VertexID / size.x);

  // get the pixels but 0 out channels we don't want
  // Modify 0-1 to 0-255 to indicate distinct colors.
  color = texelFetch(uTexture, pixel, mipLevel);

  // set the position to be over a single pixel in the 256x256 destination texture
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`,


      fragment:
`#version 300 es
precision highp float;

in vec4 color;

out vec4 fragColor;
void main() {
  fragColor = vec4(color.r > 0.5 ? 1.0 : 0.0, 0.0, 0.0, 0.0);
}
`,

    },

    reductionCount: {
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

void main() {
  ivec2 size = textureSize(uTexture, mipLevel);
  ivec2 uvI = ivec2(uv * vec2(size));
  vec4 color = texelFetch(uTexture, uvI, mipLevel);

  // Check if pixel is red.
  bool isRed = color.r > 0.5;
  fragColor = vec4(isRed ? 1.0 : 0.0, 0.0, 0.0, 0.0);
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
  float sum = 0.0;

  // Sum 2x2 blocks, up to texture size.
  ivec2 size = ivec2(uTextureSize);
  for ( int y = 0; y < 2; y += 1 ) {
    for ( int x = 0; x < 2; x += 1 ) {
      ivec2 texLoc = uvI + ivec2(x, y);
      if ( any(greaterThanEqual(texLoc, size)) ) continue;
      vec4 color = texelFetch(uTexture, texLoc, mipLevel);
      sum += color.r;
    }
  }
  fragColor = vec4(sum, 0.0, 0.0, 0.0);
}
`
    },
  };

}


function isPowerOfTwo(n) {
  return (n > 0) && ((n & (n - 1)) === 0);
}
