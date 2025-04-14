/* globals
CONFIG,
Wall
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


import { MODULE_ID, MODULES_ACTIVE } from "../../const.js";
import { tokensOverlap } from "../util.js";
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

  /** @type {number[4]} */
  static obstacleColor = [0, 0, 1, 1];

  /** @type {string} */
  static bufferDrawType = "STATIC_DRAW";

  /** @type {boolean} */
  static addUVs = false;

  /** @type {PlaceableInstanceHandler} */
  placeableHandler;

  /** @type {object} */
  offsetData = {};

  /** @type WebGL2 */
  webGL2;

  uniforms = {};

  materialUniforms = {};

  constructor(gl, camera, { senseType = "sight", debugViewNormals = false } = {}) {
    this.webGL2 = new WebGL2(gl);
    this.camera = camera;
    this.senseType = senseType;
    this.#debugViewNormals = debugViewNormals;
    this.placeableHandler = new this.constructor.handlerClass({
      senseType: this.senseType,
      addNormals: this.debugViewNormals,
      addUVs: this.constructor.addUVs,
    });

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
  async initialize() {
    await this._initialize();
    this._updateInstances();
  }

  async _initialize() {
    this.placeableHandler.registerPlaceableHooks();
    await this._createProgram();
  }

  #placeableHandlerUpdateId = 0;

  #placeableHandlerBufferId = 0;

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
    placeableHandler.initializePlaceables();
    this.#placeableHandlerUpdateId = this.placeableHandler.updateId;
    this.#placeableHandlerBufferId = this.placeableHandler.bufferId;
    offsetData.vertex = {
      offsets: new Array(placeableHandler.numInstances),
      lengths: placeableHandler.geom.vertices.length,
      sizes: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.vertices.byteLength),
    }
    offsetData.vertex.sizes.forEach((ln, i) => offsetData.vertex.offsets[i] = ln * i);
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
    gl.bufferData(gl.ARRAY_BUFFER, placeableHandler.verticesArray, gl[this.constructor.bufferDrawType])

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
   * Update the vertex and index buffers for the placeable(s).
   */
  _updateBuffers() {
    const placeableHandler = this.placeableHandler;

    if ( placeableHandler.bufferId < this.#placeableHandlerBufferId ) return this._updateInstances();
    if ( placeableHandler.updateId <= this.#placeableHandlerUpdateId ) return;

    const gl = this.webGL2.gl;
    const vBuffer = this.vertexBuffer;
    const iBuffer = this.bufferInfo.indices;
    const vOffsets = this.offsetData.vertex.offsets;
    const iOffsets = this.offsetData.index.offsets;
    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.#placeableHandlerUpdateId ) continue;

      // See twgl.setAttribInfoBufferFromArray.
      const vOffset = vOffsets[idx];
      gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, vOffset, placeableHandler.vertices[idx]);

      const iOffset = iOffsets[idx];
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, iOffset, placeableHandler.indices[idx]);
    }
    this.#placeableHandlerUpdateId = placeableHandler.updateId;
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {
    this._updateBuffers();
  }

  /**
   * Render this drawable.
   */
  render(_target, _viewer) {
    if ( !this.instanceSet.size ) return;

    this._updateBuffers();

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

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   */
  filterObjects(_visionTriangle, _opts) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    this.placeableHandler.instanceIndexFromId.values().forEach(idx => instanceSet.add(idx));
  }
}

export class DrawableWallWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment";

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]                     Options from BlockingConfig (see AbstractViewerLOS)
   */
  filterObjects(visionTriangle, opts = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    opts.walls ??= true;
    if ( !opts.walls ) return;

    // Limit to walls within the vision triangle
    // Drop open doors.
    for ( const [idx, edge] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( edge.object instanceof Wall && edge.object.isOpen ) continue;
      if ( visionTriangle.containsEdge(edge) ) instanceSet.add(idx);
    }
  }
}

export class DrawableNonDirectionalWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandlerWebGL2;
}

export class DrawableDirectionalWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = DirectionalWallInstanceHandlerWebGL2;
}

export class DrawableNonDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = NonDirectionalTerrainWallInstanceHandlerWebGL2;

  static obstacleColor = [0, 0.5, 1, 0.5];
}

export class DrawableDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = DirectionalTerrainWallInstanceHandlerWebGL2;

  static obstacleColor = [0, 0.5, 1, 0.5];
}

export class DrawableTileWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TileInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "tile_obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "tile_obstacle_fragment";

  /** @type {boolean} */
  static addUVs = true;

  /** @type {WebGLTexture[]} */
  textures = [];

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
      textureOpts.src = this.constructor.tileSource(tile);
      this.textures[idx] = twgl.createTexture(gl, textureOpts)
    }
  }

  static tileSource(tile) { return tile.texture.baseTexture.resource.source; }

  /** @type {Set<number>} */
  #tmpSet = new Set();

  render(_target, _viewer) {
    // TODO: Use visionTriangle
    if ( !this.placeableHandler.numInstances ) return;
    this._updateBuffers();

    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    twgl.setUniforms(this.programInfo, this.uniforms);
    twgl.setUniforms(this.programInfo, this.materialUniforms);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);

    const uniforms = { uTileTexture: -1 };
    for ( const idx of this.instanceSet ) {
      this.#tmpSet.clear();
      this.#tmpSet.add(idx);
      uniforms.uTileTexture = this.textures[idx];
      twgl.setUniforms(this.programInfo, uniforms);
      WebGL2.drawSet(gl, this.#tmpSet, this.offsetData);
    }
    gl.bindVertexArray(null);
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]                     Options from BlockingConfig (see AbstractViewerLOS)
   */
  filterObjects(visionTriangle, opts = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    opts.tiles ??= true;
    if ( !opts.tiles ) return;

    // Limit to tiles within the vision triangle
    for ( const [idx, tile] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( visionTriangle.containsTile(tile) ) instanceSet.add(idx);
    }
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
    this.instanceSet.add(0);
  }

  filterObjects() { return; }

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

  static bufferDrawType = "DYNAMIC_DRAW";

  renderTarget(target) {
    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx === "undefined" ) return;

    this._updateBuffers();
    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);
    twgl.setUniforms(this.programInfo, this.uniforms);

    this.#tmpSet.clear();

    // Render the target red.
    for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.targetColor[i];
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    this.#tmpSet.add(idx);
    WebGL2.drawSet(gl, this.#tmpSet, this.offsetData);
    gl.bindVertexArray(null);
  }

  /** @type {Set<number>} */
  #tmpSet = new Set();

  render(_target, _viewer) {
    if ( !this.instanceSet.size ) return;
    this._updateBuffers();
    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);
    twgl.setUniforms(this.programInfo, this.uniforms);

    for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.obstacleColor[i];
    twgl.setUniforms(this.programInfo, this.materialUniforms);
    WebGL2.drawSet(gl, this.instanceSet, this.offsetData);
    gl.bindVertexArray(null);
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]                     Options from BlockingConfig (see AbstractViewerLOS)
   */
  filterObjects(visionTriangle, opts = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    opts.tokens ??= {};
    opts.tokens.dead ??= true;
    opts.tokens.live ??= true;
    opts.tokens.prone ??= true;
    if ( !(opts.tokens.dead || opts.tokens.live) ) return;

    // Limit to tokens within the vision triangle.
    // Drop excluded token categories.
    const { viewer, target } = opts;
    const api = MODULES_ACTIVE.API.RIDEABLE;
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( token === viewer || token === target ) continue;
      if ( !this.constructor.includeToken(token, opts.tokens) ) continue;

      // Filter tokens that directly overlaps the viewer.
      if ( tokensOverlap(token, viewer) ) continue;

      // Filter all mounts and riders of both viewer and target. Possibly covered by overlap test.
      if ( api && (api.RidingConnection(token, viewer) || api.RidingConnection(token, target)) ) continue;

      if ( visionTriangle.containsToken(token) ) instanceSet.add(idx);
    }
  }

  static includeToken(token, { dead = true, live = true, prone = true } = {}) {
    if ( !dead && CONFIG[MODULE_ID].tokenIsDead(token) ) return false;
    if ( !live && CONFIG[MODULE_ID].tokenIsAlive(token) ) return false;
    if ( !prone && token.isProne ) return false;
    return true;
  }
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