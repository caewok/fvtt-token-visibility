/* globals
ClipperLib,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../../const.js";
import { Settings } from "../../settings.js";

// LOS folder
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { ObstacleOcclusionTest } from "../ObstacleOcclusionTest.js";
import { Camera } from "../Camera.js";
import { DebugVisibilityViewerArea3dPIXI } from "../DebugVisibilityViewer.js";
import { TokenGeometryTracker, LitTokenGeometryTracker, BrightLitTokenGeometryTracker } from "../placeable_tracking/TokenGeometryTracker.js";

// Debug
import { Draw } from "../../geometry/Draw.js";

export class PercentVisibleGeometricResult extends PercentVisibleResult {

  data = {
    blockingPaths: null,
    targetPaths: null,
    visibleTargetPaths: null,
  };

  get totalTargetArea() {
    if ( !~this.type ) return 1; // Not custom, so default to target area of 1.
    return Math.abs(this.data.targetPaths?.area || 1);
  }

  // Handled by the calculator, which combines multiple results.
  get largeTargetArea() { return this.totalTargetArea; }

  get visibleArea() {
    if ( !~this.type ) return this.type; // Not custom; either empty (0) or full (1).
    return Math.abs(this.data.visibleTargetPaths.area || 0);
  }

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
    const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;
    out = this.clone();
    out.data.targetPaths = ClipperPaths.combine([this.data.targetPaths, other.data.targetPaths]);
    out.data.visibleTargetPaths = ClipperPaths.combine([this.data.visibleTargetPaths, other.data.visibleTargetPaths]);
    return out;
  }
}

export class PercentVisibleCalculatorGeometric extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisibleGeometricResult;

  /** @type {Camera} */
  camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective",
    up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
    mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
  });

  /**
   * Scaling factor used with Clipper
   */
  static SCALING_FACTOR = 100;

  initializeCalculations() {
    super.initializeCalculations();
    this._initializeCamera();

    // Can build the obstacles now, as they will not change even if target shape does.
    this._constructPerspectiveObstaclePolygons();
    this._constructObstaclePaths();
  }

  _calculate() {
    this._constructPerspectiveTargetPolygons();
    this._constructTargetPath();
    this.lastResult.data.visibleTargetPaths = this.lastResult.data.blockingPaths.diffPaths(this.lastResult.data.targetPaths);
  }

  _initializeCamera() {
    this.camera.cameraPosition = this.viewpoint;
    this.camera.targetPosition = this.targetLocation;
    this.camera.setTargetTokenFrustum(this.target);
  }

  blockingTerrainPaths;

  _constructTargetPath() {
    // Once perspective-transformed, the token array of polygons are on the same plane, with z ~ 1.
    // Can combine to Polygons3d.
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const targetPolys3d = CONFIG.GeometryLib.threeD.Polygons3d.from3dPolygons(this.targetPolys);
    this.lastResult.data.targetPaths = targetPolys3d.toClipperPaths({ omitAxis: "z", scalingFactor })
  }

  /**
   *  Construct 2d perspective projection of each blocking points object.
   */
  _constructObstaclePaths() {
    // Use Clipper to calculate area of the polygon shapes.
    this.blockingTerrainPaths = this._combineTerrainPolys(this.blockingTerrainPolys);
    this.lastResult.data.blockingPaths = this._combineObstaclePolys();
    if ( this.blockingTerrainPaths && !this.blockingTerrainPaths.area.almostEqual(0) ) {
      if ( !this.lastResult.data.blockingPaths ) {
        this.lastResult.data.blockingPaths = this.blockingTerrainPaths.combine();
        console.warn(`${this.constructor.name}|_obscuredArea|No targetPaths for ${this.viewer.name} --> ${this.target.name}`);
      }
      else this.lastResult.data.blockingPaths = this.lastResult.data.blockingPaths.add(this.blockingTerrainPaths).union();
    }
  }

  /**
   * Each blocking polygon is either a Polygon3d or a Polygons3d.
   * Union each in turn.
   * @param {Polygon3d|Polygons3d} blockingPolys
   */
  _combineObstaclePolys() {
    const blockingPolys = this.blockingPolys;

    const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const n = blockingPolys.length;
    if ( !n ) return new ClipperPaths(undefined, { scalingFactor });

    const opts = { omitAxis: "z", scalingFactor };
    if ( n === 1 ) return blockingPolys[0].toClipperPaths(opts);

    // All the simple polygons can be unioned as one.
    const simplePolys = [];
    const complexPolys = [];
    blockingPolys.forEach(poly => {
      const arr = (poly instanceof CONFIG.GeometryLib.threeD.Polygons3d) ? complexPolys : simplePolys;
      arr.push(poly);
    });
    const nSimple = simplePolys.length;
    const nComplex = complexPolys.length;

    let solution;
    let i = 0;
    if ( !nSimple ) {
      // Must be at least one polygon here.
      i += 1;
      solution = ClipperPaths.clip(
      blockingPolys[0].toClipperPaths(opts),
      blockingPolys[1].toClipperPaths(opts),
      { clipType: ClipperLib.ClipType.ctUnion,
        subjFillType: ClipperLib.PolyFillType.pftPositive,
        clipFillType: ClipperLib.PolyFillType.pftPositive
      });
    }
    else if ( nSimple === 1 ) solution = simplePolys[0].toClipperPaths(opts);
    else solution = ClipperPaths.joinPaths(simplePolys.map(poly => poly.toClipperPaths(opts)));

    for ( ; i < nComplex; i += 1 ) {
     solution = ClipperPaths.clip(
      solution,
      complexPolys[i].toClipperPaths(opts),
      { clipType: ClipperLib.ClipType.ctUnion,
        subjFillType: ClipperLib.PolyFillType.pftPositive,
        clipFillType: ClipperLib.PolyFillType.pftPositive
      });
    }
    return solution.union();
  }

  /**
   * For each two polygons, find their intersection and return it as a clipper path.
   * @param {Polygon3d} blockingTerrainPolys
   * @returns {ClipperPaths}
   */
  _combineTerrainPolys() {
    const blockingTerrainPolys = this.blockingTerrainPolys;
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const blockingTerrainPaths = new CONFIG[MODULE_ID].ClipperPaths()

    // The intersection of each two terrain polygons forms a blocking path.
    // Only need to test each combination once.
    const nBlockingPolys = blockingTerrainPolys.length;
    if ( nBlockingPolys < 2 ) return null;
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
    return blockingTerrainPaths.union();
  }


  /**
   * Construct polygons that are used to form the 2d perspective.
   */
  targetPolys = [];

  blockingPolys = [];

  blockingTerrainPolys = [];

  _constructPerspectiveTargetPolygons() {
    const viewpoint = this.viewpoint
    const facingPolys = this._targetPolygons().filter(poly => poly.isFacing(viewpoint));
    this.targetPolys = this._applyPerspective(facingPolys, this.camera.lookAtMatrix, this.camera.perspectiveMatrix);

    // Test if the transformed polys are all getting clipped.
    const txPolys = facingPolys.map(poly => poly.transform(this.camera.lookAtMatrix));
    if ( txPolys.every(poly => poly.iteratePoints({close: false}).every(pt => pt.z > 0)) ) {
      console.warn(`_applyPerspective|All target z values are positive for ${this.viewer.name} --> ${this.target.name}`);
    }
  }

  _constructPerspectiveObstaclePolygons() {
    // Construct polygons representing the perspective view of the blocking objects.
    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;
    const { walls, terrainWalls, proximateWalls, reverseProximateWalls, tokens, tiles,  regions } = this.occlusionTester.obstacles;

    // If the proximity threshold is met, this edge excluded from perception calculations.
    const senseType = this.config.senseType;
    const viewpoint = this.viewpoint;
    proximateWalls.forEach(w => { if ( w.edge.applyThreshold(senseType, viewpoint) ) proximateWalls.delete(w); });
    reverseProximateWalls.forEach(w => { if ( w.edge.applyThreshold(senseType, viewpoint) ) proximateWalls.delete(w); });

    // Convert each blocking object shape to a perspective view from point-of-view of viewer's viewpoint.
    this.blockingPolys = [...walls, ...tiles, ...tokens, ...regions, ...proximateWalls, ...reverseProximateWalls].flatMap(obj =>
      this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));
    this.blockingTerrainPolys = [...terrainWalls].flatMap(obj =>
       this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));
  }

  /**
   * Construct target polygons.
   */
  _targetPolygons() {
    const atv = this.target[MODULE_ID];
    let geometry;
    switch ( this.config.tokenShapeType ) {
      case "tokenBorder": geometry = atv[TokenGeometryTracker.ID]; break;
      case "constrainedTokenBorder": geometry = atv[TokenGeometryTracker.ID]; break;
      case "litTokenBorder": geometry = atv[LitTokenGeometryTracker.ID]; break;
      case "brightLitTokenBorder": geometry = atv[BrightLitTokenGeometryTracker.ID]; break;
      default: console.error(`_targetPolygons|tokenShapeType ${this.config.tokenShapeType} not recognized.`);
    }
    return [...geometry.iterateFaces()];
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

  /* ----- NOTE: Debugging methods ----- */
  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(viewer, target, viewpoint, targetLocation, { draw, width = 100, height = 100 } = {}) {
    draw ??= new CONFIG.GeometryLib.Draw();

    // Recalculate the 3d objects
    this.initializeView({ viewer, target, viewpoint, targetLocation });
    this._constructPerspectiveTargetPolygons();
    this._constructPerspectiveObstaclePolygons();
    const { targetPolys, blockingPolys, blockingTerrainPolys } = this;
    const colors = Draw.COLORS;

    // Locate obstacles behind the target.
//     const frustum = ObstacleOcclusionTest.frustum.rebuild({ viewpoint, target });
//     const backgroundTiles = frustum.findBackgroundTiles();
    // const backgroundWalls = frustum.findBackgroundWalls();

    // TODO: Can we sort these based on a simplified depth test? Maybe use the z values after looking at them but before perspective?
    // Simpler:
    //   Mainly we are looking at approx. a 2d overhead view.
    //   So measure closest intersect to the vision triangle, testing edges and center.
    //   Test only the 2d line—wall or tile triangle.
    //   If no intersect, test from center of triangle.
    //   Or rather, just test lineLineIntersection against the 2 vision edges and take the closer.

//     const lookAtM = this.camera.lookAtMatrix;
//     const perspectiveM = this.camera.perspectiveMatrix;

 //    const backgroundPolys = [];
//     const { b, c } = frustum;
//     const b3d = new Point3d(b.x, b.y, targetLocation.z);
//     const c3d = new Point3d(c.x, c.y, targetLocation.z);
//
//     const dirs = [
//       b3d.subtract(viewpoint).normalize(),
//       c3d.subtract(viewpoint).normalize(),
//       targetLocation.subtract(viewpoint).normalize(),
//     ];

//     const backgroundTestFn = (placeable, color, fill) => {
//       const polys = ObstacleOcclusionTest.filterPlaceablePolygonsByViewpoint(placeable, viewpoint);
//       polys.forEach(poly => {
//         const ixs = [];
//         for ( const dir of dirs ) {
//           const ix = poly.intersection(viewpoint, dir);
//           if ( ix ) ixs.push(ix);
//         }
//         if ( !ixs.length ) ixs.push(poly.centroid);
//
//         const dist2 = ixs.reduce((acc, curr) => {
//           if ( !curr ) return acc;
//           return Math.min(acc, Point3d.distanceSquaredBetween(viewpoint, curr));
//         }, Number.POSITIVE_INFINITY);
//         poly = poly
//           .transform(lookAtM)
//           .clipZ()
//           .transform(perspectiveM);
//         backgroundPolys.push({
//           poly,
//           dist2,
//           color,
//           fill,
//         });
//       });
//     }
//
//     backgroundTiles.forEach(tile => backgroundTestFn(tile, colors.orange, colors.orange));
//     // backgroundWalls.forEach(wall => backgroundTestFn(wall, colors.gray, colors.gray));
//     backgroundPolys.sort((a, b) => b.dist2 - a.dist2); // Smallest last.
//     backgroundPolys.forEach(obj => obj.poly.scale({ x: width, y: height }).draw2d({ draw, color: obj.color, width: 2, fill: obj.fill, fillAlpha: 0.5 }));

    // const backgroundTilesPolys = [...backgroundTiles].flatMap(obj => this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));
    // const backgroundWallsPolys = [...backgroundWalls].flatMap(obj => this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));

    // backgroundTilesPolys.forEach(poly => draw.shape(poly.scale({ x: width, y: height }), { color: colors.orange, width: 2, fill: colors.orange, fillAlpha: 0.5 }))
    // backgroundWallsPolys.forEach(poly => draw.shape(poly.scale({ x: width, y: height }), { color: colors.gray, width: 2, fill: colors.gray, fillAlpha: 0.5 }))

    // Draw the target in 3d, centered at 0,0.
    // Scale the target graphics to fit in the view window.
    targetPolys.forEach(poly => poly.scale({ x: width, y: height }).draw2d({ draw, color: colors.red, width: 2, fill: colors.lightred, fillAlpha: 0.5 }));

    // Draw the grid shape.
    // TODO: Fix; use Polygon3d
    if ( this.config.largeTarget ) this._gridPolys.forEach(poly =>
      draw.shape(poly.scale({ x: width, y: height }), { color: colors.orange, fill: colors.lightorange, fillAlpha: 0.4 }));

    // Draw the detected obstacles.
    blockingPolys.forEach(poly => poly.scale({ x: width, y: height }).draw2d({ draw, color: colors.blue, fill: colors.lightblue, fillAlpha: 0.75 }));
    blockingTerrainPolys.forEach(poly => poly.scale({ x: width, y: height }).draw2d({ draw, color: colors.green, fill: colors.lightgreen, fillAlpha: 0.5 }));
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
ClipperPaths = CONFIG.GeometryLib.ClipperPaths
Clipper2Paths = CONFIG.GeometryLib.Clipper2Paths

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

calc.initializeView({ viewer: randal, target: zanna, viewpoint: Point3d.fromTokenCenter(randal), targetLocation: Point3d.fromTokenCenter(zanna) })
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
