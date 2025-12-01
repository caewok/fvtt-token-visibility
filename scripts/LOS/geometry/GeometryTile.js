/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryInstanced } from "./GeometryDesc.js";
import { HorizontalQuadVertices } from "./BasicVertices.js";
import { MatrixFlat } from "../../geometry/MatrixFlat.js";

const tmpRect = new PIXI.Rectangle();

export class GeometryTile extends GeometryInstanced {

  get addUVs() { return true; } // Always add UVs for tiles.

  get tile() { return this.placeable; }

  _defineInstanceVertices() {
    return HorizontalQuadVertices.calculateVertices(undefined, { type: "doubleUp"} );
  }

  calculateTransformMatrix(tile) {
    tile ??= this.placeable;
    const { rotation, x, y, width, height, elevation } = tile.document;
    const radians = Math.toRadians(rotation);
    const rotateM = MatrixFlat.rotationZ(radians);
    tmpRect.x = x;
    tmpRect.y = y;
    tmpRect.width = width;
    tmpRect.height = height;
    return HorizontalQuadVertices.transformMatrixFromRectangle(tmpRect,
      { rotateM, topZ: elevation, bottomZ: elevation, outMatrix: this.transformMatrix });
  }
}

