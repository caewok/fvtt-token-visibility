/* globals
CONFIG,
foundry,
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { AbstractViewerLOS, CachedAbstractViewerLOS } from "./LOS/AbstractViewerLOS.js";

export function currentCalculator() {
  let viewpointClassName = Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM);
  viewpointClassName = viewpointClassName.replace("los-algorithm-", "");
  return CONFIG[MODULE_ID].sightCalculators[viewpointClassName];
}

export function currentCalculatorClass(type) {
  const KEYS = Settings.KEYS;
  const { TARGET } = KEYS.LOS;
  const calcs = CONFIG[MODULE_ID].sightCalculatorClasses;
  type ??= Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS;
  type = type.replace("los-algorithm-", "");
  return calcs[type];
}

export function currentDebugViewerClass(type) {
  const KEYS = Settings.KEYS;
  const { TARGET } = KEYS.LOS;
  const debugViewers = CONFIG[MODULE_ID].debugViewerClasses;
  type ??= Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS;
  type = type.replace("los-algorithm-", "");
  return debugViewers[type];
}


function TokenBlockingConfig() {
  return {
    dead: Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK) ?? true,
    live: Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK) ?? true,
    prone: Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK) ?? true,
  };
}

function BlockingConfig() {
  return {
    tokens: TokenBlockingConfig(),
    walls: true,
    tiles: true,
    regions: true,
  };
}

function CalculatorConfig() {
  return {
    blocking: BlockingConfig(),
    largeTarget: Settings.get(Settings.KEYS.LOS.TARGET.LARGE) ?? false,
    debug: false,
    testLighting: false,
    senseType: "sight",

    // Points algorithm
    pointAlgorithm: Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER ?? false,
    targetInset: Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.INSET) ?? 0.75,
    points3d: Settings.get(Settings.KEYS.LOS.TARGET.POINT_OPTIONS.POINTS3D) ?? false,

    // WebGL2 Calc
    alphaThreshold: CONFIG[MODULE_ID].alphaThreshold,
    useInstancing: CONFIG[MODULE_ID].useInstancing,
  };
}

function LOSViewerConfig() {
  return {
    viewpointClass: Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM),
    numViewpoints: Settings.get(Settings.KEYS.LOS.VIEWER.NUM_POINTS),
    viewpointOffset: Settings.get(Settings.KEYS.LOS.VIEWER.INSET),
    threshold: Settings.get(Settings.KEYS.LOS.TARGET.PERCENT),
  };
}

/**
 * Build an LOS calculator that uses the current settings.
 * @returns {PercentVisibleCalculatorAbstract}
 */
export function buildLOSCalculator() {
  let viewpointClassName = Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM);
  viewpointClassName = viewpointClassName.replace("los-algorithm-", "");
  if ( !CONFIG[MODULE_ID].sightCalculators[viewpointClassName] ) {
    const viewpointClass = AbstractViewerLOS.VIEWPOINT_CLASSES[viewpointClassName];
    const calcClass = viewpointClass.calcClass;
    CONFIG[MODULE_ID].sightCalculators[viewpointClassName] = new calcClass(CalculatorConfig());
    CONFIG[MODULE_ID].sightCalculators[viewpointClassName].initialize();  // Async
  }
  return CONFIG[MODULE_ID].sightCalculators[viewpointClassName];
}

/**
 * Build a custom LOS calculator that uses the current settings, modified by
 * custom parameters.
 * @returns {PercentVisibleCalculatorAbstract}
 */
export function buildCustomLOSCalculator({ viewpointClass, ...calcCfg } = {}) {
  const calcConfig = foundry.utils.mergeObject(CalculatorConfig(), calcCfg, { inplace: false });

  viewpointClass ??= Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM);
  const viewpointClassName = AbstractViewerLOS.convertViewpointClassToName(viewpointClass);
  viewpointClass = AbstractViewerLOS.VIEWPOINT_CLASSES[viewpointClassName];
  const calcClass = viewpointClass.calcClass;
  return new calcClass(calcConfig)
}

/**
 * Build an LOS viewer for this viewer that uses the current settings.
 * @param {Token} viewer
 * @returns {AbstractViewerLOS}
 */
export function buildLOSViewer(viewer) {
  const calculator = buildLOSCalculator();
  return new CachedAbstractViewerLOS(viewer, { calculator, ...LOSViewerConfig() });
}

/**
 * Build an LOS calculator for this viewer that uses the current settings, modified by
 * custom parameters.
 * @param {Token} viewer
 * @param {object} [config]         Custom parameters to override default settings.
 * @returns {AbstractViewerLOS}
 */
export function buildCustomLOSViewer(viewer, { calculator, viewpointClass, numViewpoints, viewpointOffset, threshold, ...calcCfg } = {}) {
  const calcConfig = foundry.utils.mergeObject(CalculatorConfig(), calcCfg, { inplace: false });

  // Merge object won't work if the props are undefined as it will change the config to undefined.
  const losConfig = { ...LOSViewerConfig() };
  if ( typeof calculator !== "undefined" ) losConfig.calculator = calculator;
  if ( typeof viewpointClass !== "undefined" ) losConfig.viewpointClass = viewpointClass;
  if ( typeof numViewpoints !== "undefined" ) losConfig.numViewpoints = numViewpoints;
  if ( typeof viewpointOffset !== "undefined" ) losConfig.viewpointOffset = viewpointOffset;
  if ( typeof threshold !== "undefined" ) losConfig.threshold = threshold;

  return new CachedAbstractViewerLOS(viewer, { ...losConfig, ...calcConfig});
}

/**
 * Build a debug viewer using the current settings.
 * @param {class} cl                Class of the viewer
 * @param {object} [config]         Custom parameters to override default settings.
 */
export function buildDebugViewer(cl, { calculator, viewpointClass, numViewpoints, viewpointOffset, threshold, ...calcCfg } = {}) {
  cl ??= currentDebugViewerClass();
  const calcConfig = foundry.utils.mergeObject(CalculatorConfig(), calcCfg, { inplace: false });

  // Merge object won't work if the props are undefined as it will change the config to undefined.
  const losConfig = { ...LOSViewerConfig() };
  if ( typeof calculator !== "undefined" ) losConfig.calculator = calculator;
  if ( typeof viewpointClass !== "undefined" ) losConfig.viewpointClass = viewpointClass;
  if ( typeof numViewpoints !== "undefined" ) losConfig.numViewpoints = numViewpoints;
  if ( typeof viewpointOffset !== "undefined" ) losConfig.viewpointOffset = viewpointOffset;
  if ( typeof threshold !== "undefined" ) losConfig.threshold = threshold;

  return new cl({ ...losConfig, ...calcConfig});
}


