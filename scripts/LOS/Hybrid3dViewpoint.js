/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder

// LOS folder
import { GeometricViewpoint } from "./GeometricViewpoint.js";
import { PIXIViewpoint } from "./PIXIViewpoint.js";

// Geometry folder
import { addClassGetter } from "../geometry/util.js";


// Debug
export class Area3dHybridViewpoint extends GeometricViewpoint {
  calc = CONFIG[MODULE_ID].sightCalculators.hybrid;
}

export class PercentVisibleCalculatorHybrid extends PercentVisibleCalculatorGeometric {

  /** @type {PercentVisibleCalculatorAbstract} */
  tileCalc = CONFIG[MODULE_ID].sightCalculators.webGL2;

  #blockingTiles = new Set();

  blockingTiles(viewerLocation, target) {
    const visionTri = AbstractViewpoint.visionTriangle.rebuild(viewerLocation, target);
    return AbstractViewpoint.filterTilesByVisionTriangle(visionTri, { this.senseType });
  }


  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    const this.#blockingTiles = this.blockingTiles(viewerLocation, target);

    if ( this.#blockingTiles.size ) {
      return this.tileCalc._calculatePercentVisible(viewer, target, viewerLocation, targetLocation);
    } else {
      return super._calculatePercentVisible(viewer, target, viewerLocation, targetLocation);
    }
  }

  _percentRedPixels() {
    if ( this.#blockingTiles.size ) {
      return this.tileCalc._percentRedPixels(viewer, target, viewerLocation, targetLocation);
    } else {
      return super._percentRedPixels(viewer, target, viewerLocation, targetLocation);
    }

  }
}

export class DebugVisibilityViewerHybrid extends DebugVisibilityViewerArea3dPIXI {
  algorithm = Settings.KEYS.LOS.TARGET.TYPES.AREA3D_HYBRID;

  /**
   * TODO: Fix. This is not a parent method.
   * For debugging
   * Switch drawing depending on the algorithm used.
   */
  _draw3dDebug(drawTool, renderer) {
    if ( this.blockingObjects.tiles.size ) this.#webGL2Class._draw3dDebug(drawTool, renderer);
    else super._draw3dDebug(drawTool, renderer);
  }

}