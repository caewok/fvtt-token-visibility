/* globals
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { GeometryTile } from "../geometry/GeometryTile.js";
import { AbstractPlaceableGeometryTracker, allGeometryMixin } from "./PlaceableGeometryTracker.js";
import { Point3d } from "../../geometry/3d/Point3d.js";
import { Polygon3dVertices } from "../geometry/BasicVertices.js";
import { FixedLengthTrackingBuffer } from "./TrackingBuffer.js";

import * as MarchingSquares from "../marchingsquares-esm.js";

const tmpPt3d_0 = new Point3d();

/* TileGeometry
Placeable geometry stored in tile placeables.
- AABB
- rotation, scaling, and translation matrices from an ideal shape.
- Polygon3ds for faces
- Triangle3ds for faces
- Update key


Separate entries are available for alpha threshold
*/

export class TileGeometryTracker extends allGeometryMixin(AbstractPlaceableGeometryTracker) {
  static HOOKS = {
    createTile: "_onPlaceableDocumentCreation",
    updateTile: "_onPlaceableDocumentUpdate",
    removeTile: "_onPlaceableDocumentDeletion",
  };

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
    "x",
    "y",
    "elevation",
    "width",
    "height",
    "rotation",
  ]);

  static layer = "tiles";

  /** @type {GeometryDesc} */
  static geomClass = GeometryTile;

  /** @type {number[]} */
  static _hooks = [];

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  get alphaThreshold() { return CONFIG[MODULE_ID].alphaThreshold || 0; }

  get tile() { return this.placeable; }

  calculateTranslationMatrix() {
    const ctr = this.constructor.tileCenter(this.tile);
    CONFIG.GeometryLib.MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, this.matrices.translation);
    return this.matrices.translation;
  }

  calculateRotationMatrix() {
    const rot = this.constructor.tileRotation(this.tile)
    CONFIG.GeometryLib.MatrixFloat32.rotationZ(rot, true, this.matrices.rotation);
    return this.matrices.rotation;
  }

  calculateScaleMatrix() {
    const { width, height } = this.constructor.tileDimensions(this.tile);
    CONFIG.GeometryLib.MatrixFloat32.scale(width, height, 1.0, this.matrices.scale);
    return this.matrices.scale;
  }

  _updateAABB() {
    CONFIG.GeometryLib.threeD.AABB3d.fromTileAlpha(this.tile, this.alphaThreshold, this.aabb);
  }

  top = new CONFIG.GeometryLib.threeD.Quad3d();

  bottom = new CONFIG.GeometryLib.threeD.Quad3d();

  get quad3d() { return this.top; }

  /** @type {object<Polygons3d[]>} */
  alphaThresholdPolygons = {
    top: null,
    bottom: null,
  };

  /** @type {ClipperPaths|ClipperPaths2} */
  #alphaThresholdPaths;

  update() {
    super.update();
    this.#alphaThresholdPaths = this.convertTileToIsoBands();
    this._updatePathsToFacePolygons();
    this._updatePathsToFaceTriangles();
  }

  _updateFaces() {
    const tile = this.placeable;
    const alphaShape = tile.evPixelCache.getThresholdCanvasBoundingBox(this.alphaThreshold);
    const elevZ = tile.elevationZ;

    if ( alphaShape instanceof PIXI.Polygon ) {
      const Polygon3d = CONFIG.GeometryLib.threeD.Polygon3d;
      if ( !(this.top instanceof Polygon3d) ) this.top = new Polygon3d();
      Polygon3d.fromPolygon(alphaShape, elevZ, this.top);
    } else { // PIXI.Rectangle
      const Quad3d = CONFIG.GeometryLib.threeD.Quad3d;
      if ( !(this.top instanceof Quad3d) ) this.top = new Quad3d();
      Quad3d.fromRectangle(alphaShape, elevZ, this.top);
    }

    this.top.clearCache();
    if ( !this.bottom || !(this.bottom instanceof this.top.constructor) ) this.bottom = new this.top.constructor();
    this.top.clone(this.bottom);
    this.bottom.reverseOrientation();
  }


  /**
   * Convert clipper paths representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   */
  _updatePathsToFacePolygons() {
    const paths = this.#alphaThresholdPaths;
    if ( !paths ) return;
    const top = CONFIG.GeometryLib.threeD.Polygons3d.fromClipperPaths(paths)
    const bottom = top.clone();
    bottom.reverseOrientation(); // Reverse orientation but keep the hole designations.
    this.alphaThresholdPolygons.top = top;
    this.alphaThresholdPolygons.bottom = bottom;
  }

  /**
   * Triangulate an array of polygons or clipper paths, then convert into 3d face triangles.
   * Both top and bottom faces.
   * @param {PIXI.Polygon|ClipperPaths} polys
   * @returns {Triangle3d[]}
   */
  _updatePathsToFaceTriangles() {
    const polys = this.#alphaThresholdPaths;
    if ( !polys ) return;

    // Convert the polygons to top and bottom faces.
    // Then make these into triangles.
    // Trickier than leaving as polygons but can dramatically cut down the number of polys
    // for more complex shapes.
    const tris = [];
    const elev = this.placeable.elevationZ;
    const { top, bottom } = Polygon3dVertices.polygonTopBottomFaces(polys, {  topZ: elev, bottomZ: elev });

    // Trim the UVs and Normals.
    const topTrimmed = Polygon3dVertices.trimNormalsAndUVs(top);
    const bottomTrimmed = Polygon3dVertices.trimNormalsAndUVs(bottom);
    tris.push(
      ...CONFIG.GeometryLib.threeD.Triangle3d.fromVertices(topTrimmed),
      ...CONFIG.GeometryLib.threeD.Triangle3d.fromVertices(bottomTrimmed)
    );

    // Drop any triangles that are nearly collinear or have very small areas.
    // Note: This works b/c the triangles all have z values of 0, which can be safely ignored.
    this.alphaThresholdTriangles = tris.filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06) );
  }


  /**
   * For a given tile, convert its pixels to an array of polygon isobands representing
   * alpha values at or above the threshold. E.g., alpha between 0.75 and 1.
   * @param {Tile} tile
   * @returns {ClipperPaths|null} The polygon paths or, if error, the local alpha bounding box.
   *   Coordinates returned are local to the tile pixels, between 0 and width/height of the tile pixels.
   *   Null is returned if no alpha threshold is set or no evPixelCache is defined.
   */
  convertTileToIsoBands() {
    const { tile, alphaThreshold } = this;

    if ( !alphaThreshold || !tile.evPixelCache ) return null;
    const threshold = 255 * alphaThreshold;
    const pixels = tile.evPixelCache.pixels;
    const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;

    // Convert pixels to isobands.
    const width = tile.evPixelCache.width
    const height = tile.evPixelCache.height
    const rowViews = new Array(height);
    for ( let r = 0, start = 0, rMax = height; r < rMax; r += 1, start += width ) {
      rowViews[r] = [...pixels.slice(start, start + width)];
    }

    let bands;
    try {
      bands = MarchingSquares.isoBands(rowViews, threshold, 256 - threshold);
    } catch ( err ) {
      console.error(err);
      const poly = tile.evPixelCache.getThresholdLocalBoundingBox(alphaThreshold).toPolygon();
      return ClipperPaths.fromPolygons([poly]);
    }

    /* Don't want to scale between 0 and 1 b/c using evPixelCache transform on the local coordinates.
    // Create polygons scaled between 0 and 1, based on width and height.
    const invWidth = 1 / width;
    const invHeight = 1 / height;
    const nPolys = lines.length;
    const polys = new Array(nPolys);
    for ( let i = 0; i < nPolys; i += 1 ) {
      polys[i] = new PIXI.Polygon(bands[i].flatMap(pt => [pt[0] * invWidth, pt[1] * invHeight]))
    }
    */
    const nPolys = bands.length;
    const polys = new Array(nPolys);
    for ( let i = 0; i < nPolys; i += 1 ) {
      const poly = new PIXI.Polygon(bands[i].flatMap(pt => pt)); // TODO: Can we lose the flatMap?

      // Polys from MarchingSquares are CW if hole; reverse
      poly.reverseOrientation();
      polys[i] = poly;
    }

    // Use Clipper to clean the polygons. Leave as clipper paths for earcut later.
    const paths = CONFIG[MODULE_ID].ClipperPaths.fromPolygons(polys, { scalingFactor: 100 });
    return paths.clean().trimByArea(CONFIG[MODULE_ID].alphaAreaThreshold);
  }


  /* ----- NOTE: Intersection ----- */

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
    const t = this.quad3d.intersectionT(rayOrigin, rayDirection);
    if ( t === null || !CONFIG.GeometryLib.utils.almostBetween(t, minT, maxT) ) return null;
    if ( !this.alphaThreshold ) return t;

    // Threshold test at the intersection point.
    const pxThreshold = 255 * this.alphaThreshold;
    rayOrigin.add(rayDirection.multiplyScalar(t, tmpPt3d_0), tmpPt3d_0);
    const px = this.tile.evPixelCache.pixelAtCanvas(tmpPt3d_0.x, tmpPt3d_0.y);
    return (px > pxThreshold) ? t : null;
  }

  /**
   * Determine the tile rotation.
   * @param {Tile} tile
   * @returns {number}    Rotation, in radians.
   */
  static tileRotation(tile) { return Math.toRadians(tile.document.rotation); }

  /**
   * Determine the tile 3d dimensions, in pixel units.
   * Omits alpha border.
   * @param {Tile} tile
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} elevation   In z direction
   */
  static tileDimensions(tile) {
    const { x, y, width, height } = tile.document;
    return {
      x, y, width, height,
      elevation: tile.elevationZ,
    };
  }

  /**
   * Determine the center of the tile, in pixel units.
   * @param {Tile} tile
   * @returns {Point3d}
   */
  static tileCenter(tile) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const out = new Point3d();
    const { x, y, width, height, elevation } = this.tileDimensions(tile);
    const TL = Point3d._tmp2.set(x, y, elevation);
    const BR = TL.add(out.set(width, height, 0), out);
    return TL.add(BR, out).multiplyScalar(0.5, out)
  }
}