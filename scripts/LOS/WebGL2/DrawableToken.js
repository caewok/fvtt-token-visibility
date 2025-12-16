/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract, DrawableObjectsWebGL2Abstract } from "./DrawableObjects.js";
import { MODULE_ID, OTHER_MODULES, FLAGS, TRACKER_IDS } from "../../const.js";
import { ObstacleOcclusionTest } from "../ObstacleOcclusionTest.js";
import { TokenGeometryTracker } from "../placeable_tracking/TokenGeometryTracker.js";
import { Hex3dVertices } from "../geometry/BasicVertices.js";
import {
  GeometryToken,
  GeometryConstrainedToken,
  GeometryCustomToken,
  GeometryLitToken,
  GeometrySquareGrid,
  GeometryHexToken,
  GeometryConstrainedCustomToken,
  GeometryLitCustomToken,
  GeometrySphericalToken,
} from "../geometry/GeometryToken.js";

import * as twgl from "./twgl.js";
import { log, getFlagFast } from "../util.js";

// Set that is used for temporary values.
// Not guaranteed to have any specific value.
const TMP_SET = new Set();


/* Handle drawing all different token types.
Regular tokens:
- instanced cubes
- instanced hex shapes
- instanced custom token shapes

If constrained config option is set:
- constrained token shapes (using token border)
- constrained custom token shapes (trimming polygons by 1+ planes)

If lit token is requested:
Option 1: 2d polygon representing the portion of the token that overlaps 1+ light polygons.
- lit token from token border
- lit custom token (trimming polygons by 1+ planes)
Option 2: TODO: Use BVH to determine lit portion of token shape; distinguish bright/dim portions
- instanced shapes
- instanced custom token shapes

Lit tokens only required for targets.

*/

/**
 * Handle drawing token types.
 * - instanced
 * - constrained (normal & custom)
 * - lit (normal & custom)
 * - custom (instanced)
 *
 * Instanced should draw all tokens. This class handles exclusion b/c the tokens fit another category.
 * Custom draws only normal custom tokens if the custom file loads.
 * Constrained and lit fall back on the polygon shape if not actually constrained/lit.
 */
export class DrawableTokenWebGL2 extends DrawableObjectsWebGL2Abstract {
  static drawConstrained(token) { return CONFIG[MODULE_ID].constrainTokens && token.isConstrainedTokenBorder; }

  static drawLit(token) { return CONFIG[MODULE_ID].litTokens && token.litTokenBorder && !token.litTokenBorder.equals(token.constrainedTokenBorder); }

  static isCustom(token) { return getFlagFast(token.document, OTHER_MODULES.ATV.KEY, FLAGS.CUSTOM_TOKENS.FILE_LOC); }

  get placeables() { return canvas.tokens.placeables; }

  drawCustom(token) {
    return this.constructor.isCustom(token)
      && this.drawables.custom.has(token.sourceId)
      && this.drawables.custom.get(token.sourceId).initialized;
  }

  drawables = {
    instanced: null,
    constrained: null,
    lit: null,
    custom: new Map(),
    spherical: null,
  };

  drawablesArray = [];

  async initialize() {
    await super.initialize();

    // Define drawables.
    this.drawables.instanced = canvas.grid.isHexagonal
      ? new DrawableHexTokenShapesWebGL2(this.renderer) : new DrawableTokenShapesWebGL2(this.renderer);
    await this.drawables.instanced.initialize();
    this.drawablesArray.push(this.drawables.instanced);

    // All constrained and lit are handled as single set of vertices/indices for each.
    // Because they change often and so instancing doesn't make sense.
    if ( CONFIG[MODULE_ID].constrainTokens ) {
      this.drawables.constrained = new DrawableConstrainedTokenShapesWebGL2(this.renderer);
      await this.drawables.constrained.initialize();
      this.drawablesArray.push(this.drawables.constrained);
    }
    if ( CONFIG[MODULE_ID].litTokens ) {
      this.drawables.lit = new DrawableLitTokenShapesWebGL2(this.renderer);
      await this.drawables.lit.initialize();
      this.drawablesArray.push(this.drawables.lit);
    }

    this.drawables.spherical = new DrawableSphericalTokenShapesWebGL2(this.renderer);
    await this.drawables.spherical.initialize();
    this.drawablesArray.push(this.drawables.spherical);


    // Custom tokens are each instanced separately.
    for ( const token of this.placeables ) {
      if ( DrawableCustomTokenShapeWebGL2.isCustom(token) ) {
        const drawable = new DrawableCustomTokenShapeWebGL2(token, this.renderer);
        await drawable.initialize();
        this.drawables.custom.set(token.sourceId, drawable);
        this.drawablesArray.push(drawable);
      }
    }
  }

  async _initializeProgram() { return; }

  // _initializePlaceableHandler() { return; }

  _initializeGeoms(_opts) { return; }

  _initializeOffsetTrackers() { return; }

  _initializeAttributes() { return; }

  _initializeUniforms() { return; }

  validateInstances() {
    for ( const drawable of this.drawablesArray ) drawable.validateInstances();
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * Camera (viewer/target) are set by the renderer and will not change between now and render.
   * @param {Frustum} frustum     Triangle shape used to represent the viewable area
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(frustum, { viewer, target, blocking } = {}) {
    for ( const drawable of this.drawablesArray ) drawable.instanceSet.clear();

    blocking.tokens ??= {};
    blocking.tokens.dead ??= true;
    blocking.tokens.live ??= true;
    blocking.tokens.prone ??= true;
    if ( !(blocking.tokens.dead || blocking.tokens.live) ) return;

    // Limit to tokens within the vision triangle.
    const tokens = ObstacleOcclusionTest.filterTokensByFrustum(frustum,
      { viewer, target, blockingTokensOpts: blocking.tokens });
    for ( const token of tokens ) {
      if ( !(this.hasPlaceable(token)) ) continue;
      if ( this.constructor.drawConstrained(token) ) this.drawables.constrained.addToInstanceSet(token);
      else if ( this.drawCustom(token) ) this.drawables.get(token.sourceId).addToInstanceSet(token);
      else this.drawables.instanced.addToInstanceSet(token);
    }
  }

  render() {
    for ( const drawable of this.drawablesArray ) drawable.render();
  }

  renderTarget(target, testLighting = false) {
    if ( !(this.hasPlaceable(target)) ) return;
    if ( testLighting && this.constructor.drawLit(target) ) this.drawables.lit.renderTarget(target);
    if ( this.constructor.drawConstrained(target) ) this.drawables.constrained.renderTarget(target);
    else if ( this.drawCustom(target) ) this.drawables.get(target.sourceId).renderTarget(target);
    else if ( CONFIG[MODULE_ID].useTokenSphere ) this.drawables.spherical.renderTarget(target);
    else this.drawables.instanced.renderTarget(target);
  }
}

export class DrawableTokenShapesWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static trackerClass = TokenGeometryTracker;

  /** @type {class} */
  static geomClass = GeometryToken;

  static targetColor = [1, 0, 0, 1];

  static vertexDrawType = "STATIC_DRAW";

  get placeables() { return canvas.tokens.placeables; }

  renderTarget(target) {
    if ( CONFIG[MODULE_ID].debug ) {
      const i = this._indexForPlaceable(target);
      log(`${this.constructor.name}|renderTarget ${target.name}, ${target.sourceId}|${i}`);
      if ( this.trackers.vi ) {
        const { vertices, indices, indicesAdj } = this.trackers.vi.viewFacetAtIndex(i);
        console.table({ vertices: [...vertices], indices: [...indices], indicesAdj: [...indicesAdj] });
      }
      if ( this.trackers.model ) {
        const model = this.trackers.model.viewFacetAtIndex(i);
        console.table({ vertices: [...this.verticesArray], indices: [...this.indicesArray], model: [...model] });
      }
    }

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.attributeBufferInfo);
    // twgl.setBuffersAndAttributes(gl, this.programInfo, this.vertexArrayInfo);
    // twgl.bindUniformBlock(gl, this.programInfo, this.renderer.uboInfo.camera);


    // Render the target red.
    // for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.targetColor[i];
    // twgl.setUniforms(this.programInfo, this.materialUniforms);

    TMP_SET.clear();
    TMP_SET.add(this._indexForPlaceable(target));
    this._drawFilteredInstances(TMP_SET)
    gl.bindVertexArray(null);
    this.gl.finish(); // For debugging
  }

  addToInstanceSet(token) {
    const idx = this._indexForPlaceable(token);
    this.instanceSet.add(idx);
  }
}

export class DrawableSphericalTokenShapesWebGL2 extends DrawableTokenShapesWebGL2 {
  /** @type {class} */
  static geomClass = GeometrySphericalToken;
}

// Group tokens into distinct hex instances.
// So draw 1x1, 2x2, etc.
export class DrawableHexTokenShapesWebGL2 extends DrawableTokenShapesWebGL2 {

  drawables = new Map();

  async initialize() {
    await super.initialize();

    // Build drawables based on all available tokens.
    for ( const token of this.placeables ) {
      const hexKey = Hex3dVertices.hexKeyForToken(token);
      if ( !this.drawables.has(hexKey) ) this.drawables.set(hexKey, new DrawableHexShape(this.renderer, this, hexKey));
    }
    for ( const drawable of this.drawables.values() ) await drawable.initialize();
  }

  filterObjects(frustum, opts) {
    super.filterObjects(frustum, opts);
    this.drawables.forEach(drawable => drawable.filterObjects());
  }

  async _initializeProgram() { return; }

  // _initializePlaceableHandler() { return; }

  _initializeGeoms(_opts) { return; }

  _initializeOffsetTrackers() { return; }

  _initializeAttributes() { return; }

  _initializeUniforms() { return; }

  validateInstances() {
    // If the tracker has been updated, check for new token hex types.
    for ( const [token, updateId] of this.placeableLastUpdated.entries() ) {
      const lastUpdate = placeable[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].updateId;
      if ( lastUpdate <= updateId ) continue; // No changes for this instance since last update.
      const hexKey = Hex3dVertices.hexKeyForToken(token);
      if ( !this.drawables.has(hexKey) ) {
        const drawable = new DrawableHexShape(this.renderer, this, hexKey);
        this.drawables.set(hexKey, drawable);
        drawable.initialize(); // Async; see DrawableHexShape#filterObjects for handling.
      }
    }

    this.drawables.forEach(drawable => drawable.validateInstances());
  }

  addToInstanceSet(tokens) {
    this.drawables.forEach(drawable => drawable.addToInstanceSet(tokens));
  }


  renderTarget(target) {
    if ( !(this.hasPlaceable(target)) ) return;
    this.drawables.forEach(drawable => drawable.renderTarget(target));
  }
}


/**
 * Uses instancing to draw a custom token model.
 * For a single custom token:
 * - builds distinct vertex/index array centered at 0,0,0.
 * - as the token moves, changes the token model matrix
 * - draws a single instanced token
 */
export class DrawableCustomTokenShapeWebGL2 extends DrawableTokenShapesWebGL2 {
  /** @type {class} */
  static geomClass = GeometryCustomToken;

//   static includeToken(token) {
//     if ( !super.includeToken(token) ) return false;
//     return this.isCustom(token);
//   }

  static isCustom(token) {
    return Boolean(getFlagFast(token.document, OTHER_MODULES.ATV.KEY, FLAGS.CUSTOM_TOKENS.FILE_LOC));
  }

  token;

  constructor(token, renderer) {
    super(renderer);
    this.token = token;
  }

  async initialize(opts = {}) {
    opts.addNormals ??= this.debugViewNormals;
    opts.addUVs ??= false;
    opts.placeable = this.token;
    this.geoms = new this.geomClass(opts);
    try {
      await this.geoms.initialize();
    } catch ( error ) {
      console.error(error);
      return; // Refuse to initialize if the geometry throws an error (likely issue with shape file).
    }
    return super.initialize();
  }

  _initializePlaceableHandler() { return; } // Can skip b/c the parent drawable controls the handler.

  _initializeGeoms() { return; } // Handled at top-level initialize.

  // _initializeOffsetTrackers // Handled by Instance drawable parent class.

  // _initializeUniforms // Handled by parent drawable object class

  get modelMatrixArray() {
    // Only need model for the designated token.
    return this.trackers.model.viewFacetById(this.token.sourceId);
  }

  _updateModelBufferForInstance(placeable) {
    if ( placeable !== this.token ) return;
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;

    // See twgl.setAttribInfoBufferFromArray.
    const tracker = this.trackers.model;
    const modelArr = tracker.viewFacetById(placeable.sourceId);
    if ( !modelArr ) console.error(`${this.constructor.name}|_updateModelBufferForInstance|Placeable ${placeable.name}, ${placeable.sourceId} not found in model tracker.`);

    const mOffset = 0; // 4 * 16 * idx
    log (`${this.constructor.name}|_updateModelBufferForInstance ${placeable.sourceId} with offset ${mOffset}`, { model: tracker.viewFacetById(placeable.sourceId) });
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, tracker.viewFacetById(placeable.sourceId));
  }

  // ----- NOTE: Placeable handler ----- //

  _updatePlaceableData(placeable) {
    return this.placeable === this.token && this.trackers.model.facetIdMap.has(placeable.sourceId);
  }

  // ----- NOTE: Render ----- //

  // Only a single token and single matrix here.
  _indexForPlaceable(_placeable) { return 0; }

  addToInstanceSet(token) {
    if ( token !== this.token ) return;
    this.instanceSet.add(0);
  }

  renderTarget(target) {
    if ( !this.initialized ) return;
    if ( this.token !== target ) return;
    super.renderTarget(target);
  }
}

export class DrawableHexShape extends DrawableTokenShapesWebGL2 {

  parent;

  static geomClass = GeometryHexToken;

  hexKey = "0_1_1";

  constructor(renderer, parentDrawableObject, hexKey = "0_1_1") {
    super(renderer);
    this.parent = parentDrawableObject;
    this.hexKey = hexKey;
    // delete this.placeableTracker; // So the getter works. See https://stackoverflow.com/questions/77092766/override-getter-with-field-works-but-not-vice-versa/77093264.
  }

//   get placeableTracker() { return this.parent.placeableTracker; }
//
//   set placeableTracker(_value) { return; } // Ignore any attempts to set it but do not throw error.

//   get numInstances() { return this.placeableTracker.trackers[this.TYPE].numFacets; }

  _initializePlaceableHandler() { return; } // Can skip b/c the region drawable controls the handler.

  _initializeGeoms(opts = {}) {
    opts.hexKey = this.hexKey;
    super._initializeGeoms(opts);
  }

  validateInstances() {
    if ( !this.initialized ) return; // Possible that this geometry was just added.
    super.validateInstances();
  }

  addToInstanceSet(token) {
    if ( !this.initialized ) return; // Possible that this geometry was just added.
    if ( Hex3dVertices.hexKeyForToken(token) !== this.hexKey ) return;
    const idx = this._indexForPlaceable(token);
    this.instanceSet.add(idx);
  }

  renderTarget(target) {
    if ( Hex3dVertices.hexKeyForToken(target) !== this.hexKey ) return;
    super.renderTarget(target);
  }
}

/**
 * Handles all constrained tokens by updating their vertices/indices based on model location.
 * If the token is not constrained, its unconstrained polygon is used.
 * Custom tokens use their custom vertices/incides, falling back on their non-custom values.
 */
export class DrawableConstrainedTokenShapesWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static geomClass = GeometryConstrainedToken;

  static geomCustomClass = GeometryConstrainedCustomToken;

  static targetColor = [1, 0, 0, 1];

  static vertexDrawType = "DYNAMIC_DRAW";

  async initialize() {
    await super.initialize();

    const opts = { addNormals: this.debugViewNormals, addUVs: false, placeable: null }
    let geomsChanged = false;
    for ( const token of this.placeables ) {
      opts.placeable = token
      if ( DrawableTokenWebGL2.isCustom(token) ) {
        const geom = new this.constructor.geomCustomClass(opts);
        await geom.initialize();
        if ( geom.initialized ) {
          this.geoms.set(token.sourceId, geom);
          geomsChanged ||= true;
        }
//         geom.initialize().then(() => {
//           if ( !geom.initialized ) return;
//           this.geoms.set(token.sourceId, geom);
//           this._updateAllPlaceableData();
//
//         });
      }
    }
    if ( geomsChanged ) this._updateAllPlaceableData();
  }

  _initializeGeoms() {
    const opts = { addNormals: this.debugViewNormals, addUVs: false, placeable: null }
    for ( const token of this.placeables ) {
      opts.placeable = token;
      this.geoms.set(token.sourceId, new GeometryConstrainedToken(opts));
    }
  }

  // TODO: Need to monitor for changes to token custom options.
  // Maybe use a separate hook and update all token geometry.

  addToInstanceSet(token) {
    const idx = this._indexForPlaceable(token);
    this.instanceSet.add(idx);
  }

  renderTarget(target) { DrawableTokenShapesWebGL2.prototype.renderTarget.call(this, target); }
}

/**
 * Same as constrained tokens but uses the lit token border.
 * Handles custom tokens in the same manner.
 */
export class DrawableLitTokenShapesWebGL2 extends DrawableConstrainedTokenShapesWebGL2 {
  /** @type {class} */
  static geomClass = GeometryLitToken;

  static geomCustomClass = GeometryLitCustomToken;

  render(_target) { return; } // No lit obstacle rendering.
}

export class DrawableGridShape extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static trackerClass = TokenGeometryTracker;

  /** @type {class} */
  static geomClass = GeometrySquareGrid;

  static vertexDrawType = "STATIC_DRAW";

  get placeables() { return []; }

  filterObjects() { return; }

  render() { return; }

  renderTarget(target) { DrawableTokenShapesWebGL2.prototype.renderTarget.call(this, target); }

  get debugViewNormals() { return false; } // No normals.
}