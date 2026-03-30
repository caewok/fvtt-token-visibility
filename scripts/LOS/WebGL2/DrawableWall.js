/* globals
canvas,
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import { WallInstancedVertices } from "../../geometry/placeable_vertices/WallVertices.js";
import { WallGeometry } from "../../geometry/placeable_geometry/WallGeometry.js";

export class DrawableWallWebGL2Abstract extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static vertexClass = WallInstancedVertices;

  /** @type {class} */
  static geomClass = WallGeometry;

  get placeables() { return canvas.walls.placeables; }

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  get senseType() { return this.renderer.senseType; }

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

  _initializeGeoms() {
    super._initializeGeoms({ type: "double"});
  }

  filterObjects(walls, opts = {}) {
    opts.senseType ??= "sight";
    return super.filterObjects(walls)
      .filter(wall => !(this.constructor.isTerrain(wall, opts) || this.constructor.isDirectional(wall)));
  }
}

export class DrawableTerrainWallWebGL2 extends DrawableWallWebGL2Abstract {
  /** @type {boolean} */
  static terrain = true;

  /** @type {boolean} */
  static directional = false;

  _initializeGeoms() {
    super._initializeGeoms({ type: "double"});
  }

  filterObjects(walls, opts = {}) {
    opts.senseType ??= "sight";
    return super.filterObjects(walls)
      .filter(wall => this.constructor.isTerrain(wall, opts) && !this.constructor.isDirectional(wall));
  }
}

export class DrawableDirectionalWallWebGL2 extends DrawableWallWebGL2Abstract {
  /** @type {boolean} */
  static terrain = false;

  /** @type {boolean} */
  static directional = true;


  _initializeGeoms() {
    super._initializeGeoms({ type: "directional"});
  }

  filterObjects(walls, opts = {}) {
    opts.senseType ??= "sight";
    return super.filterObjects(walls)
      .filter(wall => !this.constructor.isTerrain(wall, opts) && this.constructor.isDirectional(wall));
  }
}

export class DrawableDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2Abstract {
  /** @type {boolean} */
  static terrain = true;

  /** @type {boolean} */
  static directional = true;

  _initializeGeoms() {
    super._initializeGeoms({ type: "directional"});
  }

  filterObjects(walls, opts = {}) {
    opts.senseType ??= "sight";
    return super.filterObjects(walls)
      .filter(wall => this.constructor.isTerrain(wall, opts) && this.constructor.isDirectional(wall));
  }
}
