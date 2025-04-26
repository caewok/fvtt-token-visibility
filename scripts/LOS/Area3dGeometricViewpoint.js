/* globals
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { Grid3dTriangles  } from "./PlaceableTriangles.js";

import  { Camera } from "./WebGPU/Camera.js";

// Debug
import { Draw } from "../geometry/Draw.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";

export class Area3dGeometricViewpoint extends AbstractViewpoint {
  /** @type {Camera} */
  camera = new Camera({ glType: "webGL2", perspectiveType: "perspective" });

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

//     return CONFIG.GeometryLib.MatrixFlat.lookAt(
//       this.viewpoint,
//       this.viewerLOS.targetCenter,
//       this.constructor.upVector
//     ).Minv;
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
    if ( Math.abs(blockingTerrainPaths.area) > 1 ) {
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
    for ( const poly1 of blockingTerrainPolys ) {
      const path1 = ClipperPaths.fromPolygons([poly1], { scalingFactor });
      for ( const poly2 of blockingTerrainPolys ) {
        if ( poly1 === poly2 ) continue;
        const newPath = path1.intersectPolygon(poly2);
        if ( Math.abs(newPath.area) < 1 ) continue; // Skip very small intersections.
        blockingTerrainPaths.add(newPath);
      }
    }
    return blockingTerrainPaths.combine();
  }

  _lookAtObject(object, lookAtM) {
    return this._filterPlaceableTrianglesByViewpoint(object)
      .map(tri => tri.transform(lookAtM).toPolygon());
  }

  _lookAtObjectWithPerspective(object, lookAtM, perspectiveM) {
    return this._filterPlaceableTrianglesByViewpoint(object)
      .map(tri => tri
        .transform(lookAtM)
        .transform(perspectiveM)
        .toPolygon());
  }


  // ----- NOTE: Target properties ----- //


  /* ----- NOTE: Blocking objects ----- */


  /** @type {AbstractPolygonTriangles[]} */
  static get grid3dShape() { return Grid3dTriangles.trianglesForGridShape(); }


  /**
   * Area of a basic grid square to use for the area estimate when dealing with large tokens.
   * @returns {number}
   */
   _gridSquareArea(lookAtM) {
     const gridPolys = this._gridPolys = this._gridPolygons(lookAtM);
     const gridPaths = ClipperPaths.fromPolygons(gridPolys, {scalingFactor: this.constructor.SCALING_FACTOR});
     gridPaths.combine().clean();
     return gridPaths.area;
  }

  _gridPolygons(lookAtM) {
     lookAtM ??= this.targetLookAtMatrix;
     const target = this.viewerLOS.target;
     const multiplier = this.targetMultiplier;

     const { x, y } = target.center;
     const z = target.bottomZ + (target.topZ - target.bottomZ);
     const gridTris = Grid3dTriangles.trianglesForGridShape();
     const translateM = CONFIG.GeometryLib.MatrixFlat.translation(x, y, z);
     return gridTris
       .filter(tri => tri.isFacing(this.viewpoint))
       .map(tri => tri
         .transform(translateM)
         .transform(lookAtM)
         .perspectiveTransform(multiplier)
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
    // Recalculate the 3d objects.
    const { targetPolys, blockingPolys, blockingTerrainPolys } = this._constructPerspectivePolygons();
    const colors = Draw.COLORS;

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