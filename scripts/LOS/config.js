/* globals
CONFIG,
Hooks
*/
"use strict";

import { MODULE_ID } from "../const.js";

import { WallGeometry } from "../geometry/placeable_geometry/WallGeometry.js";
import { TokenGeometry } from "../geometry/placeable_geometry/TokenGeometry.js";
import { RegionGeometry } from "../geometry/placeable_geometry/RegionGeometry.js";
import { TileGeometry } from "../geometry/placeable_geometry/TileGeometry.js";

// Load the geometry library.
import "../geometry/registration.js";

export const LOS_CONFIG = {

  /**
   * WebGL2. Filter the various placeable instances in Javascript, as opposed to
   * drawing all of them and letting the GPU filter them out.
   * @type {boolean}
   */
  filterInstances: true,

  /**
   * Should borders of lit tokens be drawn separately?
   * @type {boolean}
   */
  litTokens: false,

  /**
   * Spacing between points for the per-pixel calculator.
   * The per-pixel calculator tests a point lattice on the token shape to determine visibility.
   * Larger spacing means fewer points and better performance, sacrificing resolution.
   * @type {number} In pixel units
   */
  perPixelSpacing: 10,

  /** @type {string} */
  /*
  loopCount, loopCount2             // With useRenderTexture: true,
  blendCount, blendCount2           // With useRenderTexture: true,
  reductionCount, reductionCount2   // With useRenderTexture: true,
  readPixelsCount, readPixelsCount2 // With useRenderTexture: false or true
  */
  pixelCounterType: "readPixelsCount",

  /**
   * Include Terrain Mapper regions.
   * TODO: Change to setting in the region config that also specifies
   * sense type for blocking. (Likely more than one type)
   * @type {boolean}
   */
  regionsBlock: true,

  /**
   * Size of the render texture (width and height) used in the webGL LOS algorithms.
   * @type {number}
   */
  renderTextureSize: 128,

  /**
   * What to use when testing tiles for visibility.
   * "rectangle": Trims the rectangular transparent border without considering holes or irregular shapes. Fast.
   * "alphaThresholdTriangles": Triangles representing opaque parts of the tile texture (using earcut and marching squares). Slow.
   * "alphaThresholdPolygons": 1+ polygons representing opaque parts of the tile texture (using marching squares). Much faster than triangles.
   * @type {tileThresholdShapeOptions}
   */
  tileThresholdShape: "alphaThresholdPolygons",

  /**
   * WebGL2. Whether to use a render texture to count pixels.
   * @type {boolean}
   */
  useRenderTexture: false,

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
   * WebGL2. Use the stencil buffer to identify target pixels.
   * @type {boolean}
   */
  useStencil: false,

  // Handled at base level: debug
}

Hooks.once("canvasReady", function() {

  // Register basic watchers for placeables.
  const updateFn = placeable => {
    const obj = placeable[MODULE_ID] ??= {}
    obj.updateId ??= 0;
    obj.updateId += 1;
  }
  const docKeys = {
    Wall: new Set([
      ...WallGeometry.TRACKER_TYPES.position,
      ...WallGeometry.TRACKER_TYPES.direction,
      ...WallGeometry.TRACKER_TYPES.restriction,
      ...WallGeometry.TRACKER_TYPES.door,
      ...WallGeometry.TRACKER_TYPES.threshold,
    ]),
    Tile: new Set([
      ...TileGeometry.TRACKER_TYPES.position,
      ...TileGeometry.TRACKER_TYPES.scale,
      ...TileGeometry.TRACKER_TYPES.rotation,
    ]),
    Token: new Set([
      ...TokenGeometry.TRACKER_TYPES.position,
      ...TokenGeometry.TRACKER_TYPES.scale,
      ...TokenGeometry.TRACKER_TYPES.shape,
    ]),
    Region: new Set([
      ...RegionGeometry.TRACKER_TYPES.elevation,
      ...RegionGeometry.TRACKER_TYPES.shapes,
    ]),
  };
  const id = "updateCounter";
  const geometryTracking = CONFIG.GeometryLib.lib.placeableGeometryTracking;
  const PlaceableUpdateWatcher = geometryTracking.PlaceableUpdateWatcher;
  for ( const [docName, keys] of Object.entries(docKeys) ) {
    const watcher = PlaceableUpdateWatcher.getWatcher(docName);
    watcher.register("update", id, updateFn, keys);
    watcher.activate();
  }

  // Placeable Geometry for collision testing.
  const geometryTypes = [
    "Tile",
    "Wall",
    "Token",
    "Region",
  ];
  for ( const type of geometryTypes ) {
    const cl = geometryTracking[`${type}GeometryTracker`];
    cl.registerHooks();
    cl.registerExistingPlaceables();
    cl.activate();
  }

});
