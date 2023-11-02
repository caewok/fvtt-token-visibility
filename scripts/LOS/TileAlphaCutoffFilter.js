/* globals
Color,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/** Testing
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
api = game.modules.get("tokenvisibility").api;
Area3dLOS = api.Area3dLOS;
PixelCache = api.PixelCache

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;

calc = new Area3dLOS(viewer, target)
calc.percentVisible()
let [tile] = calc.blockingObjects.tiles

tileSprite = new PIXI.Sprite(tile.texture);
canvas.stage.addChild(tileSprite)
canvas.stage.removeChild(tileSprite)

filter = new TileAlphaCutoffFilter(0.75);
tileSprite.filters = [filter]


filter = new PIXI.filters.ColorMatrixFilter();
tileSprite.filters = [filter]

// Identity
matrix = [
//R  G  B  A  ?
  1, 0, 0, 0, 0,  // Red
  0, 1, 0, 0, 0,  // Green
  0, 0, 1, 0, 0,  // Blue
  0, 0, 0, 1, 0   // Alpha
]


// Red --> Blue, Blue --> Red
matrix = [
//R  G  B  A  ?
  0, 0, 1, 0, 0,  // Red
  0, 1, 0, 0, 0,  // Green
  1, 0, 0, 0, 0,  // Blue
  0, 0, 0, 1, 0   // Alpha
]

// ??  Tints all by that color??
matrix = [
//R  G  B  A  ?
  1, 0, 0, 0, 1,  // Red
  0, 1, 0, 0, 0,  // Green
  0, 0, 1, 0, 0,  // Blue
  0, 0, 0, 1, 0   // Alpha
]

// All to blue
matrix = [
//R  G  B  A  ?
  0, 0, 1, 0, 0,  // Red
  0, 0, 1, 0, 0,  // Green
  1, 1, 1, 0, 0,  // Blue
  0, 0, 0, 1, 0   // Alpha
]

filter._loadMatrix(matrix, false)

*/

/**
 * If the pixel is above the alpha cutoff, make it the defined color. Otherwise, make it transparent.
 * Use a variation on the color overlay filter.
 * https://github.com/pixijs/filters/blob/main/filters/color-overlay/src/colorOverlay.frag
 */
export class TileAlphaCutoffFilter extends PIXI.Filter {
  // https://github.com/pixijs/filters/blob/main/tools/fragments/default.vert
  static vertexShader = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat3 projectionMatrix;

varying vec2 vTextureCoord;

void main(void)
{
    gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aTextureCoord;
}
`;

  static fragmentShader = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec3 color;
uniform float alphaCutoff;

void main(void) {
  gl_FragColor = vec4(0.0);
  vec4 currentColor = texture2D(uSampler, vTextureCoord);
  if ( currentColor.a > alphaCutoff ) gl_FragColor = vec4(color, 1.0);
}
`;

  constructor(alphaCutoff = 0.75, color = new Color(0x0000FF)) {
    super(TileAlphaCutoffFilter.vertexShader, TileAlphaCutoffFilter.fragmentShader);
    this.uniforms.color = new Float32Array(3);
    this.color = color;
    this.alphaCutoff = alphaCutoff;
  }

  /** @type {Color} */
  #color = new Color();

  get color() { return this.#color; }

  set color(value) {
    const arr = this.uniforms.color;
    arr[0] = value.r;
    arr[1] = value.g;
    arr[2] = value.b;
    this.#color = value;
  }

  /** @type {number} */
  #alphaCutoff = 0;

  get alphaCutoff() { return this.#alphaCutoff; }

  set alphaCutoff(value) {
    this.uniforms.alphaCutoff = value;
    this.#alphaCutoff = value;
  }
}
