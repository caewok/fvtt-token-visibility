/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Describe a wall by its vertices, normals, and uvs.
 * By default, 1x1 wall centered at origin 0,0,0.
 */
export class GeometryWallDesc {
  /** @type {string} */
  label = "";

  /** @type {number} */
  numVertices = 6;

  /** @type {Float32Array[]} */
  verticesData = Array(1);

  /**
   * @param {object} [opts]
   * @param {string} [opts.label]    Label for this structure
   * @param {number} [opts.length]   Length of the wall
   * @param {number} [opts.height]   Height of wall in z direction
   * @param {boolean} [opts.directional]    If true, the wall will be one-sided.
   */
  constructor(opts = {}) {
    if ( opts.label ) this.label = opts.label;
    const w = (opts.width ?? 1) * 0.5;
    const h = (opts.zHeight ?? 1) * 0.5;

    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const z = opts.z ?? 0;

    const arr = [
      // Position     Normal     UV
      // Side faces south.
      // Side CCW if wall goes from x-w to x+w.
      // Normal vectors are times -1 b/c the triangles are CCW.
      x+w, y, z+h,  0, 1, 0,  1, 0, // a
      x-w, y, z+h,  0, 1, 0,  0, 0, // b
      x-w, y, z-h,  0, 1, 0,  0, 1, // c
      x+w, y, z-h,  0, 1, 0,  1, 1, // d
      x+w, y, z+h,  0, 1, 0,  1, 0, // e
      x-w, y, z-h,  0, 1, 0,  0, 1, // f
    ];

    if ( !opts.directional ) {
      arr.push(
        // Side faces north.
        // Side CW if wall goes from x-w to x+w
        x-w, y, z-h,  0, -1, 0,  1, 1, // c
        x-w, y, z+h,  0, -1, 0,  1, 0, // b
        x+w, y, z+h,  0, -1, 0,  0, 0, // a
        x-w, y, z-h,  0, -1, 0,  1, 1, // f
        x+w, y, z+h,  0, -1, 0,  0, 0, // e
        x+w, y, z-h,  0, -1, 0,  0, 1, // d
      );

      this.numVertices += 6;
    }

    /*
    Using Foundry world coordinates, where z is up, origin 0,0 is top right, y increases as it moves down.
    uv
    0,0   1,0
    0,1   1,1

    front (south facing)
         x-w   x+w
    z+h  b     a,e
    z-h  c,f   d

    a->b->c
    d->e->f

    back (north facing)
        x+w   x-w
    z+h c,e     b
    z-h f     a,d
    a->b->c
    d->e->f

    bottom is same as top but now cw is changed and normal is other direction compared to front positions.
    c->b->a
    f->e->d

    // uv also flipped.
    1,0   0,0
    1,1   0,1



    */

    // For formats, see https://gpuweb.github.io/gpuweb/#enumdef-gpuvertexformat.
    // Each entry in verticesData corresponds to an entry in buffersLayout.
    // See https://webgpufundamentals.org/webgpu/lessons/webgpu-vertex-buffers.html
    // TODO: For directional walls, make Normal an instance buffer.
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