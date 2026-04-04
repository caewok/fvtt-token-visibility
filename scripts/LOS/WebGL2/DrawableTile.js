/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2 } from "./DrawableObjects.js";
import { GEOMETRY_LIB_ID } from "../../geometry/const.js";
import * as twgl from "./twgl.js";

// Set that is used for temporary values.
// Not guaranteed to have any specific value.
const TMP_SET = new Set();

export class DrawableTileWebGL2 extends DrawableObjectsInstancingWebGL2 {

  /** @type {class} */
  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.TileInstancedVertices; }

  /** @type {class} */
  static get geomClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableGeometry.TileGeometry; }

  static addUVs = true;

  get placeables() { return canvas.tiles.placeables; }

  // ----- NOTE: Program ----- //
  async _createProgram(opts = {}) {
    opts.isTile = true;
    return super._createProgram(opts);
  }

  // ----- NOTE: Uniforms ----- //

  _initializeUniforms() {
    super._initializeUniforms();
    this._initializeTextures();
  }

  // ----- NOTE: Attributes ----- //

  /** @type {Map<string, WebGLTexture>} */
  textures = new Map();

  // ----- NOTE: Tile texture ----- //

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

  static tileSource(tile) { return tile.texture.baseTexture.resource.source; }

  _initializeTextures() {
    const textureOpts = this.constructor.textureOptions(this.gl);
    for ( const tile of this.placeables ) {
      textureOpts.src = this.constructor.tileSource(tile);
      this.textures.set(tile.sourceId, twgl.createTexture(this.gl, textureOpts));
    }
  }

  _rebuildModelBuffer() {
    super._rebuildModelBuffer();
    this._initializeTextures();
  }

  _drawFilteredInstances(instanceSet) {
    instanceSet ??= this.instanceSet;
    for ( const idx of instanceSet ) {
      TMP_SET.clear();
      TMP_SET.add(idx);
      const id = this.trackers.model.facetIdMap.getKeyAtIndex(idx);
      if ( !id ) continue;
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures.get(id));
      // uniforms.uTileTexture = this.textures.get(idx);
      // twgl.setUniforms(this.programInfo, uniforms);
      super._drawFilteredInstances(TMP_SET);
    }
  }

  _drawUnfilteredInstances() {
    // Still need to draw each one at a time so texture uniform can be changed.

    const instanceSet = Array.fromRange(this.trackers.indices.facetIdMap.maxIndex);
    super._drawFilteredInstances(instanceSet);
  }
}
