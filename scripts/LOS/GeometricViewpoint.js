/* globals
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
import { Grid3dTriangles  } from "./PlaceableTriangles.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Camera } from "./WebGPU/Camera.js";
import { Polygons3d } from "./Polygon3d.js";
import { PercentVisibleCalculatorAbstract } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerArea3dPIXI } from "./DebugVisibilityViewer.js";

// Debug
import { Draw } from "../geometry/Draw.js";

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
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const { viewpoint, target, targetLocation, calculator } = this;

    // Recalculate the 3d objects.
    const { targetPolys, blockingPolys, blockingTerrainPolys } = calculator._constructPerspectivePolygons();
    const colors = Draw.COLORS;

    // Locate obstacles behind the target.
    const visionTriangle = AbstractViewpoint.visionTriangle.rebuild(viewpoint, target);
    const backgroundTiles = visionTriangle.findBackgroundTiles();
    const backgroundWalls = visionTriangle.findBackgroundWalls();

    // TODO: Can we sort these based on a simplified depth test? Maybe use the z values after looking at them but before perspective?
    // Simpler:
    //   Mainly we are looking at approx. a 2d overhead view.
    //   So measure closest intersect to the vision triangle, testing edges and center.
    //   Test only the 2d line—wall or tile triangle.
    //   If no intersect, test from center of triangle.
    //   Or rather, just test lineLineIntersection against the 2 vision edges and take the closer.

    const lookAtM = calculator.camera.lookAtMatrix;
    const perspectiveM = calculator.camera.perspectiveMatrix;

    const backgroundPolys = [];
    const { b, c } = visionTriangle;
    const b3d = new Point3d(b.x, b.y, targetLocation.z);
    const c3d = new Point3d(c.x, c.y, targetLocation.z);

    const dirs = [
      b3d.subtract(viewpoint).normalize(),
      c3d.subtract(viewpoint).normalize(),
      this.viewerLOS.targetCenter.subtract(viewpoint).normalize(),
    ];

    const backgroundTestFn = (placeable, color, fill) => {
      const polys = AbstractViewpoint.filterPlaceablePolygonsByViewpoint(placeable, viewpoint);
      polys.forEach(poly => {
        const ixs = [];
        for ( const dir of dirs ) {
          const ix = poly.intersection(viewpoint, dir);
          if ( ix ) ixs.push(ix);
        }
        if ( !ixs.length ) ixs.push(poly.centroid());

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
    backgroundWalls.forEach(wall => backgroundTestFn(wall, colors.gray, colors.gray));
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
    if ( this.config.largeTarget ) calculator._gridPolys.forEach(poly =>
      draw.shape(poly.scale({ x: width, y: height }), { color: colors.orange, fill: colors.lightorange, fillAlpha: 0.4 }));

    // Draw the detected obstacles.
    blockingPolys.forEach(poly => poly.scale({ x: width, y: height }).draw2d({ draw, color: colors.blue, fill: colors.lightblue, fillAlpha: 0.75 }));
    blockingTerrainPolys.forEach(poly => poly.scale({ x: width, y: height }).draw2d({ draw, color: colors.green, fill: colors.lightgreen, fillAlpha: 0.5 }));
  }
}

export class PercentVisibleCalculatorGeometric extends PercentVisibleCalculatorAbstract {
  static get viewpointClass() { return GeometricViewpoint; }

  static get POINT_ALGORITHMS() { return Settings.KEYS.LOS.TARGET.POINT_OPTIONS; }

  /** @type {Camera} */
  camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective",
    up: new Point3d(0, 0, -1),
    mirrorMDiag: new Point3d(1, 1, 1),
  });

  /**
   * Scaling factor used with Clipper
   */
  static SCALING_FACTOR = 100;

  /**
   * Sets configuration to the current settings.
   * @param {ViewpointConfig} [cfg]
   * @returns {ViewpointConfig}
   */
//   initializeConfig(cfg = {}) {
//     // Configs specific to the Points algorithm.
//     const POINT_OPTIONS = Settings.KEYS.LOS.TARGET.POINT_OPTIONS;
//     cfg.pointAlgorithm ??= Settings.get(POINT_OPTIONS.NUM_POINTS) ?? Settings.KEYS.POINT_TYPES.CENTER;
//     cfg.targetInset ??= Settings.get(POINT_OPTIONS.INSET) ?? 0.75;
//     cfg.points3d ??= Settings.get(POINT_OPTIONS.POINTS3D) ?? false;
//     cfg.largeTarget ??= Settings.get(Settings.KEYS.LOS.TARGET.LARGE);
//     cfg.useLitTargetShape ??= true;
//
//     // Blocking canvas objects.
//     cfg.blocking ??= {};
//     cfg.blocking.walls ??= true;
//     cfg.blocking.tiles ??= true;
//
//     // Blocking tokens.
//     cfg.blocking.tokens ??= {};
//     cfg.blocking.tokens.dead ??= Settings.get(Settings.KEYS.DEAD_TOKENS_BLOCK);
//     cfg.blocking.tokens.live ??= Settings.get(Settings.KEYS.LIVE_TOKENS_BLOCK);
//     cfg.blocking.tokens.prone ??= Settings.get(Settings.KEYS.PRONE_TOKENS_BLOCK);
//
//     return cfg;
//   }

  viewer;

  target;

  viewpoint;

  targetLocation;

  targetArea = 0;

  obscuredArea = 0;

  gridSquareArea = 0;

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.viewer = viewer;
    this.target = target;
    this.viewpoint = viewerLocation;
    this.targetLocation = targetLocation;

    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustrum(target);

    this.blockingObjects = AbstractViewpoint.findBlockingObjects(viewerLocation, target,
      { viewer, senseType: this.config.senseType, blockingOpts: this.config.blocking });

    const res = this._obscuredArea();
    this.targetArea = res.targetArea;
    this.obscuredArea = res.obscuredArea;

    if ( this.config.largeTarget ) this.gridSquareArea = this._gridSquareArea();
  }


  /**
   * Determine the percentage red pixels for the current view.
   * @returns {number}
   * @override
   */
  _percentRedPixels() {
    if ( this.config.largeTarget ) this.targetArea = Math.min(this.gridSquareArea || 100_000, this.targetArea);

    // Round the percent seen so that near-zero areas are 0.
    // Because of trimming walls near the vision triangle, a small amount of token area can poke through
    const percentSeen = this.targetArea ? this.obscuredArea / this.targetArea : 0;
    if ( percentSeen.almostEqual(0, 1e-02) ) return 0;
    return percentSeen;
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
  _obscuredArea() {
    const { walls, tokens, tiles, terrainWalls } = this.blockingObjects;
    if ( !(walls.size || tokens.size || tiles.size || terrainWalls.size) ) return { targetArea: 1, obscuredArea: 0 };

    // Construct polygons representing the perspective view of the target and blocking objects.
    const { targetPolys, blockingPolys, blockingTerrainPolys } = this._constructPerspectivePolygons();

    // Once perspective-transformed, the token array of polygons are on the same plane, with z ~ 1.
    // Can combine to Polygons3d.
    const targetPolys3d = new Polygons3d();
    targetPolys3d.polygons = targetPolys;

    // Use Clipper to calculate area of the polygon shapes.
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const targetPaths = targetPolys3d.toClipperPaths({ omitAxis: "z", scalingFactor })
    const blockingTerrainPaths = this._combineTerrainPolys(blockingTerrainPolys);
    let blockingPaths = this._combineObstaclePolys(blockingPolys);
    if ( blockingTerrainPaths && !blockingTerrainPaths.area.almostEqual(0) ) {
      blockingPaths = blockingPaths.add(blockingTerrainPaths).combine();
    }

    // Construct the obscured shape by taking the difference between the target polygons and
    // the blocking polygons.
    const targetArea = Math.abs(targetPaths.area);
    if ( targetArea.almostEqual(0) ) return { targetArea, obscuredArea: 0 };

    const diff = blockingPaths.diffPaths(targetPaths); // TODO: Correct order?
    return { targetArea, obscuredArea: Math.abs(diff.area) };
  }

  /**
   * Each blocking polygon is either a Polygon3d or a Polygons3d.
   * Union each in turn.
   * @param {Polygon3d|Polygons3d} blockingPolys
   */
  _combineObstaclePolys(blockingPolys) {
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
  _combineTerrainPolys(blockingTerrainPolys) {
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
  _constructPerspectivePolygons() {
    const { walls, tokens, tiles, terrainWalls } = this.blockingObjects;

    // Construct polygons representing the perspective view of the target and blocking objects.
    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;
    const targetPolys = this._lookAtObjectWithPerspective(this.target, lookAtM, perspectiveM);

    const blockingPolys = [...walls, ...tiles, ...tokens].flatMap(obj =>
      this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));

    const blockingTerrainPolys = [...terrainWalls].flatMap(obj =>
       this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));

    return { targetPolys, blockingPolys, blockingTerrainPolys };
  }

  _lookAtObjectWithPerspective(object, lookAtM, perspectiveM) {
    return AbstractViewpoint.filterPlaceablePolygonsByViewpoint(object, this.viewpoint)
      .map(poly => poly
        .transform(lookAtM)
        .clipZ()
        .transform(perspectiveM))
  }

  /** @type {AbstractPolygonTriangles[]} */
  static get grid3dShape() { return Grid3dTriangles.trianglesForGridShape(); }

  /**
   * Area of a basic grid square to use for the area estimate when dealing with large tokens.
   * @returns {number}
   */
  _gridSquareArea(lookAtM, perspectiveM) {
     const gridPolys = this._gridPolys = this._gridPolygons(lookAtM, perspectiveM);
     const gridPaths = CONFIG[MODULE_ID].ClipperPaths.fromPolygons(gridPolys, {scalingFactor: this.constructor.SCALING_FACTOR});
     gridPaths.combine().clean();
     return gridPaths.area;
  }

  _gridPolygons(lookAtM, perspectiveM) {
     const target = this.target;
     const { x, y } = target.center;
     const z = target.bottomZ + (target.topZ - target.bottomZ);
     const gridTris = Grid3dTriangles.trianglesForGridShape();
     const translateM = CONFIG.GeometryLib.MatrixFlat.translation(x, y, z);
     return gridTris
       .filter(tri => tri.isFacing(this.viewpoint))
       .map(tri => tri
         .transform(translateM)
         .transform(lookAtM)
         .transform(perspectiveM)
         .toPolygon());
  }
}

export class DebugVisibilityViewerGeometric extends DebugVisibilityViewerArea3dPIXI {
  static viewpointClass = GeometricViewpoint;

  algorithm = Settings.KEYS.LOS.TARGET.TYPES.AREA3D_GEOMETRIC;
}

