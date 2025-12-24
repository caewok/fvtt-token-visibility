/* globals
game,
Hooks
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { getObjectProperty } from "./util.js";

export const LOS_CONFIG = {

  /**
   * When constructing a region geometry, whether to include walls that are interior to the region.
   * E.g., when two shapes that form a region overlap.
   * @type {boolean}
   */
  allowInteriorWalls: true,

  /**
   * Limit the tile alpha pixels by contiguous area.
   * Limits when a portion of the tile is considered an obstacle.
   * For points or geometric algorithm, this will not be considered blocking.
   */
  alphaAreaThreshold: 25, // Area in pixels, e.g. 5x5 or ~ 8 x 3

  /**
   * The percent threshold under which a tile should be considered transparent at that pixel.
   * @type {number}
   */
  alphaThreshold: 0.75,

  /**
   * Which clipper version to use: 1 or 2.
   */
  clipperVersion: 1,

  /**
   * Whether to constrain token shapes that overlap walls.
   * When enabled, reshape the token border to fit within the overlapping walls (based on token center).
   * Performance-intensive for custom token shapes. Used for obstructing tokens and target tokens.
   * @type {boolean}
   */
  constrainTokens: false,

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
   * WebGL2. Whether to use a render texture to count pixels.
   * @type {boolean}
   */
  useRenderTexture: false,

  /**
   * WebGL2. Use the stencil buffer to identify target pixels.
   * @type {boolean}
   */
  useStencil: false,

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
   * Use spheres to represent token shapes.
   * Sphere radius will be the maximum of half of width, height, vertical height.
   * Circular token shapes will be treated as cylinders if this is false.
   * @type {boolean}
   */
  useTokenSphere: false,

  // Handled at base level: debug
}


Object.defineProperty(LOS_CONFIG, "ClipperPaths", {
  get: () => CONFIG[MODULE_ID].clipperVersion === 1 ? ClipperPaths : Clipper2Paths
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

  const tokenHPAttribute = CONFIG.GeometryLib.tokenHPId;
  const hp = getObjectProperty(token.actor, tokenHPAttribute);
  if ( typeof hp !== "number" ) return false;
  return hp <= 0;
}
