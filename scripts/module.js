/* globals
canvas,
CONFIG,
game,
Hooks,
PIXI,
*/
"use strict";

import { MODULE_ID } from "./const.js";

import { WallGeometryHandler, TileGeometryHandler, TokenGeometryHandler } from "./LOS/Placeable3dGeometry.js";
import { WallPIXIHandler, TilePIXIHandler, TokenPIXIHandler } from "./LOS/PIXI/PlaceablePIXIHandler.js";

// Hooks and method registration
import { registerGeometry } from "./geometry/registration.js";
import { initializePatching, PATCHER } from "./patching.js";
import { Patcher, HookPatch, MethodPatch, LibWrapperPatch } from "./Patcher.js";
import { Settings, SETTINGS } from "./settings.js";
import { getObjectProperty } from "./LOS/util.js";

// For API
import * as bench from "./benchmark.js";

import { AbstractViewpoint } from "./LOS/AbstractViewpoint.js";

import { buildLOSCalculator, buildCustomLOSCalculator, buildDebugViewer } from "./LOSCalculator.js";

import { OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas } from "./LOS/Area3dPopout.js";

import { Token3dGeometry, Wall3dGeometry, DirectionalWall3dGeometry, ConstrainedToken3dGeometry } from "./LOS/Placeable3dGeometry.js";
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./LOS/Placeable3dShader.js";

import * as range from "./visibility_range.js";

import { Polygon3d, Triangle3d, Polygons3d } from "./LOS/Polygon3d.js";

import {
  DirectionalWallTriangles,
  WallTriangles,
  TileTriangles,
  TokenTriangles,
  ConstrainedTokenTriangles,
  Grid3dTriangles,
 } from "./LOS/PlaceableTriangles.js";

import { WebGPUDevice, WebGPUShader, WebGPUBuffer, WebGPUTexture } from "./LOS/WebGPU/WebGPU.js";
import { Camera } from "./LOS/WebGPU/Camera.js";

import {
  mat2, mat2d, mat3, mat4,
  quat, quat2,
  vec2, vec3, vec4, } from "./LOS/gl_matrix/index.js";
import { GeometryDesc } from "./LOS/WebGPU/GeometryDesc.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc } from "./LOS/WebGPU/GeometryToken.js";
import { GeometryHorizontalPlaneDesc } from "./LOS/WebGPU/GeometryTile.js";
import { GeometryWallDesc } from "./LOS/WebGPU/GeometryWall.js";
import { RenderObstacles } from "./LOS/WebGPU/RenderObstacles.js";
import { WebGPUSumRedPixels } from "./LOS/WebGPU/SumPixels.js";
import { wgsl } from "./LOS/WebGPU/wgsl-preprocessor.js";
import { AsyncQueue } from "./LOS/WebGPU/AsyncQueue.js";
import {
  PlaceableInstanceHandler,
  WallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
 } from "./LOS/WebGPU/PlaceableInstanceHandler.js";

import { WebGL2 } from "./LOS/WebGL2/WebGL2.js";
import {
  DrawableNonDirectionalWallWebGL2,
  DrawableDirectionalWallWebGL2,
  DrawableNonDirectionalTerrainWallWebGL2,
  DrawableDirectionalTerrainWallWebGL2,
  DrawableTileWebGL2,
  DrawableTokenWebGL2,
  DrawableSceneBackgroundWebGL2,
} from "./LOS/WebGL2/DrawableObjectsWebGL2.js";

import { RenderObstaclesWebGL2 } from "./LOS/WebGL2/RenderObstaclesWebGL2.js";

import { PercentVisibleCalculatorPoints, DebugVisibilityViewerPoints } from "./LOS/PointsViewpoint.js";
import { PercentVisibleCalculatorGeometric, DebugVisibilityViewerGeometric } from "./LOS/GeometricViewpoint.js";
import { PercentVisibleCalculatorPIXI, DebugVisibilityViewerPIXI } from "./LOS/PIXIViewpoint.js";
import { PercentVisibleCalculatorWebGL2, DebugVisibilityViewerWebGL2 } from "./LOS/WebGL2/WebGL2Viewpoint.js";
import { PercentVisibleCalculatorHybrid, DebugVisibilityViewerHybrid } from "./LOS/Hybrid3dViewpoint.js"
import {
  PercentVisibleCalculatorWebGPU,
  PercentVisibleCalculatorWebGPUAsync,
  DebugVisibilityViewerWebGPU,
  DebugVisibilityViewerWebGPUAsync,
} from "./LOS/WebGPU/WebGPUViewpoint.js";

import { DocumentUpdateTracker, TokenUpdateTracker } from "./LOS/UpdateTracker.js";

import * as twgl from "./LOS/WebGL2/twgl-full.js";
import * as MarchingSquares from "./marchingsquares-esm.js";

// Other self-executing hooks
import "./changelog.js";
import "./LOS/WebGPU/webgpu-map-sync.js";

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

    pixelCounterType: "reductionCount2",

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

    useRenderTexture: false,

    useCaching: true,

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
    sightCalculatorClasses: {
      points: PercentVisibleCalculatorPoints,
      geometric: PercentVisibleCalculatorGeometric,
      PIXI: PercentVisibleCalculatorPIXI,
      webGL2: PercentVisibleCalculatorWebGL2,
      webGPU: PercentVisibleCalculatorWebGPU,
      webGPUAsync: PercentVisibleCalculatorWebGPUAsync,
      hybrid: PercentVisibleCalculatorHybrid,
    },

    sightCalculators: {
      points: null,
      geometric: null,
      PIXI: null,
      webGL2: null,
      webGPU: null,
      webGPUAsync: null,
      hybrid: null,
    },

    /**
     * Classes used to view the debugger for different algorithms.
     */
    debugViewerClasses: {
      points: DebugVisibilityViewerPoints,
      geometric: DebugVisibilityViewerGeometric,
      PIXI: DebugVisibilityViewerPIXI,
      webGL2: DebugVisibilityViewerWebGL2,
      webGPU: DebugVisibilityViewerWebGPU,
      webGPUAsync: DebugVisibilityViewerWebGPUAsync,
      hybrid: DebugVisibilityViewerHybrid,
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

    triangles: {
      Polygon3d,
      Triangle3d,
      Polygons3d,
      DirectionalWallTriangles,
      WallTriangles,
      TileTriangles,
      TokenTriangles,
      ConstrainedTokenTriangles,
      Grid3dTriangles,
    },

    OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas,

    Settings,

    calcs: {
      points: PercentVisibleCalculatorPoints,
      geometric: PercentVisibleCalculatorGeometric,
      PIXI: PercentVisibleCalculatorPIXI,
      webGL2: PercentVisibleCalculatorWebGL2,
      webGPU: PercentVisibleCalculatorWebGPU,
      webGPUAsync: PercentVisibleCalculatorWebGPUAsync,
      hybrid: PercentVisibleCalculatorHybrid,
    },

    buildLOSCalculator,
    buildCustomLOSCalculator,
    buildDebugViewer,

    debugViewers: {
      points: DebugVisibilityViewerPoints,
      geometric: DebugVisibilityViewerGeometric,
      PIXI: DebugVisibilityViewerPIXI,
      webGL2: DebugVisibilityViewerWebGL2,
      webGPU: DebugVisibilityViewerWebGPU,
      webGPUAsync: DebugVisibilityViewerWebGPUAsync,
      hybrid: DebugVisibilityViewerHybrid,
    },

    webgl: {
      Token3dGeometry, Wall3dGeometry, DirectionalWall3dGeometry, ConstrainedToken3dGeometry,
      Placeable3dShader, Tile3dShader,
      Placeable3dDebugShader, Tile3dDebugShader,
      WebGL2,
      DrawableNonDirectionalWallWebGL2,
      DrawableDirectionalWallWebGL2,
      DrawableNonDirectionalTerrainWallWebGL2,
      DrawableDirectionalTerrainWallWebGL2,
      DrawableTileWebGL2,
      DrawableTokenWebGL2,
      DrawableSceneBackgroundWebGL2,
      RenderObstaclesWebGL2,
      twgl,
    },

    webgpu: {
      WebGPUDevice,
      WebGPUShader,
      WebGPUBuffer,
      WebGPUTexture,
      Camera,
      GeometryDesc,
      GeometryWallDesc,
      GeometryCubeDesc,
      GeometryHorizontalPlaneDesc,
      GeometryConstrainedTokenDesc,
      RenderObstacles,
      WebGPUSumRedPixels,
      wgsl,
      AsyncQueue,
      PlaceableInstanceHandler,
      WallInstanceHandler, TileInstanceHandler, TokenInstanceHandler,
    },

    AbstractViewpoint,

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
  CONFIG.GeometryLib.threeD.Point3d.prototype.toString = function() { return `{x: ${this.x}, y: ${this.y}, z: ${this.z}}`};
});

Hooks.once("ready", function() {
  console.debug(`${MODULE_ID}|ready hook`);
  Settings.initializeDebugGraphics();


});

Hooks.on("canvasReady", function() {
  console.debug(`${MODULE_ID}|canvasReady`);

  // Create default calculators used by all the tokens.
  const basicCalcs = [
    "points",
    "geometric",
    "webGL2",
    "PIXI",
    "hybrid",
  ];
  const webGPUCalcs = [
    "webGPU",
    "webGPUAsync",
  ];
  const sightCalcs = CONFIG[MODULE_ID].sightCalculators;
  const calcClasses = CONFIG[MODULE_ID].sightCalculatorClasses;
  Object.values(sightCalcs).forEach(calc => { if ( calc ) calc.destroy() });

  // Must create after settings are registered.
  for ( const calcName of basicCalcs ) {
    const cl = calcClasses[calcName];
    const calc = sightCalcs[calcName] = new cl({ senseType: "sight" });
    calc.initialize(); // Async.
  }

  WebGPUDevice.getDevice().then(device => {
    if ( !device ) {
      console.warn("No WebGPU device located. Falling back to WebGL2.");
      for ( const calcName of webGPUCalcs ) sightCalcs[calcName] = sightCalcs.webGL2;
    } else {
      CONFIG[MODULE_ID].webGPUDevice = device;
      for ( const calcName of webGPUCalcs ) {
        const cl = calcClasses[calcName];
        const calc = sightCalcs[calcName] = new cl({ senseType: "sight", device });
        calc.initialize(); // Async.
      }
    }
    if ( Settings.get(Settings.KEYS.DEBUG.LOS) ) Settings.toggleLOSDebugGraphics(true);
  });

  WallGeometryHandler.registerPlaceables();
  TileGeometryHandler.registerPlaceables();
  TokenGeometryHandler.registerPlaceables();

  canvas.tiles.placeables.forEach(tile => new TilePIXIHandler(tile));
  canvas.tokens.placeables.forEach(token => new TokenPIXIHandler(token));
  canvas.walls.placeables.forEach(wall => new WallPIXIHandler(wall));


//   WallTriangles.registerPlaceableHooks();
//   TileTriangles.registerPlaceableHooks();
//   TokenTriangles.registerPlaceableHooks();
//
//   // Update triangles for all placeables.
//   canvas.tiles.placeables.forEach(tile => TileTriangles._onPlaceableCreation(tile));
//   canvas.walls.placeables.forEach(wall => WallTriangles._onPlaceableCreation(wall));
//   canvas.tokens.placeables.forEach(token => TokenTriangles._onPlaceableCreation(token));


  // Once canvas is loaded, process the placeables.
  // PlaceableInstanceHandler.handlers.values().forEach(handler => handler.initializePlaceables());

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
