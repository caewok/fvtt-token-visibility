/* globals
canvas,
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

Each of the shape types have their own mini-handler, and track instance information therein.
The main RegionInstanceHandler keeps track of the mini-handlers.

*/

export class RegionInstanceHandler extends PlaceableTracker {
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

  polygons = new WeakMap();

  trackers = {
    circle: null,
    ellipse: null,
    rectangle: null,
    polygon: {
      vertices: null,
      indices: null,
    },
  }

  static MODEL_SHAPES = new Set(["circle", "ellipse", "rectangle"]);

  static MODEL_ELEMENT_LENGTH = 16; // Single mat4x4.

  _initializePlaceables(regions) {
    this.regionGeoms = new WeakMap(); // No clear in WeakMap.
    this.polygons = new WeakMap();

    // Get the maximum number of shapes
    const MODEL_SHAPES = this.constructor.MODEL_SHAPES;
    const count = {};
    for ( const type of MODEL_SHAPES ) count[type] = 0;
    for ( const region of regions ) {
      for ( const shape of region.shapes ) count[shape.data.type] += 1;
    }

    // Track the matrices for circles, rectangles, and ellipses.
    for ( const type of MODEL_SHAPES ) {
      const maxByteLength = this.constructor.MODEL_ELEMENT_LENGTH * Float32Array.BYTES_PER_ELEMENT * count[type];
      this.trackers[type] = new FixedLengthTrackingBuffer(0, { maxByteLength });
    }
    this.trackers.polygon.vertices = new VariableLengthTrackingBuffer();
    this.trackers.polygon.indices = new VariableLengthTrackingBuffer(0, { type: Uint16Array });
  }

  _initializePlaceable(region, idx) {
    super._initializePlaceable(region, idx);
    const geom = new GeometryRegion(region);
    this.regionGeoms.set(region, geom);
    geom.updateShapes();
    const { instanceGeoms, polyShape } = geom.calculateInstancedGeometry();
    if ( polyShape ) {
      this.polygons.set(region, polyShape);
      this.trackers.polygon.vertices.addFacet({ id: region.id, newValues: polyShape.vertices });
      this.trackers.polygon.indices.addFacet({ id: region.id, newValues: polyShape.indices });
    }

    for ( const geom of instanceGeoms ) {
      const type = geom.shape.data.type;
      const tracker = this.trackers[type];
      tracker.addFacet({ id: geom.id });
      geom.linkTransformMatrix(tracker.viewFacetById(geom.id));
      geom.calculateModel(); // Will not stay linked once the tracker increases buffer size.
    }
  }

  _addPlaceable(region) {
    // TODO: Remove this dependency on idx
    const idx = this.instanceIndexFromId.nextIndex();
    this._initializePlaceable(region, idx);
  }

  _updatePlaceable(region) {
    const geom = new GeometryRegion(region);
    this.regionGeoms.set(region, geom);
    geom.updateShapes();
    const { instanceGeoms, polyShape } = geom.calculateInstancedGeometry();
    if ( polyShape ) {
      this.polygons.set(region, polyShape);
      this.trackers.polygon.vertices.updateFacetAtId(region.id, { newValues: polyShape.vertices });
      this.trackers.polygon.indices.updateFacetAtId(region.id, { newValues: polyShape.indices });

    } else this.polygons.delete(region);

    // Need to remove all shapes that were in the tracker but are no longer required.
    const MODEL_SHAPES = this.constructor.MODEL_SHAPES;
    const idsInTracker = {};
    for ( const type of MODEL_SHAPES ) idsInTracker[type] = new Set();
    for ( const type of MODEL_SHAPES ) {
      const tracker = this.trackers[type];
      for ( const id of tracker.values() ) {
        if ( id.startsWith(region.id) ) idsInTracker[type].add(id);
      }
    }

    // Update the model trackers.
    for ( const geom of instanceGeoms ) {
      const type = geom.shape.data.type;
      const tracker = this.trackers[type];
      if ( !tracker.facetIdMap.has(geom.id) ) tracker.addFacet({ id: geom.id });
      geom.linkTransformMatrix(tracker.viewFacetById(geom.id));
      geom.calculateModel(); // Will not stay linked once the tracker increases buffer size.
      idsInTracker[type].delete(geom.id);
    }

    // Remove the unneeded geoms.
    for ( const type of MODEL_SHAPES ) {
      const tracker = this.trackers[type];
      for ( const id of idsInTracker[type] ) tracker.deleteFacetById(id);
    }
  }

  _removePlaceable(region) {
    this.polygons.delete(region);
    this.regionGeoms.delete(region);

    // Remove all ids associated with this region in the model trackers.
    for ( const type of this.constructor.MODEL_SHAPES ) {
      const tracker = this.trackers[type];
      for ( const id of tracker.values() ) {
        if ( id.startsWith(region.id) ) tracker.deleteFacetById(id);
      }
    }
  }
}
