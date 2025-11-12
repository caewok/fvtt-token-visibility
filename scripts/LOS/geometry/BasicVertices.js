/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { combineTypedArrays } from "../util.js";
import { Point3d } from "../../geometry/3d/Point3d.js";
import { MatrixFlat } from "../../geometry/MatrixFlat.js";
import { Draw } from "../../geometry/Draw.js";
import { Triangle3d } from "../../geometry/3d/Polygon3d.js";
import { ClipperPaths } from "../../geometry/ClipperPaths.js";
import { Clipper2Paths } from "../../geometry/Clipper2Paths.js";

const N = -0.5
const S = 0.5;
const W = -0.5;
const E = 0.5;
const T = 0.5;
const B = -0.5;

export class BasicVertices {
  /** @type {number} */
  static NUM_VERTEX_ELEMENTS = 8; // 3 position, 3 normal, 2 uv.

  static NUM_TRIANGLE_ELEMENTS = 3 * this.NUM_VERTEX_ELEMENTS;

  static unitRectangle = new PIXI.Rectangle(-0.5, -0.5, 1, 1);

  /**
   * Given an array of vertex information, flip orientation. I.e., ccw --> cw. Flips in place.
   * E.g., if the bottom has vertices 0, 1, 2, switch to 2, 1, 0.
   * @param {Float32Array} vertices
   * @param {number} [stride=8]       The number of elements representing each vertex
   * @returns {Float32Array} The same array, modified
   */
  static flipVertexArrayOrientation(vertices, stride = this.NUM_VERTEX_ELEMENTS) {
    const v1_offset = stride;     // 8
    const v2_offset = stride * 2; // 16
    const v3_offset = stride * 3; // 24
    const sliceFn = Array.isArray(vertices) ? "slice" : "subarray";
    for ( let i = 0, iMax = vertices.length; i < iMax; i += v3_offset ) {
      // v0: k, v1: k + 8, v2: k + 16, v3: k + 24.
      const tmp = vertices.slice(i, i + v1_offset); // Must be slice to avoid modifying in place.
      vertices.set(vertices[sliceFn](i + v2_offset, i + v3_offset), i);
      vertices.set(tmp, i + v2_offset);
    }
    return vertices;
  }

  /**
   * Convert a set of vertices to a specific world position using a 4x4 matrix.
   * It is assumed that the vertex position is first in the array: x, y, z, ...
   * @param {Float32Array} vertices
   * @param {MatrixFlat} M
   * @param {number} [stride=8]       The number of elements representing each vertex
   * @returns {Float32Array} The vertices, modified in place
   */
  static transformVertexPositions(vertices, M, stride = this.NUM_VERTEX_ELEMENTS) {
    const pt = Point3d.tmp;
    for ( let i = 0, iMax = vertices.length; i < iMax; i += stride ) {
      pt.set(vertices[i], vertices[i+1], vertices[i+2]);
      M.multiplyPoint3d(pt, pt);
      vertices.set([...pt], i);
    }
    pt.release();
    return vertices;
  }

  static transformMatrixFromRectangle(rect, { rotateM, outMatrix, topZ = T, bottomZ = B} = {}) {
    rotateM ??= MatrixFlat.identity(4, 4);
    outMatrix ??= MatrixFlat.empty(4, 4);

    const zHeight = topZ - bottomZ;
    const z = bottomZ + (zHeight * 0.5);
    const ctr = rect.center;

    const scaleM = MatrixFlat.scale(rect.width, rect.height, zHeight);
    const translateM = MatrixFlat.translation(ctr.x, ctr.y, z);
    return scaleM.multiply4x4(rotateM, outMatrix).multiply4x4(translateM, outMatrix);
  }

  static isUnitRectangle(rect) {
    return rect.x === -0.5
      && rect.y === -0.5
      && rect.width === 1
      && rect.height === 1;
  }

  /**
   * Trim an array of vertices, removing duplicates and defining indices to match.
   * @param {number[]|Float32Array} arr      1D array of vertices
   * @param {object} [opts]
   * @param {}
   * @returns {object}
   * - @prop {Float32Array} vertices
   * - @prop {Uint16Array} indices
   */
  static trimVertexData(arr, { addNormals = false, addUVs = false } = {}) {
    const stride = 3 + (3 * addNormals) + (2 * addUVs);
    const vertices = this.trimNormalsAndUVs(arr, { keepNormals: addNormals, keepUVs: addUVs });
    return this.condenseVertexData(vertices, { stride });
  }

  static condenseVertexData(vertices, { stride = 3 } = {}) {
    // For given array of vertices, create indices and remove duplicate vertices.
    const vLen = vertices.length;
    const nVertices = Math.floor(vertices.length / stride);
    const indices = new Uint16Array(nVertices);
    const sliceFn = Array.isArray(vertices) ? "slice" : "subarray";

    // Cannot use resizable buffer with WebGL2 bufferData.
    // Instead, construct a maximum-length array buffer and copy it over later once we know how
    // many vertices were copied over.
    // (Could use resizable and transfer later but little point here)
    const maxByteLength = vertices.byteLength || (Float32Array.BYTES_PER_ELEMENT * vertices.length);
    const buffer = new ArrayBuffer(maxByteLength);
    const newVertices = new Float32Array(buffer, 0, vLen);

    // For each vertex, determine if it has been seen before.
    // If seen, get the original index, otherwise add this one to the tracking set.
    // Set the index accordingly and copy over the vertex data if necessary.
    const uniqueV = new Map();
    for ( let v = 0, i = 0; v < vLen; v += stride, i += 1 ) {
      const dat = vertices[sliceFn](v, v + stride);
      const key = dat.join("_");
      if ( !uniqueV.has(key) ) {
        const offset = uniqueV.size;
        newVertices.set(dat, offset * stride);
        uniqueV.set(key, offset);
      }
      indices[i] = uniqueV.get(key);
    }

    // Copy the vertices to a new buffer.
    const byteLength = uniqueV.size * stride * Float32Array.BYTES_PER_ELEMENT;
    const newBuffer = buffer.transferToFixedLength(byteLength);

    return {
      indices,
      vertices: new Float32Array(newBuffer),
      numVertices: uniqueV.size,
      stride,
    };
  }

  /**
   * For given vertices and indices arrays, expand the vertices array so that the index is not required.
   *
   * @param {Uint16Array} indices
   * @param {Float32Array} vertices
   * @returns {Float32Array} Array containing one vertex for each index.
   */
  static expandVertexData(indices, vertices, { stride = 3, outArr } = {}) {
    const nVertices = indices.length
    outArr ??= new Float32Array(nVertices * stride);
    const sliceFn = Array.isArray(vertices) ? "slice" : "subarray";

    for ( let i = 0, j = 0; i < nVertices; i += 1, j += stride ) {
      const idx = indices[i] * stride;
      outArr.set(vertices[sliceFn](idx, idx + stride), j)
    }
    return outArr;
  }

  /**
   * For a vertex of [position (3), normal (3), uv (2), ...],
   * drop the normals, uvs, or both.
   * @param {Float32Array} arr
   * @param {object} [opts]
   * @param {boolean} [opts.keepNormals=false]
   * @param {boolean} [opts.keepUVs=false]
   * @returns {Float32Array} Same array if both are kept; new array otherwise
   */
  static trimNormalsAndUVs(arr, { keepNormals = false, keepUVs = false, outArr } = {}) {
    if ( keepNormals && keepUVs ) {
      if ( !outArr ) return arr;
      outArr.set(arr);
      return outArr;
    }

    const stride = 8;
    const newStride = 3 + (3 * keepNormals) + (2 * keepUVs);
    const oldLn = arr.length;
    const nVertices = Math.floor(oldLn / stride);
    outArr ??= new Float32Array(nVertices * newStride);
    const sliceFn = Array.isArray(arr) ? "slice" : "subarray";

    let pullFn;
    switch ( newStride ) {
      case 3: pullFn = (oldOffset, newOffset) => outArr.set(arr[sliceFn](oldOffset, oldOffset + 3), newOffset); break; // Position
      case 5: pullFn = (oldOffset, newOffset) => {
        outArr.set(arr[sliceFn](oldOffset, oldOffset + 3), newOffset); // Position
        outArr.set(arr[sliceFn](oldOffset + 6, oldOffset + 8), newOffset + 3); // UV
      }; break;
      case 6: pullFn = (oldOffset, newOffset) => outArr.set(arr[sliceFn](oldOffset, oldOffset + 6), newOffset); break; // Position + normal
      // case 8 handled by early return.
      default: console.error("trimNormalsAndUVs|stride length not recognized", { arr, newStride });
    }
    for ( let i = 0, j = 0; i < oldLn; i += stride, j += newStride ) pullFn(i, j);
    return outArr;
  }

  /**
   * For an array of vertices, copy to new, presumably larger, array.
   * @param {Float32Array|number[]} vertices          An array of vertices to copy
   * @param {number} [stride=3]                       The stride of the original vertices array
   * @param {number|Float32Array} outArr              The stride of the new array or a new array
   * @returns {Float32Array} The out array
   */
  static copyVerticesToArray(vertices, { stride = 3, outArr } = {}) {
    const vLength = vertices.length;
    const nVertices = Math.floor(vLength / stride);
    const sliceFn = Array.isArray(vertices) ? "slice" : "subarray";

    // Build the new array.
    if ( !outArr ) outArr = stride + 3;
    if ( Number.isNumeric(outArr) ) outArr = new Float32Array(nVertices * outArr);
    const newStride = Math.floor(outArr.length / nVertices);
    if ( newStride < stride ) console.error("copyVerticesToArray|New array stride not large enough", { vertices, stride, outArr });

    // Copy each vertex to the new array.
    for ( let i = 0, j = 0; i < vLength; i += stride, j += newStride ) outArr.set(vertices[sliceFn](i, i + stride), j);
    return outArr;
  }

  /**
   * For an array of vertices, add normals to each.
   * @param {Float32Array|number[]} vertices               An array of vertices to which to append normals
   * @param {number[3]} [normal=[0,0,1]]              The normal to add
   * @param {number} [stride=3]                       The stride of the vertices array
   * @param {number|Float32Array} outArr              The stride of the new array or a new array
   * @returns {Float32Array} Array of vertices with normal appended to each
   */
  static appendNormals(vertices, { normal = [0, 0, 1], ...opts } = {}) {
    opts.newData = normal;
    return this.appendToVertexArray(vertices, opts);
  }

  static appendToVertexArray(vertices, { newData = [], stride = 3, offset, outArr } = {}) {
    if ( !newData.length ) return vertices;
    offset ??= stride;
    const nVertices = Math.floor(vertices.length / stride);

    // Build the new array if needed.
    if ( !outArr ) outArr = stride + newData.length;
    if ( Number.isNumeric(outArr) ) outArr = this.copyVerticesToArray(vertices, { stride, outArr });
    const newStride = Math.floor(outArr.length / nVertices);

    // Add in the data.
    for ( let i = offset, iMax = outArr.length; i < iMax; i += newStride ) outArr.set(newData, i)
    return outArr;
  }

  /**
   * For an array of vertices, add UVs to each.
   * @param {Float32Array|number[]} arr               An array of vertices to which to append normals
   * @param {number} [stride=3]                       The stride of the array
   * @param {Float32Array} outArr                     If provided, assumed arr has already been copied.
   * @returns {Float32Array} New array of vertices with normal appended to each
   */
  static appendUVs(vertices, { stride = 5, outArr = 5, offset, bounds } = {}) {
    offset ??= stride;
    const origLn = vertices.length;
    const nVertices = Math.floor(origLn / stride);

    // Build the new array if needed.
    if ( Number.isNumeric(outArr) ) outArr = this.copyVerticesToArray(vertices, { stride, outArr });
    const newStride = Math.floor(outArr.length / nVertices);

    // Set UVs to the coordinate within the bounding box.
    let xMinMax;
    let yMinMax;
    if ( bounds ) {
      xMinMax = { min: bounds.x, max: bounds.x + bounds.width };
      yMinMax = { min: bounds.y, max: bounds.y + bounds.height };
    } else {
      // Calculate bounds from the vertex x,y data.
      const xs = new Float32Array(nVertices);
      const ys = new Float32Array(nVertices);
      for ( let i = 0, j = 0; i < origLn; i += stride, j += 1 ) {
        xs[j] = vertices[i];
        ys[j] = vertices[i + 1];
      }
      xMinMax = Math.minMax(...xs);
      yMinMax = Math.minMax(...ys);
    }

    const widthInv = 1 / (xMinMax.max - xMinMax.min);
    const heightInv = 1 / (yMinMax.max - yMinMax.min);
    for ( let i = 0, j = offset; i < origLn; i += stride, j += newStride ) {
      const x = vertices[i];
      const y = vertices[i+1];
      outArr[j] = (x - xMinMax.min) * widthInv;
      outArr[j+1] = (y - yMinMax.min) * heightInv;
    }
    return outArr;
  }


  static debugDraw(vertices, indices, { draw, omitAxis = "z", addNormals = false, addUVs = false, ...opts} = {}) {
    draw ??= new Draw();
    const triangles = this.toTriangles(vertices, indices, { addNormals, addUVs });
    triangles.forEach(tri => tri.draw2d({ draw, omitAxis, ...opts }));
    return triangles;
  }

  static toTriangles(vertices, indices, { addNormals = false, addUVs = false } = {}) {
    indices ??= Array.fromRange(vertices.length);
    const offset = 3 + (addNormals * 3) + (addUVs * 2);

    const triangles = Array(indices.length / 3 );
    const a = Point3d.tmp;
    const b = Point3d.tmp;
    const c = Point3d.tmp;
    for ( let i = 0, j = 0, iMax = indices.length; i < iMax;) {
      const idx1 = indices[i++] * offset;
      const idx2 = indices[i++] * offset;
      const idx3 = indices[i++] * offset;

      a.set(vertices[idx1], vertices[idx1+1], vertices[idx1+2]);
      b.set(vertices[idx2], vertices[idx2+1], vertices[idx2+2]);
      c.set(vertices[idx3], vertices[idx3+1], vertices[idx3+2]);
      triangles[j++] = Triangle3d.from3Points(a, b, c);
    }
    Point3d.release(a, b, c);
    return triangles;
  }
}

export class HorizontalQuadVertices extends BasicVertices {

  static NUM_FACE_ELEMENTS = 2 * this.NUM_TRIANGLE_ELEMENTS;

  static buffers = {
    up: new ArrayBuffer(this.NUM_FACE_ELEMENTS * Float32Array.BYTES_PER_ELEMENT),
    down: new ArrayBuffer(this.NUM_FACE_ELEMENTS * Float32Array.BYTES_PER_ELEMENT),
    double: new ArrayBuffer(2 * this.NUM_FACE_ELEMENTS * Float32Array.BYTES_PER_ELEMENT),
    doubleUp: new ArrayBuffer(2 * this.NUM_FACE_ELEMENTS * Float32Array.BYTES_PER_ELEMENT),
  };

  static top = new Float32Array([
    // Position     Normal      UV
    W, N, T,        0, 0, 1,    0, 0,
    W, S, T,        0, 0, 1,    0, 1,
    E, S, T,        0, 0, 1,    1, 1,

    E, N, T,        0, 0, 1,    1, 0,
    W, N, T,        0, 0, 1,    0, 0,
    E, S, T,        0, 0, 1,    1, 1,
  ]);

  static bottom = new Float32Array([
    // Position     Normal      UV
    E, S, B,        0, 0, -1,   1, 0,
    W, S, B,        0, 0, -1,   0, 0,
    W, N, B,        0, 0, -1,   0, 1,

    E, S, B,        0, 0, -1,   1, 0,
    W, N, B,        0, 0, -1,   0, 1,
    E, N, B,        0, 0, -1,   1, 1,
  ]);

  // For tiles, face the texture up, not down as normally expected.
  static bottomUp = new Float32Array([
    // Position     Normal      UV
    E, S, B,        0, 0, -1,   1, 1,
    W, S, B,        0, 0, -1,   0, 1,
    W, N, B,        0, 0, -1,   0, 0,

    E, S, B,        0, 0, -1,   1, 1,
    W, N, B,        0, 0, -1,   0, 0,
    E, N, B,        0, 0, -1,   1, 0,
  ]);

  static vertices = {
    up: setFloatView(this.top, this.buffers.up),
    down: setFloatView(this.bottom, this.buffers.down),
    double: setFloatView([...this.top, ...this.bottom], this.buffers.double),
    doubleUp: setFloatView([...this.top, ...this.bottomUp], this.buffers.doubleUp),
  };

  static calculateVertices(rect, { type = "up", topZ = T, bottomZ = B } = {}) {
    rect ??= this.unitRectangle; // Unit rectangle centered at 0,0.

    if ( this.isUnitRectangle(rect) && topZ === T && bottomZ === B ) return this.vertices[type];

    // Convert the unit rectangle to match rect
    const M = this.transformMatrixFromRectangle(rect);
    const vertices = new Float32Array(this.vertices[type]); // Clone vertices before transform.
    return this.transformVertexPositions(vertices, M);
  }
}

export class VerticalQuadVertices extends BasicVertices {

  static NUM_FACE_ELEMENTS = 2 * this.NUM_TRIANGLE_ELEMENTS;

  static buffers = {
    north: new ArrayBuffer(this.NUM_FACE_ELEMENTS * Float32Array.BYTES_PER_ELEMENT),
    south: new ArrayBuffer(this.NUM_FACE_ELEMENTS * Float32Array.BYTES_PER_ELEMENT),
    double: new ArrayBuffer(2 * this.NUM_FACE_ELEMENTS * Float32Array.BYTES_PER_ELEMENT),
  }

  static DIRECTIONS = {
    double: "double",
    south: "south",
    north: "north",
    directional: "north",
    left: "north",
    right: "south",

    // CONST.WALL_DIRECTIONS
    0: "double", // NONE
    1: "north",  // LEFT
    2: "south",  // RIGHT

    BOTH: "double",
    LEFT: "north",
    RIGHT: "south",
  };

  // On the y = 0 line.
  // When a --> b is on the y line from -x to +x:
  //   - left: light from left (north) is blocked
  //   - right: light from right (south) is blocked
  static south = new Float32Array([
    // Position     Normal      UV
    E, 0, T,        0, 1, 0,    1, 0,
    W, 0, T,        0, 1, 0,    0, 0,
    W, 0, B,        0, 1, 0,    0, 1,

    E, 0, B,        0, 1, 0,    1, 1,
    E, 0, T,        0, 1, 0,    1, 0,
    W, 0, B,        0, 1, 0,    0, 1,
  ]);

  static north = new Float32Array([
    // Position     Normal      UV
    W, 0, B,        0, -1, 0,    1, 1,
    W, 0, T,        0, -1, 0,    1, 0,
    E, 0, T,        0, -1, 0,    0, 0,

    W, 0, B,        0, -1, 0,    1, 1,
    E, 0, T,        0, -1, 0,    0, 0,
    E, 0, B,        0, -1, 0,    0, 1,
  ]);

  static vertices = {
    north: setFloatView(this.north, this.buffers.north),
    south: setFloatView(this.north, this.buffers.south),
    double: setFloatView([...this.north, ...this.south], this.buffers.double),
  };

  static calculateVertices(a, b, { type = "double", topZ = T, bottomZ = B } = {}) {
    type = this.DIRECTIONS[type];

    const unitA = PIXI.Point.tmp.set(-0.5, 0);
    const unitB = PIXI.Point.tmp.set(0.5, 0)
    a ??= unitA
    b ??= unitB
    if ( unitA.equals(a)
      && unitB.equals(b)
      && topZ === T
      && bottomZ === B ) {
      PIXI.Point.release(a, b);
      return this.vertices[type];
    }

    // Convert unit edge to match this edge.
    const M = this.transformMatrixFromSegment(a, b, { topZ, bottomZ });
    const vertices = new Float32Array(this.vertices[type]); // Clone vertices before transform.
    PIXI.Point.release(a, b);
    return this.transformVertexPositions(vertices, M);
  }

  static transformMatrixFromSegment(a, b, { topZ = T, bottomZ = B, rotate = 0, outMatrix } = {}) {
    outMatrix ??= MatrixFlat.empty(4, 4);

    // Scale by absolute z-length (vertical height).
    // If the topZ and bottomZ are unbalanced, translate in the z direction to reset topZ to correct elevation.
    // (scale - topZ)
    // e.g. elev 20, -100. zHeight = 120. Untranslated topZ would be 120/2 = 60. Move 20 - 60 = -40.
    const zHeight = topZ - bottomZ;
    const z = topZ - (zHeight * 0.5);

    const dy = b.y - a.y;
    const dx = b.x - a.x;
    const radians = Math.atan2(dy, dx) + rotate;
    const center = new PIXI.Point(a.x + (dx / 2), a.y + (dy / 2));
    const length = PIXI.Point.distanceBetween(a, b);

    // Build transform matrix.
    const scaleM = MatrixFlat.scale(length, 1, zHeight);
    const translateM = MatrixFlat.translation(center.x, center.y, z);
    const rotateM = MatrixFlat.rotationZ(radians);
    return scaleM.multiply4x4(rotateM, outMatrix).multiply4x4(translateM, outMatrix);
  }
}

export class Rectangle3dVertices extends BasicVertices {
  static NUM_FACES = 6;

  static NUM_FACE_ELEMENTS = 2 * this.NUM_TRIANGLE_ELEMENTS;

  static verticesBuffer = new ArrayBuffer(this.NUM_FACES * this.NUM_FACE_ELEMENTS * Float32Array.BYTES_PER_ELEMENT);

  static vertices = new Float32Array(this.verticesBuffer);

  static top = setFloatView(HorizontalQuadVertices.top, this.verticesBuffer, this.NUM_FACE_ELEMENTS * 0);

  static bottom = setFloatView(HorizontalQuadVertices.bottom, this.verticesBuffer, this.NUM_FACE_ELEMENTS * 1);
//   static top = setFloatView([
//     // Position     Normal      UV
//     W, N, T,        0, 0, 1,    0, 0,
//     W, S, T,        0, 0, 1,    0, 1,
//     E, S, T,        0, 0, 1,    1, 1,
//
//     E, N, T,        0, 0, 1,    1, 0,
//     W, N, T,        0, 0, 1,    0, 0,
//     E, S, T,        0, 0, 1,    1, 1,
//   ], this.verticesBuffer, this.NUM_FACE_ELEMENTS * 0);

//   static bottom = setFloatView([
//     // Position     Normal      UV
//     E, S, B,        0, 0, -1,   1, 0,
//     W, S, B,        0, 0, -1,   0, 0,
//     W, N, B,        0, 0, -1,   0, 1,
//
//     E, S, B,        0, 0, -1,   1, 0,
//     W, N, B,        0, 0, -1,   0, 1,
//     E, N, B,        0, 0, -1,   1, 1,
//   ], this.verticesBuffer, this.NUM_FACE_ELEMENTS * 1);

  static sides = {
    all: new Float32Array(this.verticesBuffer, this.NUM_FACE_ELEMENTS * 2 * Float32Array.BYTES_PER_ELEMENT, this.NUM_FACE_ELEMENTS),
    north: setFloatView([
      // Position     Normal      UV
      W, N, B,        0, -1, 0,   1, 1,
      W, N, T,        0, -1, 0,   1, 0,
      E, N, T,        0, -1, 0,   0, 0,

      W, N, B,        0, -1, 0,   1, 1,
      E, N, T,        0, -1, 0,   0, 0,
      E, N, B,        0, -1, 0,   0, 1,
    ], this.verticesBuffer, this.NUM_FACE_ELEMENTS * 2),

    south: setFloatView([
      // Position     Normal      UV
      E, S, T,        0, 1, 0,   1, 0,
      W, S, T,        0, 1, 0,   0, 0,
      W, S, B,        0, 1, 0,   0, 1,

      E, S, B,        0, 1, 0,   1, 1,
      E, S, T,        0, 1, 0,   1, 0,
      W, S, B,        0, 1, 0,   0, 1,
    ], this.verticesBuffer, this.NUM_FACE_ELEMENTS * 3),

    east: setFloatView([
      // Position     Normal      UV
      E, N, B,        1, 0, 0,   1, 1,
      E, N, T,        1, 0, 0,   1, 0,
      E, S, T,        1, 0, 0,   0, 0,

      E, N, B,        1, 0, 0,   1, 1,
      E, S, T,        1, 0, 0,   0, 0,
      E, S, B,        1, 0, 0,   0, 1,
    ], this.verticesBuffer, this.NUM_FACE_ELEMENTS * 4),

    west: setFloatView([
      // Position     Normal      UV
      W, S, T,        -1, 0, 0,   1, 0,
      W, N, T,        -1, 0, 0,   0, 0,
      W, N, B,        -1, 0, 0,   0, 1,

      W, S, B,        -1, 0, 0,   1, 1,
      W, S, T,        -1, 0, 0,   1, 0,
      W, N, B,        -1, 0, 0,   0, 1,
    ], this.verticesBuffer, this.NUM_FACE_ELEMENTS * 5),
  }

  // NOTE: If desired, could pass a rotation or rotation matrix.
  static calculateVertices(rect, { topZ = T, bottomZ = B } = {}) {
    rect ??= this.unitRectangle;
    if ( this.isUnitRectangle(rect) && topZ === T && bottomZ === B ) return this.vertices;

    // Convert the unit rectangle to match rect.
    const M = this.transformMatrixFromRectangle(rect);
    const vertices = new Float32Array(this.vertices); // Clone vertices before transform.
    return this.transformVertexPositions(vertices, M);
  }
}

export class Polygon3dVertices extends BasicVertices {

  static isClipper(poly) { return poly instanceof ClipperPaths || poly instanceof Clipper2Paths; }

  static NUM_TRIANGLE_ELEMENTS = 3 * this.NUM_VERTEX_ELEMENTS;

/*
  •--•
 /    \
 • •  •
 |    |
 •----•

Ex: 6 points, 6 outer edges.
    Fan creates 6 triangles, 1 per outer edge.
    So poly.points * 1/2 * triangle length is total length.
*/

  static topLength(poly) {
    if ( this.isClipper(poly) ) console.error("topLength cannot take a clipper path")
    return Math.floor(this.NUM_TRIANGLE_ELEMENTS * poly.points.length * 0.5);
  } // For fan only. Earcut should be this or less.

  static sidesLength(poly) {
    // Each polygon or polygon hole will need corresponding rectangular sides.
    if ( this.isClipper(poly) ) return poly.toPolygons().reduce((acc, curr) =>
      acc + this.sidesLength(curr), 0);
    return Math.floor(this.NUM_TRIANGLE_ELEMENTS * poly.points.length);
  } // Number of points (x,y) * 2

  /**
   * Determine the 3d vertices for a given ClipperPaths or polygon.
   * The polygon represents the top and bottom of the shape, using rectangular side faces.
   * @param {PIXI.Polygon|ClipperPaths|ClipperPaths2} poly
   * @param {object} [opts]
   * @param {number} [opts.topZ=T]        Top elevation
   * @param {number} [opts.bottomZ=B]     Botom elevation
   * @param {boolean} [opts.useFan]       Force fan or force no fan
   * @param {PIXI.Point} [opts.centroid]  The center of the polygon
   * @returns {Float32Array} The vertices, untrimmed
   */
  static calculateVertices(poly, { topZ = T, bottomZ = B, useFan, centroid } = {}) {
    let bounds;
    let center;

    // Attempt to convert various shapes to a polygon.
    if ( this.isClipper(poly) ) poly = poly.simplify();
    if ( poly instanceof PIXI.Rectangle
      || poly instanceof PIXI.Ellipse
      || poly instanceof PIXI.Circle ) {
      bounds = poly.getBounds();
      center = poly.center;
      poly = poly.toPolygon();
   }

    useFan ??= this.canUseFan(poly, centroid);
    if ( useFan ) {
      // At this point, the shape should be a polygon.
      if ( !(poly instanceof PIXI.Polygon) ) console.error("calculateVertices|Polygon is not a PIXI.Polygon", poly);
      const { vertices, top, bottom, sides } = this.buildVertexBufferViews(this.topLength(poly), this.sidesLength(poly));
      bounds ??= poly.getBounds();
      center ??= poly.center;
      const opts = { top, bottom, sides, bounds, center, topZ, bottomZ }
      this.polygonTopBottomFacesFan(poly, opts);
      this.polygonSideFaces(poly, opts);
      return vertices;
    }

    // Shape could be a more complex polygon or ClipperPaths.

    // The top/bottom face lengths may vary due to earcut. Calculate first.
    const { top, bottom } = this.polygonTopBottomFaces(poly, { topZ, bottomZ });
    const res = this.buildVertexBufferViews(top.length, this.sidesLength(poly));
    res.top.set(top);
    res.bottom.set(bottom);
    this.polygonSideFaces(poly, { topZ, bottomZ, sides: res.sides });
    return res.vertices;
  }

  static buildVertexBufferViews(topLength, sidesLength) {
    const totalLength = topLength + topLength + sidesLength;
    const buffer = new ArrayBuffer(totalLength * Float32Array.BYTES_PER_ELEMENT);
    const vertices = new Float32Array(buffer, 0, totalLength);
    const top = new Float32Array(buffer, 0, topLength);
    const bottom = new Float32Array(buffer, topLength * Float32Array.BYTES_PER_ELEMENT, topLength);
    const sides = new Float32Array(buffer, topLength * 2 * Float32Array.BYTES_PER_ELEMENT, sidesLength);
    return { vertices, top, bottom, sides };
  }

  /**
   * Test if an arbitrary polygon can use a fan instead of earcut to triangulate.
   * Fan creates triangles in a fan shape where two vertices are on the edge and the third is the centroid.
   * Works for all convex polygons and some concave polygons.
   * @param {PIXI.Polygon} poly
   * @returns {boolean}
   */
  static canUseFan(poly, centroid) {
    if ( poly instanceof PIXI.Rectangle
      || poly instanceof PIXI.Ellipse
      || poly instanceof PIXI.Circle ) return true;

    // Test Clipper shapes, as could be a regular polygon.
    if ( this.isClipper(poly) ) {
      poly = poly.simplify();
      if ( poly instanceof PIXI.Rectangle ) return true;
    }
    if ( !(poly instanceof PIXI.Polygon) ) return false;

    // Test that the segment between centroid and polygon point does not intersect another edge.
    centroid ??= poly.center;
    if ( !poly.contains(centroid.x, centroid.y) ) return false;
    const lines = [...poly.iteratePoints({ close: false })].map(B => {
      return { A: centroid, B };
    });
    return !poly.linesCross(lines); // Lines cross ignores lines that only share endpoints.
  }

  static polygonTopBottomFacesFan(poly, { bounds, center, top, bottom, topZ = T, bottomZ = B } = {}) {
    if ( this.isClipper(poly) ) poly = poly.simplify();
    if ( poly.isHole ^ poly.isClockwise ) poly.reverseOrientation();

    top ??= new Float32Array(this.topLength(poly));
    bottom ??= new Float32Array(top.length);
    bounds ??= poly.getBounds();
    center ??= poly.center;

    const normalTop = [0, 0, 1];
    const normalBottom = [0, 0, -1];

    // Start by copy the x,y from the polygon to an array with 8 vertex "slots" per vertex.
    // Copy the center and two points of the polygon to the array.
    // Triangles should match poly orientation (typically ccw). If poly is ccw, triangles will be ccw.
    center = [center.x, center.y];
    const ln = poly.points.length;
    let a = poly.points.slice(ln - 2, ln); // i, i + 2 for the very last point; cycle through to beginning.
    for ( let i = 0, j = 0; i < ln; ) {
      top.set(center, j);
      bottom.set(center, j);
      j += 8;

      top.set(a, j);
      bottom.set(a, j);
      j += 8;

      const b = poly.points.slice(i, i + 2);
      top.set(b, j);
      bottom.set(b, j);
      i += 2; j += 8; // Only increment i once; next triangle shares one point (and center) with this one.
      a = b;
    }

    // Add in elevation in place.
    // Note that after copyVerticesToArray, the stride is now 8.
    this.appendToVertexArray(top, { newData: [topZ], stride: 8, offset: 2, outArr: top });
    this.appendToVertexArray(bottom, { newData: [bottomZ], stride: 8, offset: 2, outArr: bottom });

    // Add in Normals in place.
    this.appendNormals(top, { normal: normalTop, stride: 8, offset: 3, outArr: top });
    this.appendNormals(bottom, { normal: normalBottom, stride: 8, offset: 3, outArr: bottom });

    // Add in UVs in place.
    this.appendUVs(top, { bounds, stride: 8, offset: 6, outArr: top });
    this.appendUVs(bottom, { bounds, stride: 8, offset: 6, outArr: bottom });

    // Flip the bottom.
    this.flipVertexArrayOrientation(bottom)
    return { top, bottom };
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
  static polygonTopBottomFaces(poly, { topZ = T, bottomZ = B } = {}) {
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

    let vertices2d;
    let holes = [];

    // Earcut to determine indices. Then construct the vertices.
    if ( this.isClipper(poly) ) {
      // Assume a more complex shape, possibly with holes. See ClipperPaths.prototype.earcut.
      const coords = poly.toEarcutCoordinates();
      vertices2d = coords.vertices;
      holes = coords.holes;
    } else {
      if ( !(poly instanceof PIXI.Polygon) ) poly = poly.toPolygon();
      if ( poly.isHole ^ poly.isClockwise ) poly.reverseOrientation();
      vertices2d = poly.points;
    }

    // Earcut the polygon to determine the indices and construct empty arrays to hold top and bottom vertex information.
    const indices = new Uint16Array(PIXI.utils.earcut(vertices2d, holes)); // Note: dimensions = 2.

    /* Testing
    // Draw the vertex points.
    const numIndices = indices.length;
    for ( let i = 0; i < vertices2d.length; i += 2 ) {
      const x = vertices2d[i];
      const y = vertices2d[i + 1];
      Draw.point({ x, y }, { radius: 3 })
    }

    // Draw the points.
    stride = 2;
    for ( let i = 0; i < numIndices; i += 1 ) {
      const idx = indices[i] * stride; // Number of the vertex.
      const x = vertices2d[idx];
      const y = vertices2d[idx + 1];
      Draw.point({ x, y }, { radius: 3 })
    }

    // Draw the triangles.
    stride = 2;
    for ( let i = 0; i < numIndices; ) {
      const idx0 = indices[i++] * stride; // Number of the vertex.
      const x0 = vertices2d[idx0];
      const y0 = vertices2d[idx0 + 1];
      const pt0 = new PIXI.Point(x0, y0);
      Draw.point(pt0, { radius: 3 })

      const idx1 = indices[i++] * stride; // Number of the vertex.
      const x1 = vertices2d[idx1];
      const y1 = vertices2d[idx1 + 1];
      const pt1 = new PIXI.Point(x1, y1);
      Draw.point(pt1, { radius: 3 })

      const idx2 = indices[i++] * stride; // Number of the vertex.
      const x2 = vertices2d[idx2];
      const y2 = vertices2d[idx2 + 1];
      const pt2 = new PIXI.Point(x2, y2);
      Draw.point(pt2, { radius: 3 })

      Draw.connectPoints([pt0, pt1, pt2])
    }

    */

    // Construct a full vertex array with 8 vertex "slots" per vertex.
    const top = this.copyVerticesToArray(vertices2d, { stride: 2, outArr: 8 });
    const bottom = this.copyVerticesToArray(vertices2d, { stride: 2, outArr: 8 });

    // Add in elevation in place.
    // Note that after copyVerticesToArray, the stride is now 8.
    this.appendToVertexArray(top, { newData: [topZ], stride: 8, offset: 2, outArr: top });
    this.appendToVertexArray(bottom, { newData: [bottomZ], stride: 8, offset: 2, outArr: bottom });

    // Add in Normals in place.
    const normalTop = [0, 0, 1];
    const normalBottom = [0, 0, -1];
    this.appendNormals(top, { normal: normalTop, stride: 8, offset: 3, outArr: top });
    this.appendNormals(bottom, { normal: normalBottom, stride: 8, offset: 3, outArr: bottom });

    // Add in UVs in place.
    this.appendUVs(top, { stride: 8, offset: 6, outArr: top });
    this.appendUVs(bottom, { stride: 8, offset: 6, outArr: bottom });

    // Expand the vertex array based on earcut indices.
    const topExpanded = this.expandVertexData(indices, top, { stride: 8 });
    const bottomExpanded = this.expandVertexData(indices, bottom, { stride: 8 });

    // Flip the bottom to be counterclockwise.
    this.flipVertexArrayOrientation(bottomExpanded)
    return { top: topExpanded, bottom: bottomExpanded };
  }

  static polygonSideFaces(poly, { topZ = T, bottomZ = B, sides } = {}) {

    sides ??= new Float32Array(this.sidesLength(poly));
    if ( this.isClipper(poly) ) poly = poly.toPolygons();
    if ( Array.isArray(poly) ) {
      const multipleSides = poly.map(p => this.polygonSideFaces(p, { topZ, bottomZ }));
      sides.set(combineTypedArrays(multipleSides));
      return sides;
    }

    // TODO: Do we need to test poly orientation?
    if ( poly.isHole ^ poly.isClockwise ) poly.reverseOrientation();

    const vertexOffset = this.NUM_VERTEX_ELEMENTS;
    if ( !(poly instanceof PIXI.Polygon) ) poly = poly.toPolygon();

    // Some temporary points.
    const a = Point3d.tmp;
    const b = Point3d.tmp;
    const c = Point3d.tmp;
    const d = Point3d.tmp;
    const triPts = [a, b, c, d];
    const n = Point3d.tmp;
    const deltaAB = Point3d.tmp;
    const deltaAC = Point3d.tmp;

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

    let j = 0;
    for ( const { A, B } of poly.iterateEdges({ close: true }) ) {
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
      b.subtract(a, deltaAB);
      c.subtract(a, deltaAC);
      deltaAB.cross(deltaAC, n).normalize(n);

      // Define each vertex.
      // Position     Normal          UV
      // x, y, z      n.x, n.y, n.z   u, v
      const vs = Array(4);
      for ( let i = 0; i < 4; i += 1 ) {
        const pt = triPts[i];
        const uv = uvs[i];
        vs[i] = [pt.x, pt.y, pt.z, n.x, n.y, n.z, uv.u, uv.v];
      }

      // Set the 6 vertices. Indices go b, a, c, d, b, c; or [1, 0, 2, 3, 1, 2]
      sides.set(vs[1], j); j += vertexOffset;
      sides.set(vs[0], j); j += vertexOffset;
      sides.set(vs[2], j); j += vertexOffset;
      sides.set(vs[3], j); j += vertexOffset;
      sides.set(vs[1], j); j += vertexOffset;
      sides.set(vs[2], j); j += vertexOffset;
    }
    Point3d.release(a, b, c, d, n, deltaAB, deltaAC);
    return sides;
  }
}

export class Hex3dVertices extends Polygon3dVertices {

  static canUseFan(_hex) { return true; }

  /**
   * Determine the 3d vertices for a given hex shape.
   * The hex polygon represents the top and bottom of the shape, using rectangular side faces.
   * @param {CONST.TOKEN_HEXAGONAL_SHAPES} hexagonalShape
   * @param {object} [opts]
   * @param {number} [opts.topZ=T]        Top elevation
   * @param {number} [opts.bottomZ=B]     Botom elevation
   * @param {boolean} [opts.useFan]       Force fan or force no fan
   * @returns {Float32Array} The vertices, untrimmed
   */
  static calculateVertices(hexagonalShape, { width = 1, height = 1, ...opts } = {}) {
    const hexRes = getHexagonalShape(canvas.scene.grid.columns, hexagonalShape, width, height);
    let poly;
    if ( hexRes ) {
      // getHexagonalShape returns {points, center, snapping}
      // Translate to 0,0.
      poly = new PIXI.Polygon(hexRes.points);
      poly = poly.translate(-hexRes.center.x, -hexRes.center.y);
      if ( poly.isClockwise ) poly.reverseOrientation();

    } else poly = (new PIXI.Rectangle(-width * 0.5, -height * 0.5, width * 0.5, height * 0.5)).toPolygon(); // Fallback.

    // Convert to 3d polygon vertices.
    opts.useFan = true;
    opts.centroid = new PIXI.Point(0, 0); // Centered at 0, 0.
    return super.calculateVertices(poly, opts);
  }

  static hexagonalShapeForToken(token) {
    return getHexagonalShape(canvas.scene.grid.columns, token.document.hexagonalShape, token.document.width, token.document.height);
  }

  static calculateVerticesForToken(token) {
    // Center the token at 0,0,0, with unit size 1.
    const { width, height, hexagonalShape } = token.document;
    return this.calculateVertices(hexagonalShape, { width, height });
  }

  static hexKeyForToken(token) {
    const { width, height, hexagonalShape } = token.document;
    return `${hexagonalShape}_${width}_${height}`;
  }

  static hexPropertiesForKey(hexKey) {
    const values = hexKey.split("_").map(elem => Number(elem));
    return { hexagonalShape: values[0], width: values[1], height: values[2] }
  }
}

export class Ellipse3dVertices extends Polygon3dVertices {
  static unitEllipse = new PIXI.Ellipse(0, 0, 1, 1);

  static topLength(density = 3) { return Math.floor(this.NUM_TRIANGLE_ELEMENTS * density); }

  static sidesLength(density = 3) { return Math.floor(this.NUM_TRIANGLE_ELEMENTS * density * 2); }

  static calculateVertices(ellipse = this.unitEllipse, { density = 3, topZ = T, bottomZ = B } = {}) {
    const poly = ellipse.toPolygon({ density });
    return Polygon3dVertices.calculateVertices(poly, { topZ, bottomZ, centroid: ellipse.center }); // Cannot use super here b/c we want to pretend it is a polygon class.
  }

  static canUseFan(_ellipse) { return true; }

  static polygonTopBottomFacesFan(ellipse = this.unitEllipse, opts = {}) {
    const density = opts.density ?? 3;
    const poly = ellipse.toPolygon({ density });
    opts.center ??= ellipse.center;
    return Polygon3dVertices.polygonTopBottomFacesFan(poly, opts); // Cannot use super here b/c we want to pretend it is a polygon class.
  }

  static polygonTopBottomFaces(ellipse, opts) { return this.polygonTopBottomFacesFan(ellipse, opts); }

  static polygonSideFaces(ellipse, opts = {}) {
    const density = opts.density ?? 3;
    const poly = ellipse.toPolygon({ density });
    return Polygon3dVertices.polygonSideFaces(poly, opts); // Cannot use super here b/c we want to pretend it is a polygon class.
  }

  static transformMatrixFromEllipse(ellipse, { topZ = T, bottomZ = B, outMatrix } = {}) {
    outMatrix ??= MatrixFlat.empty(4, 4);
    const zHeight = topZ - bottomZ;
    const z = bottomZ + (zHeight * 0.5);
    const { width, height } = ellipse;
    const rotation = ellipse.rotation ?? 0;
    const center = ellipse.center;

    // Build transform matrix.
    const scaleM = MatrixFlat.scale(width, height, zHeight);
    const translateM = MatrixFlat.translation(center.x, center.y, z);
    const rotateM = MatrixFlat.rotationZ(rotation);
    return scaleM.multiply4x4(rotateM, outMatrix).multiply4x4(translateM, outMatrix);
  }
}

export class Circle3dVertices extends Ellipse3dVertices {
  static unitCircle = new PIXI.Circle(0, 0, 1); // Radius of 1; scales upwards by provided radius.

  static calculateVertices(circle = this.unitCircle, opts) {
    return super.calculateVertices(circle, opts);
  }

  static polygonTopBottomFacesFan(circle = this.unitCircle, opts) {
    return super.polygonTopBottomFacesFan(circle, opts);
  }

  static transformMatrixFromCircle(circle, { topZ = T, bottomZ = B, outMatrix } = {}) {
    outMatrix ??= MatrixFlat.empty(4, 4);
    const zHeight = topZ - bottomZ;
    const z = bottomZ + (zHeight * 0.5);
    const { center, radius } = circle;

    // Build transform matrix.
    const scaleM = MatrixFlat.scale(radius, radius, zHeight);
    const translateM = MatrixFlat.translation(center.x, center.y, z);
    return scaleM.multiply4x4(translateM, outMatrix);
  }
}

// ----- NOTE: Helper functions ----- //
function setFloatView(arr, buffer, offset = 0) {
  const out = new Float32Array(buffer, offset * Float32Array.BYTES_PER_ELEMENT, arr.length);
  out.set(arr);
  return out;
};

// Taken from foundry.js Token.#getHexagonalShape.
/**
 * Get the hexagonal shape given the type, width, and height.
 * @param {boolean} columns    Column-based instead of row-based hexagonal grid?
 * @param {number} type        The hexagonal shape (one of {@link CONST.TOKEN_HEXAGONAL_SHAPES})
 * @param {number} width       The width of the Token (positive)
 * @param {number} height      The height of the Token (positive)
 * @returns {DeepReadonly<TokenHexagonalShape>|null}    The hexagonal shape or null if there is no shape
 *                                                      for the given combination of arguments
 */
const hexagonalShapes = new Map();

function getHexagonalShape(columns, type, width, height) {
  if ( !Number.isInteger(width * 2) || !Number.isInteger(height * 2) ) return null;
  const key = `${columns ? "C" : "R"},${type},${width},${height}`;
  let shape = hexagonalShapes.get(key);
  if ( shape ) return shape;
  const T = CONST.TOKEN_HEXAGONAL_SHAPES;
  const M = CONST.GRID_SNAPPING_MODES;

  // Hexagon symmetry
  if ( columns ) {
    const rowShape = getHexagonalShape(false, type, height, width);
    if ( !rowShape ) return null;

    // Transpose and reverse the points of the shape in row orientation
    const points = [];
    for ( let i = rowShape.points.length; i > 0; i -= 2 ) {
      points.push(rowShape.points[i - 1], rowShape.points[i - 2]);
    }
    shape = {
      points,
      center: {x: rowShape.center.y, y: rowShape.center.x},
      snapping: {
        behavior: rowShape.snapping.behavior,
        anchor: {x: rowShape.snapping.anchor.y, y: rowShape.snapping.anchor.x}
      }
    };
  }

  // Small hexagon
  else if ( (width === 0.5) && (height === 0.5) ) {
    shape = {
      points: [0.25, 0.0, 0.5, 0.125, 0.5, 0.375, 0.25, 0.5, 0.0, 0.375, 0.0, 0.125],
      center: {x: 0.25, y: 0.25},
      snapping: {behavior: {mode: M.CENTER, resolution: 1}, anchor: {x: 0.25, y: 0.25}}
    };
  }

  // Normal hexagon
  else if ( (width === 1) && (height === 1) ) {
    shape = {
      points: [0.5, 0.0, 1.0, 0.25, 1, 0.75, 0.5, 1.0, 0.0, 0.75, 0.0, 0.25],
      center: {x: 0.5, y: 0.5},
      snapping: {behavior: {mode: M.TOP_LEFT_CORNER, resolution: 1}, anchor: {x: 0.0, y: 0.0}}
    };
  }

  // Hexagonal ellipse or trapezoid
  else if ( type <= T.TRAPEZOID_2 ) {
    shape = createHexagonalEllipseOrTrapezoid(type, width, height);
  }

  // Hexagonal rectangle
  else if ( type <= T.RECTANGLE_2 ) {
    shape = createHexagonalRectangle(type, width, height);
  }

  // Cache the shape
  if ( shape ) {
    Object.freeze(shape);
    Object.freeze(shape.points);
    Object.freeze(shape.center);
    Object.freeze(shape.snapping);
    Object.freeze(shape.snapping.behavior);
    Object.freeze(shape.snapping.anchor);
    hexagonalShapes.set(key, shape);
  }
  return shape;
}

/**
 * Create the row-based hexagonal ellipse/trapezoid given the type, width, and height.
 * @param {number} type                   The shape type (must be ELLIPSE_1, ELLIPSE_1, TRAPEZOID_1, or TRAPEZOID_2)
 * @param {number} width                  The width of the Token (positive)
 * @param {number} height                 The height of the Token (positive)
 * @returns {TokenHexagonalShape|null}    The hexagonal shape or null if there is no shape
 *                                        for the given combination of arguments
 */
function createHexagonalEllipseOrTrapezoid(type, width, height) {
  if ( !Number.isInteger(width) || !Number.isInteger(height) ) return null;
  const T = CONST.TOKEN_HEXAGONAL_SHAPES;
  const M = CONST.GRID_SNAPPING_MODES;
  const points = [];
  let top;
  let bottom;
  switch ( type ) {
    case T.ELLIPSE_1:
      if ( height >= 2 * width ) return null;
      top = Math.floor(height / 2);
      bottom = Math.floor((height - 1) / 2);
      break;
    case T.ELLIPSE_2:
      if ( height >= 2 * width ) return null;
      top = Math.floor((height - 1) / 2);
      bottom = Math.floor(height / 2);
      break;
    case T.TRAPEZOID_1:
      if ( height > width ) return null;
      top = height - 1;
      bottom = 0;
      break;
    case T.TRAPEZOID_2:
      if ( height > width ) return null;
      top = 0;
      bottom = height - 1;
      break;
  }
  let x = 0.5 * bottom;
  let y = 0.25;
  for ( let k = width - bottom; k--; ) {
    points.push(x, y);
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
  }
  points.push(x, y);
  for ( let k = bottom; k--; ) {
    y += 0.5;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
    points.push(x, y);
  }
  y += 0.5;
  for ( let k = top; k--; ) {
    points.push(x, y);
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
    y += 0.5;
  }
  for ( let k = width - top; k--; ) {
    points.push(x, y);
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
  }
  points.push(x, y);
  for ( let k = top; k--; ) {
    y -= 0.5;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  y -= 0.5;
  for ( let k = bottom; k--; ) {
    points.push(x, y);
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
    y -= 0.5;
  }
  return {
    points,
    // We use the centroid of the polygon for ellipse and trapzoid shapes
    center: foundry.utils.polygonCentroid(points),
    snapping: {
      behavior: {mode: bottom % 2 ? M.BOTTOM_RIGHT_VERTEX : M.TOP_LEFT_CORNER, resolution: 1},
      anchor: {x: 0.0, y: 0.0}
    }
  };
}

/**
 * Create the row-based hexagonal rectangle given the type, width, and height.
 * @param {number} type                   The shape type (must be RECTANGLE_1 or RECTANGLE_2)
 * @param {number} width                  The width of the Token (positive)
 * @param {number} height                 The height of the Token (positive)
 * @returns {TokenHexagonalShape|null}    The hexagonal shape or null if there is no shape
 *                                        for the given combination of arguments
 */
function createHexagonalRectangle(type, width, height) {
  if ( (width < 1) || !Number.isInteger(height) ) return null;
  if ( (width === 1) && (height > 1) ) return null;
  if ( !Number.isInteger(width) && (height === 1) ) return null;
  const T = CONST.TOKEN_HEXAGONAL_SHAPES;
  const M = CONST.GRID_SNAPPING_MODES;
  const even = (type === T.RECTANGLE_1) || (height === 1);
  let x = even ? 0.0 : 0.5;
  let y = 0.25;
  const points = [x, y];
  while ( x + 1 <= width ) {
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
    points.push(x, y);
  }
  if ( x !== width ) {
    y += 0.5;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
    points.push(x, y);
  }
  while ( y + 1.5 <= 0.75 * height ) {
    y += 0.5;
    points.push(x, y);
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
    y += 0.5;
    points.push(x, y);
    x += 0.5;
    y += 0.25;
    points.push(x, y);
  }
  if ( y + 0.75 < 0.75 * height ) {
    y += 0.5;
    points.push(x, y);
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
  }
  y += 0.5;
  points.push(x, y);
  while ( x - 1 >= 0 ) {
    x -= 0.5;
    y += 0.25;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  if ( x !== 0 ) {
    y -= 0.5;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  while ( y - 1.5 > 0 ) {
    y -= 0.5;
    points.push(x, y);
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
    y -= 0.5;
    points.push(x, y);
    x -= 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  if ( y - 0.75 > 0 ) {
    y -= 0.5;
    points.push(x, y);
    x += 0.5;
    y -= 0.25;
    points.push(x, y);
  }
  return {
    points,
    // We use center of the rectangle (and not the centroid of the polygon) for the rectangle shapes
    center: {
      x: width / 2,
      y: ((0.75 * Math.floor(height)) + (0.5 * (height % 1)) + 0.25) / 2
    },
    snapping: {
      behavior: {mode: even ? M.TOP_LEFT_CORNER : M.BOTTOM_RIGHT_VERTEX, resolution: 1},
      anchor: {x: 0.0, y: 0.0}
    }
  };
}

