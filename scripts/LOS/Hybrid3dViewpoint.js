/* globals
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// LOS folder
import { GeometricViewpoint, PercentVisibleCalculatorGeometric } from "./GeometricViewpoint.js";
import { DebugVisibilityViewerArea3dPIXI } from "./DebugVisibilityViewer.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";

// Debug
export class Hybrid3dViewpoint extends GeometricViewpoint {
  static get calcClass() { return PercentVisibleCalculatorHybrid; }
}

export class PercentVisibleCalculatorHybrid extends PercentVisibleCalculatorGeometric {
  static get viewpointClass() { return Hybrid3dViewpoint; }

  /** @type {PercentVisibleCalculatorAbstract} */
  tileCalc = CONFIG[MODULE_ID].sightCalculators.webGL2;

  #blockingTiles = new Set();

  blockingTiles(viewpoint, target) {
    const visionTri = ObstacleOcclusionTest.visionTriangle.rebuild(viewpoint, target);
    return ObstacleOcclusionTest.filterTilesByVisionTriangle(visionTri, { senseType: this.config.senseType });
  }

  _calculatePercentVisible(viewer, target, viewpoint, targetLocation) {
    this.#blockingTiles = this.blockingTiles(viewpoint, target);
    if ( this.#blockingTiles.size ) {
      return this.tileCalc._calculatePercentVisible(viewer, target, viewpoint, targetLocation);
    } else {
      return super._calculatePercentVisible(viewer, target, viewpoint, targetLocation);
    }
  }

  _percentUnobscured() {
    if ( this.#blockingTiles.size ) return this.tileCalc._percentUnobscured();
    else return super._percentUnobscured();
  }
}

export class DebugVisibilityViewerHybrid extends DebugVisibilityViewerArea3dPIXI {
  static viewpointClass = Hybrid3dViewpoint;

  algorithm = Settings.KEYS.LOS.TARGET.TYPES.HYBRID;

  /**
   * TODO: Fix. This is not a parent method.
   * For debugging
   * Switch drawing depending on the algorithm used.
   */
//   _draw3dDebug(drawTool, renderer) {
//     if ( this.blockingObjects.tiles.size ) this.._draw3dDebug(drawTool, renderer);
//     else super._draw3dDebug(drawTool, renderer);
//   }

}