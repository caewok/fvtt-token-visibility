/* globals
canvas,
CONFIG,
CONST,
foundry,
glMatrix,
PIXI
Ray,
Token,
VisionSource
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


import { AlternativeLOS } from "./AlternativeLOS.js";
import { AREA3D_POPOUTS } from "./Area3dPopout.js"; // Debugging pop-up

// webGL2
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./Placeable3dShader.js";


// PlaceablePoints folder
import { DrawingPoints3d } from "./PlaceablesPoints/DrawingPoints3d.js";
import { TokenPoints3d } from "./PlaceablesPoints/TokenPoints3d.js";
import { TilePoints3d } from "./PlaceablesPoints/TilePoints3d.js";
import { WallPoints3d } from "./PlaceablesPoints/WallPoints3d.js";
import { PixelCache } from "./PixelCache.js";
import { AlphaCutoffFilter } from "./AlphaCutoffFilter.js";

// Base folder
import { Settings, SETTINGS } from "../settings.js";
import { buildTokenPoints } from "./util.js";

// Geometry folder
import { Draw } from "../geometry/Draw.js"; // For debugging
import { ClipperPaths } from "../geometry/ClipperPaths.js";
import { Matrix } from "../geometry/Matrix.js";
import { Point3d } from "../geometry/3d/Point3d.js";

const RADIANS_90 = Math.toRadians(90);
const RADIANS_1 = Math.toRadians(1);
const mat4 = glMatrix.mat4;

export class Area3dLOS extends AlternativeLOS {

  /** @type {TokenPoints3d} */
  targetPoints;

  /** @type {TokenPoints3d} */
  visibleTargetPoints;

  /** @type {TokenPoints3d} */
  gridPoints;

  /** @type {Point3d} */
  _targetTop;

  /** @type {Point3d} */
  _targetBottom;

  /** @type {Point3d} */
  _targetCenter;

  /** @type {boolean} */
  #debug = false;

  /** @type {Draw} **/
  debugDrawTools = {
    geometric: new Draw(),
    webGL: new Draw(),
    webGL2: new Draw()
  };

  /**
   * Holds Foundry objects that are within the vision triangle.
   * @typedef BlockingObjects
   * @type {object}
   * @property {Set<Drawing>} drawing
   * @property {Set<Wall>}    terrainWalls
   * @property {Set<Tile>}    tiles
   * @property {Set<Token>}   tokens
   * @property {Set<Wall>}    walls
   */
  _blockingObjects = {
    drawings: new Set(),
    terrainWalls: new Set(),
    tiles: new Set(),
    tokens: new Set(),
    walls: new Set()
  };

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
  _blockingPoints = {
    drawings: [],
    terrainWalls: [],
    tiles: [],
    tokens: [],
    walls: []
  };

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
  _blockingObjectsPoints = {
    drawings: new Set(),
    terrainWalls: new Set(),
    tiles: new Set(),
    tokens: new Set(),
    walls: new Set()
  };

  /**
   * The viewable area between viewer and target.
   * Typically, this is a triangle, but if viewed head-on, it will be a triangle
   * with the portion of the target between viewer and target center added on.
   * @type {PIXI.Polygon}
   */
  _visionPolygon;

  /** @type {Shadow[]} */
  wallShadows = [];

  /** @type {boolean} */
  #viewIsSet = false;

  /** @type {boolean} */
  #blockingObjectsAreSet = false;

  /** @type {boolean} */
  #blockingObjectsPointsAreSet = false;

  /** @type {boolean} */
  #blockingPointsAreSet = false;

  /**
   * Vector representing the up position on the canvas.
   * Used to construct the token camera and view matrices.
   * @type {Point3d}
   */
  static #upVector = new Point3d(0, 0, -1);

  /**
   * Scaling factor used with Clipper
   */
  static SCALING_FACTOR = 100;

  /**
   * @param {PointSource|Token|VisionSource} viewer   Token, viewing from token.topZ.
   * @param {Target} target                           Target; token is looking at the target center.
   */
  constructor(viewer, target, config = {}) {
    if ( viewer instanceof Token ) viewer = viewer.vision;
    if ( viewer instanceof VisionSource ) config.visionSource ??= viewer;
    super(viewer, target, config);
    this.#configure(config);
    this.targetPoints = new TokenPoints3d(target);
    this.visibleTargetPoints = new TokenPoints3d(target, { tokenBorder: this.config.visibleTargetShape });

    // Set debug only if the target is being targeted.
    // Avoids "double-vision" from multiple targets for area3d on scene.
    if ( this.config.debug ) {
      const targets = canvas.tokens.placeables.filter(t => t.isTargeted);
      this.debug = targets.some(t => t === target);
    }

    if ( this.config.largeTarget ) this.gridPoints = this._buildGridShape();
  }

  #configure(config = {}) {
    if ( !config.visionSource ) { console.error("Area3dLOS requires a visionSource."); }
    const cfg = this.config;
    cfg.visionSource = config.visionSource ?? canvas.tokens.controlled[0] ?? [...canvas.tokens.placeables][0];
    cfg.algorithm = config.algorithm ?? "geometric"; // Options: webGL, webGL2
  }

  get debug() { return this.#debug; }

  set debug(value) {
    this.#debug = Boolean(value);
    // this.popoutDebug(this.config.algorithm);
  }

  async popoutDebug(algorithm) {
    const popout = AREA3D_POPOUTS[algorithm];
    if ( !popout.shown ) await popout.app._render(true);
    const drawTool = this.debugDrawTools[algorithm] = new Draw(popout.app.graphics);
    drawTool.clearDrawings();
  }

  _clearCache() {
    this.#viewIsSet = false;
    this.#blockingObjectsAreSet = false;
    this.#blockingObjectsPointsAreSet = false;
    this.#blockingPointsAreSet = false;
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
      area += poly.scaledArea({scalingFactor: Area3d.SCALING_FACTOR}), 0);
  }

  // NOTE ----- USER-FACING METHODS -----

  /**
   * Determine whether a visionSource has line-of-sight to a target based on the percent
   * area of the target visible to the source.
   * @param {number} [thresholdArea]    Area required to have LOS between 0 and 1
   *   0% means any line-of-sight counts.
   *   100% means the entire token must be visible.
   * @returns {boolean}
   */
  hasLOS(thresholdArea) {
    thresholdArea ??= Settings.get(SETTINGS.LOS.TARGET.PERCENT);

    // If center point is visible, then target is likely visible but not always.
    // e.g., walls slightly block the center point. Or walls block all but center.

    const percentVisible = this.percentVisible();
    const hasLOS = !percentVisible.almostEqual(0)
      && ((percentVisible > thresholdArea)
        || percentVisible.almostEqual(thresholdArea));

    if ( this.config.debug ) {
      // Fill in the constrained border on canvas
      const draw = new Draw(Settings.DEBUG_LOS);
      const color = hasLOS ? Draw.COLORS.green : Draw.COLORS.red;
      const visibleShape = this.config.visibleTargetShape;
      draw.shape(this.target.constrainedTokenBorder, { color, fill: color, fillAlpha: 0.2});
      if ( visibleShape ) draw.shape(visibleShape, { color: Draw.COLORS.yellow });
    }
    return hasLOS;
  }

  /**
   * Determine the percentage area of the 3d token visible to the viewer.
   * Measured by projecting the 3d token to a 2d canvas representing the viewer's perspective.
   * @returns {number}
   */
  percentVisible() {
    if ( this.config.algorithm === "webGL" ) {
      try {
        const percent = this._percentVisibleWebGL();
        return percent;
      } catch( error ) {
        console.error(error);
      }
    } else if ( this.config.algorithm === "webGL2" ) {
      try {
        const percent = this._percentVisibleWebGL2();
        return percent;
      } catch( error ) {
        console.error(error);
      }
    }
    return this._percentVisibleGeometric();
  }

  /**
   * Determine percentage area by estimating the blocking shapes geometrically.
   * Uses drawings for tile holes; cannot handle transparent tile pixels.
   * @returns {number}
   */
  _percentVisibleGeometric() {
    const objs = this.blockingObjects;
    if ( !this.debug
      && !objs.walls.size
      && !objs.tiles.size
      && !objs.tokens.size
      && objs.terrainWalls.size < 2 ) return 1;

    const { obscuredSides, sidePolys } = this._obscureSides();
    const obscuredSidesArea = obscuredSides.reduce((area, poly) =>
      area += poly.scaledArea({scalingFactor: Area3d.SCALING_FACTOR}), 0);
    let sidesArea = sidePolys.reduce((area, poly) =>
      area += poly.scaledArea({scalingFactor: Area3d.SCALING_FACTOR}), 0);

    if ( this.config.largeTarget ) sidesArea = Math.min(this._gridSquareArea(), sidesArea);

    // Round the percent seen so that near-zero areas are 0.
    // Because of trimming walls near the vision triangle, a small amount of token area can poke through
    let percentSeen = sidesArea ? obscuredSidesArea / sidesArea : 0;
    if ( percentSeen < 0.005 ) percentSeen = 0;

    if ( this.debug ) this.#drawDebugShapes(objs, obscuredSides, sidePolys);
    if ( this.config.debug ) console.debug(`Area3dLOS|${this.target.name} is ${Math.round(percentSeen * 100)}% visible from ${this.config.visionSource?.object?.name}`);
    return percentSeen;
  }

  // Pixel cache for measuring percentage visible using WebGL
  targetCache;

  obstacleCache;

  // For now, store the graphics containers for debugging.
  targetGraphics = new PIXI.Graphics();

  blockingGraphics = new PIXI.Graphics();

  terrainGraphics = new PIXI.Graphics();

  tileContainer = new PIXI.Container();

  targetRT;

  /**
   * Determine percentage area by estimating the blocking shapes using PIXI.Graphics and WebGL.
   * Constructs a render texture to estimate the percentage.
   * @returns {number}
   */
  _percentVisibleWebGL() {
    if ( !this.#viewIsSet ) this.calculateViewMatrix();
    const TARGET_COLOR = Draw.COLORS.red;
    const OBSTACLE_COLOR = Draw.COLORS.red;
    const TERRAIN_COLOR = Draw.COLORS.green;
    const blockingPoints = this.blockingPoints;

    // Set width = 0 to avoid drawing a border line. The border line will use antialiasing
    // and that causes a lighter-color border to appear outside the shape.
    const drawOpts = {
      color: TARGET_COLOR,
      width: 0,
      fill: TARGET_COLOR,
      fillAlpha: 1,
      drawTool: undefined
    };

    // Clear everything
    this.targetGraphics.clear();
    this.blockingGraphics.clear();
    this.terrainGraphics.clear();
    const children = this.tileContainer.removeChildren();
    children.forEach(c => c.destroy());
    if ( this.targetRT ) { this.targetRT.destroy(); }

    // Draw the target shape.
    const targetGraphics = this.targetGraphics;
    drawOpts.drawTool = new Draw(targetGraphics);
    this.targetPoints.drawTransformed(drawOpts);

    // TODO: Can we draw these using WebGL shader so that if they are behind the target,
    // they are not drawn or otherwise ignored? Could then use _blockingObjectsPoints, which is simpler.
    // Draw walls.
    const blockingGraphics = this.blockingGraphics;
    drawOpts.drawTool = new Draw(blockingGraphics);
    drawOpts.color = OBSTACLE_COLOR;
    drawOpts.fill = OBSTACLE_COLOR;
    blockingPoints.walls.forEach(w => w.drawTransformed(drawOpts));

    // Draw token obstacles
    blockingPoints.tokens.forEach(t => t.drawTransformed(drawOpts));

    // Draw terrain walls.
    // Use a separate container with an AlphaCutoffFilter.
    // For an additive blend, can set each terrain to alpha 0.4. Any overlap will be over 0.5.
    const terrainGraphics = this.terrainGraphics;
    if ( blockingPoints.terrainWalls.size ) {
      if ( !terrainGraphics.filter
        || !terrainGraphics.filter.length ) terrainGraphics.filters = [new AlphaCutoffFilter(0.5)];
      drawOpts.drawTool = new Draw(terrainGraphics);
      drawOpts.color = TERRAIN_COLOR;
      drawOpts.fill = TERRAIN_COLOR;
      drawOpts.fillAlpha = 0.4;
      blockingPoints.terrainWalls.forEach(w => w.drawTransformed(drawOpts));
    }

    // Draw tiles.
    // Each requires its own container.
    const tileContainer = this.tileContainer;
    const tileFilter = new AlphaCutoffFilter(0.75);
    const Sprite2d = PIXI.projection.Sprite2d;

    // TODO: Does _blockingObjectsPoints even for tiles under a target token?
    for ( const tilePts of this._blockingObjectsPoints.tiles ) {
      // TODO: Need to cutoff tiles at the z=0 point. And need to have the uv coordinates reflect this.
      // Any chance mapSprite will do this?
      const containerSprite = new Sprite2d(tilePts.object.texture);
      containerSprite.filters = [tileFilter];
      tileContainer.addChild(containerSprite);
      const perspectivePoints = tilePts.perspectiveTransform();
      containerSprite.proj.mapSprite(containerSprite, perspectivePoints);

      // Adjust the uvs points if the tile is cutoff behind the viewer.
      containerSprite.calculateVertices(); // Force uvs to be calculated.
      const tileUVs = tilePts.uvs;
      for ( let i = 0; i < 8; i += 1 ) containerSprite.uvs[i] = tileUVs[i];

    }

    // Draw everything. Need to first draw the red target token, then draw all the blue obstacles on top.
    const blockingContainer = new PIXI.Container();
    blockingContainer.addChild(blockingGraphics);
    blockingContainer.addChild(terrainGraphics);
    blockingContainer.addChild(tileContainer);

    // Translate the points to fit in the render texture.
    const txPtsArray = this.targetPoints.faces.map(face => face.perspectiveTransform());
    const xValues = [];
    const yValues = [];
    for ( const ptArray of txPtsArray ) {
      for ( const pt of ptArray ) {
        xValues.push(pt.x);
        yValues.push(pt.y);
      }
    }
    const xMinMax = Math.minMax(...xValues);
    const yMinMax = Math.minMax(...yValues);

    targetGraphics.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
    blockingContainer.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
    blockingContainer.blendMode = PIXI.BLEND_MODES.DST_OUT; // Works: removes the red.

    const texConfig = {
      resolution: 1,
      width: xMinMax.max - xMinMax.min,
      height: yMinMax.max - yMinMax.min,
      scaleMode: PIXI.SCALE_MODES.NEAREST
    };
    // TODO: Keep and clear instead of destroying the render texture.
    const renderTexture = this.targetRT = PIXI.RenderTexture.create(texConfig);

    // Render only the target shape and calculate its rendered visible area.
    canvas.app.renderer.render(targetGraphics, { renderTexture, clear: true });
    const targetCache = this.targetCache = PixelCache.fromTexture(renderTexture, { resolution: 0.25 } );
    const sumTarget = targetCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);

    // Render all the obstacles and calculate the remaining area.
    canvas.app.renderer.render(blockingContainer, { renderTexture, clear: false });
    const obstacleCache = this.obstacleCache = PixelCache.fromTexture(renderTexture, { resolution: 0.25 });
    const sumWithObstacles = obstacleCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);

    blockingContainer.destroy();

    if ( this.debug ) this.drawWebGLDebug();


    /* Testing
    s = new PIXI.Sprite(renderTexture)
    canvas.stage.addChild(s)
    canvas.stage.removeChild(s)
    */

    return sumWithObstacles / sumTarget;
  }

  async drawWebGLDebug() {
    // TODO: Make removing and adding less stupid.
    await this.popoutDebug("webGL");
    const stage = AREA3D_POPOUTS.webGL.app.pixiApp.stage;

    // For now, remove sprite and add new one.
    const sprites = stage.children.filter(c => c instanceof PIXI.Sprite);
    sprites.forEach(s => stage.removeChild(s));
    sprites.forEach(s => s.destroy());

    // Add the new sprite
    const s = new PIXI.Sprite(this.targetRT);
    stage.addChild(s);
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

  _buildShader(fov, near, far, color) {
    const shader = Placeable3dShader.create(this.viewerPoint, this.targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
    shader.setColor(color.r, color.g, color.b, color.a);
    return shader;
  }

  _buildTileShader(fov, near, far, color, tile) {
    const shader = Tile3dShader.create(this.viewerPoint, this.targetCenter,
      { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
    shader.setColor(color.r, color.g, color.b, color.a);
    return shader;
  }

  _buildDebugShader(fov, near, far, color) {
    const shader = Placeable3dDebugShader.create(this.viewerPoint, this.targetCenter);
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
    shader.setColor(color.r, color.g, color.b, color.a);
    return shader;
  }

  _buildTileDebugShader(fov, near, far, color, tile) {
    const shader = Tile3dDebugShader.create(this.viewerPoint, this.targetCenter,
      { uTileTexture: tile.texture.baseTexture, uAlphaThreshold: 0.7 });
    shader._initializePerspectiveMatrix(fov, 1, near, far);
    mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
    shader.setColor(color.r, color.g, color.b, color.a);
    return shader;
  }

  _percentVisibleWebGL2() {
    // If no blocking objects, line-of-sight is assumed true.
    performance.mark("Start_webGL2");
    const target = this.target;
    const blockingObjects = this.blockingObjects;
    if ( !(blockingObjects.tokens.size
        || blockingObjects.walls.size
        || blockingObjects.tiles.size
        || blockingObjects.terrainWalls.size > 1) ) return 1;

    // We want the target token to be within the viewable frustrum.
    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const targetBoundaryPts = target.bounds.viewablePoints(this.viewerPoint);

    // Angle is between the two segments from the origin.
    // TODO: Handle limited angle vision.
    const angleRad = PIXI.Point.angleBetween(targetBoundaryPts[0], this.viewerPoint, targetBoundaryPts[1]);
    const fov = angleRad + RADIANS_1;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    const near = canvas.dimensions.size * 0.5;

    // Far distance is distance to the center of the target plus 1/2 the diagonal.
    const { w, h } = target;
    const diagDist = Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2)) * 0.5;
    const dist = Point3d.distanceBetween(this.viewerPoint, this.targetCenter) + diagDist;
    const far = Math.ceil(dist);

    // Create texture
    const frustrumBase = Math.ceil(this.constructor.frustrumBase(fov, far));
    const texConfig = {
      resolution: 1,
      width: frustrumBase,
      height: frustrumBase,
      scaleMode: PIXI.SCALE_MODES.NEAREST
    };

    // TODO: Keep and clear instead of destroying the render texture.
    performance.mark("create_renderTexture");
    const renderTexture = this.renderTexture = PIXI.RenderTexture.create(texConfig);
    performance.mark("targetmesh");

    // Create shaders, mesh, draw to texture.
    const buildMesh = this.constructor.buildMesh;
    const CACHE_RESOLUTION = 1.0;

    // 1 for the target, in red
    const targetShader = this._buildShader(fov, near, far, { r: 1, g: 0, b: 0, a: 1 });
    const targetMesh = buildMesh(target, targetShader);

    // Render target and calculate its visible area alone.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    performance.mark("renderTargetMesh");
    canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });

    performance.mark("targetCache_start")
    const targetCache = this.targetCache = PixelCache.fromTexture(renderTexture,
      { resolution: CACHE_RESOLUTION, channel: 0 });
    const sumTarget = targetCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);
    performance.mark("obstaclemesh")

    // TODO: Fix garbage handling; destroy the shaders and meshes.

    // 1 for the terrain walls
    if ( blockingObjects.terrainWalls.size ) {
      // Can we set alpha to 0.5 and add overlapping walls to get to 1.0 blue?
      // Or multiply, so 0.7 * 0.7 = 0.49?
      // Or set to green and then process with pixel cache?
      // Then process the pixel cache to ignore blue alpha?
      // For the moment, draw with blue alpha
      const terrainWallShader = this._buildShader(fov, near, far, { r: 0, g: 0, b: 1, a: 0.5 });
      for ( const terrainWall of blockingObjects.terrainWalls ) {
        const mesh = buildMesh(terrainWall, terrainWallShader);
        canvas.app.renderer.render(mesh, { renderTexture, clear: false });
      }
    }

    // 1 for the walls/tokens, in blue
    const otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
    if ( otherBlocking.size ) {
      const wallShader = this._buildShader(fov, near, far, { r: 0, g: 0, b: 1, a: 1 });
      for ( const obj of otherBlocking ) {
        const mesh = buildMesh(obj, wallShader);
        canvas.app.renderer.render(mesh, { renderTexture, clear: false });
      }
    }

    // 1 for the tiles
    if ( blockingObjects.tiles.size ) {
      for ( const tile of blockingObjects.tiles ) {
        const tileShader = this._buildTileShader(fov, near, far, { r: 0, g: 0, b: 1, a: 1 }, tile);
        const mesh = buildMesh(tile, tileShader);
        canvas.app.renderer.render(mesh, { renderTexture, clear: false });
      }
    }

    // Calculate area remaining.
    // TODO: Handle terrain walls.
    performance.mark("obstacleCache")
    const obstacleCache = this.obstacleCache = PixelCache.fromTexture(renderTexture,
      { resolution: CACHE_RESOLUTION, channel: 0 });
    const sumWithObstacles = obstacleCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);
    performance.mark("end_webGL2")

    if ( this.debug ) this.drawWebGL2Debug();

    return sumWithObstacles / sumTarget;
  }

  async drawWebGL2Debug() {
    // For the moment, repeat webGL2 percent visible process so that shaders with
    // colors to differentiate sides can be used.
    // Avoids using a bunch of "if" statements in JS or in GLSL to accomplish this.




    // For now, remove render texture and add new one.
    const sprites = stage.children.filter(c => c instanceof PIXI.Sprite);
    sprites.forEach(s => stage.removeChild(s));
    sprites.forEach(s => s.destroy());

    // If no blocking objects, line-of-sight is assumed true.
    const target = this.target;
    const blockingObjects = this.blockingObjects;
    if ( !(blockingObjects.tokens.size
        || blockingObjects.walls.size
        || blockingObjects.tiles.size
        || blockingObjects.terrainWalls.size > 1) ) return 1;

    // We want the target token to be within the viewable frustrum.
    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const targetBoundaryPts = target.bounds.viewablePoints(this.viewerPoint);

    // Angle is between the two segments from the origin.
    // TODO: Handle limited angle vision.
    const angleRad = PIXI.Point.angleBetween(targetBoundaryPts[0], this.viewerPoint, targetBoundaryPts[1]);
    const fov = angleRad + RADIANS_1;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    const near = canvas.dimensions.size * 0.5;

    // Far distance is distance to the center of the target plus 1/2 the diagonal.
    const { w, h } = target;
    const diagDist = Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2)) * 0.5;
    const dist = Point3d.distanceBetween(this.viewerPoint, this.targetCenter) + diagDist;
    const far = Math.ceil(dist);

    // Create texture
    const frustrumBase = Math.ceil(this.constructor.frustrumBase(fov, far));
    const texConfig = {
      resolution: 1,
      width: frustrumBase,
      height: frustrumBase,
      scaleMode: PIXI.SCALE_MODES.NEAREST
    };

    // For the moment, create the texture and container
    await this.popoutDebug("webGL2");
    const stage = AREA3D_POPOUTS.webGL2.app.pixiApp.stage;
    const popoutApp = AREA3D_POPOUTS.webGL2.app.pixiApp
    const meshContainer = new PIXI.Container();

    // Test different rendererrs
    const rtAuto = PIXI.RenderTexture.create(texConfig);
    const rtCanvas = PIXI.RenderTexture.create(texConfig);
    const rtPopout = PIXI.RenderTexture.create(texConfig);








    // TODO: Keep and clear instead of destroying the render texture.
    const renderTexture = this.renderTextureDebug = PIXI.RenderTexture.create(texConfig);

    // Create shaders, mesh, draw to texture.
    const buildMesh = this.constructor.buildMesh;

    // Unused:
    // const CACHE_RESOLUTION = 1.0;

    // 1 for the target, in red
    const targetShader = this._buildDebugShader(fov, near, far, { r: 1, g: 0, b: 0, a: 1 });
    const targetMesh = buildMesh(target, targetShader);
    meshContainer.addChild(targetMesh);

    // Render target and calculate its visible area alone.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });

    // Unused:
    // const targetCache = this.targetCache = PixelCache.fromTexture(renderTexture,
    //   { resolution: CACHE_RESOLUTION, channel: 0 });
    // const sumTarget = targetCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);

    // TODO: Fix garbage handling; destroy the shaders and meshes.

    // 1 for the terrain walls
    if ( blockingObjects.terrainWalls.size ) {
      // Can we set alpha to 0.5 and add overlapping walls to get to 1.0 blue?
      // Or multiply, so 0.7 * 0.7 = 0.49?
      // Or set to green and then process with pixel cache?
      // Then process the pixel cache to ignore blue alpha?
      // For the moment, draw with blue alpha
      const terrainWallShader = this._buildDebugShader(fov, near, far, { r: 0, g: 0, b: 1, a: 0.5 });
      for ( const terrainWall of blockingObjects.terrainWalls ) {
        const mesh = buildMesh(terrainWall, terrainWallShader);
        meshContainer.addChild(mesh);
      }
    }

    // 1 for the walls/tokens, in blue
    const otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
    if ( otherBlocking.size ) {
      const wallShader = this._buildDebugShader(fov, near, far, { r: 0, g: 0, b: 1, a: 1 });
      for ( const obj of otherBlocking ) {
        const mesh = buildMesh(obj, wallShader);
        meshContainer.addChild(mesh);
      }
    }

    // 1 for the tiles
    if ( blockingObjects.tiles.size ) {
      for ( const tile of blockingObjects.tiles ) {
        const tileShader = this._buildTileDebugShader(fov, near, far, { r: 0, g: 0, b: 1, a: 1 }, tile);
        const mesh = buildMesh(tile, tileShader);
        meshContainer.addChild(mesh);
      }
    }


    const renderer = PIXI.autoDetectRenderer();
    renderer.render(meshContainer, { renderTexture: rtAuto, clear: true });
    canvas.app.renderer.render(meshContainer, { renderTexture: rtCanvas, clear: true });
    popoutApp.render(meshContainer, { renderTexture: rtPopout, clear: true });



    const s = new PIXI.Sprite(renderTexture);
    stage.addChild(s);

    // Calculate area remaining.
    // TODO: Handle terrain walls.
    // Unused:
    //     const obstacleCache = this.obstacleCache = PixelCache.fromTexture(renderTexture,
    //       { resolution: CACHE_RESOLUTION, channel: 0 });
    //     const sumWithObstacles = obstacleCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);
    //     return sumWithObstacles / sumTarget;
  }

  async #drawDebugShapes(objs, obscuredSides, sidePolys) {
    await this.popoutDebug("geometric");

    const colors = Draw.COLORS;
    const draw = new Draw(Settings.DEBUG_LOS); // Draw on the canvas.
    const drawTool = this.debugDrawTools.geometric; // Draw in the pop-up box.
    this._drawLineOfSight();

    // Draw the detected objects on the canvas
    objs.walls.forEach(w => draw.segment(w, { color: colors.blue, fillAlpha: 0.3 }));
    objs.tiles.forEach(t => draw.shape(t.bounds, { color: colors.yellow, fillAlpha: 0.3 }));
    objs.terrainWalls.forEach(w => draw.segment(w, { color: colors.lightgreen }));
    objs.drawings.forEach(d => draw.shape(d.bounds, { color: colors.gray, fillAlpha: 0.3 }));
    objs.tokens.forEach(t => draw.shape(t.constrainedTokenBorder, { color: colors.orange, fillAlpha: 0.3 }));

    // Draw the target in 3d, centered on 0,0
    this.visibleTargetPoints.drawTransformed({ color: colors.black, drawTool });
    if ( this.gridPoints ) this.gridPoints.drawTransformed({ color: colors.lightred, drawTool });

    // Draw the detected objects in 3d, centered on 0,0
    const pts = this.config.debugDrawObjects ? this.blockingObjectsPoints : this.blockingPoints;
    pts.walls.forEach(w => w.drawTransformed({ color: colors.blue, fillAlpha: 0.5, drawTool }));
    pts.tiles.forEach(w => w.drawTransformed({ color: colors.yellow, fillAlpha: 0.3, drawTool }));
    pts.drawings.forEach(d => d.drawTransformed({ color: colors.gray, fillAlpha: 0.3, drawTool }));
    pts.tokens.forEach(t => t.drawTransformed({ color: colors.orange, drawTool }));
    pts.terrainWalls.forEach(w => w.drawTransformed({ color: colors.lightgreen, fillAlpha: 0.1, drawTool }));

    // Calculate the areas of the target faces separately, along with the obscured side areas.
    const target = this.target;
    const { topZ, bottomZ } = target;
    const height = topZ - bottomZ;
    this.debugSideAreas = {
      top: target.w * target.h,
      ogSide1: target.w * height,
      ogSide2: target.h * height,
      sides: [],
      obscuredSides: []
    };
    this.debugSideAreas.sides = sidePolys.map(poly =>
      poly.scaledArea({scalingFactor: Area3d.SCALING_FACTOR}));
    this.debugSideAreas.obscuredSides = obscuredSides.map(poly =>
      poly.scaledArea({scalingFactor: Area3d.SCALING_FACTOR}));
  }

  // NOTE ----- GETTERS / SETTERS ----- //

  /** @type {BlockingObjects} */
  get blockingObjects() {
    if ( !this.#blockingObjectsAreSet ) this._findBlockingObjects();
    return this._blockingObjects;
  }

  /** @type {BlockingObjectsPoints} */
  get blockingObjectsPoints() {
    if ( !this.#blockingObjectsPointsAreSet ) this._constructBlockingObjectsPoints();
    return this._blockingObjectsPoints;
  }

  /** @type {BlockingPoints} */
  get blockingPoints() {
    if ( !this.#blockingPointsAreSet ) this._constructBlockingPointsArray();
    return this._blockingPoints;
  }

  /**
   * @type {object}
  /**
   * Get the array of sides, obscured by walls and shadows, if any.
   */
  get obscuredSides() {
    return this._obscuredSides || (this._obscuredSides = this._obscureSides());
  }

  get viewerViewM() {
    if ( !this._viewerViewM ) this.viewerCameraM; // eslint-disable-line no-unused-expressions
    return this._viewerViewM;
  }

  get viewerCameraM() {
    if ( !this._viewerCameraM ) {
      const { M, Minv } = this._calculateViewerCameraMatrix();
      this._viewerCameraM = M;
      this._viewerViewM = Minv;
    }

    return this._viewerCameraM;
  }

  get targetTop() {
    if ( typeof this._targetTop === "undefined" ) {
      const pts = Point3d.fromToken(this.target);
      this._targetTop = pts.top;
      this._targetBottom = pts.bottom;
    }

    return this._targetTop;
  }

  get targetBottom() {
    if ( typeof this._targetTop === "undefined" ) {
      const pts = Point3d.fromToken(this.target);
      this._targetTop = pts.top;
      this._targetBottom = pts.bottom;
    }

    return this._targetBottom;
  }

  get targetCenter() {
    return this._targetCenter || (this._targetCenter = Point3d.fromTokenCenter(this.target));
  }

  /** @type {PIXI.Polygon} */
  get visionPolygon() {
    return this._visionPolygon || (this._visionPolygon = Area3d.visionPolygon(this.viewerPoint, this.target));
  }

  // NOTE ----- PRIMARY METHODS ----- //

  /**
   * Calculate the view matrix for the given token and target.
   * Also sets the view matrix for the target, walls, tiles, and other tokens as applicable.
   */
  calculateViewMatrix() {
    this._calculateViewerCameraMatrix();

    // Set the matrix to look at the target from the viewer.
    const { visibleTargetPoints, targetPoints, gridPoints, viewerPoint, viewerViewM } = this;
    targetPoints.setViewingPoint(viewerPoint);
    targetPoints.setViewMatrix(viewerViewM);
    visibleTargetPoints.setViewingPoint(viewerPoint);
    visibleTargetPoints.setViewMatrix(viewerViewM);
    if ( gridPoints ) {
      gridPoints.setViewingPoint(viewerPoint);
      gridPoints.setViewMatrix(viewerViewM);
    }

    // Set the matrix to look at blocking point objects from the viewer.
    const blockingPoints = this.blockingPoints;
    blockingPoints.drawings.forEach(pts => pts.setViewMatrix(viewerViewM));
    blockingPoints.tiles.forEach(pts => pts.setViewMatrix(viewerViewM));
    blockingPoints.tokens.forEach(pts => pts.setViewMatrix(viewerViewM));
    blockingPoints.walls.forEach(pts => pts.setViewMatrix(viewerViewM));
    blockingPoints.terrainWalls.forEach(pts => pts.setViewMatrix(viewerViewM));

    // Set the matrix for drawing other debug objects
    if ( this.debug ) {
      const blockingObjectsPoints = this.blockingObjectsPoints;
      blockingObjectsPoints.drawings.forEach(pts => pts.setViewMatrix(viewerViewM));
      blockingObjectsPoints.tiles.forEach(pts => pts.setViewMatrix(viewerViewM));
      blockingObjectsPoints.tokens.forEach(pts => pts.setViewMatrix(viewerViewM));
      blockingObjectsPoints.walls.forEach(pts => pts.setViewMatrix(viewerViewM));
      blockingObjectsPoints.terrainWalls.forEach(pts => pts.setViewMatrix(viewerViewM));
    }

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
        scalingFactor: Area3d.SCALING_FACTOR
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
   */
  _calculateViewerCameraMatrix() {
    const cameraPosition = this.viewerPoint;
    const targetPosition = this.targetCenter;
    return Matrix.lookAt(cameraPosition, targetPosition, this.constructor.#upVector);
  }

  /**
   * Find objects that are within the vision triangle between viewer and target.
   * Sets this._blockingObjects for drawings, tiles, tokens, walls, and terrainWalls.
   * Sets _blockingObjectsAreSet and resets _blockingPointsAreSet and _viewIsSet.
   */
  _findBlockingObjects() {
    const {
      type,
      wallsBlock,
      liveTokensBlock,
      deadTokensBlock,
      tilesBlock,
      visionSource } = this.config;

    // Clear any prior objects from the respective sets
    const { terrainWalls, walls } = this._blockingObjects;
    terrainWalls.clear();
    walls.clear();

    const filterConfig = {
      type,
      filterWalls: wallsBlock,
      filterTokens: liveTokensBlock || deadTokensBlock,
      filterTiles: tilesBlock,
      debug: this.debug,
      viewer: visionSource.object
    };
    const objsFound = this.constructor.filterSceneObjectsByVisionPolygon(this.viewerPoint, this.target, filterConfig);

    this._blockingObjects.drawings = objsFound.drawings;
    this._blockingObjects.tokens = objsFound.tokens;
    this._blockingObjects.tiles = objsFound.tiles;

    // Separate the terrain walls.
    objsFound.walls.forEach(w => {
      const s = w.document[type] === CONST.WALL_SENSE_TYPES.LIMITED ? terrainWalls : walls;
      s.add(w);
    });

    // Add walls for limited angle sight, if necessary.
    const limitedAngleWalls = this._constructLimitedAngleWallPoints3d();
    if ( limitedAngleWalls ) {
      walls.add(limitedAngleWalls[0]);
      walls.add(limitedAngleWalls[1]);
    }

    this.#blockingObjectsAreSet = true;
    this.#blockingObjectsPointsAreSet = false;
    this.#blockingPointsAreSet = false;
    this.#viewIsSet = false;
  }

  /**
   * Convert blocking objects into PlanePoints.
   * These will eventually be used by _obscureSides to project 2d perspective objects
   * that may block the target sides.
   */
  _constructBlockingObjectsPoints() {
    const blockingObjs = this.blockingObjects;

    // Clear any prior objects from the respective sets
    const { drawings, terrainWalls, tiles, tokens, walls } = this._blockingObjectsPoints;
    drawings.clear();
    terrainWalls.clear();
    tiles.clear();
    tokens.clear();
    walls.clear();

    // Add Tiles
    blockingObjs.tiles.forEach(t => tiles.add(new TilePoints3d(t, { viewerElevationZ: this.viewerPoint.z })));

    // Add Drawings
    if ( blockingObjs.tiles.size
      && blockingObjs.drawings.size ) blockingObjs.drawings.forEach(d => drawings.add(new DrawingPoints3d(d)));

    // Add Tokens
    const tokenPoints = buildTokenPoints(blockingObjs.tokens, this.config);
    tokenPoints.forEach(pts => tokens.add(pts));

    // Add Walls
    blockingObjs.walls.forEach(w => {
      // Sometimes w can be WallPoints3d. See issue #48.
      if ( w instanceof WallPoints3d ) walls.add(w);
      else walls.add(new WallPoints3d(w));
    });

    // Add Terrain Walls
    blockingObjs.terrainWalls.forEach(w => terrainWalls.add(new WallPoints3d(w)));

    this.#blockingObjectsPointsAreSet = true;
    this.#blockingPointsAreSet = false;
    this.#viewIsSet = false;
  }

  /**
   * Construct the PlanePoints3d array.
   * Split various PlanePoints3d objects as needed for the given perspective.
   */
  _constructBlockingPointsArray() {
    const blockingObjectsPoints = this.blockingObjectsPoints;
    const { drawings, terrainWalls, tiles, tokens, walls } = this._blockingPoints;
    const { visionPolygon, target } = this;
    const edges = [...visionPolygon.iterateEdges()];
    const blockingPoints = this._blockingPoints;
    const viewerLoc = this.viewerPoint;

    if ( this.config.debug ) {
      const draw = new Draw(Settings.DEBUG_LOS);
      draw.shape(visionPolygon, { fill: Draw.COLORS.lightblue, fillAlpha: 0.2 });
    }

    // Clear the existing arrays.
    tiles.length = 0;
    drawings.length = 0;
    tokens.length = 0;
    walls.length = 0;
    terrainWalls.length = 0;

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

    this.#blockingPointsAreSet = true;
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

  /**
   * Test whether a wall should be included as potentially blocking from point of view of
   * token.
   * Comparable to ClockwiseSweep.prototype._testWallInclusion
   */
  _testWallInclusion(wall, bounds) {
    // First test for inclusion in our overall bounding box
    if ( !bounds.lineSegmentIntersects(wall.A, wall.B, { inside: true }) ) return false;

    // Ignore walls that do not block sight
    if ( !wall.document.sight || wall.isOpen ) return false;

    // Ignore walls that are in line with the viewer and target
    if ( !foundry.utils.orient2dFast(this.viewerPoint, wall.A, wall.B)
      && !foundry.utils.orient2dFast(this.targetCenter, wall.A, wall.B) ) return false;

    // Ignore one-directional walls facing away from the origin
    const side = wall.orientPoint(this.viewerPoint);
    return !wall.document.dir || (side !== wall.document.dir);
  }

  /**
   * Construct walls based on limited angle rays
   * Start 1 pixel behind the origin
   * @returns {null|WallPoints3d[2]}
   */
  _constructLimitedAngleWallPoints3d() {
    const angle = this.config.visionSource.data.angle;
    if ( angle === 360 ) return null;

    const { x, y, rotation } = this.config.visionSource.data;
    const aMin = Math.normalizeRadians(Math.toRadians(rotation + 90 - (angle / 2)));
    const aMax = aMin + Math.toRadians(angle);

    // 0 faces south; 270 faces east
    const aMed = (aMax + aMin) * 0.5;
    const rMed = Ray.fromAngle(x, y, aMed, -1);
    const rMin = Ray.fromAngle(rMed.B.x, rMed.B.y, aMin, canvas.dimensions.maxR);
    const rMax = Ray.fromAngle(rMed.B.x, rMed.B.y, aMax, canvas.dimensions.maxR);

    // Use the ray as the wall
    rMin.topZ = canvas.dimensions.maxR;
    rMin.bottomZ = -canvas.dimensions.maxR;
    rMax.topZ = canvas.dimensions.maxR;
    rMax.bottomZ = -canvas.dimensions.maxR;
    return [new WallPoints3d(rMin), new WallPoints3d(rMax)];
  }

  /**
   * For debugging.
   * Draw the line of sight from token to target.
   */
  _drawLineOfSight() {
    const draw = new Draw(Settings.DEBUG_LOS);
    draw.segment({A: this.viewerPoint, B: this.targetCenter});
  }
}

/** For backwards compatibility */
export const Area3d = Area3dLOS;

