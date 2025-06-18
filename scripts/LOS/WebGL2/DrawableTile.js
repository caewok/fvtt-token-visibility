/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { GeometryTile } from "../geometry/GeometryTile.js";
import {
  TileInstanceHandler,
  SceneInstanceHandler,
} from "../placeable_tracking/PlaceableTileInstanceHandler.js";

import * as twgl from "./twgl.js";

// Set that is used for temporary values.
// Not guaranteed to have any specific value.
const TMP_SET = new Set();

export class DrawableTileWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static handlerClass = TileInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryTile;

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

  /** @type {WebGLTexture[]} */
  textures = new Map();

  _initializeGeoms(opts = {}) {
    opts.addUVs = true;
    super._initializeGeoms(opts);
  }

  _defineAttributeProperties() {
    const vertexProps = super._defineAttributeProperties();
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
    for ( const [id, idx] of this.placeableHandler.instanceIndexFromId.entries() ) {
      const tile = this.placeableHandler.getPlaceableFromId(id);
      if ( !tile ) continue;
      textureOpts.src = this.constructor.tileSource(tile);
      this.textures.set(idx, twgl.createTexture(this.gl, textureOpts))
    }
  }

  _rebuildModelBuffer() {
    super._rebuildModelBuffer();
    this._initializeTextures();
  }

  _drawFilteredInstances(instanceSet) {
    // TODO: Bind instead of setting textures.
/*
// Create textures
const textures = [];
for (let i = 0; i < numImages; ++i) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  textures.push(texture);
}

// Load images and upload to textures
for (let i = 0; i < numImages; ++i) {
  const image = new Image();
  image.src = imageUrls[i];
  image.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, textures[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D); // If using mipmaps
  };
}

// Draw with different textures
for (let i = 0; i < numImages; ++i) {
  // Activate the texture unit
  gl.activeTexture(gl[`TEXTURE${i}`]);  // e.g., gl.TEXTURE0, gl.TEXTURE1
  // Bind the texture
  gl.bindTexture(gl.TEXTURE_2D, textures[i]);
  // Set the shader uniform (assuming u_sampler is the uniform name)
  gl.uniform1i(shaderProgram.uSampler, i); // or whatever index matches the texture unit

  // Draw the scene using the current texture
  gl.drawArrays(gl.TRIANGLES, 0, numVertices);  // Or drawElements
}


*/

    // const uniforms = { uTileTexture: -1 };
    for ( const idx of instanceSet ) {
      TMP_SET.clear();
      TMP_SET.add(idx);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures.get(idx));
      // uniforms.uTileTexture = this.textures.get(idx);
      // twgl.setUniforms(this.programInfo, uniforms);
      super._drawFilteredInstances(TMP_SET);
    }
  }

  _drawUnfilteredInstances() {
    // Still need to draw each one at a time so texture uniform can be changed.
    const instanceSet = this.placeableHandler.instanceIndexFromId.values(); // Not a set but works in the for/of loop above.
    super._drawFilteredInstances(instanceSet);
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
    const tileIds = tiles.map(t => t.id);
    for ( const [id, idx] of this.placeableHandler.instanceIndexFromId.entries() ) {
      if ( tileIds.has(id) ) instanceSet.add(idx);
    }
  }
}

// TODO: Fix DrawableSceneBackgroundWebGL2.
export class DrawableSceneBackgroundWebGL2 extends DrawableTileWebGL2 {
  /** @type {class} */
  static handlerClass = SceneInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryTile;

  /** @type ImageBitMap */
  backgroundImage;

  async initialize() {
    const promises = [this._createProgram()];
    this.placeableHandler.registerPlaceableHooks();
    this._initializePlaceableHandler();

    const sceneObj = this.placeableHandler.instanceIndexFromId.index[0];
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

  validateInstances() { return; } // Nothing to change.

  filterObjects() { return; }

  _sourceForTile() { return this.backgroundImage; }
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


