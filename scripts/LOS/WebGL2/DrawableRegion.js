/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsWebGL2Abstract, DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import {
  GeometryRegion,
  GeometryPolygonRegionShape,
  GeometryCircleRegionShape,
  GeometryEllipseRegionShape,
  GeometryRectangleRegionShape } from "../geometry/GeometryRegion.js";
import { RegionTracker } from "../placeable_tracking/RegionTracker.js";
import { log, isString } from "../util.js";


const RegionShapeMixin = function(Base) {
  class DrawableRegionShape extends Base {
    static trackerClass = RegionTracker;

    constructor(renderer, regionDrawableObject) {
      super(renderer);
      this.regionDrawableObject = regionDrawableObject;
      delete this.placeableTracker; // So the getter works. See https://stackoverflow.com/questions/77092766/override-getter-with-field-works-but-not-vice-versa/77093264.
    }

    get placeableTracker() { return this.regionDrawableObject.placeableTracker; }

    set placeableTracker(_value) { return; } // Ignore any attempts to set it but do not throw error.

    get numInstances() { return this.placeableTracker.trackers[this.constructor.TYPE].numFacets; }

    _initializePlaceableHandler() { return; } // Can skip b/c the region drawable controls the handler.

  }
  return DrawableRegionShape;
}

export class DrawableRegionInstanceShapeWebGL2 extends RegionShapeMixin(DrawableObjectsInstancingWebGL2Abstract) {
  _initializeOffsetTrackers() {
    // Don't need indices or vertices trackers.
    // Model matrices stored in placeableTracker.
    this.trackers.model = this.placeableTracker.trackers[this.constructor.TYPE];
  }

  _updateModelBufferForInstance(region) {
    if ( this.trackers.model.arraySize > this.bufferSizes.model ) {
      this.rebuildNeeded = true;
      return;
    }

    // Update each shape of this type in the region.
    log(`${this.constructor.name}|_updateModelBufferForInstance ${region.id}`);
    const currIds = this.trackers.model.facetIdMap.keys().filter(key => key.startsWith(region.id));
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

  _filterShapesForRegion(visionTriangle, region, _opts) {
    // Assume the region has already been filtered by AbstractViewpoint.filterRegionsByVisionTriangle.
    // And this.placeableTracker.placeables has the region.
    const regionShapeGroups = this.placeableTracker.shapeGroups.get(region);
    const shapeGroupArr = regionShapeGroups[this.constructor.TYPE];
    for ( const shapeGroup of shapeGroupArr ) {
      const id = `${region.id}_${shapeGroup.type}_${shapeGroup.idx}`;
      for ( const shape of shapeGroup.shapes ) {
        if ( shape.data.hole ) continue; // Ignore holes.
        if ( visionTriangle.containsRegionShape(shape) ) {
          const idx = this.trackers.model.facetIdMap.get(id);
          this.instanceSet.add(idx);
          break;
        }
      }
    }
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

  get geoms() { return this.placeableTracker.polygons; }

  _initializeGeoms(_opts) { return; }

  _filterShapesForRegion(visionTriangle, region, _opts) {
    // Assume the region has already been filtered by AbstractViewpoint.filterRegionsByVisionTriangle.
    // And this.placeableTracker.placeables has the region.
    const regionShapeGroups = this.placeableTracker.shapeGroups.get(region);
    const shapeGroupArr = regionShapeGroups[this.constructor.TYPE];
    for ( const shapeGroup of shapeGroupArr ) {
      const id = `${region.id}_${shapeGroup.type}_${shapeGroup.idx}`;
      for ( const shape of shapeGroup.shapes ) {
        if ( shape.data.hole ) continue; // Ignore holes.
        if ( visionTriangle.containsRegionShape(shape) ) {
          const idx = this.trackers.vi.indices.facetIdMap.get(id);
          this.instanceSet.add(idx);
          break;
        }
      }
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
  static trackerClass = RegionTracker;

  static geomClass = GeometryRegion;

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

  hasPlaceable(placeableOrId) {
    // Check if this is a shape id, which is likely. If so, extract the region id.
    if ( isString(placeableOrId) ) {
      const regex = /^.*?(?=_)/; // Capture everything before the first underscore ("_").
      const res = placeableOrId.match(regex);
      if ( res ) placeableOrId = res[0];
    }
    return super.hasPlaceable(placeableOrId);
  }

  validateInstances() {
    for ( const drawable of Object.values(this.drawables) ) drawable.validateInstances();
  }

  /**
   * Filter the objects to be rendered by those that may be viewable between target and token.
   * Called after prerender, immediately prior to rendering.
   * Camera (viewer/target) are set by the renderer and will not change between now and render.
   * @param {VisionTriangle} visionTriangle     Triangle shape used to represent the viewable area
   * @param {object} [opts]
   * @param {Token} [opts.viewer]
   * @param {Token} [opts.target]
   * @param {BlockingConfig} [opts.blocking]    Whether different objects block LOS
   */
  filterObjects(visionTriangle, opts) {
    this.instanceSet.clear();
    for ( const drawable of Object.values(this.drawables) ) drawable.instanceSet.clear();

    const regions = AbstractViewpoint.filterRegionsByVisionTriangle(visionTriangle);

    // For each region, determine which shapes are within the vision triangle.
    // Add the id of each shape group to its respective drawable.
    for ( const region of regions ) {
      if ( !this.placeableTracker.placeables.has(region) ) continue;
      for ( const drawable of Object.values(this.drawables) ) drawable._filterShapesForRegion(visionTriangle, region, opts);
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