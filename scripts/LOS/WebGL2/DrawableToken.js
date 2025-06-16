/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract, DrawableObjectsWebGL2Abstract } from "./DrawableObjects.js";
import { MODULE_ID } from "../../const.js";
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { GeometryToken, GeometryConstrainedToken, GeometryLitToken, GeometrySquareGrid } from "../geometry/GeometryToken.js";
import { TokenInstanceHandler } from "../placeable_handler/PlaceableTokenInstanceHandler.js";

import * as twgl from "./twgl.js";
import { log } from "../util.js";

// Set that is used for temporary values.
// Not guaranteed to have any specific value.
const TMP_SET = new Set();


export class DrawableTokenWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TokenInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryToken;

  static targetColor = [1, 0, 0, 1];

  static vertexDrawType = "STATIC_DRAW";

  static constrained = false;

  static lit = null; // Draw tokens

  static tokenHasCustomLitBorder(token) { return token.litTokenBorder && !token.litTokenBorder.equals(token.constrainedTokenBorder); }

  static includeToken(token) {
    const { constrained, lit, tokenHasCustomLitBorder } = this
    if ( constrained !== null && (constrained ^ token.isConstrainedTokenBorder) ) return false;
    if ( lit !== null && (lit ^ tokenHasCustomLitBorder(token)) ) return false;
    return true;
  }

  renderTarget(target) {
    const idx = this.placeableHandler.instanceIndexFromId.get(target.id);
    if ( typeof idx === "undefined" ) return;
    if ( !this.constructor.includeToken(target) ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.attributeBufferInfo);
    // twgl.setBuffersAndAttributes(gl, this.programInfo, this.vertexArrayInfo);
    // twgl.bindUniformBlock(gl, this.programInfo, this.renderer.uboInfo.camera);


    // Render the target red.
    // for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.targetColor[i];
    // twgl.setUniforms(this.programInfo, this.materialUniforms);

    log (`${this.constructor.name}|renderTarget ${target.name}, ${target.id}`);
    TMP_SET.clear();
    TMP_SET.add(idx);
    this._drawFilteredInstances(TMP_SET)
    gl.bindVertexArray(null);
    // this.gl.flush(); // For debugging
  }

  // TODO: Handle material uniform using binding; avoid setUniforms here.
  render() {
    if ( !this.instanceSet.size ) return;

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.vertexArrayInfo);
    // twgl.bindUniformBlock(gl, this.programInfo, this.renderer.uboInfo.camera);


    // for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.obstacleColor[i];
    // twgl.setUniforms(this.programInfo, this.materialUniforms);

    log (`${this.constructor.name}|render ${this.instanceSet.size} tokens`);
    if ( CONFIG[MODULE_ID].filterInstances ) this._drawFilteredInstances(this.instanceSet);
    else this._drawUnfilteredInstances();
    gl.bindVertexArray(null)
    // this.gl.flush(); // For debugging
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
      if ( !this.constructor.includeToken(token) ) continue;
      if ( tokens.has(token )) instanceSet.add(idx);
    }
  }
}



// TODO: Fix.
// Should group tokens into distinct hex instances.
// So draw 1x1, 2x2, etc.
export class DrawableHexTokenWebGL2 extends DrawableTokenWebGL2 {

}

export class ConstrainedDrawableTokenWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TokenInstanceHandler;

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
    for ( const [idx, token] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( this.constructor.includeToken(token) ) this._includedPHIndices.set(idx, geomIndex);
      geomIndex += 1;
      opts.placeable = token;
      geoms.push(new geomClass(opts));
    }
  }

  // ----- NOTE: Placeable Handler ----- //

  _updateAllInstances() {
    this._initializeGeoms();
    super._updateAllInstances();
  }

  _updateInstanceVertex(idx) {
    // TODO: Keep a map of inactive indices?
    const token = this.placeableHandler.placeableFromInstanceIndex.get(idx);
    const shouldInclude = this.constructor.includeToken(token);

    // If a constrained geometry is already created, either remove from set or update.
    if ( this._includedPHIndices.has(idx) ) {
      if ( !shouldInclude ) {
        this._includedPHIndices.delete(idx);
        return true;
      }
      return super._updateInstanceVertex(idx);

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
    const placeableHandler = this.placeableHandler;
    if ( placeableHandler.updateId <= this.placeableHandlerUpdateId ) return DrawableTokenWebGL2.prototype.validateInstances.call(this); // No changes since last update.

    // If any constrained token has changed, need to rebuild.
    // If the token is now unconstrained, that is fine (will be skipped).
    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      const token = placeableHandler.placeableFromInstanceIndex.get(idx);
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
    const placeableHandler = this.placeableHandler;
    if ( placeableHandler.updateId <= this.placeableHandlerUpdateId ) return DrawableTokenWebGL2.prototype.validateInstances.call(this); // No changes since last update.

    // If any constrained token has changed, need to rebuild.
    // If the token is now unconstrained, that is fine (will be skipped).
    for ( const [idx, lastUpdate] of placeableHandler.instanceLastUpdated.entries() ) {
      if ( lastUpdate <= this.placeableHandlerUpdateId ) continue; // No changes for this instance since last update.
      const token = placeableHandler.placeableFromInstanceIndex.get(idx);
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