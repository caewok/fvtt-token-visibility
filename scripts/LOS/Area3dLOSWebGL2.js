/* globals
canvas,
glMatrix,
PIXI
*/
"use strict";

import { Area3dLOS } from "./Area3dLOS.js";
import { AREA3D_POPOUTS } from "./Area3dPopout.js"; // Debugging pop-up
import { Draw } from "../geometry/Draw.js";

// webGL2
import { Placeable3dShader, Tile3dShader, Placeable3dDebugShader, Tile3dDebugShader } from "./Placeable3dShader.js";


// PlaceablePoints folder
// import { PixelCache } from "./PixelCache.js";


// Geometry folder
import { Point3d } from "../geometry/3d/Point3d.js";

const RADIANS_90 = Math.toRadians(90);
const RADIANS_1 = Math.toRadians(1);

export class Area3dLOSWebGL2 extends Area3dLOS {

  _tileShaders = new Map();

  _tileDebugShaders = new Map();

  constructor(viewer, target, config) {
    super(viewer, target, config);
    this.config.useDebugShaders ??= true;
  }

  _clearCache() {
    super._clearCache();
    this.#frustrum.initialized = false;
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
    if ( !this.#debugShaders ) this._initializeShaders();
    if ( this.config.useDebugShaders ) return this.#debugShaders;
    return this.#shaders;
  }

  _initializeShaders() {
    this.#shaders = {};
    this.#debugShaders = {};

    const shaders = [
      "target",
      "obstacle",
      "terrainWall"
    ];

    // const axes = [-1, 1, 1];  // Mirror along the y axis.
    for ( const shaderName of shaders ) {
      const shader = this.#shaders[shaderName] = Placeable3dShader.create(this.viewerPoint, this.targetCenter);
      const debugShader = this.#debugShaders[shaderName] = Placeable3dDebugShader.create(this.viewerPoint, this.targetCenter);
      // mat4.fromScaling(shader.uniforms.uOffsetMatrix, axes);
      // mat4.fromScaling(debugShader.uniforms.uOffsetMatrix, axes);
    }

    // Set color for each shader.
    this.#shaders.target.setColor(1, 0, 0, 1); // Red
    this.#shaders.obstacle.setColor(0, 0, 1, 1);  // Blue
    this.#shaders.terrainWall.setColor(0, 0, 1, 0.5); // Blue, half-alpha
  }

  _initializeDebugShaders() {

  }

  /**
   * Describes the viewing frustum used by the shaders to view the target.
   */
  #frustrum = {
    near: 0.1,
    far: 1000,
    fov: RADIANS_90,
    frame: new PIXI.Rectangle(),
    initialized: false
  };

  get frustrum() {
    if ( !this.#frustrum.initialized ) this.#constructFrustrum();
    return this.#frustrum;
  }


  /**
   * Calculate the relevant frustrum properties for this viewer and target.
   * We want the target token to be completely within the viewable frustrum but
   * take up as much as the frustrum frame as possible, while limiting the size of the frame.
   */
  #constructFrustrum() {
    const { viewerPoint, target, targetCenter } = this;
    const viewerAngle = Math.toRadians(this.viewer.vision?.data?.angle) || Math.PI * 2;

    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    const targetBounds = target.bounds;
    const targetViewablePts = targetBounds
      .viewablePoints(viewerPoint, { outermostOnly: false })
      .map(pt => new PIXI.Point(pt.x, pt.y));

    // Determine which point(s) are further away on the 2d plane.
    const viewablePointsSet = new Set(targetViewablePts.map(pt => pt.key));

    const tokenBoundaryPts = [
      new PIXI.Point(targetBounds.left, targetBounds.top),
      new PIXI.Point(targetBounds.right, targetBounds.top),
      new PIXI.Point(targetBounds.right, targetBounds.bottom),
      new PIXI.Point(targetBounds.left, targetBounds.bottom)
    ];
    const fullPointSet = new Set(tokenBoundaryPts.map(pt => pt.key));
    const fartherPoints2d = fullPointSet.difference(viewablePointsSet).map(key => PIXI.Point.invertKey(key));

    // Check the top and bottom distance to each.
    const fartherPoints3d = [];
    const { topZ, bottomZ } = target;
    for ( const pt2d of fartherPoints2d ) {
      fartherPoints3d.push(
        new Point3d(pt2d.x, pt2d.y, topZ),
        new Point3d(pt2d.x, pt2d.y, bottomZ)
      );
    }

    const dist = fartherPoints3d.reduce((acc, curr) => {
      const dist = Point3d.distanceBetween(viewerPoint, curr);
      return Math.max(acc, dist);
    }, 0);

    // Distance to the nearer point
    const nearestPt = targetViewablePts[1];
    const nearerPoints3d = [
      new Point3d(nearestPt.x, nearestPt.y, topZ),
      new Point3d(nearestPt.x, nearestPt.y, bottomZ)
    ];


    const nearDist = nearerPoints3d.reduce((acc, curr) => {
      const dist = Point3d.distanceBetween(viewerPoint, curr);
      return Math.min(acc, dist);
    }, Number.POSITIVE_INFINITY);


//     const { topZ, bottomZ } = target;
//
//     let angleRad = 0;
//     if ( targetBoundaryPts ) {
//       angleRad = PIXI.Point.angleBetween(targetBoundaryPts[0], viewerPoint, targetBoundaryPts.at(-1));
//
//       // Check the height angle using the closest point.
//       const closestPt = targetBoundaryPts[1];
//       const heightAngle = Point3d.angleBetween(
//         new Point3d(closestPt.x, closestPt.y, bottomZ),
//         viewerPoint,
//         new Point3d(closestPt.x, closestPt.y, topZ));
//       angleRad = Math.max(heightAngle, angleRad);
//     }
//
//     // Use the diagonals to check the height angle.
//     const
//
//
//     const angleDiag0 = Point3d.angleBetween(
//       new Point3d(targetBounds.left, targetBounds.top, topZ),
//       viewerPoint,
//       new Point3d(targetBounds.right, targetBounds.bottom, bottomZ),
//     );
//
//     const angleDiag1 = Point3d.angleBetween(
//       new Point3d(targetBounds.left, targetBounds.bottom, topZ),
//       viewerPoint,
//       new Point3d(targetBounds.right, targetBounds.top, bottomZ),
//     );
//
//
//
//
//     // Check the 3d angle from center.
//     const { top, bottom } = Point3d.fromToken(target);
//     const heightAngle = Point3d.angleBetween(top, viewerPoint, bottom);
//     angleRad = Math.max(angleRad, angleDiag0, a);
//     if ( viewerAngle < 360 ) angleRad = Math.min(Math.toRadians(viewerAngle), angleRad);
//     angleRad ??= RADIANS_90; // Don't let the angle be 0.
//
//     const fov = this.#frustrum.fov = angleRad + RADIANS_1;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    this.#frustrum.near = canvas.dimensions.size * 0.5;

    // Far distance is distance to the furthest point of the target.

    // const { w, h } = target;
    // const diagDist = Math.hypot(w, h) * 0.5;
    // const dist = Point3d.distanceBetween(viewerPoint, targetCenter) + diagDist;
    const far = this.#frustrum.far = dist; //Math.ceil(dist);

    // Determine the optimal fov given the distance.
    // https://docs.unity3d.com/Manual/FrustumSizeAtDistance.html
    // const targetBounds = target.bounds;
    // const targetLength = Math.max(target.w, target.h, topZ - bottomZ);

    const targetLength = Point3d.distanceBetween(
      new Point3d(targetBounds.left, targetBounds.top, target.topZ),
      new Point3d(targetBounds.right, targetBounds.bottom, target.bottomZ));
    let angleRad = 2 * Math.atan(targetLength * (0.5 / nearDist)); // Use nearDist instead of far to increase the angle.
    angleRad = Math.min(angleRad, viewerAngle);
    angleRad ??= RADIANS_90;
    const fov = this.#frustrum.fov = angleRad + RADIANS_1;

    // Build the frame
    const frustrumBase = Math.ceil(this.constructor.frustrumBase(fov, far));
    const frame = this.#frustrum.frame;
    frame.x = -frustrumBase;
    frame.y = -frustrumBase;
    frame.width = frustrumBase * 2;
    frame.height = frustrumBase * 2;
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
      // mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
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
      // mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
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
    alphaMode: PIXI.NO_PREMULTIPLIED_ALPHA
  });

  #destroyed = false;

  destroy() {
    if ( this.#destroyed ) return;

    // Destroy this first before handling the shaders.
    this._obstacleContainer.destroy(true);

    // Destroy all shaders and render texture
    // Unclear why, but the `forEach` approach is not working (never returns)
    Object.values(this.#shaders).forEach(s => s.destroy());
    Object.values(this.#debugShaders).forEach(s => s.destroy());
    this._tileShaders.forEach(s => s.destroy());
    this._tileDebugShaders.forEach(s => s.destroy());
    this._tileShaders.clear();
    this._tileDebugShaders.clear();
    this._renderTexture.destroy();

    // Note that everything is destroyed to avoid errors if called again.
    this.#destroyed = true;
  }

  percentVisible() {
    const percentVisible = this._simpleVisibilityTest();
    if ( typeof percentVisible !== "undefined" ) return percentVisible;

    performance.mark("startWebGL2");

    const renderTexture = this._renderTexture;
    const shaders = this.shaders;

    // If no blocking objects, line-of-sight is assumed true.
    const blockingObjects = this.blockingObjects;

    // Build target mesh to measure the target viewable area.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    performance.mark("targetMesh");
    const targetMesh = this.#buildTargetMesh(shaders);

    // Build mesh of all obstacles in viewable triangle.
    performance.mark("obstacleMesh");
    const obstacleContainer = this._obstacleContainer;
    this.#buildObstacleContainer(obstacleContainer, shaders, this._buildTileShader.bind(this));

    // Resize the renderTexture to match the frustrum frame.
    const { width } = this.frustrum.frame; // Width and height are equal b/c we are using aspect = 1.
    renderTexture.resize(width, width, true);

    performance.mark("renderTargetMesh");
    canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });

    performance.mark("targetCache");
    const targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumTarget = this.#sumRedPixels(targetCache);

//     const targetCache = PixelCache.fromTexture(renderTexture,
//       { channel: 0, arrayClass: Uint8Array });
//     const sumTarget = targetCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);


    performance.mark("renderObstacleMesh");
    canvas.app.renderer.render(obstacleContainer, { renderTexture, clear: false });

    // Calculate area remaining.
    // TODO: Handle terrain walls.
    performance.mark("obstacleCache");
//     const obstacleCache = PixelCache.fromTexture(renderTexture,
//       { frame, channel: 0, arrayClass: Uint8Array });
//     const sumWithObstacles = obstacleCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);
    const obstacleSum = blockingObjects.terrainWalls.size ? this.#sumRedObstaclesPixels : this.#sumRedPixels;
    const obstacleCache = canvas.app.renderer.extract._rawPixels(renderTexture);
    const sumWithObstacles = obstacleSum(obstacleCache);

    performance.mark("endWebGL2");

    const children = obstacleContainer.removeChildren();
    children.forEach(c => c.destroy());

    return sumWithObstacles / sumTarget;
  }

  // ----- NOTE: Debugging methods ----- //
  get popout() { return AREA3D_POPOUTS.webGL2; }

  _draw3dDebug() {
    // For the moment, repeat webGL2 percent visible process so that shaders with
    // colors to differentiate sides can be used.
    // Avoids using a bunch of "if" statements in JS or in GLSL to accomplish this.
    const stage = AREA3D_POPOUTS.webGL2.app?.pixiApp?.stage;
    if ( !stage ) return;

    const children = stage.removeChildren();
    children.forEach(c => c.destroy());

    const shaders = this.debugShaders;

    const targetMesh = this.#buildTargetMesh(shaders);

    const c = new PIXI.Container();
    this.#buildObstacleContainer(c, shaders, this._buildTileDebugShader.bind(this));

    stage.addChild(targetMesh);
    stage.addChild(c);

    // Stage is centered at 0,0, so revert the positioning.
    targetMesh.position = new PIXI.Point();
    c.position = new PIXI.Point();

    // Temporarily draw the estimated frustrum frame.
    const g = new PIXI.Graphics();
    const draw = new Draw(g);
    stage.addChild(g);
    draw.shape(this.frustrum.frame);
  }

  #buildTargetMesh(shaders) {
    const targetShader = shaders.target;
    const { near, far, fov, frame } = this.frustrum;
    targetShader._initializeLookAtMatrix(this.viewerPoint, this.targetCenter);
    targetShader._initializePerspectiveMatrix(fov, 1, near, far);
    const targetMesh = this.constructor.buildMesh(this.target, targetShader);

    const width_1_2 = frame.width * 0.5; // Width and height are equal b/c we are using aspect = 1.
    targetMesh.position = new PIXI.Point(width_1_2, width_1_2);
    return targetMesh;
  }

  #buildObstacleContainer(container, shaders, tileMethod) {
    const { viewerPoint, targetCenter, frustrum, blockingObjects } = this;
    const buildMesh = this.constructor.buildMesh;
    const { near, far, fov, frame } = frustrum;

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

    const width_1_2 = frame.width * 0.5; // Width and height are equal b/c we are using aspect = 1.
    container.position = new PIXI.Point(width_1_2, width_1_2);
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
