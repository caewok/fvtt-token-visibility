/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, TRACKER_IDS, SETTINGS } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { rangeTestPointsForToken } from "./visibility_range.js";
import { Settings } from "./settings.js";
import { Draw } from "./geometry/Draw.js";
import { buildLOSViewer } from "./LOSCalculator.js";
import { LOSCache } from "./LOSThrottle.js";
import { DETECTION_SENSE_TYPES, DETECTION_SOURCE_TYPES } from "./LOS/const.js";
import { ViewerLOS } from "./LOS/ViewerLOS.js";

export class ATVTokenHandler {

  /** @type {string} */
  static ID = TRACKER_IDS.VISIBILITY;

  /** @type {Token} */
  get viewer() { return this.losViewer.viewer; }

  /** @type {ViewerLOS} */
  losViewer;

  constructor(token) {
    token[MODULE_ID] ??= {};
    token[MODULE_ID][this.constructor.ID] = this;
    this.losViewer = buildLOSViewer(token);
  }

  get losCalc() { return this.losViewer.calculator; }

  /**
   * Set this LOS configuration to match a detection mode's settings.
   * See CONFIG.Canvas.detectionModes (and CONFIG.Canvas.visionModes)
   * @param {CONFIG.Canvas.detectionModes|CONFIG.Canvas.visionModes} [detectionMode]
   */
  setConfigForDetectionMode(dm = CONFIG.Canvas.detectionModes.basicSight, range = Number.POSITIVE_INFINITY) {
    const blockingConfig = {
      walls: dm.walls,
      tiles: dm.walls,
      regions: dm.walls,
      senseType: DETECTION_SENSE_TYPES[dm.type],
      sourceType: DETECTION_SOURCE_TYPES[dm.type], // Not currently used.
    };
    this.losViewer.config.useTemporary = true;
    this.losViewer.occlusionTester.config.useTemporary = true;
    this.losViewer.calculator.config.useTemporary = true;

    this.losViewer.config.set({ angle: dm.angle });
    this.losViewer.occlusionTester.config.set(blockingConfig);
    this.losViewer.calculator.config.set({ radius: range });
  }

  resetConfig() {
    this.losViewer.config.useTemporary = false;
    this.losViewer.occlusionTester.config.useTemporary = false;
    this.losViewer.calculator.config.useTemporary = false;
  }


  /**
   * @param {Token} target
   * @returns {number}
   */
  percentVisibilityToToken(target) {
    const losViewer = this.losViewer;
    losViewer.target = target;
    losViewer.calculate();
    return losViewer.percentVisible;
  }

  hasLOSToToken(target, range) {
    if ( !this.tokenWithinLimitedAngleVision(target) ) return false;
    if ( range && !this.tokenWithinVisibleRange(target, range) ) return false;
    const losViewer = this.losViewer;
    losViewer.target = target;
    losViewer.calculate();
    return losViewer.hasLOS;
  }

  // ----- NOTE: Throttled LOS for detection mode tests ----- //

  /**
   * Recent LOS results for the detection mode tests, which run for every viewer and target on every perception
   * refresh. Direct callers (percentVisibilityToToken, hasLOSToToken) never use this.
   * @type {LOSCache}
   */
  #losCache = new LOSCache();

  /**
   * Recent LOS result for a target and detection mode, if still valid.
   * The vision angle test is cheap and depends on rotation, so it is always run live.
   * @param {Token} target
   * @param {string} [detectionModeId=""]
   * @returns {boolean|undefined} undefined if the caller must calculate and then call cacheLOSToToken.
   */
  cachedLOSToToken(target, detectionModeId = "") {
    if ( !this.tokenWithinLimitedAngleVision(target) ) return false;
    return this.#losCache.get(`${target.id}|${detectionModeId}`, this.viewer, target);
  }

  /**
   * Store a freshly calculated LOS result for use by cachedLOSToToken.
   * @param {Token} target
   * @param {string} detectionModeId
   * @param {boolean} hasLOS
   */
  cacheLOSToToken(target, detectionModeId, hasLOS) {
    this.#losCache.set(`${target.id}|${detectionModeId}`, hasLOS, this.viewer, target);
  }

  // ----- NOTE: Range Tests ----- //

  /**
   * Is a target token within the visible range of this viewer?
   * @param {Token} target
   * @param {number} range
   * @returns {boolean} True if within range.
   */
  tokenWithinVisibleRange(target, range) {
    if ( range <= 0 ) return false;

    const testPoints = rangeTestPointsForToken(target);
    const visionOrigin = Point3d.fromPointSource(this.viewer.vision);
    const radius2 = this.viewer.getLightRadius(range) ** 2;

    // Duplicate below so that the if test does not need to be inside the loop.
    if ( Settings.get(SETTINGS.DEBUG.RANGE) ) {
      const draw = new Draw(Settings.DEBUG_RANGE);

      // Sort the unique elevations and draw largest radius for bottom.
      const elevationSet = new Set(testPoints.map(pt => pt.z));
      const elevationArr = [...elevationSet];
      elevationArr.sort((a, b) => a - b);

      // Color all the points red or green.
      // Need to draw test points from lowest to highest elevation.
      testPoints.sort((a, b) => a.z - b.z);
      testPoints.forEach(pt => {
        const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
        const inRange = dist2 <= radius2;
        const radius = elevationArr.length < 2 ? 3
          : [7, 5, 3][elevationArr.findIndex(elem => elem === pt.z)] ?? 3;
        draw.point(pt, { alpha: 1, radius, color: inRange ? Draw.COLORS.green : Draw.COLORS.red });
      });
    }

    // Test each point; return once one is found.
    return testPoints.some(pt => {
      const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
      return dist2 <= radius2;
    });
  }

  /**
   * Is a target token within the visible range of this viewer?
   * @param {Token} target
   * @param {number} range
   * @returns {boolean} True if within range.
   */
  tokenWithinLimitedAngleVision(target) {
    return ViewerLOS.targetWithinLimitedAngleVision(this.viewer.vision, target);
  }
}
