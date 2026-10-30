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
import { NULL_SET } from "../../geometry/util.js";

// Debug
import { Draw } from "../../geometry/Draw.js";

export class PercentVisibleGeometricResult extends PercentVisibleResult {

  data = {
    blockingPaths: null,          // Union of solid (fully opaque) obstacles.
    targetPaths: null,            // Target shape.
    visibleTargetPaths: null,     // Target not covered by a solid obstacle (lazy).
    layers: null,                 // [{ paths, transmittance }], one per partially opaque obstacle.
    visiblePieces: null,          // [{ paths, T }]: visible target split by transmittance (lazy).
  };

  clone() {
    // Does not call super: structuredClone would strip the Clipper classes.
    const out = new this.constructor();
    out.config = structuredClone(this.config);
    out.visibility = this.visibility;
    const { targetPaths, blockingPaths, visibleTargetPaths, layers } = this.data;
    const d = out.data;
    d.targetPaths = targetPaths?.clone() ?? null;
    d.blockingPaths = blockingPaths?.clone() ?? null;
    d.visibleTargetPaths = visibleTargetPaths?.clone() ?? null;
    d.layers = layers?.map(l => ({ paths: l.paths.clone(), transmittance: l.transmittance })) ?? null;
    return out;
  }

  get visibleTargetPaths() {
    const data = this.data;
    if ( !data.visibleTargetPaths ) data.visibleTargetPaths = data.blockingPaths.diffPaths(data.targetPaths);
    return data.visibleTargetPaths;
  }

  /**
   * @typedef {object} TransmittancePiece
   * @prop {ClipperPaths} paths         Union of 1+ obstacles
   * @prop {number} T                   Transmittance for this unioned obstacles
   */

  /**
   * Visible target split into pieces by accumulated transmittance.
   * Each layer splits every piece into the part inside it (T x layer transmittance) and the part outside (T).
   * Overlapping layers therefore multiply: two 50% layers pass 25%.
   * @returns {TransmittancePiece[]}
   */
  get visiblePieces() {
    const data = this.data;
    if ( data.visiblePieces ) return data.visiblePieces;
    let pieces = [{ paths: this.visibleTargetPaths, T: 1 }];
    for ( const { paths: layerPaths, transmittance } of data.layers ?? [] ) {
      const next = [];
      for ( const { paths, T } of pieces ) {
        const inside = layerPaths.intersectPaths(paths);
        if ( !Math.abs(inside.area || 0) ) {
          next.push({ paths, T });
          continue; // Layer misses this piece.
        }
        next.push({ paths: inside, T: T * transmittance });
        const outside = layerPaths.diffPaths(paths); // piece minus layer
        if ( Math.abs(outside.area || 0) ) next.push({ paths: outside, T });
      }
      pieces = this.constructor._mergeByTransmittance(next);
    }
    return (data.visiblePieces = pieces);
  }

  /**
   * Union pieces that share a transmittance, which keeps the piece count small.
   * @param {TransmittancePiece[]} pieces
   * @returns {TransmittancePiece[]} The unioned layers, by transmittance value.
   */
  static _mergeByTransmittance(pieces) {
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const byT = new Map();
    for ( const piece of pieces ) {
      const key = Math.round(piece.T * 1000);
      const arr = byT.get(key);
      if ( arr ) arr.push(piece);
      else byT.set(key, [piece]);
    }
    const out = [];
    for ( const arr of byT.values() ) {
      if ( arr.length === 1 ) out.push(arr[0]);
      else out.push({ paths: ClipperPaths.joinPaths(arr.map(p => p.paths)).union(), T: arr[0].T });
    }
    return out;
  }

  get totalTargetArea() { return Math.abs(this.data.targetPaths?.area || 1); }

  get largeTargetArea() { return this.totalTargetArea; }

  get visibleArea() {
    if ( !this.data.layers?.length ) return Math.abs(this.visibleTargetPaths.area || 0);
    return this.visiblePieces.reduce((sum, { paths, T }) => sum + (Math.abs(paths.area || 0) * T), 0);
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

    // Weighted layers cannot be blended by unioning paths. Keep whichever view sees more.
    if ( this.data.layers?.length || other.data.layers?.length ) {
      return (this.percentVisible >= other.percentVisible ? this : other).clone();
    }

    // Both types are custom.
    // The target area could change, given the different views.
    // Combine the visible target paths. Ignore blocking paths. (Union would minimize; intersect would maximize.)
    out = this.clone();
    out.data.targetPaths = out.data.targetPaths.union(other.data.targetPaths);
    out.data.visibleTargetPaths = out.data.visibleTargetPaths.union(other.data.visibleTargetPaths);
    return out;
  }
}

export class PercentVisibleCalculatorGeometric extends PercentVisibleCalculatorAbstract {

  /** @type {class} */
  static resultClass = PercentVisibleGeometricResult;

  /** Weights by opacity itself, so Viewpoint skips its proration fallback. */
  static handlesOpacity = true;

  /**
   * Scaling factor used with Clipper
   */
  static SCALING_FACTOR = 1000;

  _calculate() {
    const result = super._calculate(); // Test radius between viewpoint and target.
    if ( result.visibility === PercentVisibleResult.VISIBILITY.NONE ) return result; // Outside of radius.
    result.visibility = PercentVisibleResult.VISIBILITY.MEASURED;

    // Split obstacles by opacity. Terrain (limited) walls keep their pairwise-overlap logic and stay solid.
    const { partial, nonBlocking } = this.partiallyBlockingObstacles();
    const layered = partial.filter(e => e.subtype !== "terrainWalls");
    const excluded = new Set([...layered, ...nonBlocking].map(e => e.obstacle));

    this.constructPerspectivePolygons(excluded, layered);
    result.data.targetPaths = this._constructTargetClipperPaths();
    result.data.blockingPaths = this._constructObstacleClipperPaths();
    result.data.layers = this._constructLayers();
    return result;
  }

  /**
   * Iterate each face in the target shape.
   * @yields {Polygon3d|Sphere} Face of the geom.
   */
  *iterateTargetFaces() {
    const vp = this.viewpoint;
    for ( const face of this.targetShape.faces ) {
      if ( face.isFacing(vp) ) yield face;
    }
  }

  /**
   * Iterate over the solid obstacles.
   * @param {Set<string>} excluded          Excluded geometry obstacles
   * @yields {Polygon3d} Face of the geom
   */
  *iterateSolidObstacleFaces(excluded = NULL_SET) {
    const ot = this.occlusionTester;
    const includeObstacles = ot.constructor.OBSTACLE_KEYS.difference(new Set(["terrainWalls"]));
    yield* this._iterateFacesForGeoms(ot.iterateObstacleGeoms({ includeObstacles }), excluded);
  }

  /**
   * Iterate over the terrain obstacles.
   * @param {Set<string>} excluded          Excluded geometry obstacles
   * @yields {Polygon3d} Face of the geom
   */
  *iterateTerrainObstacleFaces(excluded = NULL_SET) {
    const ot = this.occlusionTester;
    const includeObstacles = new Set(["terrainWalls"]);
    yield* this._iterateFacesForGeoms(ot.iterateObstacleGeoms({ includeObstacles }), excluded);
  }

  /**
   * All geom faces
   * @param {PlaceableGeometry[]} geoms     Geometries to iterate over
   * @param {Set<string>} excluded          Excluded geometry obstacles
   * @yields {Polygon3d} Face of the geom
   */
  *_iterateFacesForGeoms(geoms, excluded) {
    for ( const geom of geoms ) {
      if ( !excluded.has(geom) ) yield* this._iterateFacesForGeom(geom);
    }
  }

  /**
   * Faces of one obstacle geometry.
   * @param {PlaceableGeometry} geom
   * @yields {Polygon3d} Face of the geom
   */
  *_iterateFacesForGeom(geom) {
    const shapes = geom.constructor.HAS_SUBTYPES ? geom.calculated.shapes : geom.shapes;
    for ( const shape of shapes ) yield* this._iterateFacesForObstacleShape(shape);
  }

  /**
   * Helper to iterate faces, ignoring those facing away from the viewer.
   * @param {GeometricPrimitive} shape
   * @yields {Polygon3d}
   */
  *_iterateFacesForObstacleShape(shape) {
    const dir = shape.direction;
    if ( !dir ) yield* shape.faces;
    else {
      const vp = this.viewpoint;
      for ( const face of shape.faces ) {
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
    const { lookAtMatrix, invTransposeLookAtMatrix} = this.camera;
    poly = poly.transform(lookAtMatrix, invTransposeLookAtMatrix).clipZ();
    poly.clean();
    if ( !poly.isValid() ) return poly;

    const { perspectiveMatrix, invTransposePerspectiveMatrix } = this.camera;
    return poly.transform(perspectiveMatrix, invTransposePerspectiveMatrix);
  }

  /* ----- NOTE: Perspective polygons ----- */

  // Take target and obstacle shapes and transform to a 2d (flat) camera perspective view.

  /**
   * Construct polygons that are used to form the 2d perspective.
   */

  /** @type {Polygon3d[]} */
  targetPolys = [];

  /** @type {Polygon3d[]} */
  solidObstaclePolys = [];

  /** @type {Polygon3d[]} */
  terrainObstaclePolys = [];

  /** @type {{polys: Polygon3d[], opacity: number}[]} One entry per partially opaque obstacle. */
  layerPolys = [];

  constructPerspectivePolygons(excluded = NULL_SET, layered = []) {
    this.targetPolys.length = 0;
    this.solidObstaclePolys.length = 0;
    this.terrainObstaclePolys.length = 0;
    this.layerPolys.length = 0;

    for ( const face of this.iterateTargetFaces() ) {
      const txPoly = this.applyPerspectiveToFace(face);
      if ( txPoly.isValid() ) this.targetPolys.push(txPoly);
    }

    for ( const face of this.iterateSolidObstacleFaces(excluded) ) {
      const txPoly = this.applyPerspectiveToFace(face);
      if ( txPoly.isValid() ) this.solidObstaclePolys.push(txPoly);
    }

    for ( const face of this.iterateTerrainObstacleFaces(excluded) ) {
      const txPoly = this.applyPerspectiveToFace(face);
      if ( txPoly.isValid() ) this.terrainObstaclePolys.push(txPoly);
    }

    for ( const { obstacle, opacity } of layered ) {
      const polys = [];
      for ( const face of this._iterateFacesForGeom(obstacle) ) {
        const txPoly = this.applyPerspectiveToFace(face);
        if ( txPoly.isValid() ) polys.push(txPoly);
      }
      if ( polys.length ) this.layerPolys.push({ polys, opacity });
    }
  }

  /**
   * One layer per partial obstacle: the union of its own faces in perspective, with its transmittance.
   * @returns {{paths: ClipperPaths, transmittance: number}[]}
   */
  _constructLayers() {
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const opts = this.clipperOpts;
    const layers = [];
    for ( const { polys, opacity } of this.layerPolys ) {
      const paths = polys.length === 1
        ? polys[0].toClipperPaths(opts)
        : ClipperPaths.joinPaths(polys.map(poly => poly.toClipperPaths(opts))).clean().union();
      if ( Math.abs(paths.area || 0) ) layers.push({ paths, transmittance: 1 - opacity });
    }
    return layers;
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

    this.layerPolys.forEach(({ polys, opacity }) => polys.forEach(poly =>
      poly.scale({ x: width, y: height }).draw2d({ draw, color: colors.orange, fill: colors.orange, fillAlpha: 0.75 * opacity })));
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
