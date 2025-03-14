/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * @typedef {object} VertexParameterDescription
 * @prop {TypedArray} values
 * @prop {number} stride
 * @prop {number} offset
 */

/**
 * Describe a wall by its vertices, normals, and uvs.
 * By default, 1x1 wall centered at origin 0,0,0.
 */
export class GeometryWallDesc {
  /** @type {string} */
  label = "";

  /** @type {VertexParameterDescription} */
  position = {};

  /** @type {VertexParameterDescription} */
  normal = {};

  /** @type {VertexParameterDescription} */
  texcoord0 = {};

  /**
   * @param {object} [opts]
   * @param {number} [opts.length]   Length of the wall
   * @param {number} [opts.height]   Height of wall in z direction
   * @param {boolean} [opts.directional]    If true, the wall will be one-sided.
   */
  constructor(opts = {}) {
    const w = (opts.width ?? 1) * 0.5;
    const h = (opts.height ?? 1) * 0.5;

    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const z = opts.z ?? 0;

    const arr = [
      // Position     Normal     UV
      // Side CCW if wall goes from x-w to x+w.
      x+w, y, z+h,  0, -1, 0,  1, 1,
      x-w, y, z+h,  0, -1, 0,  0, 1,
      x-w, y, z-h,  0, -1, 0,  0, 0,
      x+w, y, z-h,  0, -1, 0,  1, 0,
      x+w, y, z+h,  0, -1, 0,  1, 1,
      x-w, y, z-h,  0, -1, 0,  0, 0,
    ];

    if ( !opts.directional ) {
      arr.push(
        // Side CW if wall goes from x-w to x+w
        x-w, y, z+h,  0, 1, 0,   1, 1,
        x+w, y, z+h,  0, 1, 0,   0, 1,
        x+w, y, z-h,  0, 1, 0,   0, 0,
        x-w, y, z-h,  0, 1, 0,   1, 0,
        x-w, y, z+h,  0, 1, 0,   1, 1,
        x+w, y, z-h,  0, 1, 0,   0, 0,
      );
    }

    const values = new Float32Array(arr);
    this.label = opts.label ?? `GeometryWall ${opts.directional ? "Directional" : ""}`;
    this.position = { values, stride: 32 };
    this.normal = { values, stride: 32, offset: 12 };
    this.uv0 = { values, stride: 32, offset: 24 };
  }
}

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