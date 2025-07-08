/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryInstanced, GeometryNonInstanced } from "./GeometryDesc.js";
import { Rectangle3dVertices, Polygon3dVertices, Hex3dVertices, BasicVertices } from "./BasicVertices.js";
import { OBJParser } from "./OBJParser.js";
import { TriangleSplitter } from "./TriangleSplitter.js";
import { Triangle3d } from "./Polygon3d.js";
import { OTHER_MODULES, FLAGS } from "../../const.js";

const tmpRect = new PIXI.Rectangle();

export class GeometryToken extends GeometryInstanced {

  get token() { return this.placeable; }

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
    const { litTokenBorder, tokenBorder } = token;
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

export class GeometryHexToken extends GeometryToken {

  constructor(opts = {}) {
    opts.type = opts.hexKey || "0_1_1";
    super(opts);
  }

  calculateTransformMatrix(token) {
    token ??= this.placeable;
    const { x, y } = token.document;
    const { topZ, bottomZ } = token;
    tmpRect.x = x;
    tmpRect.y = y;

    // Hex template already accounts for size.
    tmpRect.width = canvas.dimensions.size;
    tmpRect.height = canvas.dimensions.size;

    return Rectangle3dVertices.transformMatrixFromRectangle(tmpRect,
      { topZ, bottomZ, outMatrix: this.transformMatrix });
  }

  get hexKey() { return this.type; }

  _defineInstanceVertices() {
    const { hexagonalShape, width, height } = Hex3dVertices.hexPropertiesForKey(this.hexKey);
    return Hex3dVertices.calculateVertices(hexagonalShape, { width, height });
  }
}

export class GeometryCustomToken extends GeometryToken {

  objData = {
    fileLoc: "",
    name: "",
    offset: null,
    parser: null,
  };

  get instanceKey() {
    const key = super.instanceKey;
    const { fileLoc, name, offset } = this.objData;
    return `${key}_${fileLoc}|${name}|${offset}`
  }

  defineInstance(force = false) {
    if ( force ) return; // Don't define instance until initialize.
    super.defineInstance();
  }

  async initialize() {
    await this.loadOBJFileFromToken();
    this.defineInstance(true);
    return super.initialize();
  }

  async loadOBJFileFromToken(token) {
    token ??= this.placeable;
    const ATV = OTHER_MODULES.ATV;
    const doc = token.document;
    const objFile = doc.getFlag(ATV.KEY, FLAGS.CUSTOM_TOKENS.FILE_LOC) || "modules/tokenvisibility/icons/Cube.obj";
    const objName = doc.getFlag(ATV.KEY, FLAGS.CUSTOM_TOKENS.NAME) || "Cube";
    const objOffset = CONFIG.GeometryLib.threeD.Point3d.fromObject(doc.getFlag(ATV.KEY, FLAGS.CUSTOM_TOKENS.OFFSET) || { x: 0, y: 0, z: 0 });
    this.objData.fileLoc = objFile;
    this.objData.name = objName;
    this.objData.offset = objOffset;
    this.objData.parser = new OBJParser(objFile);
    await this.objData.parser.loadObjectFile();
  }

  _defineInstanceVertices() {
    const obj = this.objData.parser.getObject(this.objData.name);
    return obj.combineMaterials()
  }
}

export class GeometryConstrainedCustomToken extends GeometryCustomToken {
  get vertices() { return this.modelVertices; }

  get indices() { return this.modelIndices; }

  _triangles3d;

  isConstrained = false;


  defineInstance() {
    super.defineInstance();
  }


  // Calculation when token is constrained.
  _calculateModel(vertices, indices) {
    const res = super._calculateModel(vertices, indices); // Returns { vertices, indices }
    const token = this.placeable;

    // Locate each edge in the constrained token border that does not match the token border.
    if ( !token.isConstrainedTokenBorder ) {
      this.isConstrained = false;
      return res;
    } else this.isConstrained = true;

    // Convert to triangles, which will be later constrained by the constrained border.
    let tris = Triangle3d.fromVertices(res.vertices, res.indices, this.stride);

    // TODO: Need to ensure the edges are A --> B where CW faces in toward the filled polygon.
    const edgeDiffFn = token.tokenBorder instanceof PIXI.Rectangle ? diffRectanglePolygonEdges : diffPolygonEdges;
    const edges = edgeDiffFn(token.tokenBorder, token.constrainedTokenBorder.toPolygon());

    // Split the custom shape using a vertical plane corresponding to each edge.
    for ( const edge of edges ) {
      const splitter = TriangleSplitter.from2dPoints(edge.A, edge.B, true);
      tris = splitter.splitFromTriangles3d(tris);
    }
    const vs = Triangle3d.trianglesToVertices(tris, { addNormals: this.addNormals })
    return BasicVertices.condenseVertexData(vs, { stride: this.stride });
  }
}

export class GeometryLitCustomToken extends GeometryCustomToken {
  get vertices() { return this.modelVertices; }

  get indices() { return this.modelIndices; }

  _triangles3d;


  defineInstance() {
    super.defineInstance();
  }

  isLit = false;

  // Calculation when token is lit.
  _calculateModel(vertices, indices) {
    const res = super._calculateModel(vertices, indices); // Returns { vertices, indices }
    const token = this.placeable;

    // Locate each edge in the constrained token border that does not match the token border.
    const { litTokenBorder, tokenBorder } = token;
    if ( !litTokenBorder || !litTokenBorder.equals(tokenBorder) ) {
      this.isLit = false;
      return res;
    } else this.isLit = true;

    // Convert to triangles, which will be later constrained by the constrained border.
    let tris = Triangle3d.fromVertices(res.vertices, res.indices, this.stride);

    // TODO: Need to ensure the edges are A --> B where CW faces in toward the filled polygon.
    const edgeDiffFn = token.tokenBorder instanceof PIXI.Rectangle ? diffRectanglePolygonEdges : diffPolygonEdges;
    const edges = edgeDiffFn(token.tokenBorder, token.constrainedTokenBorder.toPolygon());

    // Split the custom shape using a vertical plane corresponding to each edge.
    for ( const edge of edges ) {
      const splitter = TriangleSplitter.from2dPoints(edge.A, edge.B, true);
      tris = splitter.splitFromTriangles3d(tris);
    }
    const vs = Triangle3d.trianglesToVertices(tris, { addNormals: this.addNormals })
    return BasicVertices.condenseVertexData(vs, { stride: this.stride });
  }

}


/**
 * @typedef {object} PolyEdge
 * @prop {object} A
 *   - @prop {number} x
 *   - @prop {number} y
 * @prop {object} B
 *   - @prop {number} x
 *   - @prop {number} y
 */

/**
 * Find edges in polygon1 that are not part of the polygon0 edge.
 * If any portion of the edge overlaps, that counts as part of the polygon.
 * @param {PIXI.Polygon} poly0
 * @param {PIXI.Polygon} poly1
 * @returns {Set<PolyEdge>}
 */
function diffPolygonEdges(poly0, poly1) {
  // Sweep left to right along x-axis with sorting instead of brute force
  const isOnSegment = CONFIG.GeometryLib.utils.isOnSegment;
  const orient2d = foundry.utils.orient2dFast;
  const edges0 = [...poly0.iterateEdges({ close: true })];
  const edges1 = [...poly1.iterateEdges({ close: true })];

  // Sort edges by their maximum x value.
  const sortFn = (a, b) => Math.max(a.A.x, a.B.x)  - Math.max(b.A.x, b.B.x)
  edges0.sort(sortFn);
  edges1.sort(sortFn);

  const edges0Set = new Set(edges0);
  const edges1Set = new Set([edges1]);
  for ( const edge1 of edges1 ) {
    const targetX = Math.max(edge1.A.x, edge1.A.y);
    for ( const edge0 of edges0Set ) {
      // If this edge is too far left, can skip going forward.
      if ( Math.max(edge0.A.x, edge0.A.y) < targetX ) {
        edges0Set.delete(edge0);
        continue;
      }

      // Edge 0 and edge 1 must be collinear.
      if ( !(orient2d(edge0.A, edge0.B, edge1.A).almostEqual(0)
          && orient2d(edge0.A, edge0.B, edge1.B).almostEqual(0)) ) continue;

      // Edge1's endpoint must be within edge0 or vice-versa
      if ( isOnSegment(edge0.A, edge0.B, edge1.A)
        || isOnSegment(edge0.A, edge0.B, edge1.B)
        || isOnSegment(edge1.A, edge1.B, edge0.A)
        || isOnSegment(edge1.A, edge1.B, edge0.B) ) edges1Set.delete(edge1);
    }
  }
  return edges1Set;
}

/**
 * Find edges in polygon that are not part of the rectangle edge.
 * If any portion of the edge overlaps, that counts as part of the rectangle.
 * @param {PIXI.Rectangle} rect
 * @param {PIXI.Polygon} poly1
 * @returns {Set<PolyEdge>}
 */
function diffRectanglePolygonEdges(rect, poly) {
  const out = new Set();
  for ( const edge of poly.iterateEdges({ close: true }) ) {
    if ( (edge.B.y - edge.A.y).almostEqual(0) ) { // Edge is horizontal
      if ( edge.A.x.between(rect.left, rect.right)
        || edge.B.x.between(rect.left, rect.right)
        || (edge.A.x < rect.left && edge.B.x > rect.right)
        || (edge.B.x < rect.left && edge.A.x > rect.right) ) continue;

    } else if ( (edge.B.x - edge.A.x).almostEqual() ) { // Edge is vertical
      if ( edge.A.y.between(rect.top, rect.bottom)
        || edge.B.y.between(rect.top, rect.bottom)
        || (edge.A.y < rect.top && edge.B.y > rect.bottom)
        || (edge.B.y < rect.top && edge.A.y > rect.bottom) ) continue;
    }
    out.add(edge);
  }
  return out;
}
