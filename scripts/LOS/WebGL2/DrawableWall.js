/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { GeometryWall } from "../geometry/GeometryWall.js";
import {
  NonDirectionalWallInstanceHandler,
  DirectionalWallInstanceHandler,
  NonDirectionalTerrainWallInstanceHandler,
  DirectionalTerrainWallInstanceHandler,
} from "../placeable_handler/PlaceableWallInstanceHandler.js";


export class DrawableWallWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandler;

  /** @type {class} */
  static geomClass = GeometryWall;

  /** @type {boolean} */
  static directional = false;

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  get senseType() { return this.renderer.senseType; }

  _initializeGeoms() {
    const type = this.constructor.directional ? "directional" : "double";
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
    const edges = AbstractViewpoint.filterEdgesByVisionTriangle(visionTriangle, { senseType: this.senseType });
    for ( const [idx, wall] of this.placeableHandler.placeableFromInstanceIndex.entries() ) {
      if ( edges.has(wall.edge) ) instanceSet.add(idx);
    }
  }
}

export class DrawableNonDirectionalWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandler;

  /** @type {boolean} */
  static directional = false;
}

export class DrawableDirectionalWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = DirectionalWallInstanceHandler;

  /** @type {boolean} */
  static directional = true;
}

export class DrawableNonDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = NonDirectionalTerrainWallInstanceHandler;

  /** @type {boolean} */
  static directional = false;

  static obstacleColor = [0, 0.5, 0.0, 0.5];
}

export class DrawableDirectionalTerrainWallWebGL2 extends DrawableWallWebGL2 {
  /** @type {class} */
  static handlerClass = DirectionalTerrainWallInstanceHandler;

  /** @type {boolean} */
  static directional = true;

  static obstacleColor = [0, 0.5, 0.0, 0.5];
}