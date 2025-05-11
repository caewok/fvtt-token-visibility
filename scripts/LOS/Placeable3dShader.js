/* globals
CONFIG,
PIXI
*/
"use strict";

import { AbstractShader } from "./AbstractShader.js";
import { MODULE_ID } from "../const.js";

export class Placeable3dShader extends AbstractShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

void main() {
  vec4 cameraPosition = uLookAtMatrix * vec4(aVertex, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

out vec4 fragColor;
uniform vec4 uColor;

void main() {
  fragColor = uColor;
}`;

  static defaultUniforms = {
    uPerspectiveMatrix: [],
    uLookAtMatrix: [],
    uColor: [0, 0, 1, 1]
  };

  static create(camera, defaultUniforms = {}) {
    defaultUniforms.uPerspectiveMatrix = camera.perspectiveMatrix.arr;
    defaultUniforms.uLookAtMatrix = camera.lookAtMatrix.arr;
    return super.create(defaultUniforms);
  }

  update() { this.uniformGroup.update(); }

}

export class Tile3dShader extends Placeable3dShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

void main() {
  vTextureCoord = aTextureCoord;
  vec4 cameraPosition = uLookAtMatrix * vec4(aVertex, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
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
    ...Placeable3dShader.defautUniforms,
    uAlphaThreshold: 0.75,
    uTileTexture: -1
  };

  static create(camera, defaultUniforms = {}) {
    defaultUniforms.uAlphaThreshold ??= CONFIG[MODULE_ID].alphaThreshold;
    return super.create(camera, defaultUniforms);
  }
}

export class Placeable3dDebugShader extends Placeable3dShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec3 aColor;

out vec4 vColor;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

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
  gl_Position = uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
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
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

void main() {
  vTextureCoord = aTextureCoord;
  vec4 cameraPosition = uLookAtMatrix * vec4(aVertex, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
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

