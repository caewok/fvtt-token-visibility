/* globals
CONFIG,
CONST,
canvas,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// LOS folder
import { VisionTriangle } from "./VisionTriangle.js";
import { squaresUnderToken, hexesUnderToken } from "./shapes_under_token.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";
import { insetPoints } from "./util.js";

// Debug
import { Draw } from "../geometry/Draw.js";

// const TOTAL = 0;
// const OBSCURED = 1;
// const BRIGHT = 2;
// const DIM = 3;
// const DARK = 4;

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 */
export class AbstractViewpoint {
  static calcClass;

  /** @type {VisionTriangle} */
  static visionTriangle = new VisionTriangle();

  /** @type {ViewerLOS} */
  viewerLOS;

  /** @type {Point3d} */
  viewpointDiff;

  /**
   * @param {ViewerLOS} viewerLOS      The viewer that controls this "eye"; handles most of the config
   * @param {Point3d} viewpoint        The location of the eye; this will be translated to be relative to the viewer
   */
  constructor(viewerLOS, viewpoint) {
    if ( viewerLOS.calculator && !(viewerLOS.calculator instanceof this.constructor.calcClass) ) {
      console.error(`{this.constructor.name}|Calculator must be ${this.constructor.calcClass.name}.`, this.viewerLOS.calculator);
    }
    this.viewerLOS = viewerLOS;
    this.viewpointDiff = viewpoint.subtract(viewerLOS.center);
  }

  /** @type {Point3d} */
  get viewpoint() { return this.viewerLOS.center.add(this.viewpointDiff); }

  /** @type {Point3d} */
  get targetLocation() { return CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(this.viewerLOS.target); }

  /** @type {Token} */
  get viewer() { return this.viewerLOS.viewer};

  /** @type {Token} */
  get target() { return this.viewerLOS.target; }

  /** @type {WALL_RESTRICTION_TYPES} */
  get senseType() { return this.viewerLOS.config.senseType; }

  // set senseType(value) { this.calculator.senseType = senseType; }

  /** @type {PercentVisibileCalculatorAbstract} */
  get calculator() { return this.viewerLOS.calculator; }

  get config() { return this.viewerLOS.calculator.config; }

  // ----- NOTE: Visibility Percentages ----- //

  get percentVisible() { return this.calculator.percentVisible; }

  get percentUnobscured() { return this.calculator.percentUnobscured; }

  get percentVisibleBright() { return this.calculator.percentVisibleBright; }

  get percentVisibleDim() { return this.calculator.percentVisibleDim; }

  get visibility() { return [this.calculator.percentUnobscured, this.calculator.percentVisibleDim, this.calculator.percentVisibleBright]; }

  calculate() {
    this.calculator.counts.fill(0)
    if ( this.passesSimpleVisibilityTest() ) return;
    this.calculator.calculate();
  }

  targetOverlapsViewpoint() {
    const bounds = this.config.constrainTokens ? this.target.constrainedTokenBorder : this.target.tokenBorder;
    if ( !bounds.contains(this.viewpoint) ) return false;
    return this.viewpoint.between(this.target.bottomZ, this.target.topZ);
  }

  /**
   * Test for whether target is within the vision angle of the viewpoint and no obstacles present.
   * @param {Token} target
   * @returns {0|1|undefined} 1.0 for visible; Undefined if obstacles present or target intersects the vision rays.
   */
  passesSimpleVisibilityTest() {
    const target = this.target;

    // Treat the scene background as fully blocking, so basement tokens don't pop-up unexpectedly.
    const backgroundElevation = canvas.scene.flags?.levels?.backgroundElevation || 0;
    if ( (this.viewpoint.z > backgroundElevation && target.topZ < backgroundElevation)
      || (this.viewpoint.z < backgroundElevation && target.bottomZ > backgroundElevation) ) return true;

    // Force tokens within the viewpoint to be visible and lit.
    if ( this.targetOverlapsViewpoint ) {
      this.calculator.counts.set([1, 0, 1, 1, 0]);
      return true;
    }

    return false;
  }

  // ----- NOTE: Collision tests ----- //
  /**
   * Test if we have one or more potentially blocking objects. Does not check for whether
   * the objects in fact block but does require two terrain walls to count.
   * @returns {boolean} True if some blocking placeable within the vision triangle.
   *
   */
  hasPotentialObstaclesfromViewpoint(viewpoint = this.viewpoint) {
    const opts = {
      senseType: this.config.senseType,
      viewer: this.viewer,
      target: this.target,
      blocking: this.config.blocking,
    };
    const visionTri = ObstacleOcclusionTest.visionTriangle.rebuild(viewpoint, target);
    const walls = ObstacleOcclusionTest.findBlockingWalls(visionTri, opts);
    if ( walls.size > 1 ) return true; // 2+ walls or 2+ terrain walls present.
    if ( walls.size && !walls.first().edge.isLimited(opts.senseType) ) return true; // Single non-limited wall present.
    if ( ObstacleOcclusionTest.findBlockingTiles(visionTri, opts).size
      || ObstacleOcclusionTest.findBlockingTokens(visionTri, opts).size
      || ObstacleOcclusionTest.findBlockingRegions(visionTri, opts).size ) return true;
    return false;
  }

  /**
   * @param {Token} token
   * @param {object} [opts]
   * @param {PIXI.Polygon|PIXI.Rectangle} [opts.tokenShape]
   * @param {POINT_TYPES} [opts.pointAlgorithm]
   * @param {number} [opts.inset]
   * @param {Point3d} [opts.viewpoint]
   * @returns {Point3d[]}
   */
  static constructTokenPoints(token, { tokenShape, pointAlgorithm, inset, viewpoint } = {}) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const TYPES = Settings.KEYS.POINT_TYPES;
    const center = Point3d.fromTokenCenter(token);

    const tokenPoints = [];
    if ( pointAlgorithm === TYPES.CENTER
        || pointAlgorithm === TYPES.THREE
        || pointAlgorithm === TYPES.FIVE
        || pointAlgorithm === TYPES.NINE ) tokenPoints.push(center);

    if ( pointAlgorithm === TYPES.CENTER ) return tokenPoints;

    tokenShape ??= token.constrainedTokenBorder;
    let cornerPoints = this.getCorners(tokenShape, center.z);

    // Inset by 1 pixel or inset percentage;
    insetPoints(cornerPoints, center, inset);

    // If two points, keep only the front-facing points.
    // For targets, keep the closest two points to the viewer point.
    if ( pointAlgorithm === TYPES.TWO ) {
      if ( viewpoint ) {
        cornerPoints.forEach(pt => pt._dist = Point3d.distanceSquaredBetween(viewpoint, pt));
        cornerPoints.sort((a, b) => a._dist - b._dist);
        cornerPoints.splice(2);
      } else {
        // Token rotation is 0º for due south, while Ray is 0º for due east.
        // Token rotation is 90º for due west, while Ray is 90º for due south.
        // Use the Ray version to divide the token into front and back.
        const angle = Math.toRadians(token.document.rotation);
        const dirPt = PIXI.Point.fromAngle(center, angle, 100);
        cornerPoints = cornerPoints.filter(pt => foundry.utils.orient2dFast(center, dirPt, pt) <= 0);
      }
    }

    if ( pointAlgorithm === TYPES.THREE ) {
      if ( viewpoint ) {
        tokenPoints.shift(); // Remove the center point.
        cornerPoints.forEach(pt => pt._dist = Point3d.distanceSquaredBetween(viewpoint, pt));
        cornerPoints.sort((a, b) => a._dist - b._dist);

        // If 2 of the 4 points are equidistant, we are in line with the target and can stick to the top 2.
        const numPoints = cornerPoints[0]._dist === cornerPoints[1]._dist ? 2 : 3;
        cornerPoints.splice(numPoints);
      } else {
        // Token rotation is 0º for due south, while Ray is 0º for due east.
        // Token rotation is 90º for due west, while Ray is 90º for due south.
        // Use the Ray version to divide the token into front and back.
        const angle = Math.toRadians(token.document.rotation);
        const dirPt = PIXI.Point.fromAngle(center, angle, 100);
        cornerPoints = cornerPoints.filter(pt => foundry.utils.orient2dFast(center, dirPt, pt) <= 0);
      }
    }

    tokenPoints.push(...cornerPoints);
    if ( pointAlgorithm === TYPES.TWO
      || pointAlgorithm === TYPES.THREE
      || pointAlgorithm === TYPES.FOUR
      || pointAlgorithm === TYPES.FIVE ) return tokenPoints;

    // Add in the midpoints between corners.
    const ln = cornerPoints.length;
    let prevPt = cornerPoints.at(-1);
    for ( let i = 0; i < ln; i += 1 ) {
      // Don't need to inset b/c the corners already are.
      const currPt = cornerPoints[i];
      tokenPoints.push(Point3d.midPoint(prevPt, currPt));
      prevPt = currPt;
    }
    return tokenPoints;
  }

  /**
   * Helper that constructs 3d points for the points of a token shape (rectangle or polygon).
   * Uses the elevation provided as the z-value.
   * @param {PIXI.Polygon|PIXI.Rectangle} tokenShape
   * @parma {number} elevation
   * @returns {Point3d[]} Array of corner points.
   */
  static getCorners(tokenShape, elevation) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    if ( tokenShape instanceof PIXI.Rectangle ) {
      // Token unconstrained by walls.
      // Use corners 1 pixel in to ensure collisions if there is an adjacent wall.
      // PIXI.Rectangle.prototype.pad modifies in place.
      tokenShape = tokenShape.clone();
      tokenShape.pad(-1);
      return [
        new Point3d(tokenShape.left, tokenShape.top, elevation),
        new Point3d(tokenShape.right, tokenShape.top, elevation),
        new Point3d(tokenShape.right, tokenShape.bottom, elevation),
        new Point3d(tokenShape.left, tokenShape.bottom, elevation)
      ];
    }

    // Constrained is polygon. Only use corners of polygon
    // Scale down polygon to avoid adjacent walls.
    const padShape = tokenShape.pad(-2, { scalingFactor: 100 });
    return [...padShape.iteratePoints({close: false})].map(pt => new Point3d(pt.x, pt.y, elevation));
  }

  /**
   * Get polygons representing all grids under a token.
   * If token is constrained, overlap the constrained polygon on the grid shapes.
   * @param {Token} token
   * @return {PIXI.Polygon[]|PIXI.Rectangle[]|null}
   */
  static constrainedGridShapesUnderToken(token) {
    const gridShapes = this.gridShapesUnderToken(token);
    const constrained = token.constrainedTokenBorder;

    // Token unconstrained by walls.
    if ( constrained instanceof PIXI.Rectangle ) return gridShapes;

    // For each gridShape, intersect against the constrained shape
    const constrainedGridShapes = [];
    const constrainedPath = CONFIG[MODULE_ID].ClipperPaths.fromPolygons([constrained]);
    for ( let gridShape of gridShapes ) {
      if ( gridShape instanceof PIXI.Rectangle ) gridShape = gridShape.toPolygon();

      const constrainedGridShape = constrainedPath.intersectPolygon(gridShape).simplify();
      if ( constrainedGridShape instanceof CONFIG[MODULE_ID].ClipperPaths ) {
        // Ignore holes.
        const polys = constrainedGridShape.toPolygons().filter(poly => !poly.isHole && poly.points.length >= 6);
        if ( polys.length ) constrainedGridShapes.push(...polys);
      } else if ( constrainedGridShape instanceof PIXI.Polygon && constrainedGridShape.points.length >= 6 ) {
        constrainedGridShapes.push(constrainedGridShape);
      } else if ( constrainedGridShape instanceof PIXI.Rectangle ) {
        constrainedGridShapes.push(constrainedGridShape);
      }
    }

    return constrainedGridShapes;
  }

  /**
   * Get polygons representing all grids under a token.
   * @param {Token} token
   * @return {PIXI.Polygon[]|PIXI.Rectangle[]|null}
   */
  static gridShapesUnderToken(token) {
    if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) {
      // console.error("gridShapesUnderTarget called on gridless scene!");
      return [token.bounds];
    }
    return canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squaresUnderToken(token) : hexesUnderToken(token);
  }

  /**
   * Clean up memory-intensive objects.
   */
  destroy() {}

  /* ----- NOTE: Debug ----- */

  /**
   * For debugging.
   * Draw various debug guides on the canvas.
   * @param {Draw} draw
   */
  _drawCanvasDebug(debugDraw) {
    // this._drawLineOfSight(debugDraw);
    this._drawDetectedObjects(debugDraw);
    this._drawVisionTriangle(debugDraw);
  }

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight(debugDraw) {
    debugDraw ??= this.viewerLOS.config.debugDraw;
    debugDraw.segment({ A: this.viewpoint, B: this.targetLocation });
  }

  /**
   * For debugging.
   * Draw outlines for the various objects that can be detected on the canvas.
   */
  _drawDetectedObjects(debugDraw) {
    // if ( !this.#blockingObjects.initialized ) return;
    const { walls, tiles, tokens } = ObstacleOcclusionTest.findBlockingObjects(this.viewpoint, this.target,
      { viewer: this.viewer, senseType: this.config.senseType, blocking: this.config.blocking });
    const terrainWalls = ObstacleOcclusionTest.pullOutTerrainWalls(walls, this.config.senseType);
    debugDraw ??= this.viewerLOS.config.debugDraw;
    const colors = Draw.COLORS;

    walls.forEach(wall => debugDraw.segment(wall, { color: colors.red }));
    // tiles.forEach(tile => debugDraw.shape(tile.bounds, { color: colors.yellow }));
    tiles.forEach(tile => tile.tokenvisibility.geometry.triangles.forEach(tri => tri.draw2d({ draw: debugDraw, color: Draw.COLORS.yellow, fillAlpha: 0.1, fill: Draw.COLORS.yellow })));
    terrainWalls.forEach(wall => debugDraw.segment(wall, { color: colors.lightgreen }));
    tokens.forEach(token => debugDraw.shape(token.constrainedTokenBorder, { color: colors.orange, fillAlpha: 0.2 }));
  }

  /**
   * For debugging.
   * Draw the vision triangle between viewer point and target.
   */
  _drawVisionTriangle(debugDraw) {
    debugDraw ??= this.viewerLOS.config.debugDraw;
    const visionTri = ObstacleOcclusionTest.visionTriangle.rebuild(this.viewpoint, this.target);
    visionTri.draw({ draw: debugDraw, width: 0, fill: CONFIG.GeometryLib.Draw.COLORS.gray, fillAlpha: 0.1 });
  }
}
