/* globals
canvas,
CONFIG,
CONST,
Hooks,
PIXI,
*/
"use strict";

// Geometry folder
import { Draw } from "../geometry/Draw.js";
import { Point3d } from "../geometry/3d/Point3d.js";

import { MODULE_ID } from "../const.js";
import { GeometryDesc } from "./WebGPU/GeometryDesc.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc } from "./WebGPU/GeometryToken.js";
import { GeometryWallDesc } from "./WebGPU/GeometryWall.js";
import { GeometryHorizontalPlaneDesc } from "./WebGPU/GeometryTile.js";
import { PlaceableInstanceHandler, WallInstanceHandler, TileInstanceHandler, TokenInstanceHandler, } from "./WebGPU/PlaceableInstanceHandler.js";
import * as MarchingSquares from "../marchingsquares-esm.js";

Hooks.on("canvasReady", function() {
  console.debug(`${MODULE_ID}|PlaceableTriangles|canvasReady`);
  WallTriangles.registerExistingPlaceables();
  TileTriangles.registerExistingPlaceables();
  TokenTriangles.registerExistingPlaceables();
  WallTriangles.registerPlaceableHooks();
  TileTriangles.registerPlaceableHooks();
  TokenTriangles.registerPlaceableHooks();
});

/**
Store triangles representing Foundry object shapes.
Each object in the scene has an _atvPlaceableGeometry object with the data.
*/

/**
 * See https://github.com/mourner/robust-predicates/blob/main/src/orient3d.js
 * Returns a positive value if the point d lies above the plane passing through a, b, and c,
 * meaning that a, b, and c appear in counterclockwise order when viewed from d.
 * Returns a negative value if d lies below the plane.
 * Returns zero if the points are coplanar.
 * The result is also an approximation of six times the signed volume of the tetrahedron defined by the four points.
 * @param {Point3d} a
 * @param {Point3d} b
 * @param {Point3d} c
 * @param {Point3d} d
 * @returns {number}
 */
function orient3dFast(a, b, c, d) {
  const Point3d = CONFIG.GeometryLib.threeD.Point3d;
  const ad = a.subtract(d, Point3d._tmp1);
  const bd = b.subtract(d, Point3d._tmp2);
  const cd = c.subtract(d, Point3d._tmp3);
  return ad.x * (bd.y * cd.z - bd.z * cd.y) +
        bd.x * (cd.y * ad.z - cd.z * ad.y) +
        cd.x * (ad.y * bd.z - ad.z * bd.y);
}

/**
 * Basic triangle shape in 3d.
 */
export class Triangle {
  /** @type {Point3d} */
  a = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  b = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {Point3d} */
  c = new CONFIG.GeometryLib.threeD.Point3d();

  /**
   * Iterator: a, b, c.
   */
  [Symbol.iterator]() {
    const keys = ["a", "b", "c"];
    const data = this;
    let index = 0;
    return {
      next() {
        if ( index < 3 ) return {
          value: data[keys[index++]],
          done: false };
        else return { done: true };
      }
    };
  }

  forEach(callback) {
    callback(this.a, "a", this);
    callback(this.b, "b", this);
    callback(this.c, "c", this);
  }

  static fromPoints(a, b, c) {
    const tri = new this();
    tri.a.copyFrom(a);
    tri.b.copyFrom(b);
    tri.c.copyFrom(c);
    return tri;
  }

  static fromPartialPoints(a, b, c) {
    const tri = new this();
    tri.a.copyPartial(a);
    tri.b.copyPartial(b);
    tri.c.copyPartial(c);
    return tri;
  }

  /**
   * Convert to PIXI.Polygon. Ignores z values.
   */
  toPolygon() { return new PIXI.Polygon(this.a, this.b, this.c); }

  /**
   * Does this triangle face a given point?
   * Defined as counter-clockwise.
   * @param {Point3d} p
   * @returns {boolean}
   */
  isFacing(p) { return orient3dFast(this.a, this.b, this.c, p) > 0; }

  /**
   * Reverse the orientation of this triangle by swapping a and c.
   */
  reverseOrientation() { [this.a, this.c] = [this.c, this.a]; }

  /**
   * Transform the points using a transformation matrix.
   * @param {Matrix} M
   * @param {Triangle} [tri]    The triangle to modify
   * @returns {Triangle} The modified tri.
   */
  transform(M, tri) {
    tri ??= new this.constructor();
    tri.forEach((pt, idx) => M.multiplyPoint3d(this[idx], pt));
    return tri;
  }

  /**
   * Transform the points using a transformation matrix.
   * @param {number} [multiplier=1]   Multiplier to use to vary the scale of the points.
   * @param {Triangle} [tri]    The triangle to modify
   * @returns {Triangle} The modified tri.
   */
  perspectiveTransform(multiplier = 1, tri) {
    tri ??= new this.constructor();
    this.constructor.perspectiveTransform(this.a, multiplier, tri.a);
    this.constructor.perspectiveTransform(this.b, multiplier, tri.b);
    this.constructor.perspectiveTransform(this.c, multiplier, tri.c);
    return tri;
  }

  scale(multiplier = 1, tri) {
    tri = this.clone(tri);
    tri.a.multiplyScalar(multiplier, tri.a);
    tri.b.multiplyScalar(multiplier, tri.b);
    tri.c.multiplyScalar(multiplier, tri.c);
    return tri;
  }

  /**
   * View from a given position.
   * Transforms and clips the points, then applies perspective transform.
   * @param {Matrix} M    The view matrix.
   * @returns {PIXI.Point[]}
   */
  viewAndClip(M) {  // TODO: Set different multiplier?
    // For speed, skip the new triangle construction and copy some of the methods here directly.
    const tPts = new Array(3);
    tPts[0] = M.multiplyPoint3d(this.a, Point3d._tmp1);
    tPts[1] = M.multiplyPoint3d(this.b, Point3d._tmp2);
    tPts[2] = M.multiplyPoint3d(this.c, Point3d._tmp3);

    // Clip the points
    const cmp = (a, b) => a < b;
    const clippedPts = this.constructor.clipPlanePoints(tPts, -0.1, "z", cmp);

    // Perspective transform.
    clippedPts.forEach(pt => this.constructor.perspectiveTransform(pt, 1, pt));
    return clippedPts;
  }

  /**
   * Truncate the points to be strictly less than 0 in the z direction.
   * (In front of, as opposed to behind, the viewer.)
   * Use -0.1 instead of 0 to avoid floating point errors near 0.
   * @returns {PIXI.Point[]} The new points, as needed, or the original points.
   */
  _clipPoints() {
    const cmp = (a, b) => a < b;
    return this.constructor.clipPlanePoints([this.a, this.b, this.c], -0.1, "z", cmp);
  }

  /**
   * Test if a ray intersects the triangle. Does not consider whether this triangle is facing.
   * Möller-Trumbore intersection algorithm for a triangle.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @returns {t|null}
   */
  intersection(rayOrigin, rayDirection) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const { a, b, c } = this;

    // Calculate the edge vectors of the triangle
    // Not really worth caching these values, as it would require updating them if a,b,c change.
    const edge1 = b.subtract(a, Point3d._tmp1);
    const edge2 = c.subtract(a, Point3d._tmp2);

    // Calculate the determinant of the triangle
    const pvec = rayDirection.cross(edge2, Point3d._tmp3);

    // If the determinant is near zero, ray lies in plane of triangle
    const det = edge1.dot(pvec);
    if (det > -Number.EPSILON && det < Number.EPSILON) return null;  // Ray is parallel to triangle
    const invDet = 1 / det;

    // Calculate the intersection point using barycentric coordinates
    const tvec = rayOrigin.subtract(a, Point3d._tmp);
    const u = invDet * tvec.dot(pvec);
    if (u < 0 || u > 1) return null;  // Intersection point is outside of triangle

    const qvec = tvec.cross(edge1, Point3d._tmp3); // The tmp value cannot be tvec or edge1.
    const v = invDet * rayDirection.dot(qvec);
    if (v < 0 || u + v > 1) return null;  // Intersection point is outside of triangle

    // Calculate the distance to the intersection point
    const t = invDet * edge2.dot(qvec);
    if ( t <= Number.EPSILON ) return null;

    const tile = this.tile;
    if ( !tile || !tile.mesh ) return t;

    // Test tile transparency.
    // TODO: Do we need to check if t is in range?
    const ix = Point3d._tmp3;
    rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix);
    if ( !tile.mesh.containsCanvasPoint(ix) ) return null; // Transparent, so no collision.
    return t;
  }

  /**
   * Convert a 3d point to 2d using a perspective transform by dividing by z.
   * @param {Point3d} pt
   * @param {number} multiplier    Multiplier for the point values.
   *  Used by Area3d to visualize the perspective transform
   * @returns {PIXI.Point}
   */
  static perspectiveTransform(pt, multiplier = 1, outPoint) {
    outPoint ??= new PIXI.Point();
    const mult = multiplier / -pt.z;
    return outPoint.set(pt.x * mult, pt.y * mult)
  }

  /**
   * Truncate a set of points representing a plane shape to keep only the points
   * compared to a given coordinate value. It is assumed that the shape can be closed by
   * getting lastPoint --> firstPoint.
   *
   * If the plane is cut off as a triangle, the fourth point will be the intersection
   * of the original diagonal with the cutoff side.
   *
   * @param {PIXI.Point[]|Point3d[]} points   Array of points for a polygon in clockwise order.
   * @param {number} cutoff                   Coordinate value cutoff
   * @param {string} coordinate               "x", "y", or "z"
   * @param {function} cmp                    Comparator. Return true to keep.
   *   Defaults to (coord, cutoff) => coord > cutoff
   * @returns {PIXI.Point[]|Point3d[]} The new set of points as needed, or original points
   *   May return more points than provided (i.e, triangle clipped so it becomes a quad)
   */
  static clipPlanePoints(points, cutoff, coordinate, cmp) {
    cmp ??= (a, b) => a > b;
    coordinate ??= "x";

    const truncatedPoints = [];
    const ln = points.length;

    let A = points[ln - 1];
    let keepA = cmp(A[coordinate], cutoff);

    for ( let i = 0; i < ln; i += 1 ) {
      const B = points[i];
      const keepB = cmp(B[coordinate], cutoff);

      if ( keepA && keepB ) truncatedPoints.push(A);
      else if ( !(keepA || keepB) ) { } // eslint-disable-line no-empty
      else if ( !keepA ) {
        // Find the new point between A and B to add
        const newA = new A.constructor();
        const t = B.projectToAxisValue(A, cutoff, coordinate, newA);
        if ( t !== null ) {// Can t === null this ever happen in this setup?
          truncatedPoints.push(newA);
        }

      } else if ( !keepB ) {
        // Find the new point between A and B to add after A
        const newB = new B.constructor();
        const t = A.projectToAxisValue(B, cutoff, coordinate, newB);
        if ( t !== null ) {// Can t === null this ever happen in this setup?
          truncatedPoints.push(A);
          truncatedPoints.push(newB);
        }
      }

      A = B;
      keepA = keepB;
    }
    return truncatedPoints;
  }

  /**
   * Make a copy of this triangle.
   * @param {Triangle} [other]      Optional other triangle to use
   * @returns {Triange} The other
   */
  clone(other) {
    other ??= new this.constructor();
    other.a.copyFrom(this.a);
    other.b.copyFrom(this.b);
    other.c.copyFrom(this.c);
    return other;
  }

  /**
   * Create an array of triangles from given indices and vertices.
   * @param {Number[]} vertices     Array of vertices, 3 coordinates per vertex, 3 vertices per triangle
   * @param {Number[]} [indices]    Indices to determine order in which triangles are created from vertices
   * @returns {Triangle[]}
   */
  static fromVertices(vertices, indices) {
    // const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    if ( vertices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of vertices is not divisible by 3: ${vertices.length}`);
    indices ??= Array.fromRange(Math.floor(vertices.length / 3));
    if ( indices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of indices is not divisible by 3: ${indices.length}`);
    const tris = new Array(Math.floor(indices.length / 3));
    for ( let i = 0, j = 0, jMax = tris.length; j < jMax; j += 1 ) {
      const a = pointFromVertices(i++, vertices, indices, Point3d._tmp1);
      const b = pointFromVertices(i++, vertices, indices, Point3d._tmp2);
      const c = pointFromVertices(i++, vertices, indices, Point3d._tmp3);
      tris[j] = Triangle.fromPoints(a, b, c);
    }
    return tris;
  }

  /**
   * Create an array of triangles from given array of point 3ds and indices.
   * @param {Number[]} points       Point3ds
   * @param {Number[]} [indices]    Indices to determine order in which triangles are created from vertices
   */
  static fromPoint3d(points, indices) {
    const vertices = new Array(points.length * 3);
    for ( let i = 0, j = 0, iMax = points.length; i < iMax; i += 1 ) {
      const pt = points[i];
      vertices[j++] = pt.x;
      vertices[j++] = pt.y;
      vertices[j++] = pt.z;
    }
    return this.fromVertices(vertices, indices);
  }

  /* ----- NOTE: Debug ----- */

  draw(opts) { Draw.shape(new PIXI.Polygon(...this), opts); }

  /**
   * Draw shape but swap z and y positions.
   */
  drawSplayed(opts) { Draw.shape(new PIXI.Polygon(this.a.x, this.a.z, this.b.x, this.b.z, this.c.x, this.c.z), opts); }
}

function pointFromVertices(i, vertices, indices, outPoint) {
  outPoint ??= new CONFIG.GeometryLib.threeD.Point3d;
  const idx = indices[i];
  const v = vertices.slice(idx * 3, (idx * 3) + 3);
  outPoint.set(v[0], v[1], v[2]);
  return outPoint;
}

// function fromVertices(vertices, indices) {
//     const Point3d = CONFIG.GeometryLib.threeD.Point3d;
//     if ( vertices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of vertices is not divisible by 3: ${vertices.length}`);
//     indices ??= Array.fromRange(Math.floor(vertices.length / 3));
//     if ( indices.length % 3 !== 0 ) console.error(`${this.name}.fromVertices|Length of indices is not divisible by 3: ${indices.length}`);
//     const tris = new Array(Math.floor(indices.length / 3));
//     for ( let i = 0, j = 0, jMax = tris.length; j < jMax; j += 1 ) {
//       const a = pointFromVertices(i++, vertices, indices, Point3d._tmp1);
//       const b = pointFromVertices(i++, vertices, indices, Point3d._tmp2);
//       const c = pointFromVertices(i++, vertices, indices, Point3d._tmp3);
//       tris[j] = Triangle.fromPoints(a, b, c);
//     }
//     return tris;
//   }


const SENSE_TYPES = {};
CONST.WALL_RESTRICTION_TYPES.forEach(type => SENSE_TYPES[type] = Symbol(type));

/**
 * Stores 1+ prototype triangles and corresponding transformed triangles to represent
 * a basic shape in 3d space.
 */
export class AbstractPolygonTriangles {
  static ID = "tokenvisibility";

  static geom;

  /** @type {Triangle[]} */
  static _prototypeTriangles;

  static get prototypeTriangles() {
    return (this._prototypeTriangles ??= Triangle.fromVertices(this.geom.vertices, this.geom.indices));
  }

  /** @type {class} */
  static instanceHandlerClass = PlaceableInstanceHandler;

  /** @type {PlaceableInstanceHandler} */
  static _instanceHandler; // Cannot use # with static getter if it will change based on child class.

  static get instanceHandler() {
    if ( this._instanceHandler ) return this._instanceHandler;
    this._instanceHandler = new this.instanceHandlerClass();
    this._instanceHandler.initializePlaceables();
    return this._instanceHandler;
  }

  static trianglesForPlaceable(placeable) {
    const idx = this.instanceHandler.instanceIndexFromId.get(placeable.id);
    const M = this.instanceHandler.matrices[idx];
    if ( !M ) return [];
    return this.prototypeTriangles.map(tri => tri.transform(M));
  }

  /* ----- Hooks ----- */

  /** @type {number[]} */
  static _hooks = [];

  /**
   * @typedef {object} PlaceableHookData
   * Description of a hook to use.
   * @prop {object} name: methodName        Name of the hook and method; e.g. updateWall: "_onPlaceableUpdate"
   */
  /** @type {object[]} */
  static HOOKS = [];

  /**
   * Register hooks for this placeable that record updates.
   */
  static registerPlaceableHooks() {
    if ( this._hooks.length ) return; // Only register once.
    for ( const hookDatum of this.HOOKS ) {
      const [name, methodName] = Object.entries(hookDatum)[0];
      const id = Hooks.on(name, this[methodName].bind(this));
      this._hooks.push({ name, methodName, id });
    }
  }

  static deregisterPlaceableHooks() {
    this._hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.length = 0;
  }

  static registerExistingPlaceables(placeables) {
    placeables.forEach(placeable => this._onPlaceableCreation(placeable));
  }

  /**
   * On placeable creation hook, add getter to the placeable.
   */
  static _onPlaceableCreation(placeable) {
    const obj = placeable[this.ID] ??= {};
    const self = this;
    Object.defineProperty(obj, "triangles", {
      get() { return self.trianglesForPlaceable(placeable); },
      configurable: true,
    });
  }


  /* ----- Debug ----- */

  static draw(placeable, opts) { this.trianglesForPlaceable(placeable).forEach(tri => tri.draw(opts)); }

  static drawPrototypes(opts) { this.prototypeTriangles.forEach(tri => tri.draw(opts)); }

  /**
   * Draw shape but swap z and y positions.
   */
  static drawSplayed(placeable, opts) { this.trianglesForPlaceable(placeable).forEach(tri => tri.drawSplayed(opts)); }

  static drawPrototypesSplayed(opts) { this.prototypeTriangles.forEach(tri => tri.drawSplayed(opts)); }
}


export class WallTriangles extends AbstractPolygonTriangles {
  /** @type {GeometryDesc} */
  static geom = new GeometryWallDesc({ directional: false });

  /** @type {Triangle[]} */
  static _prototypeTriangles;

  /** @type {class} */
  static instanceHandlerClass = WallInstanceHandler;

  /** @type {object[]} */
  static HOOKS = [
    { createWall: "_onPlaceableCreation" },
  ];

  /**
   * On placeable creation hook, add an instance of this to the placeable.
   */
  static _onPlaceableCreation(placeable) {
    const obj = placeable[this.ID] ??= {};
    Object.defineProperty(obj, "triangles", {
      configurable: true,
      get() {
        const instance = WallInstanceHandler.isDirectional(placeable.edge)
          ? DirectionalWallTriangles : WallTriangles;
        return instance.trianglesForPlaceable(placeable);
      },
    });
  }

  static registerExistingPlaceables() {
    canvas.walls.placeables.forEach(wall => this._onPlaceableCreation(wall));
  }
}

export class DirectionalWallTriangles extends WallTriangles {
  /** @type {GeometryDesc} */
  static geom = new GeometryWallDesc({ directional: true });

  /** @type {Triangle[]} */
  static _prototypeTriangles;

}

export class TileTriangles extends AbstractPolygonTriangles {
  /** @type {GeometryDesc} */
  static geom = new GeometryHorizontalPlaneDesc();

  /** @type {Triangle[]} */
  static _prototypeTriangles;

  /** @type {class} */
  static instanceHandlerClass = TileInstanceHandler;

  /** @type {object[]} */
  static HOOKS = [
    { createTile: "_onPlaceableCreation" },
  ];

  static registerExistingPlaceables() {
    canvas.tiles.placeables.forEach(tile => this._onPlaceableCreation(tile));
  }

  /**
   * On placeable creation hook, also add isoband polygons representing solid areas of the tile.
   */
  static _onPlaceableCreation(tile) {
    AbstractPolygonTriangles._onPlaceableCreation(tile);
    const obj = tile[this.ID] ??= {};
    obj.alphaThresholdPolygons = this.convertTileToIsoBands(tile);
    obj.alphaThresholdTriangles = obj.alphaThresholdPolygons
      ? this.polygonsToFaceTriangles(obj.alphaThresholdPolygons) : null;

    const self = this;
    Object.defineProperty(obj, "alphaTriangles", {
      get() { return self.alphaTrianglesForPlaceable(tile); },
      configurable: true,
    });
  }

  /** @type {Triangle[]} */
  _prototypeAlphaTriangles;

  static polygonsToFaceTriangles(polys) {
    // Convert the polygons to top and bottom faces.
    // Then make these into triangles.
    // Trickier than leaving as polygons but can dramatically cut down the number of polys
    // for more complex shapes.
    const tris = [];
    for ( const poly of polys ) {
      // Keep elevation 0.
      const topFace = GeometryDesc.polygonTopBottomFaces(poly, { top: true, addUVs: false, addNormals: false });
      const bottomFace = GeometryDesc.polygonTopBottomFaces(poly, { top: false, addUVs: false, addNormals: false });
      tris.push(
        ...Triangle.fromVertices(topFace.vertices, topFace.indices),
        ...Triangle.fromVertices(bottomFace.vertices, bottomFace.indices)
      );
    }
    return tris;
  }

  static convertTileToIsoBands(tile) {
    // TODO: What about holes?

    if ( !CONFIG[MODULE_ID].alphaThreshold
      || !tile.evPixelCache ) return null;
    const threshold = 255 * CONFIG[MODULE_ID].alphaThreshold;
    const pixels = tile.evPixelCache.pixels;

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
      return [tile.evPixelCache.getThresholdLocalBoundingBox(CONFIG[MODULE_ID].alphaThreshold).toPolygon()];
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
      polys[i] = new PIXI.Polygon(bands[i].flatMap(pt => pt)); // TODO: Can we lose the flatMap?
    }

    // Use Clipper to clean the polygons.
    const paths = CONFIG.GeometryLib.ClipperPaths.fromPolygons(polys, { scalingFactor: 100 });
    return paths.clean().toPolygons();
  }

  static alphaTrianglesForPlaceable(tile) {
    if ( !this.instanceHandler.instanceIndexFromId.has(tile.id) ) return [];

    const obj = tile[MODULE_ID] ?? {};
    if ( !obj.alphaThresholdTriangles || !tile.evPixelCache ) return this.trianglesForPlaceable(tile);

    // Expand the canvas conversion matrix to 4x4.
    // Last row of the 3x3 is the translation matrix, which should be moved to row 4.
    const toCanvasM3x3 = tile.evPixelCache.toCanvasTransform;
    const toCanvasM = CONFIG.GeometryLib.MatrixFlat.identity(4, 4);
    toCanvasM.setElements((elem, r, c) => {
      if ( r < 2 && c < 3 ) return toCanvasM3x3.arr[r][c];
      if ( r === 3 && c < 2 ) return  toCanvasM3x3.arr[2][c];
      return elem;
    });

    // Add elevation translation.
    const elevationT = CONFIG.GeometryLib.MatrixFlat.translation(0, 0, tile.elevationZ);
    const M = toCanvasM.multiply4x4(elevationT);
    return obj.alphaThresholdTriangles.map(tri => tri.transform(M));
  }
}

export class TokenTriangles extends AbstractPolygonTriangles {
  /** @type {GeometryDesc} */
  static geom = new GeometryCubeDesc();

  /** @type {Triangle[]} */
  static _prototypeTriangles;

  /** @type {class} */
  static instanceHandlerClass = TokenInstanceHandler;

  /** @type {object[]} */
  static HOOKS = [
    { createToken: "_onPlaceableCreation" },
  ];


  /* Debugging
  static get prototypeTriangles() {
    // 12 triangles total, 36 indices.
    // South facing (first 2 triangles)
    // return (this._prototypeTriangles ??= Triangle.fromVertices(this.geom.vertices, this.geom.indices.slice(3*0, 3*2)));

    // Top facing (second to last 2 triangles)
    // return (this._prototypeTriangles ??= Triangle.fromVertices(this.geom.vertices, this.geom.indices.slice(3*8, 3*10)));

    // Bottom facing (last 2 triangles)
    return (this._prototypeTriangles ??= Triangle.fromVertices(this.geom.vertices, this.geom.indices.slice(3*8, 3*10)));
  }
  */


  /**
   * On placeable creation hook, add an instance of this to the placeable.
   */
  static _onPlaceableCreation(placeable) {
    const obj = placeable[this.ID] ??= {};
    Object.defineProperty(obj, "triangles", {
      configurable: true,
      get() {
        const instance = placeable.isConstrainedTokenBorder
          ? ConstrainedTokenTriangles : TokenTriangles;
        return instance.trianglesForPlaceable(placeable);
      },
    });
  }

  static registerExistingPlaceables() {
    canvas.tokens.placeables.forEach(token => this._onPlaceableCreation(token));
  }
}

export class ConstrainedTokenTriangles extends TokenTriangles {
  static trianglesForPlaceable(token) {
    const geom = new GeometryConstrainedTokenDesc({ token });
    return Triangle.fromVertices(geom.vertices, geom.indices);
  }
}

// TODO: Can we use entirely static methods for grid triangles?
//       Can these be reset on scene load? Maybe a hook?

export class Grid3dTriangles extends AbstractPolygonTriangles {

  /** @type {class} */
  static instanceHandlerClass = null;

  /** @type {Triangle[]} */
  static prototypeTriangles;

  static buildGridGeom() {
    // TODO: Hex grids
    const w = canvas.grid.sizeX;
    const d = canvas.grid.sizeY;
    const h = canvas.dimensions.size;
    const geom = new GeometryCubeDesc({ w, d, h });
    this.prototypeTriangles = Triangle.fromVertices(geom.vertices, geom.indices);
  }

  static trianglesForGridShape() {
    if ( !this.prototypeTriangles ) this.buildGridGeom();
    return this.prototypeTriangles.map(tri => tri.clone());
  }
}



/* Orient3dFast license
https://github.com/mourner/robust-predicates/tree/main
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>

*/

/* Testing
api = game.modules.get("tokenvisibility").api;
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
MatrixFlat = CONFIG.GeometryLib.MatrixFlat
let { Triangle, DirectionalWallTriangles, WallTriangles, TileTriangles, TokenTriangles } = api.triangles

tri = Triangle.fromPoints(
  new Point3d(0, 0, 0),
  new Point3d(500, 0, 0),
  new Point3d(0, 1000, 0)
)
tri.draw({ color: Draw.COLORS.blue })
tM = MatrixFlat.translation(1000, 1000, 0)
triT = tri.transform(tM)
triT.draw({ color: Draw.COLORS.blue })
wall = canvas.walls.controlled[0]

rM = MatrixFlat.rotationZ(Math.toRadians(45))
triT = tri.transform(rM.multiply4x4(tM))
triT.draw({ color: Draw.COLORS.blue })


wall = canvas.walls.controlled[0]
wallTri = new DirectionalWallTriangles(wall)
wallTri = new WallTriangles(wall)
wallTri.initialize()
wallTri.update()
wallTri.drawPrototypes({ color: Draw.COLORS.blue })
wallTri.draw({ color: Draw.COLORS.blue }) // Same
wallTri.drawSplayed({ color: Draw.COLORS.gray })

tile = canvas.tiles.controlled[0]
tileTri = new TileTriangles(tile)
tileTri.initialize()
tileTri.update()

tokenTri = new TokenTriangles(_token)
tokenTri.initialize()
tokenTri.update()

tokenTri.top.drawPrototypes({ color: Draw.COLORS.blue })
tokenTri.bottom.drawPrototypes({ color: Draw.COLORS.blue })

tokenTri.top.draw({ color: Draw.COLORS.blue })
tokenTri.bottom.draw({ color: Draw.COLORS.blue })

tokenTri.sides.drawPrototypes({ color: Draw.COLORS.blue })
tokenTri.sides.draw({ color: Draw.COLORS.blue })

tokenTri.drawPrototypes({ color: Draw.COLORS.blue })
tokenTri.draw({ color: Draw.COLORS.blue })
tokenTri.drawSplayed({ color: Draw.COLORS.red })

Draw = CONFIG.GeometryLib.Draw

*/
