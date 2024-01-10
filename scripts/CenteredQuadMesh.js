/* global
foundry,
mergeObject,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Matrix } from "./geometry/Matrix.js";

const translationMatrix = Matrix.translation(0.5, 0.5, 0.0);
const scaleMatrix = Matrix.scale(0.5, 0.5, 1.0);
const uvMatrix = scaleMatrix.multiply4x4(translationMatrix);

/**
 * @typedef QuadProjectionPoints
 * @property {Point3d} tl        Top left point
 * @property {Point3d} tr        Top right point
 * @property {Point3d} br        Bottom right point
 * @property {Point3d} bl        Bottom left point
 */

/**
 * Geometry that takes a set of points representing a quadrilateral.
 * @param {QuadProjectionPoints} points
 */
export class QuadProjectionGeometry extends PIXI.Geometry {
  constructor(points) {
    super();
    this.addAttribute("aVertexPosition", this.constructor.aVertexPosition(points), 3);
    this.addAttribute("aTextureCoord", this.constructor.aTextureCoord(points), 3);
    this.addIndex(this.constructor.index);
  }

  /**
   * The array of vertices for the quad projection.
   * @param {QuadProjectionPoints}
   * @returns {number[12]}
   */
  static aVertexPosition(points) {
    const { tl, tr, bl, br } = points;
    return [
      tl.x, tl.y, tl.z,
      tr.x, tr.y, tr.z,
      br.x, br.y, br.z,
      bl.x, bl.y, bl.z
    ];
  }

  /** @type {number[6]} */
  static index = [
    0, 1, 2, // TL, TR, BR
    0, 2, 3  // TL, BR, BL
  ];

  /** @type {number[12]} */
  static aTextureCoord() {
    return [
      0, 0, 1, // TL
      1, 0, 1, // TR
      1, 1, 1, // BR
      0, 1, 1 // BL
    ];
  }

  /**
   * Translate the 3d points to texture space.
   * These will be divided in the fragment shader by the z value.
   */
//   static aTextureCoord(points) {
//     const trPoints = {};
//     for ( const [key, value] of Object.entries(points) ) trPoints[key] = uvMatrix.multiplyPoint3d(value);
//     const { tl, tr, bl, br } = trPoints;
//     return [
//       tl.x, tl.y, tl.z,
//       tr.x, tr.y, tr.z,
//       br.x, br.y, br.z,
//       bl.x, bl.y, bl.z
//     ];
//   }

  /**
   * Modify the textures by the vertex z values so that
   * dividing by the z term will return the original texture coordinate.
   * This will be used to get the projected texture coordinate in texture2DProj.
   * @param {QuadProjectionPoints} points
   * @returns {number[12]}
   */
//   static aTextureCoord(points) {
//     // 0,0 // TL
//     // 1,0 // TR
//     // 1,1 // BR
//     // 0,1 // BL
//
//     return [
//       0,            0,            points.tl.z,
//       points.tr.z,  0,            points.tr.z,
//       points.br.z,  points.br.z,  points.br.z,
//       0,            points.bl.z,  points.bl.z
//     ];
//   }
}

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


class TileProjectionShader extends AbstractEVShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`
#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertexPosition;
in vec3 aTextureCoord;

out float vertexNum;
out vec2 vTextureCoord;
out vec3 vVertexPosition;

uniform vec3 uViewerPosition;
uniform vec3 uTargetPosition;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

void main() {
  vec3 vertexPosition = aVertexPosition;
  // vertexPosition.xy *= uMultiplier;
  // vertexPosition.z *= -1.0;

  // gl_Position.xyw = projectionMatrix * translationMatrix * vec3(vertexPosition.xy, 1.0);
  // gl_Position.z = 0.0;

  gl_Position = vec4(projectionMatrix * translationMatrix * vec3(vertexPosition.xy / vertexPosition.z, 1.0), 1.0);
  vVertexPosition = vertexPosition;

  vTextureCoord = aTextureCoord.xy;
  vertexNum = float(gl_VertexID);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vTextureCoord;
in float vertexNum;
in vec3 vVertexPosition;
out vec4 fragColor;
uniform sampler2D aTileSampler;

void main() {
  // fragColor = vec4(1.0, 0.0, 0.0, 1.0);
  // fragColor = vec4(vertexNum / 2.0, 0.0, 0.0, 1.0);
  // fragColor = vec4(vTextureCoord.x, vTextureCoord.y, 0.0, 1.0);
  // return;

  vec4 texPixel = texture(aTileSampler, vTextureCoord);


  /*
  mat4 transMat = mat4(1.0);
  transMat[3][0] = 0.5;
  transMat[3][1] = 0.5;

  mat4 scaleMat = mat4(1.0);
  scaleMat[0][0] = 0.5;
  scaleMat[1][1] = 0.5;

  vec4 texPosition = scaleMat * transMat * vec4(vVertexPosition, 1.0);
  vec4 texPixel = texture(aTileSampler, texPosition.xy / texPosition.z);
  */

  // vec4 texPixel = texture(aTileSampler, vTextureCoord);
  fragColor = texPixel;

}`;

  /**
   * Uniforms:
   * uTerrainSampler: elevation texture
   * uMinColor: Color to use at the minimum elevation: minElevation + elevationStep
   * uMaxColor: Color to use at the maximum current elevation: uMaxNormalizedElevation
   * uMaxNormalizedElevation: Maximum elevation, normalized units
   */
  static defaultUniforms = {
    aTileSampler: 0,
    uMultiplier: 1,
    uViewerPosition: [0, 0, 0],
    uTargetPosition: [100, 100, 0]
  };

  static create(tile, defaultUniforms = {}) {
    defaultUniforms.aTileSampler = tile.texture.baseTexture;
    return super.create(defaultUniforms);
  }
}



/**
 * Shader to represent elevation values on the elevation layer canvas.
 */
class TileProjectionShader extends AbstractEVShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`
#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertexPosition;
in vec3 aTextureCoord;

out vec2 vTextureCoord;
out vec2 vVertexPosition;
out float vertexNum;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform float uMultiplier;

void main() {
  vec3 vertexPosition = aVertexPosition * vec3(uMultiplier, uMultiplier, 1.0);
  gl_Position = vec4(projectionMatrix * translationMatrix * vec3(vertexPosition.xy / vertexPosition.z, 1.0), 1.0);
  vTextureCoord = aTextureCoord.xy;
  vVertexPosition = vertexPosition.xy;
  vertexNum = float(gl_VertexID);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vTextureCoord;
in vec2 vVertexPosition;
in float vertexNum;
out vec4 fragColor;
uniform sampler2D aTileSampler;

void main() {
  // Terrain is sized to the scene.
  // vec4 texPixel = texture(aTileSampler, vTextureCoord);
  // fragColor = texPixel;
  // fragColor = vec4(1.0, 0.0, 0.0, 1.0);
  fragColor = vec4(vertexNum / 2.0, 0.0, 0.0, 1.0);
}`;

  /**
   * Uniforms:
   * uTerrainSampler: elevation texture
   * uMinColor: Color to use at the minimum elevation: minElevation + elevationStep
   * uMaxColor: Color to use at the maximum current elevation: uMaxNormalizedElevation
   * uMaxNormalizedElevation: Maximum elevation, normalized units
   */
  static defaultUniforms = {
    aTileSampler: 0,
    uMultiplier: 1
  };

  static create(tile, defaultUniforms = {}) {
    defaultUniforms.aTileSampler = tile.texture.baseTexture;
    return super.create(defaultUniforms);
  }
}










/**
 * @typedef CenteredQuadPoints
 * @property {PIXI.Point} center
 * @property {PIXI.Point} tl        Top left point
 * @property {PIXI.Point} tr        Top right point
 * @property {PIXI.Point} br        Bottom right point
 * @property {PIXI.Point} bl        Bottom left point
 */

/**
 * Geometry that takes a set of points representing a quadrilateral.
 * @param {CenteredQuadPoints} points
 */
export class CenteredQuadGeometry extends PIXI.Geometry {
  constructor(points) {
    super();
    this.addAttribute("aVertexPosition", this.constructor.aVertexPosition(points), 2);
    this.addAttribute("aTextureCoord", this.constructor.aTextureCoord, 2);
    this.addIndex(this.constructor.index);
  }

  // For testing, pull the points.
  get center() {
    const buffer = this.getBuffer("aVertexPosition");
    return new PIXI.Point(buffer.data[0], buffer.data[1]);
  }

  get tl() {
    const buffer = this.getBuffer("aVertexPosition");
    return new PIXI.Point(buffer.data[2], buffer.data[3]);
  }

  get tr() {
    const buffer = this.getBuffer("aVertexPosition");
    return new PIXI.Point(buffer.data[4], buffer.data[5]);
  }

  get bl() {
    const buffer = this.getBuffer("aVertexPosition");
    return new PIXI.Point(buffer.data[8], buffer.data[9]);
  }

  get br() {
    const buffer = this.getBuffer("aVertexPosition");
    return new PIXI.Point(buffer.data[6], buffer.data[7]);
  }

  /**
   * Construct a geometry that represents a rectangle on the canvas.
   * Adds vertex coordinates and texture UV coordinates.
   * @param {PIXI.Rectangle} rect   Rectangle to use for the frame.
   * @returns {PIXI.Geometry}
   */
  static calculateQuadGeometry(points) {
    const geometry = new PIXI.Geometry();
    geometry.addAttribute("aVertexPosition", this.aVertexPosition(points), 2);
    geometry.addAttribute("aTextureCoord", this.aTextureCoord, 2);
    geometry.addIndex(this.index);
    return geometry;
  }

  static aVertexPosition(points) {
    const { tl, tr, bl, br } = points;
    const center = points.center ?? this.calculateCenterPoint(points);
    return [
      center.x, center.y,
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y
    ];
  }

  static calculateCenterPoint(points) {
    const xMinMax = Math.minMax(...points.map(pt => pt.x));
    const yMinMax = Math.minMax(...points.map(pt => pt.y));
    return new PIXI.Point(xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
  }

  static index = [
    0, 1, 2,  // C - TL - TR
    0, 2, 3,  // C - TR - BR
    0, 3, 4,  // C - BR - BL
    0, 4, 1   // C - BL - TL
  ];

  static aTextureCoord = [
    0.5, 0.5, // C
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1 // BL
  ];
}

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

/**
 * Shader to represent elevation values on the elevation layer canvas.
 */
class TileShader extends AbstractEVShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`
#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec2 aVertexPosition;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

void main() {
  vTextureCoord = aTextureCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vVertexPosition;
in vec2 vTextureCoord;

out vec4 fragColor;
uniform sampler2D aTileSampler;

void main() {
  // Terrain is sized to the scene.
  vec4 texPixel = texture(aTileSampler, vTextureCoord);
  fragColor = texPixel;
}`;

  /**
   * Uniforms:
   * uTerrainSampler: elevation texture
   * uMinColor: Color to use at the minimum elevation: minElevation + elevationStep
   * uMaxColor: Color to use at the maximum current elevation: uMaxNormalizedElevation
   * uMaxNormalizedElevation: Maximum elevation, normalized units
   */
  static defaultUniforms = {
    aTileSampler: 0
  };

  static create(tile, defaultUniforms = {}) {
    defaultUniforms.aTileSampler = tile.texture.baseTexture;
    return super.create(defaultUniforms);
  }
}

