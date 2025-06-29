/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableModelMatrixTracker } from "./PlaceableTracker.js";
import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";

// Base folder


// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
// const rotationM = MatrixFloat32.identity(4, 4);

export class TokenTracker extends PlaceableModelMatrixTracker {
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
    "refreshElevation",
  ]);

  static layer = "tokens";

  translationMatrixForPlaceable(token) {
    // Move from center of token.
    const ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
    CONFIG.GeometryLib.MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, translationM);
    return translationM;
  }

  scaleMatrixForPlaceable(token) {
    // Scale based on width, height, zHeight of token.
    const { width, height, zHeight } = this.constructor.tokenDimensions(token);
    CONFIG.GeometryLib.MatrixFloat32.scale(width, height, zHeight, scaleM);
    return scaleM;
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
    // For hex grids, the token instances already account for width and height.
    const width = canvas.grid.isHexagonal ? 1 : token.document.width;
    const height = canvas.grid.isHexagonal ? 1 : token.document.height;
    const zHeight = canvas.grid.isHexagonal ? 1 : (token.topZ - token.bottomZ)

    // Shrink tokens slightly to avoid z-fighting with walls and tiles.
    return {
      width: width * canvas.dimensions.size * .99,
      height: height * canvas.dimensions.size * .99,
      zHeight: zHeight * .99,
    };
  }
}
