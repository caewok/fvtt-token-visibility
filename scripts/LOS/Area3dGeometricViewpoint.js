/* globals
CONFIG,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder

// LOS folder
import { minMaxPolygonCoordinates } from "./util.js";
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { Grid3dTriangles  } from "./PlaceableTriangles.js";

// Debug
import { Draw } from "../geometry/Draw.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";

export class Area3dGeometricViewpoint extends AbstractViewpoint {
  /** @type {Shadow[]} */
  wallShadows = [];

  /**
   * Vector representing the up position on the canvas.
   * Used to construct the token camera and view matrices.
   * @type {Point3d}
   */
  static get upVector() { return new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1); };

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

  get targetLookAtMatrix() {
    return CONFIG.GeometryLib.MatrixFlat.lookAt(
      this.viewpoint,
      this.viewerLOS.targetCenter,
      this.constructor.upVector
    ).Minv;
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
    const targetLookAtTris = this._lookAtObject(this.viewerLOS.target, lookAtM);
    const multiplier = this._calculateTargetSizeMultiplier(targetLookAtTris);

    const targetPolys = this._targetPolys = targetLookAtTris
      .map(tri => tri.perspectiveTransform(multiplier).toPolygon())

    const blockingPolys = this._blockingPolys = [...walls, ...tiles, ...tokens].flatMap(obj =>
      this._lookAtObjectWithPerspective(obj, lookAtM, multiplier));

    const blockingTerrainPolys = this._blockingTerrainPolys = [...terrainWalls].flatMap(obj =>
       this._lookAtObjectWithPerspective(obj, lookAtM, multiplier));

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

    // TODO: Finish implementing.
    if ( this.viewerLOS.config.largeTarget ) {
      // Construct the grid shape at this perspective.
//       const ctr = this.viewerLOS.target.center;
//       const grid3dShape = this.constructor.grid3dShape;
//       const translateM = CONFIG.GeometryLib.MatrixFlat.translation(ctr.x, ctr.y, this.viewerLOS.target.bottomZ);
//       grid3dShape.forEach(shape => shape.update(translateM));
//       const multiplier = 100 / this.maxTargetValue;
//       const gridPolys = [...grid3dShape[0].triangles, ...grid3dShape[1].triangles, ...grid3dShape[2].triangles]
//         .filter(tri => tri.isFacing(this.viewpoint))
//         .map(tri => tri.transform(lookAtM))
//         .map(tri => tri.perspectiveTransform(multiplier))
//         .map(tri => tri.toPolygon());
    }

    // Use Clipper to calculate area of the polygon shapes.
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const targetPaths = ClipperPaths.fromPolygons(targetPolys, { scalingFactor });
    const blockingTerrainPaths = ClipperPaths.fromPolygons(blockingTerrainPolys, { scalingFactor });
    const blockingPaths = ClipperPaths.fromPolygons(blockingPolys, { scalingFactor });

    // TODO: Combine terrain polygons with other blocking.

    // Construct the obscured shape by taking the difference between the target polygons and
    // the blocking polygons.
    const targetArea = targetPaths.area;
    if ( targetArea < 0 || targetArea.almostEqual(0) ) return { targetArea, obscuredArea: 0 };

    const diff = blockingPaths.diffPaths(targetPaths); // TODO: Correct order?
    return { targetArea, obscuredArea: diff.area };
  }

  maxTargetValue = 1;

  _calculateTargetSizeMultiplier(targetLookAtTriangles) {
    let maxZ = Number.NEGATIVE_INFINITY;
    let maxXY = Number.NEGATIVE_INFINITY;
    targetLookAtTriangles.forEach(tri => {
      maxZ = Math.max(
        maxZ,
        Math.abs(tri.a.z),
        Math.abs(tri.b.z),
        Math.abs(tri.c.z)
      );
      maxXY = Math.max(
        Math.abs(tri.a.x),
        Math.abs(tri.b.x),
        Math.abs(tri.c.x),
        Math.abs(tri.a.y),
        Math.abs(tri.b.y),
        Math.abs(tri.c.y),
      );
    });
    // xy / z = f
    // 100 = f * m
    this.maxTargetValue = (maxZ * 100) / maxXY;
    return this.maxTargetValue;
  }

  _lookAtObject(object, lookAtM) {
    return this._filterPlaceableTrianglesByViewpoint(object)
      .map(tri => tri.transform(lookAtM));
  }

  _lookAtObjectWithPerspective(object, lookAtM, multiplier = 1) {
    return this._lookAtObject(object, lookAtM)
      .map(tri => tri.perspectiveTransform(multiplier).toPolygon())
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
     lookAtM ??= this.targetLookAtMatrix;
     const ctr = this.viewerLOS.target.center;
     const grid3dShape = this.constructor.grid3dShape;
     const translateM = CONFIG.GeometryLib.MatrixFlat.translation(ctr.x, ctr.y, this.viewerLOS.target.bottomZ);
     grid3dShape.forEach(shape => shape.update(translateM));
     const multiplier = 100 / this.maxTargetValue;
     const gridPolys = this._gridPolys = [...grid3dShape[0].triangles, ...grid3dShape[1].triangles, ...grid3dShape[2].triangles]
      .filter(tri => tri.isFacing(this.viewpoint))
      .map(tri => tri.transform(lookAtM))
      .map(tri => tri.perspectiveTransform(multiplier))
      .map(tri => tri.toPolygon());
     const gridPaths = ClipperPaths.fromPolygons(gridPolys, {scalingFactor: this.constructor.SCALING_FACTOR});
     gridPaths.combine().clean();
     return gridPaths.area;
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
  _draw3dDebug(drawTool, _renderer) {
    // Recalculate the 3d objects.
    const { targetPolys, blockingPolys, blockingTerrainPolys } = this._constructPerspectivePolygons();
    const colors = Draw.COLORS;

    // Scale the target graphics to fit in the view window.
    const { xMinMax, yMinMax } = minMaxPolygonCoordinates(this._targetPolys);
    const maxCoord = 200;
    const scale = Math.min(1,
      maxCoord / xMinMax.max,
      -maxCoord / xMinMax.min,
      maxCoord / yMinMax.max,
      -maxCoord / yMinMax.min
    );
    drawTool.g.scale = new PIXI.Point(scale, scale);

    // TODO: Do the target polys need to be translated back to 0,0?
    // Draw the target in 3d, centered on 0,0
    targetPolys.forEach(poly => drawTool.shape(poly, { color: colors.orange, fill: colors.lightred, fillAlpha: 0.5 }));

    // Draw the grid shape.
    if ( this.viewerLOS.config.largeTarget ) this._gridPolys.forEach(poly =>
      drawTool.shape(poly, { color: colors.lightorange, fillAlpha: 0.4 }));

    // Draw the detected objects in 3d, centered on 0,0
    blockingPolys.forEach(poly => drawTool.shape(poly, { color: colors.blue, fill: colors.lightblue, fillAlpha: 0.5 }));
    blockingTerrainPolys.forEach(poly => drawTool.shape(poly, { color: colors.green, fill: colors.lightgreen, fillAlpha: 0.5 }));
  }


}