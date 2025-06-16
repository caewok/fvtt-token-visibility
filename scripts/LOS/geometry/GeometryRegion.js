/* globals
ClipperLib,
CONFIG,
PIXI,
Region,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { GeometryNonInstanced, GeometryInstanced } from "./GeometryDesc.js";
import { BasicVertices, Rectangle3dVertices, Circle3dVertices, Ellipse3dVertices, Polygon3dVertices } from "./BasicVertices.js";
import { regionElevation, convertRegionShapeToPIXI, setTypedArray, combineTypedArrays } from "../util.js";

const tmpRect = new PIXI.Rectangle();
const tmpPoly = new PIXI.Polygon();
const tmpCircle = new PIXI.Circle();
const tmpEllipse = new PIXI.Ellipse();

/*
This assumes that combined shapes should not have interior walls. So we have:
1. Instanced single rects, circles, ellipses that could use a model matrix.
2. Single polygons or combined polygons that are one-offs.
3. Polygons with holes that are one-offs.

If we don't care about interior walls, we could drop combined polygons (2).
This would be helpful in increasing the number of instanced geometries.
*/

/**
 * Handles all shapes in a region, comprising multiple geometries.
 * Separates out instanced shapes.
 * Separates out all other single, combined, or holed polygons.
 * Preset to handle interior walls or not.
 */
export class GeometryRegion {
   // TODO: Cache the data params for the shape. Only update when needed.
   // Use a WeakMap to store the shapes?

  /** @type {Region} */
  region;

  allowInteriorWalls = true;

  useFan; // Set to undefined to let the algorithm decide. Setting to true may cause errors.

  #addNormals = false;

  #addUVs = false;

  get addNormals() { return this.#addNormals; }

  get addUVs() { return this.#addUVs; }

  constructor(region, { allowInteriorWalls, addNormals = false, addUVs = false, useFan } = {}) {
    allowInteriorWalls ??= CONFIG[MODULE_ID].allowInteriorWalls; // TODO: Set flag on region.

    this.region = region;
    this.allowInteriorWalls = allowInteriorWalls;
    this.#addNormals = addNormals;
    this.#addUVs = addUVs;
    this.useFan = useFan;
  }

  // Could use IterableWeakMap if we really need to iterate over the map.
  // For now, accessing shapes via region.shapes is working.
  shapeData = new WeakMap();

  updateShapes() {
    this.shapeData = new WeakMap();
    this.region.shapes.forEach(shape => {
      this.shapeData.set(shape, {
        shapePIXI: convertRegionShapeToPIXI(shape).clone(),
        geom: GeometryRectangleRegionShape.fromRegion(this.region, shape),
      });
    });
  }

//   calculateModelMatrices() {
//     return this.region.shapes.map(shape => {
//       this.shapeData.get(shape).geom.calculateTransformMatrix();
//     });
//   }

  /**
   * Combines shapes as necessary and returns data to construct the entire region:
   * 1. For single shapes: the geom
   * 2. For combined polygons or polygons with holes: the untrimmed vertices
   */
  _calculateRegionGeometry() {
    const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;
    const region = this.region;
    const { topZ, bottomZ } = regionElevation(region);
    const uniqueShapes = this.combineRegionShapes();
    const { addNormals, addUVs } = this;
    const opts = { addNormals, addUVs };
    const instanceGeoms = [];
    const polygonVertices = [];
    const useFan = this.useFan;
    for ( const shapeGroup of uniqueShapes ) {
      if ( shapeGroup.shapes.length === 1 ) {
        if ( shapeGroup.hasHole ) continue; // Should not occur.
        const shape = shapeGroup.shapes[0];
        const geom = GeometryRectangleRegionShape.fromRegion(region, shape, opts);
        if ( shape.data.type === "polygon" ) polygonVertices.push(geom.untrimmedVertices);
        else instanceGeoms.push(geom);
      } else {
        // Combine using Clipper.
        const paths = shapeGroup.shapes.map(shape => this.constructor.shapeToClipperPaths(shape));
        const combinedPaths = paths.length === 1 ? paths[0] : ClipperPaths.joinPaths(paths);
        const path = combinedPaths.combine();
        polygonVertices.push(Polygon3dVertices.calculateVertices(path, { topZ, bottomZ, useFan }));
      }
    }
   return { instanceGeoms, polygonVertices };
  }

  /**
   * Calculate the region geometry and combine into a single large vertex and index.
   * No instancing
   */
  calculateNonInstancedGeometry() {
    const { addNormals, addUVs } = this;
    const { instanceGeoms, polygonVertices } = this._calculateRegionGeometry();
    const untrimmedInstanceVs = instanceGeoms.map(geom => geom.untrimmedVertices);
    if ( !(polygonVertices.length || untrimmedInstanceVs.length) ) return {};

    const trimmedData = BasicVertices.trimVertexData(combineTypedArrays(...polygonVertices, ...untrimmedInstanceVs), { addNormals, addUVs });
    const polyShape = new GeometryPolygonRegionShape(this.region, { region: this.region, addNormals, addUVs });
    polyShape._vertices = trimmedData.vertices;
    polyShape._indices = trimmedData.indices;
    return polyShape;
  }

  /**
   * Calculate the region geometry and combine into a single large vertex and index for the polygons.
   * Keep instanced region separate
   */
  calculateInstancedGeometry() {
    const { addNormals, addUVs } = this;
    const { instanceGeoms, polygonVertices } = this._calculateRegionGeometry();
    const trimmedPolys = polygonVertices.length ?
      BasicVertices.trimVertexData(combineTypedArrays(...polygonVertices), { addNormals, addUVs })
      : null;

    // TODO: Circles and ellipses could be an issue as they use multiple instances.
    // For now, just return the instanceGeoms and sort it out later.
    let polyShape = null;
    if ( trimmedPolys ) {
      polyShape = new GeometryPolygonRegionShape(this.region, { region: this.region, addNormals, addUVs });
      polyShape._vertices = trimmedPolys.vertices;
      polyShape._indices = trimmedPolys.indices;
    }
    return { polyShape, instanceGeoms };
  }

  /**
   * TODO: Preset PIXI shapes for each shape? Use in the GeometryShapes below?
   * Combine the region shapes by testing for overlap.
   * See PlaceableTriangles.combine2dShapes
   */
  combineRegionShapes() {
    const region = this.region;
    const nShapes = region.shapes.length;
    if ( !nShapes ) return [];

    // TODO: Should not be needed.
    for ( const shape of region.shapes ) {
      if ( !this.shapeData.has(shape) ) {
        this.updateShapes();
        break;
      }
    }

    // Form groups of shapes. If any shape overlaps another, they share a group.
    // So if A overlaps B and B overlaps C, [A,B,C] form a group regardless of whether A overlaps C.
    const usedShapes = new Set();
    const uniqueShapes = [];
    const omitInteriorWalls = !this.allowInteriorWalls;
    for ( let i = 0; i < nShapes; i += 1 ) {
      const shape = region.shapes[i];
      if ( usedShapes.has(shape) ) continue; // Don't need to add to usedShapes b/c not returning to this shape.
      const shapeGroup = { shapes: [shape], hasHole: shape.data.hole };
      for ( let j = i + 1; j < nShapes; j += 1 ) {
        const other = region.shapes[j];
        if ( usedShapes.has(other) ) continue;
        const otherPIXI = this.shapeData.get(other).shapePIXI;

        // Any overlap counts if a hole or if we want to combine polys to avoid interior walls.
        for ( const shape of shapeGroup.shapes ) {
          if ( (other.data.hole || shapeGroup.hasHole || omitInteriorWalls)
            && this.shapeData.get(shape).shapePIXI.overlaps(otherPIXI) ) {

            shapeGroup.hasHole ||= other.data.hole;
            shapeGroup.shapes.push(other);
            usedShapes.add(other);
            break;
          }
        }
      }
      uniqueShapes.push(shapeGroup);
    }
    return uniqueShapes;
  }

  /**
   * Convert a shape's clipper points to the clipper path class.
   */
  static shapeToClipperPaths(shape) {
    if ( shape.clipperPaths.length !== 1 ) console.error("Shape clipper paths not recognized.");
    let clipperPoints = shape.clipperPaths;
    const scalingFactor = Region.CLIPPER_SCALING_FACTOR;
    const ClipperPaths = CONFIG.tokenvisibility.ClipperPaths;
    if ( shape.data.hole ^ !ClipperLib.Clipper.Orientation(clipperPoints[0]) ) {
      // Don't modify the original array.
      const tmp = [...clipperPoints[0]];
      tmp.reverse();
      clipperPoints = [tmp];
    }
    switch ( CONFIG[MODULE_ID].clipperVersion ) {
      // For both, the points are already scaled, so just pass through the scaling factor to the constructor.
      case 1: return new ClipperPaths(clipperPoints, { scalingFactor });
      case 2: return new ClipperPaths(ClipperPaths.pathFromClipper1Points(clipperPoints), { scalingFactor });
    }
  }

  // ----- NOTE: Debug ----- //

  debugDrawModel(opts = {}) {
    opts.addNormal ??= this.addNormals;
    opts.addUVs ??= this.addUVs;
    const { vertices, indices } = this.calculateNonInstancedGeometry();
    if ( vertices.length ) BasicVertices.debugDraw(vertices, indices, opts);
  }

  debugDrawWithInstancedModels(opts = {}) {
    opts.addNormal ??= this.addNormals;
    opts.addUVs ??= this.addUVs;
    const { polygons, instanceGeoms } = this.calculateInstancedGeometry();
    if ( polygons.vertices ) BasicVertices.debugDraw(polygons.vertices, polygons.indices, opts);
    instanceGeoms.forEach(geom => geom.debugDrawModel(opts));
  }
}


const RegionShapeMixin = function(Base) {
  class GeometryRegionShape extends Base {
    get shape() { return this.placeable; } // Not technically a placeable

    region; // Needed to get elevation and flag data.

    constructor(placeable, { region, ...opts } = {}) {
      super(placeable, opts);
      this.region = region;
    }

    static fromRegion(region, shape = 0, opts = {}) {
      if ( Number.isNumeric(shape) ) shape = region.shapes[shape];
      const cl = REGION_SHAPE_CLASSES[shape.data.type];
      return new cl(shape, { region, ...opts });
    }

    #untrimmedInstanceVertices = new Float32Array();

    #untrimmedVertices = new Float32Array();

    get untrimmedVertices() {
      if ( this.dirtyModel ) {
        this.calculateModel();
        if ( this.instanced ) {
          this.#untrimmedVertices = setTypedArray(this.#untrimmedVertices, this.#untrimmedInstanceVertices);
          BasicVertices.transformVertexPositions(this.#untrimmedVertices, this.transformMatrix); // Must use default stride = 8 here.
        }
      }
      return this._untrimmedVertices;
    }

    _defineInstanceVertices(cl, opts) {
      this.#untrimmedInstanceVertices = cl.calculateVertices(undefined, opts);
      return this.#untrimmedInstanceVertices;
    }
  }
  return GeometryRegionShape;
}

export class GeometryRectangleRegionShape extends RegionShapeMixin(GeometryInstanced) {

  _defineInstanceVertices() {
    const untrimmedV = Rectangle3dVertices.calculateVertices();
    return super._defineInstanceVertices(untrimmedV);
  }

  calculateTransformMatrix(shape) {
    shape ??= this.placeable;

    // TODO: Does the rectangle shape ever use its rotation property?
    const { x, y, width, height } = shape.data;
    const elev = regionElevation(this.region);
    tmpRect.x = x;
    tmpRect.y = y;
    tmpRect.width = width;
    tmpRect.height = height;
    return Rectangle3dVertices.transformMatrixFromRectangle(tmpRect,
      { ...elev, outMatrix: this.transformMatrix });
  }
}

export class GeometryEllipseRegionShape extends RegionShapeMixin(GeometryInstanced) {

  static NUM_DENSITY_INCREMENTS = 10;

  get density() { return this.type; }

  constructor({ radius, ...opts } = {}) {
    if ( !radius ) console.error("GeometryEllipseRegionShape requires a radius", radius);
    const density = GeometryEllipseRegionShape.instanceDensityForRadius(radius); // Cannot use "this" yet.
    opts.type = density;
    super(opts);
  }

  static instanceDensityForRadius(radius) {
    const density = PIXI.Circle.approximateVertexDensity(radius);
    const N = this.NUM_DENSITY_INCREMENTS;
    return Math.ceil(density / N) * N; // Round up to nearest N.
  }

  _defineInstanceVertices(cl, opts = {}) {
    cl ??= Ellipse3dVertices;
    opts.density ??= this.density;
    return super._defineInstanceVertices(cl, opts);
  }

  calculateTransformMatrix(shape) {
    shape ??= this.placeable;
    const { x, y, radiusX, radiusY } = shape.data;
    const elev = regionElevation(this.region);
    tmpEllipse.x = x;
    tmpEllipse.y = y;
    tmpEllipse.width = radiusX;
    tmpEllipse.height = radiusY;
    return Ellipse3dVertices.transformMatrixFromEllipse(tmpEllipse,
      { ...elev, outMatrix: this.transformMatrix })
  }
}

export class GeometryCircleRegionShape extends GeometryEllipseRegionShape {

  _defineInstanceVertices() {
    const density = this;
    return super._defineInstanceVertices(Circle3dVertices, { density });
  }

  calculateTransformMatrix(shape) {
    shape ??= this.placeable;
    const { x, y, radius } = shape.data;
    const elev = regionElevation(this.region);
    tmpCircle.x = x;
    tmpCircle.y = y;
    tmpCircle.radius = radius;
    return Circle3dVertices.transformMatrixFromCircle(tmpCircle,
      { ...elev, outMatrix: this.transformMatrix });
  }
}

export class GeometryPolygonRegionShape extends RegionShapeMixin(GeometryNonInstanced) {

  _calculateModelVertices() {
    tmpPoly.points = this.placeable.data.points;
    const elev = regionElevation(this.region);
    this._untrimmedVertices = Polygon3dVertices.calculateVertices(tmpPoly, elev);
    return this._untrimmedVertices;
  }
}

const REGION_SHAPE_CLASSES = {
  ellipse: GeometryEllipseRegionShape,
  circle: GeometryCircleRegionShape,
  polygon: GeometryPolygonRegionShape,
  rectangle: GeometryRectangleRegionShape,
}





