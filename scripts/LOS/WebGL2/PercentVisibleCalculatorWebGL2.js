/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";

/* Percent visible calculator

Track percent visibility for tokens.
Caches values based on the viewer, viewer location, target, target location.
- Cache is tied to the placeable updates.


*/

const TARGETED_BY_SET = Symbol("TARGETED_SET");

export class PercentVisibleCalculatorWebGL2 {

  /** @type {number} */
  static WIDTH = 256;

  /** @type {number} */
  static HEIGHT = 256;

  /** @type {number} */
  static TERRAIN_THRESHOLD = 255 * 0.75;

  /** @type {OffscreenCanvas} */
  static glCanvas;

  /** @type {WebGL2Context} */
  gl;

  /** @type {string} */
  senseType = "sight";

  /** @type {Uint8Array} */
  bufferData = new Uint8Array(this.constructor.WIDTH * this.constructor.HEIGHT * 4);

  /** @type {RenderObstaclesWebGL2} */
  renderObstacles;

  constructor({ senseType = "sight" } = {}) {
    this.senseType = senseType;
    this.constructor.glCanvas ??= new OffscreenCanvas(this.constructor.WIDTH, this.constructor.HEIGHT);
    this.gl = this.constructor.glCanvas.getContext("webgl2");
    this.renderObstacles = new RenderObstaclesWebGL2({ gl: this.gl, senseType });
  }

  #updateKeys = new Map();

  /**
   * Has a given token changed?
   */
  tokenChanged(token) {
    // Check if this specific token needs updating.
    const ph = this.renderObstacles.drawableTarget.placeableHandler;
    const idx = ph.instanceIndexFromId.get(token.id);
    const updateId = ph.instanceLastUpdated.get(idx);
    if ( updateId > (this.#updateKeys.get(token) || 0)  ) return updateId;
    return false;
  }

  /**
   * Have the walls or tiles changed?
   */
  obstacleChanged() {
    for ( const drawableObject of this.renderObstacles.drawableObstacles ) {
      const ph = drawableObject.placeableHandler;
      if ( ph === this.renderObstacles.drawableTarget.placeableHandler ) continue;
      if ( ph.updateId > (this.#updateKeys.get(ph) || 0) ) return ph.updateId;
    }
    for ( const drawableTerrain of this.renderObstacles.drawableTerrain ) {
      const ph = drawableTerrain.placeableHandler;
      if ( ph.updateId > (this.#updateKeys.get(ph) || 0) ) return ph.updateId;
    }
    return false;
  }

  #updateObstacleCacheKeys() {
    // Token is in drawableObstacles.
    for ( const drawableObject of this.renderObstacles.drawableObstacles ) {
      const ph = drawableObject.placeableHandler;
      if ( ph === this.renderObstacles.drawableTarget.placeableHandler ) continue;
      this.#updateKeys.set(ph, ph.updateId);
    }
    for ( const drawableTerrain of this.renderObstacles.drawableTerrain ) {
      const ph = drawableTerrain.placeableHandler;
      this.#updateKeys.set(ph, ph.updateId);
    }
  }

  #updateTokenCacheKeys(token) {
    const ph = this.renderObstacles.drawableTarget.placeableHandler;
    const idx = ph.instanceIndexFromId.get(token.id);
    const updateId = ph.instanceLastUpdated.get(idx);
    this.#updateKeys.set(token, updateId);
  }

  async initialize() {
    await this.renderObstacles.initialize();
  }

  /**
   * Determine percent visible based on 3d view or return cached value.
   * @param {}
   */
  percentVisible(viewer, target, { viewerLocation, targetLocation } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);
    this._addCache(viewer, target);
    const cachedValue = this._percentVisibleCached(viewer, target, viewerLocation, targetLocation);
    if ( Number.isNumeric(cachedValue) ) return cachedValue;
    return this._percentVisible3dView(viewer, target, viewerLocation, targetLocation);
  }

  _percentVisible3dView(viewer, target, viewerLocation, targetLocation) {
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
    const { WIDTH, HEIGHT } = this.constructor;
    this.gl.readPixels(0, 0, WIDTH, HEIGHT, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.bufferData);
    const percentRed = this._percentRedPixels(this.bufferData);
    this._setCachedPercentVisible(viewer, target, viewerLocation, targetLocation, percentRed);
    return percentRed;
  }

  _percentVisibleCached(viewer, target, viewerLocation, targetLocation) {
    // Caching here is tricky.
    // If a token is updated, relationship between it and other tokens must be redone.
    // If anything else updated, assume all relationships must be redone.
    const obstacleChangeId = this.obstacleChanged();
    if ( obstacleChangeId ) {
      this.#cache.clear(); // Wipe everything.
      this.#updateObstacleCacheKeys();
      return null;
    }

    if ( this.tokenChanged(viewer) )  {
      // Wipe every token that targets this viewer.
      const targetedSet = this.#cache.get(viewer).get(TARGETED_BY_SET) || new Set();
      for ( const token of targetedSet ) this.#cache.get(token).get(viewer).clear();

      // Wipe every viewer that targets this viewer.
      this.#cache.get(viewer).clear();

      // Increment the cache key to reflect these updates.
      this.#updateTokenCacheKeys(viewer);
      return null;
    }

    if ( this.tokenChanged(target) ) {
      // Wipe every token that targets this viewer.
      const targetedSet = this.#cache.get(target).get(TARGETED_BY_SET) || new Set();
      for ( const token of targetedSet ) this.#cache.get(token).get(target).clear();

      // Wipe every viewer that targets this viewer.
      this.#cache.get(target).clear();

      // Increment the cache key to reflect these updates.
      this.#updateTokenCacheKeys(target);
      return null;

    }
    return this._getCachedPercentVisible(viewer, target, viewerLocation, targetLocation);
  }

  _percentRedPixels(pixels) {
    const terrainThreshold = this.constructor.TERRAIN_THRESHOLD;
    let countRed = 0;
    let countRedBlocked = 0;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      countRed += Boolean(r);
      countRedBlocked += Boolean(r) * Boolean(b || (g > terrainThreshold))
    }
    return (countRed - countRedBlocked) / countRed;
  }

  #cache = new WeakMap();

  static locationKey(viewerLocation, targetLocation) { return `${viewerLocation.key}_${targetLocation.key}`; }

  _getCachedPercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.#cache.get(viewer).get(target).get(this.constructor.locationKey(viewerLocation, targetLocation));
  }

  _setCachedPercentVisible(viewer, target, viewerLocation, targetLocation, percentVisible) {
    this.#cache.get(viewer).get(target).set(this.constructor.locationKey(viewerLocation, targetLocation), percentVisible);
  }

  _addCache(viewer, target) {
    if ( !this.#cache.has(viewer) ) this.#cache.set(viewer, new WeakMap());
    const viewerCache = this.#cache.get(viewer);
    if ( !viewerCache.has(target) ) viewerCache.set(target, new Map());

    if ( !this.#cache.has(target) ) this.#cache.set(target, new WeakMap());
    const targetCache = this.#cache.get(target);

    // Add viewer --> target to the target's targeted set.
    if ( !targetCache.has(TARGETED_BY_SET) ) targetCache.set(TARGETED_BY_SET, new Set());
    targetCache.get(TARGETED_BY_SET).add(viewer);
  }
}