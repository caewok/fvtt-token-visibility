/* globals
canvas,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID, TRACKER_IDS } from "../../const.js";
import { Settings } from "../../settings.js";

// LOS folder
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { ViewerLOS } from "../ViewerLOS.js";
import { DebugVisibilityViewerArea3dPIXI } from "../DebugVisibilityViewer.js";
import { SmallBitSet } from "../SmallBitSet.js";
import { FastBitSet } from "../FastBitSet/FastBitSet.js";
import { squaresUnderToken, hexesUnderToken } from "../shapes_under_token.js";
import { Camera } from "../Camera.js";

// Placeable tracking


// Geometry
import { Point3d } from "../../geometry/3d/Point3d.js";
import { Draw } from "../../geometry/Draw.js";

/*
Points algorithm also can use area and threshold.
Number of points tested is the total area; points without collision represent % viewable area.

Dim and bright lighting test options:
1. Point is within litTokenBorder
2. Point not obscured from light and within light radius

*/

/*
Points lattice:

Normal:
Some faces (surface) not visible; null
Each visible (facing) face:
- all points for face are either visible or not visible
- point within radius
- point visible = true
- point not occluded
Percent visible = Total across visible faces: counted points / total points

Spherical:
Single face (surface)
All points:
- point within radius
- point visible (facing)
- point not occluded
Percent visible = counted visible points / visible points

PointsCalc:
Each face (surface) is a large token grid space.
All faces visible
Each face:
- point within radius
- point visible = true
- point not occluded
Percent visible = maximum for each face: counted points / total points


*/

export class PercentVisiblePointsResultAbstract extends PercentVisibleResult {

  // Which faces or large token portions are represented?
  // Non-facing faces or non-tested faces/groups will be empty in the array.
  data = {
    unobscured: [],       // Visible and unobscured.
    visible: [],          // Visible at this viewpoint but possibly obscured.
    numPoints: [],        // Total points for this surface.
  };

  logData() {
    console.table({
      numPoints: this.data.numPoints,
      visible: this.data.visible.map(bs => bs?.cardinality),
      unobscured: this.data.unobscured.map(bs => bs?.cardinality),
    });
  }

  clone() {
    const out = super.clone();
    for ( let i = 0, iMax = this.data.unobscured.length; i < iMax; i += 1 ) {
      if ( !this.data.unobscured[i] ) continue;
      out.data.unobscured[i] = this.data.unobscured[i].clone();
      out.data.visible[i] = this.data.visible[i].clone();
      // Points should have already been cloned.
    }
    return out;
  }

  get totalTargetArea() {
    // Skip empty faces.
    let total = 0;
    const { unobscured, numPoints } = this.data;
    for ( let i = 0, iMax = unobscured.length; i < iMax; i += 1 ) {
      if ( unobscured[i] ) total += numPoints[i];
    }
    return total || 1;
  }

  get largeTargetArea() { return this.totalTargetArea; }

  get visibleArea() { return this.data.unobscured.reduce((acc, curr) => acc + (curr?.cardinality || 0), 0); }

  /**
   * Blend this result with another result, taking the maximum values at each test location.
   * Used to treat viewpoints as "eyes" in which 2+ viewpoints are combined to view an object.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMaximize(other) {
    let out = super.blendMaximize(other);
    if ( out ) return out;
    out = this.clone();
    for ( let i = 0, iMax = out.data.numPoints.length; i < iMax; i += 1 ) {
      // Combine each face in turn.
      if ( out.data.unobscured[i] && other.data.unobscured[i] ) {
        out.data.unobscured[i].union(other.data.unobscured[i]);
        out.data.visible[i].union(other.data.visible[i]);
        out.data.numPoints[i] = Math.max(out.data.numPoints[i], other.data.numPoints[i]);
      }
      else if ( other.data.unobscured[i] ) { // this.data for index i is empty.
        out.data.unobscured[i] = other.data.unobscured[i].clone();
        out.data.visible[i] = other.data.visible[i].clone();
        out.data.numPoints[i] = other.data.numPoints[i];
      } // Else other.data for index i is empty.
    }
    return out;
  }

  /**
   * Blend this result with another result, taking the minimum values at each test location.
   * Used to screen out viewpoints, such as with light meter testing of dim or bright non-occluded points.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMinimize(other) {
    let out = super.blendMinimize(other);
    if ( out ) return out;
    out = this.clone();
    for ( let i = 0, iMax = out.data.numPoints.length; i < iMax; i += 1 ) {
      // Combine each face in turn.
      if ( out.data.unobscured[i] && other.data.unobscured[i] ) {
        out.data.unobscured[i].intersection(other.data.unobscured[i]);
        out.data.visible[i].intersection(other.data.visible[i]);
        out.data.numPoints[i] = Math.min(out.data.numPoints[i], other.data.numPoints[i]);

      } else if ( this.data.unobscured[i] ) {
        // Other data slot is empty, so this one should be made empty as well.
        out.data.unobscured[i] = other.data.unobscured[i];
        out.data.visible[i] = other.data.visible[i];
      } // Otherwise this data slot is empty; keep.
    }
    return out;
  }
}

/**
 * @typedef {object} PointsCalculatorConfig
 * ...{CalculatorConfig}
 * @property {number} [targetPointIndex=1]  	    					Points configuration for the target
 * @property {number} [targetInset=0.75]                    Offset target points from target border
 * @property {number} [radius=Infinity]                     Distance at which visibility stops
 */

/**
 * Handle points algorithm.
 */
export class PercentVisibleCalculatorPointsAbstract extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisiblePointsResultAbstract;

  static BitSetClass = FastBitSet;

  static defaultConfiguration = {
    ...super.defaultConfiguration,
    testSurfaceVisibility: true,
  };

  _calculate() {
    // console.debug("PointsCalculator|_calculate");
    return this._testAllSurfaces(this.targetPoints, this.targetSurfaces);
  }

  /**
   * @param {Point3d[][]} points
   * @param {(Polygon3d|Sphere)[]} surfaces
   */
  _testAllSurfaces(points, surfaces) {
    // console.debug("PointsCalculator|_testAllSurfaces");
    surfaces ??= Array(points.length);
    const testSurfaceVisibility = this._config.testSurfaceVisibility;
    const result = this._createResult();
    const n = points.length;
    result.data.numPoints = points.map(pts => pts.length);
    result.data.unobscured.length = n;
    result.data.visible.length = n;
    for ( let i = 0; i < n; i += 1 ) {
      const surface = surfaces[i];
      if ( testSurfaceVisibility && !this.surfaceIsVisible(surface) ) continue;
      const { unobscured, visible } = this._testPointsForSurface(surface, points[i]);
      result.data.unobscured[i] = unobscured;
      result.data.visible[i] = visible;
    }
    return result;
  }

  surfaceIsVisible(_surface) { return true; }

  /* ----- NOTE: Target points ----- */

  /** @type {Polygon3d[]} */
  get targetSurfaces() {
    const faces = this.target[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].faces;
    return [faces.top, faces.bottom, ...faces.sides];
  }

  /** @type {Point3d[][]} */
  get targetPoints() {
    const facePoints = this.target[MODULE_ID][TRACKER_IDS.GEOMETRY.PLACEABLE].facePoints;
    return [facePoints.top, facePoints.bottom, ...facePoints.sides];
  }

  _testPointsForSurface(targetSurface, targetPoints) {
    // console.debug("PointsCalculator|_testPointsForSurface");
    const unobscured = new this.constructor.BitSetClass();
    const visible = new this.constructor.BitSetClass();
    const radius2 = this.radius ** 2;
    for ( let i = 0, n = targetPoints.length; i < n; i += 1 ) {
      const pt = targetPoints[i];
      if ( !this.pointIsVisible(pt, radius2) ) continue;
      visible.add(i);
      // console.debug(`\nPoint: ${pt}, viewpoint: ${this.viewpoint}, direction: ${this.#rayDirection}`);
      if ( !this.pointIsOccluded(pt) ) {
        const a = 1;
        // console.debug(`Point: ${pt}, viewpoint: ${this.viewpoint}, direction: ${this.#rayDirection} (Unoccluded Test #1)`);
      }
      if ( this.pointIsOccluded(pt) ) {
        const a = 2;
        // console.debug(`Point: ${pt}, viewpoint: ${this.viewpoint}, direction: ${this.#rayDirection} (Occluded Test #2)`);
        continue;
      }
      // console.debug(`Point: ${pt}, viewpoint: ${this.viewpoint}, direction: ${this.#rayDirection} (Unoccluded Test #2)`);
      unobscured.add(i);
    }

    return { unobscured, visible };
  }

  pointIsVisible(pt, radius2 = this.radius ** 2) {
    return Point3d.distanceSquaredBetween(this.viewpoint, pt) <= radius2;
  }

  /**
   * Given a point in 3d space (presumably on a token face), test for occlusion between it and viewpoint.
   * @param {Point3d} fragmentPoint
   * @returns {boolean} True if occluded.
   */
  #rayDirection = new Point3d();

  pointIsOccluded(pt) {
    // Is it occluded from the camera/viewer?
    pt.subtract(this.viewpoint, this.#rayDirection);
    // this.#rayDirection = pt.subtract(this.viewpoint);
    return this.occlusionTester._rayIsOccluded(this.#rayDirection);
  }

  // ----- NOTE: Debug ----- //

  _drawCanvasDebug(result, debugDraw) {
    super._drawCanvasDebug(result, debugDraw);
    this._drawDebugPoints(result, debugDraw);
  }

  _drawDebugPoints(result, debugDraw) {
    const colors = Draw.COLORS;
    const targetPoints = this.targetPoints;
    const { unobscured, numPoints } = result.data;
    const vp = this.viewpoint;
    const segment = { a: vp, b: null };
    for ( let i = 0, iMax = unobscured.length; i < iMax; i += 1 ) {
      const bs = unobscured[i];
      const pts = targetPoints[i];
      const n = numPoints[i];
      for ( let j = 0; j < n; j += 1 ) {
        segment.b = pts[j];
        if ( !bs ) {
          // Point never tested.
          const color = colors.orange;
          debugDraw.segment(segment, { color, dashLength: 10, gapLength: 10 });
          continue;
        }
        const isVisible = bs.has(j);
        const color = isVisible ? colors.blue : colors.red;
        debugDraw.segment(segment, { color });
      }
    }
  }

  /** @type {Camera} */
  #camera;

  get camera() {
    return this.#camera || (this.#camera = new Camera({
      glType: "webGL2",
      perspectiveType: "perspective",
      up: new Point3d(0, 0, -1),
      mirrorMDiag: new Point3d(1, 1, 1),
    }));
  }

  /**
   * Set the camera's position and look at position.
   */
  _initializeCamera() {
    const camera = this.camera;
    camera.cameraPosition = this.viewpoint;
    camera.targetPosition = this.targetLocation;
    camera.setTargetTokenFrustum(this.target);
  }

  /**
   * Transform a 3d point to a 2d perspective for point of view of viewpoint.
   * @param {Point3d} pt
   * @returns {PIXI.Point|null} pt or null if the point is positive z after look at transform.
   */
  _applyPerspectiveToPoints(pts) {
    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;
    pts = pts.map(pt => lookAtM.multiplyPoint3d(pt));

    /*
    if ( filter ) {
      pts = pts.filter(pt => pt.z < 0);
      return pts.map(pt => perspectiveM.multiplyPoint3d(pt, pt));
    }
    */
    return pts.map(pt => {
      if ( pt.z >= 0 ) return null;
      return perspectiveM.multiplyPoint3d(pt, pt);
    });
  }

  _applyPerspectiveToPolygon(poly) {
    const lookAtM = this.camera.lookAtMatrix;
    const perspectiveM = this.camera.perspectiveMatrix;
    poly = poly.transform(lookAtM).clipZ();
    poly.transform(perspectiveM, poly);
    return poly.isValid ? poly : null;
  }

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(result, draw, { width = 100, height = 100 } = []) {
    const mult = PIXI.Point.tmp.set(width, height);
    const a = PIXI.Point.tmp;
    const opts = {
      color: Draw.COLORS.blue,
      radius: 2,
      alpha: 0.5,
    };

    this._initializeCamera();

    // Draw the token border for reference.
    const faces = this.target.tokenvisibility.geometry.faces;
    const viewpoint = this.viewpoint
    const drawOpts = { draw, color: Draw.COLORS.black, alpha: 0.5, fill: null }
    for ( const face of [faces.top, faces.bottom, ...faces.sides] ) {
      if ( !face.isFacing(viewpoint) ) {
        drawOpts.alpha = 0.3;
        drawOpts.color = Draw.COLORS.gray;
      } else {
        drawOpts.color = Draw.COLORS.black;
        drawOpts.alpha = 0.8;
      }
      const perspPoly = this._applyPerspectiveToPolygon(face);
      if ( !perspPoly ) continue;
      perspPoly.scale({ x: width, y: height}).draw2d(drawOpts);
    }

    // Draw the token points.
    const targetPoints = this.targetPoints;
    const unobscured = result.data.unobscured;
    for ( let i = 0, iMax = unobscured.length; i < iMax; i += 1 ) {
      const bs = unobscured[i];
      if ( !bs ) continue;

      const pts = this._applyPerspectiveToPoints(targetPoints[i]);
      for ( let j = 0, jMax = pts.length; j < jMax; j += 1 ) {
        const pt = pts[j];
        if ( !pt ) continue;
        opts.color = bs.has(j) ? Draw.COLORS.blue : Draw.COLORS.red;
        draw.point(pt.multiply(mult, a), opts);
      }
    }
    mult.release();
    a.release();
  }
}

export class PercentVisiblePointsResult extends PercentVisiblePointsResultAbstract {
   get percentVisible() {
    // For points, the maximum unobscured points divided by points for a given area.
    const { unobscured, numPoints } = this.data;
    let maxPercent = 0;
    for ( let i = 0, iMax = unobscured.length; i < iMax; i += 1 ) {
      const bs = unobscured[i];
      if ( !bs ) continue; // Skipped this face/group.
      maxPercent = Math.max(maxPercent, bs.cardinality / numPoints[i]);
      if ( maxPercent >= 1 ) break;
    }
    return maxPercent;
  }
}


export class PercentVisibleCalculatorPoints extends PercentVisibleCalculatorPointsAbstract {
  static resultClass = PercentVisiblePointsResult

  static BitSetClass = SmallBitSet;

  static defaultConfiguration = {
    ...super.defaultConfiguration,
    targetPointIndex: 1, // Center only
    targetInset: 0.75,
  }

  get config() { return super.config; } // Must call parent to avoid having no getter here.

  set config(cfg = {}) {
    if ( Object.hasOwn(cfg, "targetPointIndex")
      && cfg.targetPointIndex instanceof SmallBitSet ) cfg.targetPointIndex = cfg.targetPointIndex.word;
    super.config = cfg;
  }

  /**
   * Build a set of 3d points on a given token shape, dependent on settings and shape.
   * @type {Point3d[][]}
   */
  get targetPoints() {
    const target = this.target;
    const { targetPointIndex, targetInset } = this.config;
    const cfg = {
      pointKey: targetPointIndex,
      inset: targetInset,
      viewpoint: this.viewpoint,
      tokenShape: null,
    };
    const targetShapes = this._config.largeTarget // Construct points for each target subshape, defined by grid spaces under the target.
      ? this.constructor.gridShapesUnderToken(this.target) : [this.target.tokenBorder];
    if ( !targetShapes.length ) targetShapes.push(this.targetShape);
    return targetShapes.map(shape => {
      cfg.tokenShape = shape;
      return ViewerLOS.constructTokenPoints(target, cfg);
    });
  }

  /**
   * Get polygons representing all grids under a token.
   * @param {Token} token
   * @return {PIXI.Polygon[]|PIXI.Rectangle[]|null}
   */
  static gridShapesUnderToken(token) {
    if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) return [token.tokenBorder];
    return canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squaresUnderToken(token) : hexesUnderToken(token);
  }
 }


export class DebugVisibilityViewerPoints extends DebugVisibilityViewerArea3dPIXI {
  algorithm = Settings.KEYS.LOS.TARGET.TYPES.POINTS;

  /** @type {Token[]} */
//   get viewers() { return canvas.tokens.controlled; }

  /** @type {Token[]} */
//   get targets() { return game.user.targets.values(); }

  /**
   * Triggered whenever a token is refreshed.
   * @param {Token} token
   * @param {RenderFlags} flags
   */
//   onRefreshToken(token, flags) {
//     if ( !(this.viewers.some(viewer => viewer === token)
//         || this.targets.some(target => target === token)) ) return;
//     if ( !(flags.refreshPosition
//         || flags.refreshElevation
//         || flags.refreshSize ) ) return;
//     this.render();
//   }
}

/*
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw
api = game.modules.get("tokenvisibility").api
PercentVisibleCalculatorPoints = api.calcs.points
zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")
randal = canvas.tokens.placeables.find(t => t.name === "Randal")

calc = new PercentVisibleCalculatorPoints()
calc.viewer = randal
calc.target = zanna
calc.viewpoint = Point3d.fromTokenCenter(calc.viewer)
calc.targetLocation = Point3d.fromTokenCenter(calc.target)
calc.calculate()

debugViewer = api.buildDebugViewer(api.debugViewers.points)
await debugViewer.initialize();
debugViewer.render();

atv = randal.tokenvisibility.visibility
atv.percentVisibilityToToken(zanna)

SmallBitSet = api.SmallBitSet


*/

