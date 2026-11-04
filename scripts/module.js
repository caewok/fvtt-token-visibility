/* globals
CONFIG,
CONST,
foundry,
game,
Hooks,
PIXI,
*/
"use strict";

import { MODULE_ID, FA_ICONS, REGION_BEHAVIORS, TEMPLATES, FLAGS, ENUMS } from "./const.js";
import { GEOMETRY_LIB_ID } from "./geometry/const.js";
import { LOS_CONFIG } from "./LOS/config.js";
import { TEMPLATES as LOS_TEMPLATES } from "./LOS/const.js";
import { log, fastFlag } from "./util.js";

// Load the geometry library.
import "./geometry/registration.js";

// Hooks and method registration
import { initializePatching, PATCHER } from "./patching.js";
import { Settings } from "./settings.js";
import { LOSThrottle } from "./LOSThrottle.js";
import { ATVLOSManager } from "./ATVLOSManager.js";

// Trackers
import { LightStatusTracker } from "./LightStatusTracker.js";

// Regions
import { BlockSightRegionBehaviorType } from "./BlockSightRegionBehaviorType.js";

// For API
import * as bench from "./benchmark.js";
import { OPEN_POPOUTS } from "./LOS/Area3dPopout.js";

import {
  buildOcclusionTester,
  buildLOSCalculator,
  buildLOSViewer,
  buildDebugViewer,
  getCurrentCalculatorClass,
} from "./LOSCalculator.js";

import { PercentVisibleCalculatorPoints } from "./LOS/calculators/PointsCalculator.js";
import { PercentVisibleCalculatorGeometric } from "./LOS/calculators/GeometricCalculator.js";
import { PercentVisibleCalculatorPerPixel } from "./LOS/calculators/PerPixelCalculator.js";
import { PercentVisibleCalculatorWebGL2 } from "./LOS/calculators/WebGL2Calculator.js";
import {
  DebugVisibilityViewerPoints,
  DebugVisibilityViewerGeometric,
  DebugVisibilityViewerPerPixel,
  DebugVisibilityViewerWebGL2,
} from "./LOS/DebugVisibilityViewer.js";
import { TokenLightMeter } from "./TokenLightMeter.js";
import { ViewerLOS } from "./LOS/ViewerLOS.js";

import * as twgl from "./LOS/WebGL2/twgl.js";
import { SmallBitSet } from "./LOS/SmallBitSet.js";
import { FastBitSet } from "./LOS/FastBitSet/FastBitSet.js";


// Other self-executing hooks
import "./changelog.js";


Hooks.once("init", function() {
  // Register the region behavior to trigger region blocking of sight.
  Object.assign(CONFIG.RegionBehavior.dataModels, {
    [`${MODULE_ID}.${REGION_BEHAVIORS.BLOCK_SIGHT}`]: BlockSightRegionBehaviorType,
  });
  CONFIG.RegionBehavior.typeIcons[`${MODULE_ID}.${REGION_BEHAVIORS.BLOCK_SIGHT}`] = FA_ICONS.BLOCK_SIGHT;

  initializePatching();
  initializeConfig();
  initializeAPI();

  foundry.applications.handlebars.loadTemplates(Object.values(LOS_TEMPLATES)).then(() => log(`${MODULE_ID}|LOS Templates loaded.`));
  foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES)).then(() => log("Templates loaded."));
});


Hooks.once("setup", function() {
  Settings.registerAll();

  // Add status effects for dim and no light.
  const dimLight = {
    id: "dimLight",
    _id: ("atvDimLight").padEnd(16, "0"),
    name: "Dim Light",
    img: "icons/sundries/lights/torch-brown-lit.webp",
    reference: MODULE_ID,
  };
  const noLight = {
    id: "noLight",
    _id: ("atvNoLight").padEnd(16, "0"),
    name: "No Light",
    img: "icons/sundries/lights/torch-brown.webp",
    reference: MODULE_ID,
  };
  CONFIG.statusEffects.push(dimLight, noLight);

  // Opacity values for tokens, walls, regions for cover.
  CONFIG[GEOMETRY_LIB_ID].CONFIG.opacity.register("sight", {
    Token: tokenOpacity,
    Region: regionOpacity,
    Wall: wallOpacity,
  });

  ATVLOSManager.registerHooks();
  LOSThrottle.registerHooks();
});

Hooks.once("ready", function() {
  Settings.migrate(); // Cannot be set until world is ready.
  LightStatusTracker.loadLightIcons(); // Async.

  // Disable lighting algorithm for now, until fixed.
  if ( game.user.isGM ) Settings.set(Settings.KEYS.LIGHT_MONITOR.ALGORITHM, ENUMS.LIGHT_ALGORITHM_TYPES.NONE);
});

// ----- NOTE: Config ----- //

/**
 * Initialize the CONFIG for this module, at CONFIG[MODULE_ID].
 * Dynamic settings that may be changed by users or other modules or set by system type.
 */
function initializeConfig() {
  CONFIG[MODULE_ID] = {
    /**
     * Number of points to measure in one dimension for light type calculation.
     * Will be used for all 3 dimensions. E.g., 3 --> 3x3x3 in a cube, or 18 points total.
     * @type {number}
     */
    lightMeasurementNumPoints: 5,

    /**
     * Classes and associated calculators that can determine percent visibility.
     * Each calculator can calculate visibility based on viewer, target, and optional viewer/target locations.
     * @type {object}
     */
    calculatorClasses: {
      points: PercentVisibleCalculatorPoints,
      geometric: PercentVisibleCalculatorGeometric,
      webgl2: PercentVisibleCalculatorWebGL2,
      "per-pixel": PercentVisibleCalculatorPerPixel,
    },

    /**
     * Classes used to view the debugger for different algorithms.
     * @type {object<class>}
     */
    debugViewerClasses: {
      points: DebugVisibilityViewerPoints,
      geometric: DebugVisibilityViewerGeometric,
      webgl2: DebugVisibilityViewerWebGL2,
      "per-pixel": DebugVisibilityViewerPerPixel,
    },

    /**
     * Current occlusion tester for the given settings.
     * @type {ObstacleOcclusionTest}
     */
    occlusionTester: null,

    /**
     * Current calculator for the given settings.
     * @type {PercentVisibleCalculatorAbstract}
     */
    losCalculator: null,

    /**
     * Configurations that affect the light meter.
     * @type {object}
     */
    lightMeter: {
      /**
       * What percentage of bright points are required to be considered in bright light?
       * @type {number}  Between 0 and 1
       */
      brightCutoff: 0.25,

      /**
       * What percentage of dim points are required to be considered in dim light?
       * (If both bright and dim cutoffs are met, bright takes precedence.)
       * @type {number}  Between 0 and 1
       */
      dimCutoff: 0.25,

      /**
       * What class of calculator to use for the light meter?
       * Currently works with PercentVisibleCalculatorPoints and PercentVisibleCalculatorPerPixel
       * @type {PercentVisibleCalculatorAbstract}
       */
      calculatorClass: PercentVisibleCalculatorPerPixel,

      /**
       * For points on the other side of the token from the light, how should they be lit assuming
       * no other obstruction than the target token?
       * For example, DIM would mean that points on the dark side of the token would have maximum
       * dim light even if the token was within the radius of a bright light.
       * @type {CONST.LIGHTING_LEVELS}
       */
      obscureType: CONST.LIGHTING_LEVELS.BRIGHT,

      /**
       * Use spheres to represent token shapes.
       * Sphere radius will be the maximum of half of width, height, vertical height.
       * Circular token shapes will be treated as cylinders if this is false.
       * @type {boolean}
       */
      useTokenSphere: false,

      /**
       * If using PercentVisibleCalculatorPoints, what point configuration to use.
       * @type {ViewerLOS.POINT_INDICES} Bit union of POINT_INDICES.
       */
      targetPointIndex: SmallBitSet.fromIndices([
        ViewerLOS.POINT_INDICES.CORNERS.FACING,
        ViewerLOS.POINT_INDICES.CORNERS.MID,
        ViewerLOS.POINT_INDICES.CORNERS.BACK,
        ViewerLOS.POINT_INDICES.SIDES.FACING,
        ViewerLOS.POINT_INDICES.SIDES.MID,
        ViewerLOS.POINT_INDICES.SIDES.BACK,
        ViewerLOS.POINT_INDICES.D3.BOTTOM,
        ViewerLOS.POINT_INDICES.D3.MID,
        ViewerLOS.POINT_INDICES.D3.TOP]).word, // Everything except CENTER (0)
    },

    /**
     * Limit the number of times line-of-sight is checked when dragging/moving tokens.
     * @type {object}
     */
    losThrottle: {
      enabled: true,    /** @type {boolean} */
      interval: 200,    /** @type {number<milliseconds>} */
      maxDistance: 5,   /** @type {number<grid distance>} */
    },

    /**
     * Turn on certain debug logging.
     * @type {boolean}
     */
    debug: false,

    ...LOS_CONFIG,
  };
}

// ----- NOTE: API ----- //

/**
 * Initialize the API for this module. At game.modules.get(MODULE_ID).api.
 * Provides access to certain classes and functions for debugging and other modules.
 */
function initializeAPI() {
  game.modules.get(MODULE_ID).api = {
    bench,

    OPEN_POPOUTS,

    Settings,

    calcs: {
      points: PercentVisibleCalculatorPoints,
      geometric: PercentVisibleCalculatorGeometric,
      webGL2: PercentVisibleCalculatorWebGL2,
      perPixel: PercentVisibleCalculatorPerPixel,
    },

    buildOcclusionTester,
    getCurrentCalculatorClass,
    buildLOSCalculator,
    buildLOSViewer,
    buildDebugViewer,

    TokenLightMeter,

    debugViewers: {
      points: DebugVisibilityViewerPoints,
      geometric: DebugVisibilityViewerGeometric,
      webGL2: DebugVisibilityViewerWebGL2,
      perPixel: DebugVisibilityViewerPerPixel,
    },

    SmallBitSet,
    FastBitSet,

    PATCHER,

    LightStatusTracker,
    twgl,
  };
}

// ----- NOTE: Helper Functions ----- //

/**
 * Opacity for cover obstacle tokens.
 * @param {TokenDocument} tokenD
 * @returns {number}
 */
function tokenOpacity(tokenD) {
  return Number(fastFlag(tokenD, FLAGS.OPACITY) ?? 1);
}

/**
 * Opacity for cover obstacle walls.
 * @param {WallDocument} wallD
 * @returns {number}
 */
function wallOpacity(wallD) { return Number(fastFlag(wallD, FLAGS.OPACITY) ?? 1); }

/**
 * Opacity for cover obstacle regions.
 * @param {RegionDocument} regionD
 * @returns {number}
 */
function regionOpacity(regionD) {
  for ( const b of regionD.behaviors ) {
    if ( b.disabled || b.type !== `${MODULE_ID}.${REGION_BEHAVIORS.BLOCK_SIGHT}` ) continue;
    return Number(b.system.opacity ?? 1);
  }
  return 0;
}
