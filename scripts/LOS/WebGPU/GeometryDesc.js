/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { combineTypedArrays } from "../util.js";


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
  /** @type {GPUBuffer} */
  vertexBuffer;

  /** @type {GPUBuffer} */
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
   * @param {boolean} [opts.addNormals]  True adds UVs to the vertex data
   * @param {boolean} [opts.addUVS]      True adds UVs to the vertex data
   */
  constructor(opts = {}) {
    if ( opts.label ) this.label = opts.label;
    const w = (opts.width ?? 1) * 0.5;
    const d = (opts.height ?? 1) * 0.5
    const h = (opts.zHeight ?? 1) * 0.5;

    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const z = opts.z ?? 0;

    this._defineVerticesAndIndices({ ...opts, x, y, z, w, d, h }); // Override opts with x,y,z, etc.
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
  _defineVerticesAndIndices(opts) {
    const arr = this.constructor.defineVertices(opts);
    const res = trimVertexData(arr, { addNormals: opts.addNormals, addUVs: opts.addUVs });
    this.constructor.translateVertices(res.vertices, { ...opts, length: res.length });
    this.vertices = res.vertices;
    this.indices = res.indices;
    this.numVertices = res.numVertices;
  }

  /**
   * Translate an array of x,y,z vertices in place.
   * Assumed that x,y,z are the start of the data.
   * @param {number[]} vertices       Modified in place
   * @param {object} [opts]
   * @param {number} [opts.x=1]       Number of x units to move
   * @param {number} [opts.y=1]       Number of y units to move
   * @param {number} [opts.z=1]       Number of z units to move
   * @param {number} [opts.length=8]  How many parameters per vertex
   * @returns {number[]} The modified vertices, for convenience
   */
  static translateVertices(vertices, { x = 0, y = 0, z = 0, length = 8 } = {}) {
    if ( !(x || y || z) ) return vertices;
    for ( let i = 0, iMax = vertices.length; i < iMax; i += length ) {
      vertices[i] += x;
      vertices[i + 1] += y;
      vertices[i + 2] += z;
    }
    return vertices;
  }

  /**
   * Return the full set of vertices, normals, and uvs for this object.
   */
  static defineVertices(_opts) { return { vertices: new Float32Array(), indices: new Uint16Array() }}

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
    if ( !(instanceSet.size || instanceSet.length) ) return;

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
   * @param {number} idx            Which vertexData index to use.
   * @param {GeometryDesc[]}  geoms The geometries used in the buffer
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
        offsets: new Uint16Array(ln), // Byte size of vertices consecutively summed.
        sizes: new Uint16Array(ln),   // Byte size of vertices.
        lengths: new Uint16Array(ln), // Length of vertices (number components * number of vertices).
        num: new Uint16Array(ln),     // Number of vertices.
        cumulativeNum: new Uint16Array(ln), // Cumulative sum of number of vertices.
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
      out.vertex.totalLength += out.vertex.lengths[i] = geom.vertices.length;
      out.vertex.num[i] = geom.numVertices;

      out.index.totalSize += out.index.sizes[i] = geom.indices?.byteLength ?? 0;
      out.index.totalLength += out.index.lengths[i] = geom.indices?.length ?? 0;

    }

    // Iterative sum of sizes for the offsets and cumulative number.
    for ( let i = 1; i < ln; i += 1 ) {
      out.vertex.offsets[i] += out.vertex.offsets[i - 1] + out.vertex.sizes[i - 1];
      out.vertex.cumulativeNum[i] += out.vertex.cumulativeNum[i - 1] + out.vertex.num[i - 1];
      out.index.offsets[i] += out.index.offsets[i - 1] + out.index.sizes[i - 1];
    }
    return out;
  }

  static buffersLayout = [
    {
      arrayStride: Float32Array.BYTES_PER_ELEMENT * 3, // 3 position, 3 normal, 2 uv.
      stepMode: "vertex",
      attributes: [
        // Position
        {
          format: "float32x3",
          offset: 0,
          shaderLocation: 0,
        }
      ]
    }
  ];

  static buffersLayoutNormals = [
     {
      arrayStride: Float32Array.BYTES_PER_ELEMENT * 6, // 3 position, 3 normal, 2 uv.
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
        }
      ]
    }
  ];

  static buffersLayoutUVs = [{
    arrayStride: Float32Array.BYTES_PER_ELEMENT * 5, // 3 position, 3 normal, 2 uv.
      stepMode: "vertex",
      attributes: [
        // Position
        {
          format: "float32x3",
          offset: 0,
          shaderLocation: 0,
        },
        // UV0
        {
          format: "float32x2",
          offset: Float32Array.BYTES_PER_ELEMENT * 3,
          shaderLocation: 1,
        }
      ]
  }];

  static buffersLayoutNormalsUVs = [
    {
      arrayStride: Float32Array.BYTES_PER_ELEMENT * 8, // 3 position, 3 normal, 2 uv.
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

  static define3dPolygonVertices(poly, { topZ = 0, bottomZ = 0, top, bottom } = {}) {
    top ??= this.polygonTopBottomFaces(poly, { elevation: topZ, top: true });
    bottom ??= this.polygonTopBottomFaces(poly, { elevation: bottomZ, top: false });
    const side = this.polygonSideFaces(poly, { topZ, bottomZ });
    const vertices = combineTypedArrays([top.vertices, side.vertices, bottom.vertices]);

    // For indices, increase because they are getting combined into one.
    side.indices = side.indices.map(elem => elem + top.numVertices);
    bottom.indices = bottom.indices.map(elem => elem + top.numVertices + side.numVertices);
    const indices = combineTypedArrays([top.indices, side.indices, bottom.indices]);

    // Expand the vertices based on indices, so they can be trimmed as needed.
    const arr = new Array(indices.length * 8);
    for ( let i = 0, n = indices.length; i < n; i += 1 ) {
      const vertex = vertices.slice(indices[i] * 8, (indices[i] * 8) + 8);
      const arrI = i * 8;
      for ( let v = 0; v < 8; v += 1 ) arr[arrI + v] = vertex[v];
    }
    return arr;
  }

  /**
   * Return vertices for the top or bottom of the polygon.
   * Requires that the polygon be sufficiently convex that it can be described by a fan of
   * polygons joined at its centroid.
   * @param {PIXI.Polygon} poly
   * @param {object} [opts]
   * @param {number} [opts.elevation]     Elevation of the face
   * @param {boolean} [opts.flip]         If true, treat as bottom face
   * @returns {object}
   * - @prop {Float32Array} vertices
   * - @prop {Uint16Array} indices
   */
  static polygonTopBottomFaces(poly, { elevation = 0, top = true, addUVs = true, addNormals = true } = {}) {
    /* Testing
    poly = _token.constrainedTokenBorder
    vs = PIXI.utils.earcut(poly.points)
    pts = [...poly.iteratePoints({ close: false })]
    tris = [];
    for ( let i = 0; i < vs.length; i += 3 ) {
     const a = pts[vs[i]];
     const b = pts[vs[i+1]];
     const c = pts[vs[i+2]];
     Draw.connectPoints([a, b, c], { color: Draw.COLORS.red })
     tris.push({a, b, c})
    }
    // Earcut appears to keep the counterclockwise order.
    tris.map(tri => foundry.utils.orient2dFast(tri.a, tri.b, tri.c))
    */

    // Because Foundry uses - axis to move "up", CCW and CW will get flipped in WebGPU.
    const flip = top;

    let vertices2d;
    let holes = [];

    // Earcut to determine indices. Then construct the vertices.
    if ( poly instanceof CONFIG.GeometryLib.ClipperPaths
      || poly instanceof CONFIG.GeometryLib.Clipper2Paths ) {
      // Assume a more complex shape, possibly with holes. See ClipperPaths.prototype.earcut.
      const coords = poly.toEarcutCoordinates();
      vertices2d = coords.vertices;
      holes = coords.holes;
    } else {
      if ( !(poly instanceof PIXI.Polygon) ) poly = poly.toPolygon();
      vertices2d = poly.points;
    }

    const indices = new Uint16Array(PIXI.utils.earcut(vertices2d, holes)); // Note: dimensions = 2.


    // For Foundry's  coordinate system, indices are always CCW triangles.
    // Flip to make CW if constructing the bottom face.
    if ( flip ) {
      for ( let i = 0, imax = indices.length; i < imax; i += 3 ) {
        const v0 = indices[i];
        const v2 = indices[i + 2];
        indices[i] = v2;
        indices[i + 2] = v0;
      }
    }

    let u;
    let v;
    if ( addUVs ) {
      // Set UVs to the coordinate within the bounding box.
      const xMinMax = Math.minMax(...vertices2d.filter((_coord, idx) => idx % 2 === 0))
      const yMinMax = Math.minMax(...vertices2d.filter((_coord, idx) => idx % 2 !== 0))
      const width = xMinMax.max - xMinMax.min;
      const height = yMinMax.max - yMinMax.min;
      const uOrig = x => (x - xMinMax.min) / width;
      const vOrig = y => (y - yMinMax.min) / height;
      u = uOrig;
      v = vOrig;
      if ( flip ) {
        u = x => 1 - uOrig(x);
        v = y => 1 - vOrig(y);
      }
    }
    const n = 1 * (-flip); // Flip is true: -1; flip is false: 1.

    // Copy the 2d points to 3d
    const numVertices = vertices2d.length * 0.5;
    const nCoords = 3 + (2 * addUVs) + (3 * addNormals);
    const vertices = new Float32Array(numVertices * nCoords);
    let i = 0;
    for ( let j = 0, jMax = vertices2d.length; j < jMax; j += 2 ) {
      const x = vertices2d[j];
      const y = vertices2d[j + 1];

      // Position
      vertices[i++] = x;
      vertices[i++] = y;
      vertices[i++] = elevation;

      if ( addNormals ) {
        // Normal: 0, 0, 1 or -1
        i++; i++;
        vertices[i++] = n;
      }
      if ( addUVs ) {
        vertices[i++] = u(x);
        vertices[i++] = v(y);
      }
    }
    return { indices, vertices, numVertices };
  }

  /**
   * Return vertices for the sides of the polygon. Forms squares based on the polygon points.
   * @param {PIXI.Polygon} poly
   * @param {number} [opts.topZ]     Elevation of the top face
   * @param {number} [opts.bottomZ]  Elevation of the bottom face
   * @param {boolean} [opts.flip]         If true, treat as bottom face
   * @returns {object}
   * - @prop {Float32Array} vertices
   * - @prop {Uint16Array} indices
   */
  static polygonSideFaces(poly, { flip = false, topZ = 0, bottomZ = 0 } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    if ( !(poly instanceof PIXI.Polygon) ) poly = poly.toPolygon();
    if ( poly.isClockwise ^ flip ) poly.reverseOrientation();

    // Some temporary points.
    const a = new Point3d();
    const b = new Point3d();
    const c = new Point3d();
    const d = new Point3d();
    const triPts = [a, b, c, d];
    const n = new Point3d();

    /* Looking at a side face
    a  b     uv: 0,0    1,0
    c  d         0,1    1,1

     CCW edge A -> B, so...
     a and c are taken from A
     b and d are taken from B

     // Indices go b, a, c, d, b, c.
    */

    // UVs match a, b, c, d
    const uvs = [
      { u: 0, v: 0 },
      { u: 0, v: 1 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
    ];

    const nEdges = Math.floor(poly.points.length / 2); // Each point has an edge.
    const numVertices = 4 * nEdges;
    const nIndices = 6 * nEdges;
    const vertices = new Float32Array(numVertices * 8);
    const indices = new Uint16Array(nIndices);
    let i = 0;
    let j = 0;
    let k = 0;
    for ( const { A, B } of poly.iterateEdges({ closed: true }) ) {
      // Position                   Normal          UV
      // B.x, B.y, topZ     nx, ny, nz      0, 0
      // A.x, A.y, topZ     nx, ny, nz      0, 0
      // A.x, A.y, bottomZ  nx, ny, nz      0, 0
      // B.x, B.y, bottomZ  nx, ny, nz      0, 0
      // B.x, B.y, topZ     nx, ny, nz      0, 0
      // A.x, A.y, bottomZ  nx, ny, nz      0, 0

      a.set(A.x, A.y, topZ);
      b.set(B.x, B.y, topZ);
      c.set(A.x, A.y, bottomZ);
      d.set(B.x, B.y, bottomZ);

      // Calculate the normal
      const deltaAB = b.subtract(a, Point3d._tmp2);
      const deltaAC = c.subtract(a, Point3d._tmp3);
      deltaAB.cross(deltaAC, n).normalize(n);

      // Indices go b, a, c, d, b, c.
      const idxArr = [1, 0, 2, 3, 1, 2].map(elem => elem + k);
      indices.set(idxArr, i);
      i += 6; // Increment number of indices in the array.
      k += 4; // Increment index: 0–3, 4–7, 8–11, ...

      // Define each vertex.
      // Position     Normal          UV
      // x, y, z      n.x, n.y, n.z   u, v
      for ( let i = 0; i < 4; i += 1 ) {
        const pt = triPts[i];
        const uv = uvs[i];
        vertices.set([pt.x, pt.y, pt.z, n.x, n.y, n.z, uv.u, uv.v], j);
        j += 8;
      }
    }
    return { indices, vertices, numVertices };
  }
}


/**
 * Trim an array of vertices, removing duplicates and defining indices to match.
 * @param {number[]} arr      1D array of vertices
 * @param {number} stride     How many elements between vertices?
 * @param {number} length     How many elements make up a vertex? Use to skip unneeded vertex information
 * @returns {object}
 * - @prop {Float32Array} vertices
 * - @prop {Uint16Array} indices
 */
function trimVertexData(arr, { addNormals = false, addUVs = false } = {}) {
  const stride = 8; // Arrangement is x, y, z, n.x, n.y, n.z, uv.v, uv.w
  let pullFn;
  let length;
  if ( addNormals && addUVs ) {
    pullFn = (tmpKey, vertexNum) => {
      pullCoords(tmpKey, arr, vertexNum);
      pullNormals(tmpKey, arr, vertexNum);
      pullUVs(tmpKey, arr, vertexNum);
    }
    length = 8;
  } else if ( addNormals ) {
    pullFn = (tmpKey, vertexNum) => {
      pullCoords(tmpKey, arr, vertexNum);
      pullNormals(tmpKey, arr, vertexNum);
    }
    length = 6;
  } else if ( addUVs ) {
    pullFn = (tmpKey, vertexNum) => {
      pullCoords(tmpKey, arr, vertexNum);
      pullUVs(tmpKey, arr, vertexNum, 3); // Skipping normals, so offset at 3.
    }
    length = 5
  } else {
    pullFn = (tmpKey, vertexNum) => pullCoords(tmpKey, arr, vertexNum);
    length = 3;
  }

  const vertices = [];
  const indices = new Uint16Array(arr.length / stride);
  const uniqueV = new Map();
  const tmpKey = new Array(length)
  for ( let i = 0, n = arr.length, v = 0; i < n; i += stride, v += 1 ) {
    pullFn(tmpKey, v);
    const key = tmpKey.join("_");
    if ( !uniqueV.has(key) ) {
      uniqueV.set(key, uniqueV.size);
      vertices.push(...tmpKey);
    }
    indices[v] = uniqueV.get(key);
  }
  return {
    indices,
    vertices: new Float32Array(vertices),
    numVertices: uniqueV.size,
    length,
  };
}

/**
 * Pull the x,y,z coordinates for a given vertex and place in array.
 * Arrangement is x, y, z, n.x, n.y, n.z, uv.v, uv.w.
 */
function pullCoords(tmpKey, arr, vertexNum, offset = 0, stride = 8) {
  for ( let j = 0; j < 3; j += 1 ) tmpKey[j + offset] = arr[(vertexNum * stride) + j];
}

/**
 * Pull the 3 normals for a given vertex and place in array.
 * Arrangement is x, y, z, n.x, n.y, n.z, uv.v, uv.w.
 */
function pullNormals(tmpKey, arr, vertexNum, offset = 3, stride = 8) {
  for ( let j = 0; j < 3; j += 1 ) tmpKey[j + offset] = arr[(vertexNum * stride) + 3 + j];
}

/**
 * Pull the 2 uv values for a given vertex and place in array.
 * Arrangement is x, y, z, n.x, n.y, n.z, uv.v, uv.w.
 */
function pullUVs(tmpKey, arr, vertexNum, offset = 6, stride = 8) {
  for ( let j = 0; j < 2; j += 1 ) tmpKey[j + offset] = arr[(vertexNum * stride) + 6 + j];
}
