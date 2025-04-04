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
import { GeometryDesc } from "./GeometryDesc.js";

/**
 * Describe a square cube (token) by its vertices, normals, and uvs.
 * By default, 1x1 token centered at origin 0,0,0.
 */
export class GeometryCubeDesc extends GeometryDesc {
  /** @type {string} */
  label = "Cube";

  /**
   * Define the vertices and optional indices for this geometry.
   * @param {object} [opts]
   * @param {number} [opts.w]           Width of the token (in x direction)
   * @param {number} [opts.d]           Depth of the token (in y direction)
   * @param {number} [opts.h]           Height of token (in z direction)
   * @param {number} [opts.x]           Location on x-axis
   * @param {number} [opts.y]           Location on y-axis
   * @param {number} [opts.z]           Location on z-axis
   */
  static defineVertices({ x, y, z, w, d, h } = {}) {
//     const indices = [
//       0, 1, 2, 3, 0, 2,        // S facing 0–3
//       4, 5, 6, 4, 6, 7,        // N facing 4–7
//       8, 9, 10, 11, 8, 10,     // W facing 8–11
//       12, 13, 14, 12, 14, 15,  // E facing 12–15
//       16, 17, 18, 19, 16, 18,  // Top 16–19
//       20, 21, 22, 20, 22, 23,  // Bottom 20–23
//     ];

    return [
      // Position    UV Normal
      // Side CCW if token goes from x-w to x+w.
      // S facing
      x+w, y+d, z+h,  0, 1, 0,  1, 0, // a, e    0
      x-w, y+d, z+h,  0, 1, 0,  0, 0, // b       1
      x-w, y+d, z-h,  0, 1, 0,  0, 1, // c, f    2
      x+w, y+d, z-h,  0, 1, 0,  1, 1, // d       3

      x+w, y+d, z+h,  0, 1, 0,  1, 0, // a, e    0
      x-w, y+d, z-h,  0, 1, 0,  0, 1, // c, f    2

      // N facing: reverse of South. c,b,a,f,e,d
      x-w, y-d, z-h,  0, -1, 0,  1, 1, // c, f   4
      x-w, y-d, z+h,  0, -1, 0,  1, 0, // b      5
      x+w, y-d, z+h,  0, -1, 0,  0, 0, // a, e   6

      x-w, y-d, z-h,  0, -1, 0,  1, 1, // c, f   4
      x+w, y-d, z+h,  0, -1, 0,  0, 0, // a, e   6

      x+w, y-d, z-h,  0, -1, 0,  0, 1, // d      7

      // W facing
      x-w, y+d, z+h,  -1, 0, 0,  1, 0, // a, e   8
      x-w, y-d, z+h,  -1, 0, 0,  0, 0, // b      9
      x-w, y-d, z-h,  -1, 0, 0,  0, 1, // c, f   10
      x-w, y+d, z-h,  -1, 0, 0,  1, 1, // d      11

      x-w, y+d, z+h,  -1, 0, 0,  1, 0, // a, e   8
      x-w, y-d, z-h,  -1, 0, 0,  0, 1, // c, f   10

      // E facing: reverse of West c,b,a,f,e,d
      x+w, y-d, z-h,  1, 0, 0,  1, 1, // c, f     12
      x+w, y-d, z+h,  1, 0, 0,  1, 0, // b        13
      x+w, y+d, z+h,  1, 0, 0,  0, 0, // a, e     14

      x+w, y-d, z-h,  1, 0, 0,  1, 1, // c, f     12
      x+w, y+d, z+h,  1, 0, 0,  0, 0, // a, e     14

      x+w, y+d, z-h,  1, 0, 0,  0, 1, // d        15

      // Top
      x-w, y-d, z+h,  0, 0, 1,   0, 0,  // a, e   16
      x-w, y+d, z+h,  0, 0, 1,   0, 1,  // b      17
      x+w, y+d, z+h,  0, 0, 1,   1, 1,  // c, f   18
      x+w, y-d, z+h,  0, 0, 1,   1, 0,  // d      19

      x-w, y-d, z+h,  0, 0, 1,   0, 0,  // a, e   16
      x+w, y+d, z+h,  0, 0, 1,   1, 1,  // c, f   18

      // Bottom: reverse of Top c,b,a,f,e,d
      x+w, y+d, z-h,  0, 0, -1,  1, 0,  // c, f   20
      x-w, y+d, z-h,  0, 0, -1,  0, 0,  // b      21
      x-w, y-d, z-h,  0, 0, -1,  0, 1,  // a, e   22

      x+w, y+d, z-h,  0, 0, -1,  1, 0,  // c, f   20
      x-w, y-d, z-h,  0, 0, -1,  0, 1,  // a, e   22

      x+w, y-d, z-h,  0, 0, -1,  1, 1,  // d      23
    ];
  }
}

/**
 * Construct vertices for a token shape that is constrained.
 * Unlike GeometryCubeDesc, this constructs a token in world space.
 * Constructor options must include token.
 */
export class GeometryConstrainedTokenDesc extends GeometryDesc {
  /** @type {string} */
  label = "Constrained Token";

  /** @type {Token} */
  token;

  static defineVertices({ token } = {}) {
    const border = token.constrainedTokenBorder;
    const { topZ, bottomZ } = token;
    if ( border instanceof PIXI.Rectangle ) {
      const w = token.document.width * canvas.dimensions.size;
      const d = token.document.height * canvas.dimensions.size;
      const h = topZ - bottomZ;
      const ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
      return GeometryCubeDesc.defineVertices({ w, d, h, ...ctr});
    }

    // Build structure from the border polygon, with rectangular sides along each edge.
    // Polygon assumed to lie on x/y plane, forming the top and bottom faces.
    const top = this.polygonTopBottomFaces(border, { elevation: topZ, top: true });
    const bottom = this.polygonTopBottomFaces(border, { elevation: bottomZ, top: false });
    const side = this.polygonSideFaces(border, { topElevation: topZ, bottomElevation: bottomZ });
    const vertices = combineTypedArrays(top.vertices, side.vertices, bottom.vertices);

    // For indices, increase because they are getting combined into one.
    side.indices = side.indices.map(elem => elem + top.numVertices);
    bottom.indices = bottom.indices.map(elem => elem + top.numVertices + side.numVertices);
    const indices = combineTypedArrays(top.indices, side.indices, bottom.indices);

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

w = 0.5;
d = 0.5
h = 0.5;

x = 0
y = 0
z = 0

const indices = [
  0, 1, 2, 3, 0, 2,        // S facing 0–3
  4, 5, 6, 4, 6, 7,        // N facing 4–7
  8, 9, 10, 11, 8, 10,     // W facing 8–11
  12, 13, 14, 12, 14, 15,  // E facing 12–15
  16, 17, 18, 19, 16, 18,  // Top 16–19
  20, 21, 22, 20, 22, 23,  // Bottom 20–23
];

arr = [
  // Position     Normal     UV
  // Side CCW if token goes from x-w to x+w.
  // S facing
  x+w, y+d, z+h,  0, 1, 0,  1, 0, // a, e    0
  x-w, y+d, z+h,  0, 1, 0,  0, 0, // b       1
  x-w, y+d, z-h,  0, 1, 0,  0, 1, // c, f    2
  x+w, y+d, z-h,  0, 1, 0,  1, 1, // d       3

  x+w, y+d, z+h,  0, 1, 0,  1, 0, // a, e    0
  x-w, y+d, z-h,  0, 1, 0,  0, 1, // c, f    2


  // N facing: reverse of South. c,b,a,f,e,d
  x-w, y-d, z-h,  0, -1, 0,  1, 1, // c, f   4
  x-w, y-d, z+h,  0, -1, 0,  1, 0, // b      5
  x+w, y-d, z+h,  0, -1, 0,  0, 0, // a, e   6

  x-w, y-d, z-h,  0, -1, 0,  1, 1, // c, f   4
  x+w, y-d, z+h,  0, -1, 0,  0, 0, // a, e   6

  x+w, y-d, z-h,  0, -1, 0,  0, 1, // d      7

  // W facing
  x-w, y+d, z+h,  -1, 0, 0,  1, 0, // a, e   8
  x-w, y-d, z+h,  -1, 0, 0,  0, 0, // b      9
  x-w, y-d, z-h,  -1, 0, 0,  0, 1, // c, f   10
  x-w, y+d, z-h,  -1, 0, 0,  1, 1, // d      11

  x-w, y+d, z+h,  -1, 0, 0,  1, 0, // a, e   8
  x-w, y-d, z-h,  -1, 0, 0,  0, 1, // c, f   10


  // E facing: reverse of West c,b,a,f,e,d
  x+w, y-d, z-h,  1, 0, 0,  1, 1, // c, f     12
  x+w, y-d, z+h,  1, 0, 0,  1, 0, // b        13
  x+w, y+d, z+h,  1, 0, 0,  0, 0, // a, e     14

  x+w, y-d, z-h,  1, 0, 0,  1, 1, // c, f     12
  x+w, y+d, z+h,  1, 0, 0,  0, 0, // a, e     14

  x+w, y+d, z-h,  1, 0, 0,  0, 1, // d        15

  // Top
  x-w, y-d, z+h,  0, 0, 1,   0, 0,  // a, e   16
  x-w, y+d, z+h,  0, 0, 1,   0, 1,  // b      17
  x+w, y+d, z+h,  0, 0, 1,   1, 1,  // c, f   18
  x+w, y-d, z+h,  0, 0, 1,   1, 0,  // d      19

  x-w, y-d, z+h,  0, 0, 1,   0, 0,  // a, e   16
  x+w, y+d, z+h,  0, 0, 1,   1, 1,  // c, f   18

  // Bottom: reverse of Top c,b,a,f,e,d
  x+w, y+d, z-h,  0, 0, -1,  1, 0,  // c, f   20
  x-w, y+d, z-h,  0, 0, -1,  0, 0,  // b      21
  x-w, y-d, z-h,  0, 0, -1,  0, 1,  // a, e   22

  x+w, y+d, z-h,  0, 0, -1,  1, 0,  // c, f   20
  x-w, y-d, z-h,  0, 0, -1,  0, 1,  // a, e   22

  x+w, y-d, z-h,  0, 0, -1,  1, 1,  // d      23
];

// Convert to indices
stride = 8; // How many elements between vertices?
length = 8; // How many elements make up a vertex?

vertices = [];
indices = new Uint16Array(arr.length / stride);
uniqueV = new Map();
tmpKey = new Array(length)
for ( let i = 0, n = arr.length, v = 0; i < n; i += stride, v += 1 ) {
  for ( let j = 0; j < length; j += 1 ) tmpKey[j] = arr[i + j];
  const key = tmpKey.join("_");
  if ( !uniqueV.has(key) ) {
    uniqueV.set(key, uniqueV.size);
    vertices.push(...arr.slice(i, i + length))
  }
  indices[v] = uniqueV.get(key);
}

// Skip normals and uvs
length = 3


// Skip uvs
length = 6



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