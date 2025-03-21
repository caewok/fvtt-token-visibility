/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Describe a tile by its vertices, normals, and uvs.
 * By default, 1x1 tile centered at origin 0,0,0.
 */
export class GeometryTileDesc {
  /** @type {string} */
  label = "";

  /** @type {number} */
  numVertices = 12;

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
    const d = (opts.height ?? 1) * 0.5; // Depth (d) in y direction.

    const x = opts.x ?? 0;
    const y = opts.y ?? 0;
    const z = opts.z ?? 0;

    const arr = [
      // Position     Normal     UV
      // CCW if tile goes from x-w to x+w.
      // Normal vectors are times -1 b/c the triangles are CCW.
      // https://eliemichel.github.io/LearnWebGPU/basic-3d-rendering/texturing/texture-mapping.html
      // WebGPU uses 0->1 u/x and 0->1 v/y where y increases as it moves down.
      // Top
      x-w, y-d, z,  0, 0, 1,   0, 0,  // a
      x-w, y+d, z,  0, 0, 1,   0, 1,  // b
      x+w, y+d, z,  0, 0, 1,   1, 1,  // c
      x+w, y-d, z,  0, 0, 1,   1, 0,  // d
      x-w, y-d, z,  0, 0, 1,   0, 0,  // e
      x+w, y+d, z,  0, 0, 1,   1, 1,  // f

      // Bottom
      // We want the texture always facing up, not down as one might typically expect.
      // Thus the texture keeps the same coordinates.
      x+w, y+d, z,  0, 0, -1,  1, 1,  // c
      x-w, y+d, z,  0, 0, -1,  0, 1,  // b
      x-w, y-d, z,  0, 0, -1,  0, 0,  // a
      x+w, y+d, z,  0, 0, -1,  1, 1,  // f
      x-w, y-d, z,  0, 0, -1,  0, 0,  // e
      x+w, y-d, z,  0, 0, -1,  1, 0,  // d
    ];
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