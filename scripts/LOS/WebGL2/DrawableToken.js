/* globals
canvas,
CONFIG,
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2, DrawableObjectsNonInstancingWebGL2 } from "./DrawableObjects.js";
import { MODULE_ID } from "../../const.js";
import { MatrixFloat32 } from "../../geometry/Matrix.js";
import { mix } from "../../geometry/mixwith.js";
import { GEOMETRY_LIB_ID } from "../../geometry/const.js";

import * as twgl from "./twgl.js";
import { log } from "../util.js";

// Set that is used for temporary values.
// Not guaranteed to have any specific value.
const TMP_SET = new Set();


/* Handle drawing all different token types.
Instanced tokens:
- rectangular
- extruded ellipse
- hex (small or normal)
- sphere

Non-instanced tokens:
- constrained polygon
- lit polygon
- bright lit polygon
- larger hexes

Renderer selects 1+ instanced types and 1+ non-instanced types.

Each class determines if a token qualifies. Each token should qualify for only 1 class at a time.
It is assumed that:
- gridless can result in ellipses or rectangles, chosen by token shape.
- square grids use only rectangles
- hex grids use only hexes.




*/

/**
 * Common methods for token shapes.
 */
const TokenShapeMixin = superclass => class extends superclass {
  /** @type {class} */
  static get geomClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableGeometry.TokenGeometry; }

  get placeables() { return canvas.tokens.placeables; }

  static isBrightLit(token) {
    return token.brightLitTokenBorder && !token.tokenBorder.equals(token.brightLitTokenBorder);
  }

  static isLit(token) {
    return token.litTokenBorder && !token.tokenBorder.equals(token.litTokenBorder);
  }

  static isConstrained(token) {
    return token.constrainedTokenBorder && !token.tokenBorder.equals(token.constrainedTokenBorder);
  }

  static isInstancedHex(token) {
    return (token.document.width === 1 && token.document.height === 1)
       || (token.document.width === 0.5 && token.document.height === 0.5);
  }

  static isEllipse(token) {
    return canvas.grid.isGridless
      && (token.document.shape === CONST.TOKEN_SHAPES.ELLIPSE_1
       || token.document.shape === CONST.TOKEN_SHAPES.ELLIPSE_2);
  }

  static isRectangle(token) {
    return canvas.grid.isSquare
      || token.document.shape === CONST.TOKEN_SHAPES.ELLIPSE_1
      || token.document.shape === CONST.TOKEN_SHAPES.ELLIPSE_2;
  }

  static targetColor = [1, 0, 0, 1];

  renderTarget(target) {
    if ( CONFIG[MODULE_ID].debug ) {
      const i = this._indexForPlaceable(target);
      log(`${this.constructor.name}|renderTarget ${target.name} (${target.sourceId})|${i}`);
      if ( typeof i === "undefined" ) return;

      if ( this.trackers.vi ) {
        const { vertices, indices, indicesAdj } = this.trackers.vi.viewFacetAtIndex(i);
        console.table({ vertices: [...vertices], indices: [...indices], indicesAdj: [...indicesAdj] });
      }
      if ( this.trackers.model ) {
        const model = this.trackers.model.viewFacetAtIndex(i);
        console.table({ vertices: [...this.verticesArray], indices: [...this.indicesArray] });
        const mat = new MatrixFloat32(4, 4, model.buffer, model.byteOffset / model.BYTES_PER_ELEMENT);
        mat.print()
      }
    }

    TMP_SET.clear();
    const idx = this._indexForPlaceable(target);
    if ( typeof idx === "undefined" ) return;
    TMP_SET.add(idx);

    const gl = this.gl;
    this.webGL2.useProgram(this.programInfo);
    twgl.setBuffersAndAttributes(gl, this.programInfo, this.attributeBufferInfo);
    // twgl.setBuffersAndAttributes(gl, this.programInfo, this.vertexArrayInfo);
    // twgl.bindUniformBlock(gl, this.programInfo, this.renderer.uboInfo.camera);


    // Render the target red.
    // for ( let i = 0; i < 4; i += 1 ) this.materialUniforms.uColor[i] = this.constructor.targetColor[i];
    // twgl.setUniforms(this.programInfo, this.materialUniforms);


    this._drawFilteredInstances(TMP_SET)
    gl.bindVertexArray(null);
    this.gl.finish(); // For debugging
  }
}

export class DrawableRectangularTokenWebGL2 extends  mix(DrawableObjectsInstancingWebGL2).with(TokenShapeMixin) {

  static vertexDrawType = "STATIC_DRAW";

  /** @type {class} */
  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.TokenInstancedVertices; }

  filterObjects(tokens) {
    const { isConstrained, isRectangle } = this.constructor;
    tokens = super.filterObjects(tokens)
    return tokens.filter(token => !isConstrained(token) && isRectangle(token));
  }
}

export class DrawableInstancedHexTokenWebGL2 extends  mix(DrawableObjectsInstancingWebGL2).with(TokenShapeMixin) {

  static vertexDrawType = "STATIC_DRAW";

  /** @type {class} */
  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.Hex3dVertices; }

  filterObjects(tokens) {
    const isConstrained = this.constructor.isConstrained;
    tokens = super.filterObjects(tokens)
    return tokens.filter(token => !isConstrained(token));
  }
}

export class DrawableEllipseTokenWebGL2 extends  mix(DrawableObjectsInstancingWebGL2).with(TokenShapeMixin) {

  static vertexDrawType = "STATIC_DRAW";

  /** @type {class} */
  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.TokenInstancedVertices; }

  filterObjects(tokens) {
    const { isConstrained, isEllipse } = this.constructor;
    tokens = super.filterObjects(tokens)
    return tokens.filter(token => !isConstrained(token) && isEllipse(token));
  }
}

export class DrawableSphericalTokenWebGL2 extends  mix(DrawableObjectsInstancingWebGL2).with(TokenShapeMixin) {

  static vertexDrawType = "STATIC_DRAW";

  /** @type {class} */
  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.TokenInstancedVertices; }

  filterObjects(tokens) {
    const isConstrained = this.constructor.isConstrained;
    tokens = super.filterObjects(tokens)
    return tokens.filterObjects(token => !isConstrained(token));
  }
}

export class DrawableConstrainedTokenWebGL2 extends  mix(DrawableObjectsNonInstancingWebGL2).with(TokenShapeMixin) {

  static vertexDrawType = "DYNAMIC_DRAW";

  /** @type {class} */
  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.ConstrainedTokenModelVertices; }


  filterObjects(tokens) {
    const isConstrained = this.constructor.isConstrained;
    tokens = super.filterObjects(tokens)
    return tokens.filter(token => isConstrained(token));
  }
}


export class DrawableLitTokenWebGL2 extends  mix(DrawableObjectsNonInstancingWebGL2).with(TokenShapeMixin) {

  static vertexDrawType = "DYNAMIC_DRAW";

  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.LitTokenModelVertices; }


  filterObjects(tokens) {
    const isLit = this.constructor.isLit;
    tokens = super.filterObjects(tokens)
    return tokens.filter(token => isLit(token));
  }
}

export class DrawableBrightLitTokenWebGL2 extends  mix(DrawableObjectsNonInstancingWebGL2).with(TokenShapeMixin) {

  static vertexDrawType = "DYNAMIC_DRAW";

  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.BrightLitTokenModelVertices; }


  filterObjects(tokens) {
    const isBrightLit = this.constructor.isBrightLit;
    tokens = super.filterObjects(tokens)
    return tokens.filter(token => isBrightLit(token));
  }
}

export class DrawableLargeHexTokenWebGL2 extends  mix(DrawableObjectsNonInstancingWebGL2).with(TokenShapeMixin) {

  static vertexDrawType = "STATIC_DRAW";

  /** @type {class} */
  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.RegionPolygonModelVertices; } Hex3dVertices;

  filterObjects(tokens) {
    const { isInstanced, isBrightLit, isLit, isConstrained } = this.constructor;
    tokens = super.filterObjects(tokens)
    return tokens.filter(token => !(isInstanced(token) || isBrightLit || isLit || isConstrained(token)) );
  }
}

export class DrawableGridShape extends DrawableObjectsInstancingWebGL2 {
  /** @type {class} */
  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.TokenInstancedVertices; }

  /** @type {class} */
  static get geomClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableGeometry.TokenGeometry; }

  static vertexDrawType = "STATIC_DRAW";

  get placeables() { return []; }

  filterObjects() { return; }

  render() { return; }

  renderTarget(target) { DrawableRectangularTokenWebGL2.prototype.renderTarget.call(this, target); }

  get debugViewNormals() { return false; } // No normals.
}