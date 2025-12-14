/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { TRACKER_IDS, MODULE_ID } from "../../const.js";
import { DrawableObjectsWebGL2Abstract, DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import { ObstacleOcclusionTest } from "../ObstacleOcclusionTest.js";
import {
  GeometryRegion,
  GeometryPolygonRegionShape,
  GeometryCircleRegionShape,
  GeometryEllipseRegionShape,
  GeometryRectangleRegionShape } from "../geometry/GeometryRegion.js";
import {
  RegionGeometryTracker,
  CircleRegionShapeGeometryTracker,
  EllipseRegionShapeGeometryTracker,
  RectangleRegionShapeGeometryTracker,
  PolygonRegionShapeGeometryTracker,
} from "../placeable_tracking/RegionGeometryTracker.js";
import { log, isString } from "../util.js";
const TERRAIN_MAPPER = "terrainmapper";

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

const TRACKER_TYPES = {
  ellipse: EllipseRegionShapeGeometryTracker,
  circle: CircleRegionShapeGeometryTracker,
  rectangle: RectangleRegionShapeGeometryTracker,
  polygon: PolygonRegionShapeGeometryTracker,
};

export class DrawableRegionInstanceShapeWebGL2 extends RegionShapeMixin(DrawableObjectsInstancingWebGL2Abstract) {
  /** @type {class} */
  static trackerClass = RegionGeometryTracker;

  _initializeOffsetTrackers() {
    // Don't need indices or vertices trackers.
    // Model matrices stored in placeableTracker.
    this.trackers.model = TRACKER_TYPES[this.constructor.TYPE].modelMatrixTracker;
  }

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

  _filterShape(frustum, shape, _opts) {
    if ( shape.data.hole || !frustum.containsRegionShape(shape) ) return;

    const id = shape[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].placeableId;
    const idx = this.trackers.model.facetIdMap.get(id);
    if ( typeof idx === "undefined" ) return;
    this.instanceSet.add(idx);
  }
}

export class DrawableRegionEllipseShapeWebGL2 extends DrawableRegionInstanceShapeWebGL2 {
  /** @type {class<GeometryInstanced>} */
  static geomClass = GeometryEllipseRegionShape;

  /** @type {foundry.data.BaseShapeData.TYPES} */
  static TYPE = "ellipse";

  _initializeGeoms(opts = {}) {
    opts.density ??= GeometryRegion.CIRCLE_DENSITY;
    super._initializeGeoms(opts);
  }
}

export class DrawableRegionCircleShapeWebGL2 extends DrawableRegionEllipseShapeWebGL2 {
  /** @type {class<GeometryInstanced>} */
  static geomClass = GeometryCircleRegionShape;

  /** @type {foundry.data.BaseShapeData.TYPES} */
  static TYPE = "circle";
}

export class DrawableRegionRectangleShapeWebGL2 extends DrawableRegionInstanceShapeWebGL2 {
  /** @type {class<GeometryInstanced>} */
  static geomClass = GeometryRectangleRegionShape;

  /** @type {foundry.data.BaseShapeData.TYPES} */
  static TYPE = "rectangle";
}


export class DrawableRegionPolygonShapeWebGL2 extends RegionShapeMixin(DrawableObjectsWebGL2Abstract) {
  /** @type {class<GeometryInstanced>} */
  static geomClass = GeometryPolygonRegionShape;

  /** @type {foundry.data.BaseShapeData.TYPES} */
  static TYPE = "polygon";

  constructor(renderer, regionDrawableObject) {
    super(renderer, regionDrawableObject);
    delete this.geoms; // So the getter works. See https://stackoverflow.com/questions/77092766/override-getter-with-field-works-but-not-vice-versa/77093264.
  }

  get geoms() { return []; } // return this.placeableTracker.polygons; }

  _initializeGeoms(_opts) { return; }

  _filterShape(frustum, shape, _opts) {
    if ( shape.data.hole || !frustum.containsRegionShape(shape) ) return;

    const id = shape[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].placeableId;
    const idx = this.trackers.model.facetIdMap.get(id); // TODO: This is probably wrong.
    if ( typeof idx === "undefined" ) return;
    this.instanceSet.add(idx);
  }

  _filterShapeGroup(frustum, region, shapeGroup, _opts) {
    // TODO: Fix.

  }

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
  static geomClass = GeometryRegion;

  get placeables() { return canvas.regions.placeables; }

  get numPolygons() { return this.placeableTracker.trackers.polygon.numFacets; }

  get numObjectsToDraw() {
    let n = 0;
    for ( const drawable of Object.values(this.drawables) ) n += drawable.instanceSet.size;
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


  getPlaceableFromId(id) {
    const regex = /^.*?(?=_)/; // Capture everything before the first underscore ("_").
    const res = id.match(regex);
    if ( res ) id = res[0];
    return super.getPlaceableFromId(id);
  }

  validateInstances() {
    for ( const drawable of Object.values(this.drawables) ) drawable.validateInstances();
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * Camera (viewer/target) are set by the renderer and will not change between now and render.
   * @param {Frustum} frustum     Triangle shape used to represent the viewable area
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(frustum, opts) {
    this.instanceSet.clear();
    for ( const drawable of Object.values(this.drawables) ) drawable.instanceSet.clear();

    const regions = ObstacleOcclusionTest.filterRegionsByFrustum(frustum);

    // For each region, determine which shapes are within the vision triangle.
    // Add the id of each shape group to its respective drawable.
    for ( const region of regions ) {
      if ( !this.hasPlaceable(region) ) continue;

      // Group region shapes by whether they overlap.
      const geomRegion = region[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE];
      const regionShapeGroups = geomRegion.combineRegionShapes();
      const regionId = region.id;

      for ( const shapeGroup of regionShapeGroups ) {
        // If any holes in the shape group, pass the group to the polygon handler.
        if ( shapeGroup.some(shape => shape.isHole) ) this.drawables.polygon._filterShapeGroup(frustum, region, shapeGroup, opts);

        // Otherwise, add the region shape to its corresponding drawable.

        for ( const shape of shapeGroup ) {
          switch ( shape.data.type ) {
            case "rectangle": this.drawables.rectangle._filterShape(frustum, shape, opts); break;
            case "ellipse": this.drawables.ellipse._filterShape(frustum, shape, opts); break;
            case "circle": this.drawables.circle._filterShape(frustum, shape, opts); break;
            case "polygon": this.drawables.polygon._filterShape(frustum, shape, opts); break;
            default: this.drawables.polygon._filterShape(frustum, shape, opts);
          }
        }
      }
    }
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