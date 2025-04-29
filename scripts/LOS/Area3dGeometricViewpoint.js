/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { Grid3dTriangles  } from "./PlaceableTriangles.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import  { Camera } from "./WebGPU/Camera.js";

// Debug
import { Draw } from "../geometry/Draw.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";

export class Area3dGeometricViewpoint extends AbstractViewpoint {
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
   * Clear any cached values related to the target or target location.
   */
  clearCache() {
    super.clearCache();
  }

  // ----- NOTE: Visibility testing ----- //

  // TODO: Change lookAt and perspective when changing viewer or target
  get targetLookAtMatrix() {
    this.camera.cameraPosition = this.viewpoint;
    this.camera.targetPosition = this.viewerLOS.targetCenter;
    return this.camera.lookAtMatrix;
  }

  get targetPerspectiveMatrix() {
    this.camera.cameraPosition = this.viewpoint;
    this.camera.targetPosition = this.viewerLOS.targetCenter;
    this.camera.setTargetTokenFrustrum(this.viewerLOS.target);
    return this.camera.perspectiveMatrix;
  }

  /**
   * Determine percentage area by estimating the blocking shapes geometrically.
   * @returns {number}
   */
  _percentVisible() {
    let { targetArea, obscuredArea } = this._obscuredArea();
    // console.debug({ targetArea, obscuredArea });
    if ( this.viewerLOS.config.largeTarget ) targetArea = Math.min(this._gridSquareArea() || 100_000, targetArea);

    // Round the percent seen so that near-zero areas are 0.
    // Because of trimming walls near the vision triangle, a small amount of token area can poke through
    const percentSeen = targetArea ? obscuredArea / targetArea : 0;
    if ( percentSeen.almostEqual(0, 1e-02) ) return 0;
    return percentSeen;
  }

  _blockingTerrainPolys;

  _blockingPolys;

  _targetPolys;

  _gridPolys;



  /**
   * Construct polygons that are used to form the 2d perspective.
   */
  _constructPerspectivePolygons() {
    const { walls, tokens, tiles, terrainWalls } = this.blockingObjects;

    // Construct polygons representing the perspective view of the target and blocking objects.
    const lookAtM = this.targetLookAtMatrix;
    const perspectiveM = this.targetPerspectiveMatrix;
    const targetPolys = this._lookAtObjectWithPerspective(this.viewerLOS.target, lookAtM, perspectiveM);

    const blockingPolys = this._blockingPolys = [...walls, ...tiles, ...tokens].flatMap(obj =>
      this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));

    const blockingTerrainPolys = this._blockingTerrainPolys = [...terrainWalls].flatMap(obj =>
       this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));

    return { targetPolys, blockingPolys, blockingTerrainPolys };
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

    // TODO: union, combine, joinPaths, or add? Use clean?

//     const targetPaths = ClipperPaths.fromPolygons(targetPolys, { scalingFactor })
//       .union()
//       .clean();
//     const blockingTerrainPaths = ClipperPaths.fromPolygons(blockingTerrainPolys, { scalingFactor })
//       .union()
//       .clean();
//     const blockingPaths = ClipperPaths.fromPolygons(blockingPolys, { scalingFactor })
//       .union()
//       .clean();

    // Use Clipper to calculate area of the polygon shapes.
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const targetPaths = ClipperPaths.fromPolygons(targetPolys, { scalingFactor });
    const blockingTerrainPaths = this._combineTerrainPaths(blockingTerrainPolys);
    let blockingPaths = ClipperPaths.fromPolygons(blockingPolys, { scalingFactor });
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

  _combineTerrainPaths(blockingTerrainPolys) {
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const blockingTerrainPaths = new ClipperPaths()

    // The intersection of each two terrain polygons forms a blocking path.
    // Only need to test each combination once.
    const nBlockingPolys = blockingTerrainPolys.length;
    if ( nBlockingPolys < 2 ) return null;
    for ( let i = 0; i < nBlockingPolys; i += 1 ) {
      const iPath = ClipperPaths.fromPolygons(blockingTerrainPolys.slice(i, i + 1), { scalingFactor });
      for ( let j = i + 1; j < nBlockingPolys; j += 1 ) {
        const newPath = iPath.intersectPolygon(blockingTerrainPolys[j]);
        if ( newPath.area.almostEqual(0) ) continue; // Skip very small intersections.
        blockingTerrainPaths.add(newPath);
      }
    }

    if ( !blockingTerrainPaths.paths.length ) return null;
    return blockingTerrainPaths.combine();
  }

  _lookAtObject(object, lookAtM) {
    return this._filterPlaceablePolygonsByViewpoint(object)
      .map(poly => poly.transform(lookAtM).toPolygon());
  }

  _lookAtObjectWithPerspective(object, lookAtM, perspectiveM) {
    return this._filterPlaceablePolygonsByViewpoint(object)
      .map(poly => poly
        .transform(lookAtM)
        .clipZ()
        .transform(perspectiveM))
      .map(poly => poly.to2dPolygon()); // PIXI.Polygon will drop the z values, which should all be ~ 1.
  }


  // ----- NOTE: Target properties ----- //


  /* ----- NOTE: Blocking objects ----- */


  /** @type {AbstractPolygonTriangles[]} */
  static get grid3dShape() { return Grid3dTriangles.trianglesForGridShape(); }


  /**
   * Area of a basic grid square to use for the area estimate when dealing with large tokens.
   * @returns {number}
   */
  _gridSquareArea(lookAtM, perspectiveM) {
     const gridPolys = this._gridPolys = this._gridPolygons(lookAtM, perspectiveM);
     const gridPaths = ClipperPaths.fromPolygons(gridPolys, {scalingFactor: this.constructor.SCALING_FACTOR});
     gridPaths.combine().clean();
     return gridPaths.area;
  }

  _gridPolygons(lookAtM, perspectiveM) {
     const target = this.viewerLOS.target;
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

  /* ----- NOTE: Other helper methods ----- */

  destroy() {
    this.clearCache();
    super.destroy();
  }

  /* ----- NOTE: Debugging methods ----- */

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(drawTool, _renderer, _container, { width = 100, height = 100 } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;

    // Recalculate the 3d objects.
    const { targetPolys, blockingPolys, blockingTerrainPolys } = this._constructPerspectivePolygons();
    const colors = Draw.COLORS;

    // Locate obstacles behind the target.
    const backgroundTiles = this.constructor.visionTriangle.findBackgroundTiles();
    const backgroundWalls = this.constructor.visionTriangle.findBackgroundWalls();

    // TODO: Can we sort these based on a simplified depth test? Maybe use the z values after looking at them but before perspective?
    // Simpler:
    //   Mainly we are looking at approx. a 2d overhead view.
    //   So measure closest intersect to the vision triangle, testing edges and center.
    //   Test only the 2d line—wall or tile triangle.
    //   If no intersect, test from center of triangle.
    //   Or rather, just test lineLineIntersection against the 2 vision edges and take the closer.

    const lookAtM = this.targetLookAtMatrix;
    const perspectiveM = this.targetPerspectiveMatrix;

    const backgroundPolys = [];
    const { b, c } = this.constructor.visionTriangle;
    const b3d = new Point3d(b.x, b.y, this.viewerLOS.targetCenter.z);
    const c3d = new Point3d(c.x, c.y, this.viewerLOS.targetCenter.z);

    const dirs = [
      b3d.subtract(this.viewpoint).normalize(),
      c3d.subtract(this.viewpoint).normalize(),
      this.viewerLOS.targetCenter.subtract(this.viewpoint).normalize(),
    ];

    const backgroundTestFn = (placeable, color, fill) => {
      const polys = this._filterPlaceablePolygonsByViewpoint(placeable);
      polys.forEach(poly => {
        const ixs = [];
        for ( const dir of dirs ) {
          const ix = poly.intersection(this.viewpoint, dir);
          if ( ix ) ixs.push(ix);
        }
        if ( !ixs.length ) ixs.push(poly.centroid());

        const dist2 = ixs.reduce((acc, curr) => {
          if ( !curr ) return acc;
          return Math.min(acc, Point3d.distanceSquaredBetween(this.viewpoint, curr));
        }, Number.POSITIVE_INFINITY);
        poly = poly
          .transform(lookAtM)
          .clipZ()
          .transform(perspectiveM)
          .to2dPolygon();
        if ( !poly.points.length ) return;
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
    backgroundPolys.forEach(obj => drawTool.shape(obj.poly.scale(width, height), { color: obj.color, width: 2, fill: obj.fill, fillAlpha: 0.5 }))

    // const backgroundTilesPolys = [...backgroundTiles].flatMap(obj => this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));
    // const backgroundWallsPolys = [...backgroundWalls].flatMap(obj => this._lookAtObjectWithPerspective(obj, lookAtM, perspectiveM));

    // backgroundTilesPolys.forEach(poly => drawTool.shape(poly.scale(width, height), { color: colors.orange, width: 2, fill: colors.orange, fillAlpha: 0.5 }))
    // backgroundWallsPolys.forEach(poly => drawTool.shape(poly.scale(width, height), { color: colors.gray, width: 2, fill: colors.gray, fillAlpha: 0.5 }))

    // Draw the target in 3d, centered at 0,0.
    // Scale the target graphics to fit in the view window.
    targetPolys.forEach(poly => drawTool.shape(poly.scale(width, height), { color: colors.red, width: 2, fill: colors.lightred, fillAlpha: 0.5 }));

    // Draw the grid shape.
    if ( this.viewerLOS.config.largeTarget ) this._gridPolys.forEach(poly =>
      drawTool.shape(poly.scale(width, height), { color: colors.orange, fill: colors.lightorange, fillAlpha: 0.4 }));

    // Draw the detected obstacles.
    blockingPolys.forEach(poly => drawTool.shape(poly.scale(width, height), { color: colors.blue, fill: colors.lightblue, fillAlpha: 0.75 }));
    blockingTerrainPolys.forEach(poly => drawTool.shape(poly.scale(width, height), { color: colors.green, fill: colors.lightgreen, fillAlpha: 0.5 }));
  }


}