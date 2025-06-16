/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableInstanceHandler } from "./PlaceableInstanceHandler.js";
import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";

// Base folder


// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const rotationM = MatrixFloat32.identity(4, 4);


export class WallInstanceHandler extends PlaceableInstanceHandler {
  static HOOKS = [
    { createWall: "_onPlaceableCreation" },
    { updateWall: "_onPlaceableUpdate" },
    { removeWall: "_onPlaceableDeletion" },
  ];

  /**
   * Change keys in updateWall hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
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
   * Get walls in the scene.
   */
  getPlaceables() {
    return canvas.walls.placeables.filter(wall => this.includePlaceable(wall));
  }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(idx) {
    const edge = this.placeableFromInstanceIndex.get(idx)?.edge;
    if ( !edge ) return;

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

    return super.updateInstanceBuffer(idx,
      { rotation: rotationM, translation: translationM, scale: scaleM });
  }

  rotationMatrixForInstance(idx) {
    const edge = this.placeableFromInstanceIndex.get(idx)?.edge;
    if ( !edge ) return super.rotationMatrixForInstance(idx);
    const rot = this.constructor.edgeAngle(edge);
    MatrixFloat32.rotationZ(rot, true, rotationM);
    return rotationM;
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

  /**
   * Is this a terrain (limited) edge?
   * @param {Edge} edge
   * @returns {boolean}
   */
  static isTerrain(edge, { senseType = "sight" } = {}) {
    return edge[senseType] === CONST.WALL_SENSE_TYPES.LIMITED;
  }

  /**
   * Is this a directional edge?
   * @param {Edge} edge
   * @returns {boolean}
   */
  static isDirectional(edge) { return Boolean(edge.direction); }
}

export class NonTerrainWallInstanceHandler extends WallInstanceHandler {
  constructor({ senseType = "sight" } = {}) {
    super();
    this._senseType = senseType;
  }

  _senseType = "sight";

  get senseType() { return this._senseType; }

  set senseType(value) {
    this._senseType = value;
    this.initializePlaceables();
  }

  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return !this.constructor.isTerrain(wall.edge, { senseType: this.senseType });
  }
}

export class TerrainWallInstanceHandler extends WallInstanceHandler {
  constructor({ senseType = "sight" } = {}) {
    super();
    this._senseType = senseType;
  }

  _senseType = "sight"; // Avoid # b/c TypeError: Cannot initialize #senseType twice on the same object

  get senseType() { return this._senseType; }

  set senseType(value) {
    this._senseType = value;
    this.initializePlaceables();
  }

  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return this.constructor.isTerrain(wall.edge, { senseType: this.senseType });
  }
}

export class NonDirectionalWallInstanceHandler extends NonTerrainWallInstanceHandler {
  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return !this.constructor.isDirectional(wall.edge);
  }
}

export class DirectionalWallInstanceHandler extends NonTerrainWallInstanceHandler {
  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return this.constructor.isDirectional(wall.edge);
  }
}

export class NonDirectionalTerrainWallInstanceHandler extends TerrainWallInstanceHandler {
  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return !this.constructor.isDirectional(wall.edge);
  }
}

export class DirectionalTerrainWallInstanceHandler extends TerrainWallInstanceHandler {
  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return this.constructor.isDirectional(wall.edge);
  }
}