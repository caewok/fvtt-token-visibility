/* globals
CONFIG
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


// ----- NOTE: Wraps ----- //

/**
 * Wrap VisionSource.prototype.initialize
 * Clear the cache when initializing
 */
function initialize(wrapper, data={}) {
  this._losCache = {};
  return wrapper(data);
}

PATCHES.BASIC.WRAPS = { initialize };

// ----- NOTE: Overrides ----- //

/**
 * Override VisionSource.prototype._createPolygon()
 * Pass an optional type; store the resulting los for that type in the token.
 * Pass other options to affect the config.
 * @param {string} type   light, sight, sound, move
 */
function _createPolygon(config) {
  config ??= this._getPolygonConfiguration();
  this._losCache ??= {};

  // Vision source is destroyed on token move, so we can cache for the type.
  if ( this._losCache[config.type] ) return this._losCache[config.type];

  const origin = { x: this.data.x, y: this.data.y };

  // See PointSource.prototype._createPolygon
  const polygonClass = CONFIG.Canvas.polygonBackends[config.type];
  const poly = polygonClass.create(origin, config);
  this._losCache[config.type] = poly;
  return poly;
}

PATCHES.BASIC.OVERRIDES = { _createPolygon };
