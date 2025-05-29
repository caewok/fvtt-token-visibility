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
  switch (type) {
    case "los-algorithm-points": return calcs.points;
    case "los-algorithm-geometric": return calcs.geometric;
    case "los-algorithm-hybrid": return calcs.hybrid;
    case "los-algorithm-webgl2": return calcs.webGL2;
    case "los-algorithm-webgpu": return calcs.webGPU;
    case "los-algorithm-webgpu-async": return calcs.webGPUAsync;
  }
}

export function currentDebugViewerClass(type) {
  const KEYS = Settings.KEYS;
  const { TARGET } = KEYS.LOS;
  const debugViewers = CONFIG[MODULE_ID].debugViewerClasses;
  type ??= Settings.get(TARGET.ALGORITHM) ?? TARGET.TYPES.POINTS;
  switch (type) {
    case "los-algorithm-points": return debugViewers.points;
    case "los-algorithm-geometric": return debugViewers.geometric;
    case "los-algorithm-hybrid": return debugViewers.hybrid;
    case "los-algorithm-webgl2": return debugViewers.webGL2;
    case "los-algorithm-webgpu": return debugViewers.webGPU;
    case "los-algorithm-webgpu-async": return debugViewers.webGPUAsync;
  }
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
  };
}

function CalculatorConfig() {
  return {
    blocking: BlockingConfig(),
    largeTarget: Settings.get(Settings.KEYS.LOS.TARGET.LARGE) ?? false,
    debug: false,
    useLitTargetShape: false,
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
  const losConfig = foundry.utils.mergeObject(LOSViewerConfig(), { calculator, viewpointClass, numViewpoints, viewpointOffset, threshold }, { inplace: false });
  return new CachedAbstractViewerLOS(viewer, { ...losConfig, ...calcConfig});
}

/**
 * Build a debug viewer using the current settings.
 * @param {class} cl                Class of the viewer
 * @param {object} [config]         Custom parameters to override default settings.
 */
export function buildDebugViewer(cl, { calculator, viewpointClass, numViewpoints, viewpointOffset, threshold, ...calcCfg }) {
  cl ??= currentDebugViewerClass();
  const calcConfig = foundry.utils.mergeObject(CalculatorConfig(), calcCfg, { inplace: false });
  const losConfig = foundry.utils.mergeObject(LOSViewerConfig(), { calculator, viewpointClass, numViewpoints, viewpointOffset, threshold }, { inplace: false });
  return new cl({ ...losConfig, ...calcConfig});
}


