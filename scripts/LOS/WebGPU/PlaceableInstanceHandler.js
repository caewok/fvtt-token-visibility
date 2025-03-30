/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";
import { MODULES_ACTIVE } from "../../const.js";

// Base folder


// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const rotationM = MatrixFloat32.identity(4, 4);


class PlaceableInstanceHandler {

  /**
   * Only keep one instance of each handler type. Class and sense type.
   * @type {Map<string, PlaceableInstanceHandler>}
   */
  static handlers = new Map();

  /** @type {number} */
  static INSTANCE_ELEMENT_LENGTH = 16; // Single mat4x4.

  static INSTANCE_ELEMENT_SIZE = this.INSTANCE_ELEMENT_LENGTH * Float32Array.BYTES_PER_ELEMENT;

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static docUpdateKeys = new Set();

  /**
   * Flags in refreshObject hook that indicate a relevant change to the placeable.
   */
  static refreshFlags = new Set();

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  constructor({ senseType = "sight" } = {}) {
    const key = `${this.constructor.name}_${senseType}`;
    const handlers = this.constructor.handlers;
    if ( handlers.has(key) ) return handlers.get(key);
    handlers.set(key, this);
    this.senseType = senseType;
  }

  /** @type {Map<string, number>} */
  instanceIndexFromId = new Map();

  /** @type {Map<number, Placeable|Edge>} */
  placeableFromInstanceIndex = new Map();

  /** @type {number} */
  get numInstances() { return this.instanceIndexFromId.size; }

  /** @type {ArrayBuffer} */
  instanceArrayBuffer;

  get instanceArrayValues() { return new Float32Array(this.instanceArrayBuffer); }

  /**
   * Initialize all placeables.
   */
  initializePlaceables() {
    this.instanceIndexFromId.clear();
    this.placeableFromInstanceIndex.clear();
    const placeables = this.getPlaceables();

    // mat4x4 for each placeable; 4 bytes per entry.
    this.instanceArrayBuffer = new ArrayBuffer(placeables.length * this.constructor.INSTANCE_ELEMENT_SIZE);
    placeables.forEach((placeable, idx) => {
      this.instanceIndexFromId.set(placeable.id, idx);
      this.placeableFromInstanceIndex.set(idx, placeable);
      this.updateInstanceBuffer(placeable.id, idx, placeable);
    });
  }

  /**
   * Subclass locate placeables.
   * @returns {Placeable|Edge[]}
   * @override
   */
  getPlaceables() { return []; }

  /**
   * Subclass test for placeable inclusion in the instance array.
   * @param {Placeable|Edge}
   * @returns {boolean}
   * @override
   */
  includePlaceable(_placeable) { return true; }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(placeableId, idx, placeable, { rotation, translation, scale } = {}) {
    rotation ??= MatrixFloat32.identity(4, 4, rotationM);
    translation ??= MatrixFloat32.identity(4, 4, translationM);
    scale ??= MatrixFloat32.identity(4, 4, scaleM);

    const arrM = this.getPlaceableInstanceData(placeableId, idx);
    const M = new MatrixFloat32(arrM, 4, 4);
    scale
      .multiply4x4(rotation, M)
      .multiply4x4(translation, M);

    // NOTE: Return only for debugging.
    return {
      translation,
      scale,
      rotation,
      out: M
    };
  }

  /**
   * Retrieve the array views associated with a given placeable.
   * @param {string} placeableId  Id of the placeable
   * @param {number} [idx]        Optional placeable index; will be looked up using placeableId otherwise
   */
  getPlaceableInstanceData(placeableId, idx) {
    idx ??= this.instanceIndexFromId.get(placeableId);
    const i = idx * this.constructor.INSTANCE_ELEMENT_SIZE;
    return new Float32Array(this.instanceArrayBuffer, i, 16);
  }
}

export class WallInstanceHandler extends PlaceableInstanceHandler {
  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static docUpdateKeys = new Set([
    "x",
    "y",
    "flags.elevatedvision.elevation.top",
    "flags.elevatedvision.elevation.bottom",
    "flags.wall-height.top",
    "flags.wall-height.top",
    "c",
    "dir",
  ]);

  /**
   * Flags in refreshObject hook that indicate a relevant change to the placeable.
   */
  static refreshFlags = new Set([
    "refreshLine",
    "refreshDirection",
    "refreshEndpoints",
  ]);

  /**
   * Get edges in the scene.
   */
  getPlaceables() {
    return [...canvas.edges.values()].filter(edge => this.includePlaceable(edge));
  }

  edgeTypes = new Set(["wall"]);

  /**
   * Should this edge be included in the scene render?
   * Certain edges, like scene borders, are excluded.
   */
  includePlaceable(edge) {
    if ( edge[this.senseType] === CONST.WALL_SENSE_TYPES.NONE ) return false;
    if ( !this.edgeTypes.has(edge.type) ) return false;
    return true;
  }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(placeableId, idx, placeable) {
    idx ??= this.instanceIndexFromId.get(placeableId);
    const edge = placeable ??= this.placeableFromInstanceIndex.get(idx);
    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;

    const pos = this.constructor.edgeCenter(edge);
    const { top, bottom } = this.constructor.edgeElevation(edge);
    const rot = this.constructor.edgeAngle(edge);
    const ln = this.constructor.edgeLength(edge);

    // Add in translate to center to 0,0 if elevations do not match.
    // e.g., bottom elevation -1e05, top elevation 200.
    let z = 0.0;
    let scaleZ = 1.0;
    if ( top != bottom ) {
      z = ((0.5 * top) + (0.5 * bottom));
      scaleZ = top - bottom;
    }

    // Move from center of wall.
    MatrixFloat32.translation(pos.x, pos.y, z, translationM);

    // Scale by its length and elevation (height).
    MatrixFloat32.scale(ln, 1.0, scaleZ, scaleM);

    // Rotate around Z axis to match wall direction.
    MatrixFloat32.rotationZ(rot, true, rotationM);

    super.updateInstanceBuffer(placeableId, idx, placeable,
      { rotation: rotationM, translation: translationM, scale: scaleM });
  }

  /**
   * Determine the top and bottom edge elevations. Null values will be given large constants.
   * @param {Edge} edge
   * @returns {object}
   * - @prop {number} top         1e05 if null
   * - @prop {number} bottom      -1e05 if null
   */
  static edgeElevation(edge) {
    let { top, bottom } = edge.elevationLibGeometry.a;
    top ??= 1e05;
    bottom ??= -1e05;
    top = CONFIG.GeometryLib.utils.gridUnitsToPixels(top);
    bottom = CONFIG.GeometryLib.utils.gridUnitsToPixels(bottom);
    return { top, bottom };
  }

  /**
   * Determine the 2d center point of the edge.
   * @param {Edge} edge
   * @returns {PIXI.Point}
   */
  static edgeCenter(edge) {
    const ctr = new PIXI.Point();
    return edge.a.add(edge.b, ctr).multiplyScalar(0.5, ctr);
  }

  /**
   * Determine the 2d length of the edge.
   * @param {Edge} edge
   * @returns {number}
   */
  static edgeLength(edge) { return PIXI.Point.distanceBetween(edge.a, edge.b); }

  /**
   * Angle of the edge on the 2d canvas.
   * @param {Edge} edge
   * @returns {number} Angle in radians
   */
  static edgeAngle(edge) {
    const delta = edge.b.subtract(edge.a, PIXI.Point._tmp3);
    return Math.atan2(delta.y, delta.x);
  }
}

export class TileInstanceHandler extends PlaceableInstanceHandler {
  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static docUpdateKeys = new Set([
    "x",
    "y",
    "elevation",
    "width",
    "height",
    "rotation",
  ]);

  /**
   * Flags in refreshObject hook that indicate a relevant change to the placeable.
   */
  static refreshFlags = new Set([
    "refreshPosition",
    "refreshRotation",
    "refreshSize",
  ]);

  /**
   * Get edges in the scene.
   */
  getPlaceables() {
    return canvas.tiles.placeables.filter(tile => this.includePlaceable(tile));
  }

  /**
   * Should this tile be included in the scene render?
   */
  includePlaceable(tile) {
    // Exclude tiles at elevation 0 because these overlap the ground.
    if ( !tile.elevationZ ) return false;

    // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
    if ( MODULES_ACTIVE.LEVELS
      && this.senseType === "sight"
      && tile.document?.flags?.levels?.noCollision ) return false;

    return true;
  }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(placeableId, idx, placeable) {
    idx ??= this.instanceIndexFromId.get(placeableId);
    const tile = placeable ??= this.placeableFromInstanceIndex.get(idx);
    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;

    const ctr = this.constructor.tileCenter(tile);
    const { width, height } = this.constructor.tileDimensions(tile);

    // Move from center of tile.
    MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, translationM);

    // Scale based on width, height of tile.
    MatrixFloat32.scale(width, height, 1.0, scaleM);

    // Rotate based on tile rotation.
    MatrixFloat32.rotationZ(Math.toRadians(tile.document.rotation), true, rotationM);

    super.updateInstanceBuffer(placeableId, idx, placeable,
      { rotation: rotationM, translation: translationM, scale: scaleM });
  }

  /**
   * Determine the tile 3d dimensions, in pixel units.
   * @param {Tile} tile
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} elevation   In z direction
   */
  static tileDimensions(tile) {
    return {
      width: tile.document.width,
      height: tile.document.height,
    };
  }

  /**
   * Determine the center of the tile, in pixel units.
   * @param {Tile} tile
   * @returns {Point3d}
   */
  static tileCenter(tile) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const out = new Point3d();
    const elev = tile.elevationZ;
    const TL = Point3d._tmp2.set(tile.document.x, tile.document.y, elev);
    const BR = TL.add(out.set(tile.document.width, tile.document.height, 0), out);
    return TL.add(BR, out).multiplyScalar(0.5, out)
  }
}

export class TokenInstanceHandler extends PlaceableInstanceHandler {
  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static docUpdateKeys = new Set([
    "x",
    "y",
    "elevation",
    "width",
    "height",
  ]);

  /**
   * Flags in refreshObject hook that indicate a relevant change to the placeable.
   */
  static refreshFlags = new Set([
    "refreshPosition",
    "refreshSize",
  ]);

  /**
   * Get edges in the scene.
   */
  getPlaceables() {
    return canvas.tokens.placeables.filter(token => this.includePlaceable(token));
  }

  /**
   * Should this token be included in the scene render?
   * Constrained tokens included here; handled later in prerender.
   */
  // includePlaceable(_token) { return true; }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(placeableId, idx, placeable) {
    idx ??= this.instanceIndexFromId.get(placeableId);
    const token = placeable ??= this.placeableFromInstanceIndex.get(idx);
    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;

    const ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
    const { width, height, zHeight } = this.constructor.tokenDimensions(token);

    // Move from center of token.
    MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, translationM);

    // Scale based on width, height, zHeight of token.
    MatrixFloat32.scale(width, height, zHeight, scaleM);

    super.updateInstanceBuffer(placeableId, idx, placeable,
      { translation: translationM, scale: scaleM });
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
    return {
      width: token.document.width * canvas.dimensions.size,
      height: token.document.height * canvas.dimensions.size,
      zHeight: token.topZ - token.bottomZ,
    };
  }
}