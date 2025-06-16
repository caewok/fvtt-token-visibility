/* globals
canvas,
CONFIG,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableInstanceHandler } from "./PlaceableInstanceHandler.js";
import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";
import { MODULE_ID, MODULES_ACTIVE } from "../../const.js";
import { GeometryRegion } from "../geometry/GeometryRegion.js";




/** Tracking buffer

Helper class that creates a buffer of a given size * number of objects.
Access each object in the buffer.
Delete object and shrink the buffer.
Add objects and increase the buffer.




*/



// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const rotationM = MatrixFloat32.identity(4, 4);

/**
Region splits into distinct groups:
Instances:
- Rectangle
- Circle
- Ellipse
Non-instances: Polygon

Tracks all regions in the scene, and all shapes within each region.
Shapes that must be combined are handled by Polygon.

Each of the shape types have their own mini-handler, and track instance information therein.
The main RegionInstanceHandler keeps track of the mini-handlers.

*/

export class RegionInstanceHandler extends PlaceableInstanceHandler {
  static HOOKS = [
    { createRegion: "_onPlaceableCreation" },
    { updateRegion: "_onPlaceableUpdate" },
    { removeRegion: "_onPlaceableDeletion" },
  ];

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
    "flags.terrainmapper.elevationAlgorithm",
    "flags.terrainmapper.plateauElevation",
    "flags.terrainmapper.rampFloor",
    "flags.terrainmapper.rampDirection",
    "flags.terrainmapper.rampStepSize",
    "flags.terrainmapper.splitPolygons",

    "elevation.bottom",
    "elevation.top",

    "shapes",
  ]);

  /**
   * Get relevant regions in the scene.
   */
  getPlaceables() {
    return canvas.regions.placeables.filter(region => this.includePlaceable(region));
  }

  /**
   * Should this region be included in the scene render?
   */
  includePlaceable(region) {
    if ( region.shapes.length === 0 ) return false;

    // TODO: Change this to a setting in the region config, and specifies sense type(s) that block.
    if ( !CONFIG[MODULE_ID].regionsBlock ) return false;

    // TODO: Allow None to block using the elevation range. Use the sense type choice to filter.
    // const algo = region.document.getFlag("terrainmapper", "elevationAlgorithm");
    // return algo && (algo === "ramp" || algo === "plateau");

    return true;
  }

  _addPlaceableUsingIndex() { return false; }

  regionGeoms = new WeakMap();

  rectangles = new Set();

  circles = new Set();

  ellipses = new Set();

  polygons = new Map();

  rectangleArrayBuffer;

  circleArrayBuffer;

  ellipseArrayBuffer;

  polygonVerticesArrayBuffer;

  polygonIndicesArrayBuffer;

  rectangleMatrices;

  circleMatrices;

  ellipseMatrices;

  polygonVertices;

  polygonIndices;

  /**
   * Initialize all placeables.
   */
  initializePlaceables() {
    this.instanceIndexFromId.clear();
    this.placeableFromInstanceIndex.clear();
    const placeables = this.getPlaceables();

    // mat4x4 for each placeable; 4 bytes per entry.
    placeables.forEach((placeable, idx) => this._initializePlaceable(placeable, idx));
    this._createInstanceBuffer();
  }

  _initializePlaceable(region, _idx) {
    this.instanceIndexFromId.set(placeable.id, idx);
    this.placeableFromInstanceIndex.set(idx, placeable);
    const geom = new GeometryRegion(region);
    this.regionGeoms.add(region, geom);
    geom.updateShapes();
    const { instanceGeoms, polyShape } = geom.calculateInstancedGeometry();
    if ( polyShape ) this.polygons.set(region, polyShape);

    // TODO: Better to have a bunch of polygons instead of combining all into 1 polyShape?
    // TODO: Should this be a map for each region instead of sets?
    instanceGeoms.forEach(geom => {
      switch ( geom.shape.data.type ) {
        case "rectangle": this.rectangles.add(geom); break;
        case "circle": this.circles.add(geom); break;
        case "ellipse": this.ellipses.add(geom); break;
        default: console.error(`_initializePlaceable|geom ${geom.shape.data.type} not recognized.`);
      }
    });
  }

  _createInstanceBuffer() {
    // Create a matrix buffer for each instance geometry type.
    this.rectangleBuffer = new ArrayBuffer(this.rectangles.size * this.constructor.INSTANCE_ELEMENT_SIZE);
    this.circleBuffer = new ArrayBuffer(this.circles.size * this.constructor.INSTANCE_ELEMENT_SIZE);
    this.ellipseBuffer = new ArrayBuffer(this.ellipses.size * this.constructor.INSTANCE_ELEMENT_SIZE);

    let i = 0;
    for ( const geom of this.rectangles ) {

    }


    // Create a combined vertex buffer for the polygons

    // Create a combined index buffer for the polygons
  }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   */
  updateInstanceBuffer(idx) {
    const region = this.placeableFromInstanceIndex.get(idx);
    if ( !region ) return;
//     const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;
//
//     const ctr = this.constructor.tileCenter(tile);
//     const { width, height } = this.constructor.tileDimensions(tile);
//
//     // Move from center of tile.
//     MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, translationM);
//
//     // Scale based on width, height of tile.
//     MatrixFloat32.scale(width, height, 1.0, scaleM);
//
//     // Rotate based on tile rotation.
//     MatrixFloat32.rotationZ(this.constructor.tileRotation(tile), true, rotationM);
//
//     return super.updateInstanceBuffer(idx,
//       { rotation: rotationM, translation: translationM, scale: scaleM });
  }

}

export class RegionShapeHandler extends PlaceableInstanceHandler {
  includePlaceable(region) {
    return
  }
}

export class RegionRectangleHandler extends RegionShapeHandler {
  includePlaceable(region) {
    // TODO:
    return region.shapes.some(shape => shape.data.type === "rectangle")
  }

}

export class RegionCircleHandler extends RegionShapeHandler {

}

export class RegionEllipseHandler extends RegionShapeHandler {

}

