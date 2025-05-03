/* globals
CONFIG,
canvas,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { Settings } from "../settings.js";
import { MODULE_ID } from "../const.js";
import { buildCustomLOSCalculator } from "../LOSCalculator.js";

// LOS folder
import { AbstractViewerLOS } from "./AbstractViewerLOS.js";
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { PercentVisibleCalculatorAbstract } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerAbstract } from "./DebugVisibilityViewer.js";


/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class PointsViewpoint extends AbstractViewpoint {
  calc = CONFIG[MODULE_ID].sightCalculators.points;
}

/**
 * Handle points algorithm.
 */
export class PercentVisibleCalculatorPoints extends PercentVisibleCalculatorAbstract {

  _config = {
    ...super._config,
    pointAlgorithm: AbstractViewerLOS.POINT_TYPES.CENTER,
    targetInset: 0.75,
    points3d: false,
  };

  set config(cfg = {}) {
    if ( cfg.pointAlgorithm && !Object.values().some(value => value === cfg.pointAlgorithm) ) {
      console.error(`${this.constructor.name}|Point algorithm ${cfg.pointAlgorithm} not recognized.`)
    }
    super.config = cfg;
  }

  /** @type {Points3d[][]} */
  targetPoints = [];

  _calculatePercentVisible(viewer, target, viewerLocation, _targetLocation) {
    this.viewpoint = viewerLocation;
    this.visibleTargetShape = this._calculateVisibleTargetShape(target);
    this.filterPotentiallyBlockingPolygons(viewer, viewerLocation, target);
    this.targetPoints = this.constructTargetPoints(target);
  }

  _percentRedPixels() {
    return (1 - this._testTargetPoints(this.targetPoints, this.viewpoint, this.visibleTargetShape));
  }

  /* ----- NOTE: Target points ----- */

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

  /*
   * Similar to _constructViewerPoints but with a complication:
   * - Grid. When set, points are constructed per grid space covered by the token.
   * @param {Token} target
   * @returns {Points3d[][]}
   */
  constructTargetPoints(target) {
    const { pointAlgorithm, targetInset, points3d, largeTarget } = this.config;
    const cfg = { pointAlgorithm, inset: targetInset, viewpoint: this.viewpoint };

    if ( largeTarget ) {
      // Construct points for each target subshape, defined by grid spaces under the target.
      const targetShapes = PointsViewpoint.constrainedGridShapesUnderToken(target);

      // Issue #8: possible for targetShapes to be undefined or not an array??
      if ( targetShapes && targetShapes.length ) {
        const targetPointsArray = targetShapes.map(targetShape => {
          cfg.tokenShape = targetShape;
          const targetPoints = AbstractViewpoint.constructTokenPoints(target, cfg);
          if ( points3d ) return PointsViewpoint.elevatePoints(target, targetPoints);
          return targetPoints;
        });
        return targetPointsArray;
      }
    }

    // Construct points under this constrained token border.
    cfg.tokenShape = target.constrainedTokenBorder;
    const targetPoints = AbstractViewpoint.constructTokenPoints(target, cfg);
    if ( points3d ) return [PointsViewpoint.elevatePoints(target, targetPoints)];
    return [targetPoints];
  }

  /* ----- NOTE: Collision testing ----- */

  /** @param {Polygon3d[]} */
  polygons = [];

  /** @param {Polygon3d[]} */
  terrainPolygons = [];

  /**
   * Filter the polygons that might block the viewer from the target.
   */
  filterPotentiallyBlockingPolygons(viewer, viewerLocation, target) {
    this.polygons.length = 0;
    this.terrainPolygons.length = 0;
    const blockingObjects = AbstractViewpoint.findBlockingObjects(viewerLocation, target,
      { viewer, senseType: this.senseType, blockingOpts: this.config.blocking });

    const { terrainWalls, tiles, tokens, walls } = blockingObjects;
    for ( const terrainWall of terrainWalls ) {
      const polygons = AbstractViewpoint.filterPlaceablePolygonsByViewpoint(terrainWall, viewerLocation);
      this.terrainPolygons.push(...polygons);
    }
    for ( const placeable of [...tiles, ...tokens, ...walls] ) {
      const polygons = AbstractViewpoint.filterPlaceablePolygonsByViewpoint(placeable, viewerLocation);
      this.polygons.push(...polygons);
    }
  }

  /* ----- NOTE: Visibility testing ----- */


  _calculateVisibleTargetShape(target) {
    return this.config.useLitTargetShape
      ? AbstractViewerLOS.constructLitTargetShape(target) : target.constrainedTokenBorder;
  }

  /**
   * Test an array of token points against an array of target points.
   * Each tokenPoint will be tested against every array of targetPoints.
   * @param {Point3d[][]} targetPointsArray   Array of array of target points to test.
   * @returns {number} Minimum percent blocked for the token points
   */
  _testTargetPoints(targetPointsArray, viewpoint, visibleTargetShape) {
    targetPointsArray ??= this.targetPoints;
    visibleTargetShape ??= this.visibleTargetShape;
    let minBlocked = 1;
    if ( this.config.debug ) this.debugPoints.length = 0;
    for ( const targetPoints of targetPointsArray ) {
      const percentBlocked = this._testPointToPoints(targetPoints, viewpoint, visibleTargetShape);

      // We can escape early if this is completely visible.
      if ( !percentBlocked ) return 0;
      minBlocked = Math.min(minBlocked, percentBlocked);
    }
    return minBlocked;
  }

  debugPoints = [];

  /**
   * Helper that tests collisions between a given point and a target points.
   * @param {Point3d} tokenPoint        Point on the token to use.
   * @param {Point3d[]} targetPoints    Array of points on the target to test
   * @returns {number} Percent points blocked
   */
  _testPointToPoints(targetPoints, viewpoint, visibleTargetShape) {
    let numPointsBlocked = 0;
    const ln = targetPoints.length;
    // const debugDraw = this.config.debugDraw;
    let debugPoints = [];
    if ( this.config.debug ) this.debugPoints.push(debugPoints);
    for ( let i = 0; i < ln; i += 1 ) {
      const targetPoint = targetPoints[i];
      const outsideVisibleShape = visibleTargetShape
        && !visibleTargetShape.contains(targetPoint.x, targetPoint.y);
      if ( outsideVisibleShape ) continue;

      // For the intersection test, 0 can be treated as no intersection b/c we don't need
      // intersections at the origin.
      // Note: cannot use Point3d._tmp with intersection.
      // TODO: Does intersection return t values if the intersection is outside the viewpoint --> target?
      let nCollisions = 0;
      let hasCollision = this.polygons.some(tri => tri.intersection(viewpoint, targetPoint.subtract(viewpoint)))
        || this.terrainPolygons.some(tri => {
        nCollisions += Boolean(tri.intersection(viewpoint, targetPoint.subtract(viewpoint)));
        return nCollisions >= 2;
      });
      numPointsBlocked += hasCollision;

      if ( this.config.debug ) {
        debugPoints = { A: viewpoint, B: targetPoint, hasCollision };
//         const color = hasCollision ? Draw.COLORS.red : Draw.COLORS.green;
//         debugDraw.segment({ A: viewpoint, B: targetPoint }, { alpha: 0.5, width: 1, color });
//         console.log(`Drawing segment ${viewpoint.x},${viewpoint.y} -> ${targetPoint.x},${targetPoint.y} with color ${color}.`);
      }
    }
    return numPointsBlocked / ln;
  }
}

export class DebugVisibilityViewerPoints extends DebugVisibilityViewerAbstract {
  /** @type {class} */
  // static popoutClass = Area3dPopout; // PIXI version

  /** @type {Token[]} */
  get viewers() { return canvas.tokens.controlled; }

  /** @type {Token[]} */
  get targets() { return game.user.targets.values(); }

  /** @type {object} */
  config = {
    useLitTargetShape: false,
  };

  constructor(opts) {
    super(opts);
  }

  render() {
    const { targets, viewers } = this;

    if ( !(targets.length || viewers.length) ) return this.clearDebug();
    this.clearDebug();

    // Calculate points and pull the debug data.
    for ( const viewer of viewers) {
      this.calc.viewer = viewer;

      for ( const target of targets) {
        if ( viewer === target ) continue;
        this.calc.target = target;
        this.calc._drawCanvasDebug();
        this.calc.percentVisible(target);
      }
    }
  }

  percentVisible(viewer, target, _viewerLocation, _targetLocation) {
    this.calc.viewer = viewer;
    return this.calc.percentVisible(target);
  }

  /** @type {AbstractViewer} */
  #calc;

  get calc() {
    if ( this.#calc ) return this.#calc;
    this.#calc = buildCustomLOSCalculator(this.viewers[0], Settings.KEYS.LOS.TARGET.TYPES.POINTS);
    this.#calc.config.viewpointClass = PointsViewpoint;
    this.#calc.config.debug = true;
    this.#calc.config.debugDraw = this.debugDraw;
    return this.#calc;
  }

  /**
   * Triggered whenever a token is refreshed.
   * @param {Token} token
   * @param {RenderFlags} flags
   */
  onRefreshToken(token, flags) {
    if ( !(this.viewers.some(viewer => viewer === token)
        || this.targets.some(target => target === token)) ) return;
    if ( !(flags.refreshPosition
        || flags.refreshElevation
        || flags.refreshSize ) ) return;
    this.render();
  }
}
