/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";
import { RenderObstacles } from "../WebGPU/RenderObstacles.js";
import { WebGPUDevice } from "../WebGPU/WebGPU.js";
import { AsyncQueue } from "../WebGPU/AsyncQueue.js";
import { WebGPUSumRedPixels } from "../WebGPU/SumPixels.js";

/* Percent visible calculator

Track percent visibility for tokens.
Caches values based on the viewer, viewer location, target, target location.
- Cache is tied to the placeable updates.
*/

const TARGETED_BY_SET = Symbol("TARGETED_SET");

class PercentVisibleCalculatorAbstract {

  /** @type {number} */
  static WIDTH = 128;

  /** @type {number} */
  static HEIGHT = 128;

  /** @type {number} */
  static TERRAIN_THRESHOLD = 255 * 0.75;

  /** @type {string} */
  senseType = "sight";

  /** @type {RenderObstaclesWebGL2} */
  renderObstacles;

  constructor({ senseType = "sight" } = {}) {
    this.senseType = senseType;
  }

  async initialize() {
    await this.renderObstacles.initialize();

    // Track the update ids for each.
    this._updateObstacleCacheKeys();
    for ( const token of this.tokenHandler.placeableFromInstanceIndex.values() ) this._updateTokenCacheKeys(token);
  }

  // ----- NOTE: Visibility testing ----- //

  /**
   * Determine percent visible based on 3d view or return cached value.
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {object} [opts]
   * @param {Point3d} [opts.viewerLocation]   Where the camera is located
   * @param {Point3d} [opts.targetLocation]   Where the camera is looking to in 3d space
   * @returns {number}
   */
  percentVisible(viewer, target, { viewerLocation, targetLocation } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    // Check if we already know this value for the given parameters.
    let cachedValue = null;
    if ( !this._updateCache(viewer, target, viewerLocation, targetLocation) ) {
      cachedValue = this._percentVisibleCached(viewer, target, viewerLocation, targetLocation);
    }
    if ( Number.isNumeric(cachedValue) ) return cachedValue;

    // Recalculate the percent visible for the given parameters, and cache the value.
    const percentRed = this._percentVisible(viewer, target, viewerLocation, targetLocation);
    this._setCachedPercentVisible(viewer, target, viewerLocation, targetLocation, percentRed);
    return percentRed;
  }

  /**
   * Determine percent visible based on current 3d view
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @returns {number}
   */
  _percentVisible(viewer, target, viewerLocation, targetLocation) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
    return this._percentRedPixels();
  }

  _percentRedPixels() { console.error("PercentVisibleCalculator|Must be overriden by child class.") }

  // ----- NOTE: Caching ----- //

  /**
   * Retrieve a unique key based on viewer and target locations.
   * @param {Point3d} viewerLocation
   * @param {Point3d} targetLocation
   * @returns {string}
   */
  static locationKey(viewerLocation, targetLocation) { return `${viewerLocation.key}_${targetLocation.key}`; }

  /** @type {WeakMap<Token|PlaceableInstanceHandler>} */
  #updateKeys = new WeakMap();

  /**
   * @typedef {WeakMap<Token, WeakMap>} Cache
   * Cached visibility percentages, organized by viewer, token, and viewerLocation_targetLocation.
   * Organized by viewer --> target --> location key --> percent visible
   *                     --> set of tokens that target this viewer
   * @keys {Token} Viewer tokens
   * @elements {WeakMap<Token|TARGETED_BY_SET, Map|Set>}
   *   - @keys {Token} Tokens targeted by the viewer
   *     - @elements {Map<string, number>} Percent visible
   *   - @keys {TARGETED_BY_SET} Set
   *     - @elements {Set<Token>} Set of tokens that target the viewer
   */

  /** @type {Cache} */
  _cache = new WeakMap();

  /**
   * Determine if a cache update is required and mark/update the cache accordingly
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @returns {boolean} Returns true if an update was required.
   */
  _updateCache(viewer, target, _viewerLocation, _targetLocation) {
    // Caching here is tricky.
    // If a token is updated, relationship between it and other tokens must be redone.
    // If anything else updated, assume all relationships must be redone.
    if ( this.obstacleChanged() ) {
      this._cache = new WeakMap(); // Wipe everything; cannot clear a WeakMap.
      this._updateObstacleCacheKeys();
      return true;
    }
    if ( this.tokenChanged(viewer) )  {
      this._clearTokenCache(viewer);
      return true;
    }
    if ( this.tokenChanged(target) ) {
      this._clearTokenCache(target);
      return true;
    }
    return false;
  }

  _clearTokenCache(viewer) {
    // Wipe every token that targets this viewer.
    const targetedSet = this._cache.get(viewer)?.get(TARGETED_BY_SET) || new Set();
    for ( const token of targetedSet ) {
      const locMap = this._cache.get(token).get(viewer);
      if ( locMap ) locMap.clear();
    }

    // Wipe every viewer that targets this viewer.
    this._cache.set(viewer, new WeakMap()); // Wipe everything for this viewer; cannot clear a WeakMap.

    // Increment the cache key to reflect these updates.
    this._updateTokenCacheKeys(viewer);
  }

  _percentVisibleCached(viewer, target, viewerLocation, targetLocation) {
   return this._getCachedPercentVisible(viewer, target, viewerLocation, targetLocation);
  }

  /** @type {PlaceableInstanceHandler} */
  get tokenHandler() { return this.renderObstacles.drawableTargets[0].placeableHandler; }

  /** @type {PlaceableInstanceHandler[]} */
  #obstacleHandlers = [];

  get obstacleHandlers() {
    if ( this.#obstacleHandlers.length ) return this.#obstacleHandlers;

    // Excludes tokens.
    const tokenHandler = this.tokenHandler;
    this.renderObstacles.drawableObstacles.forEach(drawableObj => {
      if ( drawableObj.placeableHandler === tokenHandler ) return;
      this.#obstacleHandlers.push(drawableObj.placeableHandler);
    });
    this.renderObstacles.drawableTerrain.forEach(drawableObj => this.#obstacleHandlers.push(drawableObj.placeableHandler));
    return this.#obstacleHandlers;
  }

  /**
   * Has a given token changed?
   * @param {Token} token       Token to test against the token placeable handler
   * @returns {boolean}
   */
  tokenChanged(token) {
    // Check if this specific token needs updating.
    const ph = this.tokenHandler;
    const idx = ph.instanceIndexFromId.get(token.id);
    return ph.instanceLastUpdated.get(idx) > (this.#updateKeys.get(token) || 0);
  }

  /**
   * Have the walls or tiles changed?
   * @returns {boolean}
   */
  obstacleChanged() {
    return this.obstacleHandlers.some(ph => ph.updateId > (this.#updateKeys.get(ph) || 0));
  }

  /**
   * Update the cache keys for obstacles to match current update id for each placeable.
   */
  _updateObstacleCacheKeys() {
    this.obstacleHandlers.forEach(ph => this.#updateKeys.set(ph, ph.updateId));
  }

  /**
   * Update the cache keys for tokens to match current update id for a given token.
   */
  _updateTokenCacheKeys(token) {
    const ph = this.tokenHandler;
    const idx = ph.instanceIndexFromId.get(token.id);
    const updateId = ph.instanceLastUpdated.get(idx);
    this.#updateKeys.set(token, updateId);
  }

  _getCachedPercentVisible(viewer, target, viewerLocation, targetLocation) {
    this._addCache(viewer, target);
    this._cache.get(viewer).get(target).get(this.constructor.locationKey(viewerLocation, targetLocation));
  }

  _setCachedPercentVisible(viewer, target, viewerLocation, targetLocation, percentVisible) {
    this._addCache(viewer, target);
    this._cache.get(viewer).get(target).set(this.constructor.locationKey(viewerLocation, targetLocation), percentVisible);
  }

  _addCache(viewer, target) {
    if ( !this._cache.has(viewer) ) this._cache.set(viewer, new WeakMap());
    const viewerCache = this._cache.get(viewer);
    if ( !viewerCache.has(target) ) viewerCache.set(target, new Map());

    if ( !this._cache.has(target) ) this._cache.set(target, new WeakMap());
    const targetCache = this._cache.get(target);

    // Add viewer --> target to the target's targeted set.
    if ( !targetCache.has(TARGETED_BY_SET) ) targetCache.set(TARGETED_BY_SET, new Set());
    targetCache.get(TARGETED_BY_SET).add(viewer);
  }

  printCache() {
    const res = [];
    for ( const viewer of canvas.tokens.placeables ) {
      const targetMap = this._cache.get(viewer);
      if ( !targetMap ) continue;
      for ( const target of canvas.tokens.placeables ) {
        const locMap = targetMap.get(target);
        if ( !locMap ) continue;
        for ( const [key, value] of locMap.entries() ) {
          if ( key === TARGETED_BY_SET ) continue;
          res.push({ viewer: viewer.name, target: target.name, key, value });
        }
      }
    }
    console.table(res);
    return res;
  }
}

export class PercentVisibleCalculatorWebGL2 extends PercentVisibleCalculatorAbstract {
  /** @type {Uint8Array} */
  bufferData;

  /** @type {OffscreenCanvas} */
  static glCanvas;

  /** @type {WebGL2Context} */
  gl;

  constructor(opts) {
    super(opts);
    const { WIDTH, HEIGHT } = this.constructor;
    this.constructor.glCanvas ??= new OffscreenCanvas(WIDTH, HEIGHT);
    const gl = this.gl = this.constructor.glCanvas.getContext("webgl2");
    this.renderObstacles = new RenderObstaclesWebGL2({ gl, senseType: this.senseType });
    this.bufferData = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  }

  _percentVisible(...args) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    return super._percentVisible(...args);
  }

  _percentRedPixels() {
    const gl = this.gl;
    this.gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferData);
    const pixels = this.bufferData;
    const terrainThreshold = this.constructor.TERRAIN_THRESHOLD;
    let countRed = 0;
    let countRedBlocked = 0;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const hasR = Boolean(r === 255);

      countRed += hasR;
      countRedBlocked += hasR * (Boolean(b === 255) || Boolean(g > terrainThreshold))
    }
    return (countRed - countRedBlocked) / countRed;
  }

}

export class PercentVisibleCalculatorWebGPU extends PercentVisibleCalculatorWebGL2 {

  /** @type {OffScreenCanvas} */
  static gpuCanvas;

  /** @type {GPUCanvasContext} */
  gpuCtx;


  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.renderObstacles = new RenderObstacles(device,
      { senseType: this.senseType, width: this.constructor.WIDTH, height: this.constructor.HEIGHT });

    this.constructor.gpuCanvas ??= new OffscreenCanvas(this.constructor.WIDTH, this.constructor.HEIGHT);
    this.gpuCtx = this.constructor.gpuCanvas.getContext("webgpu");
    this.gpuCtx.configure({
      device,
      format: WebGPUDevice.presentationFormat,
      alphamode: "premultiplied", // Instead of "opaque"
    });

//     const gl = this.gl;
//     this.texture = gl.createTexture();
//     this.framebuffer = gl.createFramebuffer();
//     gl.bindTexture(gl.TEXTURE_2D, this.texture);
//     gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
//     gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
  }

  async initialize() {
    await super.initialize();
    this.renderObstacles.setRenderTextureToCanvas(this.constructor.gpuCanvas);
  }

  _percentVisible(...args) {
    this.renderObstacles.prerender(); // TODO: Can we move prerender into render?
    return super._percentVisible(...args);
  }

  /**
   * Must first render to the gpuCanvas.
   * Then call this to retrieve the pixel data.
   */
  _readRenderResult() {
    const gl = this.gl;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.constructor.gpuCanvas);
    super._readRenderResult();
    // return { pixels: this.bufferData, x: 0, y: 0, width, height };
  }

  /** @type {PlaceableInstanceHandler} */
  get tokenHandler() { return this.renderObstacles.drawableTokens[0].placeableHandler; }

  /** @type {PlaceableInstanceHandler[]} */
  #obstacleHandlers = [];

  get obstacleHandlers() {
    if ( this.#obstacleHandlers.length ) return this.#obstacleHandlers;

    // Excludes tokens.
    this.renderObstacles.drawableObstacles.forEach(drawableObj => {
      this.#obstacleHandlers.push(drawableObj.placeableHandler);
    });
    return this.#obstacleHandlers;
  }
}

export class PercentVisibleCalculatorWebGPUAsync extends PercentVisibleCalculatorAbstract {
  /** @type {WebGPUSumRedPixels} */
  sumPixels;

  constructor({ device, ...opts } = {}) {
    super(opts);
    this.device = device;
    this.renderObstacles = new RenderObstacles(device,
      { senseType: this.senseType, width: this.constructor.WIDTH, height: this.constructor.HEIGHT })
    this.sumPixels = new WebGPUSumRedPixels(device);
    this.queue = new AsyncQueue();
  }

  async initialize() {
    await super.initialize();
    this.renderObstacles.setRenderTextureToInternalTexture()
    await this.sumPixels.initialize();
  }

  _percentVisible(...args) {
    this.renderObstacles.prerender(); // TODO: Can we move prerender into render?
    return super._percentVisible(...args);
  }

  async percentVisibleAsync(viewer, target, { viewerLocation, targetLocation } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    // Check if we already know this value for the given parameters.
    let cachedValue = null;
    if ( !this._updateAsyncCache(viewer, target, viewerLocation, targetLocation)
       && this._hasCachedValue(viewer, target, viewerLocation, targetLocation) ) {
      cachedValue = this._percentVisibleCached(viewer, target, viewerLocation, targetLocation);
    }
    if ( Number.isNumeric(cachedValue) ) return cachedValue;

    // Recalculate the percent visible for the given parameters, and cache the value.
    const percentRed = await this._percentVisibleAsync(viewer, target, viewerLocation, targetLocation);
    this._setCachedPercentVisible(viewer, target, viewerLocation, targetLocation, percentRed);
    return percentRed;
  }

  async _percentVisibleAsync(viewer, target, viewerLocation, targetLocation) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    viewerLocation ??= Point3d.fromTokenCenter(viewer);
    targetLocation ??= Point3d.fromTokenCenter(target);

    this.renderObstacles.prerender();
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
    const res = await this.sumPixels.compute(this.renderObstacles.renderTexture);
    return (res.red - res.redBlocked) / res.red;
  }

  /** @type {PlaceableInstanceHandler} */
  get tokenHandler() { return this.renderObstacles.drawableTokens[0].placeableHandler; }

  /** @type {PlaceableInstanceHandler[]} */
  #obstacleHandlers = [];

  get obstacleHandlers() {
    if ( this.#obstacleHandlers.length ) return this.#obstacleHandlers;

    // Excludes tokens.
    this.renderObstacles.drawableObstacles.forEach(drawableObj => {
      this.#obstacleHandlers.push(drawableObj.placeableHandler);
    });
    return this.#obstacleHandlers;
  }

  // ----- NOTE: Caching ----- //

  /**
   * Retrieve a unique key based on viewer and target locations.
   * For this async version, track the differential between viewer/viewerloc and target/targetloc.
   * This is so as the token moves, its last value based on location can still be determined.
   * @param {Token} viewer
   * @param {Token} target
   * @param {Point3d} viewerLocation
   * @param {Point3d} targetLocation
   * @returns {string}
   */
  static locationKey(viewer, target, viewerLocation, targetLocation) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const viewerCtr = Point3d.fromTokenCenter(viewer, Point3d._tmp1);
    const targetCtr = Point3d.fromTokenCenter(target, Point3d._tmp2);
    const viewerLoc = viewerCtr.subtract(viewerLocation, viewerCtr);
    const targetLoc = targetCtr.subtract(targetLocation, targetCtr);
    return `${viewerLoc.key}_${targetLoc.key}`;
  }

  /**
   * Determine if a cache update is required and mark/update the cache accordingly
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @returns {boolean} Returns false because the cached value should always be used until async compute is done
   */
  _updateCache(viewer, target, viewerLocation, targetLocation) {
    this._updateAsyncCache(viewer, target, viewerLocation, targetLocation);
    return false;
  }

  /**
   * Determine if a cache update is required and mark/update the cache accordingly
   * @param {Token} viewer                  Token representing the camera/sight
   * @param {Token} target                  What the viewer is looking at
   * @param {Point3d} viewerLocation        Where the camera is located
   * @param {Point3d} targetLocation        Where the camera is looking to in 3d space
   * @returns {boolean} Returns true if a cache update was required.
   */
  _updateAsyncCache(viewer, target, _viewerLocation, _targetLocation) {
    if ( this.obstacleChanged() ) {
      // Wipe everything. Cannot iterate a weak map, so use the tokens in the scene.
      canvas.tokens.placeables.forEach(token => this._clearTokenCache(token));

      // Increment the cache keys.
      this._updateObstacleCacheKeys();
      return true;
    }

    if ( this.tokenChanged(viewer) && this._cache.has(viewer) ) {
      // Wipe every token that targets this viewer.
      const targetedSet = this._cache.get(viewer).get(TARGETED_BY_SET) || new Set();

      // Wipe every viewer that targets this viewer.
      targetedSet.add(viewer);
      targetedSet.forEach(token => this._clearTokenCache(token));
      targetedSet.delete(viewer);

      // Increment the cache key to reflect these updates.
      this._updateTokenCacheKeys(viewer);
      return true;
    }

    if ( this.tokenChanged(target) && this._cache.has(target) ) {
      // Wipe every token that targets this target.
      const targetedSet = this._cache.get(target).get(TARGETED_BY_SET) || new Set();

      // Wipe every viewer that targets this target.
      targetedSet.add(target);
      targetedSet.forEach(token => this._clearTokenCache(token));
      targetedSet.delete(target);

      // Increment the cache key to reflect these updates.
      this._updateTokenCacheKeys(target);
      return true;
    }
    return false;
  }

  _clearTokenCache(viewer) {
    const targetMap = this._cache.get(viewer);
    if ( !targetMap ) return;

    // Mark each location for the viewer-target pair as dirty.
    for ( const tokenT of canvas.tokens.placeables ) {
      const locMap = targetMap.get(tokenT);
      if ( !locMap ) continue;
      for ( const obj of locMap.values() ) obj.dirty = true;
    }
  }

  _hasCachedValue(viewer, target, viewerLocation, targetLocation) {
    this._addCache(viewer, target);
    return Boolean(this._cache
      .get(viewer)
        .get(target)
          .get(this.constructor.locationKey(viewer, target, viewerLocation, targetLocation)));
  }

  _getCachedPercentVisible(viewer, target, viewerLocation, targetLocation) {
    this._addCache(viewer, target);
    const res = this._cache
      .get(viewer)
        .get(target)
          .get(this.constructor.locationKey(viewer, target, viewerLocation, targetLocation)) ?? {
      value: 0,
      dirty: true,
    };

    // If the cache is dirty, return the old value for now and run an async task to update with the new value.
    // TODO: Trigger an LOS or Cover update? Pass through a callback to trigger?
    if ( res.dirty ) {
      const task = async () => {
        const percentRed = await this._percentVisibleAsync(viewer, target, { viewerLocation, targetLocation });
        this._setCachedPercentVisible(viewer, target, viewerLocation, targetLocation, percentRed);
      }
      this.queue.enqueue(task)
      // TODO: Trigger an LOS / Cover update, probably using callback.
   }
    return res.value;
  }

  _setCachedPercentVisible(viewer, target, viewerLocation, targetLocation, percentVisible) {
    this._addCache(viewer, target);
    const locMap = this._cache.get(viewer).get(target);

    const res = locMap.get(this.constructor.locationKey(viewer, target, viewerLocation, targetLocation)) ?? {};
    res.value = percentVisible;
    res.dirty = false;
    locMap.set(this.constructor.locationKey(viewer, target, viewerLocation, targetLocation), res);
  }

  printCache() {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const res = [];
    for ( const viewer of canvas.tokens.placeables ) {
      const targetMap = this._cache.get(viewer);
      if ( !targetMap ) continue;
      for ( const target of canvas.tokens.placeables ) {
        const locMap = targetMap.get(target);
        if ( !locMap ) continue;
        for ( const [key, value] of locMap.entries() ) {
          if ( key === TARGETED_BY_SET ) continue;
          // const targetLoc = Point3d.invertKey(key.split("_")[0]); // Inversion not working for 3d keys
          res.push({ viewer: viewer.name, target: target.name, key , value: value.value, dirty: value.dirty });
        }
      }
    }
    console.table(res);
    return res;
  }
}