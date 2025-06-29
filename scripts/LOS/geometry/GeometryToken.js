/* globals
canvas,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryInstanced, GeometryNonInstanced } from "./GeometryDesc.js";
import { Rectangle3dVertices, Polygon3dVertices } from "./BasicVertices.js";

const tmpRect = new PIXI.Rectangle();

export class GeometryToken extends GeometryInstanced {

  get token() { return this.placeable; }

  static verticesIndicesMap = new Map();

  _defineInstanceVertices() {
    return Rectangle3dVertices.calculateVertices();
  }

  calculateTransformMatrix(token) {
    token ??= this.placeable;
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

  get vertices() { return this.modelVertices; }

  get indices() { return this.modelIndices; }

  // No static vertices per se but can use GeometryToken when not constrained.
  _calculateModel(vertices, indices) {
    const token = this.token;
    if ( token && token.isConstrainedTokenBorder ) return GeometryNonInstanced.prototype._calculateModel.call(this, vertices);
    this.transformMatrix = this.calculateTransformMatrix(token);
    return super._calculateModel(vertices, indices);
  }

  // Calculation when token is constrained.
  _calculateModelVertices(_vertices) {
    const token = this.token;
    if ( !token ) return;
    const { topZ, bottomZ, constrainedTokenBorder } = token;
    return Polygon3dVertices.calculateVertices(constrainedTokenBorder.toPolygon(), { topZ, bottomZ });
  }
}

export class GeometryLitToken extends GeometryToken {

  get vertices() { return this.modelVertices; }

  get indices() { return this.modelIndices; }

  // No static vertices per se but can use GeometryToken when not lit.
  _calculateModel(vertices, indices) {
    const token = this.token;
    if ( !token ) return super._calculateModel(vertices, indices);
    const { litTokenBorder, tokenBorder, topZ, bottomZ } = token;
    if ( !litTokenBorder || !litTokenBorder.equals(tokenBorder) ) return GeometryNonInstanced.prototype._calculateModel.call(this, vertices);
    this.transformMatrix = this.calculateTransformMatrix(token);
    return super._calculateModel(vertices, indices);
  }

  _calculateModelVertices(_vertices) {
    const token = this.token;
    if ( !token ) return;
    const { litTokenBorder, topZ, bottomZ } = this.placeable;
    const border = litTokenBorder || this.placeable.constrainedTokenBorder;
    return Polygon3dVertices.calculateVertices(border.toPolygon(), { topZ, bottomZ });
  }
}

export class GeometrySquareGrid extends GeometryToken {

  calculateTransformMatrix(token) {
    token ??= this.placeable;

    // Don't adjust for size but do adjust for elevation.
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




