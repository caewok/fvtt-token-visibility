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

  /** @type {WebGLFramebuffer} */
  framebuffers = Array(2);

  /** @type {object} */
  programs = {
    detection: null, /** @type {WebGLProgram} */
    reduction: null, /** @type {WebGLProgram} */
  };

  /** @type {Uint32Array(4)} */
  readBuffer = new Uint8Array(4); // RGBA

  constructor(gl, width, height) {
    if ( width && height && !(isPowerOfTwo(width) && isPowerOfTwo(height)) ) {
      console.warn(`RedPixelCounter currently only handles width and height power of two.`, { width, height });
    }
    if ( width && height && width !== height ) {
      console.warn(`RedPixelCounter currently only handles equal width and height.`, { width, height });
    }

    this.gl = gl;
    gl.getExtension("EXT_float_blend");
    gl.getExtension("EXT_color_buffer_float");

    this.#width = width;
    this.#height = height;
  }

  initialize(width, height) {
    if ( width ) this.#width = width;
    if ( height ) this.#height = height;

    // Create framebuffers and textures for ping-pong rendering.
    this.framebuffers[0] = this._createFramebuffer();
    this.framebuffers[1] = this._createFramebuffer();

    // Create shader programs.
    const { redDetectionShader, reductionShader } = this.constructor;
    this.programs.detection = this._createProgram(redDetectionShader);
    this.programs.reduction = this._createProgram(reductionShader);
  }

  _initializeLoopSum() {

  }

  _createFramebuffer() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);

    // TODO: Use Uint8? Float32? Uint16?
    // TODO: Compile both programs together. See https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
    // See https://webgl2fundamentals.org/webgl/lessons/webgl-readpixels.html for types.
    {
      const level = 0;
      const internalFormat = gl.RGBA;
      const border = 0;
      const format = gl.RGBA;
      const type = gl.UNSIGNED_BYTE;
      const data = null;
      gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, this.#width, this.#height, border, format, type, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex };
  }

  _createProgram(shaderSource) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, this.constructor.vertexShader);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, shaderSource);
    gl.compileShader(fs);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if ( !gl.getProgramParameter(program, gl.LINK_STATUS) ) {
      console.error(`Link failed: ${gl.getProgramInfoLog(program)}`);
      console.error(`vs info-log: ${gl.getShaderInfoLog(vs)}`);
      console.error(`fs info-log: ${gl.getShaderInfoLog(fs)}`, shaderSource);
    }

    return program;
  }

  countRedPixels(inputTexture) {
    const gl = this.gl;
    let currentWidth = this.#width;
    let currentHeight = this.#height;

    // First pass: Detect red pixels.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[0].fbo);
    gl.viewport(0, 0, currentWidth, currentHeight);
    gl.useProgram(this.programs.detection);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);

    // TODO: Cache uniform location in initialization.
    const uTextureSize = gl.getUniformLocation(this.programs.detection, "uTextureSize");
    gl.uniform2i(uTextureSize, currentWidth, currentHeight);

    this._drawFullscreenQuad();

    // Perform reduction passes until we get to a 1x1 texture.
    // TODO: Logic to handle uneven width and height and logic to handle
    //       non-power-of-two.
    let readFBO = 0;
    let writeFBO = 1;
    while ( currentWidth > 1 || currentHeight > 1 ) {
      const nextWidth = Math.max(1, Math.ceil(currentWidth * 0.5));
      const nextHeight = Math.max(1, Math.ceil(currentHeight * 0.5));

      // TODO: Can we move gl.useProgram outside the loop?
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[writeFBO].fbo);
      gl.viewport(0, 0, nextWidth, nextHeight);
      gl.useProgram(this.programs.reduction);

      // Set uniforms, swapping in the new width and height.
      // TODO: Cache uniform location in initialization.
      const uTextureSize = gl.getUniformLocation(this.programs.reduction, "uTextureSize");
      gl.uniform2i(uTextureSize, currentWidth, currentHeight);

      // Swap texture.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.framebuffers[readFBO].tex);

      this._drawFullscreenQuad();

      // Swap FBOs for next pass.
      [readFBO, writeFBO] = [writeFBO, readFBO];
      currentWidth = nextWidth;
      currentHeight = nextHeight;
    }

    // TODO: Async version.
    // Read back the final result.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[readFBO].fbo);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.readBuffer);
    return this.readBuffer[0]; // Red channel contains the count.
  }

  _drawFullscreenQuad() {
    const gl = this.gl;

    // TODO: Move buffer creation to initialization and reuse buffer.
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1, 1,
       1, -1,
       1, 1,
      -1, 1,
    ]), gl.STATIC_DRAW);

    // TODO: Determine position location at initialization.
    const positionLoc = gl.getAttribLocation(gl.getParameter(gl.CURRENT_PROGRAM), "position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    // TODO: Faster to just hard code the vertex positions in the shader?
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.deleteBuffer(positionBuffer);
  }



  static vertexShader =
`#version 300 es
precision highp float;
in vec2 position;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;
  // TODO: Move the texture coord calc to the vertex shader.
  // TODO: Replace the logical test with a step function.
  // TODO: Add shader to detect obscured red pixels?
  // TODO: Use an RGBA 8-bit texture and add using all 4 channels.
  //       8 bits per channel, so that gets (2^8)^4 available values.
  //       Can accomodate 65536 x 65536 pixel texture if each pixel is red.
  static redDetectionShader =
`#version 300 es
precision highp float;

uniform sampler2D uTexture;
out vec4 fragColor;

void main() {
  ivec2 uTextureSize = textureSize(uTexture, 0);
  ivec2 texCoord = ivec2((gl_FragCoord.xy + 1.0) * 0.5) * uTextureSize; // Convert -1 to 1 to 0 to 1 uv coordinates; multiply by texture size.
  vec4 color = texelFetch(uTexture, texCoord, 0);

  // Check if pixel is red.
  bool isRed = color.r > 0.0;
  fragColor = vec4(isRed ? 1.0 : 0.0, 0.0, 0.0, 0.0);
}`;

  static reductionShader =
`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTexture;
uniform ivec2 uTextureSize;
out vec4 fragColor;

void main() {
 ivec2 texCoord = ivec2((gl_FragCoord.xy + 1.0) * 0.5) * uTextureSize; // Convert -1 to 1 to 0 to 1 uv coordinates; multiply by texture size.
 float sum = 0.0;

 // Sum 2x2 block (or less at texture edges).
 for ( int y = 0; y < 2 && texCoord.y + y < uTextureSize.y; y += 1 ) {
   for ( int x = 0; x < 2 && texCoord.x + x < uTextureSize.x; x += 1 ) {
     sum += (texelFetch(uTexture, texCoord + ivec2(x, y), 0).r * 255.0);
   }
 }
 fragColor = vec4(sum / 255.0, 0.0, 0.0, 0.0);
}

`
}

function isPowerOfTwo(n) {
  return (n > 0) && ((n & (n - 1)) === 0);
}
