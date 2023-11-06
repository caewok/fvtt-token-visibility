/* globals
CONFIG,
foundry,
mergeObject
game,
PIXI
*/
"use strict";

import { Area3dLOS } from "./Area3dLOS.js";
import { Point3d } from "./Point3d.js";


// Using WebGL to layout walls at a given camera/viewer position and estimate area seen of target
class AbstractEVShader extends PIXI.Shader {
  constructor(program, uniforms) {
    super(program, foundry.utils.deepClone(uniforms));

    /**
     * The initial default values of shader uniforms
     * @type {object}
     */
    this._defaults = uniforms;
  }

  /* -------------------------------------------- */

  /**
   * The raw vertex shader used by this class.
   * A subclass of AbstractBaseShader must implement the vertexShader static field.
   * @type {string}
   */
  static vertexShader = "";

  /**
   * The raw fragment shader used by this class.
   * A subclass of AbstractBaseShader must implement the fragmentShader static field.
   * @type {string}
   */
  static fragmentShader = "";

  /**
   * The default uniform values for the shader.
   * A subclass of AbstractBaseShader must implement the defaultUniforms static field.
   * @type {object}
   */
  static defaultUniforms = {};

  /* -------------------------------------------- */

  /**
   * A factory method for creating the shader using its defined default values
   * @param {object} defaultUniforms
   * @returns {AbstractBaseShader}
   */
  static create(defaultUniforms) {
    const program = PIXI.Program.from(this.vertexShader, this.fragmentShader);
    const uniforms = mergeObject(this.defaultUniforms, defaultUniforms, {inplace: false, insertKeys: false});
    return new this(program, uniforms);
  }

  /* -------------------------------------------- */

  /**
   * Reset the shader uniforms back to their provided default values
   * @private
   */
  reset() {
    for (let [k, v] of Object.entries(this._defaults)) {
      this.uniforms[k] = v;
    }
  }
}


class WallGeometry extends PIXI.Geometry {
  constructor(walls) {
    super();
    this.addWallAttributes(walls);
    this.addWallIndices(walls);
  }

  /**
   * Wall endpoints
   */
  addWallAttributes(walls) {
    const aWallEndpoints = [];
    const aWallElevation = [];
    walls.forEach(w => {
      aWallEndpoints.push(w.A.x, w.A.y, w.B.x, w.B.y);
      aWallElevation.push(w.topZ, w.bottomZ, w.bottomZ, w.topZ);
    });

    this.addAttribute("aWallEndpoints", aWallEndpoints, 2);
    this.addAttribute("aWallElevation", aWallElevation, 2);
  }

  /**
   * Indices
   */
  addWallIndices(walls) {
    const wallIndices = [];
    const nWalls = walls.size ?? walls.length;
    for ( let i = 0; i < nWalls; i += 1 ) wallIndices.push(i, i + 1, i + 1, i);
    this.addIndex(wallIndices);
  }
}


class PrismGeometry extends PIXI.Geometry {
  constructor() {
    super();
    this.addVertices();
    this.addColors()
    this.addIndices();
  }

  /**
   * Prism endpoints
   */
  addVertices() {
    const aVertices = [
       0.25,  0.25, 0.75, 1.0,
       0.25, -0.25, 0.75, 1.0,
      -0.25,  0.25, 0.75, 1.0,

       0.25, -0.25, 0.75, 1.0,
      -0.25, -0.25, 0.75, 1.0,
      -0.25,  0.25, 0.75, 1.0,

       0.25,  0.25, -0.75, 1.0,
      -0.25,  0.25, -0.75, 1.0,
       0.25, -0.25, -0.75, 1.0,

       0.25, -0.25, -0.75, 1.0,
      -0.25,  0.25, -0.75, 1.0,
      -0.25, -0.25, -0.75, 1.0,

      -0.25,  0.25,  0.75, 1.0,
      -0.25, -0.25,  0.75, 1.0,
      -0.25, -0.25, -0.75, 1.0,

      -0.25,  0.25,  0.75, 1.0,
      -0.25, -0.25, -0.75, 1.0,
      -0.25,  0.25, -0.75, 1.0,

       0.25,  0.25,  0.75, 1.0,
       0.25, -0.25, -0.75, 1.0,
       0.25, -0.25,  0.75, 1.0,

       0.25,  0.25,  0.75, 1.0,
       0.25,  0.25, -0.75, 1.0,
       0.25, -0.25, -0.75, 1.0,

       0.25,  0.25, -0.75, 1.0,
       0.25,  0.25,  0.75, 1.0,
      -0.25,  0.25,  0.75, 1.0,

       0.25,  0.25, -0.75, 1.0,
      -0.25,  0.25,  0.75, 1.0,
      -0.25,  0.25, -0.75, 1.0,

       0.25, -0.25, -0.75, 1.0,
      -0.25, -0.25,  0.75, 1.0,
       0.25, -0.25,  0.75, 1.0,

       0.25, -0.25, -0.75, 1.0,
      -0.25, -0.25, -0.75, 1.0,
      -0.25, -0.25,  0.75, 1.0,
    ];

    this.addAttribute("aVertex", aVertices, 4);
  }

  addColors() {
    const aColors = [
      0.0, 0.0, 1.0, 1.0,
      0.0, 0.0, 1.0, 1.0,
      0.0, 0.0, 1.0, 1.0,

      0.0, 0.0, 1.0, 1.0,
      0.0, 0.0, 1.0, 1.0,
      0.0, 0.0, 1.0, 1.0,

      0.8, 0.8, 0.8, 1.0,
      0.8, 0.8, 0.8, 1.0,
      0.8, 0.8, 0.8, 1.0,

      0.8, 0.8, 0.8, 1.0,
      0.8, 0.8, 0.8, 1.0,
      0.8, 0.8, 0.8, 1.0,

      0.0, 1.0, 0.0, 1.0,
      0.0, 1.0, 0.0, 1.0,
      0.0, 1.0, 0.0, 1.0,

      0.0, 1.0, 0.0, 1.0,
      0.0, 1.0, 0.0, 1.0,
      0.0, 1.0, 0.0, 1.0,

      0.5, 0.5, 0.0, 1.0,
      0.5, 0.5, 0.0, 1.0,
      0.5, 0.5, 0.0, 1.0,

      0.5, 0.5, 0.0, 1.0,
      0.5, 0.5, 0.0, 1.0,
      0.5, 0.5, 0.0, 1.0,

      1.0, 0.0, 0.0, 1.0,
      1.0, 0.0, 0.0, 1.0,
      1.0, 0.0, 0.0, 1.0,

      1.0, 0.0, 0.0, 1.0,
      1.0, 0.0, 0.0, 1.0,
      1.0, 0.0, 0.0, 1.0,

      0.0, 1.0, 1.0, 1.0,
      0.0, 1.0, 1.0, 1.0,
      0.0, 1.0, 1.0, 1.0,

      0.0, 1.0, 1.0, 1.0,
      0.0, 1.0, 1.0, 1.0,
      0.0, 1.0, 1.0, 1.0,
    ];

    this.addAttribute("aColor", aColors, 4);
  }

  /**
   * Indices
   */
  addIndices() {
    const indices = Array.fromRange(36);
    this.addIndex(indices);
  }
}


class PrismShader extends AbstractEVShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`
#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec4 aVertex;
in vec4 aColor;

out vec4 vColor;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

uniform mat4 uPerspectiveMatrix;
uniform vec3 uOffset;
uniform float uZNear;
uniform float uZFar;
uniform float uFrustrumScale;

void main() {
  vColor = aColor;
  vec4 cameraPosition = aVertex + vec4(uOffset.x, uOffset.y, uOffset.z, 0.0);

  gl_Position = uPerspectiveMatrix * cameraPosition;

  // Perspective
//   vec4 clipPosition;
//   clipPosition.xy = cameraPosition.xy * uFrustrumScale;
//   clipPosition.z = (cameraPosition.z * (uZNear + uZFar)) / (uZNear - uZFar);
//   clipPosition.z += ((2.0 * uZNear * uZFar) / (uZNear - uZFar));
//   clipPosition.w = -cameraPosition.z;
//
//   gl_Position = clipPosition;

  // gl_Position = cameraPosition;

  // gl_Position = vec4(projectionMatrix * translationMatrix * vec3(vertexPosition.xy / vertexPosition.z, 1.0), 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec4 vColor;
out vec4 fragColor;

void main() {
  fragColor = vColor;
}`;

  /**
   * Uniforms:
   * uTerrainSampler: elevation texture
   * uMinColor: Color to use at the minimum elevation: minElevation + elevationStep
   * uMaxColor: Color to use at the maximum current elevation: uMaxNormalizedElevation
   * uMaxNormalizedElevation: Maximum elevation, normalized units
   */
  static defaultUniforms = {
    uOffset: [0, 0, 0],
    uZNear: 1.0,
    uZFar: 3.0,
    uFrustrumScale: 1.0,
    uPerspectiveMatrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]
  };

  static create(defaultUniforms = {}) {
    const res = super.create(defaultUniforms);
    res.calculatePerspectiveMatrix();
    return res;
  }

  set offset(value) {
    if ( Object.hasOwn(value, "x") ) this.uniforms.uOffset[0] = value.x;
    if ( Object.hasOwn(value, "y") ) this.uniforms.uOffset[1] = value.y;
    if ( Object.hasOwn(value, "z") ) this.uniforms.uOffset[2] = value.z;
  }

  set zNear(value) {
    this.uniforms.uZNear = value;
    this.calculatePerspectiveMatrix();
  }

  set zFar(value) {
    this.uniforms.uZFar = value;
    this.calculatePerspectiveMatrix();
  }

  set frustrumScale(value) {
    this.uniforms.uFrustrumScale = value;
    this.calculatePerspectiveMatrix();
  }

  get perspectiveMatrix() { return this.uniforms.uPerspectiveMatrix; }

  calculatePerspectiveMatrix() {
    const { uZFar, uZNear, uFrustrumScale } = this.uniforms;
    this.uniforms.uPerspectiveMatrix = Matrix.perspective(90, 1, uZNear, uZFar)
      .transpose()
      .toFlatArray();

//     const uPerspectiveMatrix = this.uniforms;
//     uPerspectiveMatrix[0] = uFrustrumScale;
//     uPerspectiveMatrix[5] = uFrustrumScale;
//     uPerspectiveMatrix[10] = (uZFar + uZNear) / (uZNear - uZFar);
//     uPerspectiveMatrix[14] = (2.0 * uZFar * uZNear) / (uZNear - uZFar);
//     uPerspectiveMatrix[11] = -1.0;
  }
}

class TriangleGeometry extends PIXI.Geometry {
  constructor() {
    super();
    this.addVertices();
    this.addColors()
    this.addIndices();
  }

  /**
   * Prism endpoints
   */
  addVertices() {
    const aVertices = [
      -1.0,   -1.0,   0.0,
       1.0,   -1.0,   0.0,
       0.0,    1.0,   0.0,
    ]

    this.addAttribute("aVertex", aVertices, 3);
  }

  addColors() {
    const aColors = [
      1.0, 1.0, 1.0, 1.0,
      1.0, 1.0, 1.0, 1.0,
      1.0, 1.0, 1.0, 1.0,
    ];

    this.addAttribute("aColor", aColors, 4);
  }

  /**
   * Indices
   */
  addIndices() {
    const indices =
    this.addIndex(indices);
  }
}

Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
Matrix = CONFIG.GeometryLib.Matrix
api = game.modules.get("tokenvisibility").api;
Area3dLOS = api.Area3dLOS;
PixelCache = api.PixelCache
AlphaCutoffFilter = api.AlphaCutoffFilter

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;

calc = new Area3dLOS(viewer, target)
calc.percentVisible()

walls = calc.blockingObjects.walls;

geom = new WallGeometry(walls);
shader = WallProjectionShader.create();
mesh = new PIXI.Mesh(geom, shader);

canvas.stage.addChild(mesh);
canvas.stage.removeChild(mesh);

// Prism test
// If prism values are between -0.25 and 0.25, the prism is set to the center of the
// browser window in Foundry, a quarter-size of the window. Its aspect ratio is that of the browser window.
// Changing the browser window changes the prism shape.

geom = new PrismGeometry();
shader = PrismShader.create();
mesh = new PIXI.Mesh(geom, shader);

// For perspective, shift from z = 0 to z = -2 (center of the zNear, zFar)
shader.offset = { z: -2 }

canvas.stage.addChild(mesh);

// Activate culling to not draw opposite faces.
mesh.state.culling = true
mesh.state.clockwiseFrontFace = true

// Move it around
shader.offset = {x: .2, y: -.2} // Note how negative y shifts down.

canvas.stage.removeChild(mesh);

// Do the math in JS to see where it is failing for the perspective.
function generateVertexPoints(verticesArray) {
  const pts = [];
  for ( let i = 0; i < verticesArray.length; i += 4 ) {
    // ignore the fourth as it is always 1
    pts.push(new Point3d(verticesArray[i], verticesArray[i+1], verticesArray[i+2]))
  }
  return pts
}

function cameraPosition(aVertex, uOffset) { return aVertex.add(uOffset) }

function clipPosition(v, uZNear, uZFar, uFrustrumScale) {
  const pos = {x: 0, y: 0, z: 0, w: 0};
  pos.x = v.x * uFrustrumScale;
  pos.y = v.y * uFrustrumScale;
  pos.z = (v.z * (uZNear + uZFar)) / (uZNear - uZFar);
  pos.z += ((2.0 * uZNear * uZFar) / (uZNear - uZFar));
  pos.w = -v.z;
  return pos;
}

function perspectiveDivide(v) {
  const wInv = 1 / v.w;
  return new Point3d(v.x * wInv, v.y * wInv, v.z * wInv);
}

function constructPerspectiveMatrix(arr) {
  // Arr is column-major; convert to Matrix row-major format.
  const mat = Matrix.fromFlatArray(arr, 4, 4);
  return mat.transpose();
}

vertices = generateVertexPoints(geom.buffers[0].data);
uOffset = new Point3d(shader.uniforms.uOffset[0], shader.uniforms.uOffset[1], shader.uniforms.uOffset[2])
uZNear = shader.uniforms.uZNear;
uZFar = shader.uniforms.uZFar;
uFrustrumScale = shader.uniforms.uFrustrumScale;
cameraPositions = vertices.map(v => cameraPosition(v, uOffset))
clipPositions = cameraPositions.map(v => clipPosition(v, uZNear, uZFar, uFrustrumScale))
perspectivePositions = clipPositions.map(v => perspectiveDivide(v))

// Using matrix
perspectiveMatrix = constructPerspectiveMatrix(shader.uniforms.uPerspectiveMatrix);
perspectivePositionsM = cameraPositions.map(v => perspectiveMatrix.multiplyPoint3d(v)); // Does the w divide








