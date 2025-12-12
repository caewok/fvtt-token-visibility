/* globals
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryInstanced } from "./GeometryDesc.js";
import { VerticalQuadVertices } from "./BasicVertices.js";

export class GeometryWall extends GeometryInstanced {

  get wallDirection() { return this.type; }

  constructor({ type = "directional", ...opts } = {}) {
    opts.type = type === "directional" ? "directional" : "double";
    super(opts);
  }

  _defineInstanceVertices() {
    // Directional south walls will be rotated 180º to match north.
    return VerticalQuadVertices.calculateVertices(undefined, undefined, { type: this.wallDirection } );
  }

  calculateTransformMatrix(wall) {
    wall ??= this.placeable;
    let { topZ, bottomZ } = wall;
    if ( !isFinite(topZ) ) topZ = 1e06;
    if ( !isFinite(bottomZ) ) bottomZ = -1e06;

    // When calculating the transform, rotate south (right) walls 180º.
    const rotate = wall.document.dir ===  CONST.WALL_DIRECTIONS.RIGHT ? Math.PI : 0;
    return VerticalQuadVertices.transformMatrixFromSegment(wall.edge.a, wall.edge.b,
      { topZ, bottomZ, outMatrix: this.transformMatrix, rotate });
  }
}
