/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../../geometry/const.js";
import { DrawableObjectsWebGL2Abstract, DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
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

const RegionShapeMixin = function(Base) {
  class DrawableRegionShape extends Base {

    get placeables() { return canvas.regions.placeables;}

    get numInstances() { return this.trackers.model.numFacets; }

    static regionType(region) {
      const geom = region[GEOMETRY_LIB_ID][GEOMETRY_ID];
      return geom.type;
    }

    filterObjects(regions) {
      const regionType = this.constructor.regionType;
      const TYPE = this.constructor.TYPE;
      regions = regions.filter(region => regionType(region) === TYPE);
      return super.filterObjects(regions)
    }

    static TYPE = RegionGeometry.SHAPE_TYPES.POLYGON;
  }
  return DrawableRegionShape;
}

export class DrawableRegionRectangleShapeWebGL2 extends RegionShapeMixin(DrawableObjectsInstancingWebGL2Abstract) {
  /** @type {class<RegionVertices>} */
  static vertexClass = RegionRectangleInstancedVertices;

  /** @type {class<PlaceableGeometry>} */
  static geomClass = RegionRectangleShapeGeometry;

  static TYPE = RegionGeometry.SHAPE_TYPES.RECTANGLE;
}

export class DrawableRegionCircleShapeWebGL2 extends RegionShapeMixin(DrawableObjectsInstancingWebGL2Abstract) {
  /** @type {class<RegionVertices>} */
  static vertexClass = RegionCircleInstancedVertices;

  /** @type {class<PlaceableGeometry>} */
  static geomClass = RegionCircleShapeGeometry;

  static TYPE = RegionGeometry.SHAPE_TYPES.CIRCLE;
}

export class DrawableRegionEllipseShapeWebGL2 extends RegionShapeMixin(DrawableObjectsInstancingWebGL2Abstract) {
  /** @type {class<RegionVertices>} */
  static vertexClass = RegionEllipseInstancedVertices;

  /** @type {class<PlaceableGeometry>} */
  static geomClass = RegionEllipseShapeGeometry;

  static TYPE = RegionGeometry.SHAPE_TYPES.ELLIPSE;
}

export class DrawableRegionPolygonShapeWebGL2 extends RegionShapeMixin(DrawableObjectsWebGL2Abstract) {
  /** @type {class<RegionVertices>} */
  static vertexClass = RegionPolygonModelVertices;

  /** @type {class<PlaceableGeometry>} */
  static geomClass = RegionPolygonShapeGeometry;

  static TYPE = RegionGeometry.SHAPE_TYPES.POLYGON;
}
