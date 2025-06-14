/* globals
canvas,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryDesc } from "./GeometryDesc.js";
import { Rectangle3dVertices, Polygon3dVertices } from "./BasicVertices.js";

const tmpRect = new PIXI.Rectangle();

export class GeometryToken extends GeometryDesc {

  get token() { return this.placeable; }

  static verticesIndicesMap = new Map();

  _defineStaticVertices() {
    return Rectangle3dVertices.calculateVertices();
  }

  calculateTransformMatrix() {
    const token = this.placeable;
    const { x, y, width, height } = token.document;
    const { topZ, bottomZ } = token;
    tmpRect.x = x;
    tmpRect.y = y;
    tmpRect.width = width * canvas.dimensions.size;
    tmpRect.height = height * canvas.dimensions.size;
    return Rectangle3dVertices.transformMatrixFromRectangle(tmpRect,
      { topZ, bottomZ, outMatrix: this.transformMatrix });
  }
}

export class GeometryConstrainedToken extends GeometryToken {

  // No static vertices per se but can use GeometryToken when not constrained.

  calculateModelVertices() {
    const token = this.placeable
    if ( token.isConstrainedTokenBorder ) {
      const { topZ, bottomZ, constrainedTokenBorder } = token;
      return Polygon3dVertices.calculateVertices(constrainedTokenBorder, { topZ, bottomZ });
    }
    return super.calculateModelVertices();
  }
}

export class GeometryLitToken extends GeometryToken {

  // No static vertices per se but can use GeometryToken when not lit.

  calculateModelVertices() {
    const { litTokenBorder, tokenBorder, topZ, bottomZ } = this.placeable;
    if ( !litTokenBorder.equals(tokenBorder) ) return Polygon3dVertices.calculateVertices(litTokenBorder, { topZ, bottomZ });
    return super.calculateModelVertices();
  }
}

export class GeometrySquareGrid extends GeometryToken {

  calculateTransformMatrix() {
    // Don't adjust for size but do adjust for elevation.
    const token = this.placeable;
    const { x, y, elevation } = token.document;
    tmpRect.x = x;
    tmpRect.y = y;
    tmpRect.width = canvas.dimensions.size;
    tmpRect.height = canvas.dimensions.size;
    const topZ = (canvas.dimensions.size * 0.5) + elevation;
    const bottomZ = (-canvas.dimensions.size * 0.5) + elevation;
    return Rectangle3dVertices.transformMatrixFromRectangle(tmpRect,
      { topZ, bottomZ, outMatrix: this.transformMatrix });
  }
}

// TODO: Hexes




