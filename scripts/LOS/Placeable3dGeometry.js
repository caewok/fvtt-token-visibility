/* globals
canvas,
glMatrix,
PIXI
*/
"use strict";

import { Point3d } from "../geometry/3d/Point3d.js";

const vec3 = glMatrix.vec3;

class Placeable3dGeometry extends PIXI.Geometry {
  /** @type {PlaceableObject} */
  object;

  static NUM_VERTICES = 4;

  static colorVertices = [];

  static indices = [];

  constructor(object) {
    super();
    this.object = object;
    this.initializeObjectPoints();
    this.initializeVertices();
    this.initializeIndices();
    this.initializeColors(); // For debugging.
  }

  // Cache the object points
  objectPoints = [];

  /**
   * Build the set of 3d points used to frame the object.
   * Should be ordered so that outward faces are clockwise and consistent with indices.
   * @returns {Point3d[]}
   */
  constructObjectPoints() {
    console.error("Placeable3dGeometry|constructObjectPoints must be implemented by child class.");
  }

  initializeObjectPoints() { this.objectPoints = this.constructObjectPoints(); }

  // May be overriden by subclass to avoid building new Point3d.
  updateObjectPoints() { this.objectPoints = this.constructObjectPoints(); }

  initializeVertices() {
    this.addAttribute("aVertex", new Float32Array(this.constructor.NUM_VERTICES * 3));
    this.updateVertices();
  }

  updateVertices() {
    const objectVertices = this.objectPoints.map(pt => vec3.fromValues(pt.x, pt.y, pt.z));
    const buffer = this.getBuffer("aVertex");
    const data = buffer.data;
    objectVertices.forEach((v, idx) => data.set(v, idx * 3));
    buffer.update(data);
  }

  initializeIndices() {
    this.addIndex(this.constructor.indices);
  }

  initializeColors() { this.addAttribute("aColor", this.constructor.colorVertices, 3); }
}

export class Grid3dGeometry extends Placeable3dGeometry {
  static NUM_VERTICES = 8;

  static colorVertices = [
    // Top: Shades of orange
    1.0, 0.00, 0.0,
    1.0, 0.25, 0.0,
    1.0, 0.75, 0.0,
    1.0, 1.00, 0.0,

    // Bottom: Shades of blue
    0.0, 0.00, 1.0,
    0.0, 0.25, 1.0,
    0.0, 0.75, 1.0,
    0.0, 1.00, 1.0
  ];

  /*
   TL: 0, 4
   TR: 1, 5
   BR: 2, 6,
   BL: 3, 7

    TL --- TR
    |      |
    |      |
    BL --- BR
  */
  static indices = [
    // Top
    0, 1, 2, // TL - TR - BR
    0, 2, 3, // TL - BR - BL

    // Bottom
    4, 7, 6, // TL - BL - BR
    4, 6, 5, // TL - BR - TR

    // Sides (from top)
    0, 3, 7, // TL (top) - BL (top) - BL (bottom)
    0, 7, 4, // TL (top) - BL (bottom) - TL (bottom)

    1, 0, 4, // TR (top) - TL (top) - TL (bottom)
    1, 4, 5, // TR (top) - TL (bottom) - TR (bottom)

    2, 1, 5, // BR (top) - TR (top) - TR (bottom)
    2, 5, 6, // BR (top) - TR (bottom) - BR (bottom)

    3, 2, 6, // BL (top) - BR (top) - BR (bottom)
    3, 6, 7 // BL (top) - BR (bottom) - BL (bottom)
  ];

  static cubePoints(token) {
    // Construct a grid unit cube at the token center.
    const center = Point3d.fromTokenCenter(token);
    const size = canvas.dimensions.size;
    const size_1_2 = (size * 0.5) - 1; // Shrink by 1 pixel to avoid z-fighting if wall is at token edge.
    const elevationOffset = 1; // Shrink top/bottom by 1 pixel for same reason.
    const z = size_1_2 - elevationOffset;
    const pts = [
      new Point3d(-size_1_2, -size_1_2, z),
      new Point3d(size_1_2, -size_1_2, z),
      new Point3d(size_1_2, size_1_2, z),
      new Point3d(-size_1_2, size_1_2, z),

      new Point3d(-size_1_2, -size_1_2, -z),
      new Point3d(size_1_2, -size_1_2, -z),
      new Point3d(size_1_2, size_1_2, -z),
      new Point3d(-size_1_2, size_1_2, -z)
    ];

    pts.forEach(pt => center.add(pt, pt));
    return pts;
  }

  constructor(object) {
    super(object);
    this._updateTokenCenter();
  }

  // Cache the relevant token properties and update when the token is updated.
  #tokenCenter = new Point3d();

  _updateTokenCenter() { this.#tokenCenter = Point3d.fromTokenCenter(this.object); }

  constructObjectPoints() { return this.constructor.cubePoints(this.object); }

  updateObjectPoints() {
    const newCenter = Point3d.fromTokenCenter(this.object);
    const delta = newCenter.subtract(this.#tokenCenter);
    this.objectPoints.forEach(pt => pt.add(delta, pt));
    this._updateTokenCenter();
  }
}

export class Token3dGeometry extends Grid3dGeometry {

  static cubePoints(token) {
    const centerPts = Point3d.fromToken(token);
    const { width, height } = token.document;
    const w = width * canvas.dimensions.size;
    const h = height * canvas.dimensions.size;
    const w_1_2 = (w * 0.5) - 1;  // Shrink by 1 pixel to avoid z-fighting if wall is at token edge.
    const h_1_2 = (h * 0.5) - 1;  // (common with square grids)
    const elevationOffset = 1; // Shrink top/bottom by 1 pixel for same reason.
    return [
      centerPts.top.add(new Point3d(-w_1_2, -h_1_2, -elevationOffset)),
      centerPts.top.add(new Point3d(w_1_2, -h_1_2, -elevationOffset)),
      centerPts.top.add(new Point3d(w_1_2, h_1_2, -elevationOffset)),
      centerPts.top.add(new Point3d(-w_1_2, h_1_2, -elevationOffset)),

      centerPts.bottom.add(new Point3d(-w_1_2, -h_1_2, elevationOffset)),
      centerPts.bottom.add(new Point3d(w_1_2, -h_1_2, elevationOffset)),
      centerPts.bottom.add(new Point3d(w_1_2, h_1_2, elevationOffset)),
      centerPts.bottom.add(new Point3d(-w_1_2, h_1_2, elevationOffset))
    ];
  }

  constructor(object) {
    super(object);
    this._updateTokenSize();
  }

  _updateTokenSize() {
    const { width, height } = this.object.document;
    this.#tokenWidth = width;
    this.#tokenHeight = height;
  }

  #tokenWidth = 0;

  #tokenHeight = 0;

  updateObjectPoints() {
    // If token width or height has changed, rebuild the points.
    if ( this.object.document.width !== this.#tokenWidth
      || this.object.document.height !== this.#tokenHeight ) {

      this._updateTokenSize();
      this._updateTokenCenter();
      this.initializeObjectPoints();
    }
    super.updateObjectPoints();
  }
}

export class Wall3dGeometry extends Placeable3dGeometry {
  static NUM_VERTICES = 4;

  static colorVertices = [
    // Top: Shades of orange
    1.0, 0.00, 0.0,
    1.0, 0.25, 0.0,
    1.0, 0.75, 0.0,
    1.0, 1.00, 0.0
  ];

  /*
   TL: 0
   TR: 1
   BR: 2
   BL: 3

    TL --- TR
    |      |
    |      |
    BL --- BR
  */
  static indices = [
    // Top
    0, 1, 2, // TL - TR - BR
    0, 2, 3, // TL - BR - BL

    // Bottom
    0, 3, 2, // TL - BL - BR
    0, 2, 1 // TL - BR - TR
  ];

  constructObjectPoints() {
    const pts = Point3d.fromWall(this.object, { finite: true });
    return [
      pts.A.top,
      pts.B.top,
      pts.B.bottom,
      pts.A.bottom
    ];
  }
}

export class DirectionalWall3dGeometry extends Wall3dGeometry {
  /*
   TL: 0
   TR: 1
   BR: 2
   BL: 3

    TL --- TR
    |      |
    |      |
    BL --- BR
  */
  static indices = [
    // Top
    0, 1, 2, // TL - TR - BR
    0, 2, 3 // TL - BR - BL
  ];
}

export class Tile3dGeometry extends Wall3dGeometry {
  static uvs = [
    // Top, looking down
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1 // BL
  ];

  constructor(object) {
    super(object);
    this.initializeUVs();
  }

  initializeUVs() { this.addAttribute("aTextureCoord", this.constructor.uvs, 2); }

  constructObjectPoints() {
    const pts = Point3d.fromTile(this.object);
    return [
      pts.tl,
      pts.tr,
      pts.br,
      pts.bl
    ];
  }
}
