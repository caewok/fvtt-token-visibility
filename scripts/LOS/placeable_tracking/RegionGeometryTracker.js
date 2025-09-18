/* globals
CONFIG,
foundry,
Region,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, OTHER_MODULES } from "../../const.js";
import { GeometryRegion, GeometryCircleRegionShape, GeometryEllipseRegionShape, GeometryRectangleRegionShape, GeometryPolygonRegionShape } from "../geometry/GeometryRegion.js";
import { AbstractPlaceableGeometryTracker, allGeometryMixin } from "./PlaceableGeometryTracker.js";
import { regionElevation, convertRegionShapeToPIXI } from "../util.js";
import { Circle3d, Ellipse3d, Quad3d, Polygon3d } from "../../geometry/3d/Polygon3d.js";
import { AABB3d } from "../../geometry/AABB.js";
import { FixedLengthTrackingBuffer } from "./TrackingBuffer.js";

/* RegionGeometry
Placeable geometry stored in wall placeables.
- AABB
- rotation, scaling, and translation matrices from an ideal shape.
- Polygon3ds for faces
- Triangle3ds for faces
- Update key

Faces and triangles oriented based on wall direction.


*/

export class RegionGeometryTracker extends allGeometryMixin(AbstractPlaceableGeometryTracker) {
  static HOOKS = {
    createRegion: "_onPlaceableDocumentCreation",
    updateRegion: "_onPlaceableDocumentUpdate",
    removeRegion: "_onPlaceableDocumentDeletion",
  };

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

  /** @type {GeometryDesc} */
  static geomClass = GeometryRegion;

  /** @type {number[]} */
  static _hooks = [];

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  get region() { return this.placeable; }

  get modelMatrix() { return undefined; }

  get hasMultiPlaneRamp() {
    const TM = OTHER_MODULES.TERRAIN_MAPPER;
    if ( !TM.ACTIVE ) return false;
    const tmHandler = this.region[TM.KEY];
    return tmHandler.isRamp && tmHandler.splitPolygons;
  }

  /** @type {Polygons3d} */
  top = new CONFIG.GeometryLib.threeD.Polygons3d();

  bottom = new CONFIG.GeometryLib.threeD.Polygons3d();

  /** @{Polygon3d[]} */ // Could use Polygons3d except if ramps used with ramp per shape.
  tops = [];

  /** @type {Polygon3d[]} */
  bottoms = [];

  /** @type {Polygon3d[]} */
  sides = [];

  *iterateFaces() {
    if ( this.hasMultiPlaneRamp ) {
      for ( const top of this.tops ) yield top;
      for ( const bottom of this.bottoms ) yield bottom;
      for ( const side of this.sides ) yield side;
    } else return super.iterateFaces();
  }

  initialize() {
    this.region.shapes.forEach(shape => {
      shape[MODULE_ID] ??= {};
      shape[MODULE_ID][this.constructor.AbstractPolygonTrianglesID] ??= AbstractRegionShapeGeometryTracker.fromShape(shape, this.region);
      shape[MODULE_ID][this.constructor.AbstractPolygonTrianglesID].initialize();
    });
    super.initialize();
  }

  update() {
    this.region.shapes.forEach(shape => {
      shape[MODULE_ID] ??= {};
      shape[MODULE_ID][this.constructor.AbstractPolygonTrianglesID] ??= AbstractRegionShapeGeometryTracker.fromShape(shape, this.region);
      shape[MODULE_ID][this.constructor.AbstractPolygonTrianglesID].update();
    });
    super.update();
  }

  _updateAABB() {
    const newAABB = CONFIG.GeometryLib.threeD.AABB3d.union(this.region.shapes.map(shape =>
      shape[MODULE_ID][this.constructor.AbstractPolygonTrianglesID].aabb));
    newAABB.clone(this.aabb);
  }

  _updateFaces() {
    this.buildRegionPolygons3d();
  }

  _updateMatrices() {}

  _updateTrackingBuffer() {}

  buildRegionPolygons3d() {
    const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;
    const region = this.placeable;

    // Clear prior data.
    this.top.polygons.length = 0;
    this.bottom.polygons.length = 0;
    this.tops.length = 0;
    this.bottoms.length = 0;
    this.sides.length = 0;
    if ( !region.shapes.length ) return;

    const topArr = this.hasMultiPlaneRamp ? this.tops : this.top.polygons;
    const bottomArr = this.hasMultiPlaneRamp ? this.bottoms : this.bottom.polygons;

    const { topZ, bottomZ } = regionElevation(region);
    const uniqueShapes = this.combineRegionShapes();
    const nUnique = uniqueShapes.length;
    this.tops.length = this.bottoms.length = this.sides.length = nUnique;
    for ( const shapeGroup of uniqueShapes ) {
      if ( shapeGroup.length === 1 ) {
        const geometry = shapeGroup[0][MODULE_ID][this.constructor.AbstractPolygonTrianglesID];
        if ( geometry.isHole ) continue;
        topArr.push(geometry.top)
        bottomArr.push(geometry.bottom);
        this.sides.push(...geometry.sides);

      } else {
        // Combine and convert to Polygon3d.
        const paths = shapeGroup.map(shape => shape[MODULE_ID][this.constructor.AbstractPolygonTrianglesID].toClipperPaths());
        const combinedPaths = paths.length === 1 ? paths[0] : ClipperPaths.joinPaths(paths);

        const path = combinedPaths.combine();
        const polys = CONFIG.GeometryLib.threeD.Polygons3d.fromClipperPaths(path, topZ);
        const t = polys;
        const b = polys.clone();
        b.setZ(bottomZ); // topZ already set above.
        b.reverseOrientation();

        // Build all the side polys.
        this.sides.push(...t.buildTopSides(bottomZ))
      }
    }

  }

  combineRegionShapes() {
    const region = this.placeable;
    const nShapes = region.shapes.length;
    if ( !nShapes ) return [];

    // Form groups of shapes. If any shape overlaps another, they share a group.
    // So if A overlaps B and B overlaps C, [A,B,C] form a group regardless of whether A overlaps C.
    const usedShapes = new Set();
    const uniqueShapes = [];
    for ( let i = 0; i < nShapes; i += 1 ) {
      if ( usedShapes.has(i) ) continue; // Don't need to add to usedShapes b/c not returning to this i.
      const shape = region.shapes[i];
      const shapeGroup = [shape];
      uniqueShapes.push(shapeGroup);
      for ( let j = i + 1; j < nShapes; j += 1 ) {
        if ( usedShapes.has(j) ) continue;
        const other = region.shapes[j];
        const otherGeometry = other[MODULE_ID][this.constructor.AbstractPolygonTrianglesID];
        const otherPIXI = otherGeometry.shapePIXI;

        // Any overlap counts.
        for ( const shape of shapeGroup ) {
          const shapeGeometry = shape[MODULE_ID][this.constructor.AbstractPolygonTrianglesID];
          const shapePIXI = shapeGeometry.shapePIXI;
          if ( shapePIXI.overlaps(otherPIXI) ) {
            shapeGroup.push(other);
            usedShapes.add(j);
            break;
          }
        }
      }
    }
    return uniqueShapes;
  }


  /**
   * Determine where a ray hits this object's triangles.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {number} [cutoff=1]   Ignore hits further along the ray from this (treat ray as segment)
   * @returns {number|null} The distance along the ray
   */
  rayIntersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    for ( const shape of this.region.shapes ) {
      const t = shape[MODULE_ID][this.constructor.AbstractPolygonTrianglesID].rayIntersection(rayOrigin, rayDirection, minT, maxT);
      if ( t !== null && CONFIG.GeometryLib.utils.almostBetween(t, minT, maxT) ) return t;
    }
    return null;
  }

}

class AbstractRegionShapeGeometryTracker extends allGeometryMixin(AbstractPlaceableGeometryTracker) {


  // TODO: Remove once done testing.
  static registerPlaceableHooks() { console.error("No hooks for RegionShape"); return; }

  static registerExistingPlaceables() { console.error("No hooks for RegionShape"); return; }

  static deregisterPlaceableHooks() { console.error("No hooks for RegionShape"); return; }

  static _onPlaceableDocumentCreation() { console.error("No hooks for RegionShape"); return; }

  static _onPlaceableDocumentUpdate() { console.error("No hooks for RegionShape"); return; }

  static _onPlaceableDocumentDeletion() { console.error("No hooks for RegionShape"); return; }

  static _onPlaceableDraw() { console.error("No hooks for RegionShape"); return; }

  static _onPlaceableRefresh() { console.error("No hooks for RegionShape"); return; }

  static _onPlaceableDestroy() { console.error("No hooks for RegionShape"); return; }

  get shape() { return this.placeable; }

  get isHole() { return this.shape.data.hole; }

  static polygonClass = Polygon3d;

  static fromShape(shape, region) {
    let cl;
    switch ( shape.data.type ) {
      case "circle": cl = CircleRegionShapeGeometryTracker; break;
      case "ellipse": cl = EllipseRegionShapeGeometryTracker; break;
      case "rectangle": cl = RectangleRegionShapeGeometryTracker; break;
      case "polygon": cl = PolygonRegionShapeGeometryTracker; break;
    }
    return new cl(shape, region);
  }

  #shapeID = foundry.utils.randomID();

  get shapeID() { return this.#shapeID; }

  get placeableId() {
    const shape = this.shape;
    const region = this.shape.data.parent.object;
    return `${region.sourceId}_${shape.data.type}_${this.shapeID}`;
  }

  /** @type {Region} */
  region;

  constructor(placeable, region) {
    super(placeable);
    this.region = region;
  }

  // Shape type should not change.
  initialize() {
    this.shapePIXI = convertRegionShapeToPIXI(this.shape).clone();
    this.top = new this.constructor.polygonClass();
    this.bottom = new this.constructor.polygonClass();
    super.initialize();
  }

  calculateTranslationMatrix() {
    const { topZ, bottomZ } = this.constructor.regionElevationZ(this.region);
    const zHeight = topZ - bottomZ;
    const z = topZ - (zHeight * 0.5);
    const { x, y } = this.shape.data;
    CONFIG.GeometryLib.MatrixFloat32.translation(x, y, z, this.matrices.translation);
    return this.matrices.translation;
  }

  // Currently, no rotation allowed for shapes.
  // calculateRotationMatrix() {}

  calculateScaleMatrix() {
    const { topZ, bottomZ } = this.constructor.regionElevationZ(this.region);
    const zHeight = topZ - bottomZ;
    const z = topZ - (zHeight * 0.5);
    const { x, y } = this._xyScale();
    CONFIG.GeometryLib.MatrixFloat32.scale(x, y, z, this.matrices.scale);
    return this.matrices.scale;
  }

  _xyScale() {
    const { min, max } = this.aabb;
    return {
      x: (max.x - min.x) * 0.5,
      y: (max.y - min.y) * 0.5,
    };
  }

  _updateAABB() {
    const { topZ, bottomZ } = this.constructor.regionElevationZ(this.region);
    this.constructor.fnAABB(this.shapePIXI, this.aabb, { maxZ: topZ, minZ: bottomZ });
  }

  shapePIXI;

  // TODO: Handle ramps.
  _updateFaces() {
    const { topZ, bottomZ } = this.constructor.regionElevationZ(this.region);
    this.constructor.faceFn(this.shapePIXI, topZ, this.top);
    if ( this.isHole ^ this.top.isClockwise ) this.top.reverseOrientation();
    this.top.clone(this.bottom);
    this.bottom.setZ(bottomZ);
    this.bottom.reverseOrientation();

    // Build sides from the edges.
    this.sides = this.top.buildTopSides(bottomZ);
  }

  static regionElevationZ(region) {
    const { topZ, bottomZ } = region;
    return {
      topZ: Number.isFinite(topZ) ? topZ : 1e06,
      bottomZ: Number.isFinite(bottomZ) ? bottomZ : -1e06,
    }
  }

  toClipperPaths() {
    const clipperPoints = this.shape.clipperPaths;
    const scalingFactor = Region.CLIPPER_SCALING_FACTOR;
    const ClipperPaths = CONFIG.tokenvisibility.ClipperPaths;
    switch ( CONFIG[MODULE_ID].clipperVersion ) {
      // For both, the points are already scaled, so just pass through the scaling factor to the constructor.
      case 1: return new ClipperPaths(clipperPoints, { scalingFactor });
      case 2: return new ClipperPaths(ClipperPaths.pathFromClipper1Points(clipperPoints), { scalingFactor });
    }
  }

  /* ----- NOTE: Intersection ----- */

  /**
   * Determine where a ray hits this object's faces.
   * Stops at the first hit.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {number} [cutoff=1]   Ignore hits further along the ray from this (treat ray as segment)
   * @returns {number|null} The distance along the ray
   */
  rayIntersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    if ( !this.isHole ) {
      const t = this.top.intersectionT(rayOrigin, rayDirection);
      if ( t !== null && CONFIG.GeometryLib.utils.almostBetween(t, minT, maxT) ) return t;
    }
    for ( const side of this.sides() ) {
      const t = side.intersectionT(rayOrigin, rayDirection);
      if ( t !== null && CONFIG.GeometryLib.utils.almostBetween(t, minT, maxT) ) return t;
    }
    return null;
  }
}

class CircleRegionShapeGeometryTracker extends AbstractRegionShapeGeometryTracker {
  static geomClass = GeometryCircleRegionShape;

  static polygonClass = Circle3d;

  static fnAABB = AABB3d.fromCircle.bind(AABB3d);

  static faceFn = Circle3d.fromCircle.bind(Circle3d);

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  _xyScale() {
    const radius = this.shape.data.radius;
    return { x: radius, y: radius };
  }
}

class EllipseRegionShapeGeometryTracker extends AbstractRegionShapeGeometryTracker {
  static geomClass = GeometryEllipseRegionShape;

  static polygonClass = Ellipse3d;

  static fnAABB = AABB3d.fromEllipse.bind(AABB3d);

  static faceFn = Ellipse3d.fromEllipse.bind(Ellipse3d);

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  _xyScale() {
    const { radiusX, radiusY } = this.shape.data;
    return { x: radiusX, y: radiusY };
  }
}

class RectangleRegionShapeGeometryTracker extends AbstractRegionShapeGeometryTracker {
  static geomClass = GeometryRectangleRegionShape;

  static polygonClass = Quad3d;

  static fnAABB = AABB3d.fromRectangle.bind(AABB3d);

  static faceFn = Quad3d.fromRectangle.bind(Quad3d);

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  _xyScale() {
    const { width, height } = this.shape.data;
    return { x: width * 0.5, y: height * 0.5 };
  }

}

class PolygonRegionShapeGeometryTracker extends AbstractRegionShapeGeometryTracker {
  static geomClass = GeometryPolygonRegionShape;

  static polygonClass = Polygon3d;

  static fnAABB = AABB3d.fromPolygon.bind(AABB3d);

  static faceFn = Polygon3d.fromPolygon.bind(Polygon3d);

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });
}
