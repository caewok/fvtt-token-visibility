/* globals
canvas,
CONFIG,
CONST,
game,
Hooks,
PIXI,
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { LOS_CONFIG } from "./LOS/config.js";

import { geoVoronoi, geoDelaunay } from "./LOS/d3-geo-voronoi-bundled.js";
// import { geoDelaunay, geoVoronoi } from "https://cdn.skypack.dev/d3-geo-voronoi@2";

// Hooks and method registration
import { registerGeometry } from "./geometry/registration.js";
import { initializePatching, PATCHER } from "./patching.js";
import { Settings, SETTINGS } from "./settings.js";
import { getObjectProperty } from "./LOS/util.js";

// Trackers
import {
  TokenGeometryTracker,
  LitTokenGeometryTracker,
  BrightLitTokenGeometryTracker,
  SphericalTokenGeometryTracker, } from "./LOS/placeable_tracking/TokenGeometryTracker.js";
import { WallGeometryTracker } from "./LOS/placeable_tracking/WallGeometryTracker.js";
import { TileGeometryTracker } from "./LOS/placeable_tracking/TileGeometryTracker.js";
import { RegionGeometryTracker } from "./LOS/placeable_tracking/RegionGeometryTracker.js";
import { LightStatusTracker } from "./LightStatusTracker.js";



// For API
import * as bench from "./benchmark.js";
import { OPEN_POPOUTS } from "./LOS/Area3dPopout.js";

import {
  buildLOSCalculator,
  // buildCustomLOSCalculator,
  buildLOSViewer,
  buildCustomLOSViewer,
  buildDebugViewer,
} from "./LOSCalculator.js";

import { PercentVisibleCalculatorPoints, DebugVisibilityViewerPoints } from "./LOS/calculators/PointsCalculator.js";
import { PercentVisibleCalculatorGeometric, DebugVisibilityViewerGeometric } from "./LOS/calculators/GeometricCalculator.js";
import { PercentVisibleCalculatorPerPixel, DebugVisibilityViewerPerPixel } from "./LOS/calculators/PerPixelCalculator.js";
import { PercentVisibleCalculatorWebGL2, DebugVisibilityViewerWebGL2 } from "./LOS/calculators/WebGL2Calculator.js";
import { TokenLightMeter } from "./TokenLightMeter.js";

import * as twgl from "./LOS/WebGL2/twgl-full.js";
import * as MarchingSquares from "./LOS/marchingsquares-esm.js";
import { SmallBitSet } from "./LOS/SmallBitSet.js";
import { FastBitSet } from "./LOS/FastBitSet/FastBitSet.js";

// Geometry
import { ClipperPaths } from "./geometry/ClipperPaths.js";
import { Clipper2Paths } from "./geometry/Clipper2Paths.js";

// Other self-executing hooks
import "./changelog.js";
import "./geometry/tests/AABB.test.js";


Hooks.once("init", function() {
  // Load bitmap font
  // See https://www.adammarcwilliams.co.uk/creating-bitmap-text-pixi/
  // https://pixijs.com/8.x/examples/text/bitmap-text
  // PIXI.Assets.load('https://pixijs.com/assets/bitmap-font/desyrel.xml'); // Async.

  PIXI.BitmapFont.from(`${MODULE_ID}_area3dPercentLabel`, {
    fill: "#333333",
    fontWeight: 'bold',
  }, {
    chars: [['0', '9'], ' .%']
  });

  registerGeometry();
  initializePatching();

  // Set CONFIGS used by this module.
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
     */
    calculatorClasses: {
      points: PercentVisibleCalculatorPoints,
      geometric: PercentVisibleCalculatorGeometric,
      webgl2: PercentVisibleCalculatorWebGL2,
      // webgpu: PercentVisibleCalculatorWebGPU,
      // "webgpu-async": PercentVisibleCalculatorWebGPUAsync,
      "per-pixel": PercentVisibleCalculatorPerPixel,
    },

    losCalculators: {
      points: null,
      geometric: null,
      webgl2: null,
      // webgpu: null,
      // "webgpu-async": null,
      "per-pixel": null,
    },

    /**
     * Classes used to view the debugger for different algorithms.
     */
    debugViewerClasses: {
      points: DebugVisibilityViewerPoints,
      geometric: DebugVisibilityViewerGeometric,
      webgl2: DebugVisibilityViewerWebGL2,
      // webgpu: DebugVisibilityViewerWebGPU,
      // "webgpu-async": DebugVisibilityViewerWebGPUAsync,
      "per-pixel": DebugVisibilityViewerPerPixel,
    },


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
      targetPointIndex: 1022, // Everything except CENTER (0)
    },

    /**
     * Turn on certain debug logging.
     * @type {boolean}
     */
    debug: false,

    ...LOS_CONFIG,
  };


  game.modules.get(MODULE_ID).api = {
    bench,

    OPEN_POPOUTS,

    Settings,

    calcs: {
      points: PercentVisibleCalculatorPoints,
      geometric: PercentVisibleCalculatorGeometric,
      webGL2: PercentVisibleCalculatorWebGL2,
      // webGPU: PercentVisibleCalculatorWebGPU,
      // webGPUAsync: PercentVisibleCalculatorWebGPUAsync,
      perPixel: PercentVisibleCalculatorPerPixel,
    },

    buildLOSCalculator,
    // buildCustomLOSCalculator,
    buildLOSViewer,
    buildCustomLOSViewer,
    buildDebugViewer,

    TokenLightMeter,

    debugViewers: {
      points: DebugVisibilityViewerPoints,
      geometric: DebugVisibilityViewerGeometric,
      webGL2: DebugVisibilityViewerWebGL2,
      // webGPU: DebugVisibilityViewerWebGPU,
      // webGPUAsync: DebugVisibilityViewerWebGPUAsync,
      perPixel: DebugVisibilityViewerPerPixel,
    },

    MarchingSquares,
    SmallBitSet,
    FastBitSet,

    PATCHER,

    geoDelaunay,
    geoVoronoi,
    LightStatusTracker,
    twgl,
  };
});


Hooks.once("setup", function() {
  Settings.registerAll();
  console.debug(`${MODULE_ID}|registered settings`);

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
});

Hooks.once("ready", function() {
  console.debug(`${MODULE_ID}|ready hook`);
  Settings.migrate(); // Cannot be set until world is ready.
  Settings.initializeDebugGraphics();
  LightStatusTracker.loadLightIcons(); // Async.

  // Register the placeable geometry hooks.
  WallGeometryTracker.registerPlaceableHooks();
  TileGeometryTracker.registerPlaceableHooks();
  TokenGeometryTracker.registerPlaceableHooks();
  SphericalTokenGeometryTracker.registerPlaceableHooks();
  LitTokenGeometryTracker.registerPlaceableHooks();
  BrightLitTokenGeometryTracker.registerPlaceableHooks();
  RegionGeometryTracker.registerPlaceableHooks();

});

Hooks.on("createActiveEffect", refreshVisionOnActiveEffect);
Hooks.on("deleteActiveEffect", refreshVisionOnActiveEffect);

/**
 * Refresh vision for relevant active effect creation/deletion
 */
function refreshVisionOnActiveEffect(activeEffect) {
  const proneStatusId = CONFIG.GeometryLib.proneStatusId ?? Settings.get(SETTINGS.COVER.LIVE_TOKENS.ATTRIBUTE);
  const isProne = activeEffect?.statuses.some(status => status === proneStatusId);
  if ( !isProne ) return;

  canvas.effects.visibility.refresh();
}
