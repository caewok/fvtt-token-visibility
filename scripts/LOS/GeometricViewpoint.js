/* globals
canvas,
ClipperLib,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";
import { AbstractPolygonTrianglesID, Grid3dTriangles } from "./PlaceableTriangles.js";
import { Camera } from "./Camera.js";
import { Polygons3d } from "./geometry/Polygon3d.js";
import { PercentVisibleCalculatorAbstract } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerArea3dPIXI } from "./DebugVisibilityViewer.js";


// Debug
import { Draw } from "../geometry/Draw.js";

const {
  TOTAL,
  OBSCURED,
//   BRIGHT,
//   DIM,
//   DARK,
} = PercentVisibleCalculatorAbstract.COUNT_LABELS;


/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class GeometricViewpoint extends AbstractViewpoint {
  static get calcClass() { return PercentVisibleCalculatorGeometric; }

  /* ----- NOTE: Debugging methods ----- */
  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(draw, _renderer, _container, { width = 100, height = 100 } = {}) {
    this.calculator._draw3dDebug(this.viewer, this.target, this.viewpoint, this.targetLocation, { draw, width, height });
  }
}

export class PercentVisibleCalculatorGeometric extends PercentVisibleCalculatorAbstract {
  static get viewpointClass() { return GeometricViewpoint; }

  static get POINT_ALGORITHMS() { return Settings.KEYS.LOS.TARGET.POINT_OPTIONS; }

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

  counts = new Float32Array(5);

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
    this._calculateObscuredArea();
  }

  _initializeCamera() {
    this.camera.cameraPosition = this.viewpoint;
    this.camera.targetPosition = this.targetLocation;
    this.camera.setTargetTokenFrustum(this.target);
  }

  targetPaths;

  blockingPaths;

  blockingTerrainPaths;

  _constructTargetPath() {
    // Once perspective-transformed, the token array of polygons are on the same plane, with z ~ 1.
    // Can combine to Polygons3d.
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const targetPolys3d = Polygons3d.from3dPolygons(this.targetPolys);
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
   * Construct 2d perspective projection of each blocking points object.
   * Combine them into a single array of blocking polygons.
   * For each visible side of the target, build the 2d perspective polygon for that side.
   * Take the difference between that side and the blocking polygons to determine the
   * visible portion of that side.
   * @returns {object} { obscuredSides: PIXI.Polygon[], sidePolys: PIXI.Polygon[]}
   *   sidePolys: The sides of the target, in 2d perspective.
   *   obscuredSides: The unobscured portions of the sidePolys
   */
  _calculateObscuredArea() {
    if ( !this.targetPaths ) {
      console.warn(`${this.constructor.name}|_obscuredArea|No targetPaths for ${this.viewer.name} --> ${this.target.name}`);
      this.counts[TOTAL] = 1;
      this.counts[OBSCURED] = 1;
    }

    // Construct the obscured shape by taking the difference between the target polygons and
    // the blocking polygons.
    this.counts[OBSCURED] = 0;
    this.counts[TOTAL] = Math.abs(this.targetPaths.area);
    if ( this.targetArea.almostEqual(0) ) return;
    if ( !this.blockingPaths ) {
      console.warn(`${this.constructor.name}|_obscuredArea|No blockingPaths for ${this.viewer.name} --> ${this.target.name}`);
      return;
    }
    const diff = this.blockingPaths.diffPaths(this.targetPaths); // TODO: Correct order?
    this.counts[OBSCURED] = Math.abs(diff.area);
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
      const arr = (poly instanceof Polygons3d) ? complexPolys : simplePolys;
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
    const { walls, tokens, tiles, terrainWalls, regions } = this.blockingObjects;
    this.blockingPolys = [...walls, ...tiles, ...tokens, ...regions].flatMap(obj =>
      this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));
    this.blockingTerrainPolys = [...terrainWalls].flatMap(obj =>
       this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));
  }

  /**
   * Construct target polygons.
   */
  _targetPolygons() {
    const litMethod = CONFIG[MODULE_ID].litToken;
    if ( this.config.testLighting
      && litMethod === CONFIG[MODULE_ID].litTokenOptions.CONSTRAIN ) return this.target[MODULE_ID][AbstractPolygonTrianglesID].litTriangles;
    if ( CONFIG[MODULE_ID].constrainTokens ) return this.target[MODULE_ID][AbstractPolygonTrianglesID].constrainedTriangles;
    return this.target[MODULE_ID][AbstractPolygonTrianglesID].triangles;
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
   * Constrained target area, counting both lit and unlit portions of the target.
   * Used to determine the total area (denominator) when useLitTarget config is set.
   * @returns {number}
   */
  _constrainedTargetArea() {
    const viewpoint = this.viewpoint
    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;

    // Set testLighting false so constrained border is used.
    const facingPolys = this._targetPolygons(false).filter(poly => poly.isFacing(viewpoint));
    const targetPolys = this._applyPerspective(facingPolys, lookAtM, perspectiveM);
    const targetPaths = targetPolys.toClipperPaths({ scalingFactor: this.constructor.SCALING_FACTOR });
    targetPaths.combine().clean();
    return targetPaths.area;
  }

  _gridPolygons(lookAtM, perspectiveM) {
    const target = this.target;
    const { x, y } = target.center;
    const z = target.bottomZ + (target.topZ - target.bottomZ);
    const translateM = CONFIG.GeometryLib.MatrixFlat.translation(x, y, z);
    const gridTris = Grid3dTriangles.trianglesForGridShape()
      .filter(tri => tri.isFacing(this.viewpoint))
      .map(tri => tri.transform(translateM));
    return this._applyPerspective(gridTris, lookAtM, perspectiveM);
  }

  /* ----- NOTE: Debugging methods ----- */
  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(viewer, target, viewpoint, targetLocation, { draw, width = 100, height = 100 } = {}) {
    draw ??= new CONFIG.GeometryLib.Draw();
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;

    // Recalculate the 3d objects
    this._calculatePercentVisible(viewer, target, viewpoint, targetLocation);
    const { targetPolys, blockingPolys, blockingTerrainPolys } = this._constructPerspectivePolygons();
    const colors = Draw.COLORS;

    // Locate obstacles behind the target.
    const visionTriangle = ObstacleOcclusionTest.visionTriangle.rebuild(viewpoint, target);
    const backgroundTiles = visionTriangle.findBackgroundTiles();
    // const backgroundWalls = visionTriangle.findBackgroundWalls();

    // TODO: Can we sort these based on a simplified depth test? Maybe use the z values after looking at them but before perspective?
    // Simpler:
    //   Mainly we are looking at approx. a 2d overhead view.
    //   So measure closest intersect to the vision triangle, testing edges and center.
    //   Test only the 2d line—wall or tile triangle.
    //   If no intersect, test from center of triangle.
    //   Or rather, just test lineLineIntersection against the 2 vision edges and take the closer.

    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;

    const backgroundPolys = [];
    const { b, c } = visionTriangle;
    const b3d = new Point3d(b.x, b.y, targetLocation.z);
    const c3d = new Point3d(c.x, c.y, targetLocation.z);

    const dirs = [
      b3d.subtract(viewpoint).normalize(),
      c3d.subtract(viewpoint).normalize(),
      targetLocation.subtract(viewpoint).normalize(),
    ];

    const backgroundTestFn = (placeable, color, fill) => {
      const polys = ObstacleOcclusionTest.filterPlaceablePolygonsByViewpoint(placeable, viewpoint);
      polys.forEach(poly => {
        const ixs = [];
        for ( const dir of dirs ) {
          const ix = poly.intersection(viewpoint, dir);
          if ( ix ) ixs.push(ix);
        }
        if ( !ixs.length ) ixs.push(poly.centroid);

        const dist2 = ixs.reduce((acc, curr) => {
          if ( !curr ) return acc;
          return Math.min(acc, Point3d.distanceSquaredBetween(viewpoint, curr));
        }, Number.POSITIVE_INFINITY);
        poly = poly
          .transform(lookAtM)
          .clipZ()
          .transform(perspectiveM);
        backgroundPolys.push({
          poly,
          dist2,
          color,
          fill,
        });
      });
    }

    backgroundTiles.forEach(tile => backgroundTestFn(tile, colors.orange, colors.orange));
    // backgroundWalls.forEach(wall => backgroundTestFn(wall, colors.gray, colors.gray));
    backgroundPolys.sort((a, b) => b.dist2 - a.dist2); // Smallest last.
    backgroundPolys.forEach(obj => obj.poly.scale({ x: width, y: height }).draw2d({ draw, color: obj.color, width: 2, fill: obj.fill, fillAlpha: 0.5 }));

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
  static viewpointClass = GeometricViewpoint;

  algorithm = Settings.KEYS.LOS.TARGET.TYPES.GEOMETRIC;
}
