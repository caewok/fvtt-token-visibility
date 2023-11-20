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
    this.#targetDistance3dProperties.initialized = false;
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
    const fov = this.#frustrum.fov = angleRad;// + RADIANS_1;

    // Far distance is distance to the furthest point of the target.
    this.#frustrum.far = farDistance;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    this.#frustrum.near = canvas.dimensions.size * 0.5;

    // Build the frame
    const frustrumBase = Math.ceil(this.constructor.frustrumBase(fov, farDistance));
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
    // const { width } = this.frustrum.frame; // Width and height are equal b/c we are using aspect = 1.
    const width = 200;
    renderTexture.resize(width, width, true);

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

    // Temporarily render the texture.
    if ( !this.renderSprite || this.renderSprite.destroyed ) {
      this.renderSprite ??= PIXI.Sprite.from(this._renderTexture);
      canvas.stage.addChild(this.renderSprite);
    }


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
