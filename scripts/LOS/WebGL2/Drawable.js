/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


// webGL2
import * as twgl from "./twgl.js";
import { WebGL2 } from "./WebGL2.js";

import { GeometricPrimitive } from "../../geometry/placeable_geometry/GeometricPrimitive.js";
import { GEOMETRY_LIB_ID } from "../../geometry/const.js";
import { FixedLengthTrackingBuffer } from "../../geometry/placeable_tracking/TrackingBuffer.js";

/* Drawables

BufferChannel     One per-instance attribute
  - tracker, extractor, layout, advance function

Drawable          One VO + N instnaces.
  - channels: aModel, aOpacity
  - cull buckets by direction.

  |- Textured Drawable
     - channels: aTextureIndex, aAlphaThreshold
     - texture-batch draw loop

  |- Constrained Drawable
     - channels: aNumClipPlanes, aClipPlanes_*, aTokenCenter

*/

const GL_TYPE_NAME = new Map([[Float32Array, "FLOAT"], [Int32Array, "INT"]]);


/**
 * Manage the state of a given webGL buffer and associated tracker.
 */
class BufferChannel {
  /** @type {WebGL2RenderingContext} */
  gl;

  /** @type {string[]} */
  attribNames = [];

  /** @type {VariableLengthTrackingBuffer} */
  tracker;

  /** @type {function} */
  extract; // E.g., datum => ({ newValues: datum.modelMatrix.model.arr })

  /** @type {number} */
  layoutVersion = 0;

  /** @type {string} E.g., "FLOAT" or "INT" */
  glType = "FLOAT";

  /** @type {class} E.g., Float32Array */
  type = Float32Array;

  /** @type {WeakMap<WebGL2Program, Map<string, number>} */
  locations = new WeakMap();

  /** @type {WebGLBuffer|null} */
  buffer = null;

  /** @type {Map<string, number>}  id -> counter */
  dataVersions = new Map();

  /** @type {boolean} */
  needsResize = true;

  /**
   * @param {object} cfg
   * @param {WebGL2RenderingContext} cfg.gl                 WebGL2 context
   * @param {string|string[]} cfg.attribNames               One attribute, or several that slice the same per-instance data
   * @param {number} cfg.numComponents                      Tracking buffer for this attribute's data
   * @param {function} cfg.extract                          How to extract data from a tracked object
   * @param {TypedArrayConstructor} [cfg.type=Float32Array] Test whether a tracked object has changed
   */
  constructor({ gl, attribNames, numComponents, extract, type = Float32Array } = {}) {
    this.gl = gl;
    this.attribNames = [].concat(attribNames);
    this.numComponents = numComponents;
    this.extract = extract;
    this.type = type;
    this.glType = gl[GL_TYPE_NAME.get(type)];
    this.tracker = new FixedLengthTrackingBuffer({ facetLengths: numComponents * this.attribNames.length, type });
  }

  /**
   * Create this channel's GL buffer and describe its attributes for twgl.
   * @returns {object<string, object>} Attribute properties, one per attribute name
   */
  attribProps() {
    const { gl, numComponents, attribNames } = this;
    const bytes = this.type.BYTES_PER_ELEMENT;
    const stride = bytes * numComponents * attribNames.length; // Distance from one instance to the next.

    // One buffer per channel. Every attribute of the channel points into it.
    const buffer = this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.tracker.viewWholeBuffer(), gl.DYNAMIC_DRAW);

    const props = {};
    attribNames.forEach((name, i) => {
      props[name] = {
        numComponents,
        buffer,
        type: this.glType,    // INT makes twgl use vertexAttribIPointer.
        stride,
        offset: i * numComponents * bytes,
        divisor: 1,
      };
    });
    return props;
  }

  /**
   * Look up attribute locations in a program and store for later use.
   * @param {WebGL2Program} program
   * @returns {Map<string, number>} The attribute map stored at this.locations.
   */
  locate(program) {
    const gl = this.gl;
    const attribMap = new Map();
    this.attribNames.forEach(name => {
      const i = gl.getAttribLocation(program, name);
      attribMap.set(name, i);
    });
    this.locations.set(program, attribMap);
    return attribMap;
  }

  /**
   * Functions that point each attribute at a given first instance.
   * @param {object} attribs
   * @param {WebGL2Program} program
   * @returns {*[]}
   */
  advanceFns(attribs, program) {
    const out = [];
    const attribMap = this.locations.get(program) || this.locate(program);
    this.attribNames.forEach(name => {
      const loc = attribMap.get(name);
      if ( loc >= 0 ) out.push(WebGL2._advanceInstanceFn(this.gl, attribs[name], loc)); // -1: optimized out.
    });
    return out;
  }

  /**
   * Add the instance, or update if only if its values changed
   * @param {object} datum          Object from GeometricPrimitive#drawables
   */
  set(datum) {
    const id = datum.id;
    const newValues = this.extract(datum);
    if ( !this.tracker.hasId(id) ) {
      this.tracker.addFacet({ id, newValues });
      this.needsResize = true;
      return;
    }
    const stored = this.tracker.viewFacetById(id);
    for ( let i = 0, n = stored.length; i < n; i += 1 ) {
      // fround: the tracker stores float32, so compare at float32 precision or every opacity looks changed.
      if ( stored[i] === Math.fround(newValues[i]) ) continue;
      this.tracker.updateFacet(id, { newValues });
      return;
    }
  }

  delete(id) {
    if ( !this.tracker.hasId(id) ) return;
    this.tracker.deleteFacet(id);
    this.dataVersions.delete(id);
    this.needsResize = true;
  }

  sync() {
    const { gl, tracker } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if ( this.needsResize || this.layoutVersion !== tracker.layoutVersion ) {
      gl.bufferData(gl.ARRAY_BUFFER, tracker.viewWholeBuffer(), gl.DYNAMIC_DRAW);
      this.layoutVersion = tracker.layoutVersion;
      this.needsResize = false;
      for ( const [id, counter] of tracker.facetChangeTracker ) this.dataVersions.set(id, counter);
      return;
    }
    const bytes = tracker.type.BYTES_PER_ELEMENT;
    for ( const [id, counter] of tracker.facetChangeTracker ) {
      if ( counter === this.dataVersions.get(id) ) continue;
      gl.bufferSubData(gl.ARRAY_BUFFER, tracker.facetOffsetAtId(id) * bytes, tracker.viewFacetById(id));
      this.dataVersions.set(id, counter);
    }
  }

  destroy() {
    this.gl.deleteBuffer(this.buffer);
    this.buffer = null;
    this.tracker = null;
    this.dataVersions.clear();
    this.locations = new WeakMap();
  }
}

export class Drawable {

  static SHADER_FLAGS = {
    NONE:         0,
    DEBUG:        1 << 0, // 1
    TEXTURED:     1 << 1, // 4
    CONSTRAINED:  1 << 2, // 8
  };

  /** @type {string} */
  static VERTEX_DRAW_TYPE = "STATIC_DRAW";

  /** @type {number} */
  static CAMERA_BIND_POINT = 0;

  /** @type {number} */
  static MATERIAL_BIND_POINT = 1;

  /** @type {number} */
  static stride = 6; // 3d position + 3d normal

  /** @type {WebGL2} */
  webGL2;

  /** @type {twgl.ProgramInfo} */
  programInfo;

  /** @type {twgl.ProgramInfo} */
  debugProgramInfo;

  /** @type {VertexObject} */
  vo;

  /** @type {number} */
  voVersion = 0;

  /** @type {Map<string, BufferChannel>} AttribName -> BufferChannel */
  channels = new Map();

  /** @type {Map<string, object>} Id -> latest draw datum */
  instances = new Map();

  constructor({ webGL2, programInfo, debugProgramInfo, vo, voVersion = 0 } = {}) {
    this.webGL2 = webGL2;
    this.programInfo = programInfo;
    this.debugProgramInfo = debugProgramInfo;
    this.vo = vo;
    this.voVersion = voVersion;

    this.addChannel("aModel", 16, d => d.matrix.arr);
    this.addChannel("aOpacity", 1, d => [d.opacity]);
  }

  // ----- NOTE: Simple getters ----- //

  /** @type {WebGL2RenderingContext} */
  get gl() { return this.webGL2.gl; }

  /** @type {WebGL2Program} */
  get program() { return this.debugView ? this.debugProgramInfo : this.programInfo; }

  // ----- NOTE: Initialization ----- //

  #initialized = false;

  /**
   * Initialize the drawables.
   */
  initialize() {
    if ( this.#initialized ) return;
    this._initializeAttributes();
    this._initializeUniforms();
    this.#initialized = true;
  }

  // ----- NOTE: Channels ----- //

  /**
   * Track updates to a specific per-instance attribute.
   * @param {string|string[]} attribNames         Name(s) of the attribute
   * @param {number} numComponents                WebGL2 layout space
   * @param {function} extract                    Function to extract relevant attribute data from the draw datum
   * @param {object} [opts]                       Passed to BufferChannel
   */
  addChannel(attribNames, numComponents, extract, opts = {}) {
    const primaryName = [].concat(attribNames)[0];
    this.channels.set(
      primaryName,
      new BufferChannel({ gl: this.gl, attribNames, numComponents, extract, ...opts })
    );
  }

  // ----- NOTE: Uniforms ----- //

  _initializeUniforms() {
    const gl = this.gl;

    // Camera used in both debug and regular views.
    const cameraBlockIndex = gl.getUniformBlockIndex(this.programInfo.program, "Camera");
    if ( cameraBlockIndex !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.programInfo.program, cameraBlockIndex, this.constructor.CAMERA_BIND_POINT); // 0

    const cameraDebugBlockIndex = gl.getUniformBlockIndex(this.debugProgramInfo.program, "Camera");
    if ( cameraDebugBlockIndex !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.debugProgramInfo.program, cameraDebugBlockIndex, this.constructor.CAMERA_BIND_POINT); // 0

    // Material only used to color the shapes in the debug view.
    const matBlockIdx = gl.getUniformBlockIndex(this.debugProgramInfo.program, "Material");
    if ( matBlockIdx !== gl.INVALID_INDEX ) gl.uniformBlockBinding(this.debugProgramInfo.program, matBlockIdx, this.constructor.MATERIAL_BIND_POINT); // 1
  }

  // ----- NOTE: Attributes ----- //

  /** @type {object} */
  attributeProperties = {};

  /** @type {twgl.BufferInfo} */
  attributeBufferInfo = {};

  /** @type {twgl.VertexArrayInfo} */
  vertexArrayInfo = {};

  /** @type {twgl.VertexArrayInfo} */
  debugVertexArrayInfo = {};

  get VAI() { return this.debugView ? this.debugVertexArrayInfo : this.vertexArrayInfo; }

  /**
   * Initialize attributes for the shader.
   * Requires that programInfo be defined.
   */
  _initializeAttributes() {
    this.attributeProperties = this._defineAttributeProperties();
    this.attributeBufferInfo = twgl.createBufferInfoFromArrays(this.gl, this.attributeProperties);
    this.vertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.programInfo, this.attributeBufferInfo);
    this.debugVertexArrayInfo = twgl.createVertexArrayInfo(this.gl, this.debugProgramInfo, this.attributeBufferInfo);
    for ( const channel of this.channels.values() ) {
      channel.locate(this.programInfo.program);
      channel.locate(this.debugProgramInfo.program);
    }
  }

  /**
   * Build the vertex and index buffers along with any other attributes.
   * @returns {object} The attribute property object passed to twgl.createBufferInfoFromArrays.
   */
  _defineAttributeProperties() {
    const gl = this.gl;
    const bytes = Float32Array.BYTES_PER_ELEMENT;
    const stride = this.constructor.stride * bytes;
    const { vertices, indices } = this.vo;

    // Vertex buffer, shared by every vertex attribute and by both VAOs.
    // https://github.com/greggman/twgl.js/issues/132.
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl[this.constructor.VERTEX_DRAW_TYPE]);

    // Vertices.
    const attrProps = {
      aPosition: {
        numComponents: 3,
        buffer: this.vertexBuffer,
        type: gl.FLOAT,
        stride,
        offset: 0,
      },

      aNormal: {
        numComponents: 3,
        buffer: this.vertexBuffer,
        type: gl.FLOAT,
        stride,
        offset: 3 * bytes,
      },

      indices,
    };

    // Per-instance attributes: each channel owns its layout.
    for ( const channel of this.channels.values() ) Object.assign(attrProps, channel.attribProps());
    return attrProps;
  }

  // ----- NOTE: Shape lifecycle ----- //

  /** Add or update one instance and mark it for drawing. */
  add(datum) {
    if ( datum.voVersion !== this.voVersion ) this._uploadVertices(datum); // Only per-shape VOs ever change.
    for ( const channel of this.channels.values() ) channel.set(datum); // No-op if values unchanged.
    this.instances.set(datum.id, datum);
    this.renderSet.add(datum.id);
  }

  remove(id) {
    for ( const channel of this.channels.values() ) channel.delete(id);
    this.instances.delete(id);
    this.renderSet.delete(id);
  }

  _uploadVertices(datum) {
    const gl = this.gl;
    const { vertices, indices } = datum.vo;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl[this.constructor.VERTEX_DRAW_TYPE]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.attributeBufferInfo.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.voVersion = datum.voVersion;
  }

  // ----- NOTE: Rendering ----- //

  /**
   * The render set stores shapes to be rendered.
   * When render is called, prerender will upload changes for the shape as needed.
   * To lock in the shape model, call prerender manually after adding shapes.
   * @type {Set<string>}
   */
  renderSet = new Set();

  clearRenderSet() { this.renderSet.clear(); }

  updateBuffers() { for ( const channel of this.channels.values() ) channel.sync(); }

  /** @type {WeakMap<WebGLProgram, BufferChannel[]>} */
  #advanceCache = new WeakMap();

  /**
   * Advance functions for every per-instance attribute.
   */
  _advanceFns() {
    const program = this.program.program;
    let fns = this.#advanceCache.get(program);
    if ( !fns ) {
      fns = [...this.channels.values()].flatMap(ch => ch.advanceFns(this.attributeBufferInfo.attribs, program));
      this.#advanceCache.set(program, fns);
    }
    return fns;
  }

  _instanceIndices(ids) {
    const idMap = this.channels.get("aModel").tracker.facetIdMap;
    return new Set(ids.map(id => idMap.get(id)).sort((a, b) => a - b)); // Consecutive-run draws need sorted indices.
  }

  /**
   * Group render-set ids by cull direction.
   * A mirrored matrix flips the winding, so it flips the cull.
   */
  _idsByCull() {
    const out = new Map();
    for ( const id of this.renderSet ) {
      const { direction, mirrored } = this.instances.get(id);
      const cull = mirrored ? -direction : direction;
      if ( !out.has(cull) ) out.set(cull, []);
      out.get(cull).push(id);
    }
    return out;
  }

  /**
   * Prerender triggers updates to the GPU data as needed prior to rendering.
   */
  prerender() {
    this.updateBuffers();
  }

  /**
   * Draw all placeables in the instance set, using the current webGL settings.
   */
  render(debug = false) {
    if ( !this.renderSet.size ) return;

    // console.debug(`Drawable ${this.constructor.name}|Render. Debug? ${debug}`);

    this.prerender();
    this.debugView = debug;

    const gl = this.gl;
    const webGL2 = this.webGL2;
    const programInfo = this.program;
    webGL2.useProgram(programInfo);
    webGL2.setCulling(true);
    webGL2.setCullFace("BACK");

    gl.bindVertexArray(this.VAI.vertexArrayObject);

    // twgl.setBuffersAndAttributes(gl, programInfo, this.attributeBufferInfo);
    this._draw()

    gl.bindVertexArray(null);
    // gl.finish(); // For debugging.
  }

  _draw() {
    const CULL = GeometricPrimitive.CULL_FACES;
    const advanceFns = this._advanceFns();
    const nIndices = this.vo.indices.length;
    for ( const [cull, ids] of this._idsByCull() ) {
      if ( cull === CULL.NONE ) this.webGL2.setCulling(false);
      else {
        this.webGL2.setCulling(true);
        this.webGL2.setCullFace(cull === CULL.FRONT ? "FRONT" : "BACK");
      }
      WebGL2.drawInstancedSet(this.gl, this._instanceIndices(ids), nIndices, advanceFns);
    }
  }

  destroy() {
    const gl = this.gl;
    for ( const channel of this.channels.values() ) channel.destroy();
    this.channels.clear();
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.attributeBufferInfo.indices);
    gl.deleteVertexArray(this.vertexArrayInfo.vertexArrayObject);
    gl.deleteVertexArray(this.debugVertexArrayInfo.vertexArrayObject);
    this.instances.clear();
    this.renderSet.clear();
  }
}

export class TexturedDrawable extends Drawable {

  /** @type {boolean} */
  static TEXTURED = true;

  /** @type {number} */
  static stride = 8; // Position (3) + Normal (3) + UV (2)

  constructor(opts) {
    super(opts);

    this.addChannel("aAlphaThreshold", 1, d => [d.primitive.alphaThreshold]);
    this.addChannel("aTextureIndex", 1, d => [this.textureData.indexMap.get(d.primitive.textureURL)?.index ?? 0], { type: Int32Array });
  }

  _defineAttributeProperties() {
    const attrProps = super._defineAttributeProperties();

    // Add the texture coordinates.
    const bytes = Float32Array.BYTES_PER_ELEMENT;
    attrProps.aTexCoord = {
      numComponents: 2,
      buffer: this.vertexBuffer,
      type: this.gl.FLOAT,
      stride: this.constructor.stride * bytes,
      offset: 6 * bytes,
    };
    return attrProps;
  }

  // ----- NOTE: Textures ----- //

  #fallbackTexture;

  static textureOptions(gl) {
    return {
      target: gl.TEXTURE_2D,
      level: 0,
      minMag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      internalFormat: gl.RGBA,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
    };
  }


  // TODO: Can we get the texture url from the textures map (WebGLTexture)?
  // Should we store an object there?

  // TODO: Can we store one texture using static because we are reusing this.gl throughout?

  _initializeUniforms() {
    super._initializeUniforms();

    // Set a fallback texture.
    const gl = this.gl;
    this.#fallbackTexture ??= twgl.createTexture(gl, { src: [0, 0, 0, 0] });
    this.textureData.sourceMap.set("", this.#fallbackTexture);

    // Array of hardware texture units we will use for batching.
    // Use Int32 to match what gl.uniform1iv expects.
    const textureUnits = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    // Tell the normal shader program to map the uTextures array to texture units 0–15.
    const uTexturesLoc = gl.getUniformLocation(this.programInfo.program, "uTextures[0]");
    if ( uTexturesLoc !== null ) {
      gl.useProgram(this.programInfo.program);
      gl.uniform1iv(uTexturesLoc, textureUnits);
    }

    /* Doesn't work:
    twgl.setUniforms(this.programInfo, {
      uTextures: textureUnits,
    });
    */

    // Same for debug program.
    const uTexturesDebugLoc = gl.getUniformLocation(this.debugProgramInfo.program, "uTextures[0]");
    if ( uTexturesDebugLoc !== null ) {
      gl.useProgram(this.debugProgramInfo.program);
      gl.uniform1iv(uTexturesDebugLoc, textureUnits);
    }

    // Reset program state.
    this.webGL2.useProgram(null);
  }

  // ----- NOTE: Texture batching ------ //

  add(datum) {
    this.trackTexture(datum.primitive.textureURL, datum.primitive);
    super.add(datum);
  }

  /**
   * Link a specific texture url to a specific batch index.
   * @type {string[][]} Batch and index number.
   */
  textureData = {
    batchIndices: [[]], /** @type {url[15][]} */
    sourceMap: new Map(), /** @type {Map<url, WebGLTexture>} */
    indexMap: new Map(), /** @type {Map<url, { batch: number, index: number}>} */
  }

  /**
   * Add a texture to the tracking set.
   * @param {string} src                    URL of the texture
   * @param {GeometricPrimitive} shape
   * @returns {object}
   * - @prop {number} index
   * - @prop {number} batch
   */
  trackTexture(src, shape) {
    if ( this.textureData.indexMap.has(src) ) return;
    this._initializeWebGLTexture(shape);
    const { batchIndices, indexMap } = this.textureData;
    let batch = batchIndices.findIndex(arr => arr.length < 16);
    if ( !~batch ) { batch = batchIndices.length; batchIndices.push([]); }
    indexMap.set(src, { batch, index: batchIndices[batch].length });
    batchIndices[batch].push(src);
  }

  _initializeWebGLTexture(shape) {
    const src = shape.textureURL;
    if ( this.textureData.sourceMap.has(src) ) return;

    const textureOpts = this.constructor.textureOptions(this.gl);

    // Attempt to pull the pre-loaded image from Foundry's PIXI cache.
    const pixiTexture = PIXI.Assets.get(src);

    // Pass the HTMLImageElement directly for a synchronous upload.
    // This avoids the blue solid image when the texture is first displayed.
    if ( pixiTexture
      && pixiTexture.baseTexture.resource.source ) textureOpts.src = pixiTexture.baseTexture.resource.source;

    // Fallback to async URL loading.
    else textureOpts.src = src;

    // Could pass a third callback argument to createTexture to rerender if async loading, but challenging to implement here.
    this.textureData.sourceMap.set(src, twgl.createTexture(this.gl, textureOpts));
  }


  _draw() {
    const gl = this.gl;
    const { batchIndices, sourceMap } = this.textureData;
    const advanceFns = this._advanceFns();
    const nIndices = this.vo.indices.length;
    this.webGL2.setCulling(false); // Viewable from both sides.

    for ( const urls of batchIndices ) {
      urls.forEach((url, unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, sourceMap.get(url) ?? this.#fallbackTexture);
      });
      const batchURLs = new Set(urls);
      const ids = [...this.renderSet].filter(id => batchURLs.has(this.instances.get(id).primitive.textureURL));
      if ( !ids.length ) continue;
      WebGL2.drawInstancedSet(gl, this._instanceIndices(ids), nIndices, advanceFns);
    }
  }

  destroy() {
    for ( const tex of this.textureData.sourceMap.values() ) this.gl.deleteTexture(tex);
    super.destroy();
  }
}


/**
 * Handle constrained token target drawing.
 * Uses a separate fragment shader to test whether a wall segment blocks the viewpoint.
 * The shader tests if a 2d ray from the fragment location to the token center intersects the 2d wall.
 */
export class ConstrainedDrawable extends Drawable {


  /** @type {number} */
  static NUM_CONSTRAINING_WALLS = 4; // Should be 6 or less to fit with maximum number of attributes.

  /**
   * Locate walls that intersect the token border.
   * @param {GeometricPrimitive} tokenShape
   * @returns {number[][]} Array of [x1, y1, x2, y2]
   */
  static intersectingWallSegments(tokenAABB, levelId) {
    // For speed, take everything that crosses the token aabb.
    // Shrink by two pixels to avoid walls that simply are on the edge.
    using aabb = tokenAABB.clone();
    aabb.min.x += 2;
    aabb.min.y += 2;
    aabb.min.z += 2;
    aabb.max.x -= 2;
    aabb.max.y -= 2;
    aabb.max.z -= 2;

    const wallMgr = CONFIG[GEOMETRY_LIB_ID].geometryManager.walls;
    const out = [];
    canvas.scene.walls.forEach(wallD => {
      const wallGeom = wallMgr.geomForDocument(wallD);
      if ( !wallGeom.couldBlock({ levelId, senseType: "move" }) ) return;

      // For each wall, we ultimately only need the plane from the wall.
      for ( const shape of wallGeom.shapes ) {
        const testFace = shape.faces[0];
        if ( aabb.overlapsConvexPolygon3d(testFace) ) {
          const wallD = wallGeom.placeableDocument;
          out.push({ plane: testFace.plane, coords: wallD.c });
          break;
        }
      }
    });

    // Sort by closest plane to the center of the token.
    using ctr = tokenAABB.center;
    out.sort((obj0, obj1) => obj0.plane.distanceToPoint(ctr) - obj1.plane.distanceToPoint(ctr));
    return out.map(obj => obj.coords);
  }

  constructor(opts) {
    super(opts);

    this.addChannel("aTokenCenter", 2, d => {
      const ctr = d.primitive.center;
      return [ctr.x, ctr.y];
    })
    this.addChannel("aNumClipPlanes", 1, d => [this._numClipPlanes(d.primitive, d.wallSegments)], { type: Int32Array });

    const clipPlanes = Array.from({ length: this.constructor.NUM_CONSTRAINING_WALLS }, (_, i) => `aClipPlanes_${i}`);
    this.addChannel(clipPlanes, 4, d => this._clipPlanes(d.primitive, d.wallSegments))
  }

  levelId = "";

  senseType = "sight";

  _numClipPlanes(tokenAABB, wallSegments) {
    wallSegments ??= this.constructor.intersectingWallSegments(tokenAABB, this.levelId);
    return Math.min(this.constructor.NUM_CONSTRAINING_WALLS, wallSegments.length);
  }

  _clipPlanes(tokenAABB, wallSegments) {
    wallSegments ??= this.constructor.intersectingWallSegments(tokenAABB, this.levelId);
    const numClipPlanes = this._numClipPlanes(tokenAABB, wallSegments);

    // Define the normals representing planes.
    // All wall segment geoms share the same plane.
    const clipPlanes = new Float32Array(4 * this.constructor.NUM_CONSTRAINING_WALLS);
    for ( let i = 0; i < numClipPlanes; i += 1 ) clipPlanes.set(wallSegments[i], i * 4);
    return clipPlanes;
  }

  add(datum) {
    datum.wallSegments = this.constructor.intersectingWallSegments(datum.primitive.aabb, this.levelId);
    super.add(datum);
  }
}

