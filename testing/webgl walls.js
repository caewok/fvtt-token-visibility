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
    const indices = Array.fromRange(12);
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

out float vVertexNum;
out vec4 vColor;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec2 uOffset;

void main() {
  vColor = aColor;
  vVertexNum = float(gl_VertexID);
  gl_Position = aVertex + vec4(uOffset.x, uOffset.y, 0.0, 0.0);

  // gl_Position = vec4(projectionMatrix * translationMatrix * vec3(vertexPosition.xy / vertexPosition.z, 1.0), 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in float vertexNum;
out vec4 fragColor;

in float vVertexNum;
in vec4 vColor;

void main() {
  fragColor = vColor;
  // fragColor = vec4(vVertexNum / 2.0, 0.0, 0.0, 1.0);
}`;

  /**
   * Uniforms:
   * uTerrainSampler: elevation texture
   * uMinColor: Color to use at the minimum elevation: minElevation + elevationStep
   * uMaxColor: Color to use at the maximum current elevation: uMaxNormalizedElevation
   * uMaxNormalizedElevation: Maximum elevation, normalized units
   */
  static defaultUniforms = {
    uOffset: [0, 0]
  };

  static create(defaultUniforms = {}) {
    return super.create(defaultUniforms);
  }

  set offset(value) {
    if ( value.x ) this.uniforms.uOffset[0] = value.x;
    if ( value.y ) this.uniforms.uOffset[1] = value.y;
  }
}

Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
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

canvas.stage.addChild(mesh);
canvas.stage.removeChild(mesh);







