/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../../geometry/const.js";
import { DrawableObjectsNonInstancingWebGL2, DrawableObjectsInstancingWebGL2 } from "./DrawableObjects.js";
import {
  RegionRectangleInstancedVertices,
  RegionCircleInstancedVertices,
  RegionEllipseInstancedVertices,
  RegionPolygonModelVertices,
} from "../../geometry/placeable_vertices/RegionVertices.js";

import {
  RegionGeometry,
  RegionPolygonShapeGeometry,
  RegionRectangleShapeGeometry,
  RegionEllipseShapeGeometry,
  RegionCircleShapeGeometry,
} from "../../geometry/placeable_geometry/RegionGeometry.js";
import { log } from "../util.js";
import { mix } from "../../geometry/mixwith.js";

/**
 * Common methods for region shapes.
 */
const RegionShapeMixin = superclass => class extends superclass {

  get placeables() { return canvas.regions.placeables;}

  static regionType(region) {
    const geom = region[GEOMETRY_LIB_ID][GEOMETRY_ID];
    return geom.type;
  }

  filterObjects(regions) {
    const regionType = this.constructor.regionType;
    const TYPE = this.constructor.TYPE;
    regions = super.filterObjects(regions)
    return regions.filter(region => regionType(region) === TYPE);
  }

  static TYPE = RegionGeometry.SHAPE_TYPES.POLYGON;
}

export class DrawableRegionRectangleShapeWebGL2 extends mix(DrawableObjectsInstancingWebGL2).with(RegionShapeMixin) {
  /** @type {class<RegionVertices>} */
  static vertexClass = RegionRectangleInstancedVertices;

  /** @type {class<PlaceableGeometry>} */
  static geomClass = RegionRectangleShapeGeometry;

  static TYPE = RegionGeometry.SHAPE_TYPES.RECTANGLE;
}

export class DrawableRegionCircleShapeWebGL2 extends mix(DrawableObjectsInstancingWebGL2).with(RegionShapeMixin)  {
  /** @type {class<RegionVertices>} */
  static vertexClass = RegionCircleInstancedVertices;

  /** @type {class<PlaceableGeometry>} */
  static geomClass = RegionCircleShapeGeometry;

  static TYPE = RegionGeometry.SHAPE_TYPES.CIRCLE;
}

export class DrawableRegionEllipseShapeWebGL2 extends mix(DrawableObjectsInstancingWebGL2).with(RegionShapeMixin)  {
  /** @type {class<RegionVertices>} */
  static vertexClass = RegionEllipseInstancedVertices;

  /** @type {class<PlaceableGeometry>} */
  static geomClass = RegionEllipseShapeGeometry;

  static TYPE = RegionGeometry.SHAPE_TYPES.ELLIPSE;
}

export class DrawableRegionPolygonShapeWebGL2 extends mix(DrawableObjectsNonInstancingWebGL2).with(RegionShapeMixin)  {
  /** @type {class<RegionVertices>} */
  static vertexClass = RegionPolygonModelVertices;

  static TYPE = RegionGeometry.SHAPE_TYPES.POLYGON;
}
