/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export const AttribLocation = {
  position: 0,
  normal: 1,
  uv0: 2,
};

const DefaultAttribFormat = {
  position: 'float32x3',
  normal: 'float32x3',
  uv0: 'float32x2',
};

const DefaultStride = {
  uint8x2: 2,
  uint8x4: 4,
  sint8x2: 2,
  sint8x4: 4,
  unorm8x2: 2,
  unorm8x4: 4,
  snorm8x2: 2,
  snorm8x4: 4,
  uint16x2: 4,
  uint16x4: 8,
  sint16x2: 4,
  sint16x4: 8,
  unorm16x2: 4,
  unorm16x4: 8,
  snorm16x2: 4,
  snorm16x4: 8,
  float16x2: 4,
  float16x4: 8,
  float32: 4,
  float32x2: 8,
  float32x3: 12,
  float32x4: 16,
  uint32: 4,
  uint32x2: 8,
  uint32x3: 12,
  uint32x4: 16,
  sint32: 4,
  sint32x2: 8,
  sint32x3: 12,
  sint32x4: 16,
};


export class Geometry {
  /** @type {GPUDevice} */
  device;

  /** @type {object} */
  layout = {};

  /** @type {object[]} */
  vertexBindings = [];

  /** @type {object} */
  indexBinding = {};

  /** @type {number} */
  drawCount = 0;

  /**
   * @param {GPUDevice} device
   * @param {GeometryDescriptor} desc
   */
  constructor(device, desc) {
    this.device = device;
    const geom = this.buildGeometryBufferDescription(desc);
    this.buffers = geom.buffers;
    this.vertexBindings = geom.vertexBindings;
    this.indexBinding = geom.indexBinding;
    this.drawCount = geom.drawCount;
  }

  /**
   * Sets the Vertex and Index buffers for this geometry
   * @param {GPURenderPassEncoder} renderPass
   */
  setBuffers(renderPass) {
    for (let i = 0; i < this.vertexBindings.length; ++i) {
      const binding = this.vertexBindings[i];
      renderPass.setVertexBuffer(i, binding.buffer, binding.offset, binding.size);
    }

    if (this.indexBinding) {
      const binding = this.indexBinding;
      renderPass.setIndexBuffer(binding.buffer, binding.format, binding.offset, binding.size);
    }
  }

  /**
   * Renders the geometry for a specified number of instances.
   * @param {GPURenderPassEncoder} renderPass
   * @param {number} instanceCount
   * @param {number} firstInstance
   */
  draw(renderPass, instanceCount, firstInstance) {
    if (this.indexBinding) {
      renderPass.drawIndexed(this.drawCount, instanceCount, this.indexBinding.firstIndex, 0, firstInstance);
    } else {
      renderPass.draw(this.drawCount, instanceCount, 0, firstInstance);
    }
  }

  buildGeometryBufferDescription(desc) {
    const vertexBufferLayouts = [];
    let maxVertices = Number.MAX_SAFE_INTEGER;
    let requiredVertexBufferSize = 0;
    // let requiredIndexBufferSize = 0;

    for ( const attribName of Object.keys(AttribLocation) ) {
      const attrib = desc[attribName];
      if ( !attrib ) continue;

      const values = attrib.values;
      const label = attrib.label;
      const format = attrib.format ?? DefaultAttribFormat[attribName];
      const arrayStride = attrib.stride ?? DefaultStride[format];
      const offset = attrib.offset ?? 0;
      const shaderLocation = AttribLocation[attribName];

      // TODO: Dedupe??
      // See https://github.com/toji/webgpu-bundle-culling/blob/main/js/geometry.js
      let byteArray;
      if ( ArrayBuffer.isView(values) ) byteArray = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      else if ( values instanceof ArrayBuffer ) byteArray = new Uint8Array(values);
      else if ( Array.isArray(values) ) byteArray = new Uint8Array(new Float32Array(values).buffer); // TODO: Should this be based on the attrib type?

      requiredVertexBufferSize += Math.ceil(byteArray.byteLength / 4) * 4;
      maxVertices = Math.min(maxVertices, byteArray.byteLength / arrayStride);
      vertexBufferLayouts.push({
        buffer: values,
        arrayStride,
        size: byteArray.byteLength,
        stepMode: "vertex",
        attributes: [{
          shaderLocation,
          format,
          offset: offset + requiredVertexBufferSize,
        }]
      });
    }

    // Finally, sort the buffer layouts by their first attribute's shader location.
    vertexBufferLayouts.sort((a, b) => a.attributes[0].shaderLocation - b.attributes[0].shaderLocation);

    // Create and fill the index buffer
    let indexBinding;
    let indexArray = null;
    // let indexFormat;

    // TODO: Index buffer if desc.indices is present.
    // TODO: NormalizeBufferLayout for speed?
    // See https://github.com/toji/webgpu-bundle-culling/blob/main/js/geometry.js

    const vertexBindings = [];
    const buffers = [];
    for ( const layout of vertexBufferLayouts ) {
      vertexBindings.push({
        buffer: null, // Populated after.
        offset: layout.attributes.offset,
        size: layout.size,
      });
      buffers.push({
        arrayStride: layout.arrayStride,
        stepMode: layout.stepMode,
        attributes: layout.attributes
      });
    }

    const drawCount = indexArray ? desc.indices.length : maxVertices;
    const geometry = {
      label: desc.label,
      buffers,
      vertexBindings,
      indexBinding,
      drawCount,
    };

    // Allocate a GPUBuffer of the required size and copy all the array values
    // into it.
    const vertexBuffer = this.device.createBuffer({
      label: `BatchVertexBuffer`,
      size: requiredVertexBufferSize,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    const vertexBufferArray = new Uint8Array(vertexBuffer.getMappedRange());
    // FIXME: Need to correctly set the buffer.
   //  for (const source of arraySource.values()) {
//       vertexBufferArray.set(source.byteArray, source.bufferOffset);
//     }
    vertexBuffer.unmap();

    for ( const binding of geometry.vertexBindings ) binding.buffer = vertexBuffer;

    // TODO: Index buffer.
    return geometry;
  }
}


/*
Adapted from https://github.com/toji/webgpu-bundle-culling

MIT License

Copyright (c) 2023 Brandon Jones

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/