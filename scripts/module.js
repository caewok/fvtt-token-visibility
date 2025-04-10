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

// For API
import * as bench from "./benchmark.js";
import * as benchFunctions from "./benchmark_functions.js";
import * as util from "./util.js";

import { PlanePoints3d } from "./LOS/PlaceablesPoints/PlanePoints3d.js";
import { TokenPoints3d } from "./LOS/PlaceablesPoints/TokenPoints3d.js";
import { DrawingPoints3d } from "./LOS/PlaceablesPoints/DrawingPoints3d.js";
import { WallPoints3d } from "./LOS/PlaceablesPoints/WallPoints3d.js";
import { TilePoints3d } from "./LOS/PlaceablesPoints/TilePoints3d.js";
import { VerticalPoints3d } from "./LOS/PlaceablesPoints/VerticalPoints3d.js";
import { HorizontalPoints3d } from "./LOS/PlaceablesPoints/HorizontalPoints3d.js";

import { AlternativeLOS } from "./LOS/AlternativeLOS.js";
import { PointsLOS } from "./LOS/PointsLOS.js";
import { Area3dLOSGeometric } from "./LOS/Area3dLOSGeometric.js";
import { Area3dLOSWebGL } from "./LOS/Area3dLOSWebGL1.js";
import { Area3dLOSWebGL2 } from "./LOS/Area3dLOSWebGL2.js";
import { Area3dLOSHybrid } from "./LOS/Area3dLOSHybrid.js";

import { OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas } from "./LOS/Area3dPopout.js";

import { AlphaCutoffFilter } from "./LOS/AlphaCutoffFilter.js";

import { Token3dGeometry, Wall3dGeometry, DirectionalWall3dGeometry, ConstrainedToken3dGeometry } from "./LOS/Placeable3dGeometry.js";
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./LOS/Placeable3dShader.js";

import { PixelCache } from "./LOS/PixelCache.js";
import { extractPixels } from "./LOS/extract-pixels.js";

import * as range from "./visibility_range.js";

import { BVH2d, BVH3d } from "./LOS/BVH.js";
import { BlockingTriangle, BlockingTile, BlockingEdge, BlockingToken, BaryTriangle2d, BaryTriangle3d, BaryTriangle3dNormal } from "./LOS/BlockingObject.js";
import { Ray2d, Ray3d } from "./LOS/Ray.js";
import { VisionPolygon, VisionTriangle } from "./LOS/VisionPolygon.js";

import {
  Triangle,
  DirectionalWallTriangles,
  WallTriangles,
  TileTriangles,
  TokenTriangles,
  Square2dTriangles,
  Square2dDoubleTriangles,
  SquareVerticalTriangles,
  SquareVerticalDoubleTriangles,
  Polygon2dTriangles,
  Polygon2dDoubleTriangles,
  PolygonVerticalTriangles
 } from "./LOS/PlaceableTriangles.js";
import { PlaceableTrianglesHandler, TokenTrianglesHandler, TileTrianglesHandler, WallTrianglesHandler  } from "./LOS/PlaceableTrianglesHandler.js";

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
import { PercentVisibleCalculator } from "./LOS/WebGPU/PercentVisibleCalculator.js";
import { wgsl } from "./LOS/WebGPU/wgsl-preprocessor.js";
import { AsyncQueue } from "./LOS/WebGPU/AsyncQueue.js";
import { SumPixelsWebGL2 } from "./LOS/WebGPU/SumPixelsWebGL2.js"
import {
  PlaceableInstanceHandler,
  WallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
 } from "./LOS/WebGPU/PlaceableInstanceHandler.js";
import { RenderWallsPIXI } from "./LOS/WebGL2/RenderObstaclesPIXI.js";
import { DrawableWallInstancesPIXI } from "./LOS/WebGL2/DrawableObjectsPIXI.js";
import { WebGL2 } from "./LOS/WebGL2/WebGL2.js";
import {
  DrawableNonDirectionalWallWebGL2,
  DrawableDirectionalWallWebGL2,
  DrawableNonDirectionalTerrainWallWebGL2,
  DrawableDirectionalTerrainWallWebGL2,
  DrawableTileWebGL2,
  DrawableTokenWebGL2,
  DrawableSceneBackground,
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
  NonDirectionalWallInstanceHandlerWebGL2,
  DirectionalWallInstanceHandlerWebGL2,
  TileInstanceHandlerWebGL2,
  TokenInstanceHandlerWebGL2
} from "./LOS/WebGL2/PlaceableInstanceHandlerWebGL2.js";

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
     */
    useDebugShaders: true
  };

  game.modules.get(MODULE_ID).api = {
    bench,
    benchFunctions,

    PixelCache,
    extractPixels,

    losCalcMethods: {
      AlternativeLOS,
      PointsLOS,
      Area3dLOSGeometric,
      Area3dLOSWebGL,
      Area3dLOSWebGL2,
      Area3dLOSHybrid
    },

    util,
    range,

    points3d: {
      PlanePoints3d,
      TokenPoints3d,
      DrawingPoints3d,
      WallPoints3d,
      TilePoints3d,
      VerticalPoints3d,
      HorizontalPoints3d,
      Settings,
      AlphaCutoffFilter
    },

    bvh: {
      BlockingTriangle, BlockingTile, BlockingEdge, BlockingToken,
      BVH2d, BVH3d,
      Ray2d, Ray3d,
      BaryTriangle2d,
      BaryTriangle3d,
      BaryTriangle3dNormal,
      VisionPolygon,
      VisionTriangle
    },

    triangles: {
      Triangle,
      DirectionalWallTriangles,
      WallTriangles,
      TileTriangles,
      TokenTriangles,
      Square2dTriangles,
      Square2dDoubleTriangles,
      SquareVerticalTriangles,
      SquareVerticalDoubleTriangles,
      Polygon2dTriangles,
      Polygon2dDoubleTriangles,
      PolygonVerticalTriangles
    },

    OPEN_POPOUTS, Area3dPopout, Area3dPopoutV2, Area3dPopoutCanvas,

    Settings,

    webgl: {
      Token3dGeometry, Wall3dGeometry, DirectionalWall3dGeometry, ConstrainedToken3dGeometry,
      Placeable3dShader, Tile3dShader,
      Placeable3dDebugShader, Tile3dDebugShader,
      DrawableWallInstancesPIXI,
      RenderWallsPIXI,
      WebGL2,
      NonDirectionalWallInstanceHandlerWebGL2,
      DirectionalWallInstanceHandlerWebGL2,
      TileInstanceHandlerWebGL2,
      TokenInstanceHandlerWebGL2,
      DrawableNonDirectionalWallWebGL2,
      DrawableDirectionalWallWebGL2,
      DrawableNonDirectionalTerrainWallWebGL2,
      DrawableDirectionalTerrainWallWebGL2,
      DrawableTileWebGL2,
      DrawableTokenWebGL2,
      DrawableSceneBackground,
      RenderObstaclesAbstractWebGL2,
      RenderWallObstaclesWebGL2,
      RenderTileObstaclesWebGL2,
      RenderObstaclesWebGL2,
      RenderObstaclesWithBackgroundWebGL2,
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
      RenderTokens,
      RenderTiles,
      RenderWalls,
      RenderObstacles,
      WebGPUSumRedPixels,
      PercentVisibleCalculator,
      wgsl,
      AsyncQueue,
      SumPixelsWebGL2,
      PlaceableInstanceHandler,
      WallInstanceHandler, TileInstanceHandler, TokenInstanceHandler,
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

Hooks.once("setup", function() {
  Settings.registerAll();
  console.debug(`${MODULE_ID}|registered settings`);

  CONFIG.GeometryLib.threeD.Point3d.prototype.toString = function() { return `{x: ${this.x}, y: ${this.y}, z: ${this.z}}`};
});

Hooks.on("canvasReady", function() {
  console.debug(`${MODULE_ID}|canvasReady`);
  Settings.initializeDebugGraphics();

  WallTrianglesHandler.registerPlaceables();
  TileTrianglesHandler.registerPlaceables();
  TokenTrianglesHandler.registerPlaceables();

  // Update triangles for all placeables.
  canvas.tiles.placeables.forEach(tile => tile[PlaceableTrianglesHandler.ID].update());
  canvas.walls.placeables.forEach(wall => wall[PlaceableTrianglesHandler.ID].update());
  canvas.tokens.placeables.forEach(token => token[PlaceableTrianglesHandler.ID].update());
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
