/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryDesc } from "./GeometryDesc.js";

/**
 * Describe a horizontal plane (tile) by its vertices, normals, and uvs.
 * By default, 1x1 tile centered at origin 0,0,0.
 */
export class GeometryHorizontalPlaneDesc extends GeometryDesc {

  /** @type {string} */
  label = "Horizontal Plane";

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
  static defineVertices({ w, d } = {}) {
    const z = 0;
    return [
      // Position     Normal     UV
      // CCW if tile goes from x-w to x+w.
      // Normal vectors are times -1 b/c the triangles are CCW.
      // https://eliemichel.github.io/LearnWebGPU/basic-3d-rendering/texturing/texture-mapping.html
      // WebGPU uses 0->1 u/x and 0->1 v/y where y increases as it moves down.
      // Top
      // a, b, c, d, e, f
      -w, -d, z,  0, 0, 1,   0, 0,  // a, e
      -w, d, z,  0, 0, 1,   0, 1,  // b
      w, d, z,  0, 0, 1,   1, 1,  // c, f
      w, -d, z,  0, 0, 1,   1, 0,  // d

      -w, -d, z,  0, 0, 1,   0, 0,  // a, e
      w, d, z,  0, 0, 1,   1, 1,  // c, f

      // Bottom
      // We want the texture always facing up, not down as one might typically expect.
      // Thus the texture keeps the same coordinates.
      // c, b, a, f, e, d
      w, d, z,  0, 0, -1,  1, 1,  // c, f
      -w, d, z,  0, 0, -1,  0, 1,  // b
      -w, -d, z,  0, 0, -1,  0, 0,  // a, e

      w, d, z,  0, 0, -1,  1, 1,  // c, f
      -w, -d, z,  0, 0, -1,  0, 0,  // a, e
      w, -d, z,  0, 0, -1,  1, 0,  // d
    ];
//     const indices = [
//       0, 1, 2, 3, 0, 2, // Top (0–3)
//       4, 5, 6, 4, 6, 7, // Bottom (4–7)
//     ];

    /*
    Using Foundry world coordinates, where z is up, origin 0,0 is top right, y increases as it moves down.
    uv
    0,0   1,0
    0,1   1,1

    top
         x-w   x+w
    y-d  a,e    d
    y+d  b     c, f

    a->b->c
    d->e->f

    bottom is same but now cw is changed.
    c->b->a
    f->e->d

    Test by flipping bottom.
    bottom
        x-w   x+w
    y+d b      a,d
    y-d c,e    f

    */

  }
}

/* Test for normal
Point3d = CONFIG.GeometryLib.threeD.Point3d
tris = [];
Ns = [];
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