/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import { ObstacleOcclusionTest } from "../ObstacleOcclusionTest.js";
import { GeometryWall } from "../geometry/GeometryWall.js";
import { WallTracker } from "../placeable_tracking/WallTracker.js";


export class DrawableWallWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static trackerClass = WallTracker;

  /** @type {class} */
  static geomClass = GeometryWall;

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

  _initializeGeoms() {
    const type = this.directional ? "directional" : "double";
    super._initializeGeoms({ type });
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * @param {Frustum} frustum     Triangle shape used to represent the viewable area
   * @param {object} [opts]                     Options from BlockingConfig (see AbstractViewerLOS)
   */
  filterObjects(frustum, { blocking = {} } = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    blocking.walls ??= true;
    if ( !blocking.walls ) return;

    // Limit to walls within the vision triangle
    // Drop open doors.
    const opts = { senseType: this.senseType };
    const walls = ObstacleOcclusionTest.filterWallsByFrustum(frustum, opts);
    for ( const wall of walls ) {
      if ( !this.placeableTracker.hasPlaceable(wall) ) continue;
      if ( WallTracker.isTerrain(wall, opts) ^ this.limitedWall ) continue;
      if ( WallTracker.isDirectional(wall) ^ this.directional ) continue;
      const idx = this._indexForPlaceable(wall);
      this.instanceSet.add(idx);
    }
  }
}
