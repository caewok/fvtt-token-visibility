/* globals
canvas,
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import { GeometryWall } from "../geometry/GeometryWall.js";
import { WallGeometryTracker } from "../placeable_tracking/WallGeometryTracker.js";


export class DrawableWallWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static trackerClass = WallGeometryTracker;

  /** @type {class} */
  static geomClass = GeometryWall;

  get placeables() { return canvas.walls.placeables; }

  /** @type {boolean} */
  #directional = false;

  get directional() { return this.#directional; }

  set directional(value) {
    if ( this.initialized ) console.error("Cannot set directional value after initialization.");
    else this.#directional = value;
  }

  limitedWall = false;

  get terrain() { return this.limitedWall; }

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

  _initializeGeoms() {
    const type = this.directional ? "directional" : "double";
    super._initializeGeoms({ type });
  }

  /**
   * Filter the objects to be rendered.
   * Called after prerender, immediately prior to rendering.
   * @param {PlaceableObject[]} placeables      Placeable objects to be drawn
   * @returns {PlaceableObject[]} Objects that can be rendered by this drawable.
   */
  filterObjects(walls, { senseType = "sight" } = {}) {
    return super.filterObjects(walls)
      .filter(wall => !(
        (this.constructor.isTerrain(wall, { senseType }) ^ this.limitedWall)
          || (this.constructor.isDirectional(wall) ^ this.directional)));
  }
}
