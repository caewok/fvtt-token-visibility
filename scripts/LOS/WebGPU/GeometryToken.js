/* globals
canvas,
CONFIG,
PIXI,
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


import { combineTypedArrays } from "../util.js";

/**
 * Describe a token by its vertices, normals, and uvs.
 * By default, 1x1 token centered at origin 0,0,0.
 */
export class GeometryTokenDesc {
  /** @type {string} */
  label = "";

  /** @type {number} */
  numVertices = 36;

  /** @type {Float32Array[]} */
  verticesData = Array(1);

  /**
   * @param {object} [opts]
   * @param {string} [opts.label]     Label for this structure
   * @param {number} [opts.width]     Width of the token (in x direction)
   * @param {number} [opts.depth]     Depth of the token (in y direction)
   * @param {number} [opts.height]    Height of token (in z direction)
   * @param {boolean} [opts.directional]    If true, the wall will be one-sided.
   */
  constructor(opts = {}) {
    if ( opts.label ) this.label = opts.label;
    const w = (opts.width ?? 1) * 0.5;
    const d = (opts.height ?? 1) * 0.5
    const h = (opts.zHeight ?? 1) * 0.5;

    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const z = opts.z ?? 0;

    const arr = [
      // Position     Normal     UV
      // Side CCW if token goes from x-w to x+w.
      // S facing
      x+w, y+d, z+h,  0, 1, 0,  1, 0, // a
      x-w, y+d, z+h,  0, 1, 0,  0, 0, // b
      x-w, y+d, z-h,  0, 1, 0,  0, 1, // c
      x+w, y+d, z-h,  0, 1, 0,  1, 1, // d
      x+w, y+d, z+h,  0, 1, 0,  1, 0, // e
      x-w, y+d, z-h,  0, 1, 0,  0, 1, // f

      // N facing: reverse of South
      x-w, y-d, z-h,  0, -1, 0,  1, 1, // c
      x-w, y-d, z+h,  0, -1, 0,  1, 0, // b
      x+w, y-d, z+h,  0, -1, 0,  0, 0, // a
      x-w, y-d, z-h,  0, -1, 0,  1, 1, // f
      x+w, y-d, z+h,  0, -1, 0,  0, 0, // e
      x+w, y-d, z-h,  0, -1, 0,  0, 1, // d

      // W facing
      x-w, y+d, z+h,  -1, 0, 0,  1, 0, // a
      x-w, y-d, z+h,  -1, 0, 0,  0, 0, // b
      x-w, y-d, z-h,  -1, 0, 0,  0, 1, // c
      x-w, y+d, z-h,  -1, 0, 0,  1, 1, // d
      x-w, y+d, z+h,  -1, 0, 0,  1, 0, // e
      x-w, y-d, z-h,  -1, 0, 0,  0, 1, // f

      // E facing: reverse of West
      x+w, y-d, z-h,  1, 0, 0,  1, 1, // c
      x+w, y-d, z+h,  1, 0, 0,  1, 0, // b
      x+w, y+d, z+h,  1, 0, 0,  0, 0, // a
      x+w, y-d, z-h,  1, 0, 0,  1, 1, // f
      x+w, y+d, z+h,  1, 0, 0,  0, 0, // e
      x+w, y+d, z-h,  1, 0, 0,  0, 1, // d

      // Top
      x-w, y-d, z+h,  0, 0, 1,   0, 0,  // a
      x-w, y+d, z+h,  0, 0, 1,   0, 1,  // b
      x+w, y+d, z+h,  0, 0, 1,   1, 1,  // c
      x+w, y-d, z+h,  0, 0, 1,   1, 0,  // d
      x-w, y-d, z+h,  0, 0, 1,   0, 0,  // e
      x+w, y+d, z+h,  0, 0, 1,   1, 1,  // f

      // Bottom: reverse of Top
      x+w, y+d, z-h,  0, 0, -1,  1, 0,  // c
      x-w, y+d, z-h,  0, 0, -1,  0, 0,  // b
      x-w, y-d, z-h,  0, 0, -1,  0, 1,  // a
      x+w, y+d, z-h,  0, 0, -1,  1, 0,  // f
      x-w, y-d, z-h,  0, 0, -1,  0, 1,  // e
      x+w, y-d, z-h,  0, 0, -1,  1, 1,  // d
    ];

    /*
    Using Foundry world coordinates, where z is up, origin 0,0 is top right, y increases as it moves down.
    N and S are same as wall.

    Top and Bottom are same as tile except UV flipped for bottom
    uv
    0,0   1,0
    0,1   1,1

    uv flipped
    1,1   0,1
    1,0   0,0

    south
         x-w   x+w
    z+h  b      a,e
    y-h  c,f    d

    top
         x-w   x+w
    y-d  a,e    d
    y+d  b     c, f

    west
        y-d y+d
    z+h b    a,e
    z-h c,f  d

    east
        y+d   y-d
    z+h c,e   b
    z-h f     a,d

    bottom
        x-w   x+w
    y+d b      a,d
    y-d c,e    f

    */

    // For formats, see https://gpuweb.github.io/gpuweb/#enumdef-gpuvertexformat.
    // Each entry in verticesData corresponds to an entry in buffersLayout.
    // See https://webgpufundamentals.org/webgpu/lessons/webgpu-vertex-buffers.html
    // TODO: Use vertex buffer
    // TODO: Better way to define shaderLocation so it can be passed to the shader code?
    this.verticesData[0] = new Float32Array(arr);
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

/* Test for normal
Point3d = CONFIG.GeometryLib.threeD.Point3d
geom = new GeometryTokenDesc()
arr = geom.verticesData[0]
tris = [];
Ns = [];
orientation = [];
for ( let i = 0; i < arr.length; i += 8 ) {
  a = new Point3d(arr[i], arr[i + 1], arr[i + 2])

  i += 8;
  b = new Point3d(arr[i], arr[i + 1], arr[i + 2])

  i += 8;
  c = new Point3d(arr[i], arr[i + 1], arr[i + 2])
  tris.push([a, b, c]);

  deltaAB = b.subtract(a)
  deltaAC = c.subtract(a)
  Ns.push(deltaAB.cross(deltaAC).normalize())
}


*/

/* Test for normal
Point3d = CONFIG.GeometryLib.threeD.Point3d
x = 0
y = 0
z = 0
w = 0.5
h = 0.5

a = new Point3d(x+w, y, z+h)
b = new Point3d(x-w, y, z+h)
c = new Point3d(x-w, y, z-h)

a = new Point3d(x-w, y, z+h)
b = new Point3d(x+w, y, z+h)
c = new Point3d(x+w, y, z-h)

deltaAB = b.subtract(a)
deltaAC = c.subtract(a)
deltaAB.cross(deltaAC).normalize()

*/


export class GeometryTokenDescV2 {
  /** @type {string} */
  label = "";

  /** @type {number} */
  numVertices = 24;

  /** @type {Float32Array[]} */
  verticesData = Array(1);

  /** @type {Uint16Array[]} */
  indicesData = Array(1);

  /**
   * @param {object} [opts]
   * @param {string} [opts.label]     Label for this structure
   * @param {number} [opts.width]     Width of the token (in x direction)
   * @param {number} [opts.depth]     Depth of the token (in y direction)
   * @param {number} [opts.height]    Height of token (in z direction)
   * @param {boolean} [opts.directional]    If true, the wall will be one-sided.
   */
  constructor(opts = {}) {
    if ( opts.label ) this.label = opts.label;
    const w = (opts.width ?? 1) * 0.5;
    const d = (opts.height ?? 1) * 0.5
    const h = (opts.zHeight ?? 1) * 0.5;

    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const z = opts.z ?? 0;

    const indices = [
      0, 1, 2, 3, 0, 2,        // S facing 0–3
      4, 5, 6, 4, 6, 7,        // N facing 4–7
      8, 9, 10, 11, 8, 10,     // W facing 8–11
      12, 13, 14, 12, 14, 15,  // E facing 12–15
      16, 17, 18, 19, 16, 18,  // Top 16–19
      20, 21, 22, 20, 22, 23,  // Bottom 20–23
    ];

    const arr = [
      // Position     Normal     UV
      // Side CCW if token goes from x-w to x+w.
      // S facing
      x+w, y+d, z+h,  0, 1, 0,  1, 0, // a, e    0
      x-w, y+d, z+h,  0, 1, 0,  0, 0, // b       1
      x-w, y+d, z-h,  0, 1, 0,  0, 1, // c, f    2
      x+w, y+d, z-h,  0, 1, 0,  1, 1, // d       3

      // N facing: reverse of South. c,b,a,f,e,d
      x-w, y-d, z-h,  0, -1, 0,  1, 1, // c, f   4
      x-w, y-d, z+h,  0, -1, 0,  1, 0, // b      5
      x+w, y-d, z+h,  0, -1, 0,  0, 0, // a, e   6
      x+w, y-d, z-h,  0, -1, 0,  0, 1, // d      7

      // W facing
      x-w, y+d, z+h,  -1, 0, 0,  1, 0, // a, e   8
      x-w, y-d, z+h,  -1, 0, 0,  0, 0, // b      9
      x-w, y-d, z-h,  -1, 0, 0,  0, 1, // c, f   10
      x-w, y+d, z-h,  -1, 0, 0,  1, 1, // d      11

      // E facing: reverse of West c,b,a,f,e,d
      x+w, y-d, z-h,  1, 0, 0,  1, 1, // c, f     12
      x+w, y-d, z+h,  1, 0, 0,  1, 0, // b        13
      x+w, y+d, z+h,  1, 0, 0,  0, 0, // a, e     14
      x+w, y+d, z-h,  1, 0, 0,  0, 1, // d        15

      // Top
      x-w, y-d, z+h,  0, 0, 1,   0, 0,  // a, e   16
      x-w, y+d, z+h,  0, 0, 1,   0, 1,  // b      17
      x+w, y+d, z+h,  0, 0, 1,   1, 1,  // c, f   18
      x+w, y-d, z+h,  0, 0, 1,   1, 0,  // d      19

      // Bottom: reverse of Top c,b,a,f,e,d
      x+w, y+d, z-h,  0, 0, -1,  1, 0,  // c, f   20
      x-w, y+d, z-h,  0, 0, -1,  0, 0,  // b      21
      x-w, y-d, z-h,  0, 0, -1,  0, 1,  // a, e   22
      x+w, y-d, z-h,  0, 0, -1,  1, 1,  // d      23
    ];

    this.verticesData[0] = new Float32Array(arr);
    this.indicesData[0] = new Uint16Array(indices);
  }

  static indexFormat = "uint16";


  /**
   * Set the vertex buffer to render this geometry.
   * @param {GPURenderPassEncoder} renderPass
   * @param {GPUBuffer} [vertexBuffer]              The buffer that contains this geometry's vertex data
   * @param {number} [vertexOffset = 0]             Where on the buffer the data begins
   */
  setVertexBuffer(renderPass, vertexBuffer, offset = 0) {
    // NOTE: Using only slot 0 for now.
    renderPass.setVertexBuffer(0, vertexBuffer, offset, this.verticesData[0].byteLength)
  }

  /**
   * Set the index buffer to render this geometry.
   * @param {GPURenderPassEncoder} renderPass
   * @param {GPUBuffer} [vertexBuffer]              The buffer that contains this geometry's vertex data
   * @param {number} [vertexOffset = 0]             Where on the buffer the data begins
   */
  setIndexBuffer(renderPass, indexBuffer, offset = 0) {
    // NOTE: For other subclasses, can just return if not using index.
    renderPass.setIndexBuffer(indexBuffer, this.constructor.indexFormat, offset, this.indicesData[0].byteLength);
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
  draw(renderPass, { instanceCount = 1, firstInstance = 0, firstIndex = 0, baseVertex = 0 } = {}) {
    // NOTE: Using only slot 0 for now.
    renderPass.drawIndexed(this.indicesData[0].length, instanceCount, firstIndex, baseVertex, firstInstance);
  }
}

/**
 * Construct vertices for a token shape that is constrained.
 * Unlike GeometryTokenDesc, this constructs a token in world space.
 *
 */
export class GeometryConstrainedTokenDesc {
  /** @type {string} */
  label = "";

  /** @type {number} */
  numVertices = 36;

  /** @type {Float32Array[]} */
  verticesData = Array(1);

  /** @type {Uint16Array[]} */
  indicesData = Array(1);

  /**
   * @param {object} [opts]
   * @param {string} [opts.label]     Label for this structure
   * @param {number} [opts.width]     Width of the token (in x direction)
   * @param {number} [opts.depth]     Depth of the token (in y direction)
   * @param {number} [opts.height]    Height of token (in z direction)
   * @param {boolean} [opts.directional]    If true, the wall will be one-sided.
   */
  constructor(token, opts = {}) {
    if ( opts.label ) this.label = opts.label;
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const border = token.constrainedTokenBorder;
    const { topZ, bottomZ } = token;
    if ( border instanceof PIXI.Rectangle ) {
      const width = token.document.width * canvas.dimensions.size;
      const height = token.document.height * canvas.dimensions.size;
      const zHeight = topZ - bottomZ;
      const ctr = Point3d.fromTokenCenter(token);
      return new GeometryTokenDescV2({ width, height, zHeight, ...ctr });
    }

    const top = this.constructor.polygonTopBottomFaces(border, { elevation: topZ, top: true });
    const bottom = this.constructor.polygonTopBottomFaces(border, { elevation: bottomZ, top: false });
    const side = this.constructor.polygonSideFaces(border, { topElevation: topZ, bottomElevation: bottomZ });
    this.verticesData[0] = combineTypedArrays(top.vertices, side.vertices, bottom.vertices);
    // this.verticesData[0] = top.vertices;

    // For indices, increase because they are getting combined into one.
    side.indices = side.indices.map(elem => elem + top.numVertices);
    bottom.indices = bottom.indices.map(elem => elem + top.numVertices + side.numVertices);
    this.indicesData[0] = combineTypedArrays(top.indices, side.indices, bottom.indices);
    // this.indicesData[0] = top.indices;

    this.numVertices = Math.floor(top.numVertices + side.numVertices + bottom.numVertices);
    // this.numVertices = top.numVertices;
  }

  static indexFormat = "uint16";


  /**
   * Set the vertex buffer to render this geometry.
   * @param {GPURenderPassEncoder} renderPass
   * @param {GPUBuffer} [vertexBuffer]              The buffer that contains this geometry's vertex data
   * @param {number} [vertexOffset = 0]             Where on the buffer the data begins
   */
  setVertexBuffer(renderPass, vertexBuffer, offset = 0) {
    // NOTE: Using only slot 0 for now.
    renderPass.setVertexBuffer(0, vertexBuffer, offset, this.verticesData[0].byteLength)
  }

  /**
   * Set the index buffer to render this geometry.
   * @param {GPURenderPassEncoder} renderPass
   * @param {GPUBuffer} [vertexBuffer]              The buffer that contains this geometry's vertex data
   * @param {number} [vertexOffset = 0]             Where on the buffer the data begins
   */
  setIndexBuffer(renderPass, indexBuffer, offset = 0) {
    // NOTE: For other subclasses, can just return if not using index.
    renderPass.setIndexBuffer(indexBuffer, this.constructor.indexFormat, offset, this.indicesData[0].byteLength);
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
  draw(renderPass, { instanceCount = 1, firstInstance = 0, firstIndex = 0, baseVertex = 0 } = {}) {
    // NOTE: Using only slot 0 for now.
    renderPass.drawIndexed(this.indicesData[0].length, instanceCount, firstIndex, baseVertex, firstInstance);
  }

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
  static computeTotalVertexBufferOffsets(geoms, idx = 0) { // TODO: Do we need more than 1 buffer index?
    const out = {
      vertex: {
        offsets: new Uint16Array(geoms.length),
        sizes: new Uint16Array(geoms.length),
        lengths: new Uint16Array(geoms.length),
        totalLength: 0,
        totalSize: 0,
      },
      index: {
        offsets: new Uint16Array(geoms.length),
        sizes: new Uint16Array(geoms.length),
        lengths: new Uint16Array(geoms.length),
        totalLength: 0,
        totalSize: 0,
      }
    };
    for ( let i = 0, n = geoms.length; i < n; i += 1 ) {
      const geom = geoms[i];
      out.vertex.totalSize += out.vertex.sizes[i] = geom.verticesData[idx].byteLength;
      out.vertex.totalLength += out.vertex.lengths[i] = geom.numVertices;

      out.index.totalSize += out.index.sizes[i] = geom.indicesData[idx].byteLength;
      out.index.totalLength += out.index.lengths[i] = geom.indicesData[idx].length;
    }
    for ( let i = 1, n = geoms.length; i < n; i += 1 ) {
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
  static polygonTopBottomFaces(poly, { elevation = 0, top = true } = {}) {
     if ( !(poly instanceof PIXI.Polygon) ) poly = poly.toPolygon();

     // Because Foundry uses y- axis to move "up", CCW and CW will get flipped in WebGPU.
     const flip = top;

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

     // Earcut to determine indices. Then construct the vertices.
     const numVertices = Math.floor(poly.points.length / 2);
     const vertices = new Float32Array(numVertices * 8);
     const indices = new Uint16Array(PIXI.utils.earcut(poly.points));

     // For Foundry's y+ coordinate system, indices are always CCW triangles.
     // Flip to make CW if constructing the bottom face.
     if ( flip ) {
       for ( let i = 0, imax = indices.length; i < imax; i += 3 ) {
         const v0 = indices[i];
         const v2 = indices[i + 2];
         indices[i] = v2;
         indices[i + 2] = v0;
       }
     }

     // Set UVs to the coordinate within the bounding box.
     const xMinMax = Math.minMax(...poly.points.filter((_coord, idx) => idx % 2 === 0))
     const yMinMax = Math.minMax(...poly.points.filter((_coord, idx) => idx % 2 !== 0))
     const width = xMinMax.max - xMinMax.min;
     const height = yMinMax.max - yMinMax.min;

     const uOrig = x => (x - xMinMax.min) / width;
     const vOrig = y => (y - yMinMax.min) / height;
     let u = uOrig;
     let v = vOrig;
     let n = 1;
     if ( flip ) {
       n = -1;
       u = x => 1 - uOrig(x);
       v = y => 1 - vOrig(y);
     }
     let i = 0;
     for ( const pt of poly.iteratePoints({ closed: false }) ) {
       // Position
       vertices[i++] = pt.x;
       vertices[i++] = pt.y;
       vertices[i++] = elevation;

       // Normal: 0, 0, 1 or -1
       i++; i++;
       vertices[i++] = n;

       // UV
       vertices[i++] = u(pt.x);
       vertices[i++] = v(pt.y);
     }

     return { indices, vertices, numVertices };
  }

  /**
   * Return vertices for the sides of the polygon. Forms squares based on the polygon points.
   * @param {PIXI.Polygon} poly
   * @param {number} [opts.topElevation]     Elevation of the top face
   * @param {number} [opts.bottomElevation]  Elevation of the bottom face
   * @param {boolean} [opts.flip]         If true, treat as bottom face
   * @returns {object}
   * - @prop {Float32Array} vertices
   * - @prop {Uint16Array} indices
   */
  static polygonSideFaces(poly, { flip = false, topElevation = 0, bottomElevation = 0 } = {}) {
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
      // B.x, B.y, topElevation     nx, ny, nz      0, 0
      // A.x, A.y, topElevation     nx, ny, nz      0, 0
      // A.x, A.y, bottomElevation  nx, ny, nz      0, 0
      // B.x, B.y, bottomElevation  nx, ny, nz      0, 0
      // B.x, B.y, topElevation     nx, ny, nz      0, 0
      // A.x, A.y, bottomElevation  nx, ny, nz      0, 0

      a.set(A.x, A.y, topElevation);
      b.set(B.x, B.y, topElevation);
      c.set(A.x, A.y, bottomElevation);
      d.set(B.x, B.y, bottomElevation);

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

/* Test for normal
Point3d = CONFIG.GeometryLib.threeD.Point3d
poly = target.constrainedTokenBorder
geom = GeometryConstrainedTokenDesc.polygonTopVertices(poly, { flip: false })

tris = [];
Ns = [];
orientations = [];
vs = geom.vertices;
for ( let i = 0; i < geom.indices.length; i += 3 ) {
  let j = geom.indices[i] * 8;
  const a = new Point3d(vs[j], vs[j + 1], vs[j + 2])

  j = geom.indices[i+1] * 8;
  const b = new Point3d(vs[j], vs[j + 1], vs[j + 2])

  j = geom.indices[i+2] * 8;
  const c = new Point3d(vs[j], vs[j + 1], vs[j + 2])

  tris.push([a, b, c]);

  deltaAB = b.subtract(a)
  deltaAC = c.subtract(a)
  Ns.push(deltaAB.cross(deltaAC).normalize())
  orientations.push(foundry.utils.orient2dFast(a, b, c));
}

tris.forEach(tri => Draw.connectPoints(tri))
tris.forEach(tri => tri.forEach(pt => Draw.point(pt, { radius: 2 })))


*/




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