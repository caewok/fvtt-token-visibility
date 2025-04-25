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

import { OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas } from "./LOS/Area3dPopout.js";

import { Token3dGeometry, Wall3dGeometry, DirectionalWall3dGeometry, ConstrainedToken3dGeometry } from "./LOS/Placeable3dGeometry.js";
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./LOS/Placeable3dShader.js";

import * as range from "./visibility_range.js";

import {
  Triangle,
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
import { RenderTokens, RenderWalls, RenderTiles, RenderObstacles } from "./LOS/WebGPU/RenderObstacles.js";
import { WebGPUSumRedPixels } from "./LOS/WebGPU/SumPixels.js";
import { wgsl } from "./LOS/WebGPU/wgsl-preprocessor.js";
import { AsyncQueue } from "./LOS/WebGPU/AsyncQueue.js";
import { SumPixelsWebGL2 } from "./LOS/WebGPU/SumPixelsWebGL2.js"
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

import {
  RenderObstaclesAbstractWebGL2,
  RenderWallObstaclesWebGL2,
  RenderTileObstaclesWebGL2,
  RenderObstaclesWebGL2,
  RenderObstaclesWithBackgroundWebGL2,
} from "./LOS/WebGL2/RenderObstaclesWebGL2.js";

import * as twgl from "./LOS/WebGL2/twgl.js";
import {
  PointsPercentVisibleCalculator,
  PercentVisibleCalculatorWebGL2,
  PercentVisibleCalculatorWebGPU,
  PercentVisibleCalculatorWebGPUAsync,
} from "./LOS/WebGL2/PercentVisibleCalculator.js";
import { DebugVisibilityViewerWebGL2, DebugVisibilityViewerWebGPU, DebugVisibilityViewerWebGPUAsync, DebugVisibilityViewerPoints, DebugVisibilityViewerArea3dPIXI } from "./LOS/WebGL2/DebugVisibilityViewer.js";

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
     * The percent threshold under which a tile should be considered transparent at that pixel.
     * @type {number}
     */
    alphaThreshold: 0.75,

    /**
     * Size of the render texture (width and height) used in the webGL LOS algorithms.
     * @type {number}
     */
    renderTextureSize: 128,

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
  };

  game.modules.get(MODULE_ID).api = {
    bench,
    range,

    triangles: {
      Triangle,
      DirectionalWallTriangles,
      WallTriangles,
      TileTriangles,
      TokenTriangles,
      ConstrainedTokenTriangles,
      Grid3dTriangles,
    },

    OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas,

    Settings,

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
      RenderObstaclesAbstractWebGL2,
      RenderWallObstaclesWebGL2,
      RenderTileObstaclesWebGL2,
      RenderObstaclesWebGL2,
      RenderObstaclesWithBackgroundWebGL2,
      twgl,
      PercentVisibleCalculatorWebGL2,
      DebugVisibilityViewerWebGL2,
      DebugVisibilityViewerPoints,
      DebugVisibilityViewerArea3dPIXI,
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
      RenderTokens,
      RenderTiles,
      RenderWalls,
      RenderObstacles,
      WebGPUSumRedPixels,
      wgsl,
      AsyncQueue,
      SumPixelsWebGL2,
      PlaceableInstanceHandler,
      WallInstanceHandler, TileInstanceHandler, TokenInstanceHandler,
      PercentVisibleCalculatorWebGPU,
      DebugVisibilityViewerWebGPU,
      PercentVisibleCalculatorWebGPUAsync,
      DebugVisibilityViewerWebGPUAsync,
      DebugVisibilityViewerArea3dPIXI,
      PointsPercentVisibleCalculator,
    },

    glmatrix: {
      mat2, mat2d, mat3, mat4,
      quat, quat2,
      vec2, vec3, vec4
    },

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

Hooks.on("canvasReady", function() {
  console.debug(`${MODULE_ID}|canvasReady`);

  // Must create after settings are registered.
  CONFIG[MODULE_ID].percentVisibleWebGL2 = new PercentVisibleCalculatorWebGL2({ senseType: "sight" }),
  CONFIG[MODULE_ID].percentVisibleWebGL2.initialize(); // Async

  WebGPUDevice.getDevice().then(device => {
    if ( !device ) return console.warn("No WebGPU device located. Falling back to WebGL2.");
    CONFIG[MODULE_ID].webGPUDevice = device;
    CONFIG[MODULE_ID].percentVisibleWebGPU = new PercentVisibleCalculatorWebGPU({ device });
    CONFIG[MODULE_ID].percentVisibleWebGPUAsync = new PercentVisibleCalculatorWebGPUAsync({ device });

    CONFIG[MODULE_ID].percentVisibleWebGPU.initialize(); // Async
    CONFIG[MODULE_ID].percentVisibleWebGPUAsync.initialize(); // Async
  });

  Settings.initializeDebugGraphics();

//   WallTriangles.registerPlaceableHooks();
//   TileTriangles.registerPlaceableHooks();
//   TokenTriangles.registerPlaceableHooks();

  // Update triangles for all placeables.
//   canvas.tiles.placeables.forEach(tile => TileTriangles._onPlaceableCreation(tile));
//   canvas.walls.placeables.forEach(wall => WallTriangles._onPlaceableCreation(wall));
//   canvas.tokens.placeables.forEach(token => TokenTriangles._onPlaceableCreation(token));
//

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
