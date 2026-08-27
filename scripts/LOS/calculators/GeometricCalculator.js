/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { Settings } from "../../settings.js";

// LOS folder
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerArea3dPIXI } from "../DebugVisibilityViewer.js";

// Geometry
import { GEOMETRY_LIB_ID } from "../../geometry/const.js";
import { Point3d } from "../../geometry/3d/Point3d.js";

// Debug
import { Draw } from "../../geometry/Draw.js";

export class PercentVisibleGeometricResult extends PercentVisibleResult {

  data = {
    blockingPaths: null,
    targetPaths: null,
    visibleTargetPaths: null,
  };

  clone() {
    const out = super.clone();
    for ( let i = 0, iMax = this.data.blockingPaths.length; i < iMax; i += 1 ) {
      if ( !this.data.blockingPaths[i] ) continue;
      out.data.blockingPaths[i] = this.data.blockingPaths[i].clone();
      out.data.targetPaths[i] = this.data.targetPaths[i].clone();
      out.data.visibleTargetPaths[i] = this.data.targetPaths[i].clone();
    }
    return out;
  }

  get visibleTargetPaths() {
    const data = this.data;
    if ( !data.visibleTargetPaths ) data.visibleTargetPaths = data.blockingPaths.diffPaths(data.targetPaths);
    return data.visibleTargetPaths;
  }

  get totalTargetArea() { return Math.abs(this.data.targetPaths?.area || 1); }

  // Handled by the calculator, which combines multiple results.
  get largeTargetArea() { return this.totalTargetArea; }

  get visibleArea() { return Math.abs(this.visibleTargetPaths.area || 0); }

  /**
   * Blend this result with another result, taking the maximum values at each test location.
   * Used to treat viewpoints as "eyes" in which 2+ viewpoints are combined to view an object.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMaximize(other) {
    let out = super.blendMaximize(other);
    if ( out ) return out;

    // Both types are custom.
    // The target area could change, given the different views.
    // Combine the visible target paths. Ignore blocking paths. (Union would minimize; intersect would maximize.)
    out = this.clone();
    out.data.targetPaths = this.data.targetPaths.union(other.data.targetPaths);
    out.data.visibleTargetPaths = this.data.visibleTargetPaths.union(other.data.visibleTargetPaths);
    return out;
  }
}

export class PercentVisibleCalculatorGeometric extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisibleGeometricResult;

  /**
   * Scaling factor used with Clipper
   */
  static SCALING_FACTOR = 1000;

  _calculate() {
    const result = super._calculate(); // Test radius between viewpoint and target.
    if ( result.visibility === PercentVisibleResult.VISIBILITY.NONE ) return result; // Outside of radius.
    result.visibility = PercentVisibleResult.VISIBILITY.MEASURED;

    this.constructPerspectivePolygons();
    result.data.targetPaths = this._constructTargetClipperPaths();
    result.data.blockingPaths = this._constructObstacleClipperPaths();

    // console.debug(`${this.constructor.name}|visibility ${result.percentVisible}`);
    return result;
  }

  /**
   * Iterate each face in the target shape.
   * @yield {Polygon3d|Sphere}
   */
  *iterateTargetFaces() {
    const vp = this.viewpoint;
    for ( const face of this.targetShape.iterateFaces() ) {
      if ( face.isFacing(vp) ) yield face;
    }
  }

  /**
   * Iterate solid obstacle faces, including tiles but excluding terrain walls.
   * Presumes the occlusion tester has been appropriately updated.
   * @yield {Polygon3d|Sphere}
   */
  *iterateSolidObstacleFaces() {
    const ot = this.occlusionTester;
    const excludedObstacles = new Set(["terrainWalls"]);
    let includeObstacles = ot.constructor.OBSTACLE_KEYS.difference(excludedObstacles);
    yield* this._iterateFacesForObstacles({ includeObstacles, geomSubType: "subtype" });
  }

  /**
   * Iterate terrain (limited wall) faces.
   * Presumes the occlusion tester has been appropriately updated.
   * @yield {Quad3d}
   */
  *iterateTerrainObstacleFaces() {
    const includeObstacles = new Set(["terrainWalls"]);
    yield* this._iterateFacesForObstacles({ includeObstacles });
  }

  /**
   * Helper to iterate shapes for a given occlusion tester options.
   * @param {object} opts     Passed to ot.iterateObstacleShapes
   * @yields {Polygon3d} Face of each shape in turn
   */
  *_iterateFacesForObstacles(opts) {
    for ( const shape of this.occlusionTester.iterateObstacleShapes(opts) ) {
      yield* this._iterateFacesForObstacleShape(shape);
    }
  }

  /**
   * Helper to iterate faces, ignoring those facing away from the viewpoint.
   * @param {GeometricPrimitive} shape
   * @yields {Polygon3d}
   */
  *_iterateFacesForObstacleShape(shape) {
    const dir = shape.direction;
    if ( !dir ) yield* shape.iterateFaces();
    else {
      const vp = this.viewpoint;
      for ( const face of shape.iterateFaces() ) {
        if ( dir * face.plane.whichSide(vp) < 0 ) continue;
        yield face;
      }
    }
  }

  /**
   * Apply the look at and transform matrix to a given face.
   * @param {Polygon3d|Sphere}
   * @returns {Polygon3d}
   */
  applyPerspectiveToFace(poly) {
    // Save a bit of time by reusing the poly after the clipZ transform.
    // Don't reuse the initial poly b/c not guaranteed to be a copy of the original.
    const { lookAtMatrix, perspectiveMatrix} = this.camera;
    poly = poly.transform(lookAtMatrix).clipZ();
    poly.clean();
    if ( !poly.isValid() ) return poly;

    poly.transform(perspectiveMatrix, poly);
    return poly;
  }

  /* ----- NOTE: Perspective polygons ----- */

  // Take target and obstacle shapes and transform to a 2d (flat) camera perspective view.

  /**
   * Construct polygons that are used to form the 2d perspective.
   */
  targetPolys = [];

  solidObstaclePolys = [];

  terrainObstaclePolys = [];

  constructPerspectivePolygons() {
    this.targetPolys.length = 0;
    this.solidObstaclePolys.length = 0;
    this.terrainObstaclePolys.length = 0;

    for ( const face of this.iterateTargetFaces() ) {
      const txPoly = this.applyPerspectiveToFace(face);
      if ( txPoly.isValid() ) this.targetPolys.push(txPoly);
    }

    for ( const face of this.iterateSolidObstacleFaces() ) {
      const txPoly = this.applyPerspectiveToFace(face);
      if ( txPoly.isValid() ) this.solidObstaclePolys.push(txPoly);
    }

    for ( const face of this.iterateTerrainObstacleFaces() ) {
      const txPoly = this.applyPerspectiveToFace(face);
      if ( txPoly.isValid() ) this.terrainObstaclePolys.push(txPoly);
    }
  }

  /* ----- NOTE: Clipper paths ----- */

  // For the various polygons, combine into clipper paths so PercentVisibleGeometricResult
  // can calculate area.
  // Once perspective-transformed, the target array of polygons are approximately on the same plane, with z ~ 1.

  get clipperOpts() {
    // For spheres (transformed to circle3d/ellipse3d), set density based on target radius.
    const density = PIXI.Circle.approximateVertexDensity(this.targetRadius);
    return {
      omitAxis: "z",
      scalingFactor: this.constructor.SCALING_FACTOR,
      density
    };
  }

  get targetRadius() {
    const aabb = this.targetShape.aabb;
    return Point3d.distanceBetween(aabb.max, aabb.min) * 0.5;
  }

  _constructTargetClipperPaths() {
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    return ClipperPaths
      .joinPaths(this.targetPolys.map(poly3d => poly3d.toClipperPaths(this.clipperOpts)))
      .clean()
      .combine(); // Could use union, but the target has no holes so combine is preferable.
  }

  _constructObstacleClipperPaths() {
    const terrainObstaclePaths = this._combineTerrainObstaclePolys();
    let solidObstaclePaths = this._combineObstaclePolys();
    if ( terrainObstaclePaths && !terrainObstaclePaths.area.almostEqual(0) ) {
      if ( !solidObstaclePaths ) {
        solidObstaclePaths = terrainObstaclePaths.combine();
        console.warn(`${this.constructor.name}|_obscuredArea|No targetPaths.`);
      }
      else solidObstaclePaths = solidObstaclePaths.add(terrainObstaclePaths).union();
    }
    return solidObstaclePaths;
  }

  _combineObstaclePolys() {
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths
    const n = this.solidObstaclePolys.length;
    if ( !n ) return new ClipperPaths(undefined, { scalingFactor: this.constructor.SCALING_FACTOR });
    if ( n === 1 ) return this.solidObstaclePolys[0].toClipperPaths(this.clipperOpts);
    return ClipperPaths
      .joinPaths(this.solidObstaclePolys.map(poly3d => poly3d.toClipperPaths(this.clipperOpts)))
      .clean()
      .union();
  }

  _combineTerrainObstaclePolys() {
    const ClipperPaths = CONFIG.GeometryLib.CONFIG.ClipperPaths;
    const opts = this.clipperOpts;
    const terrainObstaclePolys = this.terrainObstaclePolys;
    const terrainPaths = new ClipperPaths()

    // The intersection of each two terrain polygons forms a blocking path.
    // Only need to test each combination once.
    const nBlockingPolys = terrainObstaclePolys.length;
    if ( nBlockingPolys < 2 ) return null;
    for ( let i = 0; i < nBlockingPolys; i += 1 ) {
      const iPath = terrainObstaclePolys[i].toClipperPaths(opts);
      for ( let j = i + 1; j < nBlockingPolys; j += 1 ) {
        const jPath = terrainObstaclePolys[j].toClipperPaths(opts);
        const newPath = iPath.intersectPaths(jPath);
        if ( newPath.area.almostEqual(0) ) continue; // Skip very small intersections.
        terrainPaths.add(newPath);
      }
    }
    if ( !terrainPaths.paths.length ) return null;
    return terrainPaths.clean().union();
  }

  /* ----- NOTE: Debugging methods ----- */
  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(result, draw, { width = 100, height = 100 } = {}) {
    const { targetPolys, solidObstaclePolys, terrainObstaclePolys } = this;
    const colors = Draw.COLORS;

    // Draw the target in 3d, centered at 0,0.
    // Scale the target graphics to fit in the view window.
    targetPolys.forEach(poly => poly.scale({ x: width, y: height }).draw2d({ draw, color: colors.red, width: 2, fill: colors.lightred, fillAlpha: 0.5 }));

    // Draw the grid shape.
    // TODO: Fix; use Polygon3d
    /*
    if ( this._config.largeTarget ) this._gridPolys.forEach(poly =>
      draw.shape(poly.scale({ x: width, y: height }), { color: colors.orange, fill: colors.lightorange, fillAlpha: 0.4 }));
    */

    // Draw the detected obstacles.
    solidObstaclePolys.forEach(poly => poly.scale({ x: width, y: height }).draw2d({ draw, color: colors.blue, fill: colors.lightblue, fillAlpha: 0.75 }));
    terrainObstaclePolys.forEach(poly => poly.scale({ x: width, y: height }).draw2d({ draw, color: colors.green, fill: colors.lightgreen, fillAlpha: 0.5 }));
  }
}

export class DebugVisibilityViewerGeometric extends DebugVisibilityViewerArea3dPIXI {
  algorithm = Settings.KEYS.LOS.TARGET.TYPES.GEOMETRIC;
}


/* Test

MODULE_ID = "tokenvisibility"
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
Plane = CONFIG.GeometryLib.threeD.Plane
ClipperPaths = CONFIG.GeometryLib.CONFIG.ClipperPaths
Clipper2Paths = CONFIG.GeometryLib.CONFIG.Clipper2Paths

QBenchmarkLoop = CONFIG.GeometryLib.bench.QBenchmarkLoop;
QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn;
QBenchmarkLoopFnWithSleep = CONFIG.GeometryLib.bench.QBenchmarkLoopFnWithSleep
extractPixels = CONFIG.GeometryLib.utils.extractPixels
GEOMETRY_ID = "_atvPlaceableGeometry";
MatrixFlat = CONFIG.GeometryLib.MatrixFlat
MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32
Area3dPopout = api.Area3dPopout
Area3dPopoutCanvas = api.Area3dPopoutCanvas
Settings = api.Settings
let { DocumentUpdateTracker, TokenUpdateTracker } = api;

zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")
randal = canvas.tokens.placeables.find(t => t.name === "Randal")
buildDebugViewer = api.buildDebugViewer

calc = new api.calcs.geometric();

calc.setView({ viewer: randal, target: zanna, viewpoint: Point3d.fromTokenCenter(randal), targetLocation: Point3d.fromTokenCenter(zanna) })
calc.calculate()
calc.percentVisible

calc.lastResult.data.

targetPolys = calc.lastResult.data.targetPaths.toPolygons()
obstaclePolys = calc.lastResult.data.blockingPaths.union().toPolygons()
visiblePolys = calc.lastResult.data.blockingPaths.union().diffPaths(calc.lastResult.data.targetPaths).toPolygons()

targetPolys.forEach(poly => poly.points = poly.points.map(elem => elem * 100))
obstaclePolys.forEach(poly => poly.points = poly.points.map(elem => elem * 100))
visiblePolys.forEach(poly => poly.points = poly.points.map(elem => elem * 100))

targetPolys.forEach(poly => Draw.shape(poly, { fill: Draw.COLORS.red, fillAlpha: 0.5 }))
obstaclePolys.forEach(poly => Draw.shape(poly, { fill: Draw.COLORS.blue, fillAlpha: 0.5 }))
visiblePolys.forEach(poly => Draw.shape(poly, { fill: Draw.COLORS.green, fillAlpha: 0.5 }))


blockingPolys = calc.lastResult.data.blockingPaths.intersectPaths(calc.lastResult.data.targetPaths)

tPaths2 = Clipper2Paths.fromPolygons()
oPaths2 = Clipper2Paths.fromPolygons(obstaclePolys)
blockingPaths2 = tPaths2.intersectPaths(oPaths2.union())
vPaths2 = tPaths2.diffPaths(oPaths2.union())

bPolys = blockingPaths2.toPolygons()
vPolys = vPaths2.toPolygons()
bPolys.forEach(poly => Draw.shape(poly, { fill: Draw.COLORS.orange, fillAlpha: 0.5 }))
vPolys.forEach(poly => Draw.shape(poly, { fill: Draw.COLORS.green, fillAlpha: 0.5 }))
*/
