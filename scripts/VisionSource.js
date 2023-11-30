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
 * @event initializeRenderedPointSourceShaders
 * @category PointSource
 * @param {RenderedPointSource} source   The RenderedPointSource being initialized.
 */
function initializeVisionSourceShaders(source) {
  const obj = source[MODULE_ID] ??= {};
  const token = source.object;
  if ( !token?.hasSight ) return;
  if ( obj.losCalc ) {
    obj.losCalc._updateAlgorithm();
    obj.losCalc._updateConfigurationSettings();
  } else obj.losCalc = new LOSCalculator(token, undefined);
}

PATCHES.BASIC.HOOKS = { initializeVisionSourceShaders };
