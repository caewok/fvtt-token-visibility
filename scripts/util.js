/* globals
game,
foundry,
PIXI,
CONFIG
*/
"use strict";

import { MODULE_ID, EPSILON } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { TokenPoints3d } from "./PlaceablesPoints/TokenPoints3d.js";
import { getSetting, SETTINGS } from "./settings.js";


/**
 * Get elements of an array by a list of indices
 * https://stackoverflow.com/questions/43708721/how-to-select-elements-from-an-array-based-on-the-indices-of-another-array-in-ja
 * @param {Array} arr       Array with elements to select
 * @param {number[]} indices   Indices to choose from arr. Indices not in arr will be undefined.
 * @returns {Array}
 */
export function elementsByIndex(arr, indices) {
  return indices.map(aIndex => arr[aIndex]);
}

/**
 * @typedef buildTokenPointsConfig
 * @type {object}
 * @property {CONST.WALL_RESTRICTION_TYPES} type    Type of vision source
 * @property {boolean} deadTokensBlock              Do dead tokens block vision?
 * @property {boolean} liveTokensBlock              Do live tokens block vision?
 * @property {PIXI.Graphics} graphics               Graphics to pass to the point constructor
 */

/**
 * Given config options, build TokenPoints3d from tokens.
 * The points will use either half- or full-height tokens, depending on config.
 * @param {Token[]|Set<Token>} tokens
 * @param {buildTokenPointsConfig} config
 * @returns {TokenPoints3d[]}
 */
export function buildTokenPoints(tokens, config) {
  if ( !tokens.length && !tokens.size ) return tokens;
  const { liveTokensBlock, deadTokensBlock, proneTokensBlock } = config;
  if ( !(liveTokensBlock || deadTokensBlock) ) return [];

  const hpAttribute = getSetting(SETTINGS.COVER.DEAD_TOKENS.ATTRIBUTE);

  // Filter live or dead tokens
  if ( liveTokensBlock ^ deadTokensBlock ) tokens = tokens.filter(t => {
    const hp = getObjectProperty(t.actor, hpAttribute);
    if ( typeof hp !== "number" ) return true;

    if ( liveTokensBlock && hp > 0 ) return true;
    if ( deadTokensBlock && hp <= 0 ) return true;
    return false;
  });


  if ( !proneTokensBlock ) tokens = tokens.filter(t => !t.isProne);

  // Pad (inset) to avoid triggering cover at corners. See issue 49.
  return tokens.map(t => new TokenPoints3d(t, { pad: -1 }));
}
