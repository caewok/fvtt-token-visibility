/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { DrawableObjectsWebGL2Abstract, DrawableObjectsInstancingWebGL2Abstract } from "./DrawableObjects.js";
import {
  GeometryRegion,
  GeometryCircleRegionShape,
  GeometryEllipseRegionShape,
  GeometryRectangleRegionShape } from "../geometry/GeometryRegion.js";
import { RegionTracker } from "../placeable_tracking/RegionTracker.js";
import { FixedLengthTrackingBuffer } from "../placeable_tracking/TrackingBuffer.js";

export class DrawableRegionCircleShapeWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static geomClass = GeometryCircleRegionShape;

  constructor(renderer, regionDrawableObject) {
    super(renderer);
    this.regionDrawableObject = regionDrawableObject;
  }

  get placeableTracker() { return this.regionDrawableObject.placeableTracker; }

  _initializeGeoms(_opts) {
    this.#numInstances = 0;
    this.regionDrawableObject.geoms.forEach(geom => this.#numInstances += geom.instanceGeoms.circle.length);
    this._trackAllGeomModels();
  }

  _trackAllGeomModels() {
    const facetLength = this.constructor.MODEL_MATRIX_LENGTH;
    this.tracker = new FixedLengthTrackingBuffer({ numFacets: this.numInstances, facetLength });
    for ( const regionGeom of this.regionDrawableObject.geoms ) {
      for ( const geom of regionGeom.instanceGeoms[this.constructor.TYPE] ) {
        this.tracker.addFacet({ id: geom.id });
        geom.linkTransformMatrix(this.tracker.viewFacetById(geom.id));
      }
    }
  }

  tracker;

  static TYPE = "circle";

  #numInstances = 0;

  get numInstances() { return this.#numInstances; }

  // TODO: Cache the region shape calculations, which are shared among the three instance shapes + polygons.
  _defineAttributeProperties() {
    const vertexProps = super._defineAttributeProperties();

    // Need to track the region shape across several regions.
    // const facetLength = this.constructor.MODEL_MATRIX_LENGTH;

    // Substitute in the tracker specific to circles instead of the regionDrawableObject's tracker.
    vertexProps.aModel.data = this.tracker.buffer;
    return vertexProps;
  }

  _updateAllInstances() {
    this._trackAllGeomModels();
    super._updateAllInstances();
  }

  _updateInstance(region) {
    const type = this.type;

    // Remove all the region's geoms' data from the tracker.
    for ( const id of this.tracker.facetIdMap.values() ) {
      if ( !id.startsWith(region.id) ) continue;
      this.#numInstances -= 1;
      this.deleteFacetById(id);
    }

    // Add back in the region's geoms data.
    for ( const regionGeom of this.regionDrawableObject.geoms ) {
      if ( regionGeom.region !== region ) continue;
      for ( const geom of regionGeom.instanceGeoms[type] ) {
        this.#numInstances += 1;
        this.tracker.addFacet({ id: geom.id });
        geom.linkTransformMatrix(this.tracker.viewFacetById(geom.id));
      }
    }
    super._updateInstance(region);
  }
}

export class DrawableRegionEllipseShapeWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static geomClass = GeometryEllipseRegionShape;

  constructor(renderer, regionDrawableObject) {
    super(renderer);
    this.regionDrawableObject = regionDrawableObject;
  }

  _initializeGeoms(opts = {}) {
    opts.density ??= GeometryRegion.CIRCLE_DENSITY;
    super._initializeGeoms(opts);
  }
}

export class DrawableRegionRectangleShapeWebGL2 extends DrawableObjectsInstancingWebGL2Abstract {
  /** @type {class} */
  static geomClass = GeometryRectangleRegionShape;

  regionDrawableObject;

  constructor(renderer, regionDrawableObject) {
    super(renderer);
    this.regionDrawableObject = regionDrawableObject;
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
  static handlerClass = RegionTracker;

  static geomClass = GeometryRegion;

  drawables = {
    circle: null,
    ellipse: null,
    rectangle: null,
  };

  constructor(renderer) {
    super(renderer);
    this.drawables.circle = new DrawableRegionCircleShapeWebGL2(renderer, this);
    this.drawables.ellipse = new DrawableRegionEllipseShapeWebGL2(renderer, this);
    this.drawables.rectangle = new DrawableRegionRectangleShapeWebGL2(renderer, this);
  }

  async initialize() {
    await super.initialize();
    for ( const drawable of this.drawables ) await drawable.initialize();
  }

  _initializeGeoms(opts = {}) {
    opts.addNormals ??= this.addNormals;
    opts.addUVs ??= this.addUVs;
    opts.placeable = null;
    const geomClass = this.constructor.geomClass;
    const geoms = this.geoms;
    let geomIndex = 0;
    geoms.length = 0;
    for ( const region of this.placeableTracker.placeables ) {
      if ( !this.constructor.includeRegion(region) ) continue;
      geomIndex += 1;
      opts.placeable = region;
      const geom = new geomClass(opts);
      geom.updateGeometry();
      geoms.set(region.id, geom);
    }
  }

  static includeRegion(region) {
    // TODO: Fix
    return Boolean(region.polygonGeom);
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