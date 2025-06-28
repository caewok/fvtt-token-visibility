/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableTracker } from "./PlaceableTracker.js";
import { MODULE_ID } from "../../const.js";
import { GeometryRegion } from "../geometry/GeometryRegion.js";
import { VariableLengthTrackingBuffer, FixedLengthTrackingBuffer } from "./TrackingBuffer.js";



/** Tracking buffer

Helper class that creates a buffer of a given size * number of objects.
Access each object in the buffer.
Delete object and shrink the buffer.
Add objects and increase the buffer.




*/


/**
Region splits into distinct groups:
Instances:
- Rectangle
- Circle
- Ellipse
Non-instances: Polygon

Tracks all regions in the scene, and all shapes within each region.
Shapes that must be combined are handled by Polygon.

Single instance shaped have an associated transformation matrix.
Instance shapes that must be combined (e.g., holes or overlapping) do not.
This limits the number of draw calls that skip over instances.
*/

export class RegionTracker extends PlaceableTracker {
  /** @type {number} */
  static MODEL_ELEMENT_LENGTH = 16; // Single mat4x4.

  static MODEL_ELEMENT_SIZE = this.MODEL_ELEMENT_LENGTH * Float32Array.BYTES_PER_ELEMENT;

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

  static layer = "regions";

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

  regionGeoms = new WeakMap();

  polygons = new Map();

  shapeGroups = new foundry.utils.IterableWeakMap();

  trackers = {
    circle: null,
    ellipse: null,
    rectangle: null,
  }

  static MODEL_SHAPES = new Set(["circle", "ellipse", "rectangle"]);

  // TODO: Would it be simpler/better to store the geoms for all the single shapes, tracking the instance geom matrices?
  // As opposed to only tracking single shapes that do not overlap other shapes?
  initializePlaceables() {
    if ( !this.trackers.circle ) {
      const opts = { facetLengths: this.constructor.MODEL_ELEMENT_LENGTH };
      this.trackers.circle = new FixedLengthTrackingBuffer(opts);
      this.trackers.ellipse = new FixedLengthTrackingBuffer(opts);
      this.trackers.rectangle = new FixedLengthTrackingBuffer(opts);
    }
    super.initializePlaceables();
  }

  _addPlaceable(region) {
    const geom = new GeometryRegion(region);
    this.regionGeoms.set(region, geom);
    this._updatePlaceable(region);
  }

  _updatePlaceable(region) {
    const regionGeom = this.regionGeoms.get(region);
    regionGeom.updateShapes();

    // See GeometryRegion#calculateInstancedGeometry
    const uniqueShapes = regionGeom.combineRegionShapes();
    const shapeGroups = regionGeom.groupRegionShapes(uniqueShapes);
    this.shapeGroups.set(region, shapeGroups);
    const groupedGeoms = regionGeom.calculateRegionGeometry(shapeGroups);

    // Record which ids are in the current geometry, to compare later against the previous.
    const currIds = new Set();

    // Update the model matrix tracker for each geom.
    for ( const type of this.constructor.MODEL_SHAPES ) {
      const tracker = this.trackers[type];
      for ( const geom of groupedGeoms[type] ) {
        const id = geom.id;
        currIds.add(id);
        if ( !tracker.facetIdMap.has(id) ) tracker.addFacet({ id });
        geom.linkTransformMatrix(tracker.viewFacetById(id));
        // geom.calculateModel(); // Will not stay linked once the tracker increases buffer size.
      }
    }

    // Update the polygon geom map.
    // Vertices/indices are handled by the DrawableObject b/c it handles normals, uvs.
    for ( const geom of groupedGeoms.polygon ) {
      const id = geom.id;
      this.polygons.set(id, geom);
      currIds.add(id);
    }

    // Remove the unneeded geoms.
    for ( const type of this.constructor.MODEL_SHAPES ) {
      const tracker = this.trackers[type];
      for ( const id of tracker.facetIdMap.keys() ) {
        if ( !id.startsWith(region.sourceId) ) continue; // Only consider geometries for this region.
        if ( !currIds.has(id) ) tracker.deleteFacet(id);
      }
    }
    for ( const id of this.polygons.keys() ) {
      if ( !id.startsWith(region.sourceId) ) continue; // Only consider geometries for this region.
      if ( !currIds.has(id) ) this.polygons.delete(id);
    }
  }

  _removePlaceable(region, regionId) {
    if ( region ) this.regionGeoms.delete(region);

    // Remove all ids associated with this region in the model trackers.
    for ( const type of this.constructor.MODEL_SHAPES ) {
      const tracker = this.trackers[type];
      for ( const id of tracker.facetIdMap.keys() ) {
        if ( id.startsWith(regionId) ) tracker.deleteFacet(id);
      }
    }

    for ( const id of this.polygons.keys() ) {
      if ( id.startsWith(regionId) ) this.polygons.delete(id);
    }
  }
}
