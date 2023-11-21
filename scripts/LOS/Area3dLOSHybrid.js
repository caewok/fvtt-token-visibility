/* globals
canvas,
CONFIG,
PIXI
*/
"use strict";

import { Area3dLOS } from "./Area3dLOS.js";
import { AREA3D_POPOUTS } from "./Area3dPopout.js"; // Debugging pop-up

// PlaceablePoints folder
import { DrawingPoints3d } from "./PlaceablesPoints/DrawingPoints3d.js";
import { TokenPoints3d } from "./PlaceablesPoints/TokenPoints3d.js";
import { TilePoints3d } from "./PlaceablesPoints/TilePoints3d.js";
import { WallPoints3d } from "./PlaceablesPoints/WallPoints3d.js";

// Base folder
import { Settings } from "../settings.js";
import { buildTokenPoints } from "./util.js";

// Geometry folder
import { Draw } from "../geometry/Draw.js"; // For debugging
import { ClipperPaths } from "../geometry/ClipperPaths.js";
import { Matrix } from "../geometry/Matrix.js";

// WebGL2
import { Point3d } from "../geometry/3d/Point3d.js";
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./Placeable3dShader.js";

const RADIANS_90 = Math.toRadians(90);

/**
 * Uses Area3dLOSGeometric unless a tile is encountered, at which point it switches to
 * Area3dLOSWebGL2.
 * To avoid recalculating things, this class copies over code from both and modifies
 * the `percentVisible` method.
 */
export class Area3dLOSHybrid extends Area3dLOS {

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

    // WebGL
    this.#frustrum.initialized = false;
    this.#targetDistance3dProperties.initialized = false;
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
      || (this.#visibleTargetPoints = new TokenPoints3d(this.target, { tokenBorder: this.config.visibleTargetShape }));
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
    const size = canvas.scene.dimensions.size;
    let tokenBorder = canvas.grid.isHex
      ? new PIXI.Polygon(canvas.grid.grid.getBorderPolygon(1, 1, 0))
      : new PIXI.Rectangle(0, 0, size, size);
    const { x, y } = this.target.center;
    tokenBorder = tokenBorder.translate(x - (size * 0.5), y - (size * 0.5));

    // Transform to TokenPoints3d and calculate viewable area.
    // Really only an estimate b/c the view will shift depending on where on the large token
    // we are looking.
    return new TokenPoints3d(this.target, { tokenBorder });
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
   * Uses drawings for tile holes; cannot handle transparent tile pixels.
   * @returns {number}
   */
  percentVisible() {
    const percentVisible = this._simpleVisibilityTest();
    if ( typeof percentVisible !== "undefined" ) return percentVisible;

    if ( this.blockingObjects.tiles.size ) return this.percentVisibleWebGL();
    return this.percentVisibleGeometric();
  }

  /**
   * Geometric test for percent visible.
   * @returns {number}
   */
  percentVisibleGeometric() {
    const { obscuredSides, sidePolys } = this._obscureSides();
    const obscuredSidesArea = obscuredSides.reduce((area, poly) =>
      area += poly.scaledArea({scalingFactor: this.constructor.SCALING_FACTOR}), 0);
    let sidesArea = sidePolys.reduce((area, poly) =>
      area += poly.scaledArea({scalingFactor: this.constructor.SCALING_FACTOR}), 0);

    if ( this.config.largeTarget ) sidesArea = Math.min(this._gridSquareArea(), sidesArea);

    // Round the percent seen so that near-zero areas are 0.
    // Because of trimming walls near the vision triangle, a small amount of token area can poke through
    let percentSeen = sidesArea ? obscuredSidesArea / sidesArea : 0;
    if ( percentSeen < 0.005 ) percentSeen = 0;
    return percentSeen;
  }

  /**
   * WebGL test for percent visible.
   * @returns {number}
   */
  percentVisibleWebGL() {
    // Debug: console.debug(`percentVisible|${this.viewer.name}👀 => ${this.target.name}🎯`);
    const percentVisible = this._simpleVisibilityTest();
    if ( typeof percentVisible !== "undefined" ) return percentVisible;

    performance.mark("startWebGL2");
    const renderTexture = this._renderTexture;
    const shaders = this.shaders;
    const blockingObjects = this.blockingObjects;

    // Build target mesh to measure the target viewable area.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    performance.mark("targetMesh");
    const targetMesh = this.#buildTargetMesh(shaders);

    // Build mesh of all obstacles in viewable triangle.
    performance.mark("obstacleMesh");
    const obstacleContainer = this._obstacleContainer;
    this.#buildObstacleContainer(obstacleContainer, shaders, this._buildTileShader.bind(this));

    performance.mark("renderTargetMesh");
    canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });

    // Calculate visible area of the target.
    performance.mark("targetCache");
    const targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumTarget = this.#sumRedPixels(targetCache);

    performance.mark("renderObstacleMesh");
    canvas.app.renderer.render(obstacleContainer, { renderTexture, clear: false });

    // Calculate target area remaining after obstacles.
    performance.mark("obstacleCache");
    const obstacleSum = blockingObjects.terrainWalls.size ? this.#sumRedObstaclesPixels : this.#sumRedPixels;
    const obstacleCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumWithObstacles = obstacleSum(obstacleCache);

    performance.mark("endWebGL2");
    const children = obstacleContainer.removeChildren();
    children.forEach(c => c.destroy());

    return sumWithObstacles / sumTarget;
  }


  // NOTE ----- GETTERS / SETTERS ----- //

  /**
   * Holds arrays of processed blocking points from _blockingObjects.
   * @typedef BlockingPoints
   * @type {object}
   * @type {object}:
   * @property {HorizontalPoints3d[]}   drawings
   * @property {VerticalPoints3d[]}     terrainWalls
   * @property {HorizontalPoints3d[]}   tiles
   * @property {(VerticalPoints3d|HorizontalPoints3d)[]}     tokens
   * @property {VerticalPoints3d[]}     walls
   */
  #blockingPoints = {
    drawings: [],
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
   * @property {Set<DrawingPoints3d>} drawing
   * @property {Set<WallPoints3d>}    terrainWalls
   * @property {Set<TilePoints3d>}    tiles
   * @property {Set<TokenPoints3d>}   tokens
   * @property {Set<WallPoints3d>}    walls
   */
  #blockingObjectsPoints = {
    drawings: new Set(),
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
    const { visibleTargetPoints, targetPoints, gridPoints, viewerPoint, targetLookAtMatrix } = this;
    targetPoints.setViewingPoint(viewerPoint);
    targetPoints.setViewMatrix(targetLookAtMatrix);
    visibleTargetPoints.setViewingPoint(viewerPoint);
    visibleTargetPoints.setViewMatrix(targetLookAtMatrix);
    if ( gridPoints ) {
      gridPoints.setViewingPoint(viewerPoint);
      gridPoints.setViewMatrix(targetLookAtMatrix);
    }

    // Set the matrix to look at blocking point objects from the viewer.
    const blockingPoints = this.blockingPoints;
    blockingPoints.drawings.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingPoints.tiles.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingPoints.tokens.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingPoints.walls.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
    blockingPoints.terrainWalls.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));

    // Set the matrix for drawing other debug objects
    const blockingObjectsPoints = this.blockingObjectsPoints;
    blockingObjectsPoints.drawings.forEach(pts => pts.setViewMatrix(targetLookAtMatrix));
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

    // Combine blocking tiles with drawings as holes
    const tiles = this._combineBlockingTiles();

    // Combine other objects
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
   * Sets this._blockingObjects for drawings, tiles, tokens, walls, and terrainWalls.
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
    const { drawings, terrainWalls, tiles, tokens, walls } = this.#blockingObjectsPoints;
    drawings.clear();
    terrainWalls.clear();
    tiles.clear();
    tokens.clear();
    walls.clear();

    // Add Tiles
    objs.tiles.forEach(t => tiles.add(new TilePoints3d(t, { viewerElevationZ: this.viewerPoint.z })));

    // Add Drawings
    if ( objs.tiles.size
      && objs.drawings.size ) objs.drawings.forEach(d => drawings.add(new DrawingPoints3d(d)));

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
    blockingPoints.drawings.length = 0;
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

    blockingObjectsPoints.drawings.forEach(pts => {
      const res = pts._getVisibleSplits(target, visionPolygon, { edges, viewerLoc });
      if ( res.length ) {
        res.forEach(x => x.object = pts.object); // Copy the underlying drawing object.
        blockingPoints.drawings.push(...res);
      }
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
   * If drawings with holes exist, construct relevant tiles with holes accordingly.
   * @returns {ClipperPaths|undefined}
   */
  _combineBlockingTiles() {
    const blockingPoints = this.blockingPoints;

    if ( !blockingPoints.tiles.length ) return undefined;

    if ( !blockingPoints.drawings.length ) {
      const tilePolys = blockingPoints.tiles.map(w => new PIXI.Polygon(w.perspectiveTransform()));
      const paths = ClipperPaths.fromPolygons(tilePolys, {scalingFactor: this.constructor.SCALING_FACTOR});
      paths.combine().clean();
      return paths;
    }

    // Check if any drawings might create a hole in one or more tiles
    const tilesUnholed = [];
    const tilesHoled = [];
    const scalingFactor = this.constructor.SCALING_FACTOR;
    const pixelsToGridUnits = CONFIG.GeometryLib.utils.pixelsToGridUnits;
    for ( const tilePts of blockingPoints.tiles ) {
      const drawingHoles = [];
      const tileE = pixelsToGridUnits(tilePts.z);
      const tilePoly = new PIXI.Polygon(tilePts.perspectiveTransform());
      for ( const drawingPts of blockingPoints.drawings ) {
        const minE = drawingPts.object.document.getFlag("levels", "rangeTop");
        const maxE = drawingPts.object.document.getFlag("levels", "rangeBottom");
        if ( minE == null && maxE == null ) continue; // Intended to test null, undefined
        else if ( minE == null && tileE !== maxE ) continue;
        else if ( maxE == null && tileE !== minE ) continue;
        else if ( !tileE.between(minE, maxE) ) continue;

        // We know the tile is within the drawing elevation range.
        drawingPts.elevation = tileE; // Temporarily change the drawing elevation to match tile.
        drawingHoles.push(new PIXI.Polygon(drawingPts.perspectiveTransform()));
      }

      if ( drawingHoles.length ) {
        // Construct a hole at the tile's elevation from the drawing taking the difference.
        const drawingHolesPaths = ClipperPaths.fromPolygons(drawingHoles, { scalingFactor });
        const tileHoled = drawingHolesPaths.diffPolygon(tilePoly);
        tilesHoled.push(tileHoled);
      } else tilesUnholed.push(tilePoly);
    }

    if ( tilesUnholed.length ) {
      const unHoledPaths = ClipperPaths.fromPolygons(tilesUnholed, { scalingFactor });
      unHoledPaths.combine().clean();
      tilesHoled.push(unHoledPaths);
    }

    // Combine all the tiles, holed and unholed
    const paths = ClipperPaths.combinePaths(tilesHoled);
    paths.combine().clean();
    return paths;
  }

  // ----- NOTE: Debugging methods ----- //
  get popout() { return AREA3D_POPOUTS.hybrid; }

  #debugGraphics;

  get debugDrawTool() {
    // If popout is active, use the popout graphics.
    // If not active, use default draw graphics.
    const popout = this.popout;
    if ( !popout.app.rendered ) return undefined;

    const stage = popout.app.pixiApp.stage;
    if ( !stage ) return undefined;

    stage.removeChildren();

    if ( !this.#debugGraphics || this.#debugGraphics._destroyed ) this.#debugGraphics = new PIXI.Graphics();
    popout.app.pixiApp.stage.addChild(this.#debugGraphics);
    return new Draw(this.#debugGraphics);
  }

  /**
   * For debugging.
   * Popout the debugging window if not already rendered.
   * Clear drawings in that canvas.
   * Clear other children.
   */
  async enableDebugPopout() {
    await super._enableDebugPopout();
  }

  /**
   * For debugging
   * Switch drawing depending on the algorithm used.
   */
  _draw3dDebug() {
    const drawTool = this.debugDrawTool; // Draw in the pop-up box.
    if ( !drawTool ) return;
    drawTool.clearDrawings();

    const app = this.popout.app?.pixiApp;
    const stage = app?.stage;
    if ( !stage ) return;
    stage.removeChildren();

    if ( this.blockingObjects.tiles.size ) this._draw3dDebugWebGL();
    else this._draw3dDebugGeometric();
  }

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebugGeometric() {
    const drawTool = this.debugDrawTool; // Draw in the pop-up box.
    if ( !drawTool ) return;
    const colors = Draw.COLORS;
    drawTool.clearDrawings();

    // Draw the target in 3d, centered on 0,0
    this.visibleTargetPoints.drawTransformed({ color: colors.black, drawTool });
    if ( this.config.largeTarget ) this.gridPoints.drawTransformed({ color: colors.lightred, drawTool });

    // Draw the detected objects in 3d, centered on 0,0
    const pts = this.config.debugDrawObjects ? this.blockingObjectsPoints : this.blockingPoints;
    pts.walls.forEach(w => w.drawTransformed({ color: colors.blue, fillAlpha: 0.5, drawTool }));
    pts.tiles.forEach(w => w.drawTransformed({ color: colors.yellow, fillAlpha: 0.3, drawTool }));
    pts.drawings.forEach(d => d.drawTransformed({ color: colors.gray, fillAlpha: 0.3, drawTool }));
    pts.tokens.forEach(t => t.drawTransformed({ color: colors.orange, drawTool }));
    pts.terrainWalls.forEach(w => w.drawTransformed({ color: colors.lightgreen, fillAlpha: 0.1, drawTool }));
  }

  // ----- NOTE: WebGL ----- //

  _tileShaders = new Map();

  _tileDebugShaders = new Map();

  constructor(viewer, target, config) {
    super(viewer, target, config);
    this.config.useDebugShaders ??= true;
  }

  /** @type {object} */
  #targetDistance3dProperties = {
    diagonal: 0,
    farDistance: 0,
    nearDistance: 0,
    initialized: false
  };

  get targetDistance3dProperties() {
    if ( !this.#targetDistance3dProperties.initialized ) this._calculateTargetDistance3dProperties();
    return this.#targetDistance3dProperties;
  }

  /** @type {object} */
  #shaders;

  /** @type {object} */
  #debugShaders;

  get shaders() {
    if ( !this.#shaders ) this._initializeShaders();
    return this.#shaders;
  }

  get debugShaders() {
    if ( !this.config.useDebugShaders ) return this.shaders;
    if ( !this.#debugShaders ) this._initializeDebugShaders();
    return this.#debugShaders;
  }

  _initializeShaders() {
    this.#shaders = {};
    const shaders = [
      "target",
      "obstacle",
      "terrainWall"
    ];

    for ( const shaderName of shaders ) {
      this.#shaders[shaderName] = Placeable3dShader.create(this.viewerPoint, this.targetCenter);
    }

    // Set color for each shader.
    this.#shaders.target.setColor(1, 0, 0, 1); // Red
    this.#shaders.obstacle.setColor(0, 0, 1, 1);  // Blue
    this.#shaders.terrainWall.setColor(0, 0, 1, 0.5); // Blue, half-alpha
  }

  _initializeDebugShaders() {
    this.#debugShaders = {};
    const shaders = [
      "target",
      "obstacle",
      "terrainWall"
    ];

    for ( const shaderName of shaders ) {
      this.#debugShaders[shaderName] = Placeable3dDebugShader.create(this.viewerPoint, this.targetCenter);
    }
  }

  /**
   * Describes the viewing frustum used by the shaders to view the target.
   */
  #frustrum = {
    near: 1,
    far: 1000,
    fov: RADIANS_90,
    initialized: false
  };

  get frustrum() {
    if ( !this.#frustrum.initialized ) this.#constructFrustrum();
    return this.#frustrum;
  }

  _calculateTargetDistance3dProperties() {
    const { viewerPoint, target } = this;
    const props = this.#targetDistance3dProperties;

    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const { topZ, bottomZ, bounds } = target;
    const tokenBoundaryPts = [
      new Point3d(bounds.left, bounds.top, topZ),
      new Point3d(bounds.right, bounds.top, topZ),
      new Point3d(bounds.right, bounds.bottom, topZ),
      new Point3d(bounds.left, bounds.bottom, topZ),

      new Point3d(bounds.left, bounds.top, bottomZ),
      new Point3d(bounds.right, bounds.top, bottomZ),
      new Point3d(bounds.right, bounds.bottom, bottomZ),
      new Point3d(bounds.left, bounds.bottom, bottomZ)
    ];

    const distances = tokenBoundaryPts.map(pt => Point3d.distanceBetween(viewerPoint, pt));
    const distMinMax = Math.minMax(...distances);

    props.farDistance = distMinMax.max;
    props.nearDistance = distMinMax.min;
    props.diagonal = Point3d.distanceBetween(tokenBoundaryPts[0], tokenBoundaryPts[6]);
    props.initialized = true;
  }


  /**
   * Calculate the relevant frustrum properties for this viewer and target.
   * We want the target token to be completely within the viewable frustrum but
   * take up as much as the frustrum frame as possible, while limiting the size of the frame.
   */
  #constructFrustrum() {
    const viewerAngle = Math.toRadians(this.viewer.vision?.data?.angle) || Math.PI * 2;

    // Determine the optimal fov given the distance.
    // https://docs.unity3d.com/Manual/FrustumSizeAtDistance.html
    // Use near instead of far to ensure frame at start of token is large enough.
    const { diagonal, farDistance, nearDistance } = this.targetDistance3dProperties;
    let angleRad = 2 * Math.atan(diagonal * (0.5 / nearDistance));
    angleRad = Math.min(angleRad, viewerAngle);
    angleRad ??= RADIANS_90;
    this.#frustrum.fov = angleRad;// + RADIANS_1;

    // Far distance is distance to the furthest point of the target.
    this.#frustrum.far = farDistance;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    this.#frustrum.near = canvas.dimensions.size * 0.5;

    this.#frustrum.initialized = true;
  }

  static frustrumBase(fov, dist) {
    const A = RADIANS_90 - (fov * 0.5);
    return (dist / Math.tan(A)) * 2;
  }

  static buildMesh(obj, shader) {
    const mesh = new PIXI.Mesh(obj.tokenvisibility.geometry, shader);
    mesh.state.depthTest = true;
    mesh.state.culling = true;
    mesh.state.clockwiseFrontFace = true;
    return mesh;
  }

  _buildTileShader(fov, near, far, tile) {
    if ( !this._tileShaders.has(tile) ) {
      const shader = Tile3dShader.create(this.viewerPoint, this.targetCenter,
        { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
      shader.setColor(0, 0, 1, 1); // Blue
      this._tileShaders.set(tile, shader);
    }

    const shader = this._tileShaders.get(tile);
    shader._initializeLookAtMatrix(this.viewerPoint, this.targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    return shader;
  }

  _buildTileDebugShader(fov, near, far, tile) {
    if ( !this.config.useDebugShaders ) return this._buildTileShader(fov, near, far, tile);
    if ( !this._tileDebugShaders.has(tile) ) {
      const shader = Tile3dDebugShader.create(this.viewerPoint, this.targetCenter,
        { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
      this._tileDebugShaders.set(tile, shader);
    }

    const shader = this._tileDebugShaders.get(tile);
    shader._initializeLookAtMatrix(this.viewerPoint, this.targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    return shader;
  }

  // Textures and containers used by webGL2 method.
  _obstacleContainer = new PIXI.Container();

  _renderTexture = PIXI.RenderTexture.create({
    resolution: 1,
    scaleMode: PIXI.SCALE_MODES.NEAREST,
    multisample: PIXI.MSAA_QUALITY.NONE,
    alphaMode: PIXI.NO_PREMULTIPLIED_ALPHA,
    width: 100,
    height: 100
  });

  #destroyed = false;

  destroy() {
    if ( this.#destroyed ) return;

    // Destroy this first before handling the shaders.
    this._obstacleContainer.destroy(true);

    // Destroy all shaders and render texture
    if ( this.#shaders ) Object.values(this.#shaders).forEach(s => s.destroy());
    if ( this.#debugShaders ) Object.values(this.#debugShaders).forEach(s => s.destroy());
    this._tileShaders.forEach(s => s.destroy());
    this._tileDebugShaders.forEach(s => s.destroy());
    this._tileShaders.clear();
    this._tileDebugShaders.clear();
    this._renderTexture.destroy();

    this._debugRenderTexture?.destroy();
    this._debugSprite?.destroy();
    this._debugObstacleContainer?.destroy();

    // Note that everything is destroyed to avoid errors if called again.
    this.#destroyed = true;
  }


  // ----- NOTE: WebGL Debugging methods ----- //

  _draw3dDebugWebGL() {
    // For the moment, repeat webGL2 percent visible process so that shaders with
    // colors to differentiate sides can be used.
    // Avoids using a bunch of "if" statements in JS or in GLSL to accomplish this.
    const app = this.popout.app?.pixiApp;
    const stage = app?.stage;
    if ( !stage ) return;
    stage.removeChildren();

    // Build the debug objects.
    if ( !this._debugRenderTexture ) this._debugRenderTexture = PIXI.RenderTexture.create({
      resolution: 1,
      scaleMode: PIXI.SCALE_MODES.NEAREST,
      multisample: PIXI.MSAA_QUALITY.NONE,
      alphaMode: PIXI.NO_PREMULTIPLIED_ALPHA,
      width: 400,
      height: 400
    });
    if ( !this._debugObstacleContainer ) this._debugObstacleContainer = new PIXI.Container();
    if ( !this._debugSprite ) {
      this._debugSprite = PIXI.Sprite.from(this._debugRenderTexture);
      this._debugSprite.scale = new PIXI.Point(1, -1); // Flip y-axis.
      this._debugSprite.anchor = new PIXI.Point(0.5, 0.5); // Centered on the debug window.
    }

    // Debug: console.debug(`_draw3dDebug|${this.viewer.name}👀 => ${this.target.name}🎯`);

    const shaders = this.debugShaders;
    const obstacleContainer = this._debugObstacleContainer;
    const targetMesh = this.#buildTargetMesh(shaders);
    this.#buildObstacleContainer(obstacleContainer, shaders, this._buildTileDebugShader.bind(this));
    const renderTexture = this._debugRenderTexture;
    app.renderer.render(targetMesh, { renderTexture, clear: true });
    app.renderer.render(obstacleContainer, { renderTexture, clear: false });
    stage.addChild(this._debugSprite);

    targetMesh.destroy();
    obstacleContainer.removeChildren().forEach(c => c.destroy());

    // For testing the mesh directly:
    // stage.addChild(targetMesh);
    // stage.addChild(c);

    // Temporarily render the texture for debugging.
    // if ( !this.renderSprite || this.renderSprite.destroyed ) {
    //  this.renderSprite ??= PIXI.Sprite.from(this._renderTexture);
    //  this.renderSprite.scale = new PIXI.Point(1, -1); // Flip y-axis.
    //  canvas.stage.addChild(this.renderSprite);
    // }
  }

  #buildTargetMesh(shaders) {
    const targetShader = shaders.target;
    const { near, far, fov } = this.frustrum;
    targetShader._initializeLookAtMatrix(this.viewerPoint, this.targetCenter);
    targetShader._initializePerspectiveMatrix(fov, 1, near, far);
    return this.constructor.buildMesh(this.target, targetShader);
  }

  #buildObstacleContainer(container, shaders, tileMethod) {
    const { viewerPoint, targetCenter, frustrum, blockingObjects } = this;
    const buildMesh = this.constructor.buildMesh;
    const { near, far, fov } = frustrum;

    // Limited angle walls
    if ( blockingObjects.terrainWalls.size ) {
      const terrainWallShader = shaders.terrainWall;
      terrainWallShader._initializeLookAtMatrix(viewerPoint, targetCenter);
      terrainWallShader._initializePerspectiveMatrix(fov, 1, near, far);
      for ( const terrainWall of blockingObjects.terrainWalls ) {
        const mesh = buildMesh(terrainWall, terrainWallShader);
        container.addChild(mesh);
      }
    }

    // Walls/Tokens
    const otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
    if ( otherBlocking.size ) {
      const obstacleShader = shaders.obstacle;
      obstacleShader._initializeLookAtMatrix(viewerPoint, targetCenter);
      obstacleShader._initializePerspectiveMatrix(fov, 1, near, far);
      for ( const obj of otherBlocking ) {
        const mesh = buildMesh(obj, obstacleShader);
        container.addChild(mesh);
      }
    }

    // Tiles
    if ( blockingObjects.tiles.size ) {
      for ( const tile of blockingObjects.tiles ) {
        const tileShader = tileMethod(fov, near, far, tile);
        const mesh = buildMesh(tile, tileShader);
        container.addChild(mesh);
      }
    }
  }

  #sumRedPixels(targetCache) {
    const pixels = targetCache.pixels;
    const nPixels = pixels.length;
    let sumTarget = 0;
    for ( let i = 0; i < nPixels; i += 4 ) sumTarget += Boolean(targetCache.pixels[i]);
    return sumTarget;
  }

  #sumRedObstaclesPixels(targetCache) {
    const pixels = targetCache.pixels;
    const nPixels = pixels.length;
    let sumTarget = 0;
    for ( let i = 0; i < nPixels; i += 4 ) {
      const px = pixels[i];
      if ( px < 128 ) continue;
      sumTarget += Boolean(targetCache.pixels[i]);
    }
    return sumTarget;
  }
}
