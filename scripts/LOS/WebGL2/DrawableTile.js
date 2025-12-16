/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import { ObstacleOcclusionTest } from "../ObstacleOcclusionTest.js";
import { GeometryTile } from "../geometry/GeometryTile.js";
import {
  TileGeometryTracker,
} from "../placeable_tracking/TileGeometryTracker.js";

import * as twgl from "./twgl.js";

// Set that is used for temporary values.
// Not guaranteed to have any specific value.
const TMP_SET = new Set();

export class DrawableTileWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static trackerClass = TileGeometryTracker;

  /** @type {class} */
  static geomClass = GeometryTile;

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

  _initializeGeoms(opts = {}) {
    opts.addUVs = true;
    super._initializeGeoms(opts);
  }

  _defineAttributeProperties() {
    const vertexProps = super._defineAttributeProperties();
    const debugViewNormals = this.debugViewNormals;

    // coords (3), normal (3), uv (2)
    let stride = Float32Array.BYTES_PER_ELEMENT * 5;
    if ( debugViewNormals ) {
      stride = Float32Array.BYTES_PER_ELEMENT * 8;
      vertexProps.aNorm.stride = stride;
    }
    vertexProps.aPos.stride = stride;
    vertexProps.aUV = {
      numComponents: 2,
      buffer: vertexProps.aPos.buffer,
      stride,
      offset: Float32Array.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3),
    }
    return vertexProps;
  }

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


