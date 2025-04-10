/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { WebGL2 } from "./WebGL2.js";
import {
  NonDirectionalWallInstanceHandlerWebGL2,
  DirectionalWallInstanceHandlerWebGL2,
  NonDirectionalTerrainWallInstanceHandlerWebGL2,
  DirectionalTerrainWallInstanceHandlerWebGL2,
  TileInstanceHandlerWebGL2,
  TokenInstanceHandlerWebGL2,
  SceneInstanceHandlerWebGL2,
} from "./PlaceableInstanceHandlerWebGL2.js";
import * as twgl from "./twgl.js";

class DrawableObjectsWebGL2Abstract {
  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  /** @type {class} */
  static handlerClass;

  /** @type {string} */
  static vertexFile = "";

  /** @type {string} */
  static fragmentFile = "";

  static obstacleColor = [0, 0, 1, 1];

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
      uColor: new Float32Array(this.constructor.obstacleColor),
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
      lengths: placeableHandler.geom.indices.length,
      sizes: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.indices.byteLength),
    };
    offsetData.index.sizes.forEach((ln, i) => offsetData.index.offsets[i] = ln * i);
  }

  _initializeBuffers() {
    const gl = this.webGL2.gl;
    const placeableHandler = this.placeableHandler;

    // Set vertex buffer
    const vBuffer = this.vertexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, placeableHandler.verticesArray, gl.STATIC_DRAW)

    // Set vertex attributes
    const vertexProps = this.vertexProps = this._defineVertexAttributeProperties();
    this.bufferInfo = twgl.createBufferInfoFromArrays(gl, vertexProps);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(gl, this.programInfo, this.bufferInfo);
  }

  _defineVertexAttributeProperties() {
    const debugViewNormals = this.debugViewNormals;
    const placeableHandler = this.placeableHandler;
    const vertexProps = {
      aPos: {
        numComponents: 3,
        buffer: this.vertexBuffer,
        stride: placeableHandler.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3),
        offset: 0,
      },
      indices: placeableHandler.indicesArray,
    };

    if ( debugViewNormals ) vertexProps.aNorm = {
      numComponents: 3,
      buffer: this.vertexBuffer,
      stride: placeableHandler.verticesArray.BYTES_PER_ELEMENT * 6,
      offset: 3 * placeableHandler.verticesArray.BYTES_PER_ELEMENT,
    };
    return vertexProps;
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
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    // TODO: Swap between canvas and renderTexture.

    WebGL2.drawSet(gl, this.instanceSet, this.offsetData);
    gl.bindVertexArray(null);
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

export class DrawableNonDirectionalTerrainWallWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = NonDirectionalTerrainWallInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment";

  static obstacleColor = [0, 0.5, 1, 0.5];
}

export class DrawableDirectionalTerrainWallWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = DirectionalTerrainWallInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment";

  static obstacleColor = [0, 0.5, 1, 0.5];
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

  _defineVertexAttributeProperties() {
    const vertexProps = super._defineVertexAttributeProperties();
    const debugViewNormals = this.debugViewNormals;
    const placeableHandler = this.placeableHandler;

    // coords (3), normal (3), uv (2)
    let stride = placeableHandler.verticesArray.BYTES_PER_ELEMENT * 5;
    if ( debugViewNormals ) {
      stride = placeableHandler.verticesArray.BYTES_PER_ELEMENT * 8;
      vertexProps.aNorm.stride = stride;
    }
    vertexProps.aPos.stride = stride;
    vertexProps.aUV = {
      numComponents: 2,
      buffer: vertexProps.aPos.buffer,
      stride,
      offset: placeableHandler.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3),
    }
    return vertexProps;
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
      textureOpts.src = this._sourceForTile(tile);
      this.textures[idx] = twgl.createTexture(gl, textureOpts)
    }
  }

  _sourceForTile(tile) {
    return tile.texture.baseTexture.resource.source;
  }

  render(_target, _viewer, _visionTriangle) {
    // TODO: Use visionTriangle
    if ( !this.placeableHandler.numInstances ) return;

    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    twgl.setUniforms(this.programInfo, this.uniforms);
    twgl.setUniforms(this.programInfo, this.materialUniforms);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);

    const uniforms = { uTileTexture: -1 };
    for ( const idx of this.placeableHandler.placeableFromInstanceIndex.keys() ) {
      this.instanceSet.clear();
      this.instanceSet.add(idx);
      uniforms.uTileTexture = this.textures[idx];
      twgl.setUniforms(this.programInfo, uniforms);
      WebGL2.drawSet(gl, this.instanceSet, this.offsetData);
    }
    gl.bindVertexArray(null);
  }
}

export class DrawableSceneBackground extends DrawableTileWebGL2 {
  /** @type {class} */
  static handlerClass = SceneInstanceHandlerWebGL2;

  /** @type ImageBitMap */
  backgroundImage;

  async _initialize() {
    await super._initialize();

    this.placeableHandler.initializePlaceables()
    const sceneObj = this.placeableHandler.placeableFromInstanceIndex.get(0);
    if ( !sceneObj || !sceneObj.src ) return;
    this.backgroundImage = await loadImageBitmap(sceneObj.src, {
      //imageOrientation: "flipY",
      // premultiplyAlpha: "premultiply",
      premultiplyAlpha: "none",
    });
  }

  _sourceForTile() { return this.backgroundImage; }
}

export class DrawableTokenWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TokenInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment";

  static targetColor = [1, 0, 0, 1];

  renderTarget(target) {
    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx === "undefined" ) return;

    const instanceSet = this.instanceSet;
    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);
    twgl.setUniforms(this.programInfo, this.uniforms);

    instanceSet.clear();

    // Render the target red.
    for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.targetColor[i];
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    instanceSet.add(idx);
    WebGL2.drawSet(gl, instanceSet, this.offsetData);
    gl.bindVertexArray(null);
  }

  render(target, viewer, visionTriangle) {
    if ( !this.placeableHandler.numInstances ) return;
    const instanceSet = this.instanceSet;
    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);
    twgl.setUniforms(this.programInfo, this.uniforms);

    // Other tokens.
    instanceSet.clear();
    // TODO: Use visionTriangle
    for ( const [id, idx] of this.placeableHandler.instanceIndexFromId.entries() ) {
      if ( id === viewer.id || id === target.id ) continue;
      instanceSet.add(idx);
    }
    if ( instanceSet.size ) {
      for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.obstacleColor[i];
      twgl.setUniforms(this.programInfo, this.materialUniforms);
      WebGL2.drawSet(gl, instanceSet, this.offsetData);
    }
    gl.bindVertexArray(null);

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

/**
 * From http://webgpufundamentals.org/webgpu/lessons/webgpu-importing-textures.html
 * Load an image bitmap from a url.
 * @param {string} url
 * @param {object} [opts]       Options passed to createImageBitmap
 * @returns {ImageBitmap}
 */
async function loadImageBitmap(url, opts = {}) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await createImageBitmap(blob, opts);
}