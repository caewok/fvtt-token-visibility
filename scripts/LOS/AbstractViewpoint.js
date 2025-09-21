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
import { Frustum } from "./Frustum.js";
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

  /** @type {Frustum} */
  static frustum = new Frustum();

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

  get debug() { return this.viewerLOS.debug; }

  set debug(value) { this.viewerLOS.debug = value; }


  // ----- NOTE: Visibility Percentages ----- //
  _percentVisible;

  lastResult;

  get percentVisible() {
    if ( typeof this._percentVisible === "undefined" ) this._percentVisible = this.lastResult.percentVisible;
    return this._percentVisible;
  }

  calculate() {
    this._percentVisible = undefined;
    if ( this.passesSimpleVisibilityTest() ) {
      this._percentVisible = 1;
      return;
    }
    this.calculator.viewpoint = this.viewpoint;
    this.lastResult = this.calculator.calculate().clone();
    if ( this.debug ) this._drawCanvasDebug(this.viewerLOS.debugDrawForViewpoint(this));
  }

  targetOverlapsViewpoint() {
    const bounds = this.calculator.targetShape;
    if ( !bounds.contains(this.viewpoint.x, this.viewpoint.y) ) return false;
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
    return this.targetOverlapsViewpoint();
  }

  // ----- NOTE: Collision tests ----- //
  /**
   * Test if we have one or more potentially blocking objects. Does not check for whether
   * the objects in fact block but does require two terrain walls to count.
   * @returns {boolean} True if some blocking placeable within the vision triangle.
   *
   */
  hasPotentialObstaclesfromViewpoint(viewpoint = this.viewpoint) {
    const { viewer, target, config } = this;
    const opts = {
      senseType: config.senseType,
      viewer,
      target,
      blocking: config.blocking,
    };
    const frustum = ObstacleOcclusionTest.frustum.rebuild({ viewpoint, target });
    const walls = ObstacleOcclusionTest.findBlockingWalls(frustum, opts);
    if ( walls.size > 1 ) return true; // 2+ walls or 2+ terrain walls present.
    if ( walls.size && !walls.first().edge.isLimited(opts.senseType) ) return true; // Single non-limited wall present.
    if ( ObstacleOcclusionTest.findBlockingTiles(frustum, opts).size
      || ObstacleOcclusionTest.findBlockingTokens(frustum, opts).size
      || ObstacleOcclusionTest.findBlockingRegions(frustum, opts).size ) return true;
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
  static constrainedGridShapesUnderToken(token, tokenShape) {
    const gridShapes = this.gridShapesUnderToken(token);

    // Token unconstrained by walls.
    if ( token.tokenBorder.equals(tokenShape) ) return gridShapes;

    // For each gridShape, intersect against the constrained shape
    const constrainedGridShapes = [];
    const constrainedPath = CONFIG[MODULE_ID].ClipperPaths.fromPolygons([tokenShape]);
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
    this._drawLineOfSight(debugDraw);
    this._drawDetectedObjects(debugDraw);
    this._drawFrustum(debugDraw);
  }

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight(draw) {
    draw.segment({ A: this.viewpoint, B: this.targetLocation });
  }

  /**
   * For debugging.
   * Draw outlines for the various objects that can be detected on the canvas.
   */
  _drawDetectedObjects(draw) {
    const colors = Draw.COLORS;
    const OBSTACLE_COLORS = {
      walls: colors.lightred,
      terrainWalls: colors.lightgreen,
      proximateWalls: colors.lightblue,
      tiles: colors.yellow,
      tokens: colors.orange,
      regions: colors.red,
    }
    for ( const [key, obstacles] of Object.entries(this.calculator.occlusionTester.obstacles) ) {
      const color = OBSTACLE_COLORS[key];
      switch ( key ) {
        case "walls":
        case "terrainWalls":
        case "proximateWalls":
          obstacles.forEach(wall => draw.segment(wall, { color }));
          break;
        case "tiles":
          obstacles.forEach(tile => tile.tokenvisibility.geometry.triangles.forEach(tri =>
            tri.draw2d({ draw, color, fillAlpha: 0.1, fill: color })));
          break;
        case "tokens":
          obstacles.forEach(token => draw.shape(token.constrainedTokenBorder, { color, fillAlpha: 0.2 }));
          break;
        case "regions":
          obstacles.forEach(region => region.tokenvisibility.geometry.triangles.forEach(tri =>
            tri.draw2d({ draw, color, fillAlpha: 0.1, fill: color})
          ));
          break;
      }
    }
  }

  /**
   * For debugging.
   * Draw the vision triangle between viewer point and target.
   */
  _drawFrustum(draw) {
    const { viewpoint, target } = this;
    const frustum = ObstacleOcclusionTest.frustum.rebuild({ viewpoint, target });
    frustum.draw2d({ draw, width: 0, fill: CONFIG.GeometryLib.Draw.COLORS.gray, fillAlpha: 0.1 });
  }
}
