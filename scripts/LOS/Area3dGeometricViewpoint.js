/* globals
CONFIG,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// PlaceablePoints folder
import { TokenPoints3d, UnitTokenPoints3d } from "./PlaceablesPoints/TokenPoints3d.js";
import { TilePoints3d } from "./PlaceablesPoints/TilePoints3d.js";
import { WallPoints3d } from "./PlaceablesPoints/WallPoints3d.js";

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { getObjectProperty } from "./util.js";

// Debug
import { Draw } from "../geometry/Draw.js";
import { ClipperPaths } from "../geometry/ClipperPaths.js";
import { Matrix } from "../geometry/Matrix.js";

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

  constructor(...args) {
    super(...args);

    // Hide initialized property so we can iterate the object.
    Object.defineProperty(this.#blockingPoints, "initialized", { enumerable: false});
    Object.defineProperty(this.#blockingObjectsPoints, "initialized", { enumerable: false});
  }

  /**
   * Clear any cached values related to the target or target location.
   */
  clearCache() {
    super.clearCache();
    this.#blockingPoints.initialized = false;
    Object.values(this.#blockingPoints).forEach(objArr => objArr.length = 0);

    this.#blockingObjectsPoints.initialized = false;
    Object.values(this.#blockingObjectsPoints).forEach(objSet => objSet.clear());

    this.#targetLookAtMatrix = undefined;
    this.#targetPoints = undefined;
    this.#visibleTargetPoints = undefined;
  }

  // ----- NOTE: Visibility testing ----- //

  /**
   * Determine percentage area by estimating the blocking shapes geometrically.
   * @returns {number}
   */
  _percentVisible() {
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const { obscuredSides, sidePolys } = this._obscureSides();
    const obscuredSidesArea = obscuredSides.reduce((area, poly) =>
      area += poly.scaledArea({ scalingFactor }), 0);
    let sidesArea = sidePolys.reduce((area, poly) =>
      area += poly.scaledArea({ scalingFactor }), 0);
    if ( this.viewerLOS.config.largeTarget ) sidesArea = Math.min(this._gridSquareArea() || 100_000, sidesArea);

    // Round the percent seen so that near-zero areas are 0.
    // Because of trimming walls near the vision triangle, a small amount of token area can poke through
    const percentSeen = sidesArea ? obscuredSidesArea / sidesArea : 0;
    if ( this.viewerLOS.config.debug ) {
      this._updatePercentVisibleLabel(percentSeen);
      this._draw3dDebug();
    }

    if ( percentSeen.almostEqual(0, 1e-02) ) return 0;
    return percentSeen;
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
    this.calculateViewMatrix();
    const blockingPoints = this.blockingPoints;

    // Combine terrain walls
    const combinedTerrainWalls = blockingPoints.terrainWalls.length > 1
      ? WallPoints3d.combineTerrainWalls(blockingPoints.terrainWalls, this.viewpoint, {
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

  // ----- NOTE: Target properties ----- //

  /** @type {Point3d} */
  #targetPoints;

  get targetPoints() {
    return (this.#targetPoints ??= new TokenPoints3d(this.viewerLOS.target, { pad: -1, type: this.viewerLOS.config.type }));
  }

  /** @type {Point3d} */
  #visibleTargetPoints;

  get visibleTargetPoints() {
    return (this.#visibleTargetPoints ??= new TokenPoints3d(this.viewerLOS.target,
        { pad: -1, tokenBorder: this.viewerLOS.visibleTargetShape, type: this.viewerLOS.config.type }));
  }

  /* ----- NOTE: Blocking objects ----- */

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

  /** @type {BlockingObjectsPoints} */
  get blockingObjectsPoints() {
    if ( !this.#blockingObjectsPoints.initialized ) this._constructBlockingObjectsPoints();
    return this.#blockingObjectsPoints;
  }

  /** @type {BlockingPoints} */
  get blockingPoints() {
    if ( !this.#blockingPoints.initialized ) this._constructBlockingPointsArray();
    return this.#blockingPoints;
  }

  #targetLookAtMatrix;

  get targetLookAtMatrix() {
    return (this.#targetLookAtMatrix ??= this._calculateViewerCameraMatrix().Minv);
  }


  /**
   * Build generic grid shape
   * @returns {TokenPoints3d}
   */
  _buildGridShape() {
    // Transform to TokenPoints3d and calculate viewable area.
    // Really only an estimate b/c the view will shift depending on where on the large token
    // we are looking.
    return new UnitTokenPoints3d(this.target, { type: this.config.type });
  }

  /**
   * Construct the transformation matrix to rotate the view around the center of the token.
   * @returns {object} Matrices, for convenience.
   *   - @property {Matrix} M       The camera lookAt matrix
   *   - @property {Matrix} Minv    Inverse of the camera lookAt matrix
   */
  _calculateViewerCameraMatrix() {
    return Matrix.lookAt(this.viewpoint, this.viewerLOS.targetCenter, this.constructor.upVector);
    // cameraM = res.M; targetM = resM.inv.
  }

  /**
   * Calculate the view matrix for the given token and target.
   * Also sets the view matrix for the target, walls, tiles, and other tokens as applicable.
   */
  calculateViewMatrix() {
    // Set the matrix to look at the target from the viewer.
    const { visibleTargetPoints, targetPoints, viewpoint, targetLookAtMatrix } = this;
    targetPoints.setViewingPoint(viewpoint);
    targetPoints.setViewMatrix(targetLookAtMatrix);
    visibleTargetPoints.setViewingPoint(viewpoint);
    visibleTargetPoints.setViewMatrix(targetLookAtMatrix);

    // Set the matrix to look at blocking point objects from the viewer.
    Object.values(this.blockingPoints).forEach(objArr =>
      objArr.forEach(pts => pts.setViewMatrix(targetLookAtMatrix)));

    // Set the matrix for drawing other debug objects
    Object.values(this.blockingObjectsPoints).forEach(objSet =>
      objSet.forEach(pts => pts.setViewMatrix(targetLookAtMatrix)));
  }

  /**
   * Convert blocking objects into PlanePoints.
   * These will eventually be used by _obscureSides to project 2d perspective objects
   * that may block the target sides.
   */
  _constructBlockingObjectsPoints() {
    const objs = this.blockingObjects;

    // Clear any prior objects from the respective sets
    Object.values(this.#blockingObjectsPoints).forEach(objSet => objSet.clear());

    const { terrainWalls, tiles, tokens, walls } = this.#blockingObjectsPoints;

    // Add Tiles
    objs.tiles.forEach(t => tiles.add(new TilePoints3d(t, { viewerElevationZ: this.viewpoint.z })));

    // Add Tokens
    const tokenPoints = this._buildTokenPoints(objs.tokens);
    tokenPoints.forEach(pts => tokens.add(pts));

    // Add Walls
    objs.walls.forEach(w => {
      // Sometimes w can be WallPoints3d. See issue #48.
      if ( w instanceof WallPoints3d ) walls.add(w);
      else walls.add(new WallPoints3d(w));
    });

    // Add Terrain Walls
    objs.terrainWalls.forEach(w => terrainWalls.add(new WallPoints3d(w)));

    // Set the matrix to look at blocking point objects from the viewer.

    this.#blockingObjectsPoints.initialized = true;
    this.#blockingPoints.initialized = false;
  }

  /**
   * Construct the PlanePoints3d array.
   * Split various PlanePoints3d objects as needed for the given perspective.
   */
  _constructBlockingPointsArray() {
    const blockingObjectsPoints = this.blockingObjectsPoints;
    const blockingPoints = this.#blockingPoints;
    const { visionPolygon, viewpoint } = this;
    const edges = [...visionPolygon.iterateEdges()];

    // Clear the existing arrays.
    Object.values(blockingPoints).forEach(objArr => objArr.length = 0);

    // Tokens have both vertical and horizontal points and must be handled separately.
    const { tokens, ...nonTokens } = blockingObjectsPoints;

    const addVisibleSplitsFn = (key, pts) => {
      const res = pts._getVisibleSplits(this.viewerLOS.target, visionPolygon, { edges, viewpoint });
      if ( res.length ) blockingPoints[key].push(...res);
    };

    // Add points to the respective blockingPoints array.
    Object.entries(nonTokens)
      .forEach(([key, objSet]) => objSet
        .forEach(pts => addVisibleSplitsFn(key, pts)));

    tokens.forEach(token => {
      const topBottom = token._viewableTopBottom(viewpoint);
      if ( topBottom ) addVisibleSplitsFn("tokens", topBottom);

      const sides = token._viewableSides(viewpoint);
      sides.forEach(pts => addVisibleSplitsFn("tokens", pts));
    });

    this.#blockingPoints.initialized = true;
  }

  /**
   * Given config options, build TokenPoints3d from tokens.
   * The points will use either half- or full-height tokens, depending on config.
   * @param {Token[]|Set<Token>} tokens
   * @returns {TokenPoints3d[]}
   */
  _buildTokenPoints(tokens) {
    if ( !tokens.length && !tokens.size ) return tokens;
    const { live: liveTokensBlock, dead: deadTokensBlock, prone: proneTokensBlock } = this.viewerLOS.config.block.tokens;
    if ( !(liveTokensBlock || deadTokensBlock) ) return [];

    // Filter live or dead tokens
    if ( liveTokensBlock ^ deadTokensBlock ) {
      const tokenHPAttribute = Settings.get(Settings.KEYS.TOKEN_HP_ATTRIBUTE);
      tokens = tokens.filter(t => {
        const hp = getObjectProperty(t.actor, tokenHPAttribute);
        if ( typeof hp !== "number" ) return true;
        if ( liveTokensBlock && hp > 0 ) return true;
        if ( deadTokensBlock && hp <= 0 ) return true;
        return false;
      });
    }

    if ( !proneTokensBlock ) tokens = tokens.filter(t => !t.isProne);

    // Pad (inset) to avoid triggering cover at corners. See issue 49.
    return tokens.map(t => new TokenPoints3d(t, { pad: -2, type: this.config.type }));
  }

  /**
   * Area of a basic grid square to use for the area estimate when dealing with large tokens.
   * @returns {number}
   */
   _gridSquareArea() {
     // Set the grid points for a basic grid square and calculate the perspective.
     const gridPoints = new UnitTokenPoints3d(this.viewerLOS.target, { type: this.viewerLOS.config.type });
     gridPoints.setViewingPoint(this.viewpoint);
     gridPoints.setViewMatrix(this.targetLookAtMatrix);
     const tGrid = gridPoints.perspectiveTransform();

     // Determine the area from the viewpoint.
     const sidePolys = tGrid.map(side => new PIXI.Polygon(side));
     return sidePolys.reduce((area, poly) =>
      area += poly.scaledArea({scalingFactor: this.constructor.SCALING_FACTOR}), 0);
   }

  /* ----- NOTE: Other helper methods ----- */

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

  destroy() {
    this.clearCache();
    Object.values(this.#blockingObjectsPoints).forEach(objSet => objSet.clear());
    Object.values(this.#blockingPoints).forEach(objArr => objArr.length = 0);
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
    const drawTool = this.popoutDraw;
    drawTool.clearDrawings();
    const colors = Draw.COLORS;

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
    if ( this.viewerLOS.config.largeTarget ) {
      const gridPoints = new UnitTokenPoints3d(this.viewerLOS.target, { type: this.viewerLOS.config.type });
      gridPoints.drawTransformed({ color: colors.lightred, drawTool, fillAlpha: 0.4 });
    }

    // Draw the detected objects in 3d, centered on 0,0
    const pts = this.blockingPoints;
    pts.walls.forEach(w => w.drawTransformed({ color: colors.blue, fillAlpha: 0.5, drawTool }));
    pts.tiles.forEach(w => w.drawTransformed({ color: colors.yellow, fillAlpha: 0.3, drawTool }));
    pts.tokens.forEach(t => t.drawTransformed({ color: colors.orange, drawTool }));
    pts.terrainWalls.forEach(w => w.drawTransformed({ color: colors.lightgreen, fillAlpha: 0.1, drawTool }));
    console.log(`Area3dGeometricViewpoint|_draw3dDebug`);
  }


}