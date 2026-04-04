/* globals
canvas,
CONFIG,
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2 } from "./DrawableObjects.js";
import { GEOMETRY_LIB_ID } from "../../geometry/const.js";

export class DrawableWallWebGL2Abstract extends DrawableObjectsInstancingWebGL2 {
  /** @type {class} */
  static get vertexClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableVertices.WallInstancedVertices; }

  /** @type {class} */
  static get geomClass() { return CONFIG[GEOMETRY_LIB_ID].lib.placeableGeometry.WallGeometry; }

  get placeables() { return canvas.walls.placeables; }

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  get senseType() { return this.renderer.senseType; }

  filterObjects(walls, opts = {}) {
    opts.senseType ??= "sight";
    walls = super.filterObjects(walls);
    return walls.filter(wall => !(wall.isOpen || wall.document[opts.senseType] === CONST.WALL_SENSE_TYPES.NONE));
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

export class DrawableWallWebGL2 extends DrawableWallWebGL2Abstract {
  /** @type {boolean} */
  static terrain = false;

  /** @type {boolean} */
  static directional = false;

  filterObjects(walls, opts = {}) {
    opts.senseType ??= "sight";
    const { isTerrain, isDirectional } = this.constructor;
    walls = super.filterObjects(walls)
    return walls.filter(wall => !(isTerrain(wall, opts) || isDirectional(wall)));
  }
}

export class DrawableTerrainWallWebGL2 extends DrawableWallWebGL2Abstract {
  /** @type {boolean} */
  static terrain = true;

  /** @type {boolean} */
  static directional = false;

  filterObjects(walls, opts = {}) {
    opts.senseType ??= "sight";
    const { isTerrain, isDirectional } = this.constructor;
    walls = super.filterObjects(walls)
    return walls.filter(wall => isTerrain(wall, opts) && !isDirectional(wall));
  }
}

export class DrawableDirectionalWallWebGL2 extends DrawableWallWebGL2Abstract {
  /** @type {boolean} */
  static terrain = false;

  /** @type {boolean} */
  static directional = true;

  filterObjects(walls, opts = {}) {
    opts.senseType ??= "sight";
    const { isTerrain, isDirectional } = this.constructor;
    walls = super.filterObjects(walls)
    return walls.filter(wall => !isTerrain(wall, opts) && isDirectional(wall));
  }
}

export class DrawableDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2Abstract {
  /** @type {boolean} */
  static terrain = true;

  /** @type {boolean} */
  static directional = true;

  filterObjects(walls, opts = {}) {
    opts.senseType ??= "sight";
    const { isTerrain, isDirectional } = this.constructor;
    walls = super.filterObjects(walls)
    return walls.filter(wall => isTerrain(wall, opts) && isDirectional(wall));
  }
}
