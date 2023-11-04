/* globals
PIXI
*/
"use strict";

// Geometry folder
import { Draw } from "../../geometry/Draw.js";
import { Point3d } from "../../geometry/3d/Point3d.js";

/* Testing
api = game.modules.get('tokenvisibility').api;
Point3d = api.Point3d
PlanePoints3d = api.PlanePoints3d
drawing = api.drawing

points = [
 new PIXI.Point(0, 0),
 new PIXI.Point(500, 0),
 new PIXI.Point(500, 500),
 new PIXI.Point(0, 500)
]

points = [
 new PIXI.Point(0, 0),
 new PIXI.Point(500, 300),
 new PIXI.Point(500, 700),
 new PIXI.Point(0, 500)
]

// 3d
points = [
  new Point3d(0, 0, -200),
  new Point3d(500, 0, 200),
  new Point3d(500, 500, 200),
  new Point3d(0, 500, -200)
]

points = [
  new Point3d(0, 0, -200),
  new Point3d(500, 0, 100),
  new Point3d(500, 500, 200),
  new Point3d(0, 500, 100)
]

points = [
  new Point3d(0, 0, -200),
  new Point3d(500, 300, 200),
  new Point3d(500, 700, 200),
  new Point3d(0, 500, -200)
]

newPt = new points[0].constructor()
points[0].projectToAxisValue(points[1], 100, "x", newPt)

newPoints = PlanePoints3d.truncatePlanePoints(points, 200, "y")

newPoints = PlanePoints3d.truncatePlanePoints(points, 0, "z")

points.forEach(pt => Draw.point(pt))
newPoints.forEach(pt => Draw.point(pt, { color: Draw.COLORS.blue}))
*/

// Base class representing a plane in 3d as a set of points.
// (As opposed to the infinite Plane class.)
// Used for representing walls, tiles, drawings, token sides in 3d.
// Can set a view matrix and transform points accordingly.



/**
 * Represent a Foundry object as a set of 3d points
 */
export class PlanePoints3d {
  /** @type {Point3d[]} */
  points;

  /**
   * Points when a transform is set.
   * Due to truncation, may have more or less points than the points array.
   * @type {Point3d[]}
   */
  _tPoints = [];

  /**
   * Foundry object represented
   * @type {object}
   */
  object;

  /** @type {boolean} */
  viewIsSet;

  /** @type {Matrix} */
  M;

  /**
   * @param {object} object       Foundry placeable object class
   * @param {Point3d[]} points    Array of points
   */
  constructor(object, points = []) {
    this.object = object;
    this.points = points;

    // Ensure the points are Points3d
    const nPoints = points.length;
    for ( let i = 0; i < nPoints; i += 1 ) {
      const pt = points[i];
      if ( !(pt instanceof Point3d) ) points[i] = new Point3d(pt.x, pt.y, pt.z);
    }
  }

  /**
   * Ensure the view matrix is set before returning transformed points.
   * @type {Point3d[]}
   */
  get tPoints() {
    if ( !this.viewIsSet ) {
      if ( this.M ) this.setViewMatrix(this.M);
      else console.error("PlanePoints3d tPoints: view is not set.");
    }
    return this._tPoints;
  }

  /**
   * Iterate over the plane's edges in order.
   * @returns {{ A: Point3d, B: Point3d}} Return a segment for each edge
   * Edges link, such that edge0.B === edge.1.A.
   */
  *iterateEdges() {
    const points = this.points;
    const nPoints = points.length;
    let A = points[nPoints - 1];
    for ( const B of points ) {
      yield { A, B };
      A = B;
    }
  }

  /**
   * Set the view matrix used to transform the points.
   * @param {Matrix} M
   */
  setViewMatrix(M) {
    this.M = M;
    this._transform(M); // Sets _tPoints.
    this._truncatePlanePoints();
    this.viewIsSet = true;
  }

  _truncatePlanePoints() {
    // Truncate the points to be strictly less than 0 in the z direction.
    // (In front of, as opposed to behind, the viewer.)
    // Use -0.1 instead of 0 to avoid floating point errors near 0.
    const cmp = (a, b) => a < b;
    this._tPoints = PlanePoints3d.truncatePlanePoints(this._tPoints, -0.1, "z", cmp);
  }

  /**
   * Transform the points using a transformation matrix.
   * @param {Matrix} M
   */
  _transform(M) {
    const ln = this.points.length;
    for ( let i = 0; i < ln; i += 1 ) {
      this._tPoints[i] = M.multiplyPoint3d(this.points[i]);
    }
  }

  /**
   * Truncate a set of points representing a plane shape to keep only the points
   * below a given coordinate value. It is assumed that the shape can be closed by
   * getting lastPoint --> firstPoint.
   * @param {PIXI.Point[]|Point3d[]} points   Array of points for a polygon in clockwise order.
   * @param {number} cutoff                   Coordinate value cutoff
   * @param {string} coordinate               "x", "y", or "z"
   * @param {function} cmp                    Comparator. Return true to keep.
   *   Defaults to (coord, cutoff) => coord > cutoff
   * @returns {PIXI.Point[]|Point3d[]} The new set of points.
   */
  static truncatePlanePoints(points, cutoff, coordinate, cmp) {
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
   * For an array of 2d points, determine the area.
   * Same as ClipperLib.Clipper.Area.
   * @param {PIXI.Point[]} points
   * @returns {number} For y-axis downward (like Foundry), returns greater than 0 if clockwise.
   */
  static pointsArea2d(points) {
    const ln = points.length;
    if ( ln < 3 ) return 0;
    let a = 0;
    for ( let i = 0, j = ln - 1; i < ln; ++i) {
      a += (points[j].x + points[i].x) * (points[j].y - points[i].y);
      j = i;
    }
    return -a * 0.5;
  }

  /**
   * Transform the shape to a 2d perspective.
   * @returns {Point2d[]}
   */
  perspectiveTransform({ forceClockwise = true, multiplier = 1000 } = {}) {
    const out = this.tPoints.map(pt => PlanePoints3d.perspectiveTransform(pt, multiplier));
    if ( forceClockwise && PlanePoints3d.pointsArea2d(out) < 0 ) out.reverse();
    return out;
  }

  /**
   * Draw the shape on the 2d canvas
   */
  draw(drawingOptions = {}) {
    const drawTool = drawingOptions.drawTool ?? new Draw();
    this.points.forEach(pt => drawTool.point(pt, drawingOptions));
    const poly = new PIXI.Polygon(this.points);
    drawTool.shape(poly, drawingOptions);
  }

  /**
   * Draw the transformed shape.
   */
  drawTransformed({ drawTool, perspective = true, ...drawOpts } = {} ) {
    drawTool ??= new Draw();
    drawOpts.fill ??= drawOpts.color ?? Draw.COLORS.blue;
    const pts = perspective ? this.perspectiveTransform() : this.tPoints;
    const poly = new PIXI.Polygon(pts);
    drawTool.shape(poly, drawOpts);
  }

  /**
   * Convert a 3d point to 2d using a perspective transform by dividing by z.
   * @param {Point3d} pt
   * @param {number} multiplier    Multiplier for the point values.
   *  Used by Area3d to visualize the perspective transform
   * @returns {PIXI.Point}
   */
  static perspectiveTransform(pt, multiplier = 1000) {
    const mult = multiplier / -pt.z;
    return new PIXI.Point(pt.x * mult, pt.y * mult);
  }
}
