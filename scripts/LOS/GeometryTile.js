/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryDesc } from "./GeometryDesc.js";
import { HorizontalQuadVertices } from "./BasicVertices.js";

const tmpRect = new PIXI.Rectangle();

export class GeometryTile extends GeometryDesc {

  get tile() { return this.placeable; }

  static verticesIndicesMap = new Map();

  _defineStaticVertices() {
    return HorizontalQuadVertices.calculateVertices(undefined, { type: "doubleUp"} );
  }

  calculateTransformMatrix() {
    const tile = this.placeable;
    const { rotation, x, y, width, height, elevation } = tile.document;
    const radians = Math.toRadians(rotation);
    const rotateM = CONFIG.GeometryLib.MatrixFlat.rotationZ(radians);
    tmpRect.x = x;
    tmpRect.y = y;
    tmpRect.width = width;
    tmpRect.height = height;
    return HorizontalQuadVertices.transformMatrixFromRectangle(tmpRect,
      { rotateM, topZ: elevation, bottomZ: elevation, outMatrix: this.transformMatrix });
  }
}

