/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export class MaterialsTracker {
  /** @type {GPUDevice} */
  device;

  /** @type {Map<string, GPUBindGroup>} */
  bindGroups = new Map();

  /** @type {GPUBindGroupLayout} */
  bindGroupLayout;

  /** @type {object} */
  static MATERIAL_LAYOUT = {
    label: 'Material',
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {}
    }]
  };

  /**
   * @type {GPUDevice} device
   */
  constructor(device) {
    this.device = device;
    this.bindGroupLayout = device.createBindGroupLayout(this.constructor.MATERIAL_LAYOUT);
  }

  /**
   * Create singleton material for a given label.
   * Currently does not check if r,g,b,a are same/different for given label.
   * @param {object} [opts]
   * @param {number} [opts.r]     Red value (0–1)
   * @param {number} [opts.g]     Green value (0–1)
   * @param {number} [opts.b]     Blue value (0–1)
   * @param {number} [opts.a]     Alpha value (0–1)
   * @param {string} [opts.label] Name/key of the material
   */
  create({ r, g, b, a, label }) {
    r ??= 0.0;
    g ??= 0.0;
    b ??= 0.0;
    a ??= 1.0;
    label ??= `Material (${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)}, ${a.toFixed(2)})`;
    if ( this.bindGroups.has(label) ) return;

    const buffer = this.device.createBuffer({
      label,
      size: Float32Array.BYTES_PER_ELEMENT * 4,
      usage: GPUBufferUsage.UNIFORM,
      mappedAtCreation: true,
    });
    const materialArray = new Float32Array(buffer.getMappedRange());
    materialArray[0] = r;
    materialArray[1] = g;
    materialArray[2] = b;
    materialArray[3] = a;
    buffer.unmap();

    this.bindGroups.set(label, this.device.createBindGroup({
      label,
      layout: this.bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer }
      }],
    }));
  }
}