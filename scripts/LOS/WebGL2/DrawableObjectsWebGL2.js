/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { WebGL2 } from "./WebGL2.js";
import { GeometryDesc } from "../WebGPU/GeometryDesc.js";
import { GeometryWallDesc } from "../WebGPU/GeometryWall.js";
import { GeometryHorizontalPlaneDesc } from "../WebGPU/GeometryTile.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc, GeometryGridDesc } from "../WebGPU/GeometryToken.js";
import {
  NonDirectionalWallInstanceHandler,
  DirectionalWallInstanceHandler,
  NonDirectionalTerrainWallInstanceHandler,
  DirectionalTerrainWallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
  SceneInstanceHandler,
} from "../WebGPU/PlaceableInstanceHandler.js";

import * as twgl from "./twgl.js";
import { applyConsecutively } from "../util.js";

class DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass;

  /** @type {class} */
  static geomClass;

  /** @type {string} */
  static vertexFile = "obstacle_vertex";

  /** @type {string} */
  static fragmentFile = "obstacle_fragment";

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

  /** @type {GeometryWallDesc} */
  geoms = [];

  /** @type {ArrayBuffer} */
  verticesBuffer = new ArrayBuffer();

  /** @type {ArrayBuffer} */
  indicesBuffer = new ArrayBuffer();

  /** @type {Float32Array} */
  verticesArray = new Float32Array();

  /** @type {Uint16Array} */
  indicesArray = new Uint16Array();

  /** @type {Float32Array[]} */
  vertices = [];

  /** @type {Uint16Array[]} */
  indices = [];

  constructor(gl, camera, { debugViewNormals = false } = {}) {
    this.webGL2 = new WebGL2(gl);
    this.camera = camera;
    this.#debugViewNormals = debugViewNormals;
    this.placeableHandler = new this.constructor.handlerClass();
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
    const promises = [this._createProgram()];
    this.placeableHandler.registerPlaceableHooks();
    this._initializePlaceableHandler();
    this._initializeGeoms();

    await Promise.allSettled(promises); // Prior to updating buffers, etc.
    this._updateAllInstances();
  }

  #placeableHandlerUpdateId = 0;

  #placeableHandlerBufferId = 0;

  get placeableHandlerUpdateId() { return this.#placeableHandlerUpdateId; }

  get placeableHandlerBufferId() { return this.#placeableHandlerBufferId; }

  async _createProgram() {
    const debugViewNormals = this.debugViewNormals;
    const vertexShaderSource = await WebGL2.sourceFromGLSLFile(this.constructor.vertexFile, { debugViewNormals })
    const fragmentShaderSource = await WebGL2.sourceFromGLSLFile(this.constructor.fragmentFile, { debugViewNormals })
    this.programInfo = twgl.createProgramInfo(this.webGL2.gl, [vertexShaderSource, fragmentShaderSource]);
  }

  /*
  initialize
  - initialize placeable handler
  - define geometries
  - define offsets
  - define vertices, indices
  - define vertices and arrays buffers, which uploads the current vertices and indices

  update but do not change number of instances (update per instance)
  - update vertices
  - update buffers

  update and change number of instances; single geometry
  - define offsets
  - define vertices and arrays buffers
  - update indices
  - update vertices
  - update buffers

  change geometries
  - define geometries
  - define offsets
  - define vertices and arrays buffers
  - update indices
  - update vertices
  - update buffers
  */



  _updateAllInstances() {
    // Recreate the buffers entirely based on a possibly modified number of instances.
    // Default here assumes geometry is singular and need not be updated.
    // Child class may redefine geometry to start here.
    this._initializeOffsets();
    this._initializeVerticesAndArrays();

    // Update indices and vertices first.
    this._updateIndices();
    for ( let i = 0, iMax = this.placeableHandler.numInstances; i < iMax; i += 1 ) this._updateVerticesForInstance(i);

    // Now initialize buffers with the current vertices and indices.
    this._initializeBuffers();
  }

  _updateInstances() {
    // Checks for updates for multiple instances but does not rebuild; assumes num instances not changed.
    const placeableHandler = this.placeableHandler;
    if ( placeableHandler.bufferId < this.#placeableHandlerBufferId ) return this._updateAllInstances(); // Number of instances changed.
    if ( placeableHandler.updateId <= this.#placeableHandlerUpdateId ) return; // No changes since last update.

    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.#placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      this._updateInstance(idx);
    }
    this.#placeableHandlerUpdateId = placeableHandler.updateId;
  }

  _updateInstance(idx) {
    this._updateVerticesForInstance(idx);
    this._updateBuffersForInstance(idx);
  }

  _initializePlaceableHandler() {
    this.placeableHandler.initializePlaceables();
    this.#placeableHandlerUpdateId = this.placeableHandler.updateId;
    this.#placeableHandlerBufferId = this.placeableHandler.bufferId;
  }

  _initializeGeoms() {
    this.geom = new this.constructor.geomClass({ addNormals: this.debugViewNormals, addUVs: this.constructor.addUVs });
  }

  _initializeOffsets() {
    // Use either a single geom repeatedly or define each geom separately.
    // Subclasses can come up with more complex configurations if necessary.
    if ( this.geoms.length ) this.offsetData = GeometryDesc.computeBufferOffsets(this.geoms);
    else this.offsetData = GeometryDesc.computeBufferOffsets((new Array(this.placeableHandler.numInstances)).fill(this.geom));
  }

  /**
   * Construct data arrays representing vertices and indices.
   */
  _initializeVerticesAndArrays() {
    const offsetData = this.offsetData;
    const numPlaceables = this.placeableHandler.numInstances;
    const vClass = this.verticesArray.constructor;
    const iClass = this.indicesArray.constructor;

    this.verticesBuffer = new ArrayBuffer(offsetData.vertex.totalSize);
    this.indicesBuffer = new ArrayBuffer(offsetData.index.totalSize);
    this.verticesArray = new vClass(this.verticesBuffer);
    this.indicesArray = new iClass(this.indicesBuffer);

    // Create distinct views into the vertices and indices buffers
    this.vertices = new Array(numPlaceables);
    this.indices = new Array(numPlaceables);
    for ( let i = 0; i < numPlaceables; i += 1 ) {
      this.vertices[i] = new vClass(this.verticesBuffer, offsetData.vertex.offsets[i], offsetData.vertex.lengths[i]);
      this.indices[i] = new iClass(this.indicesBuffer, offsetData.index.offsets[i], offsetData.index.lengths[i]);
    }
  }

  /**
   * Update the index numbers based on geoms.
   */
  _updateIndices() {
    // Set the indices for each; incrementing for each subsequent placeable after the first.
    let offset = 0;
    for ( let i = 0, iMax = this.indices.length; i < iMax; i += 1 ) {
      const geom = this.geoms[i] ?? this.geom;
      const index = this.indices[i];
      for ( let j = 0, jMax = index.length; j < jMax; j += 1 ) index[j] = geom.indices[j] + offset;
      offset += this.offsetData.vertex.num[i];
    }
  }

  /**
   * Update the vertices based on instance data.
   */
  _updateVerticesForInstance(idx) {
    const ph = this.placeableHandler;
    const M = ph.matrices[idx];
    const geom = this.geoms[idx] ?? this.geom;
    const geomVertices = geom.vertices;
    const vertices = this.vertices[idx];
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const addNormals = this.debugViewNormals;
    const addUVs = this.constructor.addUVs;
    const stride = (addNormals && addUVs) ? 8
      : addNormals ? 6
      : addUVs ? 5
      : 3;

    for ( let i = 0, iMax = geomVertices.length; i < iMax; i += stride ) {
      const xIdx = i;
      const yIdx = i + 1;
      const zIdx = i + 2;
      const pt = Point3d._tmp.set(geomVertices[xIdx], geomVertices[yIdx], geomVertices[zIdx]);
      const txPt = M.multiplyPoint3d(pt, Point3d._tmp1);

      vertices[xIdx] = txPt.x;
      vertices[yIdx] = txPt.y;
      vertices[zIdx] = txPt.z;
    }

    if ( addNormals ) {
      // Should not matter for fully vertical or horizontal triangles, but...
      // See https://webgl2fundamentals.org/webgl/lessons/webgl-3d-lighting-directional.html
      // TODO: For tiles, this seems incorrect. Normal should be -1 or +1.
      // const invTransposeM = M.invert().transpose();
      // See https://github.com/graphitemaster/normals_revisited
      // Just use the rotation matrix.
      const rotM = ph.rotationMatrixForInstance(idx);

      for ( let i = 3, iMax = geomVertices.length; i < iMax; i += stride ) {
        const xIdx = i;
        const yIdx = i + 1;
        const zIdx = i + 2;
        const pt = Point3d._tmp.set(geomVertices[xIdx], geomVertices[yIdx], geomVertices[zIdx]);
        const txPt = rotM.multiplyPoint3d(pt, Point3d._tmp1).normalize();

        vertices[xIdx] = txPt.x;
        vertices[yIdx] = txPt.y;
        vertices[zIdx] = txPt.z;
      }
    }

    if ( addUVs ) {
      const offset = addNormals ? 6 : 3;
      for ( let i = offset, iMax = geomVertices.length; i < iMax; i += stride ) {
        const uIdx = i;
        const vIdx = i + 1;
        vertices[uIdx] = geomVertices[uIdx];
        vertices[vIdx] = geomVertices[vIdx];
      }
    }
  }

  vertexProps = {};

  bufferInfo = {};

  _initializeBuffers() {
    const gl = this.webGL2.gl;

    // Set vertex attributes
    this.vertexProps = this._defineVertexAttributeProperties();
    this.bufferInfo = twgl.createBufferInfoFromArrays(gl, this.vertexProps);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(gl, this.programInfo, this.bufferInfo);
  }

  _defineVertexAttributeProperties() {
    // Define a vertex buffer to be shared.
    // https://github.com/greggman/twgl.js/issues/132.
    const gl = this.webGL2.gl;
    const vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.verticesArray, gl[this.constructor.bufferDrawType]);

    const debugViewNormals = this.debugViewNormals;
    const vertexProps = {
      aPos: {
        numComponents: 3,
        buffer: vBuffer,
        stride: this.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3),
        offset: 0,
      },
      indices: this.indicesArray,
    };

    if ( debugViewNormals ) vertexProps.aNorm = {
      numComponents: 3,
      buffer: vBuffer,
      stride: this.verticesArray.BYTES_PER_ELEMENT * 6,
      offset: 3 * this.verticesArray.BYTES_PER_ELEMENT,
    };
    return vertexProps;
  }


  _updateBuffersForInstance(idx) {
    const gl = this.webGL2.gl;
    const vBuffer = this.bufferInfo.attribs.aPos.buffer;
    const iBuffer = this.bufferInfo.indices;
    const vOffsets = this.offsetData.vertex.offsets;
    const iOffsets = this.offsetData.index.offsets;

    // See twgl.setAttribInfoBufferFromArray.
    const vOffset = vOffsets[idx];
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vOffset, this.vertices[idx]);

    const iOffset = iOffsets[idx];
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuffer);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, iOffset, this.indices[idx]);
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {
    this._updateInstances();
  }

  /**
   * Render this drawable.
   */
  render(_target, _viewer) {
    if ( !this.instanceSet.size ) return;

    const gl = this.webGL2.gl;
    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    // gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferInfo.attribs.aPos.buffer);
    // gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);
    twgl.setUniforms(this.programInfo, this.uniforms);
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    // TODO: Swap between canvas and renderTexture.

    if ( CONFIG[MODULE_ID].filterInstances ) {
      WebGL2.drawSet(gl, this.instanceSet, this.offsetData);
    } else {
      const instanceLength = Number.isNumeric(this.offsetData.index.lengths)
        ? this.offsetData.index.lengths : 0;
      WebGL2.draw(gl, instanceLength * this.placeableHandler.numInstances);
    }

    gl.bindVertexArray(null);
  }

  /** @type {Set<number>} */
  instanceSet = new Set();

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(_visionTriangle, _opts) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    this.placeableHandler.instanceIndexFromId.values().forEach(idx => instanceSet.add(idx));
  }
}

export class DrawableWallWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryWallDesc;

  /** @type {boolean} */
  static directional = false;

  constructor(gl, camera, { senseType = "sight", ...opts } = {}) {
    super(gl, camera, opts);
    this.senseType = senseType;
  }

  _initializeGeoms() {
    this.geom = new this.constructor.geomClass({
      directional: this.constructor.directional,
      addNormals: this.debugViewNormals,
      addUVs: this.constructor.addUVs,
    });
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]                     Options from BlockingConfig (see AbstractViewerLOS)
   */
  filterObjects(visionTriangle, { blocking = {} } = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    blocking.walls ??= true;
    if ( !blocking.walls ) return;

    // Limit to walls within the vision triangle
    // Drop open doors.
    const edges = AbstractViewpoint.filterEdgesByVisionTriangle(visionTriangle, { senseType: this.senseType });
    for ( const [idx, wall] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( edges.has(wall.edge) ) instanceSet.add(idx);
    }
  }
}

export class DrawableNonDirectionalWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandler;

  /** @type {boolean} */
  static directional = false;
}

export class DrawableDirectionalWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = DirectionalWallInstanceHandler;

  /** @type {boolean} */
  static directional = true;
}

export class DrawableNonDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = NonDirectionalTerrainWallInstanceHandler;

  /** @type {boolean} */
  static directional = false;

  static obstacleColor = [0, 0.5, 1, 0.5];
}

export class DrawableDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = DirectionalTerrainWallInstanceHandler;

  /** @type {boolean} */
  static directional = true;

  static obstacleColor = [0, 0.5, 1, 0.5];
}

export class DrawableTileWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TileInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryHorizontalPlaneDesc;

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

    // coords (3), normal (3), uv (2)
    let stride = this.verticesArray.BYTES_PER_ELEMENT * 5;
    if ( debugViewNormals ) {
      stride = this.verticesArray.BYTES_PER_ELEMENT * 8;
      vertexProps.aNorm.stride = stride;
    }
    vertexProps.aPos.stride = stride;
    vertexProps.aUV = {
      numComponents: 2,
      buffer: vertexProps.aPos.buffer,
      stride,
      offset: this.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3),
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
    if ( !this.instanceSet.size ) return;

    const gl = this.webGL2.gl;
    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    twgl.setUniforms(this.programInfo, this.uniforms);
    twgl.setUniforms(this.programInfo, this.materialUniforms);
    // gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferInfo.attribs.aPos.buffer);
    // gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);

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
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(visionTriangle, { blocking = {} } = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    blocking.tiles ??= true;
    if ( !blocking.tiles ) return;

    // Limit to tiles within the vision triangle
    const tiles = AbstractViewpoint.filterTilesByVisionTriangle(visionTriangle, { senseType: this.senseType });
    for ( const [idx, tile] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( tiles.has(tile) ) instanceSet.add(idx);
    }
  }
}

export class DrawableSceneBackgroundWebGL2 extends DrawableTileWebGL2 {
  /** @type {class} */
  static handlerClass = SceneInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryHorizontalPlaneDesc;

  /** @type ImageBitMap */
  backgroundImage;

  async initialize() {
    const promises = [this._createProgram()];
    this.placeableHandler.registerPlaceableHooks();
    this._initializePlaceableHandler();

    const sceneObj = this.placeableHandler.placeableFromInstanceIndex.get(0);
    if ( sceneObj && sceneObj.src ) {
      this.backgroundImage = await loadImageBitmap(sceneObj.src, {
        //imageOrientation: "flipY",
        // premultiplyAlpha: "premultiply",
        premultiplyAlpha: "none",
      });
      this.instanceSet.add(0);
    }

    this._initializeGeoms();
    await Promise.allSettled(promises); // Prior to updating buffers, etc.
    this._updateAllInstances();
  }

  _updateInstances() { return; } // Nothing to change.

  filterObjects() { return; }

  _sourceForTile() { return this.backgroundImage; }
}
export class DrawableTokenWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TokenInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryCubeDesc;

  static targetColor = [1, 0, 0, 1];

  static bufferDrawType = "DYNAMIC_DRAW";

  renderTarget(target) {
    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx === "undefined" ) return;

    const gl = this.webGL2.gl;

    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    // gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferInfo.attribs.aPos.buffer);
    // gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);
    twgl.setUniforms(this.programInfo, this.uniforms);

    // Render the target red.
    for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.targetColor[i];
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    this.#tmpSet.clear();
    this.#tmpSet.add(idx);
    WebGL2.drawSet(gl, this.#tmpSet, this.offsetData);
    gl.bindVertexArray(null);
  }

  /** @type {Set<number>} */
  #tmpSet = new Set();

  render(_target, _viewer) {
    if ( !this.instanceSet.size ) return;

    const gl = this.webGL2.gl;
    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    // gl.bindBuffer(gl.ARRAY_BUFFER, this.bufferInfo.attribs.aPos.buffer);
    // gl.bindVertexArray(this.vertexArrayInfo.vertexArrayObject);
    twgl.setUniforms(this.programInfo, this.uniforms);

    for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.obstacleColor[i];
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    if ( CONFIG[MODULE_ID].filterInstances ) {
      WebGL2.drawSet(gl, this.instanceSet, this.offsetData);
    } else {
      const instanceLength = Number.isNumeric(this.offsetData.index.lengths)
        ? this.offsetData.index.lengths : 0;
      WebGL2.draw(gl, instanceLength * this.placeableHandler.numInstances);
    }
    gl.bindVertexArray(null)
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(visionTriangle, { viewer, target, blocking = {} } = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    blocking.tokens ??= {};
    blocking.tokens.dead ??= true;
    blocking.tokens.live ??= true;
    blocking.tokens.prone ??= true;
    if ( !(blocking.tokens.dead || blocking.tokens.live) ) return;

    // Limit to tokens within the vision triangle.
    // Drop excluded token categories.
    const tokens = AbstractViewpoint.filterTokensByVisionTriangle(visionTriangle,
      { viewer, target, blockingTokensOpts: blocking.tokens });
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( tokens.has(token )) instanceSet.add(idx);
    }
  }
}

export class DrawableGridShape extends DrawableTokenWebGL2 {
  /** @type {class} */
  static geomClass = GeometryGridDesc;

  filterObjects(visionTriangle, { target } = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    if ( !this.placeableHandler.instanceIndexFromId.has(target.id) ) return;
    instanceSet.add(this.placeableHandler.instanceIndexFromId.get(target.id));
  }

  async initialize() {
    const promises = [this._createProgram()];
    this.instanceSet.add(0);
    this._initializeGeoms();
    await Promise.allSettled(promises); // Prior to updating buffers, etc.
    this._updateAllInstances();
  }
}


export class UnconstrainedDrawableTokenWebGL2 extends DrawableTokenWebGL2 {
  static includeToken(token, opts) {
    if ( token.isConstrainedTokenBorder ) return false;
    return DrawableTokenWebGL2.includeToken(token, opts);
  }

  renderTarget(target) {
    if ( target.isConstrainedTokenBorder ) return;
    super.renderTarget(target);
  }
}

export class ConstrainedDrawableTokenWebGL2 extends DrawableTokenWebGL2 {
  static includeToken(token, opts) {
    if ( !token.isConstrainedTokenBorder && !canvas.grid.isHexagonal ) return false;
    return DrawableTokenWebGL2.includeToken(token, opts);
  }

  renderTarget(target) {
    if ( !target.isConstrainedTokenBorder ) return;
    super.renderTarget(target);
  }

  _updateInstanceGeoms() {
    const ph = this.placeableHandler;
    this.geoms.length = ph.numInstances;
    const addUVs = this.constructor.addUVs;
    const addNormals = this.debugViewNormals;
    ph.placeableFromInstanceIndex.entries().forEach(([idx, token]) => {
      // GeometryConstrainedTokenDesc already returns world space so the instance matrix need not be applied
      // const { x, y, z } = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
      this.geoms[idx] = new GeometryConstrainedTokenDesc({ token, addUVs, addNormals });
    });
  }

  _updateAllInstances() {
    this._updateInstanceGeoms();
    super._updateAllInstances();
  }

  _updateInstances() {
    const placeableHandler = this.placeableHandler;
    if ( placeableHandler.updateId <= this.placeableHandlerUpdateId ) return super._updateInstances(); // No changes since last update.

    // If any constrained token has changed, need to rebuild.
    // If the token is now unconstrained, that is fine (will be skipped).
    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      const token = placeableHandler.placeableFromInstanceIndex.get(idx);
      if ( token?.isConstrainedTokenBorder ) return this._updateAllInstances();
    }
    super._updateInstances();
  }

  _updateVerticesForInstance(idx) {
    // The geometry is already at the correct location, so only adjust the normals.
    const ph = this.placeableHandler;
    // const M = ph.matrices[idx];
    const geom = this.geoms[idx] ?? this.geom;
    const geomVertices = geom.vertices;
    const vertices = this.vertices[idx];
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const addNormals = this.debugViewNormals;
    const addUVs = this.constructor.addUVs;
    const stride = (addNormals && addUVs) ? 8
      : addNormals ? 6
      : addUVs ? 5
      : 3;

    for ( let i = 0, iMax = geomVertices.length; i < iMax; i += stride ) {
      const xIdx = i;
      const yIdx = i + 1;
      const zIdx = i + 2;
      const pt = Point3d._tmp.set(geomVertices[xIdx], geomVertices[yIdx], geomVertices[zIdx]);
      // const txPt = M.multiplyPoint3d(pt, Point3d._tmp1);

      vertices[xIdx] = pt.x;
      vertices[yIdx] = pt.y;
      vertices[zIdx] = pt.z;
    }

    if ( addNormals ) {
      // Should not matter for fully vertical or horizontal triangles, but...
      // See https://webgl2fundamentals.org/webgl/lessons/webgl-3d-lighting-directional.html
      // TODO: For tiles, this seems incorrect. Normal should be -1 or +1.
      // const invTransposeM = M.invert().transpose();
      // See https://github.com/graphitemaster/normals_revisited
      // Just use the rotation matrix.
      const rotM = ph.rotationMatrixForInstance(idx);

      for ( let i = 3, iMax = geomVertices.length; i < iMax; i += stride ) {
        const xIdx = i;
        const yIdx = i + 1;
        const zIdx = i + 2;
        const pt = Point3d._tmp.set(geomVertices[xIdx], geomVertices[yIdx], geomVertices[zIdx]);
        const txPt = rotM.multiplyPoint3d(pt, Point3d._tmp1).normalize();

        vertices[xIdx] = txPt.x;
        vertices[yIdx] = txPt.y;
        vertices[zIdx] = txPt.z;
      }
    }

    if ( addUVs ) {
      const offset = addNormals ? 6 : 3;
      for ( let i = offset, iMax = geomVertices.length; i < iMax; i += stride ) {
        const uIdx = i;
        const vIdx = i + 1;
        vertices[uIdx] = geomVertices[uIdx];
        vertices[vIdx] = geomVertices[vIdx];
      }
    }
  }
}

export class ConstrainedDrawableHexTokenWebGL2 extends ConstrainedDrawableTokenWebGL2 {
  static includeToken(token, opts) {
    return DrawableTokenWebGL2.includeToken(token, opts);
  }

  renderTarget(target) {
    DrawableTokenWebGL2.prototype.renderTarget.call(this, target); // Render all, not just constrained tokens.
  }

  _updateInstances() {
    const placeableHandler = this.placeableHandler;
    if ( placeableHandler.updateId <= this.placeableHandlerUpdateId ) return DrawableTokenWebGL2.prototype._updateInstances.call(this); // No changes since last update.

    // If any constrained token has changed, need to rebuild.
    // If the token is now unconstrained, that is fine (will be skipped).
    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      const token = placeableHandler.placeableFromInstanceIndex.get(idx);
      if ( token?.isConstrainedTokenBorder ) this._updateAllInstances();
    }
    DrawableTokenWebGL2.prototype._updateInstances.call(this);
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


export class DrawableWallInstance extends DrawableWallWebGL2 {
  /** @type {string} */
  static vertexFile = "instance_vertex";

  modelBuffer;

  _initializeOffsets() { return; }

  _initializeVerticesAndArrays() {
    this.verticesArray = this.geom.vertices;
    this.indicesArray = this.geom.indices;
  }

  _updateIndices() { return; }

  _updateVerticesForInstance(_idx) { return; }

  _defineVertexAttributeProperties() {
    const gl = this.webGL2.gl;
    const vertexProps = super._defineVertexAttributeProperties();

    // Define the model matrix, which changes 1 per instance.
    vertexProps.aModel = {
      numComponents: 16,
      data: this.placeableHandler.instanceArrayValues,
      drawType: gl.DYNAMIC_DRAW,
      divisor: 1,
    };
    return vertexProps;
  }

  _updateBuffersForInstance(idx) {
    const gl = this.webGL2.gl;
    const mBuffer = this.bufferInfo.attribs.aModel.buffer;

    // See twgl.setAttribInfoBufferFromArray.
    const mOffset = 4 * 16 * idx;
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, this.placeableHandler.matrices[idx].arr);
  }

  render(_target, _viewer) {
    if ( !this.instanceSet.size ) return;

    const gl = this.webGL2.gl;
    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    twgl.setUniforms(this.programInfo, this.uniforms);
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    // TODO: Swap between canvas and renderTexture.


    if ( CONFIG[MODULE_ID].filterInstances ) {
      // To draw select instances, modify the buffer offset.
      // const tmp = this.placeableHandler.instanceArrayValues;
      // console.debug(`Buffer size is ${tmp.length} x ${tmp.BYTES_PER_ELEMENT} = ${tmp.byteLength} for ${this.placeableHandler.numInstances} placeables`);
      drawInstancedMatrixSet(
        gl,
        this.instanceSet,
        this.geom.numVertices,
        this.bufferInfo.attribs.aModel,
        gl.getAttribLocation(this.programInfo.program, 'aModel'),
      );
    } else {
      // Draw every instance
      const nVertices = this.geom.numVertices;
      WebGL2.drawInstanced(gl, nVertices, 0, this.placeableHandler.numInstances);
    }
    gl.bindVertexArray(null);
  }
}


export class DrawableNonDirectionalWallInstance extends DrawableWallInstance {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandler;

  /** @type {boolean} */
  static directional = false;
}

export class DrawableDirectionalWallInstance extends DrawableWallInstance {
  /** @type {class} */
  static handlerClass = DirectionalWallInstanceHandler;

  /** @type {boolean} */
  static directional = true;
}

export class DrawableNonDirectionalTerrainWallInstance extends DrawableWallInstance {
  /** @type {class} */
  static handlerClass = NonDirectionalTerrainWallInstanceHandler;

  /** @type {boolean} */
  static directional = false;

  static obstacleColor = [0, 0.5, 1, 0.5];
}

export class DrawableDirectionalTerrainWallInstance extends DrawableWallInstance {
  /** @type {class} */
  static handlerClass = DirectionalTerrainWallInstanceHandler;

  /** @type {boolean} */
  static directional = true;

  static obstacleColor = [0, 0.5, 1, 0.5];
}

export class DrawableTokenInstance extends DrawableTokenWebGL2 {
  /** @type {string} */
  static vertexFile = "instance_vertex";

  modelBuffer;

  _initializeOffsets() { return; }

  _initializeVerticesAndArrays() {
    this.verticesArray = this.geom.vertices;
    this.indicesArray = this.geom.indices;
  }

  _updateIndices() { return; }

  _updateVerticesForInstance(_idx) { return; }

  _defineVertexAttributeProperties() {
    const gl = this.webGL2.gl;
    const vertexProps = super._defineVertexAttributeProperties();

    // Define the model matrix, which changes 1 per instance.
    vertexProps.aModel = {
      numComponents: 16,
      data: this.placeableHandler.instanceArrayValues,
      drawType: gl.DYNAMIC_DRAW,
      divisor: 1,
    };
    return vertexProps;
  }

  _updateBuffersForInstance(idx) {
    const gl = this.webGL2.gl;
    const mBuffer = this.bufferInfo.attribs.aModel.buffer;

    // See twgl.setAttribInfoBufferFromArray.
    const mOffset = 4 * 16 * idx;
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, this.placeableHandler.matrices[idx].arr);
  }

  /** @type {Set<number>} */
  #tmpSet = new Set();

  renderTarget(target) {
    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx === "undefined" ) return;

    const gl = this.webGL2.gl;
    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    twgl.setUniforms(this.programInfo, this.uniforms);

   // Render the target red.
    for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.targetColor[i];
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    this.#tmpSet.clear();
    this.#tmpSet.add(idx);

    drawInstancedMatrixSet(
      gl,
      this.#tmpSet,
      this.geom.numVertices,
      this.bufferInfo.attribs.aModel,
      gl.getAttribLocation(this.programInfo.program, 'aModel'),
    );
    gl.bindVertexArray(null);
  }

  render(_target, _viewer) {
    if ( !this.instanceSet.size ) return;

    const gl = this.webGL2.gl;
    gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.bufferInfo);
    twgl.setUniforms(this.programInfo, this.uniforms);
    twgl.setUniforms(this.programInfo, this.materialUniforms);

    if ( CONFIG[MODULE_ID].filterInstances ) {
      // To draw select instances, modify the buffer offset.
      // const tmp = this.placeableHandler.instanceArrayValues;
      // console.debug(`Buffer size is ${tmp.length} x ${tmp.BYTES_PER_ELEMENT} = ${tmp.byteLength} for ${this.placeableHandler.numInstances} placeables`);
      drawInstancedMatrixSet(
        gl,
        this.instanceSet,
        this.geom.numVertices,
        this.bufferInfo.attribs.aModel,
        gl.getAttribLocation(this.programInfo.program, 'aModel'),
      );
    } else {
      // Draw every instance
      const nVertices = this.geom.numVertices;
      WebGL2.drawInstanced(gl, nVertices, 0, this.placeableHandler.numInstances);
    }
    gl.bindVertexArray(null);
  }
}

export class UnconstrainedDrawableTokenInstance extends DrawableTokenInstance {
  static includeToken(token, opts) {
    if ( token.isConstrainedTokenBorder ) return false;
    return DrawableTokenWebGL2.includeToken(token, opts);
  }

  renderTarget(target) {
    if ( target.isConstrainedTokenBorder ) return;
    super.renderTarget(target);
  }
}

/**
 * Draw instanced for only the specified instances.
 * Cannot simply specify the instance start in webGL2, b/c that extension is barely supported.
 * Instead, move the pointer in the buffer accordingly.
 * This function assumes a single matrix that must be instanced.
 * @param {WebGL2Context} gl
 * @param {Set<number>} instanceSet     Instances to draw
 * @param {number} elementCount         Number of vertices to draw
 * @param {twgl.AttribInfo} instanceBufferInfo    Info for the instance buffer
 * @param {number} positionLoc                    Position of the matrix attribute
 */
function drawInstancedMatrixSet(gl, instanceSet, elementCount, instanceBufferInfo, positionLoc) {
  const instanceSize = 16 * 4;
  const { numComponents: size, type, stride, normalize, buffer: mBuffer } = instanceBufferInfo;
  applyConsecutively(instanceSet, (firstInstance, instanceCount) => {
    const offset = (firstInstance * instanceSize);
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.vertexAttribPointer(positionLoc, 4, type, normalize, stride, offset);
    gl.vertexAttribPointer(positionLoc+1, 4, type, normalize, stride, offset + 4*4);
    gl.vertexAttribPointer(positionLoc+2, 4, type, normalize, stride, offset + 4*8);
    gl.vertexAttribPointer(positionLoc+3, 4, type, normalize, stride, offset + 4*12);
    // console.debug({ size, stride, offset, instanceCount });
    WebGL2.drawInstanced(gl, elementCount, 0, instanceCount);
  });
}