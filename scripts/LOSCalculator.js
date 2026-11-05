/* globals
CONFIG,
foundry,
*/
"use strict";

import { MODULE_ID, TRACKER_IDS, REGION_BEHAVIORS, ENUMS } from "./const.js";
import { Settings } from "./settings.js";
import { ViewerLOS } from "./LOS/ViewerLOS.js";
import { pointIndexForSet } from "./LOS/SmallBitSet.js";
import { NULL_SET } from "./geometry/util.js";
import { ConfigHandler } from "./ConfigHandler.js";
import { ObstacleOcclusionTest } from "./geometry/ObstacleOcclusionTest.js";

export function currentCalculator() { return CONFIG[MODULE_ID].losCalculator; }

export function effectiveAlgorithmType() {
  const TYPES = ENUMS.ALGORITHM_TYPES;
  const type = Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM);
  return ( type === TYPES.WEBGL2 && CONFIG[MODULE_ID].webGL2Unavailable )
    ? TYPES.GEOMETRIC : type;
}


export function currentDebugViewerClass(type) {
  type ??= effectiveAlgorithmType();
  const debugViewers = CONFIG[MODULE_ID].debugViewerClasses;
  type ??= Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM) ?? ENUMS.ALGORITHM_TYPES.POINTS;
  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[type];
  return debugViewers[calcName];
}

/**
 * @returns {TokenBlockingConfig}  See PercentVisibleCalculator.js
 */
export function TokenBlockingConfig() {
  return new ConfigHandler({
    dead: () => Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK),
    live: () => Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK),
    prone: () => Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK),

    // No settings enabled for now.
    enemies: true,
    allies: true,
    excludedStatuses: NULL_SET,
  });
}

function regionBlocks(regionD) {
  const typeKey = `${MODULE_ID}.${REGION_BEHAVIORS.BLOCK_SIGHT}`;
  return regionD.behaviors.some(b => b.type === typeKey);
}

/**
 * @returns {BlockingConfig}  See PercentVisibleCalculator.js
 */
export function BlockingConfig() {
  return new ConfigHandler({
    senseType: "sight",
    tokens: TokenBlockingConfig(),
    walls: true,
    tiles: true,
    regions: true,
    levels: {
      background: true,
      foreground: true,
    },

    filters: {
      regions: [regionBlocks],
      tiles: [],
      tokens: [],
      walls: [],
      levels: [],
    },
  });
}

/** @returns {CalculatorConfig|PointsCalculatorConfig}  See PercentVisibleCalculator.js and PointsCalculator.js */
export function CalculatorConfig() {
  return new ConfigHandler({
    largeTarget: () => Settings.get(Settings.KEYS.LOS.TARGET.LARGE) || false,
    debug: false,
    sourceType: "lighting",
    tokenShapeType: "tokenBorder",
    radius: Number.POSITIVE_INFINITY,

    // Points algorithm
    targetInset: () => Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.INSET) ?? 0.75,
    targetPointIndex: () => pointIndexForSet(Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.POINTS)),
  });
}

/** @returns {ViewpointInsetsConfig} */
export function ViewpointInsetsConfig() {
  return new ConfigHandler({
    top: () => Settings.get(Settings.KEYS.LOS.VIEWER.INSETS.TOP),
    bottom: () => Settings.get(Settings.KEYS.LOS.VIEWER.INSETS.BOTTOM),
    sides: () => Settings.get(Settings.KEYS.LOS.VIEWER.INSETS.SIDES),
  });
}


/** @returns {ViewerLOSConfig} See ViewerLOS.js */
export function LOSViewerConfig() {
  return new ConfigHandler({
    viewpointIndex: () => pointIndexForSet(Settings.get(Settings.KEYS.LOS.VIEWER.POINTS)),
    insets: ViewpointInsetsConfig(),
    threshold: () => Settings.get(Settings.KEYS.LOS.TARGET.PERCENT),
    angle: true,
  });
}

/**
 * Build the default occlusion tester that, by default, uses the current settings.
 * @param {object} [otCfg={}]           Blocking configuration settings that deviate from the current
 * @returns {ObstacleOcclusionTest}
 */
export function buildOcclusionTester(otCfg = {}) {
  const ot = new ObstacleOcclusionTest();
  ot.config = BlockingConfig();
  ot.config.set(otCfg);
  return ot;
}

/**
 * Return the calculator class according to the current settings.
 * @returns {class}
 */
export function getCurrentCalculatorClass() {
  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[effectiveAlgorithmType()];
  return CONFIG[MODULE_ID].calculatorClasses[calcName];
}

/**
 * Build an LOS calculator that, by default, uses the current settings.
 * @param {class} [calcClass]                               The calculator class
 * @param {ObstacleOcclusionTester} [occlusionTester]       The occlusion tester to use
 * @param {object} [calcCfg={}]                             Calculator configuration settings
 *                                                          that deviate from the current
 * @returns {PercentVisibleCalculatorAbstract}
 */
export function buildLOSCalculator({ calcClass, occlusionTester, ...calcCfg } = {}) {
  calcClass ??= getCurrentCalculatorClass();
  occlusionTester ??= CONFIG[MODULE_ID].occlusionTester ?? buildOcclusionTester();
  const calculator = new calcClass();
  calculator.config = CalculatorConfig();
  calculator.config.set(calcCfg);
  calculator.occlusionTester = occlusionTester;
  calculator.initialize(); // Async.
  return calculator;
}

/**
 * Build an LOS viewer for this viewer that, by default, uses the current settings.
 * @param {Token} viewer
 * @param {PercentVisibleCalculatorAbstract} calculator
 * @param {object} [losCfg={}]                             LOS configuration settings that deviate from the current
 * @returns {ViewerLOS}
 */
export function buildLOSViewer(viewer, { calculator, ...losCfg } = {}) {
  calculator ??= CONFIG[MODULE_ID].losCalculator ?? buildLOSCalculator();
  calculator.initialize(); // Async.
  const viewerLOS = new ViewerLOS(viewer, calculator);
  viewerLOS.config = LOSViewerConfig();
  viewerLOS.config.set(losCfg);
  return viewerLOS;
}

/**
 * Build an LOS calculator for this viewer that uses the current settings, modified by
 * custom parameters.
 * @param {Token} viewer                    The viewing token
 * @param {LOSCalculator} calculator        Calculator to use
 * @param {object} [losCfg={}]              Custom parameters to override default settings.
 * @returns {ViewerLOS}
 */
export function buildCustomLOSViewer(viewer, calculator, occlusionTester, losCfg = {}) {
  calculator ??= currentCalculator();
  occlusionTester ??= new ObstacleOcclusionTest();
  calculator.config.set(losCfg);
  calculator.occlusionTester = occlusionTester;
  calculator.initialize();
  const viewerLOS = new ViewerLOS(viewer, calculator);
  viewerLOS.config = LOSViewerConfig();
  viewerLOS.config.set(losCfg);
  return viewerLOS;
}

/**
 * Build a debug viewer using the current settings.
 * @param {DebugVisibilityViewerAbstract} cl                    Class of the viewer
 * @returns {DebugVisibilityViewerAbstract}
 */
export function buildDebugViewer(cl) {
  const viewerLOSFn = viewer => viewer[MODULE_ID][TRACKER_IDS.VISIBILITY].losViewer;
  return new cl(viewerLOSFn);
}
