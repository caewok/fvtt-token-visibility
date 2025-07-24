/* globals
ClipperLib,
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
    perspectiveType: "orthogonal",
    up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
    mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
  });

  #viewpoint = new CONFIG.GeometryLib.threeD.Point3d();

  get viewpoint() { return this.#viewpoint; }

  set viewpoint(value) {
    this.#viewpoint.copyFrom(value);
    this.occlusionTester._initialize(this.#viewpoint);
    this.camera.cameraPosition = this.#viewpoint;
  }

  #targetLocation = new CONFIG.GeometryLib.threeD.Point3d();

  get targetLocation() { return this.#targetLocation; }

  set targetLocation(value) {
    this.#targetLocation.copyFrom(value);
    this.camera.targetPostion = this.#targetLocation;
  }

  occlusionTester = new ObstacleOcclusionTest();

  /**
   * Determine the geometric shape remaining after viewing from the viewpoint.
   */
  calculate(polys3d) {
    // Set the camera frustum to include all the shapes.
    // TODO: Could set camera frustrum based on a center point or a target and then
    // could initialize camera and obstacles only once; calculate the target paths using _calculate.
    const bounds3d = CONFIG.GeometryLib.threeD.Polygons3d.combine3dBoundsForPolys(polys3d);
    this.camera.setTokenFrustumForBounds3d(bounds3d);

    this._constructPerspectiveObstaclePolygons();
    this._constructObstaclePaths();

    this._constructPerspectiveTargetPolygons(polys3d);
    this._constructTargetPath();
    return this.targetPaths.diffPaths(this.blockingPaths);
  }

  targetPaths;

  blockingPaths;

  blockingTerrainPaths;

  _constructTargetPath() {
    // Once perspective-transformed, the token array of polygons are on the same plane, with z ~ 1.
    // Can combine to Polygons3d.
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const targetPolys3d = CONFIG.GeometryLib.threeD.Polygons3d.from3dPolygons(this.targetPolys);
    this.targetPaths = targetPolys3d.toClipperPaths({ omitAxis: "z", scalingFactor })
  }


  /**
   *  Construct 2d perspective projection of each blocking points object.
   */
  _constructObstaclePaths() {
    // Use Clipper to calculate area of the polygon shapes.
    this.blockingTerrainPaths = this._combineTerrainPolys(this.blockingTerrainPolys);
    this.blockingPaths = this._combineObstaclePolys();
    if ( this.blockingTerrainPaths && !this.blockingTerrainPaths.area.almostEqual(0) ) {
      if ( !this.blockingPaths ) {
        this.blockingPaths = this.blockingTerrainPaths.combine();
        console.warn(`${this.constructor.name}|_obscuredArea|No targetPaths for ${this.viewer.name} --> ${this.target.name}`);
      }
      else this.blockingPaths = this.blockingPaths.add(this.blockingTerrainPaths).combine();
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
    return solution;
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
    return blockingTerrainPaths.combine();
  }


  /**
   * Construct polygons that are used to form the 2d perspective.
   */
  targetPolys = [];

  blockingPolys = [];

  blockingTerrainPolys = [];

  _constructPerspectiveTargetPolygons(polys3d) {
    this.targetPolys = this._applyPerspective(polys3d, this.camera.lookAtMatrix, this.camera.perspectiveMatrix);

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
    const { walls, tokens, tiles, terrainWalls, regions } = this.blockingObjects;
    this.blockingPolys = [...walls, ...tiles, ...tokens, ...regions].flatMap(obj =>
      this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));
    this.blockingTerrainPolys = [...terrainWalls].flatMap(obj =>
       this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));
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

  /**
   * @type {Point3d} center
   * @type {number} radius
   * @type {Polygon3d} poly3d
   * @returns {boolean}
   */
  static sphereIntersectsPolygon(center, radius, poly3d) {
    if ( poly3d.points.length < 3) {
      console.error("sphereIntersectsPolygon|Polygon must have at least 3 vertices.", poly3d);
      return false;
    }

    const distanceToPlane = poly3d.plane.distanceToPoint(center);
    if ( Math.abs(distanceToPlane) > sphere.radius ) return false;

  }
}

/** Testing
l = canvas.lighting.placeables[0]

Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
GeometricFaceCalculator = api.GeometricFaceCalculator
faces = _token.tokenvisibility.geometry.triangles

faceCalc = new GeometricFaceCalculator()
await faceCalc.initialize()
faceCalc.viewpoint = Point3d.fromPointSource(l)




*/

