/* globals
canvas,
CONFIG,
PIXI
*/
"use strict";

// Geometry folder
import { Draw } from "../geometry/Draw.js";
import { Point3d } from "../geometry/3d/Point3d.js";

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
   * View from a given position.
   * Transforms and clips the points, then applies perspective transform.
   * @param {Matrix} M    The view matrix.
   * @returns {PIXI.Point[]}
   */
  viewAndClip(M) {  // TODO: Set different multiplier?
    // For speed, skip the new triangle construction and copy some of the methods here directly.
    const tPts = new Array[3];
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
    // Not really worth caching these values.
    const edge1 = b.subtract(a, Point3d._tmp2);
    const edge2 = c.subtract(a, Point3d._tmp3);

    // Calculate the determinant of the triangle
    const pvec = rayDirection.cross(edge2, Point3d._tmp1);

    // If the determinant is near zero, ray lies in plane of triangle
    const det = edge1.dot(pvec);
    if (det > -Number.EPSILON && det < Number.EPSILON) return null;  // Ray is parallel to triangle
    const invDet = 1 / det;

    // Calculate the intersection point using barycentric coordinates
    const tvec = rayOrigin.subtract(a, Point3d._tmp);
    const u = invDet * tvec.dot(pvec);
    if (u < 0 || u > 1) return null;  // Intersection point is outside of triangle

    const qvec = tvec.cross(edge1, Point3d._tmp2);
    const v = invDet * rayDirection.dot(qvec);
    if (v < 0 || u + v > 1) return null;  // Intersection point is outside of triangle

    // Calculate the distance to the intersection point
    const t = invDet * edge2.dot(qvec);
    if ( t <= Number.EPSILON ) return null;

    const tile = this.tile;
    if ( !tile || !tile.mesh ) return t;

    // Test tile transparency.
    // TODO: Do we need to check if t is in range?
    const ix = rayOrigin.add(rayDirection.multiplyScalar(t, Point3d._tmp3), Point3d._tmp3);
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

  /* ----- NOTE: Debug ----- */

  draw(opts) { Draw.shape(new PIXI.Polygon(...this), opts); }

  /**
   * Draw shape but swap z and y positions.
   */
  drawSplayed(opts) { Draw.shape(new PIXI.Polygon(this.a.x, this.a.z, this.b.x, this.b.z, this.c.x, this.c.z), opts); }
}

/**
 * Stores 1+ prototype triangles and corresponding transformed triangles to represent
 * a basic shape in 3d space.
 */
export class AbstractPolygonTriangles {

  /** @type {Triangle[]} */
  _prototypeTriangles = []; // Triangles prior to any update.

  /** @type {Triangle[]} */
  _triangles = []; // Triangles after update.

  get prototypeTriangles() { return this._prototypeTriangles; }

  get triangles() { return this._triangles; }

  /**
   * @param {MatrixFlat<4x4>} M   Initial transform matrix to apply to the prototype triangles.
   *   For example, if constructing a tile, set its width and height here so only a
   *   translate update is required later.
   */
  initialize(M) {
    this._setPrototypes(M);
    this._initialize();
  }

  /**
   * Define the unit prototype triangles.
   * @param {MatrixFlat<4x4>} M     Matrix used to initially modify the prototype triangles.
   * @override
   */
  _setPrototypes(M) {
    if ( M ) this.prototypeTriangles.forEach(tri => tri.transform(M, tri));
  }

  /**
   * Create the placeholder triangles that store data after transform.
   */
  _initialize() {
    this.prototypeTriangles.forEach((tri, idx) => this.triangles[idx] = tri.clone());
  }

  /**
   * Apply a transform matrix to each prototype triangle.
   * @param {MatrixFlat<4x4>}
   */
  update(M) {
    this.prototypeTriangles.forEach((tri, idx) => tri.transform(M, this.triangles[idx]));
  }

  /* ----- Debug ----- */

  draw(opts) { this.triangles.forEach(tri => tri.draw(opts)); }

  drawPrototypes(opts) { this.prototypeTriangles.forEach(tri => tri.draw(opts)); }

  /**
   * Draw shape but swap z and y positions.
   */
  drawSplayed(opts) { this.triangles.forEach(tri => tri.drawSplayed(opts)); }

  drawPrototypesSplayed(opts) { this.prototypeTriangles.forEach(tri => tri.drawSplayed(opts)); }
}

/**
 * Represent a 2d (flat) square as two triangles.
 * Simpler than Polygon2dTriangles, which would require 4 triangles.
 * Unit square centered at 0,0.
 */
export class Square2dTriangles extends AbstractPolygonTriangles {
  /*
    TL --- TR
    |      |
    |      |
    BL --- BR
  */

  /**
   * Unit size 1 in each direction, centered on 0,0,0.
   * @type {object<Point3d>}
   */
  static PROTOTYPE_POINTS = {
    TL: { x: -0.5, y: -0.5, z: 0 },
    TR: { x: 0.5, y: -0.5, z: 0 },
    BR: { x: 0.5, y: 0.5, z: 0 },
    BL: { x: -0.5, y: 0.5, z: 0 }
  }

  /** @type {Triangle[]} */
  _prototypeTriangles = Array(2); // Triangles prior to any update.

  /** @type {Triangle[]} */
  _triangles = Array(2); // Triangles after update.

  /**
   * Define the unit triangles used in this square.
   * @param {MatrixFlat<4x4>} M     Matrix used to initially modify the prototype triangles.
   */
  _setPrototypes(M) {
    const { TL, TR, BR, BL } = this.constructor.PROTOTYPE_POINTS;
    this.prototypeTriangles[0] = Triangle.fromPoints(BR, TR, TL);
    this.prototypeTriangles[1] = Triangle.fromPoints(BL, BR, TL);
    super._setPrototypes(M);
  }
}

/**
 * Represent a 2d (flat) square as four triangles, facing opposite directions.
 */
export class Square2dDoubleTriangles extends Square2dTriangles {
  /** @type {Triangle[]} */
  _prototypeTriangles = Array(2); // Triangles prior to any update.

  /** @type {Triangle[]} */
  _triangles = Array(4); // Triangles after update.

  _initialize() {
    super._initialize();

    // Need two more triangles flipped to face the other direction.
    this._triangles[2] = this._triangles[0].clone();
    this._triangles[3] = this._triangles[1].clone();
  }

  update(M) {
    super.update(M);

    // Copy and flip the remaining two.
    this._triangles[0].clone(this._triangles[2]);
    this._triangles[1].clone(this._triangles[3]);
    this._triangles[2].reverseOrientation();
    this._triangles[3].reverseOrientation();
  }
}

/**
 * Represent a 2d vertical square as two triangles.
 * Simpler than PolygonVerticalTriangles, which would require 4 triangles.
 * Unit square centered at 0,0.
 */
export class SquareVerticalTriangles extends Square2dTriangles {
  /*
    TL --- TR
    |      |
    |      |
    BL --- BR
  */

  /**
   * Unit size 1 in each direction, centered on 0,0,0.
   * @type {object<Point3d>}
   */
  static PROTOTYPE_POINTS = {
    TL: { x: -0.5, y: 0, z: 0.5 },
    TR: { x: 0.5, y: 0, z: 0.5 },
    BR: { x: 0.5, y: 0, z: -0.5 },
    BL: { x: -0.5, y: 0, z: -0.5 }
  }
}

/**
 * Represent a 2d vertical square as four triangles, facing opposite each other.
 */
export class SquareVerticalDoubleTriangles extends Square2dDoubleTriangles {
  /*
    TL --- TR
    |      |
    |      |
    BL --- BR
  */

  /**
   * Unit size 1 in each direction, centered on 0,0,0.
   * @type {object<Point3d>}
   */
  static PROTOTYPE_POINTS = {
    TL: { x: -0.5, y: 0, z: 0.5 },
    TR: { x: 0.5, y: 0, z: 0.5 },
    BR: { x: 0.5, y: 0, z: -0.5 },
    BL: { x: -0.5, y: 0, z: -0.5 }
  }
}

/**
 * Represent a 2d (flat) simple polygon as a fan of triangles.
 * Requires that the polygon be sufficiently convex that it can be described by a fan of
 * polygons joined at its centroid.
 */
export class Polygon2dTriangles extends AbstractPolygonTriangles  {
  /*
    B ---- E
    | \   /|
        A
    | /   \|
    C ---- D
  */

  /** @type {PIXI.Polygon} */
  polygon;

  /**
   * @param {PIXI.Polygon} poly   Shape to use; typically should be centered at 0,0.
   * @param {MatrixFlat<4x4>} M   Initial transform matrix to apply to the prototype triangles.
   *   For example, if constructing a tile, set its width and height here so only a
   *   translate update is required later.
   */
  constructor(polygon) {
    super();

    // Set polygon counter-clockwise, which will make the prototype triangles face up.
    this.polygon = polygon;
    if ( this.polygon.isClockwise ) this.polygon.reverseOrientation();
  }

  _setPrototypes(M) {
    const center = this.polygon.center; // Polygon centroid.
    for ( const edge of this.polygon.iterateEdges({closed: true})) {
      const tri = Triangle.fromPartialPoints(center, edge.A, edge.B);
      this._prototypeTriangles.push(tri);
    }
    super._setPrototypes(M);
  }
}

/**
 * Represent the vertical walls of a 2d polygon, such that each edge has a vertical
 * square of unit size.
 */
export class PolygonVerticalTriangles extends AbstractPolygonTriangles {
  /** @type {PIXI.Polygon} */
  polygon;

  /**
   * Triangles before update/transformation.
   * @type {Triangle[]}
   */
  get prototypeTriangles() { return this.verticalSquares.flatMap(s => s.prototypeTriangles); }

  /**
   * Triangles after update/transformation.
   * @type {Triangle[]}
   */
  get triangles() { return this.verticalSquares.flatMap(s => s.triangles); }

  /** @type {SquareVerticalTriangles} */
  verticalSquares = [];

  /**
   * @param {PIXI.Polygon} poly   Shape to use; typically should be centered at 0,0.
   * @param {MatrixFlat<4x4>} M   Initial transform matrix to apply to the prototype triangles.
   *   For example, if constructing a tile, set its width and height here so only a
   *   translate update is required later.
   */
  constructor(polygon) {
    super();
    // Set polygon counter-clockwise, which will make the prototype triangles face up.
    this.polygon = polygon;
    if ( this.polygon.isClockwise ) this.polygon.reverseOrientation();

    // Remove unused arrays.
    this._prototypeTriangles = null;
    this._triangles = null;
  }

  _setPrototypes(M) {
    const MatrixFlat = CONFIG.GeometryLib.MatrixFlat;
    const rotateM = MatrixFlat.empty(4, 4);
    const scaleM = MatrixFlat.empty(4, 4);
    const translateM = MatrixFlat.empty(4, 4);
    const squareM = MatrixFlat.empty(4, 4);
    const ctr = PIXI.Point._tmp3;

    // Polygon should already be counterclockwise.
    for ( const edge of this.polygon.iterateEdges({closed: true})) {
      // Rotate to match the edge angle.
      const delta = edge.B.subtract(edge.A, PIXI.Point._tmp3);
      const angle = Math.atan2(delta.y, delta.x);
      MatrixFlat.rotationZ(angle, true, rotateM);

      // Stretch to length of edge.
      const length = PIXI.Point.distanceBetween(edge.A, edge.B);
      MatrixFlat.scale(length, 1, 1, scaleM);

      // Move to edge center.
      // Also account for the stretching to length.
      edge.A.add(edge.B, ctr).multiplyScalar(0.5, ctr);
      MatrixFlat.translation(ctr.x, ctr.y, 0, translateM);

      // Determine the transform to move the unit vertical square to the polygon edge.
      scaleM.multiply4x4(rotateM, squareM).multiply4x4(translateM, squareM);
      if ( M ) squareM.multiply4x4(M, squareM);
      const sq = new SquareVerticalTriangles();
      sq.initialize(squareM);
      this.verticalSquares.push(sq);
    }
  }

  _initialize() {  } // Handled in _setPrototypes.

  update(M) { this.verticalSquares.forEach(s => s.update(M)); }
}

/**
 * Placeable represented as array of triangles, which are in fact an array of grouped
 * polygon triangles.
 * E.g., basic token would have a top polygon, bottom polygon, and group of vertical polygons.
 */
export class AbstractPlaceableTriangles {
  /** @type {PlaceableObject} */
  placeable;

  /** @type {AbstractPolygonTriangles[]} */
  _polygons = [];

  get polygons() { return this._polygons; }

  /** @type {Triangle[]} */
  get triangles() { return this.polygons.flatMap(poly => poly.triangles); };

  constructor(placeable) {
    this.placeable = placeable;
  }

  initialize() {
    this._setPrototypes();
    this._initialize();
  }

  _setPrototypes() {}

  /**
   * Initialize all polygons with the prototype scale, rotate, translate matrix.
   */
  _initialize() {
    const M = this.prototypeM;
    this.polygons.forEach(poly => poly.initialize(M));
  }

  /**
   * Update all polygons with the scale, rotate, translate matrix.
   */
  update() {
    const M = this.updateM;
    this.polygons.forEach(poly => poly.update(M));
  }

  /* ----- NOTE: Transform matrices ----- */

  /**
   * Translate matrix.
   * Should move prototype by its center point.
   * By default, is applied at the update stage.
   * @type {MatrixFlat<4x4>}
   */
  get translatePrototypeM() { return CONFIG.GeometryLib.MatrixFlat.identity(4); }

  _translateM = CONFIG.GeometryLib.MatrixFlat.identity(4);

  get translateM() {
    const elevationZ = this.placeable.elevationZ;
    const { x, y } = this.placeable.document;
    return CONFIG.GeometryLib.MatrixFlat.translation(x, y, elevationZ, this._translateM);
  }

  /**
   * Scale matrix.
   * Expands / shrinks prototype around 0,0,0.
   * By default, is applied at the initialization/prototype stage.
   * @type {MatrixFlat<4x4>}
   */
  get scalePrototypeM() { return CONFIG.GeometryLib.MatrixFlat.identity(4); }

  /**
   * Rotate matrix.
   * Should rotate prototype around 0,0,0.
   * By default, is applied at the initialization/prototype stage.
   * @type {MatrixFlat<4x4>}
   */
  get rotatePrototypeM() { return CONFIG.GeometryLib.MatrixFlat.identity(4); }

  /**
   * By default, this is just the translation matrix.
   * @type {MatrixFlat<4x4>}
   */
  get updateM() { return this.translateM; }

  /**
   * Transform matrix for the prototype object.
   * How to move the prototype triangles to the object position.
   * By default, assumes scale and rotate only.
   * @type {MatrixFlat<4x4>}
   */
  _prototypeM = CONFIG.GeometryLib.MatrixFlat.identity(4);

  get prototypeM() {
    return this.scalePrototypeM
      .multiply4x4(this.rotatePrototypeM, this._prototypeM)
      .multiply4x4(this.translatePrototypeM, this._prototypeM);
  }

  /* ----- Debug ----- */

  draw(opts) { this.polygons.forEach(poly => poly.draw(opts)); }

  drawPrototypes(opts) { this.polygons.forEach(poly => poly.drawPrototypes(opts)); }

  /**
   * Draw shape but swap z and y positions.
   */
  drawSplayed(opts) { this.polygons.forEach(poly => poly.drawSplayed(opts)); }

  drawPrototypesSplayed(opts) { this.polygons.forEach(poly => poly.drawPrototypesSplayed(opts)); }

}

export class DirectionalWallTriangles extends AbstractPlaceableTriangles {

  get wall() { return this.placeable; }

  /**
   * Define the prototypes for the wall. Vertical square set to correct width and heights,
   * centered at 0,0,0.
   */
  _setPrototypes() { this.polygons.push(new SquareVerticalTriangles()); }

  /**
   * Walls are not updated but rather rebuilt when moved.
   */
  update() { }

  /* ----- NOTE: Transformation matrices ----- */

  get translatePrototypeM() {
    // Move from the center point.
    const ctr = PIXI.Point._tmp3;
    const wall = this.wall;
    wall.edge.a.add(wall.edge.b, ctr).multiplyScalar(0.5, ctr);

    // Add in a translate to move back to 0,0 if the elevations do not match.
    let { top, bottom } = wall.edge.elevationLibGeometry.a;
    top ??= 1e06;
    bottom ??= -1e06;
    const z = top !== bottom ? bottom + ((top - bottom) * 0.5): 0;
    return CONFIG.GeometryLib.MatrixFlat.translation(ctr.x, ctr.y, z);
  }

  /**
   * Scale matrix
   * Scale the wall by its length from its center point.
   * And elevation by its top and bottom elevations.
   */
  get scalePrototypeM() {
    const wall = this.wall;
    const length = PIXI.Point.distanceBetween(wall.edge.a, wall.edge.b);
    let { top, bottom } = wall.edge.elevationLibGeometry.a;
    top ??= 1e06;
    bottom ??= -1e06;
    return CONFIG.GeometryLib.MatrixFlat.scale(length, 1, (top - bottom) * 0.5 || 1);
  }

  /**
   * Rotate matrix.
   * Rotate along the z axis to match the wall direction.
   */
  get rotatePrototypeM() {
    const edge = this.wall.edge;
    const delta = edge.b.subtract(edge.a, PIXI.Point._tmp3);
    const angle = Math.atan2(delta.y, delta.x);
    return CONFIG.GeometryLib.MatrixFlat.rotationZ(angle, true);
  }
}

export class WallTriangles extends DirectionalWallTriangles {
  /**
   * Define the prototypes for the wall. Vertical square set to correct width and heights,
   * centered at 0,0,0.
   */
  _setPrototypes() { this.polygons.push(new SquareVerticalDoubleTriangles()); }
}

export class TileTriangles extends AbstractPlaceableTriangles {

  /** @type {tile} */
  get tile() { return this.placeable; }

  /**
   * Define the prototypes for the tile. Flat square centered at 0, 0.
   */
  _setPrototypes() { this.polygons.push(new Square2dDoubleTriangles()); }

  /**
   * Move so that TL corner is at 0, 0.
   */
  get translatePrototypeM() {
    const { width, height } = this.tile.document;
    return CONFIG.GeometryLib.MatrixFlat.translation(width * 0.5, height * 0.5, 0);
  }

  /**
   * Scale the tile by its width and height
   */
  get scalePrototypeM() {
    const { width, height } = this.tile.document;
    return CONFIG.GeometryLib.MatrixFlat.scale(width, height, 1);
  }

  /**
   * Rotate the tile bounds according to its rotation value.
   */
  get rotatePrototypeM() {
    return CONFIG.GeometryLib.MatrixFlat.rotationZ(Math.toRadians(this.tile.document.rotation));
  }

  initialize() {
    super.initialize();

    // Add tile so alpha transparency can be tested for intersections.
    const tile = this.tile;
    this.polygons.forEach(poly => poly.triangles.forEach(tri => tri.tile = tile));
  }
}

export class TokenTriangles extends AbstractPlaceableTriangles {
  static LOCATIONS = {
    SIDES: 0,
    TOP: 1,
    BOTTOM: 2
  };

  // Pad (inset) to avoid triggering cover at corners. See issue 49.
  /** @type {number} */
  static pad = -2;

  /** @type {Token} */
  get token() { return this.placeable; }

  /** @type {Polygon2dTriangles|PolygonVerticalTriangles|Square2dTriangles} */
  get polygons() { return this.token.isConstrainedTokenBorder ? this._constrainedPolygons : this._polygons; }

  get sides() { return this.polygons[this.constructor.LOCATIONS.SIDES]; }

  get top() { return this.polygons[this.constructor.LOCATIONS.TOP]; }

  get bottom() { return this.polygons[this.constructor.LOCATIONS.BOTTOM]; }

  /** @type {PolygonVerticalTriangles|Square2dTriangles} */
  _polygons = Array(3);

  /** @type {PolygonVerticalTriangles|Polygon2dTriangles} */
  _constrainedPolygons = Array(3);

  /**
   * Define the prototypes for the placeable shape.
   * @override
   */
  _setPrototypes() {
    this._setUnconstrainedPrototypes();
    if ( this.token.isConstrainedTokenBorder ) this._setConstrainedPrototypes();
  }

  /**
   * Define the prototypes for the unconstrained token shape.
   *
   */
  _setUnconstrainedPrototypes() {
    const { SIDES, TOP, BOTTOM } = this.constructor.LOCATIONS;
    const token = this.token;
    const unconstrainedShape = token.tokenBorder.pad(this.constructor.PAD); // Token shape does not work prior to canvas ready
    this._polygons[SIDES] = new PolygonVerticalTriangles(unconstrainedShape);

    // Top and bottom are simpler if the shape is a rectangle.
    if ( unconstrainedShape instanceof PIXI.Rectangle ) {
      this._polygons[TOP] = new Square2dTriangles();
      this._polygons[BOTTOM] = new Square2dTriangles();
    } else {
      this._polygons[TOP] = new Polygon2dTriangles(unconstrainedShape);
      this._polygons[BOTTOM] = new Polygon2dTriangles(unconstrainedShape);
    }
  }

  /**
   * Define the constrained token shapes.
   */
  _setConstrainedPrototypes() {
    const { SIDES, TOP, BOTTOM } = this.constructor.LOCATIONS;
    const token = this.token;

    // Make a new shape so we can translate it. (Translate fails with the constrainedTokenBorder.)
    const constrainedBorder = (new PIXI.Polygon(token.constrainedTokenBorder.points)).pad(this.constructor.PAD);
    const constrainedShape = constrainedBorder.translate(-token.x, -token.y);
    this._constrainedPolygons[SIDES] = new PolygonVerticalTriangles(constrainedShape);
    this._constrainedPolygons[TOP] = new Polygon2dTriangles(constrainedShape);
    this._constrainedPolygons[BOTTOM] = new Polygon2dTriangles(constrainedShape);
  }

  /**
   * Initialize all polygons with the prototype scale, rotate, translate matrix.
   */
  _initialize() {
    this._initializePolyGroup(this._polygons);
    if ( this.token.isConstrainedTokenBorder ) this._initializePolyGroup(this._constrainedPolygons);
  }

  // Store the prototype matrices because they are reused during update of the constrained polygon.
  /** @type {MatrixFlat<4x4>} */
  _translateSidePrototypeM = CONFIG.GeometryLib.MatrixFlat.empty(4, 4);

  _scaleSidePrototypeM = CONFIG.GeometryLib.MatrixFlat.empty(4, 4);

  _topPrototypeM = CONFIG.GeometryLib.MatrixFlat.empty(4, 4);

  _sidePrototypeM = CONFIG.GeometryLib.MatrixFlat.empty(4, 4);

  _bottomPrototypeM = CONFIG.GeometryLib.MatrixFlat.empty(4, 4);

  /**
   * Initialize all polygons with the prototype scale, rotate, translate matrix.
   */
  _initializePolyGroup(polys) {
    const MatrixFlat = CONFIG.GeometryLib.MatrixFlat;
    const { SIDES, TOP, BOTTOM } = this.constructor.LOCATIONS;
    const { topZ, bottomZ } = this.token;

    const verticalHeight = topZ - bottomZ;

    // Side, top, and bottom shapes are all at TL = 0, 0.
    // Except for square top, bottom, which are centered at 0,0.
    // Side triangles are scaled by the token height and move so bottom is at elevation 0.
    // The start centered in the z direction but are scaled by height, so need to move up half-height
    MatrixFlat.translation(0, 0, verticalHeight * 0.5, this._translateSidePrototypeM)
    MatrixFlat.scale(1, 1, verticalHeight, this._scaleSidePrototypeM);
    this._scaleSidePrototypeM.multiply4x4(this._translateSidePrototypeM, this._sidePrototypeM);

    // Bottom is at elevation 0; top is at token height.
    // Must also move top and bottom so TL is 0, 0.
    if ( polys[TOP] instanceof Square2dTriangles ) {
      const { width, height } = this.token.document;
      const wSize = (width * canvas.dimensions.size) + this.constructor.PAD;
      const hSize = (height * canvas.dimensions.size) + this.constructor.PAD
      MatrixFlat.translation(wSize * 0.5, hSize * 0.5, verticalHeight, this._topPrototypeM);
      MatrixFlat.scale(wSize, hSize, 1, this._bottomPrototypeM);
      this._bottomPrototypeM.multiply4x4(this._topPrototypeM, this._topPrototypeM);
    } else {
      MatrixFlat.translation(0, 0, verticalHeight, this._topPrototypeM);
      MatrixFlat.identity(4, 4, this._bottomPrototypeM);
    }

    polys[SIDES].initialize(this._sidePrototypeM);
    polys[TOP].initialize(this._topPrototypeM);
    polys[BOTTOM].initialize(this._bottomPrototypeM);
  }

  /**
   * Update all polygons with the scale, rotate, translate matrix.
   */
  update() {
    const M = this.updateM;

    // If constrained, then rebuild the constrained polygon.
    // This assumes update only gets called when there is a token change.
    // Also assumes update would get called before switching from constrained to unconstrained
    // or vice-versa.
    // If update is getting called unnecessarily, caching would need to happen.
    if ( this.token.isConstrainedTokenBorder ) {
      this.initialize();
      this._constrainedPolygons.forEach(poly => poly.update(M));
    } else this._polygons.forEach(poly => poly.update(M)); // Unconstrained.
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
let { Triangle, DirectionalWallTriangles, WallTriangles, TileTriangles, TokenTriangles, PolygonVerticalTriangles, Polygon2dTriangles } = api.triangles

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
tokenTri = _token._atvShapeTriangles.triObject

*/
