/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { WebGPUDevice } from "./WebGPU.js";

export class SumPixelsWebGL2 {

  /** @type {OffScreenCanvas} */
  gpuCanvas = new OffscreenCanvas(1,1);

  /** @type {OffScreenCanvas} */
  glCanvas = new OffscreenCanvas(1, 1);

  /** @type {GPUCanvasContext} */
  gpuCtx;

  /** @type {WebGL2RenderingContext} */
  gl;

  /** @type {WebGLTexture} */
  texture;

  /** @type {WebGLFrameBuffer} */
  framebuffer;

  /** @type {Uint8Array} */
  bufferData;

  constructor({ width = 256, height = 256, device } = {}) {
    this.gpuCanvas.width = width;
    this.gpuCanvas.height = height;
    this.gpuCtx = this.gpuCanvas.getContext("webgpu");
    this.gpuCtx.configure({
      device,
      format: WebGPUDevice.presentationFormat,
    });


    const gl = this.gl = this.glCanvas.getContext("webgl2");
    this.texture = gl.createTexture();
    this.framebuffer = gl.createFramebuffer();

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    const readbackSize = width * height * 4;
    this.bufferData = new Uint8Array(readbackSize);
  }

  // Must first render to the gpuCanvas.
  // Then call this to retrieve the pixel data.
  pixelDataFromRender() {
    const gl = this.gl;
    const { width, height } = this.gpuCanvas;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.gpuCanvas);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferData);
    return { pixels: this.bufferData, x: 0, y: 0, width, height };
  }

  sumRedPixels(pixels) {
    let sumTarget = 0;
    for ( let i = 0, n = pixels.length; i < n; i += 4 ) sumTarget += Boolean(pixels[i]);
    return sumTarget;
  }
}

