/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryDesc } from "./GeometryDesc.js";
import { VerticalQuadVertices } from "./BasicVertices.js";

export class GeometryWall extends GeometryDesc {

  get wall() { return this.placeable; }

  get edge() { return this.placeable.edge; }

  static verticesIndices = new Map();

  get staticVertexKey() { return `${super.staticVertexKey}_${this.placeable.document.dir}`; }

  _defineStaticVertices() {
    const type = this.placeable.document.dir;
    return VerticalQuadVertices.calculateVertices(undefined, undefined, { type } );
  }

  calculateTransformMatrix() {
    const wall = this.placeable;
    let { topZ, bottomZ } = wall;
    if ( !isFinite(topZ) ) topZ = 1e06;
    if ( !isFinite(bottomZ) ) bottomZ = -1e06;
    return VerticalQuadVertices.transformMatrixFromSegment(wall.edge.a, wall.edge.b,
      { topZ, bottomZ, outMatrix: this.transformMatrix });
  }
}
