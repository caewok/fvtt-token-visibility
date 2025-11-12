/* globals
CONFIG,
foundry,
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { ViewerLOS, CachedViewerLOS } from "./LOS/ViewerLOS.js";
import { SmallBitSet } from "./LOS/SmallBitSet.js";

// ViewerLOS = CachedViewerLOS;


export function currentCalculator() {
  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM)];
  return CONFIG[MODULE_ID].losCalculators[calcName];
}

export function currentDebugViewerClass(type) {
  const KEYS = Settings.KEYS;
  const { TARGET } = KEYS.LOS;
  const debugViewers = CONFIG[MODULE_ID].debugViewerClasses;
  type ??= Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS;
  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[type];
  return debugViewers[calcName];
}

export function pointIndexForSet(s) { return SmallBitSet.fromIndices([...s]).word; }

/**
 * @returns {TokenBlockingConfig}  See PercentVisibleCalculator.js
 */
function TokenBlockingConfig() {
  return {
    dead: Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK) ?? true,
    live: Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK) ?? true,
    prone: Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK) ?? true,
  };
}

/**
 * @returns {BlockingConfig}  See PercentVisibleCalculator.js
 */
function BlockingConfig() {
  return {
    tokens: TokenBlockingConfig(),
    walls: true,
    tiles: true,
    regions: true,
  };
}

/**
 * @returns {CalculatorConfig|PointsCalculatorConfig}  See PercentVisibleCalculator.js and PointsCalculator.js
 */
function CalculatorConfig() {
  return {
    blocking: BlockingConfig(),
    largeTarget: Settings.get(Settings.KEYS.LOS.TARGET.LARGE) ?? false,
    debug: false,
    testLighting: true,
    senseType: "sight",
    sourceType: "lighting",

    // Points algorithm
    targetInset: Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.INSET) ?? 0.75,
    targetPointIndex: pointIndexForSet(Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.POINTS)),

    // WebGL2 Calc
    alphaThreshold: CONFIG[MODULE_ID].alphaThreshold,
    useInstancing: CONFIG[MODULE_ID].useInstancing,
  };
}

/**
 * @returns {ViewerLOSConfig} See ViewerLOS.js
 */
function LOSViewerConfig() {
  return {
    viewpointIndex: pointIndexForSet(Settings.get(Settings.KEYS.LOS.VIEWER.POINTS)),
    viewpointInset: Settings.get(Settings.KEYS.LOS.VIEWER.INSET),
    threshold: Settings.get(Settings.KEYS.LOS.TARGET.PERCENT),
    angle: true,
  };
}

/**
 * Build an LOS calculator that uses the current settings.
 * @returns {PercentVisibleCalculatorAbstract}
 */
export function buildLOSCalculator() {
  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM)];
  const calcs = CONFIG[MODULE_ID].losCalculators;
  if ( !calcs[calcName] ) {
    calcs[calcName] ??= new CONFIG[MODULE_ID].calculatorClasses[calcName](CalculatorConfig());
    calcs[calcName].initialize(); // Async.
  }
  return calcs[calcName];
}

/**
 * Build a custom LOS calculator that uses the current settings, modified by
 * custom parameters.
 * @param {CalculatorConfig|PointsCalculatorConfig} calcOptions
 * @returns {PercentVisibleCalculatorAbstract}
 */
export function buildCustomLOSCalculator(calcClass, calcCfg = {}) {
  if ( !calcClass ) {
    const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM)];
    calcClass = CONFIG[MODULE_ID].calculatorClasses[calcName];
  }
  calcCfg = foundry.utils.mergeObject(CalculatorConfig(), calcCfg, { inplace: false });
  return new calcClass(calcCfg);
}


/**
 * Build an LOS viewer for this viewer that uses the current settings.
 * @param {Token} viewer
 * @returns {ViewerLOS}
 */
export function buildLOSViewer(viewer) {
  const calculator = buildLOSCalculator();
  const viewerLOS = new ViewerLOS(viewer, calculator, LOSViewerConfig());
  return viewerLOS;
}

/**
 * Build an LOS calculator for this viewer that uses the current settings, modified by
 * custom parameters.
 * @param {Token} viewer                The viewing token
 * @param {LOSCalculator} calculator    Calculator to use
 * @param {object} [config]             Custom parameters to override default settings.
 * @returns {ViewerLOS}
 */
export function buildCustomLOSViewer(viewer, calculator, losCfg = {}) {
  calculator ??= currentCalculator();
  const losConfig = foundry.utils.mergeObject(LOSViewerConfig(), losCfg, { inplace: false });
  const viewerLOS = new ViewerLOS(viewer, calculator, losConfig);
  return viewerLOS;
}

/**
 * Build a debug viewer using the current settings.
 * @param {class} cl                    Class of the viewer
 * @param {Token} viewer                The viewing token
 * @param {LOSCalculator} calculator    Calculator to use
 * @param {object} [config]             Custom parameters to override default settings.
 */
export function buildDebugViewer(cl, viewer, calculator, losCfg = {}) {
  cl ??= currentDebugViewerClass();
  const viewerLOS = buildCustomLOSViewer(viewer, calculator, losCfg);
  return new cl(viewerLOS);
}
