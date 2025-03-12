/* globals
canvas,
CONFIG,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder

// PlaceablePoints folder

// LOS folder
import { Area3dGeometricViewpoint } from "./Area3dGeometricViewpoint.js";
import { VisionPolygon } from "./VisionPolygon.js";
import { AlphaCutoffFilter } from "./AlphaCutoffFilter.js";
import { sumRedPixels, sumRedObstaclesPixels } from "./util.js";

// Debug
import { Draw } from "../geometry/Draw.js";

export class Area3dWebGL1Viewpoint extends Area3dGeometricViewpoint {

 // Pixel cache for measuring percentage visible using WebGL
  targetCache;

  obstacleCache;

  blockingContainer = new PIXI.Container();

  tileContainer = new PIXI.Container();

  targetGraphics = new PIXI.Graphics();

  blockingGraphics = new PIXI.Graphics();

  terrainGraphics = new PIXI.Graphics();

  gridGraphics = new PIXI.Graphics();

  renderTexture = PIXI.RenderTexture.create({
    resolution: 1,
    scaleMode: PIXI.SCALE_MODES.NEAREST,
    multisample: PIXI.MSAA_QUALITY.NONE,
    alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA
  });

  #destroyed = false;

  destroy() {
    super.destroy();
    if ( this.#destroyed ) return;
    this.targetGraphics.destroy();
    this.blockingGraphics.destroy();
    this.terrainGraphics.destroy();
    this.gridGraphics.destroy();
    this.tileContainer.destroy();
    this.blockingContainer.destroy();
    this.renderTexture.destroy();
    if ( this.#debugSprite && !this.#debugSprite.destroyed ) this.#debugSprite.destroy();
    this.#destroyed = true;
  }

  /**
   * For WebGL, it currently uses the full token border, not the constrained target border,
   * to construct the shape.
   * To ensure all blocking walls are captured, must use the same border for the vision
   * polygon.
   */
  get visionPolygon() {
    return VisionPolygon.build(this.viewpoint, this.viewerLOS.target, this.viewerLOS.target.bounds);
  }

  #renderer;

  get renderer() {
    return this.#renderer || (this.#renderer = canvas.app.renderer);
  }

  set renderer(value) {
    if ( !(value instanceof PIXI.Renderer) ) {
      console.error("Renderer must be PIXI.Renderer.");
      return;
    }
    this.#renderer = value;
  }

  /**
   * Determine percentage area by estimating the blocking shapes using PIXI.Graphics and WebGL.
   * Constructs a render texture to estimate the percentage.
   * @returns {number}
   */
  _percentVisible() {
    const lookAtM = this.targetLookAtMatrix;
    const TARGET_COLOR = Draw.COLORS.red;
    const OBSTACLE_COLOR = Draw.COLORS.blue;
    const blockingObjs = this.blockingObjects;
    const renderer = this.renderer;

    // Set width = 0 to avoid drawing a border line. The border line will use antialiasing
    // and that causes a lighter-color border to appear outside the shape.
    const drawOpts = {
      color: TARGET_COLOR,
      width: 0,
      fill: TARGET_COLOR,
      fillAlpha: 1
    };

    const blockingContainer = this.blockingContainer;
    const targetGraphics = this.targetGraphics;

    // Center everything.
    const renderTexture = this.renderTexture;
    renderTexture.resize(100, 100, true);
    targetGraphics.position = new PIXI.Point(50, 50);
    blockingContainer.position = new PIXI.Point(50, 50);

    // Draw the target shape.
    targetGraphics.clear();
    const draw = new Draw(targetGraphics);
    const targetPolys = this._calculateTargetPerspectivePolygons(lookAtM);
    targetPolys.forEach(poly => draw.shape(poly, drawOpts));


    // If large target, measure the viewable area of a unit grid shape.
    let sumGridCube = 100_000;
    if ( this.viewerLOS.config.largeTarget ) {
      // Construct the grid shape at this perspective.
      const ctr = this.viewerLOS.target.center;
      const grid3dShape = this.constructor.grid3dShape;
      const translateM = CONFIG.GeometryLib.MatrixFlat.translation(ctr.x, ctr.y, this.viewerLOS.target.bottomZ);
      grid3dShape.forEach(shape => shape.update(translateM));
      const gridPolys = [...grid3dShape[0].triangles, ...grid3dShape[1].triangles, ...grid3dShape[2].triangles]
        .filter(tri => tri.isFacing(this.viewpoint))
        .map(tri => tri.transform(lookAtM))
        .map(tri => tri.perspectiveTransform(100 / this.multiplier))
        .map(tri => tri.toPolygon());

      // Draw the grid shape to a PIXI.Graphics container.
      const gridGraphics = this.gridGraphics;
      gridGraphics.clear();
      this.gridGraphics.position = new PIXI.Point(50, 50);
      const draw = new Draw(gridGraphics);
      gridPolys.forEach(poly => draw.shape(poly, drawOpts))

      // Render the grid shape drawing and calculate the rendered area.
      renderer.render(gridGraphics, { renderTexture, clear: true });
      const gridCubeCache = canvas.app.renderer.extract._rawPixels(renderTexture);
      sumGridCube = sumRedPixels(gridCubeCache) || 100_000;
    }

    // Draw walls and other tokens.
    if ( blockingObjs.walls.size || blockingObjs.tokens.size ) {
      // Set up the graphics objects.
      const blockingGraphics = this.blockingGraphics;
      blockingGraphics.clear();
      blockingContainer.addChild(blockingGraphics);
      const draw = new Draw(blockingGraphics);
      drawOpts.color = OBSTACLE_COLOR;
      drawOpts.fill = OBSTACLE_COLOR;

      // Draw the blocking shapes.
      const blockingPolys = this._calculateBlockingPerspectivePolygons(
        [...blockingObjs.walls, ...blockingObjs.tokens], lookAtM);
      blockingPolys.forEach(poly => draw.shape(poly, drawOpts));
    }

    // Draw terrain walls.
    // Use a separate container with an AlphaCutoffFilter.
    // For an additive blend, can set each terrain to alpha 0.4. Any overlap will be over 0.5.
    if ( blockingObjs.terrainWalls.size ) {
      // Set up graphics object.
      const terrainGraphics = this.terrainGraphics;
      terrainGraphics.clear();
      blockingContainer.addChild(terrainGraphics);
      drawOpts.drawTool = new Draw(terrainGraphics);
      drawOpts.color = OBSTACLE_COLOR;
      drawOpts.fill = OBSTACLE_COLOR;
      drawOpts.fillAlpha = 0.5;

      // Draw the blocking shapes.
      const blockingTerrainPolys = this._calculateBlockingPerspectivePolygons(blockingObjs.terrainWalls, lookAtM);
      blockingTerrainPolys.forEach(poly => draw.shape(poly, drawOpts));
    }

    // Draw tiles.
    // Each requires its own container.
    const tileContainer = this.tileContainer;
    const tileFilter = new AlphaCutoffFilter(0.75);
    const Sprite2d = PIXI.projection.Sprite2d;

    // TODO: Does _blockingObjectsPoints work for tiles under a target token?
    for ( const tile of blockingObjs.tiles ) {
      blockingContainer.addChild(tileContainer);
      // TODO: Need to cutoff tiles at the z=0 point. And need to have the uv coordinates reflect this.
      // Any chance mapSprite will do this?
      const containerSprite = new Sprite2d(tile.texture);
      containerSprite.filters = [tileFilter];
      tileContainer.addChild(containerSprite);

      // Determine the polygon transform.
      // TODO: Fix to use the tile rectangle.
      const polys = this._calculateBlockingPerspectivePolygon(tile, lookAtM);
      const perspectivePoints = [];
      for ( const poly of polys ) {
        const pts = poly.points;
        for ( let i = 0, n = pts.length; i < n; i += 2 ) {
          perspectivePoints.push(new PIXI.Point(pts[i], pts[i + 1]));
        }
      }
      containerSprite.proj.mapSprite(containerSprite, perspectivePoints);

      // Adjust the uvs points if the tile is cutoff behind the viewer.
      // TODO: Fix
      containerSprite.calculateVertices(); // Force uvs to be calculated.
      // const tileUVs = tilePts.uvs;
      // for ( let i = 0; i < 8; i += 1 ) containerSprite.uvs[i] = tileUVs[i];
    }

    // Set blend mode to remove red covered by the blue.
    blockingContainer.blendMode = PIXI.BLEND_MODES.DST_OUT;
    const obstacleSum = blockingObjs.terrainWalls.size ? sumRedObstaclesPixels : sumRedPixels;

    // Render only the target shape and calculate its rendered visible area.
    renderer.render(targetGraphics, { renderTexture, clear: true });
    const targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumTarget = sumRedPixels(targetCache);

    // Render all the obstacles and calculate the remaining area.
    renderer.render(blockingContainer, { renderTexture, clear: false });
    const obstacleCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumWithObstacles = obstacleSum(obstacleCache);

    // Clean up
    const tileChildren = this.tileContainer.removeChildren();
    this.blockingContainer.removeChildren();
    tileChildren.forEach(c => c.destroy());

    /* Testing
    s = new PIXI.Sprite(renderTexture)
    canvas.stage.addChild(s)
    canvas.stage.removeChild(s)
    */
    const denom = Math.min(sumGridCube, sumTarget);

    return sumWithObstacles / denom;
  }

  // ----- NOTE: Debugging methods ----- //

  /** @type {PIXI.Sprite} */
  #debugSprite;

  get debugSprite() {
    if ( !this.#debugSprite || this.#debugSprite.destroyed ) {
      const s = this.#debugSprite = PIXI.Sprite.from(this.renderTexture);
      s.anchor = new PIXI.Point(0.5, 0.5); // Centered on the debug window.
    }
    return this.#debugSprite;
  }

  openDebugPopout() {
    this.viewerLOS._addChildToPopout(this.debugSprite);
  }

  #debug = false;

  _draw3dDebug() {
    // Set the renderer and re-run
    this.renderer = this.popout.pixiApp.renderer;
    this.#debug = true;
    this.percentVisible();
    this.#debug = false;
    this.renderer = canvas.app.renderer;
  }
}