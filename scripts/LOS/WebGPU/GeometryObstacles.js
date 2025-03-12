/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { WebGPUBuffer } from "./WebGPU.js";
import { GeometryLayoutCache, NormalizeBufferLayout } from './GeometryLayoutCache.js';

const layoutCache = new GeometryLayoutCache();

export const AttribLocation = {
  position: 0,
  normal: 1,
  tangent: 2,
  texcoord0: 3,
}

const DefaultAttribFormat = {
  position: 'float32x3',
  normal: 'float32x3',
  tangent: 'float32x3',
  texcoord0: 'float32x2',
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

/**
 * Definition of an attribute for a Geometry
 * @typedef {ArrayBuffer | TypedArray | number[]} GeometryAttributeValues
 */

/**
 * Definition of an attribute for a Geometry
 * @typedef {Object} AttributeDescriptor
 * @prop {GeometryAttributeValues} values
 * @prop {number} [offset=0]
 * @prop {number} [stride]
 * @prop {GPUVertexFormat} [format]
 */

/**
 * Definition of a Geometry object.
 * @typedef {Object} GeometryObject
 * @prop {} layout
 * @prop {} vertexBindings
 * @prop {} indexBinding
 * @prop {number} drawCount             Number of vertices to draw
 */

/**
 * Definition of an attribute for a Geometry
 * @typedef {GeometryAttributeValues | AttributeDescriptor} GeometryAttribute
 */

/**
 * Description of the Geometry to be created
 * @typedef {Object} GeometryDescriptor
 * @prop {string} label - An arbitary label used to identify this Geometry. May be used to label related WebGPU objects.
 * @prop {GeometryAttribute} position
 * @prop {GeometryAttribute} [normal]
 * @prop {GeometryAttribute} [tangent]
 * @prop {GeometryAttribute} [texcoord0]
 * @prop {number} [drawCount]
 * @prop {Uint16Array | Uint32Array | number[]} [indices]
 * @prop {GPUPrimitiveTopology} [topology]
 */


export class Geometry {
  /** @type {} */
  layout;

  /** @type {} */
  vertexBindings;

  /** @type {} */
  indexBinding;

  /** @type {} */
  drawCount;


  /**
   * @param {GPUDevice} device
   * @param {GeometryDescriptor} desc
   */
  constructor(device, geomOrDesc) {
    this.device = device;
    const geom = geomOrDesc.vertexBindings ? geomOrDesc : buildGeometryBatch(device, [geomOrDesc])[0];
    this.layout = geom.layout;
    this.vertexBindings = geom.vertexBindings;
    this.indexBinding = geom.indexBinding;
    this.drawCount = geom.drawCount;
  }

  static CreateBatch(device, descArray) {
    return buildGeometryBatch(device, descArray).map(g => new Geometry(device, g));
  }

  /**
   * Sets the Vertex and Index buffers for this geometry.
   * @param {GPURenderPassEncoder} renderPass
   */
  setBuffers(renderPass) {
    for ( let i = 0, n = this.vertexBindings.length; i < n; i += 1 ) {
      const binding = this.vertexBindings[i];
      renderPass.setVertexBuffer(i, binding.buffer, binding.offset, binding.size);
    }

    if ( this.indexBinding ) {
      const binding = this.indexBinding;
      renderPass.setIndexBuffer(binding.buffer, binding.format, binding.offset, binding.size);
    }
  }

  /**
   * Draw this geometry.
   * @param {GPURenderPassEncoder} renderPass
   * @param {number} instanceCount                Number of instances to draw
   * @param {number} firstInstance                Offset into the index buffer, in indices, to begin drawing from
   */
  draw(renderPass, instanceCount, firstInstance) {
    if (this.indexBinding) {
      renderPass.drawIndexed(this.drawCount, instanceCount, this.indexBinding.firstIndex, 0, firstInstance);
    } else {
      renderPass.draw(this.drawCount, instanceCount, 0, firstInstance);
    }
  }

  static getLayoutCache() { return layoutCache; }
}



/**
 * Combine geometry attributes into single buffer.
 * @param {GPUDevice} device
 * @param {GeometryDescriptor[]} descArray
 * @returns {GeometryObject}
 */
function buildGeometryBatch(device, descArray) {
  const { geometries, requiredVertexBufferSize, requiredIndexBufferSize, arraySource } = _constructGeometries(descArray);
  if ( !requiredVertexBufferSize ) throw new Error("buildGeometryBatch|No vertex data provided.");

  // Allocate a GPUBuffer of the required size and copy all the array values
  // into it.
  const allocCallback = arr => {
    for (const source of arraySource.values()) {
      arr.set(source.byteArray, source.bufferOffset);
    }
  };
  const vertexBuffer = WebGPUBuffer.initializeVertices(
    device,
    Uint8Array,
    allocCallback,
    { label: "BatchVertexBuffer", size: requiredVertexBufferSize },
  );

  // Each geometry is assigned the same vertex buffer.
  for ( const geometry of geometries ) {
    for ( const binding of geometry.vertexBindings ) binding.buffer = vertexBuffer;
  }

  // Construct optional index buffer.
  if ( requiredIndexBufferSize ) {
    const allocCallback = arr => {
      for ( const geometry of geometries ) {
        const ib = geometry.indexBinding;
        arr.set(ib.buffer, ib.offset);
        ib.buffer = indexBuffer;

        // In order to make indirect drawing validation faster in Chrome, reset the binding offset and size to 0 while
        // setting the firstIndex to the approrpriate offset.
        ib.firstIndex = ib.format == 'uint16' ? ib.offset / 2 : ib.offset / 4;
        ib.offset = 0;
        ib.size = undefined;
      }
    }
    const indexBuffer = WebGPUBuffer.initializeIndices(
      device,
      Uint8Array,
      allocCallback,
      { label: "BatchIndexBuffer", size: requiredIndexBufferSize },
    );
  }
  return geometries;
}

/**
 * For buildGeometryBatch.
 * @param {GeometryDescriptor[]} descArray
 * @returns {object}
 * - @prop {GeometryObject[]} geometries
 * - @prop {number} requiredVertexBufferSize
 * - @prop {number} requiredIndexBufferSize
 */
function _constructGeometries(descArray) {
  const arraySource = new Map();
  let requiredVertexBufferSize = 0;
  let requiredIndexBufferSize = 0;
  const geometries = [];

  for ( const desc of descArray ) {
    const vertexBufferLayouts = [];
    let maxVertices = Number.MAX_SAFE_INTEGER;

    for ( const attribName of Object.keys(AttribLocation) ) {
      const attrib = desc[attribName];
      if ( !attrib ) continue;

      const values = attrib.values ?? attrib;
      const format = attrib.format ?? DefaultAttribFormat[attribName];
      const arrayStride = attrib.stride ?? DefaultStride[format];
      const offset = attrib.offset ?? 0;
      const shaderLocation = AttribLocation[attribName];

      // Figure out how much space each attribute will require. Does
      // some basic de-duping of attrib values to prevent the same array from
      // being uploaded twice.
      let source = arraySource.get(values);
      if ( !source ) {
        let byteArray;
        if ( ArrayBuffer.isView(values) )  {
          byteArray = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
        } else if ( values instanceof ArrayBuffer ) byteArray = new Uint8Array(values);
        else if ( Array.isArray(values) ) byteArray = new Uint8Array(new Float32Array(values).buffer);  // TODO: Should this be based on the attrib type?
        else throw new Error(`Unknown values type in attribute ${attribName}`);

        source = {
          byteArray,
          bufferOffset: requiredVertexBufferSize,
          size: byteArray.byteLength,
        };
        arraySource.set(values, source);

        requiredVertexBufferSize += Math.ceil(byteArray.byteLength / 4) * 4;
        maxVertices = Math.min(maxVertices, byteArray.byteLength / arrayStride);
      } else console.debug("buildGeometryBatch|Deduped source!");

      vertexBufferLayouts.push({
        buffer: values,
        arrayStride,
        attributes: [{
          shaderLocation,
          format,
          offset: offset + source.bufferOffset,
        }]
      });
    }

    // Create and fill the index buffer.
    let indexBinding;
    let indexArray = null;
    let indexFormat;
    if ( desc.indices ) {
      if ( Array.isArray(desc.indices) ) {
        const u32Array = new Uint32Array(desc.indices);
        indexArray = new Uint8Array(u32Array.buffer, 0, u32Array.byteLength);
        indexFormat = "uint32";
      } else {
        indexFormat = desc.indices instanceof Uint16Array ? "uint16" : "uint32";
        indexArray = new Uint8Array(desc.indices.buffer, desc.indices.byteOffset, desc.indices.byteLength);
      }
      indexBinding = {
        format: indexFormat,
        buffer: indexArray,
        offset: requiredIndexBufferSize,
        size: indexArray.byteLength,
        firstIndex: 0,
      };
      requiredIndexBufferSize += indexArray.byteLength;
    }

    // Bind vertices.
    const bufferLayouts = NormalizeBufferLayout([...vertexBufferLayouts.values()]);
    const layout = layoutCache.createLayout(bufferLayouts, desc.topology ?? "triangle-list", indexFormat);
    const vertexBindings = [];
    for ( const layout of bufferLayouts ) {
      vertexBindings.push({
        buffer: null, // Populated after.
        offset: layout.bufferOffset,
        size: arraySource.get(layout.buffer).size,
      });
    }

    // Determine number of vertices to draw.
    const drawCount = desc.drawCount ?? indexArray ? desc.indices.length : maxVertices;

    // Add the geometry to the queue.
    geometries.push({ layout, vertexBindings, indexBinding, drawCount });
  }
  return { geometries, requiredVertexBufferSize, requiredIndexBufferSize, arraySource };
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
