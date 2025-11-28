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

import { geoDelaunay, geoVoronoi } from "https://cdn.skypack.dev/d3-geo-voronoi@2";

// Hooks and method registration
import { registerGeometry } from "./geometry/registration.js";
import { initializePatching, PATCHER } from "./patching.js";
import { Patcher, HookPatch, MethodPatch, LibWrapperPatch } from "./Patcher.js";
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

import { Viewpoint } from "./LOS/Viewpoint.js";
import { ObstacleOcclusionTest } from "./LOS/ObstacleOcclusionTest.js";
import { Frustum } from "./LOS/Frustum.js";

import {
  buildLOSCalculator,
  // buildCustomLOSCalculator,
  buildLOSViewer,
  buildCustomLOSViewer,
  buildDebugViewer,
} from "./LOSCalculator.js";

import { OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas } from "./LOS/Area3dPopout.js";

import * as range from "./visibility_range.js";


// import { WebGPUDevice, WebGPUShader, WebGPUBuffer, WebGPUTexture } from "./LOS/WebGPU/WebGPU.js";
import { Camera } from "./LOS/Camera.js";

import { PlaceableTracker, PlaceableModelMatrixTracker } from "./LOS/placeable_tracking/PlaceableTracker.js";
import { WallTracker } from "./LOS/placeable_tracking/WallTracker.js";
import { TileTracker } from "./LOS/placeable_tracking/TileTracker.js";
import { TokenTracker } from "./LOS/placeable_tracking/TokenTracker.js";
import { RegionTracker } from "./LOS/placeable_tracking/RegionTracker.js";
import {
  VariableLengthAbstractBuffer,
  VariableLengthTrackingBuffer,
  FixedLengthTrackingBuffer,
  VerticesIndicesAbstractTrackingBuffer,
  VerticesIndicesTrackingBuffer } from "./LOS/placeable_tracking/TrackingBuffer.js";


import { WebGL2 } from "./LOS/WebGL2/WebGL2.js";

import { DrawableWallWebGL2 } from "./LOS/WebGL2/DrawableWall.js";
import { DrawableTileWebGL2, DrawableSceneBackgroundWebGL2 } from "./LOS/WebGL2/DrawableTile.js";
import { DrawableTokenWebGL2 } from "./LOS/WebGL2/DrawableToken.js";


import { RenderObstaclesWebGL2 } from "./LOS/WebGL2/RenderObstacles.js";

import { PercentVisibleCalculatorPoints, DebugVisibilityViewerPoints } from "./LOS/calculators/PointsCalculator.js";
import { PercentVisibleCalculatorGeometric, DebugVisibilityViewerGeometric } from "./LOS/calculators/GeometricCalculator.js";
import { PercentVisibleCalculatorPerPixel, DebugVisibilityViewerPerPixel } from "./LOS/calculators/PerPixelCalculator.js";
import { PercentVisibleCalculatorWebGL2, DebugVisibilityViewerWebGL2 } from "./LOS/WebGL2/WebGL2Calculator.js";
import { TokenLightMeter } from "./TokenLightMeter.js";


// import {
//   PercentVisibleCalculatorWebGPU,
//   PercentVisibleCalculatorWebGPUAsync,
//   DebugVisibilityViewerWebGPU,
//   DebugVisibilityViewerWebGPUAsync,
// } from "./LOS/WebGPU/WebGPUViewpoint.js";

import {
  HorizontalQuadVertices,
  VerticalQuadVertices,
  Rectangle3dVertices,
  Polygon3dVertices,
  Ellipse3dVertices,
  Circle3dVertices,
  Hex3dVertices,
  BasicVertices,
} from "./LOS/geometry/BasicVertices.js";

import { OBJParser } from "./LOS/geometry/OBJParser.js";

import { GeometryTile } from "./LOS/geometry/GeometryTile.js";
import { GeometryToken, GeometryConstrainedToken, GeometryLitToken } from "./LOS/geometry/GeometryToken.js";
import { GeometryWall } from "./LOS/geometry/GeometryWall.js";
import { GeometryRegion, GeometryRectangleRegionShape, GeometryPolygonRegionShape, GeometryEllipseRegionShape, GeometryCircleRegionShape  } from "./LOS/geometry/GeometryRegion.js";

import { DocumentUpdateTracker, TokenUpdateTracker } from "./LOS/UpdateTracker.js";

import * as twgl from "./LOS/WebGL2/twgl-full.js";
import * as MarchingSquares from "./LOS/marchingsquares-esm.js";
import { SmallBitSet } from "./LOS/SmallBitSet.js";
import { FastBitSet } from "./LOS/FastBitSet/FastBitSet.js";


// Other self-executing hooks
import "./changelog.js";
import "./geometry/tests/AABB.test.js";

// import "./LOS/WebGPU/webgpu-map-sync.js";



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
     * Which clipper version to use: 1 or 2.
     */
    clipperVersion: 1,

    /**
     * The percent threshold under which a tile should be considered transparent at that pixel.
     * @type {number}
     */
    alphaThreshold: 0.75,

    /**
     * Limit the tile alpha pixels by contiguous area.
     * Limits when a portion of the tile is considered an obstacle.
     * For points or geometric algorithm, this will not be considered blocking.
     */
    alphaAreaThreshold: 25, // Area in pixels, e.g. 5x5 or ~ 8 x 3

    /**
     * Filter the various placeable instances in Javascript, as opposed to
     * drawing all of them and letting the GPU filter them out.
     * @type {boolean}
     */
    filterInstances: true,

    /**
     * In WebGL2 algorithm, use the stencil buffer to identify target pixels.
     * @type {boolean}
     */
    useStencil: false,

    /**
     * When constructing a region geometry, whether to include walls that are interior to the region.
     * E.g., when two shapes that form a region overlap.
     * @type {boolean}
     */
    allowInteriorWalls: true,

    /**
     * Whether to constrain token shapes that overlap walls.
     * When enabled, reshape the token border to fit within the overlapping walls (based on token center).
     * Performance-intensive for custom token shapes. Used for obstructing tokens and target tokens.
     * @type {boolean}
     */
    constrainTokens: false,

    /**
     * How to calculate the extent to which a token is lit by lighting or sounds.
     * Used in Foundry's visibility test.
     * 0: Ignore
     * 1: Constrain the target token shape to only that portion of the shape within the lights' polygons.
     * 2: Test occlusion between selected points or pixels and lights in the scene.
     * @type {litTokenOptions}
     */
    litToken: 1,

    /** @type {enum<number>} */
    litTokenOptions: {
      IGNORE: 0,
      CONSTRAIN: 1,
      OCCLUSION: 2,
    },


    /** @type {string} */
    /*
    loopCount, loopCount2             // With useRenderTexture: true,
    blendCount, blendCount2           // With useRenderTexture: true,
    reductionCount, reductionCount2   // With useRenderTexture: true,
    readPixelsCount, readPixelsCount2 // With useRenderTexture: false or true
    */
    pixelCounterType: "readPixelsCount",

    /**
     * For WebGL2, whether to use a rendertexture to count pixels.
     * @type {boolean}
     */
    useRenderTexture: false,

    /**
     * What to use when testing tiles for visibility.
     * "triangles": Basic two flat triangles that form a rectangle
     * "alphaThresholdTriangles": triangles representing opaque parts of the tile texture (using earcut and marching squares)
     * "alphaThresholdPolygons": 1+ polygons representing opaque parts of the tile texture (using marching squares)
     * @type {tileThresholdShapeOptions}
     */
    tileThresholdShape: "triangles",

    /** @type {enum<string>} */
    tileThresholdShapeOptions: {
      BASIC_TRIANGLES: "triangles",
      ALPHA_TRIANGLES: "alphaThresholdTriangles",
      ALPHA_POLYGONS: "alphaThresholdPolygons",
    },

    /**
     * Size of the render texture (width and height) used in the webGL LOS algorithms.
     * @type {number}
     */
    renderTextureSize: 128,

    /**
     * Number of points to measure in one dimension for light type calculation.
     * Will be used for all 3 dimensions. E.g., 3 --> 3x3x3 in a cube, or 18 points total.
     * @type {number}
     */
    lightMeasurementNumPoints: 5,

    /**
     * Classes and associated calculators that can determine percent visibility.
     * Created and initialized at canvasReady hook
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
     * Function to determine if a token is alive.
     * @type {function}
     */
    tokenIsAlive,

    /**
     * Function to determine if a token is dead
     * @type {function}
     */
    tokenIsDead,

    /**
     * Include Terrain Mapper regions.
     * TODO: Change to setting in the region config that also specifies
     * sense type for blocking. (Likely more than one type)
     * @type {boolean}
     */
    regionsBlock: true,

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
     * Use spheres to represent token shapes.
     * Sphere radius will be the maximum of half of width, height, vertical height.
     * Circular token shapes will be treated as cylinders if this is false.
     * @type {boolean}
     */
    useTokenSphere: false,

    /**
     * Spacing between points for the per-pixel calculator.
     * The per-pixel calculator tests a point lattice on the token shape to determine visibility.
     * Larger spacing means fewer points and better performance, sacrificing resolution.
     * @type {number} In pixel units
     */
    perPixelSpacing: 10,

    /**
     * Combine multiple viewpoints into one view by overlapping the views.
     * If any viewpoint is fully visible, or the threshold visibility is met, this is ignored.
     * The algorithm used varies somewhat depending on the underlying LOS algorithm:
     * - Points and Per-Pixel: A point is visible if it is visible from any viewpoint.
     * - Geometry: Each face is considered separately
     * - Geometry sphere and WebGL2: Images overlaid.
     */
    useStereoBlending: false,

    /**
     * Turn on certain debug logging.
     * @type {boolean}
     */
    debug: false,
  };

  Object.defineProperty(CONFIG[MODULE_ID], "ClipperPaths", {
    get: () => CONFIG[MODULE_ID].clipperVersion === 1
      ? CONFIG.GeometryLib.ClipperPaths : CONFIG.GeometryLib.Clipper2Paths
  });

  game.modules.get(MODULE_ID).api = {
    bench,
    range,

    DocumentUpdateTracker, TokenUpdateTracker,

    geometry: {
      HorizontalQuadVertices,
      VerticalQuadVertices,
      Rectangle3dVertices,
      Polygon3dVertices,
      Ellipse3dVertices,
      Circle3dVertices,
      Hex3dVertices,
      BasicVertices,

      GeometryTile,
      GeometryToken,
      GeometryConstrainedToken,
      GeometryLitToken,
      GeometryWall,
      GeometryRegion,
      GeometryRectangleRegionShape,
      GeometryPolygonRegionShape,
      GeometryEllipseRegionShape,
      GeometryCircleRegionShape,

      Camera,

      OBJParser,

      Frustum,
    },

    OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas,

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

    webgl: {
      WebGL2,
      DrawableWallWebGL2,
      DrawableTileWebGL2,
      DrawableTokenWebGL2,
      DrawableSceneBackgroundWebGL2,
      RenderObstaclesWebGL2,
      twgl,
    },

    placeableTracker: {
      VariableLengthAbstractBuffer,
      VariableLengthTrackingBuffer,
      FixedLengthTrackingBuffer,
      VerticesIndicesAbstractTrackingBuffer,
      VerticesIndicesTrackingBuffer,
      PlaceableTracker,
      PlaceableModelMatrixTracker,
      WallTracker,
      TileTracker,
      TokenTracker,
      RegionTracker
    },

//     webgpu: {
//       WebGPUDevice,
//       WebGPUShader,
//       WebGPUBuffer,
//       WebGPUTexture,
//       Camera,
//       RenderObstacles,
//       WebGPUSumRedPixels,
//       wgsl,
//       AsyncQueue,
//     },


    Viewpoint,
    ObstacleOcclusionTest,

    countTargetPixels,

    MarchingSquares,
    SmallBitSet,
    FastBitSet,

    PATCHER,
    Patcher, HookPatch, MethodPatch, LibWrapperPatch,
    geoDelaunay,
    geoVoronoi,
    LightStatusTracker,
  };
});


/**
 * Test if a token is dead. Usually, but not necessarily, the opposite of tokenIsDead.
 * @param {Token} token
 * @returns {boolean} True if dead.
 */
function tokenIsAlive(token) { return !tokenIsDead(token); }

/**
 * Test if a token is dead. Usually, but not necessarily, the opposite of tokenIsAlive.
 * @param {Token} token
 * @returns {boolean} True if dead.
 */
function tokenIsDead(token) {
  const deadStatus = CONFIG.statusEffects.find(status => status.id === "dead");
  if ( deadStatus && token.actor.statuses.has(deadStatus.id) ) return true;

  const tokenHPAttribute = Settings.get(Settings.KEYS.TOKEN_HP_ATTRIBUTE)
  const hp = getObjectProperty(token.actor, tokenHPAttribute);
  if ( typeof hp !== "number" ) return false;
  return hp <= 0;
}


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
});

Hooks.on("canvasReady", function() {
  console.debug(`${MODULE_ID}|canvasReady`);
  if ( Settings.get(Settings.KEYS.DEBUG.LOS) ) Settings.toggleLOSDebugGraphics(true);

  // Register the placeable geometry.
  WallGeometryTracker.registerPlaceableHooks();
  TileGeometryTracker.registerPlaceableHooks();
  TokenGeometryTracker.registerPlaceableHooks();
  SphericalTokenGeometryTracker.registerPlaceableHooks();
  LitTokenGeometryTracker.registerPlaceableHooks();
  BrightLitTokenGeometryTracker.registerPlaceableHooks();
  RegionGeometryTracker.registerPlaceableHooks();

  WallGeometryTracker.registerExistingPlaceables();
  TileGeometryTracker.registerExistingPlaceables();
  TokenGeometryTracker.registerExistingPlaceables();
  SphericalTokenGeometryTracker.registerExistingPlaceables();
  LitTokenGeometryTracker.registerExistingPlaceables();
  BrightLitTokenGeometryTracker.registerExistingPlaceables();
  RegionGeometryTracker.registerExistingPlaceables();

  // Must be after the trackers are ready.
  Settings.updateLightMonitor(Settings.get(Settings.KEYS.LIGHT_MONITOR.ALGORITHM));
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
