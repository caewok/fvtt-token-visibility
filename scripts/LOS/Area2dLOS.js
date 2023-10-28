/* globals
canvas,
CONFIG,
foundry,
objectsEqual,
PIXI
*/
"use strict";

import { AlternativeLOS } from "./AlternativeLOS.js";

// Base folder
import { MODULES_ACTIVE } from "../const.js";
import { buildTokenPoints } from "./util.js";
import { Settings, SETTINGS } from "../Settings.js";
import { CWSweepInfiniteWallsOnly } from "../CWSweepInfiniteWallsOnly.js";

// Geometry folder
import { Shadow } from "../geometry/Shadow.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";

/* Area 2d
1. Center point shortcut:
  -- Center is visible, then at least 50% of the token must be visible
  -- Because we are constraining the top/bottom token shape, so center always there.
2. Constrain the target shape by any overlapping walls.
3. Construct LOS polygon with shadows.
  -- Looking down: from elevation of target top
  -- Looking up: from elevation of target bottom
  -- In between: use both; take the best one.
4. PercentArea 0 shortcut: Try testing for a breach of the LOS boundary.
5. Intersect the LOS against the constrained target shape. Measure area.
6. Calculate intersected area / constrained target shape area.

*/

/* Testing
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
api = game.modules.get("tokenvisibility").api;
Area2dLOS = api.Area2dLOS;

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;

calc = new Area2dLOS(viewer, target)
calc.hasLOS()
calc.percentVisible()

*/


export class Area2dLOS extends AlternativeLOS {

  /**
   * Scaling factor used with Clipper
   */
  static SCALING_FACTOR = 100;

  /**
   * @typedef {Area2dLOSConfig}  Configuration settings for this class.
   * @type {AlternativeLOSConfig}
   * @property {CONST.WALL_RESTRICTION_TYPES} type    Type of source (light, sight, etc.)
   * @property {boolean} wallsBlock                   Can walls block in this test?
   * @property {boolean} tilesBlock                   Can tiles block in this test?
   * @property {boolean} deadTokensBlock              Can dead tokens block in this test?
   * @property {boolean} liveTokensBlock              Can live tokens block in this test?
   * @property {boolean} proneTokensBlock             Can prone tokens block in this test?
   * @property {boolean} debug                        Enable debug visualizations.
   *
   * Added by this subclass:
   * @property {VisionSource} visionSource            The vision source of the viewer. Required.
   */

  /**
   * @param {Point3d|Token|VisionSource} viewer       Object from which to determine line-of-sight
   *   If more than token center is required, then this must be a Token or VisionSource
   * @param {Token} target                            Object to test for visibility
   * @param {AlternativeLOSConfig} [config]
   */
  constructor(viewer, target, config) {
    if ( viewer instanceof Token ) viewer = viewer.vision;
    if ( viewer instanceof VisionSource ) config.visionSource ??= viewer;
    super(viewer, target, config);
    this.#configure(config);
  }

  #configure(config = {}) {
    if ( !config.visionSource ) { console.error("Area2dLOS requires a visionSource."); }
    const cfg = this.config;
    cfg.visionSource = config.visionSource ?? canvas.tokens.controlled[0] ?? [...canvas.tokens.placeables][0];
  }

  /**
   * Determine the grid square area for use when dealing with large tokens.
   * @returns {number}
   */
  static get gridSquareArea() {
    const size = canvas.scene.dimensions.size;
    if ( canvas.grid.isHex ) {
      // https://en.wikipedia.org/wiki/Hexagon
      const radius = size * 0.5;
      return 1.5 * Math.SQRT3 * radius * radius;
    } else return size * size;
  }

  /**
   * Determine whether a viewer has line-of-sight to a target based on meeting a threshold.
   * LOS is based on the percent area of the 2d (overhead) token shape is visible from the
   * viewer point.
   * @param {number} [threshold]    Percentage area required
   * @returns {boolean}
   */
  hasLOS(threshold) {
    const debug = this.config.debug;
    const draw = debug ? new Draw(Settings.DEBUG_LOS) : undefined;

    // Start with easy cases, in which the center point is determinative.
    if ( !this.config.visibleTargetShape || this.config.visibleTargetShape instanceof PIXI.Rectangle ) {
      const targetCenter = Point3d.fromTokenCenter(this.target);
      const centerPointIsVisible = !this._hasCollision(this.viewerPoint, targetCenter);

      // If less than 50% of the token area is required to be viewable, then
      // if the center point is viewable, the token is viewable from that source.
      if ( centerPointIsVisible && threshold < 0.50 ) {
        if ( debug ) draw.point(this.target.center, {
          alpha: 1,
          radius: 3,
          color: Draw.COLORS.green });
        return true;
      }

      // If more than 50% of the token area is required to be viewable, then
      // the center point must be viewable for the token to be viewable from that source.
      // (necessary but not sufficient)
      if ( !centerPointIsVisible && threshold >= 0.50 ) {
        if ( debug ) draw.point(this.target.center, {
          alpha: 1,
          radius: 3,
          color: Draw.COLORS.red });
        return false;
      }
    }

    const shadowLOS = this._buildShadowLOS();

    // TODO: Can this be fixed?
    //     if ( threshold === 0 ) {
    //       // If percentArea equals zero, it might be possible to just measure if a token boundary has been breached.
    //       const constrained = this.target.constrainedTokenBorder;
    //       const bottomTest = shadowLOS.bottom ? this._targetBoundsTest(shadowLOS.bottom, constrained) : undefined;
    //       if ( bottomTest ) return true;
    //
    //       const topTest = shadowLOS.top ? this._targetBoundsTest(shadowLOS.top, constrained) : undefined;
    //       if ( topTest ) return true;
    //
    //       if ( typeof bottomTest !== "undefined" || typeof topTest !== "undefined" ) return false;
    //     }

    const percentVisible = this.percentVisible(shadowLOS);
    if ( percentVisible.almostEqual(0) ) return false;

    return (percentVisible > threshold) || percentVisible.almostEqual(threshold);
  }

  /**
   * Determine a percent area visible for the target based on the target bottom area,
   * target top area, or both. Varies based on relative position of visionSource to target.
   * @param {object{top: {PIXI.Polygon|undefined}, bottom: {PIXI.Polygon|undefined}}} shadowLOS
   * @returns {number}
   */
  percentVisible(shadowLOS) {
    shadowLOS ??= this._buildShadowLOS();
    const constrained = this.target.constrainedTokenBorder;
    const targetPercentAreaBottom = shadowLOS.bottom ? this._calculatePercentSeen(shadowLOS.bottom, constrained) : 0;
    const targetPercentAreaTop = shadowLOS.top ? this._calculatePercentSeen(shadowLOS.top, constrained) : 0;
    const percent = Math.max(targetPercentAreaBottom, targetPercentAreaTop);
    if ( this.config.debug ) console.debug(`Area2dLOS|${this.target.name} is ${Math.round(percent * 100)}% visible from ${this.config.visionSource?.object?.name}`);
    return percent;
  }

  /**
   * For polygon shapes, measure if a token boundary has been breached by line-of-sight.
   * @param {PIXI.Polygon|ClipperPaths} los                       Viewer line-of-sight
   * @param {PIXI.Polygon|PIXI.Rectangle} tokenShape   Token shape constrained by walls.
   */
  _targetBoundsTest(los, tokenShape) {
    if ( los instanceof ClipperPaths ) los.simplify();
    if ( los instanceof ClipperPaths ) return undefined;

    const hasLOS = !this._sourceIntersectsPolygonBounds(los, tokenShape);
    if ( this.config.debug ) {
      const draw = new Draw(Settings.DEBUG_LOS);
      draw.shape(los, { color: Draw.COLORS.orange });
      this._drawTokenShape(tokenShape, hasLOS);
    }
    return hasLOS;
  }

  /**
   * Does the source intersect the bounding box?
   * @param {PIXI.Polygon} source
   * @param {PIXI.Rectangle} bbox
   * @return {boolean} True if the bbox intersects the source.
   */
  _sourceIntersectsBounds(source, bbox) {
    for ( const si of source.iterateEdges() ) {
      if ( bbox.lineSegmentIntersects(si.A, si.B,
        { intersectFn: foundry.utils.lineSegmentIntersects }) ) return true;
    }
    return false;
  }

  /**
   * Stricter intersection test between polygon and a constrained token bounds.
   * 1. Overlapping edges are not considered intersecting.
   * 2. endpoints that overlap the other segment are not considered intersecting.
   * 3. bounds rectangle used to skip edges
   *
   * (1) and (2) are to avoid situations in which the boundary polygon and the source polygon
   * are separated by a wall.
   */
  _sourceIntersectsPolygonBounds(source, bounds) {
    if ( bounds instanceof PIXI.Rectangle ) return this._sourceIntersectsBounds(source, bounds);
    const bbox = bounds.bounds;

    // TO-DO: should inside be true or false?
    const edges = [...source.iterateEdges()].filter(e => bbox.lineSegmentIntersects(e.A, e.B, { inside: true }));
    return bounds.linesCross(edges);
  }

  /**
   * Depending on location of visionSource versus target, build one or two
   * line-of-sight polygons with shadows set to the top or bottom elevations for the target.
   * Viewer looking up: bottom of target
   * Viewer looking down: top of target
   * Viewer looking head-on: both. (Yes, slightly unrealistic.)
   * Target has no defined height: return top.
   * @returns {object{top: {PIXI.Polygon|undefined}, bottom: {PIXI.Polygon|undefined}}}
   */
  _buildShadowLOS() {
    const viewerZ = this.viewerPoint.z;
    const { topZ, bottomZ } = this.target;

    // Test top and bottom of target shape.
    let bottom;
    let top;
    const inBetween = (viewerZ <= topZ) && (viewerZ >= bottomZ);

    // If target has no height, return one shadowed LOS polygon based on target elevation.
    if ( !(topZ - bottomZ) ) return { top: this.shadowLOSForElevation(topZ) };

    // Looking up at bottom
    if ( inBetween || (viewerZ < bottomZ) ) bottom = this.shadowLOSForElevation(bottomZ);

    // Looking down at top
    if ( inBetween || (viewerZ > topZ) ) top = this.shadowLOSForElevation(topZ);

    return (top && bottom && objectsEqual(top.points, bottom.points)) ? { top } : { bottom, top };
  }

  /**
   * Create ClipperPaths that combine tiles with drawings holes.
   * Comparable to Area3d._combineBlockingTiles
   * @param {Set<Tile>} tiles
   * @param {Set<CenteredPolygonBase>} drawings
   * @returns {ClipperPaths}
   */
  _combineTilesWithDrawingHoles(tiles, drawings) {
    if ( !tiles.size ) return undefined;

    const tilePolygons = tiles.map(tile => {
      const { x, y, width, height } = tile.document;
      const pts = [
        x, y,
        x + width, y,
        x + width, y + width,
        x, y + height
      ];
      const poly = new PIXI.Polygon(pts);
      poly._elevation = tile.elevationE;
      return poly;
    });

    if ( !drawings.size ) {
      const paths = ClipperPaths.fromPolygons(tilePolygons, {scalingFactor: Area2d.SCALING_FACTOR});
      paths.combine().clean();
      return paths;
    }

    // Check if any drawings might create a hole in one or more tiles
    const tilesUnholed = [];
    const tilesHoled = [];
    for ( const tilePoly of tilePolygons ) {
      const drawingHoles = [];

      for ( const drawing of drawings ) {
        const minE = drawing.document.getFlag("levels", "rangeTop");
        const maxE = drawing.document.getFlag("levels", "rangeBottom");
        if ( minE == null && maxE == null ) continue; // Intended to test null, undefined
        else if ( minE == null && tileE !== maxE ) continue;
        else if ( maxE == null && tileE !== minE ) continue;
        else if ( !tilePoly._elevation.between(minE, maxE) ) continue;

        const shape = CONFIG.GeometryLib.utils.centeredPolygonFromDrawing(drawing);
        drawingHoles.push(shape.toPolygon());
      }

      if ( drawingHoles.length ) {
        // Construct a hole at the tile's elevation from the drawing taking the difference.
        const drawingHolesPaths = ClipperPaths.fromPolygons(drawingHoles, {scalingFactor: Area2d.SCALING_FACTOR});
        const tileHoled = drawingHolesPaths.diffPolygon(tilePoly);
        tilesHoled.push(tileHoled);
      } else tilesUnholed.push(tilePoly);
    }

    if ( tilesUnholed.length ) {
      const unHoledPaths = ClipperPaths.fromPolygons(tilesUnholed, {scalingFactor: Area2d.SCALING_FACTOR});
      // unHoledPaths.combine().clean();
      tilesHoled.push(unHoledPaths);
    }

    // Combine all the tiles, holed and unholed
    tiles = ClipperPaths.combinePaths(tilesHoled);
    tiles.combine().clean();
    return tiles;
  }

  /**
   * Determine the percent area visible of a token shape given a los polygon.
   * @param {PIXI.Polygon} los
   * @param {PIXI.Polygon} tokenShape
   * @returns {number}
   */
  _calculatePercentSeen(los, tokenShape) {
    const visibleTargetShape = this._intersectShapeWithLOS(this.config.visibleTargetShape ?? tokenShape, los);
    if ( !visibleTargetShape.length ) return 0;

    // The denominator is the token area before considering blocking objects.
    let tokenArea = tokenShape.scaledArea({scalingFactor: Area2d.SCALING_FACTOR});
    if ( this.config.largeTarget ) tokenArea = Math.min(this.constructor.gridSquareArea, tokenArea);
    if ( !tokenArea || tokenArea.almostEqual(0) ) return 0;

    let seenArea = 0;
    for ( const poly of visibleTargetShape ) {
      if ( poly.isHole ) seenArea -= this._calculateSeenAreaForPolygon(poly) ?? 0;
      else seenArea += this._calculateSeenAreaForPolygon(poly) ?? 0;
    }

    if ( !seenArea || seenArea < 0 || seenArea.almostEqual(0) ) return 0;

    const percentSeen = seenArea / tokenArea;

    if ( this.config.debug ) {
      const percentArea = Settings.get(SETTINGS.LOS.TARGET.PERCENT);
      const hasLOS = (percentSeen > percentArea) || percentSeen.almostEqual(percentArea);
      this._drawLOS(los);
      visibleTargetShape.forEach(poly => this._drawTokenShape(poly, hasLOS));
    }

    return percentSeen;
  }

  /**
   * Determine the seen portions of a polygon (which represents part of a token shape)
   * @param {PIXI.Polygon} visiblePolygon
   * @returns {number} Amount of polygon that is seen
   */
  _calculateSeenAreaForPolygon(visiblePolygon) {
    // If Levels is enabled, consider tiles and drawings; obscure the visible token shape.
    if ( MODULES_ACTIVE.LEVELS ) {
      let tiles = this.constructor.filterTilesByVisionPolygon(visiblePolygon);

      // Limit to tiles between viewer and target.
      const minEZ = Math.min(this.viewerPoint.z, this.target.bottomZ);
      const maxEZ = Math.max(this.viewerPoint.z, this.target.topZ);
      tiles = tiles.filter(tile => {
        const tileEZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(tile.document.elevation);
        return tileEZ.between(minEZ, maxEZ);
      });

      if ( tiles.size ) {
        const drawings = this.constructor.filterDrawingsByVisionPolygon(visiblePolygon);
        const combinedTiles = this._combineTilesWithDrawingHoles(tiles, drawings);
        visiblePolygon = combinedTiles.diffPolygon(visiblePolygon);
      }
    }

    return visiblePolygon.scaledArea({scalingFactor: Area2d.SCALING_FACTOR});
  }

  /**
   * Draw the token shape, or portion of token shape, for debugging.
   * @param {PIXI.Polygon} polygon
   * @param {boolean} hasLOS
   */
  _drawTokenShape(polygon, hasLOS) {
    const draw = new Draw(Settings.DEBUG_LOS);
    const color = hasLOS ? Draw.COLORS.green : Draw.COLORS.red;
    const visibleShape = this.config.visibleTargetShape;
    draw.shape(this.target.constrainedTokenBorder, { color });
    draw.shape(polygon, { color, fill: color, fillAlpha: 0.5});
    if ( visibleShape ) draw.shape(visibleShape, { color: Draw.COLORS.yellow });
  }

  /**
   * Draw the LOS shape, for debugging.
   * @param {PIXI.Polygon|ClipperPaths} los
   */
  _drawLOS(los) {
    const draw = new Draw(Settings.DEBUG_LOS);
    if ( los instanceof ClipperPaths ) los = los.simplify();
    if ( los instanceof ClipperPaths ) {
      const polys = los.toPolygons();
      for ( const poly of polys ) {
        draw.shape(poly, { color: Draw.COLORS.orange, width: poly.isHole ? 1 : 2 });
      }
    } else {
      draw.shape(los, { color: Draw.COLORS.orange, width: 2 });
    }
  }

  /**
   * Intersect a shape with the line-of-sight polygon.
   * @param {PIXI.Polygon|PIXI.Rectangle} constrained
   * @param {PIXI.Polygon|null} los
   * @returns {PIXI.Polygon[]} Array of polygons representing the intersected shape.
   *   May have multiple polygons and may have holes (although the latter is very unlikely).
   */
  _intersectShapeWithLOS(constrained, los) {
    // TODO: Use Weiler-Atherton
    //     if ( constrained instanceof PIXI.Rectangle && los instanceof PIXI.Polygon ) {
    //       // Weiler-Atherton is faster for intersecting regular shapes
    //       // Use Clipper for now
    //     }
    // It is possible that a target shape will be split into 2+ pieces by the los.
    // For example, a wall blocking the middle of a target only.
    // For this reason, W-A is not currently appropriate, unless/until it is modified to handle
    // holes and multiple pieces.

    // Use ClipperPaths to ensure all polygons are returned.
    los = los instanceof ClipperPaths
      ? los : ClipperPaths.fromPolygons([los], { scalingFactor: Area2d.SCALING_FACTOR });
    if ( constrained instanceof PIXI.Rectangle ) constrained = constrained.toPolygon();

    const intersect = los.intersectPolygon(constrained);
    const polys = intersect.toPolygons();
    return polys.filter(poly => poly.points.length > 5); // Reject points or lines
  }

  /**
   * Build a version of the visionSource LOS polygon with shadows included.
   * Shadows assume a specific elevation of the surface.
   * @param {number} targetElevation
   */
  shadowLOSForElevation(targetElevation = 0) {
    const viewerPoint = this.viewerPoint;
    const { type, liveTokensBlock, deadTokensBlock, visionSource } = this.config;

    // Find the walls and, optionally, tokens, for the triangle between origin and target
    const filterConfig = {
      type,
      filterWalls: true,
      filterTokens: liveTokensBlock || deadTokensBlock,
      filterTiles: false,
      viewer: visionSource.object,
      debug: this.config.debug
    };
    const viewableObjs = this.constructor.filterSceneObjectsByVisionPolygon(viewerPoint, this.target, filterConfig);


    // Note: Wall Height removes walls from LOS calculation if
    // 1. origin is above the top of the wall
    // 2. origin is below the bottom of the wall

    // In limited cases, we may need to re-do the LOS calc.
    // 1. origin is below top of wall and target is above top of wall.
    // 2. origin is above bottom of wall and target is below bottom of wall.
    // --> Both cases: wall may or may not shadow the target.
    // e.g., target next to wall at 0 ft but wall bottom is 10 ft. Viewer looking down
    // may be able to see the target depending on viewer distance.
    // We need an LOS calc that removes all limited walls; use shadows instead.
    // 3. Tokens are potentially blocking -- construct shadows based on those tokens
    let redoLOS = viewableObjs.tokens.size;
    const elevationZ = this.viewerPoint.z;
    redoLOS ||= viewableObjs.walls.some(w => {
      const { topZ, bottomZ } = w;
      return (elevationZ < topZ && targetElevation > topZ)
      || (elevationZ > bottomZ && targetElevation < bottomZ);
    });

    const losConfig = visionSource._getPolygonConfiguration();
    if ( visionSource.disabled ) losConfig.radius = 0;
    if ( !redoLOS ) {
      const polygonClass = CONFIG.Canvas.polygonBackends[visionSource.constructor.sourceType];
      return polygonClass.create(viewerPoint, losConfig);
    }

    // Rerun the LOS with infinite walls only
    const los = CWSweepInfiniteWallsOnly.create(viewerPoint, losConfig);

    const shadows = [];
    for ( const wall of viewableObjs.walls ) {
      const shadow = Shadow.constructFromWall(wall, viewerPoint, targetElevation);
      if ( shadow ) shadows.push(shadow);
    }

    const tokenPoints = buildTokenPoints(viewableObjs.tokens, this.config);

    // Add token borders as shadows if tokens block
    for ( const token3d of tokenPoints ) {
      // Use each vertical side of the token to shadow
      // This allows the back walls to shadow if viewer is above/below.
      const sidePoints = token3d._allSides();
      sidePoints.forEach(pts => {
        pts = pts.points; // [topA, bottomA, bottomB, topB]
        const shadow = Shadow.constructFromPoints3d(
          pts[0], // TopA
          pts[3], // TopB
          pts[1], // BottomA
          pts[2],  // BottomB
          origin,
          targetElevation
        );
        if ( shadow ) shadows.push(shadow);
      });
    }

    if ( this.config.debug ) {
      const color = Draw.COLORS.gray;
      const width = 1;
      const fill = Draw.COLORS.gray;
      const fillAlpha = .5;
      const draw = new Draw(Settings.DEBUG_LOS);
      shadows.forEach(shadow => draw.shape(shadow, { color, width, fill, fillAlpha }));
    }

    const combined = Shadow.combinePolygonWithShadows(los, shadows);
    // TODO: Caching visionSource._losShadows.set(targetElevation, combined);
    return combined;
  }
}

/** For backwards compatibility */
export const Area2d = Area2dLOS;
Area2dLOS.prototype.percentAreaVisible = Area2dLOS.prototype.percentVisible;


