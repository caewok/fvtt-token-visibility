/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { GeometryWall } from "../geometry/GeometryWall.js";
import { WallInstanceHandler } from "../placeable_tracking/PlaceableWallInstanceHandler.js";


export class DrawableWallWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static handlerClass = WallInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryWall;

  /** @type {boolean} */
  #directional = false;

  get directional() { return this.#directional; }

  set directional(value) {
    if ( this.initialized ) console.error("Cannot set directional value after initialization.");
    else this.#directional = value;
  }

  senseType = "sight";

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
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]                     Options from BlockingConfig (see AbstractViewerLOS)
   */
  filterObjects(visionTriangle, { blocking = {} } = {}) {
    const instanceSet = this.instanceSet;
    instanceSet.clear();
    blocking.walls ??= true;
    if ( !blocking.walls ) return;

    // Limit to walls within the vision triangle
    // Drop open doors.
    const opts = { senseType: this.senseType };
    const edges = AbstractViewpoint.filterEdgesByVisionTriangle(visionTriangle, opts);
    const ph = this.placeableHandler;
    for ( const [idx, wall] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( WallInstanceHandler.isTerrain(wall.edge, opts) ^ this.limitedWall ) continue;
      if ( WallInstanceHandler.isDirectional(wall.edge) ^ this.directional ) continue;
      if ( edges.has(wall.edge) ) instanceSet.add(idx);
    }
  }
}
