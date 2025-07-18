/* globals
canvas,
CONFIG,
game,
Hooks,
PIXI,
*/
"use strict";

import { MODULE_ID } from "./const.js";

// Hooks and method registration
import { registerGeometry } from "./geometry/registration.js";
import { initializePatching, PATCHER } from "./patching.js";
import { Patcher, HookPatch, MethodPatch, LibWrapperPatch } from "./Patcher.js";
import { Settings, SETTINGS } from "./settings.js";
import { getObjectProperty } from "./LOS/util.js";

// For API
import * as bench from "./benchmark.js";

import { AbstractViewpoint } from "./LOS/AbstractViewpoint.js";
import { ObstacleOcclusionTest } from "./LOS/ObstacleOcclusionTest.js";
import { TargetLightingTest } from "./LOS/TargetLightingTest.js";
import { VisionTriangle } from "./LOS/VisionTriangle.js";

import {
  buildLOSCalculator,
  buildCustomLOSCalculator,
  buildLOSViewer,
  buildCustomLOSViewer,
  buildDebugViewer,
} from "./LOSCalculator.js";

import { OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas } from "./LOS/Area3dPopout.js";

import * as range from "./visibility_range.js";

import { Polygon3d, Triangle3d, Quad3d, Polygons3d } from "./LOS/geometry/Polygon3d.js";

// import { WebGPUDevice, WebGPUShader, WebGPUBuffer, WebGPUTexture } from "./LOS/WebGPU/WebGPU.js";
import { Camera } from "./LOS/Camera.js";

import {
  mat2, mat2d, mat3, mat4,
  quat, quat2,
  vec2, vec3, vec4, } from "./LOS/gl_matrix/index.js";
// import { RenderObstacles } from "./LOS/WebGPU/RenderObstacles.js";
// import { WebGPUSumRedPixels } from "./LOS/WebGPU/SumPixels.js";
// import { wgsl } from "./LOS/wgsl-preprocessor.js";
// import { AsyncQueue } from "./LOS/AsyncQueue.js";


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

import { PercentVisibleCalculatorPoints, DebugVisibilityViewerPoints } from "./LOS/PointsViewpoint.js";
import { PercentVisibleCalculatorGeometric, DebugVisibilityViewerGeometric } from "./LOS/GeometricViewpoint.js";
import { PercentVisibleCalculatorPerPixel, DebugVisibilityViewerPerPixel } from "./LOS/PerPixelViewpoint.js";
import { PercentVisibleCalculatorWebGL2, DebugVisibilityViewerWebGL2 } from "./LOS/WebGL2/WebGL2Viewpoint.js";
import { PercentVisibleCalculatorHybrid, DebugVisibilityViewerHybrid } from "./LOS/Hybrid3dViewpoint.js"
import { PercentVisibleCalculatorSamplePixel, DebugVisibilityViewerSamplePixel } from "./LOS/SamplePixelViewpoint.js"


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
import { countTargetPixels } from "./LOS/count_target_pixels.js";

import * as twgl from "./LOS/WebGL2/twgl-full.js";
import * as MarchingSquares from "./marchingsquares-esm.js";

// Other self-executing hooks
import "./changelog.js";
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
     */
    filterInstances: true,

    useStencil: false,

    usePixelReducer: false,

    allowInteriorWalls: true,

    /**
     * Whether to constrain token shapes that overlap walls.
     * When enabled, reshape the token border to fit within the overlapping walls (based on token center).
     * Performance-intensive for custom token shapes. Used for obstructing tokens and target tokens.
     */
    constrainTokens: false,

    /**
     * How to calculate the extent to which a token is lit by lighting or sounds.
     * Used in Foundry's visibility test.
     * 0: Ignore
     * 1: Constrain the target token shape to only that portion of the shape within the lights' polygons.
     * 2: Test occlusion between selected points or pixels and lights in the scene.
     */
    litToken: 1,

    litTokenOptions: {
      IGNORE: 0,
      CONSTRAIN: 1,
      OCCLUSION: 2,
    },

    perPixelScale: 50,

    perPixelQuickInterpolation: false,

    perPixelDebugLit: true,

    samplePixelNumberSamples: 4 ** 2, // Use power of two to keep same width/height points.


    /** @type {string} */
    /*
    loopCount, loopCount2             // With useRenderTexture: true,
    blendCount, blendCount2           // With useRenderTexture: true,
    reductionCount, reductionCount2   // With useRenderTexture: true,
    readPixelsCount, readPixelsCount2 // With useRenderTexture: false or true
    */

    pixelCounterType: "readPixelsCount",

    useRenderTexture: false,

    /**
     * What to use when testing tiles for visibility.
     * "triangles": Basic two flat triangles that form a rectangle
     * "alphaThresholdTriangles": triangles representing opaque parts of the tile texture (using earcut and marching squares)
     * "alphaThresholdPolygons": 1+ polygons representing opaque parts of the tile texture (using marching squares)
     * @type {"triangles"|"alphaThresholdTriangles"|"alphaThresholdPolygons"} (See tileThresholdShapeOptions.)
     */
    tileThresholdShape: "triangles",

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



    useCaching: false,

    /**
     * Resolution of the render texture used in the webZGL LOS algorithm.
     * Should be between (0, 1).
     * @type {number}
     */
    renderTextureResolution: 1,

    /**
     * For Area3D, debug tiles using the rendered tile texture in the window, as opposed to
     * the red/blue filled color.
     * @type {boolean}
     */
    useDebugShaders: true,

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
      // hybrid: PercentVisibleCalculatorHybrid,
      "per-pixel": PercentVisibleCalculatorPerPixel,
      "sample-pixel": PercentVisibleCalculatorSamplePixel,
    },

    losCalculators: {
      points: null,
      geometric: null,
      webgl2: null,
      // webgpu: null,
      // "webgpu-async": null,
      hybrid: null,
      "per-pixel": null,
      "sample-pixel": null,
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
      hybrid: DebugVisibilityViewerHybrid,
      "per-pixel": DebugVisibilityViewerPerPixel,
    },

    /**
     * Calculator for percent visible tokens using sight.
     * @type {PercentVisibleCalculatorAbstract}
     */
    percentVisibleWebGL2: null,

    /**
     * Function to determine if a token is alive
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

    debug: true,
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
      Polygon3d,
      Triangle3d,
      Polygons3d,
      Quad3d,

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

      VisionTriangle,
    },

    OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas,

    Settings,

    calcs: {
      points: PercentVisibleCalculatorPoints,
      geometric: PercentVisibleCalculatorGeometric,
      webGL2: PercentVisibleCalculatorWebGL2,
      // webGPU: PercentVisibleCalculatorWebGPU,
      // webGPUAsync: PercentVisibleCalculatorWebGPUAsync,
      hybrid: PercentVisibleCalculatorHybrid,
      perPixel: PercentVisibleCalculatorPerPixel,
    },

    buildLOSCalculator,
    buildCustomLOSCalculator,
    buildLOSViewer,
    buildCustomLOSViewer,
    buildDebugViewer,

    debugViewers: {
      points: DebugVisibilityViewerPoints,
      geometric: DebugVisibilityViewerGeometric,
      webGL2: DebugVisibilityViewerWebGL2,
      // webGPU: DebugVisibilityViewerWebGPU,
      // webGPUAsync: DebugVisibilityViewerWebGPUAsync,
      hybrid: DebugVisibilityViewerHybrid,
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


    AbstractViewpoint,
    ObstacleOcclusionTest,
    TargetLightingTest,

    countTargetPixels,

    glmatrix: {
      mat2, mat2d, mat3, mat4,
      quat, quat2,
      vec2, vec3, vec4
    },

    MarchingSquares,

    PATCHER,
    Patcher, HookPatch, MethodPatch, LibWrapperPatch
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
  // CONFIG.GeometryLib.threeD.Point3d.prototype.toString = function() { return `{x: ${this.x}, y: ${this.y}, z: ${this.z}}`};
});

Hooks.once("ready", function() {
  console.debug(`${MODULE_ID}|ready hook`);
  Settings.migrate(); // Cannot be set until world is ready.
  Settings.initializeDebugGraphics();
});

Hooks.on("canvasReady", function() {
  console.debug(`${MODULE_ID}|canvasReady`);

//   // Create default calculators used by all the tokens.
//   const basicCalcs = [
//     "points",
//     "geometric",
//     "webgl2",
//     "hybrid",
//     "per-pixel",
//     "sample-pixel",
//   ];
// //   const webGPUCalcs = [
// //     "webgpu",
// //     "webgpu-async",
// //   ];
//   const sightCalcs = CONFIG[MODULE_ID].sightCalculators;
//   const hearingCalcs = CONFIG[MODULE_ID].hearingCalculators;
//   const calcClasses = CONFIG[MODULE_ID].calculatorClasses;
//   Object.values(sightCalcs).forEach(calc => { if ( calc ) calc.destroy() });
//
//   // Must create after settings are registered.
//   for ( const calcName of basicCalcs ) {
//     const cl = calcClasses[calcName];
//     const sightCalc = sightCalcs[calcName] = new cl({ senseType: "sight", sourceType: "lighting" });
//     const hearingCalc = hearingCalcs[calcName] = new cl({ senseType: "sight", sourceType: "sounds" });
//     sightCalc.initialize(); // Async
//     hearingCalc.initialize(); // Async
//   }

//   WebGPUDevice.getDevice().then(device => {
//     if ( !device ) {
//       console.warn("No WebGPU device located. Falling back to WebGL2.");
//       const currAlg = Settings.get(Settings.KEYS.LOS.TARGET.ALGORITHM);
//       if ( currAlg === Settings.KEYS.LOS.TARGET.TYPES.WEBGPU
//         || currAlg === Settings.KEYS.LOS.TARGET.TYPES.WEBGPU_ASYNC ) {
//         Settings.set(Settings.KEYS.LOS.TARGET.ALGORITHM, Settings.KEYS.LOS.TARGET.TYPES.WEBGL2);
//       }
//       sightCalcs.webGPU = sightCalcs.webGL2;
//       sightCalcs.webGPUAsync = sightCalcs.webGL2;
//       soundCalcs.webGPU = soundCalcs.webGL2;
//       hearingCalcs.webGPUAsync = soundCalcs.webGL2;
//
//     } else {
//       CONFIG[MODULE_ID].webGPUDevice = device;
//       for ( const calcName of webGPUCalcs ) {
//         const cl = calcClasses[calcName];
//         const sightCalc = sightCalcs[calcName] = new cl({ senseType: "sight", sourceType: "lighting" });
//         const hearingCalc = hearingCalcs[calcName] = new cl({ senseType: "sight", sourceType: "sounds" });
//         sightCalc.initialize(); // Async
//         hearingCalc.initialize(); // Async
//       }
//     }
//
//     if ( Settings.get(Settings.KEYS.DEBUG.LOS) ) Settings.toggleLOSDebugGraphics(true);
//   });
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
