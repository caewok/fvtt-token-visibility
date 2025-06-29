/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract, DrawableObjectsWebGL2Abstract } from "./DrawableObjects.js";
import { MODULE_ID } from "../../const.js";
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { GeometryToken, GeometryConstrainedToken, GeometryLitToken, GeometrySquareGrid, GeometryHexToken } from "../geometry/GeometryToken.js";
import { TokenTracker } from "../placeable_tracking/TokenTracker.js";
import { Hex3dVertices } from "../geometry/BasicVertices.js";

import * as twgl from "./twgl.js";
import { log } from "../util.js";

// Set that is used for temporary values.
// Not guaranteed to have any specific value.
const TMP_SET = new Set();


export class DrawableTokenWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static trackerClass = TokenTracker;

  /** @type {class} */
  static geomClass = GeometryToken;

  static targetColor = [1, 0, 0, 1];

  static vertexDrawType = "STATIC_DRAW";

  // static constrained = false;

  static lit = null; // Draw tokens

  static tokenHasCustomLitBorder(token) { return token.litTokenBorder && !token.litTokenBorder.equals(token.constrainedTokenBorder); }

  static includeToken(token) {
    const { constrained, lit, tokenHasCustomLitBorder } = this
    // if ( constrained !== null && (constrained ^ token.isConstrainedTokenBorder) ) return false;
    if ( lit !== null && (lit ^ tokenHasCustomLitBorder(token)) ) return false;
    return true;
  }

  renderTarget(target) {
    if ( !(this.placeableTracker.hasPlaceable(target) && this.constructor.includeToken(target)) ) return;

    if ( CONFIG[MODULE_ID].debug ) {
      const i = this._indexForPlaceable(target);
      log(`${this.constructor.name}|renderTarget${target.name}, ${target.sourceId}|${i}`);
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

  // TODO: Handle material uniform using binding; avoid setUniforms here.
//   render() {
//     if ( !this.numObjectsToDraw ) return;
//
//     const gl = this.gl;
//     this.webGL2.useProgram(this.programInfo);
//     twgl.setBuffersAndAttributes(gl, this.programInfo, this.vertexArrayInfo);
//     // twgl.bindUniformBlock(gl, this.programInfo, this.renderer.uboInfo.camera);
//
//
//     // for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.obstacleColor[i];
//     // twgl.setUniforms(this.programInfo, this.materialUniforms);
//
//     log (`${this.constructor.name}|render ${this.numObjectsToDraw} tokens`);
//     if ( CONFIG[MODULE_ID].filterInstances ) this._drawFilteredInstances(this.instanceSet);
//     else this._drawUnfilteredInstances();
//     gl.bindVertexArray(null)
//     // this.gl.flush(); // For debugging
//   }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(visionTriangle, { viewer, target, blocking } = {}) {
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
    for ( const token of tokens ) {
      if ( !(this.placeableTracker.hasPlaceable(token) && this.constructor.includeToken(token)) ) continue;
      const idx = this._indexForPlaceable(token);
      this.instanceSet.add(idx);
    }
  }
}

// Group tokens into distinct hex instances.
// So draw 1x1, 2x2, etc.
export class DrawableHexTokenWebGL2 extends DrawableTokenWebGL2 {

  drawables = new Map();

  async initialize() {
    await super.initialize();

    // Build drawables based on all available tokens.
    for ( const token of this.placeableTracker.placeables ) {
      const hexKey = Hex3dVertices.hexKeyForToken(token);
      if ( !this.drawables.has(hexKey) ) this.drawables.set(hexKey, new DrawableHexShape(this.renderer, this, hexKey));
    }
    for ( const drawable of this.drawables.values() ) await drawable.initialize();
  }

  filterObjects(visionTriangle, opts) {
    super.filterObjects(visionTriangle, opts);
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
    if ( this.placeableTracker.updateId > this.placeableTrackerUpdateId ) {
      for ( const [token, lastUpdate] of this.placeableTracker.placeableLastUpdated.entries() ) {
        if ( lastUpdate <= this.placeableTrackerUpdateId ) continue; // No changes for this instance since last update.
        const hexKey = Hex3dVertices.hexKeyForToken(token);
        if ( !this.drawables.has(hexKey) ) {
          const drawable = new DrawableHexShape(this.renderer, this, hexKey);
          this.drawables.set(hexKey, drawable);
          drawable.initialize(); // Async; see DrawableHexShape#filterObjects for handling.
        }
      }
    }
    this.drawables.forEach(drawable => drawable.validateInstances());
  }

  renderTarget(target) {
    if ( !(this.placeableTracker.hasPlaceable(target) && this.constructor.includeToken(target)) ) return;
    this.drawables.forEach(drawable => drawable.renderTarget(target));
  }

}

export class DrawableHexShape extends DrawableTokenWebGL2 {

  parent;

  static geomClass = GeometryHexToken;

  hexKey = "0_1_1";

  constructor(renderer, parentDrawableObject, hexKey = "0_1_1") {
    super(renderer);
    this.parent = parentDrawableObject;
    this.hexKey = hexKey;
    delete this.placeableTracker; // So the getter works. See https://stackoverflow.com/questions/77092766/override-getter-with-field-works-but-not-vice-versa/77093264.
  }

  get placeableTracker() { return this.parent.placeableTracker; }

  set placeableTracker(_value) { return; } // Ignore any attempts to set it but do not throw error.

  get numInstances() { return this.placeableTracker.trackers[this.TYPE].numFacets; }

  _initializePlaceableHandler() { return; } // Can skip b/c the region drawable controls the handler.

  _initializeGeoms(opts = {}) {
    opts.hexKey = this.hexKey;
    super._initializeGeoms(opts);
  }

  validateInstances() {
    if ( !this.initialized ) return; // Possible that this geometry was just added.
    super.validateInstances();
  }

  filterObjects() {
    this.instanceSet.clear();
    if ( !this.initialized ) return; // Possible that this geometry was just added.
    for ( const idx of this.parent.instanceSet ) {
      const id = this.placeableTracker.tracker.facetIdMap.getKeyAtIndex(idx);
      const token = this.placeableTracker.getPlaceableFromId(id);
      if ( !token ) continue;
      if ( Hex3dVertices.hexKeyForToken(token) !== this.hexKey ) continue;
      this.instanceSet.add(idx);
    }
  }

  renderTarget(target) {
    if ( Hex3dVertices.hexKeyForToken(target) !== this.hexKey ) return;
    super.renderTarget(target);
  }
}

export class ConstrainedDrawableTokenWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static trackerClass = TokenTracker;

  /** @type {class} */
  static geomClass = GeometryConstrainedToken;

  static targetColor = [1, 0, 0, 1];

  static vertexDrawType = "DYNAMIC_DRAW";

  static constrained = true;

  static lit = null;

  static includeToken(token) { return DrawableTokenWebGL2.includeToken.call(this, token); }

  static tokenHasCustomLitBorder(token) { return DrawableTokenWebGL2.tokenHasCustomLitBorder(token); }

  // ----- NOTE: Attributes ----- //

  /**
   * Indices of tokens that should be include in this render set.
   * E.g., constrained token indices.
   * Link the PH index to the number for this geom.
   * @type {Map<number, number>}
   */
  _includedPHIndices = new Map();

  /**
   * Indices of tokens that have a geometry but are not currently used.
   */
  // _inactivePHIndices = new Map();

  _initializeGeoms() {
    const opts = {
      addNormals: this.debugViewNormals,
      addUVs: false,
      placeable: null,
    };
    const geomClass = this.constructor.geomClass;
    const geoms = this.geoms;
    let geomIndex = 0;
    geoms.length = 0;
    for ( const token of this.placeableTracker.placeables ) {
      if ( this.constructor.includeToken(token) ) this._includedPHIndices.set(token.sourceId, geomIndex);
      geomIndex += 1;
      opts.placeable = token;
      geoms.set(token.sourceId, new geomClass(opts));
    }
  }

  // ----- NOTE: Placeable Handler ----- //

  _updateAllInstances() {
    this._initializeGeoms();
    super._updateAllInstances();
  }

  _updateInstanceVertex(token) {
    // TODO: Keep a map of inactive indices?
    const shouldInclude = this.constructor.includeToken(token);

    // If a constrained geometry is already created, either remove from set or update.
    if ( this._includedPHIndices.has(token.sourceId) ) {
      if ( !shouldInclude ) {
        this._includedPHIndices.delete(token.sourceId);
        return true;
      }
      return super._updateInstanceVertex(token);

    } else if ( shouldInclude ) return false; // Must insert a new geometry.
    // TODO: Add new tokens on the end without redoing every geometry?

    else return true;
  }

  // ----- NOTE: Rendering ----- //

  filterObjects(...args) { DrawableTokenWebGL2.prototype.filterObjects.call(this, ...args); }

  renderTarget(target) { DrawableTokenWebGL2.prototype.renderTarget.call(this, target); }

  render() { DrawableTokenWebGL2.prototype.render.call(this); }

}

export class LitDrawableTokenWebGL2 extends ConstrainedDrawableTokenWebGL2 {
  /** @type {class} */
  static geomClass = GeometryLitToken;

  static constrained = null;

  static lit = true;
}

export class ConstrainedDrawableHexTokenWebGL2 extends ConstrainedDrawableTokenWebGL2 {
  renderTarget(target) {
    DrawableTokenWebGL2.prototype.renderTarget.call(this, target); // Render all, not just constrained tokens.
  }

  validateInstances() {
    const placeableTracker = this.placeableTracker;
    if ( placeableTracker.updateId <= this.placeableTrackerUpdateId ) return DrawableTokenWebGL2.prototype.validateInstances.call(this); // No changes since last update.

    // If any constrained token has changed, need to rebuild.
    // If the token is now unconstrained, that is fine (will be skipped).
    for ( const [token, lastUpdate] of placeableTracker.placeableLastUpdated.entries() ) {
      if ( lastUpdate <= this.placeableTrackerUpdateId ) continue; // No changes for this instance since last update.
      if ( token?.isConstrainedTokenBorder ) this._updateAllInstances();
    }
    DrawableTokenWebGL2.prototype.validateInstances.call(this);
  }
}

export class LitDrawableHexTokenWebGL2 extends ConstrainedDrawableTokenWebGL2 {
  static constrained = null;

  renderTarget(target) {
    DrawableTokenWebGL2.prototype.renderTarget.call(this, target); // Render all, not just constrained tokens.
  }

  validateInstances() {
    const placeableTracker = this.placeableTracker;
    if ( placeableTracker.updateId <= this.placeableTrackerUpdateId ) return DrawableTokenWebGL2.prototype.validateInstances.call(this); // No changes since last update.

    // If any constrained token has changed, need to rebuild.
    // If the token is now unconstrained, that is fine (will be skipped).
    for ( const [token, lastUpdate] of placeableTracker.placeableLastUpdated.entries() ) {
      if ( lastUpdate <= this.placeableTrackerUpdateId ) continue; // No changes for this instance since last update.
      if ( token?.litTokenBorder ) this._updateAllInstances();
    }
    DrawableTokenWebGL2.prototype.validateInstances.call(this);
  }
}

export class DrawableGridShape extends DrawableTokenWebGL2 {
  /** @type {class} */
  static geomClass = GeometrySquareGrid;

  static vertexDrawType = "STATIC_DRAW";

  static constrained = null;

  static lit = null;

  filterObjects() { return; }

  render() { return; }

  get debugViewNormals() { return false; } // No normals.
}