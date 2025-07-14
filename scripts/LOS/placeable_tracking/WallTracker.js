/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableModelMatrixTracker } from "./PlaceableTracker.js";
import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";

// Base folder


// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const rotationM = MatrixFloat32.identity(4, 4);


export class WallTracker extends PlaceableModelMatrixTracker {
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

  static layer = "walls";


  translationMatrixForPlaceable(wall) {
    const edge = wall.edge;
    const pos = this.constructor.edgeCenter(edge);
    const { top, bottom } = this.constructor.edgeElevation(edge);
    const zHeight = top - bottom;
    const z = top - (zHeight * 0.5);
    CONFIG.GeometryLib.MatrixFloat32.translation(pos.x, pos.y, z, translationM);
    return translationM;
  }

  rotationMatrixForPlaceable(wall) {
    const rot = this.constructor.edgeAngle(wall.edge);
    CONFIG.GeometryLib.MatrixFloat32.rotationZ(rot, true, rotationM);
    return rotationM;
  }

  scaleMatrixForPlaceable(wall) {
    const edge = wall.edge;
    const ln = this.constructor.edgeLength(edge);
    const { top, bottom } = this.constructor.edgeElevation(edge);
    const scaleZ = top - bottom;
    CONFIG.GeometryLib.MatrixFloat32.scale(ln, 1.0, scaleZ, scaleM);
    return scaleM;
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



