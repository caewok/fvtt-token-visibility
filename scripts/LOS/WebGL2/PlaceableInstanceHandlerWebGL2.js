/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometryWallDesc } from "../WebGPU/GeometryWall.js";
import { GeometryHorizontalPlaneDesc } from "../WebGPU/GeometryTile.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc } from "../WebGPU/GeometryToken.js";
import {
  NonDirectionalWallInstanceHandler,
  DirectionalWallInstanceHandler,
  NonDirectionalTerrainWallInstanceHandler,
  DirectionalTerrainWallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
} from "../WebGPU/PlaceableInstanceHandler.js";

// Mixin for storing wall geometry and updating vertices based on changes to the instances.
const VerticesMixin = function(Base) {
  class Vertices extends Base {
    /** @type {ArrayBuffer} */
    verticesBuffer = new ArrayBuffer();

    /** @type {ArrayBuffer} */
    indicesBuffer = new ArrayBuffer();

    /** @type {Float32Array} */
    verticesArray = new Float32Array();

    /** @type {Uint16Array} */
    indicesArray = new Uint16Array();

    /** @type {Float32Array[]} */
    vertices = [];

    /** @type {Uint16Array[]} */
    indices = [];

    /** @type {boolean} */
    addNormals = false;

    /** @type {boolean} */
    addUVs = false;

    /** @type {GeometryDesc} */
    geom;

    constructor({ senseType = "sight", addNormals = false, addUVs = false } = {}) {
      const keys = [addNormals, addUVs];
      super({ senseType, keys });
      this.addNormals = addNormals;
      this.addUVs = addUVs;
    }

    /**
     * Construct data related to the number of instances.
     * @param {number} numPlaceables
     */
    _createInstanceBuffer(numPlaceables) {
      super._createInstanceBuffer(numPlaceables);
      const geom = this.geom;
      this.verticesBuffer = new ArrayBuffer(numPlaceables * geom.vertices.byteLength);
      this.indicesBuffer = new ArrayBuffer(numPlaceables * geom.indices.byteLength);
      this.verticesArray = new geom.vertices.constructor(this.verticesBuffer);
      this.indicesArray = new geom.indices.constructor(this.indicesBuffer);

      // Create distinct views into the vertices and indices buffers
      this.vertices = new Array(numPlaceables);
      this.indices = new Array(numPlaceables);
      for ( let i = 0; i < numPlaceables; i += 1 ) {
        const numIndices = geom.indices.length;
        this.vertices[i] = new geom.vertices.constructor(this.verticesBuffer, i * geom.vertices.byteLength, geom.vertices.length);
        const indices = this.indices[i] = new geom.indices.constructor(this.indicesBuffer, i * geom.indices.byteLength, numIndices);

        // Set the indices for each; incrementing for each subsequent placeable after the first.
        const offset = geom.numVertices * i;
        for ( let j = 0; j < numIndices; j += 1 ) indices[j] = geom.indices[j] + offset;
      }
    }

    /**
     * Update the instance array of a specific placeable.
     * Also updates the relevant vertices.
     * @param {string} placeableId          Id of the placeable
     * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
     * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
     */
    updateInstanceBuffer(idx, opts) {
      const res = super.updateInstanceBuffer(idx, opts);
      const M = this.matrices[idx];
      const geomVertices = this.geom.vertices;
      const vertices = this.vertices[idx];
      const Point3d = CONFIG.GeometryLib.threeD.Point3d;
      const stride = (this.addNormals && this.addUVs) ? 8
        : this.addNormals ? 6
        : this.addUVs ? 5
        : 3;

      for ( let i = 0, iMax = geomVertices.length; i < iMax; i += stride ) {
        const xIdx = i;
        const yIdx = i + 1;
        const zIdx = i + 2;
        const pt = Point3d._tmp.set(geomVertices[xIdx], geomVertices[yIdx], geomVertices[zIdx]);
        const txPt = M.multiplyPoint3d(pt, Point3d._tmp1);

        vertices[xIdx] = txPt.x;
        vertices[yIdx] = txPt.y;
        vertices[zIdx] = txPt.z;
      }

      if ( this.addNormals ) {
        // Should not matter for fully vertical or horizontal triangles, but...
        // See https://webgl2fundamentals.org/webgl/lessons/webgl-3d-lighting-directional.html
        // TODO: For tiles, this seems incorrect. Normal should be -1 or +1.
        // const invTransposeM = M.invert().transpose();
        // See https://github.com/graphitemaster/normals_revisited
        // Just use the rotation matrix.

        for ( let i = 3, iMax = geomVertices.length; i < iMax; i += stride ) {
          const xIdx = i;
          const yIdx = i + 1;
          const zIdx = i + 2;
          const pt = Point3d._tmp.set(geomVertices[xIdx], geomVertices[yIdx], geomVertices[zIdx]);
          const txPt = res.rotation.multiplyPoint3d(pt, Point3d._tmp1).normalize();

          vertices[xIdx] = txPt.x;
          vertices[yIdx] = txPt.y;
          vertices[zIdx] = txPt.z;
        }
      }

      if ( this.addUVs ) {
        const offset = this.addNormals ? 6 : 3;
        for ( let i = offset, iMax = geomVertices.length; i < iMax; i += stride ) {
          const uIdx = i;
          const vIdx = i + 1;
          vertices[uIdx] = geomVertices[uIdx];
          vertices[vIdx] = geomVertices[vIdx];
        }
      }
    }
  }
  return Vertices;
}


/**
 * Store the wall geometry and update vertices based on changes to the instance matrix.
 */
export class NonDirectionalWallInstanceHandlerWebGL2 extends VerticesMixin(NonDirectionalWallInstanceHandler) {
  constructor(opts) {
    super(opts);
    const { addNormals, addUVs } = this;
    this.geom = new GeometryWallDesc({ directional: false, addNormals, addUVs });
  }
}

export class DirectionalWallInstanceHandlerWebGL2 extends VerticesMixin(DirectionalWallInstanceHandler) {
  constructor(opts) {
    super(opts);
    const { addNormals, addUVs } = this;
    this.geom = new GeometryWallDesc({ directional: true, addNormals, addUVs });
  }
}

export class NonDirectionalTerrainWallInstanceHandlerWebGL2 extends VerticesMixin(NonDirectionalTerrainWallInstanceHandler) {
  constructor(opts) {
    super(opts);
    const { addNormals, addUVs } = this;
    this.geom = new GeometryWallDesc({ directional: false, addNormals, addUVs });
  }
}

export class DirectionalTerrainWallInstanceHandlerWebGL2 extends VerticesMixin(DirectionalTerrainWallInstanceHandler) {
  constructor(opts) {
    super(opts);
    const { addNormals, addUVs } = this;
    this.geom = new GeometryWallDesc({ directional: true, addNormals, addUVs });
  }
}

export class TileInstanceHandlerWebGL2 extends VerticesMixin(TileInstanceHandler) {
  constructor(opts) {
    super(opts);
    const { addNormals, addUVs } = this;
    this.geom = new GeometryHorizontalPlaneDesc({ addNormals, addUVs });
  }
}

export class SceneInstanceHandlerWebGL2 extends TileInstanceHandlerWebGL2 {
  constructor(opts) {
    super(opts);
    const { addNormals, addUVs } = this;
    this.geom = new GeometryHorizontalPlaneDesc({ addNormals, addUVs });
  }

  getPlaceables() {
    if ( !canvas.scene.background.src ) return [];
    return [{ id: canvas.scene.id, ...canvas.scene.background}];
  }

  // includePlaceable(sceneObj) { return Boolean(canvas.scene.background.src); }

  static tileRotation() { return 0; }

  static tileDimensions() { return canvas.dimensions.sceneRect; }

  static tileCenter() {
    const ctr = canvas.dimensions.rect.center;
    return new Point3d(ctr.x, ctr.y, 0);
  }
}

/**
 * Store the token geometry and update vertices based on changes to the instance matrix.
 */
export class TokenInstanceHandlerWebGL2 extends VerticesMixin(TokenInstanceHandler) {
  /** @type {GeometryDesc[]} */
  constrainedGeoms = [];

  constructor(opts) {
    super(opts);
    const { addNormals, addUVs } = this;
    this.geom = new GeometryCubeDesc({ addNormals, addUVs });
  }

  /**
   * Construct data related to the number of instances.
   * For tokens, always use the constrained geometry.
   * @param {number} numPlaceables
   */
  _createInstanceBuffer(numPlaceables) {
    super._createInstanceBuffer(numPlaceables);
    this.geoms = new Array(numPlaceables);
  }

  /**
   * Update the instance array of a specific placeable.
   * Also updates the relevant vertices and creates constrained geometries if necessary.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(idx, opts) {
    super.updateInstanceBuffer(idx, opts);
    const token = this.placeableFromInstanceIndex.get(idx);
    if ( !token.isConstrained ) {
      this.geoms[idx] = undefined;
      return;
    }
    const { addNormals, addUVs } = this;
    this.geoms[idx] = new GeometryConstrainedTokenDesc({ token, addNormals, addUVs });
  }
}