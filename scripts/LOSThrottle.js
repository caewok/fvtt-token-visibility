/* globals
canvas,
CONFIG,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";
import { gridUnitsToPixels } from "./geometry/util.js";
import { Point3d } from "./geometry/3d/Point3d.js";

/* Throttle for the line-of-sight tests that detection modes make.

During a token animation or drag, Foundry re-tests the visibility of every token every frame, and each
test calls the LOS calculator. With the WebGL2 calculator, each frame that makes calls pays a stall of about
one frame while the readback waits on the GPU. So the goal is to make calls in as few frames as possible.
For other calculators, this still hits the CPU quite hard, so throttling helps limit that.

How it works:
- Results are cached per viewer, target and detection mode (see LOSCache).
- Time is split into fixed buckets of `interval` ms, aligned to the frame clock. A cached result is
  reused for the rest of its bucket, so every pair is recalculated in the same first frame of each bucket
  instead of drifting into different frames, which would multiply the stalls.
- A result is also dropped at once if the viewer or target has moved more than `maxDistance` grid squares
  since it was calculated (teleports, fast drags).
- Discrete changes (walls, doors, tiles, regions, token creation or deletion, status effects, ...) bump a
  generation counter that discards every cached result.
- After the last cached result is served, a debounced timer requests one more vision refresh, so stale values
  are replaced once the movement stops.

Only the detection-mode path uses the cache. Cover calculations and other direct callers of the calculator
are never throttled.

Console tuning: CONFIG[MODULE_ID].losThrottle = { enabled, interval (ms), maxDistance (grid distance) }.
*/

export class LOSThrottle {

  static DEFAULTS = { enabled: true, interval: 100, maxDistance: 1 };

  /** @type {{enabled: boolean, interval: number, maxDistance: number}} */
  static get config() {
    return { ...CONFIG[MODULE_ID].losThrottle ?? {}, ...this.DEFAULTS };
  }

  static get enabled() { return Boolean(LOSThrottle.config.enabled); }

  // ----- NOTE: Generation ----- //

  static #generation = 0;

  /** Changes whenever every cached result must be discarded. */
  static get generation() { return LOSThrottle.#generation; }

  static invalidateAll() { LOSThrottle.#generation += 1; }

  // ----- NOTE: Clock ----- //

  /**
   * Frame-aligned time in ms. All calls in the same ticker update share a value, so entries calculated in the same
   * visibility pass land in the same bucket. Falls back to the real clock if the ticker is not running.
   * @returns {number}
   */
  static now() {
    const t = performance.now();
    const frame = canvas?.app?.ticker?.lastTime;
    return (Number.isFinite(frame) && (t - frame) < 100) ? frame : t;
  }

  static bucket(time) { return Math.floor(time / Math.max(1, LOSThrottle.config.interval)); }

  // ----- NOTE: Entry state ----- //

  /**
   * Where the viewer is. The vision source follows the animated position.
   * @param {Token} viewer
   * @returns {{x: number, y: number, z: number}}
   */
  static viewerState(viewer) {
    const src = viewer.vision;
    const center = viewer.center;
    return { x: src?.x ?? center.x, y: src?.y ?? center.y, z: src?.elevation ?? viewer.document.elevation ?? 0 };
  }

  /**
   * Where the target is. Swap this for whatever the calculator uses if it does not follow the animation.
   * @param {Token} target
   * @returns {{x: number, y: number, z: number}}
   */
  static targetState(target) {
    const { x, y } = target.center;
    return { x, y, z: target.document.elevation ?? 0 };
  }

  /** Has a position moved no more than the allowed distance? Elevation uses scene units. */
  static #within(a, b) {
    const maxDistance = gridUnitsToPixels(LOSThrottle.config.maxDistance);
    const maxDistance2 = maxDistance * maxDistance;
    return Point3d.distanceSquaredBetween(a, b) < maxDistance2;
  }

  static makeEntry(hasLOS, viewer, target) {
    return {
      hasLOS,
      time: LOSThrottle.now(),
      viewer: LOSThrottle.viewerState(viewer),
      target: LOSThrottle.targetState(target),
    };
  }

  /** May the entry still be used for this viewer and target? */
  static isFresh(entry, viewer, target) {
    if ( LOSThrottle.bucket(entry.time) !== LOSThrottle.bucket(LOSThrottle.now()) ) {
      log(`LOSThrottle.isFresh is false based on timing for ${viewer.name}(${viewer.id}) --> ${target.name}(${target.id})`);
      return false;
    }
    if ( !LOSThrottle.#within(entry.viewer, LOSThrottle.viewerState(viewer)) ) {
      log(`LOSThrottle.isFresh is false based on viewer move for ${viewer.name}(${viewer.id}) --> ${target.name}(${target.id})`);
      return false;
    }
    if ( !LOSThrottle.#within(entry.target, LOSThrottle.targetState(target)) ) {
      log(`LOSThrottle.isFresh is false based on target move for ${viewer.name}(${viewer.id}) --> ${target.name}(${target.id})`);
      return false;
    }
    log(`LOSThrottle.isFresh is true for ${viewer.name}(${viewer.id}) --> ${target.name}(${target.id})`);

    return true;

    // return LOSThrottle.#within(entry.viewer, LOSThrottle.viewerState(viewer))
    //   && LOSThrottle.#within(entry.target, LOSThrottle.targetState(target));
  }

  // ----- NOTE: Trailing refresh ----- //

  static #timer = null;

  /**
   * Call whenever a cached result is served. Debounced: one vision refresh is requested `interval` ms after the last
   * call. That is always a later bucket than any entry served, so the refresh recalculates them.
   * During a continuous animation the timer keeps being pushed back, and entries expire by bucket instead.
   */
  static noteCacheServe() {
    clearTimeout(LOSThrottle.#timer);
    LOSThrottle.#timer = setTimeout(() => {
      LOSThrottle.#timer = null;
      LOSThrottle.refreshVisibility();
    }, LOSThrottle.config.interval);
  }

  /** Ask Foundry to re-test token visibility on the next frame. */
  static refreshVisibility() {
    if ( !canvas?.ready ) return;
    canvas.perception.update({ refreshVision: true });
  }

  // ----- NOTE: Invalidation hooks ----- //

  static #hooksRegistered = false;

  /** Changes that can alter line of sight without being a movement. */
  static INVALIDATING_HOOKS = [
    "createWall", "updateWall", "deleteWall",
    "createTile", "updateTile", "deleteTile",
    "createRegion", "updateRegion", "deleteRegion",
    "createToken", "deleteToken",
    "updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
    "updateScene", "canvasReady", "canvasTearDown",
  ];

  /** Token update keys that only describe movement. Movement is handled by the time and distance checks. */
  static MOVEMENT_KEYS = new Set(["_id", "x", "y", "elevation", "rotation", "sort", "_movementHistory", "movement", "_regions"]);

  /** Call once, e.g., in Hooks.once("init"). Safe to call again. */
  static registerHooks() {
    if ( LOSThrottle.#hooksRegistered ) return;
    LOSThrottle.#hooksRegistered = true;
    const invalidate = (doc) => {
      log(`LOSThrottle|Invalidating based on change to ${doc?.name} (${doc?.id})`);
      LOSThrottle.invalidateAll();
    }
    for ( const name of LOSThrottle.INVALIDATING_HOOKS ) Hooks.on(name, invalidate);
    Hooks.on("updateToken", (doc, changes) => {
      if ( Object.keys(changes).some(k => !LOSThrottle.MOVEMENT_KEYS.has(k)) ) {
        log(`LOSThrottle|updateToken|Invalidating based on change to ${doc.name} (${doc.id})`);
        invalidate();
      }
    });
  }
}

/**
 * Cached line-of-sight results for one viewer.
 */
export class LOSCache {

  /** @type {Map<string, object>} */
  #entries = new Map();

  #generation = LOSThrottle.generation;

  /**
   * Recent result, if still valid.
   * @param {string} key          Identifies the target and detection mode
   * @param {Token} viewer
   * @param {Token} target
   * @returns {boolean|undefined} undefined if the caller must calculate
   */
  get(key, viewer, target) {
    if ( !LOSThrottle.enabled ) return undefined;
    if ( this.#generation !== LOSThrottle.generation ) {
      this.#entries.clear();
      this.#generation = LOSThrottle.generation;
    }
    const entry = this.#entries.get(key);
    if ( !entry || !LOSThrottle.isFresh(entry, viewer, target) ) return undefined;
    LOSThrottle.noteCacheServe();
    return entry.hasLOS;
  }

  set(key, hasLOS, viewer, target) {
    if ( !LOSThrottle.enabled ) return;
    this.#entries.set(key, LOSThrottle.makeEntry(hasLOS, viewer, target));
  }

  clear() { this.#entries.clear(); }
}