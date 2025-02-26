/* globals
canvas,
CONFIG,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { PolygonVerticalTriangles, Polygon2dTriangles, Square2dTriangles } from "./PlaceableTriangles.js";

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
    if ( this.viewerLOS.config.debug ) {
      this._updatePercentVisibleLabel(percentSeen);
      this._draw3dDebug();
    }

    if ( percentSeen.almostEqual(0, 1e-02) ) return 0;
    return percentSeen;
  }

  _blockingTerrainPolys;

  _blockingPolys;

  _targetPolys;

  _gridPolys;


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
    const lookAtM = this.targetLookAtMatrix;
    const { walls, tokens, tiles, terrainWalls } = this.blockingObjects;
    if ( !(walls.size || tokens.size || tiles.size || terrainWalls.size) ) return { targetArea: 1, obscuredArea: 0 };

    // Build the target shape.
    const targetTriangles = this._filterPlaceableTrianglesByViewpoint(this.viewerLOS.target);
    const targetPolys = this._targetPolys = targetTriangles
      .map(tri => tri.transform(lookAtM))
      .map(tri => tri.perspectiveTransform())
      .map(tri => tri.toPolygon());

    // Determine multiplier to set the target to be 100x100.
    // Can we determine this without checking every point?
    let maxValue = Number.NEGATIVE_INFINITY;
    targetPolys.forEach(poly => maxValue = Math.max(maxValue, ...poly.points.map(pt => Math.abs(pt))));
    const multiplier = 100 / maxValue;
    targetPolys.forEach(poly => poly.points = poly.points.map(pt => pt * multiplier));

    // TODO: View and clip? Reuse triangle?
    const targetPaths = ClipperPaths.fromPolygons(targetPolys, {scalingFactor: this.constructor.SCALING_FACTOR})
      .union()
      .clean();

    // Terrain walls: Color differently and set to 0.5 alpha so that two combined can be marked at pixel level?
    const terrainTriangles = [...terrainWalls].flatMap(w => this._filterPlaceableTrianglesByViewpoint(w));
    const blockingTerrainPolys = this._blockingTerrainPolys = terrainTriangles
      .map(tri => tri.transform(lookAtM))
      .map(tri => tri.perspectiveTransform(multiplier))
      .map(tri => tri.toPolygon());
    // TODO: Combine terrain polys

    // Combine terrain wall points.
    const blockingTerrainPaths = ClipperPaths.fromPolygons(blockingTerrainPolys, {scalingFactor: this.constructor.SCALING_FACTOR})
      .union()
      .clean();

    // Transform all the triangles.
    const triangles = [
      ...[...walls].flatMap(w => this._filterPlaceableTrianglesByViewpoint(w)),
      ...[...tokens].flatMap(t => this._filterPlaceableTrianglesByViewpoint(t)),
      ...[...tiles].flatMap(t => this._filterPlaceableTrianglesByViewpoint(t))
    ];

    // Combine all the point shapes.
    const blockingPolys = this._blockingPolys = triangles
      .map(tri => tri.transform(lookAtM))
      .map(tri => tri.perspectiveTransform(multiplier))
      .map(tri => tri.toPolygon());
    const blockingPaths = ClipperPaths.fromPolygons(blockingPolys, {scalingFactor: this.constructor.SCALING_FACTOR})
      .union()
      .clean();

    // TODO: Combine terrain polygons with other blocking.



    // Construct the obscured shape by taking the difference between the target polygons and
    // the blocking polygons.
    const targetArea = targetPaths.area;
    if ( targetArea < 0 || targetArea.almostEqual(0) ) return { targetArea, obscuredArea: 0 };

    const diff = blockingPaths.diffPaths(targetPaths); // TODO: Correct order?
    return { targetArea, obscuredArea: diff.area };
  }

  // ----- NOTE: Target properties ----- //


  /* ----- NOTE: Blocking objects ----- */


  /** @type {AbstractPolygonTriangles[3]} */
  static #grid3dShape = Array(3);

  static get grid3dShape() {
    const SIDES = 0;
    const TOP = 1;
    const BOTTOM = 2;

    // Need a getter b/c the grid shape changes when loading new scenes.
    if ( this.#grid3dShape ) return this.#grid3dShape;

    const size = canvas.grid.size;
    const size_1_2 = size * 0.5;

    if ( canvas.grid.isHex ) {
      const poly = new PIXI.Polygon(canvas.grid.getShape());
      this.#grid3dShape[SIDES] = new PolygonVerticalTriangles(poly);
      this.#grid3dShape[TOP] = new Polygon2dTriangles(poly);
      this.#grid3dShape[BOTTOM] = new Polygon2dTriangles(poly);

      // Already set to correct size.
      // Move the top and bottom squares to correct elevation.
      const translateTopM = CONFIG.GeometryLib.MatrixFlat.translation(0, 0, size_1_2);
      const translateBottomM = CONFIG.GeometryLib.MatrixFlat.translation(0, 0, -size_1_2);
      this.#grid3dShape[TOP].initialize(translateTopM); // Should be centered at 0,0.
      this.#grid3dShape[BOTTOM].initialize(translateBottomM);

    } else {
      // For gridless, canvas.grid.getShape() does not work.
      const rect = new PIXI.Rectangle(-size_1_2, -size_1_2, size, size);
      this.#grid3dShape[SIDES] = new PolygonVerticalTriangles(rect);
      this.#grid3dShape[TOP] = new Square2dTriangles();
      this.#grid3dShape[BOTTOM] = new Square2dTriangles();

      // Move the top and bottom squares to correct elevation.
      // Set size for the squares.
      const scaleM = CONFIG.GeometryLib.MatrixFlat.scale(size_1_2, size_1_2, 1);
      const translateTopM = CONFIG.GeometryLib.MatrixFlat.translation(0, 0, size_1_2);
      const translateBottomM = CONFIG.GeometryLib.MatrixFlat.translation(0, 0, -size_1_2);
      const topM = scaleM.multiply4x4(translateTopM);
      const bottomM = scaleM.multiply4x4(translateBottomM);
      this.#grid3dShape[TOP].initialize(topM); // Should be centered at 0,0.
      this.#grid3dShape[BOTTOM].initialize(bottomM);
    }
    return this.#grid3dShape;
  }

  /**
   * Area of a basic grid square to use for the area estimate when dealing with large tokens.
   * @returns {number}
   */
   _gridSquareArea(lookAtM) {
     const ctr = this.token.center;
     const gridShape = this.constructor.gridShape;
     const translateM = CONFIG.GeometryLib.MatrixFlat.translation(ctr.x, ctr.y, this.token.bottomZ);
     gridShape.update(translateM);
     const gridTriangles = gridShape.triangles
      .filter(tri => tri.isFacing(this.viewpoint));
     const gridPolys = this._gridPolys = gridTriangles
      .map(tri => tri.viewAndClip(lookAtM))
      .map(pts => new PIXI.Polygon(pts));
     const gridPaths = ClipperPaths.fromPolygons(gridPolys, {scalingFactor: this.constructor.SCALING_FACTOR});
     gridPaths.combine().clean();
     return gridPaths.area;
   }

  /* ----- NOTE: Other helper methods ----- */

  destroy() {
    this.clearCache();
    if ( this.#popoutGraphics && !this.#popoutGraphics.destroyed ) this.#popoutGraphics.destroy();
    if ( this.#percentVisibleLabel && !this.#percentVisibleLabel.destroyed ) this.#percentVisibleLabel.destroy();
    this.#popoutGraphics = undefined;
    this.#popoutDraw = undefined;
    super.destroy();
  }

  /* ----- NOTE: Debugging methods ----- */

  /** @type {PIXI.Graphics} */
  #popoutGraphics;

  get popoutGraphics() { return (this.#popoutGraphics ??= new PIXI.Graphics()); }

  /** @type {Draw} */
  #popoutDraw;

  get popoutDraw() { return (this.#popoutDraw ??= new Draw(this.popoutGraphics)); }

  openDebugPopout() {
    this.viewerLOS._addChildToPopout(this.popoutGraphics);
    this.viewerLOS._addChildToPopout(this.percentVisibleLabel);
  }

  /** @type {PIXI.BitmapText} */
  #percentVisibleLabel;

  get percentVisibleLabel() {
    if ( !this.#percentVisibleLabel ) {
      this.#percentVisibleLabel = new PIXI.BitmapText("", {
        fontName: `${MODULE_ID}_area3dPercentLabel`,
        fontSize: 20,
        align: 'left',
      });

      /*
      this.#percentVisibleLabel = new PIXI.BitmapText("", {
        fontName: 'Desyrel',
        fontSize: 20,
        align: 'center',
      });
      */
      this.#percentVisibleLabel.x = 0; // TODO: Make dynamic to the popout box.
      this.#percentVisibleLabel.y = 150;
    }
    return this.#percentVisibleLabel;
  }

  /**
   * For debugging.
   * Draw the percentage visible.
   * @param {number} percent    The percent to draw in the window.
   */
  _updatePercentVisibleLabel(number) {
    const label = this.percentVisibleLabel;
    label.text = `${(number * 100).toFixed(1)}%`;
    console.log(`Area3dGeometricViewpoint|_updatePercentVisibleLabel ${label.text}`);
  }

  _clear3dDebug() {
    if ( this.#popoutGraphics ) this.#popoutGraphics.clear();
    if ( this.#percentVisibleLabel ) this.#percentVisibleLabel.text = "";
    console.log(`Area3dGeometricViewpoint|_clear3dDebug`);
  }

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug() {
    if ( !this._targetPolys.length ) return;

    const drawTool = this.popoutDraw;
    drawTool.clearDrawings();
    const colors = Draw.COLORS;

    // Scale the target graphics to fit in the view window.
    let xMin = Number.POSITIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for ( const poly of this._targetPolys ) {
      for ( let i = 0, n = poly.points.length; i < n; i += 2 ) {
        xMin = Math.min(poly.points[i], xMin);
        yMin = Math.min(poly.points[i+1], yMin);
        xMax = Math.max(poly.points[i], xMax);
        yMax = Math.max(poly.points[i+1], yMax);
      }
    }
    const maxCoord = 200;
    const scale = Math.min(1,
      maxCoord / xMax,
      -maxCoord / xMin,
      maxCoord / yMax,
      -maxCoord / yMin
    );
    drawTool.g.scale = new PIXI.Point(scale, scale);

    // TODO: Do the target polys need to be translated back to 0,0?
    // Draw the target in 3d, centered on 0,0
    this._targetPolys.forEach(poly => drawTool.shape(poly, { color: colors.orange, fill: colors.lightorange, fillAlpha: 0.5 }));

    // Draw the grid shape.
    if ( this.viewerLOS.config.largeTarget ) this._gridPolys.forEach(poly =>
      drawTool.shape(poly, { color: colors.lightred, fillAlpha: 0.4 }));

    // Draw the detected objects in 3d, centered on 0,0
    this._blockingPolys.forEach(poly => drawTool.shape(poly, { color: colors.blue, fill: colors.lightblue, fillAlpha: 0.5 }));
    this._blockingTerrainPolys.forEach(poly => drawTool.shape(poly, { color: colors.green, fill: colors.lightgreen, fillAlpha: 0.5 }));
  }


}