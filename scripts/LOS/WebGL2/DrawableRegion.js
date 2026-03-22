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
  RegionVertices,
} from "../../geometry/placeable_vertices/RegionVertices.js";

import {
  RegionGeometry,
  RegionRectangleShapeGeometry,
  RegionEllipseShapeGeometry,
  RegionCircleShapeGeometry,
} from "../../geometry/placeable_geometry/RegionGeometry.js";
import { log } from "../util.js";

const RegionShapeMixin = function(Base) {
  class DrawableRegionShape extends Base {
    constructor(renderer, regionDrawableObject) {
      super(renderer);
      this.regionDrawableObject = regionDrawableObject;
    }

    get placeables() { return canvas.regions.placeables;}

    get numInstances() { return this.trackers.model.numFacets; }

    _initializePlaceableHandler() { return; } // Can skip b/c the region drawable controls the handler.

  }
  return DrawableRegionShape;
}

export class DrawableRegionInstanceShapeWebGL2 extends RegionShapeMixin(DrawableObjectsInstancingWebGL2Abstract) {

  _updateModelBufferForInstance(region) {
    if ( this.trackers.model.arraySize > this.bufferSizes.model ) {
      this.rebuildNeeded = true;
      return;
    }

    // Update each shape of this type in the region.
    log(`${this.constructor.name}|_updateModelBufferForInstance ${region.sourceId}`);
    const currIds = this.trackers.model.facetIdMap.keys().filter(key => key.startsWith(region.sourceId));
    for ( const id of currIds ) this._updateModelBufferForShapeId(id);
  }

  _updateModelBufferForShapeId(id) {
    const gl = this.gl;
    const mBuffer = this.attributeBufferInfo.attribs.aModel.buffer;

    // See twgl.setAttribInfoBufferFromArray.
    const tracker = this.trackers.model;
    const mOffset = tracker.facetOffsetAtId(id) * tracker.type.BYTES_PER_ELEMENT; // 4 * 16 * idx
    log(`${this.constructor.name}|_updateModelBufferForInstance ${id} with offset ${mOffset}`, { model: tracker.viewFacetById(id) });
    gl.bindBuffer(gl.ARRAY_BUFFER, mBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, mOffset, tracker.viewFacetById(id));
  }

  addPlaceableToInstanceSet(region) {
    const geom = region[GEOMETRY_LIB_ID][GEOMETRY_ID].placeableId;
    if ( !geom ) return;

    const idx = this.trackers.model.facetIdMap.get(geom.placeableId);
    if ( typeof idx === "undefined" ) return;
    this.instanceSet.add(idx);
  }
}

export class DrawableRegionEllipseShapeWebGL2 extends DrawableRegionInstanceShapeWebGL2 {
  static vertexClass = RegionEllipseInstancedVertices;

  /** @type {class<GeometryInstanced>} */
  static geomClass = RegionEllipseShapeGeometry;

  _initializeGeoms(opts = {}) {
    opts.density ??= RegionGeometry.CIRCLE_DENSITY;
    super._initializeGeoms(opts);
  }
}

export class DrawableRegionCircleShapeWebGL2 extends DrawableRegionEllipseShapeWebGL2 {
  static vertexClass = RegionCircleInstancedVertices;

  /** @type {class<GeometryInstanced>} */
  static geomClass = RegionCircleShapeGeometry;
}

export class DrawableRegionRectangleShapeWebGL2 extends DrawableRegionInstanceShapeWebGL2 {
  static vertexClass = RegionRectangleInstancedVertices;

  /** @type {class<GeometryInstanced>} */
  static geomClass = RegionRectangleShapeGeometry;
}


export class DrawableRegionPolygonShapeWebGL2 extends RegionShapeMixin(DrawableObjectsWebGL2Abstract) {
  static vertexClass = RegionVertices;

  constructor(renderer, regionDrawableObject) {
    super(renderer, regionDrawableObject);
    delete this.geoms; // So the getter works. See https://stackoverflow.com/questions/77092766/override-getter-with-field-works-but-not-vice-versa/77093264.
  }

  get geoms() { return []; } // return this.placeableTracker.polygons; }

  _initializeGeoms(_opts) { return; }

  /**
   * Update the vertex data for an instance.
   * @param {number} id      The id of the placeable update
   * @returns {boolean} True if successfully updated; false if array length is off (requiring full rebuild).
   */
  _updateInstanceVertex(region) {
    const id = `Region.${region.id}`;
    for ( const geom of this.geoms.values() ) {
      if ( !geom.id.startsWith(id) ) continue;
      geom.addNormals = this.debugViewNormals;
      geom.dirtyModel = true;
      geom.calculateModel();

      const vi = this.trackers.vi;
      const expanded = vi.updateFacet(region.sourceId, { newVertices: geom.modelVertices, newIndices: geom.modelIndices });
      if ( expanded ) return false;
    }
    return true;
  }

  updatePlaceableBuffer(region) {
    const regionId = `Region.${region.id}`;
    for ( const id of this.geoms.keys() ) {
      if ( id.startsWith(regionId) ) this._updateAttributeBuffersForId(id);
    }
  }
}

/**
 * Draw 4 types of region objects:
 * - circle (instance)
 * - ellipse (instance)
 * - rectangle (instance)
 * - polygon (non-instanced)
 * The class treats each region as a single polygon, skipping when no polygon need be drawn.
 * (Similar to constrained or lit token.)
 * Class also prepares instance drawable objects for circles, ellipses, and rectangles for all regions.
 */
export class DrawableRegionWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static geomClass = RegionGeometry;

  get placeables() { return canvas.regions.placeables; }

  get numPolygons() { return this.placeableTracker.trackers.polygon.numFacets; }

  get numObjectsToDraw() {
    let n = 0;
    for ( const drawable of Object.values(this.drawables) ) n += drawable.numObjectsToDraw;
    return n;
  }

  // Drawables for the different instanced shapes.
  // In addition, this class represents the non-instanced polygon shapes.
  drawables = {
    circle: null,
    ellipse: null,
    rectangle: null,
    polygon: null,
  };

  constructor(renderer) {
    super(renderer);
    this.drawables.polygon = new DrawableRegionPolygonShapeWebGL2(renderer, this);
    this.drawables.circle = new DrawableRegionCircleShapeWebGL2(renderer, this);
    this.drawables.ellipse = new DrawableRegionEllipseShapeWebGL2(renderer, this);
    this.drawables.rectangle = new DrawableRegionRectangleShapeWebGL2(renderer, this);
  }

  async initialize() {
    await super.initialize();
    for ( const drawable of Object.values(this.drawables) ) await drawable.initialize();
  }

  async _initializeProgram() { return; }

  // _initializePlaceableHandler() { return; }

  _initializeGeoms(_opts) { return; }

  _initializeOffsetTrackers() { return; }

  _initializeAttributes() { return; }

  _initializeUniforms() { return; }

  validateInstances() {
    for ( const drawable of Object.values(this.drawables) ) drawable.validateInstances();
  }

  /**
   * Clear previous instances to be drawn.
   */
  clearInstances() {
    this.instanceSet.clear();
    for ( const drawable of Object.values(this.drawables) ) drawable.instanceSet.clear();
  }

  /**
   * Add the region to either the polygon set or one of the instance shape sets.
   */
  addPlaceableToInstanceSet(region) {
    const geomRegion = region[GEOMETRY_LIB_ID][GEOMETRY_ID];
    const ST = geomRegion.constructor.SHAPE_TYPES;
    let type;
    switch ( geomRegion.type ) {
      case ST.EMPTY: return;
      case ST.HOLE: return;
      case ST.RECTANGLE: type = "rectangle"; break;
      case ST.ELLIPSE: type = "ellipse"; break;
      case ST.CIRCLE: type = "circle"; break;
      default: type = "polygon";
    }
    this.drawables[type].addPlaceableToInstanceSet(region)
  }

  render() {
    for ( const drawable of Object.values(this.drawables) ) drawable.render();
  }
}

/* Testing

MODULE_ID = "tokenvisibility"
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32
let {
  GeometryEllipseRegionShape,
  GeometryPolygonRegionShape,
  GeometryRectangleRegionShape,
  GeometryCircleRegionShape,
  GeometryRegion,
} = api.geometry

opts = {}
opts.addNormals = false
opts.addUVs = false
opts.density = GeometryRegion.CIRCLE_DENSITY;


*/