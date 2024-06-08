/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { LOSCalculator } from "./LOSCalculator.js";

// Patches for the VisionSource class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * A hook event that fires after RenderedPointSource shaders have initialized.
 * @event initializeVisionSources
 * @category PointSource
 * @param {RenderedPointSource} source   The RenderedPointSource being initialized.
 */
function initializeVisionSources(sources) {
  // As of v12.327, sources is an empty array. Find the sources manually.
//   const visionSources = canvas.tokens.placeables
//     .filter(t => t)
//
//   for ( const token of canvas.tokens.placeables ) {
//
//   }
//
//   for ( const source of sources ) {
//     const obj = source[MODULE_ID] ??= {};
//     const token = source.object;
//     if ( !token?.hasSight ) return;
//     if ( obj.losCalc ) {
//       obj.losCalc._updateAlgorithm();
//       obj.losCalc.updateConfiguration();
//     } else obj.losCalc = new LOSCalculator(token, undefined);
//   }
}

/**
 * A hook event that fires when visibility is refreshed.
 * @event visibilityRefresh
 * @category CanvasVisibility
 * @param {CanvasVisibility} visibility The CanvasVisibility instance
 */
function visibilityRefresh(visibility) {
  // console.log("visibilityRefresh", visibility);

}

function sightRefresh(visibility) {
  // console.log("sightRefresh", visibility);
}


PATCHES.BASIC.HOOKS = { initializeVisionSources, visibilityRefresh, sightRefresh };
