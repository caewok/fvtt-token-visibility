/* globals
canvas,
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

import { Area3dLOSGeometric } from "./Area3dLOSGeometric.js";
import { AREA3D_POPOUTS } from "./Area3dPopout.js"; // Debugging pop-up


// PlaceablePoints folder
// import { PixelCache } from "./PixelCache.js";
import { AlphaCutoffFilter } from "./AlphaCutoffFilter.js";

// Geometry folder
import { Draw } from "../geometry/Draw.js"; // For debugging

export class Area3dLOSWebGL extends Area3dLOSGeometric {

  // NOTE ----- USER-FACING METHODS -----

  // Pixel cache for measuring percentage visible using WebGL
  targetCache;

  obstacleCache;

  blockingContainer = new PIXI.Container();

  tileContainer = new PIXI.Container();

  targetGraphics = new PIXI.Graphics();

  blockingGraphics = new PIXI.Graphics();

  terrainGraphics = new PIXI.Graphics();

  renderTexture = PIXI.RenderTexture.create({
    resolution: 1,
    scaleMode: PIXI.SCALE_MODES.NEAREST,
    multisample: PIXI.MSAA_QUALITY.NONE,
    alphaMode: PIXI.NO_PREMULTIPLIED_ALPHA
  });

  #destroyed = false;

  destroy() {
    if ( this.#destroyed ) return;
    this.targetGraphics.destroy();
    this.blockingGraphics.destroy();
    this.terrainGraphics.destroy();
    this.tileContainer.destroy();
    this.blockingContainer.destroy();
    this.renderTexture.destroy();
    this.#destroyed = true;
  }

  /**
   * Determine percentage area by estimating the blocking shapes using PIXI.Graphics and WebGL.
   * Constructs a render texture to estimate the percentage.
   * @returns {number}
   */
  percentVisible() {
    // See https://stackoverflow.com/questions/54415773/calling-grand-parent-function-in-javascript
    const percentVisible = this._simpleVisibilityTest();
    if ( typeof percentVisible !== "undefined" ) return percentVisible;

    if ( !this.viewIsSet ) this.calculateViewMatrix();
    const TARGET_COLOR = Draw.COLORS.red;
    const OBSTACLE_COLOR = Draw.COLORS.blue;
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

    const blockingContainer = this.blockingContainer;
    const targetGraphics = this.targetGraphics;

    // Draw the target shape.
    targetGraphics.clear();
    drawOpts.drawTool = new Draw(targetGraphics);
    this.targetPoints.drawTransformed(drawOpts);

    // Draw walls and other tokens.
    if ( blockingPoints.walls.length || blockingPoints.tokens.length ) {
      const blockingGraphics = this.blockingGraphics;
      blockingGraphics.clear();
      blockingContainer.addChild(blockingGraphics);
      drawOpts.drawTool = new Draw(blockingGraphics);
      drawOpts.color = OBSTACLE_COLOR;
      drawOpts.fill = OBSTACLE_COLOR;

      // Draw wall obstacles, if any
      blockingPoints.walls.forEach(w => w.drawTransformed(drawOpts));

      // Draw token obstacles, if any
      blockingPoints.tokens.forEach(t => t.drawTransformed(drawOpts));
    }

    // Draw terrain walls.
    // Use a separate container with an AlphaCutoffFilter.
    // For an additive blend, can set each terrain to alpha 0.4. Any overlap will be over 0.5.
    if ( blockingPoints.terrainWalls.length ) {
      const terrainGraphics = this.terrainGraphics;
      terrainGraphics.clear();
      blockingContainer.addChild(terrainGraphics);
      drawOpts.drawTool = new Draw(terrainGraphics);
      drawOpts.color = OBSTACLE_COLOR;
      drawOpts.fill = OBSTACLE_COLOR;
      drawOpts.fillAlpha = 0.5;
      blockingPoints.terrainWalls.forEach(w => w.drawTransformed(drawOpts));
    }

    // Draw tiles.
    // Each requires its own container.
    const tileContainer = this.tileContainer;
    const tileFilter = new AlphaCutoffFilter(0.75);
    const Sprite2d = PIXI.projection.Sprite2d;

    // TODO: Does _blockingObjectsPoints work for tiles under a target token?
    for ( const tilePts of this.blockingObjectsPoints.tiles ) {
      blockingContainer.addChild(tileContainer);
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

    blockingContainer.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
    blockingContainer.blendMode = PIXI.BLEND_MODES.DST_OUT; // Works: removes the red.

    const renderTexture = this.renderTexture;
    renderTexture.resize(xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min, true);
    targetGraphics.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);

    const sumRedPixels = function(targetCache) {
      const pixels = targetCache.pixels;
      const nPixels = pixels.length;
      let sumTarget = 0;
      for ( let i = 0; i < nPixels; i += 4 ) sumTarget += Boolean(targetCache.pixels[i]);
      return sumTarget;
    };

    const sumRedObstaclesPixels = function(targetCache) {
      const pixels = targetCache.pixels;
      const nPixels = pixels.length;
      let sumTarget = 0;
      for ( let i = 0; i < nPixels; i += 4 ) {
        const px = pixels[i];
        if ( px < 128 ) continue;
        sumTarget += Boolean(targetCache.pixels[i]);
      }
      return sumTarget;
    };
    const obstacleSum = blockingPoints.terrainWalls.length ? sumRedObstaclesPixels : sumRedPixels;

    // Render only the target shape and calculate its rendered visible area.
    canvas.app.renderer.render(targetGraphics, { renderTexture, clear: true });
    const targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumTarget = sumRedPixels(targetCache);

    // Render all the obstacles and calculate the remaining area.
    canvas.app.renderer.render(blockingContainer, { renderTexture, clear: false });
    const obstacleCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumWithObstacles = obstacleSum(obstacleCache);

    // Clean up
    const tileChildren = this.tileContainer.removeChildren();
    const children = this.blockingContainer.removeChildren();
    tileChildren.forEach(c => c.destroy());

    /* Testing
    s = new PIXI.Sprite(renderTexture)
    canvas.stage.addChild(s)
    canvas.stage.removeChild(s)
    */

    return sumWithObstacles / sumTarget;
  }

  // ----- NOTE: Debugging methods ----- //
  get popout() { return AREA3D_POPOUTS.webGL; }

  /**
   * For debugging.
   * Draw debugging objects (typically, 3d view of the target) in a pop-up window.
   * Must be extended by subclasses. This version pops up a blank window.
   */
  _draw3dDebug() {
    super._draw3dDebug();
    this._drawWebGLDebug();
  }

  /**
   * For debugging.
   * Popout the debugging window if not already rendered.
   * Clear drawings in that canvas.
   * Clear other children.
   */
  async enableDebugPopout() {
    await super._enableDebugPopout();
    const children = this.popout.app.pixiApp.stage.removeChildren();
    children.forEach(c => c.destroy());
  }

  _drawWebGLDebug() {
    // TODO: Make removing and adding less stupid.
    const stage = AREA3D_POPOUTS.webGL.app.pixiApp.stage;

    // For now, remove sprite and add new one.
    const children = stage.removeChildren();
    children.forEach(c => c.destroy());

    // Add the new sprite
    const s = new PIXI.Sprite(this.renderTexture);
    stage.addChild(s);
  }
}
