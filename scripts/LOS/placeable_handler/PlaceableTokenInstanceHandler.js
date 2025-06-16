/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableInstanceHandler } from "./PlaceableInstanceHandler.js";
import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";

// Base folder


// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
// const rotationM = MatrixFloat32.identity(4, 4);

export class TokenInstanceHandler extends PlaceableInstanceHandler {
  static HOOKS = [
    { drawToken: "_onPlaceableDraw" },
    { refreshToken: "_onPlaceableRefresh" },
    { destroyToken: "_onPlaceableDestroy" },
  ];

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
    "refreshPosition",
    "refreshSize",
  ]);

  /**
   * Get edges in the scene.
   */
  getPlaceables() {
    return canvas.tokens.placeables.filter(token => this.includePlaceable(token));
  }

  /**
   * Should this token be included in the scene render?
   * Constrained tokens included here; handled later in prerender.
   */
  // includePlaceable(_token) { return true; }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(idx) {
    const token = this.placeableFromInstanceIndex.get(idx);
    if ( !token ) return;
    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;

    const ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
    const { width, height, zHeight } = this.constructor.tokenDimensions(token);

    // Move from center of token.
    MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, translationM);

    // Scale based on width, height, zHeight of token.
    MatrixFloat32.scale(width, height, zHeight, scaleM);

    return super.updateInstanceBuffer(idx,
      { translation: translationM, scale: scaleM });
  }

  /**
   * Determine the token 3d dimensions, in pixel units.
   * @param {Token} token
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} zHeight     In z direction
   */
  static tokenDimensions(token) {
    // Shrink tokens slightly to avoid z-fighting with walls and tiles.
    return {
      width: token.document.width * canvas.dimensions.size * .99,
      height: token.document.height * canvas.dimensions.size * .99,
      zHeight: (token.topZ - token.bottomZ) * .99,
    };
  }
}
