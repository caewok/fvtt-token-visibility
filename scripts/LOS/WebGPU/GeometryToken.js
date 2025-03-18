/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

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

  /** @type {object} */
  buffersLayout = Array(1);

  /**
   * @param {object} [opts]
   * @param {string} [opts.label]     Label for this structure
   * @param {number} [opts.width]     Width of the token (in x direction)
   * @param {number} [opts.depth]     Depth of the token (in y direction)
   * @param {number} [opts.height]    Height of token (in z direction)
   * @param {boolean} [opts.directional]    If true, the wall will be one-sided.
   */
  constructor(opts = {}) {
    const w = (opts.width ?? 1) * 0.5;
    const d = (opts.depth ?? 1) * 0.5
    const h = (opts.height ?? 1) * 0.5;

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
    this.buffersLayout[0] = {
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
    };

  }
}

/* Test for normal
Point3d = CONFIG.GeometryLib.threeD.Point3d
tris = [];
Ns = [];
CCW = [];
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