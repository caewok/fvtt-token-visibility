/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export class Frustum {
  /** @type {Float32Array4[6]} */
  planes = Array(6);

  /** @type {Point3d[8]} */
  static cornersNDC = [
    { x: -1, y: -1, z: -1 },
    { x: -1, y: -1, z: 1 },
    { x: -1, y: 1, z: -1 },
    { x: -1, y: 1, z: 1 },
    { x: 1, y: -1, z: -1 },
    { x: 1, y: -1, z: 1 },
    { x: 1, y: 1, z: -1 },
    { x: 1, y: 1, z: 1 },
  ];
  /* Sides
  // x
  0: 0,1,2,3
  1: 4,5,6,7

  // y
  2: 0,1,4,5
  3: 2,3,6,7

  // z
  4: 0,2,4,6
  5: 1,3,5,7
  */

  /**
   * Construct frustum from camera
   * @param {Camera} camera
   * @returns {Frustum}
   */
  static fromCamera(camera) {
    const frustum = new this();
    frustum.setFromCamera(camera);
    return frustum;
  }

  /** @type {Point3d[8]} */
  cornersWorld = []; // For drawing

  /**
   * Construct frustum from camera
   * @param {Camera} camera
   */
  setFromCamera(camera) {
    const Plane = CONFIG.GeometryLib.threeD.Plane;
    const M = camera.lookAtMatrix.multiply4x4(camera.perspectiveMatrix).invert();
    const cornersWorld = this.cornersWorld = this.constructor.cornersNDC.map(corner => M.multiplyPoint3d(corner))

    // Arrange corners such that any point inside tests positive using Plane.prototype.whichSide.
    // X faces
    this.planes[0] = Plane.fromPoints(cornersWorld[0], cornersWorld[1], cornersWorld[2]);
    this.planes[1] = Plane.fromPoints(cornersWorld[6], cornersWorld[5], cornersWorld[4]); // Flipped.

    // Y faces
    this.planes[2] = Plane.fromPoints(cornersWorld[4], cornersWorld[1], cornersWorld[0]); // Flipped.
    this.planes[3] = Plane.fromPoints(cornersWorld[2], cornersWorld[3], cornersWorld[6]);

    // Z faces
    this.planes[4] = Plane.fromPoints(cornersWorld[0], cornersWorld[2], cornersWorld[4]);
    this.planes[5] = Plane.fromPoints(cornersWorld[5], cornersWorld[3], cornersWorld[1]); // Flipped.
  }

  /**
   * Test if a single 3d point is inside the frustum.
   * @param {Point3d} pt
   * @returns {boolean} True if inside
   */
  pointInFrustum(pt) {
    for ( const plane of this.planes ) {
      if ( plane.whichSide(pt) < 0 ) return false;
    }
    return true;
  }

  /**
   * Test if a sphere is inside the frustum.
   * @param {Sphere} sphere
   * @returns {boolean} True if visible, false if culled.
   */
  sphereInFrustum(sphere) {
    if ( this.pointInFrustum(sphere.center) ) return true;
    for ( const plane of this.planes ) {
      // Test if sphere is outside but overlapping a frustum plane.
      // TODO: Would it be preferable to use ≤ ?
      if ( Math.abs(plane.distanceToPoint(sphere.center)) < sphere.radius ) return true;
    }
    return false;
  }

  edgeInFrustum(edge) {
    const elev = edge.elevationLibGeometry;
    const top = elev.a.top ?? 1e06;
    const bottom = elev.a.bottom ?? -1e06;

    // Two 3D rectangles intersect if any edge of one intersects the plane of the other,
    // or if any vertex of one is inside the other.

    // But for a wall, can treat as mostly 2-dimensional.

    // First, must overlap the

    // If any of the 4 vertices are in the frustum, the edge is in the frustum.
    const vertices = [
      new Point3d(edge.a.x, edge.a.y, top),
      new Point3d(edge.a.x, edge.a.y, bottom),
      new Point3d(edge.b.x, edge.b.y, top),
      new Point3d(edge.b.x, edge.b.y, bottom),
    ];
    if ( vertices.some(vertex => this.pointInFrustum(vertex)) ) return true;

    // If any of the 8 vertices of the frustum are inside the wall, they intersect.

    // If any edge of the wall rectangle intersects a frustum plane, they intersect.
    for ( const plane of this.planes ) {
      if ( plane.lineSegmentIntersects(vertices[0], vertices[1])
        || plane.lineSegmentIntersects(vertices[1], vertices[2])
        || plane.lineSegmentIntersects(vertices[2], vertices[3])
        || plane.lineSegmentIntersects(vertices[3], vertices[0]) ) return true;
    }

    // If any edge of the frustum intersects the wall plane, they intersect.
    const wallPlane = Plane.fromPoints(...vertices.slice(0, 3));
    for ( const )



    // Otherwise, edge not contained.

  }

  /**
   * @typedef {object}  MinMax
   * @prop {number} min
   * @prop {number} max
   */

  /**
   * Test if an AABB is inside the frustum.
   * @param {MinMax} xMinMax
   * @param {MinMax} yMinMax
   * @param {MinMax} zMinMax
   * @returns {boolean} True if visible, false if culled.
   */
//   aabbInFrustum({ xMinMax, yMinMax, zMinMax } = {}) {
//     xMinMax ??= { min: 0, max: 0 };
//     yMinMax ??= { min: 0, max: 0 };
//     zMinMax ??= { min: 0, max: 0 };
//     for ( const plane of this.planes ) {
//       const [a, b, c, d] = [...Object.values(plane.equation)];
//
//       // Find the diagonal points most aligned with the plane normal
//       const x = a > 0 ? xMinMax.max : xMinMax.min;
//       const y = b > 0 ? yMinMax.max : yMinMax.min;
//       const z = c > 0 ? zMinMax.max : zMinMax.min;
//
//       // Test the most negative point
//       if (((a * x) + (b * y) + (c * z) + d) < 0) return false;
//     }
//     return true;
//   }

  /**
   * Test if an AABB is inside the frustum.
   * @param {MinMax} xMinMax
   * @param {MinMax} yMinMax
   * @param {MinMax} zMinMax
   * @returns {boolean} True if visible, false if culled.
   */
//   aabbInFrustum2({ xMinMax, yMinMax, zMinMax } = {}) {
//     for ( const plane of this.planes ) {
//       if ( this._isAABBBehindPlane(xMinMax, yMinMax, zMinMax, plane) ) return false; // this._isAABBBehind is all false if not inside.
//     }
//     return true;
//   }

  /**
   * Test if an AABB is behind a plane.
   * @param {MinMax} xMinMax
   * @param {MinMax} yMinMax
   * @param {MinMax} zMinMax
   * @param {Plane} plane
   * @returns {boolean} True if visible, false if culled.
   */
  _isAABBBehindPlane(xMinMax, yMinMax, zMinMax, plane) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const vertices = [
      new Point3d(xMinMax.min, yMinMax.min, zMinMax.min),
      new Point3d(xMinMax.max, yMinMax.min, zMinMax.min),
      new Point3d(xMinMax.min, yMinMax.max, zMinMax.min),
      new Point3d(xMinMax.max, yMinMax.max, zMinMax.min),
      new Point3d(xMinMax.min, yMinMax.min, zMinMax.max),
      new Point3d(xMinMax.max, yMinMax.min, zMinMax.max),
      new Point3d(xMinMax.min, yMinMax.max, zMinMax.max),
      new Point3d(xMinMax.max, yMinMax.max, zMinMax.max),
    ];
    for ( const vertex of vertices ) {
      if ( plane.whichSide(vertex) >= 0 ) return false
    }
    return true; // All vertices are behind the plane.
  }

  edgeInFrustum(edge) { return this.aabbInFrustum(this.constructor.aabbForEdge(edge)); }

  wallInFrustum(wall) { return this.aabbInFrustum(this.constructor.aabbForWall(wall)); }

  tileInFrustum(tile) { return this.aabbInFrustum(this.constructor.aabbForTile(tile)); }

  tokenInFrustum(token) { return this.sphereInFrustum(Sphere.fromToken(token)); }

  /**
   * Calculate AABB for a wall
   * @param {Wall} wall
   * @returns {object}
   * - @prop {MinMax} xMinMax
   * - @prop {MinMax} yMinMax
   * - @prop {MinMax} zMinMax
   */
  static aabbForWall(wall) { return this.aabbForEdge(wall.edge); }

  /**
   * Calculate AABB for an edge
   * @param {Edge} edge
   * @returns {object}
   * - @prop {MinMax} xMinMax
   * - @prop {MinMax} yMinMax
   * - @prop {MinMax} zMinMax
   */
  static aabbForEdge(edge) {
    const elev = edge.elevationLibGeometry;
    return {
      xMinMax: Math.minMax(edge.a.x, edge.b.x),
      yMinMax: Math.minMax(edge.a.y, edge.b.y),
      zMinMax: Math.minMax(elev.a.top ?? 1e06, elev.a.bottom ?? -1e06),
    }
  }

  /**
   * Calculate AABB for a tile
   * @param {Tile} tile
   * @returns {object}
   * - @prop {MinMax} xMinMax
   * - @prop {MinMax} yMinMax
   * - @prop {MinMax} zMinMax
   */
  static aabbForTile(tile) {
    const { x, y, width, height } = tile.bounds;
    const z = tile.elevationZ;
    return {
      xMinMax: Math.minMax(x, x + width),
      yMinMax: Math.minMax(y, y + height),
      zMinMax: { min: z, max: z },
    }
  }

  draw2d() {
    Draw.connectPoints([cornersWorld[0], cornersWorld[1], cornersWorld[2], cornersWorld[3]], { color: Draw.COLORS.blue }) // Top?
    Draw.connectPoints([cornersWorld[4], cornersWorld[5], cornersWorld[6], cornersWorld[7]], { color: Draw.COLORS.blue }) // Bottom?

    Draw.connectPoints([cornersWorld[0], cornersWorld[1], cornersWorld[4], cornersWorld[5]], { color: Draw.COLORS.green }) // Right?
    Draw.connectPoints([cornersWorld[2], cornersWorld[3], cornersWorld[6], cornersWorld[7]], { color: Draw.COLORS.green }) // Left?

    Draw.connectPoints([cornersWorld[0], cornersWorld[2], cornersWorld[4], cornersWorld[6]], { color: Draw.COLORS.yellow }) // zNear
    Draw.connectPoints([cornersWorld[1], cornersWorld[3], cornersWorld[5], cornersWorld[7]], { color: Draw.COLORS.yellow }) // zFar

  }
}

export class Sphere {
  /** @type {Point3d} */
  center = new CONFIG.GeometryLib.threeD.Point3d();

  /** @type {number} */
  radius = 0;

  constructor(center, radius) {
    this.center.copyFrom(center);
    this.radius = radius
  }

  /**
   * Calculate bounding sphere for a token
   * @param {Token} token
   * @returns {Sphere}
   */
  static fromToken(token) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;

    // Token dimensions and position.
    const ctr = Point3d.fromTokenCenter(token);
    const width = token.document.width * canvas.dimensions.size;
    const height = token.document.height * canvas.dimensions.size;
    const zHeight = token.topZ - token.bottomZ;

    // Move half the width, height, and zHeight from the center to get to any corner.
    // For any given 3d rectangular cube, the distance to any corner from center is the same.
    const corner = Point3d._tmp3.set(width * 0.5, height * 0.5, zHeight * 0.5)
    ctr.add(corner, corner);
    return new this(ctr, Point3d.distanceBetween(ctr, corner));
  }

  draw2d(opts) {
    const Draw = CONFIG.GeometryLib.Draw;
    const cir = new PIXI.Circle(this.center.x, this.center.y, this.radius);
    Draw.shape(cir, opts);
  }
}

/* Testing
MODULE_ID = "tokenvisibility"
Draw = CONFIG.GeometryLib.Draw
MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32
Plane = CONFIG.GeometryLib.threeD.Plane
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
Camera = api.webgpu.Camera

viewer = _token
target = game.user.targets.first()


sphere = Sphere.fromToken(viewer)
sphere.draw2d({ color: Draw.COLORS.blue }) // Should be beyond the viewer at its max radius (middle)

camera = new Camera({
  glType: "webGL",
  perspectiveType: "perspective"
})

camera.cameraPosition = Point3d.fromTokenCenter(viewer)
camera.setTargetTokenFrustum(target) //  0.1954392975377097
camera.perspectiveParameters = {zFar: 1000}

frustum = new Frustum()
M = MatrixFloat32.identity(4)
M = camera.perspectiveMatrix.multiply4x4(camera.lookAtMatrix).invert()
frustum.setFromMatrix(M)

frustum.tokenInFrustum(_token)
frustum.tokenInFrustum(viewer)
frustum.tokenInFrustum(target)

frustum.wallInFrustum(canvas.walls.controlled[0])
frustum.tileInFrustum(canvas.tiles.controlled[0])

// Define other objects and test
dragonSphere = Sphere.fromToken(dragon)
dragonSphere.draw2d({ color: Draw.COLORS.blue })

frustum.tokenInFrustum(dragon)

frustum.wallInFrustum()


// See https://gamedev.stackexchange.com/questions/29999/how-do-i-create-a-bounding-frustum-from-a-view-projection-matrix
// Take the NDC space corners and convert back to world space.
cornersNDC = [
  new Point3d(-1, -1, -1), // LBB A
  new Point3d(-1, -1, 1),  // LBT B
  new Point3d(-1, 1, -1),  // LTB C
  new Point3d(-1, 1, 1),   // LTT D
  new Point3d(1, -1, -1),  // RBB E
  new Point3d(1, -1, 1),   // RBT F
  new Point3d(1, 1, -1),   // RTB G
  new Point3d(1, 1, 1),    // RTT H
];

/* Sides
// x
0: A,B,C,D
1: E,F,G,H

// y
2: A,B,E,F
3: C,D,G,H

// z
4: A,C,E,G
5: B,D,F,H

*/

zanna = _token
dragon = _token


cornersNDC = [
  new Point3d(-1, -1, -1), // LBB A
  new Point3d(-1, -1, 1),  // LBT B
  new Point3d(-1, 1, -1),  // LTB C
  new Point3d(-1, 1, 1),   // LTT D
  new Point3d(1, -1, -1),  // RBB E
  new Point3d(1, -1, 1),   // RBT F
  new Point3d(1, 1, -1),   // RTB G
  new Point3d(1, 1, 1),    // RTT H
];

M = camera.lookAtMatrix.multiply4x4(camera.perspectiveMatrix).invert();
cornersWorld = cornersNDC.map(corner => M.multiplyPoint3d(corner))
cornersWorld.forEach(corner => Draw.point(corner))

// Draw sides
Draw.connectPoints([cornersWorld[0], cornersWorld[1], cornersWorld[2], cornersWorld[3]], { color: Draw.COLORS.blue }) // Top?
Draw.connectPoints([cornersWorld[4], cornersWorld[5], cornersWorld[6], cornersWorld[7]], { color: Draw.COLORS.blue }) // Bottom?

Draw.connectPoints([cornersWorld[0], cornersWorld[1], cornersWorld[4], cornersWorld[5]], { color: Draw.COLORS.green }) // Right?
Draw.connectPoints([cornersWorld[2], cornersWorld[3], cornersWorld[6], cornersWorld[7]], { color: Draw.COLORS.green }) // Left?

Draw.connectPoints([cornersWorld[0], cornersWorld[2], cornersWorld[4], cornersWorld[6]], { color: Draw.COLORS.yellow }) // zNear
Draw.connectPoints([cornersWorld[1], cornersWorld[3], cornersWorld[5], cornersWorld[7]], { color: Draw.COLORS.yellow }) // zFar

// Construct plane for each side
// Each
planes = [
  Plane.fromPoints(cornersWorld[0], cornersWorld[2], cornersWorld[4]),
  Plane.fromPoints(cornersWorld[6], cornersWorld[5], cornersWorld[4]),

  Plane.fromPoints(cornersWorld[4], cornersWorld[1], cornersWorld[0]),
  Plane.fromPoints(cornersWorld[2], cornersWorld[3], cornersWorld[6]),

  Plane.fromPoints(cornersWorld[0], cornersWorld[2], cornersWorld[4]),
  Plane.fromPoints(cornersWorld[1], cornersWorld[3], cornersWorld[6]),
]

planes = [
  Plane.fromPoints(cornersWorld[0], cornersWorld[1], cornersWorld[2]),
  Plane.fromPoints(cornersWorld[4], cornersWorld[5], cornersWorld[6]),

  Plane.fromPoints(cornersWorld[0], cornersWorld[1], cornersWorld[4]),
  Plane.fromPoints(cornersWorld[2], cornersWorld[3], cornersWorld[6]),

  Plane.fromPoints(cornersWorld[0], cornersWorld[2], cornersWorld[4]),
  Plane.fromPoints(cornersWorld[1], cornersWorld[3], cornersWorld[5]),
]
planes.map(plane => plane.whichSide(camera.targetPosition))
planes.map(plane => plane.whichSide(Point3d.fromTokenCenter(zanna)))


planeEquations = planes.map(plane => plane.equation).map(plane => [...Object.values(plane)])

// See https://web.archive.org/web/20120531231005/http://crazyjoke.free.fr/doc/3D/plane%20extraction.pdf
// Construct normalized plane equations
faces = [
  [cornersWorld[0], cornersWorld[2], cornersWorld[4]],
  [cornersWorld[4], cornersWorld[5], cornersWorld[6]],
  [cornersWorld[0], cornersWorld[1], cornersWorld[4]],
  [cornersWorld[2], cornersWorld[3], cornersWorld[6]],
  [cornersWorld[0], cornersWorld[2], cornersWorld[4]],
  [cornersWorld[1], cornersWorld[3], cornersWorld[5]],
]

planes = faces.map(corners => {
  const [a, b, c] = corners;
  const vAB = b.subtract(a);
  const vAC = c.subtract(a);
  const normal = vAB.cross(vAC);
  const mag = normal.magnitude();
  const d = -normal.dot(a);
  return [normal.x / mag, normal.y / mag, normal.z / mag, d / mag];
})



M = camera.lookAtMatrix.multiply4x4(camera.perspectiveMatrix, M)
a = M.getIndex(3, 0) + M.getIndex(0, 0)
b = M.getIndex(3, 1) + M.getIndex(0, 1)
c = M.getIndex(3, 2) + M.getIndex(0, 2)
d = M.getIndex(3, 3) + M.getIndex(0, 3)
mag = (new Point3d(a, b, c)).magnitude()
tmp = { a: a / mag, b: b / mag, c: c / mag, d: d / mag }

a = M.getIndex(0, 3) + M.getIndex(0, 0)
b = M.getIndex(1, 3) + M.getIndex(1, 0)
c = M.getIndex(2, 3) + M.getIndex(2, 0)
d = M.getIndex(3, 3) + M.getIndex(3, 0)
mag = (new Point3d(a, b, c)).magnitude()
tmp = { a: a / mag, b: b / mag, c: c / mag, d: d / mag }


a = M.getIndex(0, 3) + M.getIndex(0, 0)
b = M.getIndex(1, 3) + M.getIndex(1, 0)
c = M.getIndex(2, 3) + M.getIndex(2, 0)
d = M.getIndex(3, 3) + M.getIndex(3, 0)

frustum = new Frustum()
frustum.planes = planeEquations

sphere = Sphere.fromToken(target)
sphere = Sphere.fromToken(zanna)
planes.map(plane => {
  const { a, b, c, d } = plane.equation;
  const { x, y, z } = sphere.center;
  return a * x + b * y + c * z + d;
  // return distance < -sphere.radius;
})

planes.map(plane => plane.whichSide(sphere.center))
planes.map(plane => plane.distanceToPoint(sphere.center))



frustum = new Frustum()
frustum.setFromCamera(camera)
frustum.draw2d()
frustum.pointInFrustum(camera.cameraPosition)
frustum.pointInFrustum(camera.targetPosition)
frustum.pointInFrustum(Point3d.fromTokenCenter(zanna))
frustum.tokenInFrustum(viewer)
frustum.tokenInFrustum(target)
frustum.tokenInFrustum(zanna)

frustum.aabbInFrustum(Frustum.aabbForWall(canvas.walls.controlled[0]))
frustum.aabbInFrustum2(Frustum.aabbForWall(canvas.walls.controlled[0]))

aabb = Frustum.aabbForWall(canvas.walls.controlled[0])
let { xMinMax, yMinMax, zMinMax } = aabb
vertices = [
  new Point3d(xMinMax.min, yMinMax.min, zMinMax.min),
  new Point3d(xMinMax.max, yMinMax.min, zMinMax.min),
  new Point3d(xMinMax.min, yMinMax.max, zMinMax.min),
  new Point3d(xMinMax.max, yMinMax.max, zMinMax.min),
  new Point3d(xMinMax.min, yMinMax.min, zMinMax.max),
  new Point3d(xMinMax.max, yMinMax.min, zMinMax.max),
  new Point3d(xMinMax.min, yMinMax.max, zMinMax.max),
  new Point3d(xMinMax.max, yMinMax.max, zMinMax.max),
];
for ( const vertex of vertices ) {
  if ( plane.whichSide(vertex) >= 0 ) return false
}


