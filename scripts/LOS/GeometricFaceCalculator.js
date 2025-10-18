/* globals
CONFIG,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";
import { Camera } from "./Camera.js";

/* FaceCalculator

Calculate the viewable parts of 1+ 3d planar shapes. E.g., Polygon3d.
From a given viewpoint.
*/

export class GeometricFaceCalculator {
  /**
   * Scaling factor used with Clipper
   */
  static SCALING_FACTOR = 100;

  static defaultConfiguration = {
    blocking: {
      walls: true,
      tiles: true,
      regions: true,
      tokens: {
        dead: false,
        live: false,
        prone: false,
      }
    },
    senseType: "sight", /** @type {CONST.WALL_RESTRICTION_TYPES} */
    useBrightRadius: false,
  };

  constructor(cfg = {}) {
    // Set default configuration first and then override with passed-through values.
    this.config = this.constructor.defaultConfiguration;
    this.config = cfg;
  }

  _config = {};

  get config() { return structuredClone(this._config); }

  set config(cfg = {}) { foundry.utils.mergeObject(this._config, cfg, { inplace: true}) }

  initialize() {
    this.occlusionTester._config = this._config; // Sync the configs.
  }

  /** @type {Camera} */
  camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective", // Would prefer orthogonal
    up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
    mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
  });

  #viewpoint = new CONFIG.GeometryLib.threeD.Point3d();

  get viewpoint() { return this.#viewpoint; }

  set viewpoint(value) {
    this.#viewpoint.copyFrom(value);
    this.camera.cameraPosition = this.#viewpoint;
    if ( this.#target ) this.occlusionTester._initialize(this.#viewpoint, this.#target);
  }

  #targetLocation = new CONFIG.GeometryLib.threeD.Point3d();

  #target;

  get target() { return this.#target; }

  set target(value) {
    this.#target = value;
    this.targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(this.#target);
    this.occlusionTester._initialize(this.#viewpoint, this.#target);
  }

  get targetLocation() { return this.#targetLocation; }

  set targetLocation(value) {
    this.#targetLocation.copyFrom(value);
    this.camera.targetPostion = this.#targetLocation;
  }

  clear() {
    this.#target = undefined;
  }

  occlusionTester = new ObstacleOcclusionTest();

  /**
   * Determine the geometric shape remaining after viewing from the viewpoint.
   */
  calculate(polys3d) {
    this._precalculate(polys3d);

    // In NDC space, the obstacles and the target polygons are on the same x/y plane.
    // (z values still distinguish their placement in 3d space)
    // For each target polygon, cut out the shadows of the obstacles in NDC space (on x/y plane).
    // Get the resulting NDC polygons and convert back.
    return this._calculateAllTargetPolygonsObstruction();
  }

  _precalculate(polys3d) {
    // Set the camera frustum to include all the shapes.
    const bounds3d = CONFIG.GeometryLib.threeD.AABB3d.union(...polys3d.map(poly3d => poly3d.aabb));
    this.camera.setFrustumForAABB3d(bounds3d);

    this._constructPerspectiveObstaclePolygons();
    this._constructObstaclePaths();

    this._constructPerspectiveTargetPolygons(polys3d);
  }

  _calculateAllTargetPolygonsObstruction(polys3d) {
    // In NDC space, the obstacles and the target polygons are on the same x/y plane.
    // (z values still distinguish their placement in 3d space)
    // For each target polygon, cut out the shadows of the obstacles in NDC space (on x/y plane).
    // Get the resulting NDC polygons and convert back.
    const out = Array(polys3d.length);
    let i = 0;
    const invModelM = this.camera.inverseModelMatrix;
    for ( const originalPoly3d of polys3d ) {
      const isFacing = originalPoly3d.isFacing(this.viewpoint);
      const ndcPolys = this._calculateTargetPolyObstruction(this.perspectivePolygons.targets[i]);
      const newPolys3d = ndcPolys.map(poly => {
        const newPoly = poly.transform(invModelM);
        newPoly.plane = originalPoly3d.plane;
        return newPoly;
      });
      out[i++] = { originalPoly3d, newPolys3d, isFacing, ndcPolys };
    }
    return out;
  }

  _calculateTargetPolyObstruction(perspectivePoly3d) {
    if ( !this.blockingPaths ) return [perspectivePoly3d];

    // Construct the shapes representing the 2d difference between the polygon and the obstacles.
    const { Triangle3d, Quad3d, Polygon3d, Point3d } = CONFIG.GeometryLib.threeD;
    const poly2d = perspectivePoly3d.toPolygon2d();
    // const path = ClipperPaths.fromPolygons([poly2d], { scalingFactor });
    // const unobscuredPath = this.blockingPaths.diffPaths(path);
    const unobscuredPath = this.blockingPaths.diffPolygon(poly2d);
    if ( unobscuredPath.area.almostEqual(0) ) return [];

    // Need to determine for each point of the 2d unobscured polygons where it intersects the poly3d plane.
    // Shoot a ray from the point toward the plane (away from the view)
    const unobscuredPolys = unobscuredPath.clean().toPolygons();
    const rayOrigin = Point3d.tmp;
    const rayDirection = Point3d.tmp.set(0, 0, -1);
    const polys = unobscuredPolys.map(unobscuredPoly => {
      const pts = [...unobscuredPoly.iteratePoints({ close: false })].map(pt2d => {
        rayOrigin.set(pt2d.x, pt2d.y, 1);
        const t = perspectivePoly3d.plane.rayIntersection(rayOrigin, rayDirection);
        if ( t === null ) {
          console.error("_calculateTargetPolyObstruction|ix not found", { perspectivePoly3d, unobscuredPoly, pt2d });
          return null;
        }
        const ix = new Point3d();
        return rayOrigin.add(rayDirection.multiplyScalar(t, ix), ix);
      }).filter(pt => Boolean(pt)); // Filter out nulls. TODO: Can this be skipped?

      let out;
      switch ( pts.length ) {
        case 3: out = Triangle3d.from3Points(...pts); break;
        case 4: out = Quad3d.from4Points(...pts); break;
        default: out = Polygon3d.from3dPoints(pts);
      }
      out.plane = perspectivePoly3d.plane;
      return out;
    });
    Point3d.release(rayOrigin, rayDirection);
    return polys;
  }




  blockingPaths;

  /**
   *  Construct 2d perspective projection of each blocking points object.
   */
  _constructObstaclePaths() {
    // Use Clipper to calculate area of the polygon shapes.
    const blockingTerrainPaths = this._combineTerrainPolys();
    this.blockingPaths = this._combineObstaclePolys();
    if ( blockingTerrainPaths ) {
      this.blockingPaths = this.blockingPaths ? this.blockingPaths.add(blockingTerrainPaths).combine()
        : blockingTerrainPaths.combine();
    }
  }

  /**
   * Each blocking polygon a Polygon3d
   * Union each in turn.
   * @returns {ClipperPaths|null}
   */
  _combineObstaclePolys() {
    // TODO: Trim proximate walls? Or already adequately dealt with by the ObstacleOcclusionTest?
    // TODO: Pull out tokens as distinct; possibly only reduce light instead of blocking?
    const blockingPolys = Object.values(this.perspectivePolygons.obstacles).flatMap(obj => obj);
    const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const n = blockingPolys.length;
    if ( !n ) return null;

    const opts = { omitAxis: "z", scalingFactor };
    if ( n === 1 ) return blockingPolys[0].toClipperPaths(opts);
    const out = ClipperPaths.joinPaths(blockingPolys.map(poly => poly.toClipperPaths(opts)));
    if ( out.area.almostEqual(0) ) return null;
    return out;
  }

  /**
   * For each two polygons, find their intersection and return it as a clipper path.
   * @param {Polygon3d} blockingTerrainPolys
   * @returns {ClipperPaths}
   */
  _combineTerrainPolys() {
    const blockingTerrainPolys = this.perspectivePolygons.obstacles.terrainWalls;
    const nBlockingPolys = blockingTerrainPolys.length;
    if ( nBlockingPolys < 2 ) return null; // A single terrain wall does not block.

    const scalingFactor = this.constructor.SCALING_FACTOR;
    const blockingTerrainPaths = new CONFIG[MODULE_ID].ClipperPaths()

    // The intersection of each two terrain polygons forms a blocking path.
    // Only need to test each combination once.
    for ( let i = 0; i < nBlockingPolys; i += 1 ) {
      const iPath = blockingTerrainPolys[i].toClipperPaths({ omitAxis: "z", scalingFactor });
      for ( let j = i + 1; j < nBlockingPolys; j += 1 ) {
        const jPath = blockingTerrainPolys[j].toClipperPaths({ omitAxis: "z", scalingFactor });
        const newPath = iPath.intersectPaths(jPath);
        if ( newPath.area.almostEqual(0) ) continue; // Skip very small intersections.
        blockingTerrainPaths.add(newPath);
      }
    }
    if ( !blockingTerrainPaths.paths.length ) return null;
    const out = blockingTerrainPaths.combine();
    if ( out.area.almostEqual(0) ) return null;
    return out;
  }


  /**
   * Construct polygons that are used to form the 2d perspective.
   */
  perspectivePolygons = {
    obstacles:  {
      walls: [],
      terrainWalls: [],
      proximateWalls: [],
      regions: [],
      tiles: [],
      tokens: [],
    },
    targets: [],
  }

  _constructPerspectiveTargetPolygons(polys3d) {
    this.perspectivePolygons.targets = this._applyPerspective(polys3d, this.camera.lookAtMatrix, this.camera.perspectiveMatrix);

    // Test if the transformed polys are all getting clipped.
    const txPolys = polys3d.map(poly => poly.transform(this.camera.lookAtMatrix));
    if ( txPolys.every(poly => poly.iteratePoints({close: false}).every(pt => pt.z > 0)) ) {
      console.warn(`_applyPerspective|All target z values are positive for ${this.viewer.name} --> ${this.target.name}`);
    }
  }

  _constructPerspectiveObstaclePolygons() {
    // Construct polygons representing the perspective view of the blocking objects.
    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;
    const perspectivePolygons = this.perspectivePolygons.obstacles;
    for ( const [key, arr] of Object.entries(this.occlusionTester.obstacles) ) {
      perspectivePolygons[key].length = 0;
      for ( const obj of arr ) {
        perspectivePolygons[key].push(...this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));
      }
    }
  }

  _lookAtObjectWithPerspective(object, lookAtM, perspectiveM) {
    const polys = ObstacleOcclusionTest.filterPlaceablePolygonsByViewpoint(object, this.viewpoint);
    return this._applyPerspective(polys, lookAtM, perspectiveM);
  }

  _applyPerspective(polys, lookAtM, perspectiveM) {
    // Save a bit of time by reusing the poly after the clipZ transform.
    // Don't reuse the initial poly b/c not guaranteed to be a copy of the original.
    return polys
      .map(poly => {
        poly = poly.transform(lookAtM).clipZ();
        poly.transform(perspectiveM, poly);
        return poly;
      })
      .filter(poly => poly.isValid());
  }
}

/** Testing
l = canvas.lighting.placeables[0]

Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
MODULE_ID = "tokenvisibility"
AbstractPolygonTrianglesID = "triangles"
api = game.modules.get(MODULE_ID).api
Camera = api.geometry.Camera
ObstacleOcclusionTest = api.ObstacleOcclusionTest
GeometricFaceCalculator = api.GeometricFaceCalculator

faceCalc = new GeometricFaceCalculator()
faceCalc.viewpoint = Point3d.fromPointSource(l)

faceCalc.perspectivePolygons.obstacles.walls.forEach(poly => poly.draw2d)
target = _token
faceCalc.target = target;
frustum = faceCalc.occlusionTester.constructor.frustum
frustum.draw2d()



// polys3d = target[MODULE_ID].geometry.sides.filter(side => side.isFacing(faceCalc.viewpoint))
polys3d = [...target[MODULE_ID].geometry.iterateFaces()]
bounds3d = CONFIG.GeometryLib.threeD.AABB3d.union(...polys3d.map(poly3d => poly3d.aabb));

faceCalc.camera.perspectiveType = "perspective" // Perspective is better b/c ortho does not capture as much of the obstacle blocking the target.
// faceCalc.camera.perspectiveType = "orthogonal"
// faceCalc.camera.setFrustumForAABB3d(bounds3d);
// faceCalc._constructPerspectiveObstaclePolygons();
// faceCalc._constructPerspectiveTargetPolygons(polys3d)

faceCalc._precalculate(polys3d)

targetFaces = faceCalc.perspectivePolygons.targets.map(poly => poly.multiplyScalar(100))
wallPoly = faceCalc.perspectivePolygons.obstacles.walls[0].multiplyScalar(100)
targetFaces.forEach(face => face.draw2d({ color: Draw.COLORS.red }))
wallPoly.draw2d({ color: Draw.COLORS.blue })

// res = faceCalc.calculate(polys3d)
faceCalc._precalculate(polys3d)
res = faceCalc._calculateAllTargetPolygonsObstruction(polys3d)

omitAxis = "z"
res.forEach(obj => {
  obj.ndcPolys.forEach(poly => poly.multiplyScalar(100).draw2d({ omitAxis }));
  obj.originalPoly3d.draw2d({ omitAxis, color: Draw.COLORS.orange })
  obj.newPolys3d.forEach(poly => poly.draw2d({ omitAxis, color: Draw.COLORS.red }))
})

*/

