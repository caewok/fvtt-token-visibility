/* globals
PIXI
*/
"use strict";

/* Area 3d
Rotate canvas such that the view is the token looking directly at the target.
(Doom view)
- Y axis becomes the z axis. 0 is the token center.
- X axis is the line perpendicular to the line between token and target centers.

For target, use the constrained target points.

Walls:
- Transform all walls that intersect the boundary between token center and target shape
  in original XY coordinates.
- Construct shadows based on new rotated coordinates.

- Some points of the target and walls may be contained; find the perimeter. Use convex hull

Area:
- Unblocked target area is the denominator.
- Wall shapes block and shadows block. Construct the blocked target shape and calc area.
*/


/* Testing
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
api = game.modules.get("tokenvisibility").api;
Area3dLOS = api.Area3dLOS;

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;

calc = new Area3dLOS(viewer, target)
calc.hasLOS()
calc.percentVisible()

objs = calc.blockingObjects
[tile] = objs.tiles
Draw.shape(tile.bounds, { color: Draw.COLORS.orange })

objPts = calc.blockingObjectsPoints
[tilePts] = objPts.tiles

blockingPts = calc.blockingPoints

let { obscuredSides, sidePolys } = calc._obscureSides();

for ( const poly of sidePolys ) {
   Draw.shape(poly, { color: Draw.COLORS.lightgreen})
}

for ( const obscuredSide of obscuredSides ) {
  const polys = obscuredSide.toPolygons()
  for ( const poly of polys ) {
    Draw.shape(poly, { color: Draw.COLORS.red})
  }
}

// _constructBlockingPointsArray
visionPolygon = calc.visionPolygon;
edges = [...visionPolygon.iterateEdges()];
viewerLoc = calc.viewerPoint
pts = tilePts
Draw.shape(visionPolygon, { color: Draw.COLORS.blue })


targetShape = new PIXI.Rectangle(3600, 2500, 300, 300)
thisShape = new PIXI.Rectangle(2000, 3400, 2300, 900)
Draw.shape(thisShape, { color: Draw.COLORS.orange });
Draw.shape(targetShape, { color: Draw.COLORS.red })

*/

import { Area3dLOS } from "./Area3dLOS.js";

// PlaceablePoints folder
import { TokenPoints3d, UnitTokenPoints3d } from "./PlaceablesPoints/TokenPoints3d.js";
import { TilePoints3d } from "./PlaceablesPoints/TilePoints3d.js";
import { WallPoints3d } from "./PlaceablesPoints/WallPoints3d.js";

// Base folder
import { Settings } from "../settings.js";
import { buildTokenPoints } from "./util.js";

// Geometry folder
import { Draw } from "../geometry/Draw.js"; // For debugging
import { ClipperPaths } from "../geometry/ClipperPaths.js";
import { Matrix } from "../geometry/Matrix.js";

export class Area3dLOSGeometric extends Area3dLOS {

  /** @type {Shadow[]} */
  wallShadows = [];

  /**
   * Scaling factor used with Clipper
   */
  static SCALING_FACTOR = 100;

  _clearCache() {
    super._clearCache();
    this.#targetPoints = undefined;
    this.#visibleTargetPoints = undefined;
    this.#boundaryTargetPoints = undefined;
    this.#gridPoints = undefined;
    this.#viewIsSet = false;
    this.#lookAtMatrices.initialized = false;
    this.#blockingObjectsPoints.initialized = false;
    this.#blockingPoints.initialized = false;
  }

  // ----- NOTE: Target properties ----- //

  /** @type {Point3d} */
  #targetPoints;

  get targetPoints() {
    return this.#targetPoints
      || (this.#targetPoints = new TokenPoints3d(this.target));
  }

  /** @type {Point3d} */
  #visibleTargetPoints;

  get visibleTargetPoints() {
    return this.#visibleTargetPoints
      || (this.#visibleTargetPoints = new TokenPoints3d(this.target,
        { pad: -1, tokenBorder: this.config.visibleTargetShape }));
  }

  #boundaryTargetPoints;

  get boundaryTargetPoints() {
    return this.#boundaryTargetPoints
      || (this.#boundaryTargetPoints = this.target.bounds.viewablePoints(this.viewerPoint));
  }

  // ----- NOTE: Other getters / setters ----- //

  /** @type {boolean} */
  #viewIsSet = false;

  get viewIsSet() { return this.#viewIsSet; }

  /** @type {TokenPoints3d} */
  #gridPoints;

  get gridPoints() {
    return this.#gridPoints
      || (this.#gridPoints = this._buildGridShape());
  }

  /**
   * Build generic grid shape
   * @returns {TokenPoints3d}
   */
  _buildGridShape() {
    // Transform to TokenPoints3d and calculate viewable area.
    // Really only an estimate b/c the view will shift depending on where on the large token
    // we are looking.
    return new UnitTokenPoints3d(this.target);
  }

  /**
   * Area of a basic grid square to use for the area estimate when dealing with large tokens.
   * @returns {number}
   */
  _gridSquareArea() {
    const tGrid = this.gridPoints.perspectiveTransform();
    const sidePolys = tGrid.map(side => new PIXI.Polygon(side));
    return sidePolys.reduce((area, poly) =>
      area += poly.scaledArea({scalingFactor: this.constructor.SCALING_FACTOR}), 0);
  }

  // NOTE ----- USER-FACING METHODS -----

  /**
   * Determine percentage area by estimating the blocking shapes geometrically.
   * @returns {number}
   */
  percentVisible() {
    const percentVisible = this._simpleVisibilityTest();
    if ( typeof percentVisible !== "undefined" ) return percentVisible;

    const { obscuredSides, sidePolys } = this._obscureSides();
    const obscuredSidesArea = obscuredSides.reduce((area, poly) =>
      area += poly.scaledArea({scalingFactor: this.constructor.SCALING_FACTOR}), 0);
    let sidesArea = sidePolys.reduce((area, poly) =>
      area += poly.scaledArea({scalingFactor: this.constructor.SCALING_FACTOR}), 0);

    if ( this.config.largeTarget ) sidesArea = Math.min(this._gridSquareArea() || 100_000, sidesArea);

    // Round the percent seen so that near-zero areas are 0.
    // Because of trimming walls near the vision triangle, a small amount of token area can poke through
    let percentSeen = sidesArea ? obscuredSidesArea / sidesArea : 0;
    if ( percentSeen < 0.005 ) percentSeen = 0;
    return percentSeen;
  }


  // NOTE ----- GETTERS / SETTERS ----- //

  /**
   * Holds arrays of processed blocking points from _blockingObjects.
   * @typedef BlockingPoints
   * @type {object}
   * @type {object}:
   * @property {VerticalPoints3d[]}     terrainWalls
   * @property {HorizontalPoints3d[]}   tiles
   * @property {(VerticalPoints3d|HorizontalPoints3d)[]}     tokens
   * @property {VerticalPoints3d[]}     walls
   */
  #blockingPoints = {
    terrainWalls: [],
    tiles: [],
    tokens: [],
    walls: [],
    initialized: false
  };

  /** @type {BlockingPoints} */
  get blockingPoints() {
    if ( !this.#blockingPoints.initialized ) this._constructBlockingPointsArray();
    return this.#blockingPoints;
  }

  /**
   * Debug/temp object that holds the converted Foundry blockingObjects as PlanePoints3d.
   * @typedef {BlockingObjectsPoints}
   * @type {object}:
   * @property {Set<WallPoints3d>}    terrainWalls
   * @property {Set<TilePoints3d>}    tiles
   * @property {Set<TokenPoints3d>}   tokens
   * @property {Set<WallPoints3d>}    walls
   */
  #blockingObjectsPoints = {
    terrainWalls: new Set(),
    tiles: new Set(),
    tokens: new Set(),
    walls: new Set(),
    initialized: false
  };

  /** @type {BlockingObjectsPoints} */
  get blockingObjectsPoints() {
    if ( !this.#blockingObjectsPoints.initialized ) this._constructBlockingObjectsPoints();
    return this.#blockingObjectsPoints;
  }

  /**
   * Object to hold the viewer-->target look at matrix.
   */
  #lookAtMatrices = {
    cameraM: undefined, // Camera --> target (viewerCameraM)
    targetM: undefined, // Target --> camera (viewerViewM) (inverse of cameraM)
    initialized: false
  };

  get targetLookAtMatrix() {
    if ( !this.#lookAtMatrices.initialized ) this._calculateViewerCameraMatrix();
    return this.#lookAtMatrices.targetM;
  }

  get cameraLookAtMatrix() {
    if ( !this.#lookAtMatrices.initialized ) this._calculateViewerCameraMatrix();
    return this.#lookAtMatrices.cameraM;
  }

  // NOTE ----- PRIMARY METHODS ----- //

  /**
   * Calculate the view matrix for the given token and target.
   * Also sets the view matrix for the target, walls, tiles, and other tokens as applicable.
   */
  calculateViewMatrix() {
    // Set the matrix to look at the target from the viewer.
    const { visibleTargetPoints, targetPoints, viewerPoint, targetLookAtMatrix } = this;
    targetPoints.setViewingPoint(viewerPoint);
    targetPoints.setViewMatrix(targetLookAtMatrix);
    visibleTargetPoints.setViewingPoint(viewerPoint);
    visibleTargetPoints.setViewMatrix(targetLookAtMatrix);
    if ( this.config.largeTarget ) {
      const gridPoints = this.gridPoints;
      gridPoints.setViewingPoint(viewerPoint);
      gridPoints.setViewMatrix(targetLookAtMatrix);
    }

    // Set the matrix to look at blocking point objects from the viewer.
    const blockingPoints = this.blockingPoints;
    blockingPoints.tiles.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingPoints.tokens.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingPoints.walls.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingPoints.terrainWalls.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));

    // Set the matrix for drawing other debug objects
    const blockingObjectsPoints = this.blockingObjectsPoints;
    blockingObjectsPoints.tiles.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingObjectsPoints.tokens.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingObjectsPoints.walls.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingObjectsPoints.terrainWalls.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));

    this.#viewIsSet = true;
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
  _obscureSides() {
    if ( !this.#viewIsSet ) this.calculateViewMatrix();
    const blockingPoints = this.blockingPoints;

    // Combine terrain walls
    const combinedTerrainWalls = blockingPoints.terrainWalls.length > 1
      ? WallPoints3d.combineTerrainWalls(blockingPoints.terrainWalls, this.viewerPoint, {
        scalingFactor: this.constructor.SCALING_FACTOR
      }) : undefined;

    // Combine alike objects
    const tiles = this._combineBlockingTiles();
    const walls = this._combineBlockingWalls();
    const tokens = this._combineBlockingTokens();

    // Combine to a single set of polygon paths
    let blockingPaths = [];
    if ( tiles ) blockingPaths.push(tiles);
    if ( walls ) blockingPaths.push(walls);
    if ( tokens ) blockingPaths.push(tokens);
    if ( combinedTerrainWalls ) blockingPaths.push(combinedTerrainWalls);
    const blockingObject = ClipperPaths.combinePaths(blockingPaths);

    // For each side, union the blocking wall with any shadows and then take diff against the side
    const tVisibleTarget = this.visibleTargetPoints.perspectiveTransform();
    const visibleSidePolys = tVisibleTarget.map(side => new PIXI.Polygon(side));
    const obscuredSides = blockingObject
      ? visibleSidePolys.map(side => blockingObject.diffPolygon(side))
      : visibleSidePolys;

    // Calculate the non-obscured sides.
    const tTarget = this.targetPoints.perspectiveTransform();
    const sidePolys = tTarget.map(side => new PIXI.Polygon(side));

    return { obscuredSides, sidePolys };
  }

  // NOTE ----- GETTER/SETTER HELPER METHODS ----- //

  /**
   * Construct the transformation matrix to rotate the view around the center of the token.
   * @returns {object} Matrices, for convenience.
   *   - @property {Matrix} M   The camera lookAt matrix
   *   - @property {Matrix} M   Inverse of the camera lookAt matrix
   */
  _calculateViewerCameraMatrix() {
    const cameraPosition = this.viewerPoint;
    const targetPosition = this.targetCenter;
    const res = Matrix.lookAt(cameraPosition, targetPosition, this.constructor.upVector);
    this.#lookAtMatrices.cameraM = res.M;
    this.#lookAtMatrices.targetM = res.Minv;
    this.#lookAtMatrices.initialized = true;
    return res;
  }

  /**
   * Find objects that are within the vision triangle between viewer and target.
   * Sets this._blockingObjects for tiles, tokens, walls, and terrainWalls.
   * Sets _blockingObjectsAreSet and resets _blockingPointsAreSet and _viewIsSet.
   */
  _findBlockingObjects() {
    super._findBlockingObjects();

    // Force reset of the other objects that depend on the blocking objects sets.
    this.#blockingObjectsPoints.initialized = false;
    this.#blockingPoints.initialized = false;
    this.#viewIsSet = false;
  }

  /**
   * Convert blocking objects into PlanePoints.
   * These will eventually be used by _obscureSides to project 2d perspective objects
   * that may block the target sides.
   */
  _constructBlockingObjectsPoints() {
    const objs = this.blockingObjects;

    // Clear any prior objects from the respective sets
    const { terrainWalls, tiles, tokens, walls } = this.#blockingObjectsPoints;
    terrainWalls.clear();
    tiles.clear();
    tokens.clear();
    walls.clear();

    // Add Tiles
    objs.tiles.forEach(t => tiles.add(new TilePoints3d(t, { viewerElevationZ: this.viewerPoint.z })));

    // Add Tokens
    const tokenPoints = buildTokenPoints(objs.tokens, this.config);
    tokenPoints.forEach(pts => tokens.add(pts));

    // Add Walls
    objs.walls.forEach(w => {
      // Sometimes w can be WallPoints3d. See issue #48.
      if ( w instanceof WallPoints3d ) walls.add(w);
      else walls.add(new WallPoints3d(w));
    });

    // Add Terrain Walls
    objs.terrainWalls.forEach(w => terrainWalls.add(new WallPoints3d(w)));

    this.#blockingObjectsPoints.initialized = true;
    this.#blockingPoints.initialized = false;
    this.#viewIsSet = false;
  }

  /**
   * Construct the PlanePoints3d array.
   * Split various PlanePoints3d objects as needed for the given perspective.
   */
  _constructBlockingPointsArray() {
    const blockingObjectsPoints = this.blockingObjectsPoints;
    const blockingPoints = this.#blockingPoints;
    const { visionPolygon, target } = this;
    const edges = [...visionPolygon.iterateEdges()];
    const viewerLoc = this.viewerPoint;

    if ( this.config.debug ) {
      const draw = new Draw(Settings.DEBUG_LOS);
      draw.shape(visionPolygon, { fill: Draw.COLORS.lightblue, fillAlpha: 0.2 });
    }

    // Clear the existing arrays.
    blockingPoints.tiles.length = 0;
    blockingPoints.tokens.length = 0;
    blockingPoints.walls.length = 0;
    blockingPoints.terrainWalls.length = 0;

    // Vertical points
    blockingObjectsPoints.walls.forEach(pts => {
      const res = pts._getVisibleSplits(target, visionPolygon, { edges, viewerLoc });
      if ( res.length ) blockingPoints.walls.push(...res);
    });

    blockingObjectsPoints.terrainWalls.forEach(pts => {
      const res = pts._getVisibleSplits(target, visionPolygon, { edges, viewerLoc });
      if ( res.length ) blockingPoints.terrainWalls.push(...res);
    });

    // Horizontal points
    blockingObjectsPoints.tiles.forEach(pts => {
      const res = pts._getVisibleSplits(target, visionPolygon, { edges, viewerLoc });
      if ( res.length ) blockingPoints.tiles.push(...res);
    });

    // Tokens have both horizontal and vertical.
    blockingObjectsPoints.tokens.forEach(token => {
      const topBottom = token._viewableTopBottom(viewerLoc);
      if ( topBottom ) {
        const res = topBottom._getVisibleSplits(target, visionPolygon, { edges, viewerLoc });
        if ( res.length ) blockingPoints.tokens.push(...res);
      }

      const sides = token._viewableSides(viewerLoc);
      sides.forEach(pts => {
        const res = pts._getVisibleSplits(target, visionPolygon, { edges, viewerLoc });
        if ( res.length ) blockingPoints.tokens.push(...res);
      });
    });

    this.#blockingPoints.initialized = true;
    this.#viewIsSet = false;
  }

  // NOTE ----- OTHER HELPER METHODS ----- //

  /**
   * Combine provided walls using Clipper.
   * @returns {ClipperPaths|undefined}
   */
  _combineBlockingWalls() {
    let walls = this.blockingPoints.walls;
    if ( !walls.length ) return undefined;

    const transformed = walls.map(w => new PIXI.Polygon(w.perspectiveTransform()));
    const paths = ClipperPaths.fromPolygons(transformed, { scalingFactor: this.constructor.SCALING_FACTOR });
    const combined = paths.combine();
    combined.clean();
    return combined;
  }

  /**
   * Combine all the blocking tokens using Clipper
   * @returns {ClipperPaths|undefined}
   */
  _combineBlockingTokens() {
    const tokens = this.blockingPoints.tokens;
    if ( !tokens.length ) return undefined;

    const transformed = tokens.map(t => new PIXI.Polygon(t.perspectiveTransform()));
    const paths = ClipperPaths.fromPolygons(transformed, { scalingFactor: this.constructor.SCALING_FACTOR });
    const combined = paths.combine();
    combined.clean();
    return combined;
  }

  /**
   * Combine all the blocking tiles using Clipper.
   * @returns {ClipperPaths|undefined}
   */
  _combineBlockingTiles() {
    const blockingPoints = this.blockingPoints;
    if ( !blockingPoints.tiles.length ) return undefined;

    const tilePolys = blockingPoints.tiles.map(w => new PIXI.Polygon(w.perspectiveTransform()));
    const paths = ClipperPaths.fromPolygons(tilePolys, {scalingFactor: this.constructor.SCALING_FACTOR});
    paths.combine().clean();
    return paths;
  }

  // ----- NOTE: Debugging methods ----- //

  destroy() {
    super.destroy();
    if ( this.#popoutGraphics && !this.#popoutGraphics._destroyed ) this.#popoutGraphics.destroy();
  }

  /** @type {PIXI.Graphics} */
  #popoutGraphics;

  get popoutGraphics() {
    return this.#popoutGraphics || (this.#popoutGraphics = new PIXI.Graphics());
  }

  /** @type {Draw} */
  #popoutDraw;

  get popoutDraw() {
    const g = this.popoutGraphics;
    this._addChildToPopout(g);
    return this.#popoutDraw || (this.#popoutDraw = new Draw(g));
  }

  _clear3dDebug() {
    super._clear3dDebug();
    if ( !this.#popoutGraphics ) return;
    this.#popoutGraphics.clear();
  }

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug() {
    super._draw3dDebug();
    if ( !this.popoutIsRendered ) return;
    const drawTool = this.popoutDraw;
    drawTool.clearDrawings();
    const colors = Draw.COLORS;
    if ( !this.#viewIsSet ) this.calculateViewMatrix();

    // Scale the target graphics to fit in the view window.
    const ptsArr = this.visibleTargetPoints.perspectiveTransform();
    const xMinMax = Math.minMax(...ptsArr.flat().map(pt => pt.x));
    const yMinMax = Math.minMax(...ptsArr.flat().map(pt => pt.y));
    const maxCoord = 200;
    const scale = Math.min(1,
      maxCoord / xMinMax.max,
      -maxCoord / xMinMax.min,
      maxCoord / yMinMax.max,
      -maxCoord / yMinMax.min
    );
    drawTool.g.scale = new PIXI.Point(scale, scale);

    // Draw the target in 3d, centered on 0,0
    this.visibleTargetPoints.drawTransformed({ color: colors.black, drawTool });
    if ( this.config.largeTarget ) this.gridPoints.drawTransformed(
      { color: colors.lightred, drawTool, fillAlpha: 0.4 });

    // Draw the detected objects in 3d, centered on 0,0
    const pts = this.config.debugDrawObjects ? this.blockingObjectsPoints : this.blockingPoints;
    pts.walls.forEach(w => w.drawTransformed({ color: colors.blue, fillAlpha: 0.5, drawTool }));
    pts.tiles.forEach(w => w.drawTransformed({ color: colors.yellow, fillAlpha: 0.3, drawTool }));
    pts.tokens.forEach(t => t.drawTransformed({ color: colors.orange, drawTool }));
    pts.terrainWalls.forEach(w => w.drawTransformed({ color: colors.lightgreen, fillAlpha: 0.1, drawTool }));
  }
}
