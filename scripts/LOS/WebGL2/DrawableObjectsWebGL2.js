/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { WebGL2 } from "./WebGL2.js";
import {
  NonDirectionalWallInstanceHandlerWebGL2,
  DirectionalWallInstanceHandlerWebGL2,
  TileInstanceHandlerWebGL2,
  TokenInstanceHandlerWebGL2,
} from "./PlaceableInstanceHandlerWebGL2.js";
import * as twgl from "./twgl.js";

const RED = 0;
// const GREEN = 1;
const BLUE = 2;
// const ALPHA = 3;

class DrawableObjectsWebGL2Abstract {
  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  /** @type {class} */
  static handlerClass;

  /** @type {string} */
  static vertexFile = "";

  /** @type {string} */
  static fragmentFile = "";

  /** @type {PlaceableInstanceHandler} */
  placeableHandler;

  /** @type {object} */
  offsetData = {};

  /** @type WebGL2 */
  webGL2;

  uniforms = {};

  materialUniforms = {};

  constructor(gl, camera, { senseType = "sight" } = {}) {
    this.webGL2 = new WebGL2(gl);
    this.camera = camera;
    this.senseType = senseType;

    this.uniforms = {
      uPerspectiveMatrix: camera.perspectiveMatrix.arr,
      uLookAtMatrix: camera.lookAtMatrix.arr,
    };
    this.materialUniforms = {
      uColor: new Float32Array([0, 0, 1, 1]),
    };
  }

  #debugViewNormals = false;

  get debugViewNormals() { return this.#debugViewNormals; }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize({ debugViewNormals = false } = {}) {
    this.#debugViewNormals = debugViewNormals;
    await this._initialize();
    this._updateInstances();
  }

  async _initialize() {
    this._createPlaceableHandler();
    await this._createProgram();
  }

  _createPlaceableHandler() {
    this.placeableHandler = new this.constructor.handlerClass({
      senseType: this.senseType,
      addNormals: this.debugViewNormals
    });
  }

  async _createProgram() {
    const debugViewNormals = this.debugViewNormals;
    const vertexShaderSource = await WebGL2.sourceFromGLSLFile(this.constructor.vertexFile, { debugViewNormals })
    const fragmentShaderSource = await WebGL2.sourceFromGLSLFile(this.constructor.fragmentFile, { debugViewNormals })
    this.programInfo = twgl.createProgramInfo(this.webGL2.gl, [vertexShaderSource, fragmentShaderSource]);
  }

  _updateInstances() {
    this._initializePlaceableHandler();
    this._initializeBuffers();
  }

  _initializePlaceableHandler() {
    const { placeableHandler, offsetData } = this;
    placeableHandler.initializePlaceables()
    offsetData.index = {
      offsets: new Array(placeableHandler.numInstances),
      lengths: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.indices.length),
      sizes: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.indices.byteLength),
    };
    offsetData.index.sizes.forEach((ln, i) => offsetData.index.offsets[i] = ln * i);
  }

  _initializeBuffers() {
    const gl = this.webGL2.gl;
    const debugViewNormals = this.debugViewNormals;
    const placeableHandler = this.placeableHandler;

    // Set vertex buffer
    const vBuffer = this.vertexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, placeableHandler.verticesArray, gl.STATIC_DRAW)

    // Set vertex attributes
    const bufferData = {
      aPos: {
        numComponents: 3,
        buffer: vBuffer,
        stride: placeableHandler.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3),
        offset: 0,
      },
      indices: placeableHandler.indicesArray,
    };

    if ( debugViewNormals ) bufferData.aNorm = {
      numComponents: 3,
      buffer: vBuffer,
      stride: placeableHandler.verticesArray.BYTES_PER_ELEMENT * 6,
      offset: 3 * placeableHandler.verticesArray.BYTES_PER_ELEMENT,
    };
    this.bufferInfo = twgl.createBufferInfoFromArrays(gl, bufferData);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(gl, this.programInfo, this.bufferInfo);
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {}

  /**
   * Render this drawable.
   */
  render(target, viewer, visionTriangle) {
    // TODO: Use visionTriangle
    this.setRenderInstances(target, viewer, visionTriangle);
    if ( !this.instanceSet.size ) return;

    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);
    twgl.setUniforms(this.programInfo, this.uniforms);

    // TODO: Swap between canvas and renderTexture.

    WebGL2.drawSet(gl, this.instanceSet, this.offsetData);
    // gl.bindVertexArray(null);
  }

  /** @type {Set<number>} */
  instanceSet = new Set();

  setRenderInstances(_target, _viewer, _visionTriangle) {
    // TODO: Use visionTriangle
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    this.placeableHandler.instanceIndexFromId.values().forEach(idx => instanceSet.add(idx));
  }
}

export class DrawableNonDirectionalWallWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment";
}

export class DrawableDirectionalWallWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = DirectionalWallInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment";
}

export class DrawableTileWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TileInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "tile_obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "tile_obstacle_fragment";

  /** @type {WebGLTexture[]} */
  textures = [];

  _createPlaceableHandler() {
    this.placeableHandler = new this.constructor.handlerClass({
      senseType: this.senseType,
      addNormals: this.debugViewNormals,
      addUVs: true,
    });
  }

  _initializeBuffers() {
    super._initializeBuffers();

    // Setup the texture buffers.
    const gl = this.webGL2.gl;
    const textureOpts = {
      target: gl.TEXTURE_2D,
      level: 0,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
    }
    const placeableHandler = this.placeableHandler;
    this.textures.length = placeableHandler.numInstances;
    for ( const [idx, tile] of placeableHandler.placeableFromInstanceIndex.entries() ) {
      textureOpts.src = tile.texture.baseTexture.resource.source;
      this.textures[idx] = twgl.createTexture(gl, textureOpts)
    }
  }

  render(_target, _viewer, _visionTriangle) {
    // TODO: Use visionTriangle
    if ( !this.placeableHandler.numInstances ) return;

    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    twgl.setUniforms(this.programInfo, this.uniforms);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);

    const uniforms = { uTileTexture: -1 };
    for ( const idx of this.placeableHandler.placeableFromInstanceIndex.keys() ) {
      this.instanceSet.clear();
      this.instanceSet.add(idx);
      uniforms.uTileTexture = this.textures[idx];
      twgl.setUniforms(this.programInfo, this.uniforms);
      WebGL2.drawSet(gl, this.instanceSet, this.offsetData);
    }
    // gl.bindVertexArray(null);
  }
}

export class DrawableTokenWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TokenInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment";

  render(target, viewer, visionTriangle) {
    if ( !this.placeableHandler.numInstances ) return;
    const instanceSet = this.instanceSet;
    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);
    twgl.setUniforms(this.programInfo, this.uniforms);

    // Target only.
    instanceSet.clear();
    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx !== "undefined" ) {
      // Render the target red.
      this.materialUniforms.uColor[RED] = 1;
      this.materialUniforms.uColor[BLUE] = 0;
      twgl.setUniforms(this.programInfo, this.materialUniforms);

      instanceSet.add(idx);
      WebGL2.drawSet(gl, instanceSet, this.offsetData);
    }

    if ( !visionTriangle ) return; // webGL2.unbindVAO();

    // Other tokens.
    instanceSet.clear();
    // TODO: Use visionTriangle
    for ( const [id, idx] of this.placeableHandler.instanceIndexFromId.entries() ) {
      if ( id === viewer.id ) continue;
      instanceSet.add(idx);
    }
    if ( instanceSet.size ) {
      this.materialUniforms.uColor[RED] = 0;
      this.materialUniforms.uColor[BLUE] = 1;
      twgl.setUniforms(this.programInfo, this.materialUniforms);
      WebGL2.drawSet(gl, instanceSet, this.offsetData);
    }
    // gl.bindVertexArray(null);

  }

//   setRenderInstances(target, viewer, visionTriangle) {
//     const instanceSet = this.instanceSet;
//     instanceSet.clear();
//     if ( !visionTriangle ) {
//       // Target only.
//       const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
//       if ( typeof idx !== "undefined" ) instanceSet.add(idx);
//       return;
//     }
//     // TODO: Use visionTriangle
//     for ( const [id, idx] of this.placeableHandler.instanceIndexFromId.entries() ) {
//       if ( id === viewer.id ) continue;
//       instanceSet.add(idx);
//     }
//   }

}