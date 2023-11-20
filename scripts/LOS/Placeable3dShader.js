/* globals
canvas,
glMatrix,
PIXI
*/
"use strict";

import { Point3d } from "../geometry/3d/Point3d.js";
import { AbstractShader } from "./AbstractShader.js";

const { vec3, mat4 } = glMatrix;

export class Placeable3dShader extends AbstractShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;
uniform mat4 uOffsetMatrix;

void main() {
  vec4 cameraPosition = uLookAtMatrix * vec4(aVertex, 1.0);
  gl_Position = uOffsetMatrix * uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

out vec4 fragColor;
uniform vec4 uColor;

void main() {
  fragColor = uColor;
}`;

  static defaultUniforms = {
    uPerspectiveMatrix: mat4.create(),
    uLookAtMatrix: mat4.create(),
    uOffsetMatrix: mat4.create(),
    uColor: [0, 0, 1, 1]
  };

  static create(viewerPt, targetPt, defaultUniforms = {}) {
    defaultUniforms.uOffsetMatrix = mat4.create();
    mat4.fromScaling(defaultUniforms.uOffsetMatrix , [-1, 1, 1]);
    const res = super.create(defaultUniforms);
    res._initializeLookAtMatrix(viewerPt, targetPt);
    res._calculatePerspectiveMatrix();
    return res;
  }


  // ----- Perspective Matrix ----- //

  #fovy = Math.toRadians(90);

  #aspect = 1;

  #near = 50;

  #far = 1000; // null;

  setColor(r = 0, g = 0, b = 1, a = 1) { this.uniforms.uColor = [r, g, b, a]; }

  set fovy(value) {
    this.#fovy = value;
    this._calculatePerspectiveMatrix();
  }

  set aspect(value) {
    this.#fovy = value;
    this._calculatePerspectiveMatrix();
  }

  set near(value) {
    this.#near = value;
    this._calculatePerspectiveMatrix();
  }

  set far(value) {
    this.#far = value;
    this._calculatePerspectiveMatrix();
  }

  get fovy() { return this.#fovy; }

  get aspect() { return this.#aspect; }

  get near() { return this.#near; }

  get far() { return this.#far; }

  _initializePerspectiveMatrix(fovy, aspect, near, far) {
    this.#fovy = fovy;
    this.#aspect = aspect;
    this.#near = near;
    this.#far = far;
    this._calculatePerspectiveMatrix();
  }

  _calculatePerspectiveMatrix() {
    mat4.perspective(this.uniforms.uPerspectiveMatrix, this.#fovy, this.#aspect, this.#near, this.#far);
    this.uniformGroup.update();
  }

  // ----- LookAt Matrix ----- //
  #eye = vec3.create();

  #center = vec3.create();

  #up = vec3.fromValues(0, 0, 1);

  get eye() { return this.#eye; }

  get center() { return this.#center; }

  get up() { return this.#up; }

  set eye(value) {
    vec3.set(this.#eye, value.x, value.y, value.z);
    this._calculateLookAtMatrix();
  }

  set center(value) {
    vec3.set(this.#center, value.x, value.y, value.z);
    this._calculateLookAtMatrix();
  }

  set up(value) {
    vec3.set(this.#up, value.x, value.y, value.z);
    this._calculateLookAtMatrix();
  }

  _initializeLookAtMatrix(viewerPt, targetPt) {
    vec3.set(this.#eye, viewerPt.x, viewerPt.y, viewerPt.z);
    vec3.set(this.#center, targetPt.x, targetPt.y, targetPt.z);
    this._calculateLookAtMatrix();
  }

  _calculateLookAtMatrix() {
    // Apparently, the glMatrix lookAt is the one to use to move the target to look at the camera.

    mat4.lookAt(this.uniforms.uLookAtMatrix, this.#eye, this.#center, this.#up);
    // mat4.targetTo(this.uniforms.uLookAtMatrix, this.#center, this.#eye, this.#up);
    this.uniformGroup.update();
  }
}

export class Tile3dShader extends Placeable3dShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;
uniform mat4 uOffsetMatrix;

void main() {
  vTextureCoord = aTextureCoord;
  vec4 cameraPosition = uLookAtMatrix * vec4(aVertex, 1.0);
  gl_Position = uOffsetMatrix * uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vTextureCoord;
out vec4 fragColor;
uniform float uAlphaThreshold;
uniform vec4 uColor;
uniform sampler2D uTileTexture;

void main() {
  vec4 texPixel = texture(uTileTexture, vTextureCoord);
  fragColor = texPixel.a > uAlphaThreshold ? uColor : vec4(0.0);
}`;

  static defaultUniforms = {
    uPerspectiveMatrix: mat4.create(),
    uLookAtMatrix: mat4.create(),
    uOffsetMatrix: mat4.create(),
    uColor: [0, 0, 1, 1],
    uAlphaThreshold: 0.7,
    uTileTexture: -1
  };
}

export class Placeable3dDebugShader extends Placeable3dShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec3 aColor;

out vec4 vColor;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;
uniform mat4 uOffsetMatrix;

void main() {
//   int side = gl_VertexID;
//   switch ( side ) {
//     case 0:
//       vColor = vec4(1.0, 0.0, 0.0, 1.0);
//       break;
//     case 1:
//       vColor = vec4(0.0, 0.0, 1.0, 1.0);
//       break;
//     case 2:
//       vColor = vec4(0.0, 1.0, 0.0, 1.0);
//       break;
//     case 3:
//       vColor = vec4(1.0, 1.0, 0.0, 1.0);
//       break;
//     case 4:
//       vColor = vec4(0.0, 1.0, 1.0, 1.0);
//       break;
//     default:
//       vColor = vec4(0.5, 1.0, .5, 1.0);
//   }

  vColor = vec4(aColor, 1.0);
  vec4 cameraPosition = uLookAtMatrix * vec4(aVertex, 1.0);
  gl_Position = uOffsetMatrix * uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

in vec4 vColor;
out vec4 fragColor;

void main() {
  fragColor = vColor;
}`;
}

export class Tile3dDebugShader extends Tile3dShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;
uniform mat4 uOffsetMatrix;

void main() {
  vTextureCoord = aTextureCoord;
  vec4 cameraPosition = uLookAtMatrix * vec4(aVertex, 1.0);
  gl_Position = uOffsetMatrix * uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vTextureCoord;
out vec4 fragColor;
uniform sampler2D uTileTexture;

void main() {
  vec4 texPixel = texture(uTileTexture, vTextureCoord);
  fragColor = texPixel;
}`;
}

