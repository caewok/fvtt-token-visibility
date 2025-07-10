/*Store geometry in placeables
--> Use abstract tracker to update the WebGL buffer without creating tons of copies.

Store:
- Triangle3d[]
- Polygon3d[] ?
- geom with vertices, indices, modelMatrix


Can we do token visibility testing entirely in JS but mimic WebGL?
1. For given token shape, transform all triangles (or polygons?) to camera view.
  - Skip triangles facing wrong direction
  - Calculate min/max viewport

2. Iterate over each pixel (e.g., fragment) in the viewport. If contained within token triangle(s), determine
   the frontmost triangle at that point. And determine where the fragment is located in 3d space.
  - Should be defined by barycentric coordinates for the given triangle.

3. Once the 3d location of the pixel is known, run intersection tests:
  - Line to each light / sound source
  - Line to camera.
  - For each line, filter potential obstacles using quad.
  - Test for intersections.
  - Order: first camera, then lighting if camera not blocked
  - Also determine whether dim/bright/dark (take maximum)

2 and 3 could be done using async. Or ideally, entire thing pushed to worker
*/

// Test calculating fragment 3d locations.
Draw = CONFIG.GeometryLib.Draw
api = game.modules.get("tokenvisibility").api
let { Polygon3d, Triangle3d, GeometryToken, BasicVertices, Camera, VisionTriangle } = api.geometry
AbstractViewpoint = api.AbstractViewpoint
Point3d = CONFIG.GeometryLib.threeD.Point3d
// camera = new Camera({
//     glType: "webGL2",
//     perspectiveType: "perspective",
//     up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
//     mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
//   });

viewer = _token
target = game.user.targets.first()


geomViewer = api.buildCustomLOSViewer(viewer, { viewpointClass: "los-algorithm-geometric" })
calc = geomViewer.calculator
camera = calc.camera
camera.cameraPosition = Point3d.fromTokenCenter(viewer);
camera.targetPosition = Point3d.fromTokenCenter(target);
calc.target = target
tris = calc._targetPolygons(false).filter(poly => poly.isFacing(camera.cameraPosition))

/**
 * Test if a barycentric coordinate is within its defined triangle.
 * @param {vec3} bary     Barycentric coordinate; x,y,z => u,v,w
 * @returns {bool} True if inside
 */
function barycentricPointInsideTriangle(bary) {
  return bary.y >= 0.0 && bary.z >= 0.0 && (bary.y + bary.z) <= 1.0;
}

class BaryTriangleData {

  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  v0 = new PIXI.Point();

  /** @type {PIXI.Point} */
  v1 = new PIXI.Point();

  /** @type {float} */
  d00 = 0.0;

  /** @type {float} */
  d01 = 0.0;

  /** @type {float} */
  d11 = 0.0;

  /** @type {float} */
  denomInv = 0.0;

  /**
   * @param {PIXI.Point} a
   * @param {PIXI.Point} b
   * @param {PIXI.Point} c
   */
  constructor(a, b, c) {
    a = this.a.copyFrom(a);
    const v0 = b.subtract(a, this.v0)
    const v1 = c.subtract(a, this.v1);
    const d00 = this.d00 = v0.dot(v0);
    const d01 = this.d01 = v0.dot(v1);
    const d11 = this.d11 = this.v1.dot(v1);
    this.denomInv = 1 / ((d00 * d11) - (d01 * d01));
  }

  /**
   * From a 3d triangle, ignoring the z axis.
   */
  static fromTriangle3d(tri3d) {
    return new this(tri3d.a.to2d(), tri3d.b.to2d(), tri3d.c.to2d());
  }
}

/**
 * Calculate barycentric position using fixed triangle data
 * @param {PIXI.Point} p
 * @param {BaryTriangleData} triData
 * @returns {vec3}
 */
function baryFromTriangleData(p, triData, outPoint) {
  outPoint ??= new CONFIG.GeometryLib.threeD.Point3d;
  const { a, v0, v1, d00, d01, d11, denomInv } = triData;
  const v2 = p.subtract(a, PIXI.Point._tmp3);
  const d02 = v0.dot(v2);
  const d12 = v1.dot(v2);

  const u = ((d11 * d02) - (d01 * d12)) * denomInv;
  const v = ((d00 * d12) - (d01 * d02)) * denomInv;
  const w = 1.0 - u - v;
  outPoint.set(u, v, w);
  return outPoint;
}

/**
 * Interpolate from values at the triangle vertices using a barycentric point.
 * @param {Point3d} bary
 * @param {float|PIXI.Point|Point3d} a
 * @param {float|PIXI.Point|Point3d} b
 * @param {float|PIXI.Point|Point3d} c
 * @returns {float|PIXI.Point|Point3d}
 */
function interpolateBarycentricValue(bary, a, b, c) {
  return bary.dot(CONFIG.GeometryLib.threeD.Point3d._tmp3.set(a, b, c));
}

/**
 * Interpolate from values at the triangle vertices using a barycentric point.
 * @param {Point3d} bary
 * @param {PIXI.Point|Point3d} a
 * @param {PIXI.Point|Point3d} b
 * @param {PIXI.Point|Point3d} c
 * @returns {PIXI.Point|Point3d}
 */
function interpolateBarycentricPoint(bary, a, b, c, outPoint) {
  outPoint ??= new a.constructor();
  a = a.multiplyScalar(bary.x);
  b = b.multiplyScalar(bary.y);
  c = c.multiplyScalar(bary.z);
  return a.add(b, outPoint).add(c, outPoint);
}


trisTransformed = tris.map(poly => {
  poly = poly.transform(camera.lookAtMatrix).clipZ();
  poly.transform(camera.perspectiveMatrix, poly);
  return poly;
})
trisTransformed.map(tri => tri.isValid())

// Transformed tris range from -1 to 1 in x,y directions.
// Scale and draw in 2d.
trisScaled = trisTransformed.map(tri => tri.multiplyScalar(1000))
trisScaled[0].draw2d({ color: Draw.COLORS.red })
trisScaled[1].draw2d({ color: Draw.COLORS.blue })
trisScaled[2].draw2d({ color: Draw.COLORS.green })
trisScaled[3].draw2d({ color: Draw.COLORS.yellow })

Draw.point(trisScaled[2].a)
Draw.point(trisScaled[2].b)
Draw.point(trisScaled[2].c)

// Now scale to X and determine what triangles are at each point.
SCALE = 50; // Will run from -50 to 50, or 100 pixels per row ( can drop 50, as contains should not use it)
trisScaled = trisTransformed.map(tri => tri.multiplyScalar(SCALE));

// Store bary data for triangle and an empty bary point to be filled later.
trisScaled.forEach((tri, idx) => {
  tri._original = tris[idx]
  tri._baryData = BaryTriangleData.fromTriangle3d(tri);
  tri._baryPoint = new CONFIG.GeometryLib.threeD.Point3d();
})
gridPt = new PIXI.Point()
pt3d = new CONFIG.GeometryLib.threeD.Point3d()

let numRed = 0;
let numDim = 0; // Not counting occluded from viewer
let numBright = 0; // Not counting occluded from viewer
let numOccluded = 0; // Occluded from viewer.
let numDark = 0; // Not counting occluded from viewer. Not occluded from light but beyond light radius.

viewerVisionTriangle = VisionTriangle.build(camera.cameraPosition, target, target.tokenBorder);
lightingVisionTriangles = canvas.lighting.placeables.map(light =>
  VisionTriangle.build(Point3d.fromPointSource(light), target, target.tokenBorder));

// viewerWalls = viewerVisionTriangle.
// lightingWalls = lightingVisionTriangles.map(tri => )

viewerWalls = AbstractViewpoint.findAllBlockingWalls(viewerVisionTriangle)
lightingWalls = lightingVisionTriangles.map(tri => AbstractViewpoint.findAllBlockingWalls(tri))
senseType = "sight";


for ( let x = -SCALE; x < SCALE; x += 1 ) {
  for ( let y = -SCALE; y < SCALE; y += 1 ) {
    // Use barycentric coordinates to test for containment.
    gridPt.set(x, y);
    trisScaled.forEach(tri => tri._baryPoint = baryFromTriangleData(gridPt, tri._baryData));
    const containingTris = trisScaled.filter(tri => barycentricPointInsideTriangle(tri._baryPoint));

    // If no containment, move to next.
    if ( !containingTris.length ) continue;

    // Simple shapes should have a single facing triangle but it is possible for there to be more than 1 at a given point.
    // Take the closest z.
    if ( containingTris.length > 1 ) containingTris.sort((a, b) => {
      const z0 = interpolateBarycentricValue(a._baryPoint, a.a.z, a.b.z, a.c.z);
      const z1 = interpolateBarycentricValue(a._baryPoint, a.a.z, a.b.z, a.c.z);
      return z0 - z1;
    });
    const containingTri = containingTris[0];

    // Determine the 3d point by interpolating from the original triangle.
    const { a, b, c } =  containingTri._original;
    interpolateBarycentricPoint(containingTri._baryPoint, a, b, c, pt3d);

    // Now we have a 3d point, compare to the viewpoint and lighting viewpoints to determine occlusion and bright/dim/dark
    numRed += 1;

    // Is it occluded from the camera/viewer?
    const rayOrigin = camera.cameraPosition
    const rayDirection = pt3d.subtract(rayOrigin); // NOTE: Don't normalize so the wall test can use 0 < t < 1.
    const isOccluded = wallsOcclude(rayOrigin, rayDirection, viewerWalls, senseType);
    if ( isOccluded ) continue;

    // Is it lit?

    isBright = false;
    isDim = false;
    const side = containingTri._original.plane.whichSide(camera.cameraPosition);
    for ( let i = 0, iMax = canvas.lighting.placeables.length; i < iMax; i += 1 ) {
      const light = canvas.lighting.placeables[i];
      const walls = lightingWalls[i];
      const lightPt = Point3d.fromPointSource(light);
      if ( (side * containingTri._original.plane.whichSide(lightPt)) < 0 ) {
        console.debug(`${x},${y}|${pt3d} is on oppositeSide of ${lightPt}`)
        continue; // On opposite side of the triangle from the camera.
      }
      const dist2 = Point3d.distanceSquaredBetween(pt3d, lightPt);
      if ( dist2 > (light.dimRadius ** 2) ) {
        console.debug(`${x},${y}|${pt3d} distance ${dist2} not within dim radius of ${light.dimRadius ** 2} ${lightPt}`)
        continue; // Not within light radius.
      }

      // If blocked, then not bright or dim.
      const rayOrigin = lightPt;
      const rayDirection = pt3d.subtract(rayOrigin); // NOTE: Don't normalize so the wall test can use 0 < t < 1.
      const isOccluded = wallsOcclude(rayOrigin, rayDirection, walls, senseType);
      if ( isOccluded ) continue;

      // TODO: handle light/sound attenuation from threshold walls.
      isBright ||= (dist2 <= (light.brightRadius ** 2));
      isDim ||= isBright || (dist2 <= (light.dimRadius ** 2));
      if ( isBright ) break; // Once we know a fragment is bright, we should know the rest.
    }
    numBright += isBright;
    numDim += isDim;
    numDark += !(isBright || isDim);
  }
}

tmpIx = new Point3d();

// See PointSourcePolygon.#calculateThresholdAttenuation
function attenuatedRadius() {

}

function wallsOcclude(rayOrigin, rayDirection, walls, senseType = "light") {
  const { Point3d, Plane }  = CONFIG.GeometryLib.threeD;
  const types = CONST.WALL_SENSE_TYPES;

  // TODO: Predefine Triangles.
  let limitedOcclusion = 0;
  for ( const wall of walls ) {
    if ( wall.document[senseType] === types.NONE ) continue;
    const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
    const t = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c)
      || Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri1.a, tri1.b, tri1.c);
    if ( t.between(0, 1, false) ) continue;
    switch ( wall.document[senseType] ) {
      case types.NORMAL: return true;
      case types.LIMITED: if ( limitedOcclusion++ ) return true; break;

      // See PointSourcePolygon.#calculateThresholdAttenuation
      case types.PROXIMITY:
      case types.REVERSE_PROXIMITY:
      {
        rayOrigin.add(rayDirection.multiplyScalar(t, tmpIx), tmpIx);
        if ( wall.edge.applyThreshold(senseType, rayOrigin) ) return true;
        break;
      }
    }
  }
  return false;
}





