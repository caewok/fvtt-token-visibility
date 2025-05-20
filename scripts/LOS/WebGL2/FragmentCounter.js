/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// With substantial help from Windsurf SWE-1

export class FragmentCounter {
  /** @type {WebGL2Context} */
  gl;

  /** @type {WebGL2Framebuffer} */
  fbo;

  /** @type {WebGL2Texture} */
  texture;

  /** @type {WebGL2Program} */
  program;


  constructor(gl) {
    this.gl = gl;
    gl.getExtension("EXT_float_blend");
    gl.getExtension("EXT_color_buffer_float");

    // Create framebuffer
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    // Create 1x1 floating-point texture
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // Attach texture to framebuffer
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    // Create shader program
    this.program = this.createProgram(
     `#version 300 es
      in vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `,
     `#version 300 es
      precision highp float;
      out float fragColor;
      void main() {
        fragColor = 1.0;  // Each fragment adds 1.0 to the counter
      }
    `);

    // Clean up
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  createProgram(vsSource, fsSource) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);

    gl.shaderSource(vs, vsSource);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(vs);
    gl.compileShader(fs);

    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error('Vertex shader error:', gl.getShaderInfoLog(vs));
      return null;
    }
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('Fragment shader error:', gl.getShaderInfoLog(fs));
      return null;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return null;
    }

    return program;
  }


  // Previous state.

  /** @type {WebGL2FramebufferObject} */
  prevFBO;

  /** @type {WebGL2Viewport} */
  prevViewport;

  /** @type {boolean} */
  prevBlend;

  /** @type {number[2]} */
  prevBlendFunc;

  /** @type {number} */
  prevBlendEquation

  begin() {
    const gl = this.gl;

    // Save current state.
    this.prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    this.prevViewport = gl.getParameter(gl.VIEWPORT);
    this.prevBlend = gl.getParameter(gl.BLEND);
    this.prevBlendFunc = [
      gl.getParameter(gl.BLEND_SRC_RGB),
      gl.getParameter(gl.BLEND_DST_RGB)
    ];
    this.prevBlendEq = gl.getParameter(gl.BLEND_EQUATION_RGB);

    // Set up for counting.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, 1, 1);

    // Clear to zero
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Enable additive blending.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(gl.FUNC_ADD);

    // Use our simple shader
    gl.useProgram(this.program);
  }

  end() {
    const gl = this.gl;

    // Read the single pixel.
    const pixel = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);

    // Restore state
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.prevFBO);
    gl.viewport(...this.prevViewport);

    if ( !this.prevBlend ) gl.disable(gl.BLEND);
    gl.blendFunc(this.prevBlendFunc[0], this.prevBlendFunc[1]);
    gl.blendEquation(this.prevBlendEq);

    // Return the count (red channel contains the sum).
    return pixel[0];
  }

  destroy() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
  }
}

/* Usage:
async function countFragments(gl, drawCallback) {
  const counter = new FragmentCounter(gl);

  // Start counting
  counter.begin();

  // Draw your geometry here
  await drawCallback();

  // Get the fragment count
  const fragmentCount = counter.end();
  console.log('Visible fragments:', fragmentCount);

  // Clean up
  counter.destroy();
  return fragmentCount;
}
*/