/* globals
CONFIG,
foundry,
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { ViewerLOS, CachedViewerLOS } from "./LOS/ViewerLOS.js";

export function currentCalculator() {
  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM)];
  return CONFIG[MODULE_ID].sightCalculators[calcName];
}

export function currentDebugViewerClass(type) {
  const KEYS = Settings.KEYS;
  const { TARGET } = KEYS.LOS;
  const debugViewers = CONFIG[MODULE_ID].debugViewerClasses;
  type ??= Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS;
  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[type];  
  return debugViewers[calcName];
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
    testLighting: true,
    senseType: "sight",
    sourceType: "lighting",

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
    calcName: Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM),
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
  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM)]; 
  const calcs = CONFIG[MODULE_ID].losCalculators;
  calcs[calcName] ??= new CONFIG[MODULE_ID].calculatorClasses[calcName](CalculatorConfig());
  return calcs[calcName];
}

/**
 * Build a custom LOS calculator that uses the current settings, modified by
 * custom parameters.
 * @returns {PercentVisibleCalculatorAbstract}
 */
/*export function buildCustomLOSCalculator({ calcName, ...calcCfg } = {}) {
  const calcConfig = foundry.utils.mergeObject(CalculatorConfig(), calcCfg, { inplace: false });
  const calcName = ViewerLOS.VIEWPOINT_ALGORITHM_SETTINGS[Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM)]; 
  return new CONFIG[MODULE_ID].calculatorClasses[calcName](calcConfig)
}
*/

/**
 * Build an LOS viewer for this viewer that uses the current settings.
 * @param {Token} viewer
 * @returns {ViewerLOS}
 */
export function buildLOSViewer(viewer) {
  const calculator = buildLOSCalculator();
  return new ViewerLOS(viewer, { calculator, ...LOSViewerConfig() });
}

/**
 * Build an LOS calculator for this viewer that uses the current settings, modified by
 * custom parameters.
 * @param {Token} viewer
 * @param {object} [config]         Custom parameters to override default settings.
 * @returns {ViewerLOS}
 */
export function buildCustomLOSViewer(viewer, { calculator, calcName, calcClass, numViewpoints, viewpointOffset, threshold, ...calcCfg } = {}) {
  const calcConfig = foundry.utils.mergeObject(CalculatorConfig(), calcCfg, { inplace: false });
  const losConfig = customizeViewer({ calculator, calcName, calcClass, numViewpoints, viewpointOffset, threshold });
  return new ViewerLOS(viewer, { ...losConfig, ...calcConfig});
}

/**
 * Build a debug viewer using the current settings.
 * @param {class} cl                Class of the viewer
 * @param {object} [config]         Custom parameters to override default settings.
 */
export function buildDebugViewer(cl, { calculator, calcName, calcClass, numViewpoints, viewpointOffset, threshold, ...calcCfg } = {}) {
  cl ??= currentDebugViewerClass();
  const calcConfig = foundry.utils.mergeObject(CalculatorConfig(), calcCfg, { inplace: false });
  const losConfig = customizeViewer({ calculator, calcName, calcClass, numViewpoints, viewpointOffset, threshold });
  return new cl({ ...losConfig, ...calcConfig});
}

function customizeViewer({ calculator, calcName, calcClass, numViewpoints, viewpointOffset, threshold } = {}) {
  // Get the default configuration and add the calculator class.  
  const losConfig = { ...LOSViewerConfig() };  
  if ( calcClass ) losConfig.calcClass = calcClass;
  else {
    if ( calcName ) losConfig.calcName = calcName;
    losConfig.calcClass = CONFIG[MODULE_ID].calculatorClasses[losConfig.calcName];
  }
  
  // Merge object in the class creation won't work if the props are undefined as it will change the config to undefined.
  if ( typeof calculator !== "undefined" ) losConfig.calculator = calculator;
  if ( typeof numViewpoints !== "undefined" ) losConfig.numViewpoints = numViewpoints;
  if ( typeof viewpointOffset !== "undefined" ) losConfig.viewpointOffset = viewpointOffset;
  if ( typeof threshold !== "undefined" ) losConfig.threshold = threshold;  
  
  return losConfig;
}


