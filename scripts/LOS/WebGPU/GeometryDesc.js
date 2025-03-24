/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// BBEdit notes: mark, fixme, fix-me, note, nyi, review, todo, to-do, xxx, ???, !!!
// TODO: todo
// FIXME: fixme!
// REVIEW: review
// !!!: exclamation
// NYI: nyi
// MARK: mark
// NOTE: note
// XXX xs
// ???: questions


/**
 * Describe a placeable by its vertices, normals, and uvs.
 * Typically 1x1x1 centered at origin 0,0,0.
 */
export class GeometryDesc {
  /** @type {string} */
  label = "";

  /** @type {number} */
  numVertices = 0;

  /** @type {Float32Array} */
  vertices;

  /** @type {Uint16Array} */
  indices;

  // This geometry's vertex and index buffers.
  vertexBuffer;

  indexBuffer;

  // Offsets for this geometry's vertex and index buffers.
  /** @type {number} */
  vOffset = 0;

  /** @type {number} */
  iOffset = 0;

  static indexFormat = "uint16";

  /**
   * @param {object} [opts]
   * @param {string} [opts.label]       Label for this structure
   * @param {number} [opts.width]       Width of the token (in x direction)
   * @param {number} [opts.height]      Depth of the token (in y direction)
   * @param {number} [opts.zHeight]     Height of token (in z direction)
   * @param {number} [opts.x]           Location on x-axis
   * @param {number} [opts.y]           Location on y-axis
   * @param {number} [opts.z]           Location on z-axis
   */
  constructor(opts = {}) {
    if ( opts.label ) this.label = opts.label;
    const w = (opts.width ?? 1) * 0.5;
    const d = (opts.height ?? 1) * 0.5
    const h = (opts.zHeight ?? 1) * 0.5;

    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const z = opts.z ?? 0;

    this._defineVerticesAndIndices({ ...opts, x, y, z, w, d, h,  }); // Override opts with x,y,z, etc.
  }

  /**
   * Define the vertices and optional indices for this geometry.
   * @param {object} [opts]
   * @param {number} [opts.w]           Width of the token (in x direction)
   * @param {number} [opts.d]           Depth of the token (in y direction)
   * @param {number} [opts.h]           Height of token (in z direction)
   * @param {number} [opts.x]           Location on x-axis
   * @param {number} [opts.y]           Location on y-axis
   * @param {number} [opts.z]           Location on z-axis
   * @override
   */
  _defineVerticesAndIndices(_opts = {}) {}

  /**
   * Set the vertex buffer to render this geometry.
   * @param {GPURenderPassEncoder} renderPass
   * @param {GPUBuffer} [vertexBuffer]              The buffer that contains this geometry's vertex data
   * @param {number} [vertexOffset = 0]             Where on the buffer the data begins
   */
  setVertexBuffer(renderPass, vertexBuffer, offset) {
    vertexBuffer ??= this.vertexBuffer;
    offset ??= this.vOffset ?? 0;
    renderPass.setVertexBuffer(0, vertexBuffer, offset, this.vertices.byteLength)
  }

  /**
   * Set the index buffer to render this geometry.
   * @param {GPURenderPassEncoder} renderPass
   * @param {GPUBuffer} [vertexBuffer]              The buffer that contains this geometry's vertex data
   * @param {number} [vertexOffset = 0]             Where on the buffer the data begins
   */
  setIndexBuffer(renderPass, indexBuffer, offset) {
    if ( !this.indices ) return;
    indexBuffer ??= this.indexBuffer;
    offset ??= this.iOffset ?? 0;
    renderPass.setIndexBuffer(indexBuffer, this.constructor.indexFormat, offset, this.indices.byteLength);
  }

  /**
   * Draw this geometry.
   * See https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPassEncoder/drawIndexed
   * @param {GPURenderPassEncoder} renderPass
   * @param {object} [opts]
   * @param {number} [opts.instanceCount=1]   Number of instances to draw
   * @param {number} [opts.firstInstance=0]   What instance to start with
   * @param {number} [opts.firstIndex=0]      Offset into the index buffer, in indices (rarely used)
   * @param {number} [opts.baseVertex=0]      A number added to each index value (rarely used)
   */
  draw(renderPass, { instanceCount = 1, firstInstance = 0, firstIndex = 0, baseVertex = 0, firstVertex = 0 } = {}) {
    if ( !instanceCount ) return;
    if ( this.indices ) {
      renderPass.drawIndexed(this.indices.length, instanceCount, firstIndex, baseVertex, firstInstance);
    } else {
      renderPass.draw(this.vertices.length, instanceCount, firstVertex, firstInstance);
    }
  }

  /**
   * Draw this geometry for only the specified instances.
   * @param {GPURenderPassEncoder} renderPass
   * @param {Set<number>|} instanceSet           Set of positive integers, including 0.
   */
  drawSet(renderPass, instanceSet) {
    if ( !instanceSet.size ) return;

    const drawFn = this.indices
      ? (instanceCount, firstInstance) => renderPass.drawIndexed(this.indices.length, instanceCount, 0, 0, firstInstance)
        : (instanceCount, firstInstance) => renderPass.draw(this.vertices.length, instanceCount, 0, firstInstance);

    // For a consecutive group, draw all at once.
    // So if 0–5, 7–9, 12, should result in 3 draw calls.
    if ( instanceSet instanceof Set ) instanceSet = [...instanceSet.values()];
    instanceSet.sort((a, b) => a - b);
    for ( let i = 0, n = instanceSet.length; i < n; i += 1 ) {
      const firstInstance = instanceSet[i];

      // Count the number of consecutive instances.
      let instanceCount = 1;
      while ( instanceSet[i + 1] === instanceSet[i] + 1 ) { instanceCount += 1; i += 1; }
      // console.log({ firstInstance, instanceCount }); // Debugging.
      drawFn(instanceCount, firstInstance);
    }
  }

  // TODO: drawSet to skip some?

  /**
   * Determine the buffer offsets to store vertex data for a given group of geometries.
   * @param {number} idx      Which vertexData index to use.
   * @param {...GeometryDesc} ...geoms
   * @returns {object}
   * - @prop {array} offsets        In byteLength; sum of the sizes iteratively
   * - @prop {array} sizes          In byteLength
   * - @prop {array} numVertices      Number of vertices in each
   * - @prop {number} totalVertices Sum of the numVertices
   * - @prop {number} totalSize     Sum of the sizes
   */
  static computeBufferOffsets(geoms) {
    const ln = geoms.length;
    const out = {
      vertex: {
        offsets: new Uint16Array(ln),
        sizes: new Uint16Array(ln),
        lengths: new Uint16Array(ln),
        totalLength: 0,
        totalSize: 0,
      },
      index: {
        offsets: new Uint16Array(ln),
        sizes: new Uint16Array(ln),
        lengths: new Uint16Array(ln),
        totalLength: 0,
        totalSize: 0,
      }
    };
    for ( let i = 0; i < ln; i += 1 ) {
      const geom = geoms[i];
      out.vertex.totalSize += out.vertex.sizes[i] = geom.vertices.byteLength;
      out.vertex.totalLength += out.vertex.lengths[i] = geom.numVertices;

      out.index.totalSize += out.index.sizes[i] = geom.indices?.byteLength ?? 0;
      out.index.totalLength += out.index.lengths[i] = geom.indices?.length ?? 0;
    }

    // Iterative sum of sizes for the offsets.
    for ( let i = 1; i < ln; i += 1 ) {
      out.vertex.offsets[i] += out.vertex.offsets[i - 1] + out.vertex.sizes[i - 1];
      out.index.offsets[i] += out.index.offsets[i - 1] + out.index.sizes[i - 1];
    }
    return out;
  }

  static buffersLayout = [
    {
      arrayStride: Float32Array.BYTES_PER_ELEMENT * 8, // 3 position, 2 normal, 2 uv.
      stepMode: "vertex",
      attributes: [
        // Position
        {
          format: "float32x3",
          offset: 0,
          shaderLocation: 0,
        },
        // Normal
        {
          format: "float32x3",
          offset: Float32Array.BYTES_PER_ELEMENT * 3,
          shaderLocation: 1,
        },
        // UV0
        {
          format: "float32x2",
          offset: Float32Array.BYTES_PER_ELEMENT * 6,
          shaderLocation: 2,
        }
      ]
    }
  ];
}