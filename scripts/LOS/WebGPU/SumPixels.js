/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { WebGPUDevice, WebGPUShader } from "./WebGPU.js";

class WebGPUComputeAbstract {
  /** @type {GPUComputePipeline} */
  pipeline;

  /** @type {GPUModule} */
  module;

  /** @type {GPUBuffer} */
  buffers = {};

  /** @type {GPUBindGroup} */
  bindGroups = {};

  /** @type {GPUDevice} */
  device;

  /** @type {GPUBindGroupLayout} */
  bindGroupLayouts = {};

  bindGroupLayoutsArray = [];

  /** @type {string} */
  static shaderFile = "";

  /** @type {object} */
  BINDGROUP_LAYOUT_OPTS = {};

  /** @type {object} */
  static GROUP_NUM = {};

  COMPUTE_PIPELINE_OPTS = {
    label: `${this.constructor.name}`,
    layout: "auto",
    compute: {
      module: null,
      entryPoint: "computeMain",
    }
  }

  constructor(device) {
    if ( device ) this.device = device;
  }

  /**
   * Get the current device or attempt to get a new one if lost.
   */
  async getDevice() {
    if ( this.device ) return this.device;
    this.device = await WebGPUDevice.getDevice();
    return this.device;
  }

  #workgroupSize = { x: 256, y: 1, z: 1 };

  get workgroupSize() { return this.#workgroupSize; }

  /**
   * Do steps needed to create the compute pipeline and resources.
   * @param {object} params     Parameters that are passed to the shader.
   */
  async initialize(params = {}) {
    params.presentationFormat ??= WebGPUDevice.presentationFormat;
    params.workgroupSize ??= {};
    this.#workgroupSize.x = params.workgroupSize.x ??= 256
    this.#workgroupSize.y = params.workgroupSize.y ??= 1
    this.#workgroupSize.z = params.workgroupSize.z ??= 1;

    for ( const [key, opts] of Object.entries(this.BINDGROUP_LAYOUT_OPTS) ) {
      this.bindGroupLayouts[key] = this.device.createBindGroupLayout(opts);
    }
    this.module = await WebGPUShader.fromGLSLFile(this.device, this.constructor.shaderFile, `${this.constructor.name} Shader`, params);
    this._setComputePipelineOpts();
    this.pipeline = await this.device.createComputePipelineAsync(this.COMPUTE_PIPELINE_OPTS);
    this._defineStaticBuffers();
    this._defineStaticBindGroups();
  }

  /**
   * Run the compute pipeline.
   * @param {GPUTexture} texture    Texture to sum
   * @returns {*} Output of the computation.
   */
  async compute(opts) {
    // console.debug(`${this.constructor.name}|computing...`);
    await this._compute(opts);
    // console.debug(`${this.constructor.name}|pulling result...`);
    const res = await this._postCompute(opts);
    // console.debug(`${this.constructor.name}|${res.red} red pixels; ${res.redBlocked} blocked red pixels`);
    return res;
  }

  computeSync(opts,) {
    this._computeSync(opts);
    const res = this._postComputeSync(opts);
    return res;
  }

  /**
   * Run the compute pass(es).
   */
  async _compute(_opts) {}

  /**
   * Process the resulting compute passes to arrive at a final result.
   */
  async _postCompute(_opts) {}

  /**
   * Define options for the compute pipeline.
   */
  _setComputePipelineOpts() {
    this.COMPUTE_PIPELINE_OPTS.layout = this.device.createPipelineLayout({
      label: `${this.constructor.name}`,
      bindGroupLayouts: this.bindGroupLayoutsArray,
    });
    this.COMPUTE_PIPELINE_OPTS.compute.module ??= this.module;
  }

  /**
   * Define buffers used in this compute pipeline.
   */
  _defineStaticBuffers() {}

  /**
   * Define bind groups used in this compute pipeline.
   */
  _defineStaticBindGroups() {}
}

export class WebGPUSumRedPixels extends WebGPUComputeAbstract {
  /** @type {object} */
  BINDGROUP_LAYOUT_OPTS = {
    output: {
      label: `${WebGPUSumRedPixels.constructor.name} output`,
      entries:[{
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: "storage",
          hasDynamicOffset: false,
          minBindingSize: 8,
        },
      }]
    },
    renderTexture: {
      label: `${WebGPUSumRedPixels.constructor.name} renderTexture`,
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: "read-only",
          viewDimension: "2d",
          format: WebGPUDevice.presentationFormat,
        }
      }]
    }
  }

  /** @type {object} */
  static GROUP_NUM = {
    output: 0,
    renderTexture: 1,
  };

  bindGroupLayoutsArray = Array(2);

  /** @type {string} */
  static shaderFile = "sum_red_pixels";

  /**
   * Define options for the compute pipeline.
   */
  _setComputePipelineOpts() {
    this.bindGroupLayoutsArray[this.constructor.GROUP_NUM.output] = this.bindGroupLayouts.output;
    this.bindGroupLayoutsArray[this.constructor.GROUP_NUM.renderTexture] = this.bindGroupLayouts.renderTexture;
    super._setComputePipelineOpts();
  }

  /**
   * Define buffers used in this compute pipeline.
   */
  _defineStaticBuffers() {
    // Buffer to sum the values.
    this.buffers.counterOutput = this.device.createBuffer({
      label: `${this.constructor.name} counterOutput`,
      size: 8, // 4 bytes per (u32)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // Buffer to get back the results
    this.buffers.counterResult = this.device.createBuffer({
      label: `${this.constructor.name} counterResult`,
      size: 8, // 4 bytes per (u32)
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Sync buffer
    this.buffers.counterResultSync = this.device.createBuffer({
      label: `${this.constructor.name} counterResultSync`,
      size: 8, // 4 bytes per (u32)
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ_SYNC,
    });
  }

  /**
   * Define bind groups used in this compute pipeline.
   */
  _defineStaticBindGroups() {
    this.bindGroups.counterOutput = this.device.createBindGroup({
      label: `${this.constructor.name} counterOutput`,
      layout: this.bindGroupLayouts.output,
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, resource: { buffer: this.buffers.counterOutput }},
      ],
    });
  }

  /**
   * Define the bind group used with the texture to sum.
   * @param {GPUTexture}
   */
  _defineTextureBindGroup(texture) {
    this.bindGroups.counterTexture = this.device.createBindGroup({
      label: `${this.constructor.name} counterTexture`,
      layout: this.bindGroupLayouts.renderTexture,
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, resource: texture.createView() },
      ],
    });
  }

  #counterReset = new Uint32Array([1, 1]);

  /**
   * Run the compute pass(es).
   */
  async _compute(texture) {
    this._computeSync(texture, false);
    return this.device.queue.onSubmittedWorkDone();
  }

  _computeSync(texture, sync = true) {
    this._defineTextureBindGroup(texture);

    // Reset the counter.
    this.device.queue.writeBuffer(this.buffers.counterOutput, 0, this.#counterReset);

    const numWorkgroups = { x: texture.width, y: texture.height, z: 1 };
    numWorkgroups.x = Math.ceil(numWorkgroups.x / this.workgroupSize.x);
    numWorkgroups.y = Math.ceil(numWorkgroups.y / this.workgroupSize.y);

    const encoder = this.device.createCommandEncoder({ label: `${this.constructor.name}` });
    const computePass = encoder.beginComputePass();
    //  pass.setViewport(0, 0, textures.colorTarget.width, textures.colorTarget.height, 0, 1); // Unneeded b/c defaults will do.
    computePass.setPipeline(this.pipeline);
    computePass.setBindGroup(this.constructor.GROUP_NUM.output, this.bindGroups.counterOutput);
    computePass.setBindGroup(this.constructor.GROUP_NUM.renderTexture, this.bindGroups.counterTexture)
    computePass.dispatchWorkgroups(numWorkgroups.x, numWorkgroups.y, numWorkgroups.z);
    computePass.end();

    // Copy the counter buffer to the result buffer
    const resultBuffer = sync ? this.buffers.counterResultSync : this.buffers.counterResult;
    encoder.copyBufferToBuffer(this.buffers.counterOutput, 0, resultBuffer, 0, resultBuffer.size);

    // Execute the commands
    this.device.queue.submit([encoder.finish()]);
  }


  /**
   * Process the resulting compute passes to arrive at a final result.
   */
  async _postCompute(_opts) {
    // Get the data from the result buffer.
    // this.buffers.counterResult.unmap();
    await this.buffers.counterResult.mapAsync(GPUMapMode.READ);
    const counterPixels = new Uint32Array(this.buffers.counterResult.getMappedRange());
    const red = counterPixels[0];
    const redBlocked = counterPixels[1];
    this.buffers.counterResult.unmap();
    return { red, redBlocked };
  }

  _postComputeSync(_opts) {
    console.error(`${this.constructor.name}|_postComputeSync not enabled.`);
    this.buffers.counterResultSync.mapSync(GPUMapMode.READ);
    const counterPixels = new Uint32Array(this.buffers.counterResultSync.getMappedRange());
    const red = counterPixels[0];
    const redBlocked = counterPixels[1];
    this.buffers.counterResultSync.unmap();
    return { red, redBlocked };
  }
}