/* globals
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { WebGL2 } from "./WebGL2.js";
import { Camera } from "../Camera.js";
import { Frustum } from "../Frustum.js";
import { DrawableWallWebGL2 } from "./DrawableWall.js";
import {
  DrawableTileWebGL2,
  DrawableSceneBackgroundWebGL2,
} from "./DrawableTile.js";
import {
  DrawableTokenWebGL2,
  DrawableGridShape,
} from "./DrawableToken.js";
import { DrawableRegionWebGL2 } from "./DrawableRegion.js";
import { log, sameSide } from "../util.js";
import { Point3d } from "../../geometry/3d/Point3d.js";

export class RenderObstaclesWebGL2 {

  /** @type {WebGL2} */
  webGL2;

  /** @type {DrawObjectsAbstract[]} */
  drawableObjects = [];

  /** @type {DrawObjectsAbstract[]} */
  drawableObstacles = []

  /** @type {DrawableObjectsAbstract[]} */
  drawableNonTerrainWalls = [];

  /** @type {DrawableObjectsAbstract[]} */
  drawableTerrain = [];

  /** @type {DrawableTokenWebGL2} */
  drawableTokens;

  /** @type {DrawableObjectsAbstract} */
  drawableFloor;

  /** @type {DrawableObjectsAbstract} */
  drawableGridShape;

  /** @type {Frustum} */
  frustum = new Frustum();

  /** @type {Camera} */
  camera = new Camera({ glType: "webGL2", perspectiveType: "perspective" });

  /** @type {object} */
  #debugViewNormals = false;

  get debugViewNormals() { return this.#debugViewNormals; }

  /** @type {WebGL2RenderingContext} */
  get gl() { return this.webGL2.gl; };

  #senseType = "sight";

  get senseType() { return this.#senseType; }

  constructor({ webGL2, senseType = "sight", debugViewNormals = false, useSceneBackground = false } = {}) {
    this.#debugViewNormals = debugViewNormals;
    this.#senseType = senseType;
    this.webGL2 = webGL2;
    this._buildDrawableObjects(useSceneBackground);
  }

  _buildDrawableObjects(useSceneBackground = false) {
    this.drawableObjects.length = 0;
    this.drawableFloor = undefined;
    let obj;

    const drawableClasses = [
      DrawableTileWebGL2,
      DrawableGridShape,
      DrawableRegionWebGL2,
      DrawableTokenWebGL2,
    ];

    if ( useSceneBackground ) drawableClasses.push(DrawableSceneBackgroundWebGL2);

    for ( const cl of drawableClasses ) this.drawableObjects.push(new cl(this));

    // Walls: Need normal, directional, terrain, terrain directional
    // Normal
    obj = new DrawableWallWebGL2(this);
    obj.directional = false;
    obj.limitedWall = false;
    this.drawableObjects.push(obj);

    // Terrain
    obj = new DrawableWallWebGL2(this);
    obj.directional = false;
    obj.limitedWall = true;
    this.drawableObjects.push(obj);

    // Directional
    obj = new DrawableWallWebGL2(this);
    obj.directional = true;
    obj.limitedWall = false;
    this.drawableObjects.push(obj);

    // Terrain && Directional
    obj = new DrawableWallWebGL2(this);
    obj.directional = true;
    obj.limitedWall = true;
    this.drawableObjects.push(obj);

    // Regions (use senseType?)

    // Categorize each drawable object.
    for ( const drawableObj of this.drawableObjects) {
      switch ( drawableObj.constructor.name ) {
        // Lit tokens not used as obstacles; only targets.
        case "DrawableTokenWebGL2":
          this.drawableTokens = drawableObj;
          this.drawableObstacles.push(drawableObj);
          break;

        // Scene background not an obstacle; handled separately.
        case "DrawableSceneBackgroundWebGL2":
          this.drawableFloor = drawableObj;
          break;

        // Grid shape not an obstacle; handled separately.
        case "DrawableGridShape":
          this.drawableGridShape = drawableObj;
          break;

        // Terrain walls have special rendering considerations.
        case "DrawableWallWebGL2":{
          if ( drawableObj.terrain ) this.drawableTerrain.push(drawableObj);
          else {
            this.drawableNonTerrainWalls.push(drawableObj);
            this.drawableObstacles.push(drawableObj);
          }
          break;
        }

        default:
          this.drawableObstacles.push(drawableObj);
      }
    }
  }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize() {
    // const promises = [];
    // this.drawableObjects.forEach(drawableObj => promises.push(drawableObj.initialize()));
    // return Promise.allSettled(promises);
    this._initializeCameraBuffer();
    this._initializeMaterialBuffer();
    for ( const drawableObj of this.drawableObjects ) await drawableObj.initialize();
  }

  /** @type {ViewerLOSConfig} */
  _config = {
    blocking: {
      walls: true,
      tiles: true,
      tokens: {
        dead: true,
        live: true,
        prone: true,
      }
    },
    debug: false,
    testLighting: false,
  }

  get config() { return this._config; }

  set config(cfg = {}) {
    foundry.utils.mergeObject(this._config, cfg);
  }

  // ----- NOTE: Camera uniform buffer object ----- //

  static CAMERA_BIND_POINT = 0;

  /** @type {object<WebGLBuffer>} */
  buffer = {
    camera: null,
    material: null,
  };

  _initializeCameraBuffer() {
    const gl = this.gl;

    // Already have a shared buffer data from the camera object: camera.arrayBuffer.
    this.buffer.camera = gl.createBuffer();

    // Create and initialize it.
    // See https://learnopengl.com/Advanced-OpenGL/Advanced-GLSL
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.camera);
    gl.bufferData(gl.UNIFORM_BUFFER, this.camera.constructor.CAMERA_BUFFER_SIZE, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    // Bind the UBO to the binding point
    gl.bindBufferBase(gl.UNIFORM_BUFFER, this.constructor.CAMERA_BIND_POINT, this.buffer.camera);
  }


  /**
   * Set camera for a given render.
   */
  _setCamera(viewerLocation, target, { targetLocation } = {}) {
    targetLocation ??= Point3d.fromTokenCenter(target);
    const camera = this.camera;
    camera.cameraPosition = viewerLocation;
    camera.targetPosition = targetLocation;
    camera.setTargetTokenFrustum(target);
    log(`${this.constructor.name}|_setCamera|viewer at ${viewerLocation}; target ${target.name} at ${targetLocation}`);

    /*
    camera.perspectiveParameters = {
      fov: Math.toRadians(90),
      aspect: 1,
      zNear: 1,
      zFar: Infinity,
    };
    */

    /*
    camera.perspectiveParameters = {
      fov: camera.perspectiveParameters.fov * 2,
      zFar: Infinity, // camera.perspectiveParameters.zFar + 50
    };
    */
    camera.refresh();
    const gl = this.gl;
    const cameraData = this.camera.arrayView;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.camera);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cameraData);
    gl.bindBufferRange(gl.UNIFORM_BUFFER, this.constructor.CAMERA_BIND_POINT, this.buffer.camera, 0, cameraData.BYTES_PER_ELEMENT * cameraData.length);
  }

  // ----- NOTE: Material uniform buffer object ----- //

  static MATERIAL_BIND_POINT = 1;

  static MATERIAL_BUFFER = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 4 * 3);

  static MATERIAL_COLORS = {
    target: new Float32Array(this.MATERIAL_BUFFER, 0, 4),
    obstacle: new Float32Array(this.MATERIAL_BUFFER, Float32Array.BYTES_PER_ELEMENT * 4, 4),
    terrain: new Float32Array(this.MATERIAL_BUFFER, Float32Array.BYTES_PER_ELEMENT * 4 * 2, 4),
  }

  _initializeMaterialBuffer() {
    const gl = this.gl;

    // Buffer to hold every color variation.
    this.buffer.material = gl.createBuffer();

    // Create and initialize it.
    // See https://learnopengl.com/Advanced-OpenGL/Advanced-GLSL
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.material);
    gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array(this.constructor.MATERIAL_BUFFER), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    // Bind the UBO to the binding point
    gl.bindBufferBase(gl.UNIFORM_BUFFER, this.constructor.MATERIAL_BIND_POINT, this.buffer.material);
  }

  #currentMaterial = null;

  /**
   * Set material for a given render.
   * @param {string} type             Key from MATERIAL_COLORS
   */
  _setMaterial(type = "obstacle") {
    if ( this.#currentMaterial === type ) return;

    let offset = 0;
    switch ( type ) {
      case "target": offset = 0; break;
      case "obstacle": offset = Float32Array.BYTES_PER_ELEMENT * 4; break;
      case "terrain": offset = Float32Array.BYTES_PER_ELEMENT * 4 * 2; break;
      default: console.error("_setMaterial|Material type not recognized.");
    }
    // gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer.material);
    this.gl.bindBufferRange(this.gl.UNIFORM_BUFFER, this.constructor.MATERIAL_BIND_POINT, this.buffer.material, offset, Float32Array.BYTES_PER_ELEMENT * 4);
    this.#currentMaterial = type;
  }

  // ----- NOTE: Render ----- //

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {
    for ( const drawableObj of this.drawableObjects ) drawableObj.prerender();

    if ( this.config.testLighting ) this.drawableLitToken.prerender();
    // this.drawableConstrainedToken.prerender();
  }

  renderGridShape(viewerLocation, target, { targetLocation, frame } = {}) {
    this._setCamera(viewerLocation, target, { targetLocation });
    frame ??= new PIXI.Rectangle(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    const gl = this.gl;
    const webGL2 = this.webGL2;

    // Set WebGL2 state.
    webGL2.setViewport(frame);
    webGL2.setDepthTest(true);
    webGL2.setBlending(false);
    webGL2.setCulling(true);
    webGL2.setCullFace("BACK");
    webGL2.setStencilTest(false);
    webGL2.setColorMask(WebGL2.redAlphaMask);
    this._setMaterial("target");

    // Clear.
    webGL2.setClearColor(WebGL2.blackClearColor);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Draw.
    this.drawableGridShape.renderTarget(target);
    // this.gl.flush();
  }

  renderTarget(viewerLocation, target, { targetLocation, frame, testLighting = false, clear = true, useStencil = false } = {}) {
    this._setCamera(viewerLocation, target, { targetLocation });

    const gl = this.gl;
    const webGL2 = this.webGL2;
    const colorCoded = !this.debugViewNormals;
    frame ??= new PIXI.Rectangle(0, 0, this.gl.canvas.width, this.gl.canvas.height);

    // Set WebGL2 state.
    webGL2.setViewport(frame);
    webGL2.setDepthTest(true);
    webGL2.setBlending(false);
    webGL2.setCulling(true);
    webGL2.setCullFace("BACK");

    // Clear.
    webGL2.setClearColor(WebGL2.blackClearColor);
    if ( clear ) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // If colorCoded, will not be drawing the floor b/c debugViewNormals is false.
    if ( colorCoded ) webGL2.setColorMask(WebGL2.redAlphaMask); // Red, alpha channels for the target object.
    else webGL2.setColorMask(WebGL2.noColorMask);

    // Draw the scene floor to orient the viewer.
    if (this.debugViewNormals && this.drawableFloor ) {
      webGL2.setStencilTest(false);
      this.drawableFloor.render();
    }

    // Use the stencil buffer to identify target pixels.
    webGL2.setStencilTest(useStencil);
    if ( useStencil ) {
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.stencilFunc(gl.ALWAYS, 1, 0xFF); // All fragments should pass stencil test.
      gl.stencilMask(0xFF); // Enable writing to the stencil buffer.
    }

    this._setMaterial("target");
    this.drawableTokens.renderTarget(target, testLighting);
    // this.gl.flush();
  }

  renderObstacles(viewpoint, target, { viewer, targetLocation, frame, clear = false, useStencil = false } = {}) {
    // Filter the obstacles to only those within view.
    const opts = { viewer, target, blocking: this.config.blocking };
    const frustum = this.frustum.rebuild({ viewpoint, target });
    this.drawableObstacles.forEach(drawable => drawable.filterObjects(frustum, opts));
    this.drawableTerrain.forEach(drawable => drawable.filterObjects(frustum, opts));

    const hasObstacles = this.drawableObstacles.some(drawable => drawable.numObjectsToDraw);
    const hasTerrain = this.drawableTerrain.some(drawable => drawable.numObjectsToDraw);
    if ( !(hasObstacles || hasTerrain) ) return;

    this._setCamera(viewpoint, target, { targetLocation });

    const gl = this.gl;
    const webGL2 = this.webGL2;
    const colorCoded = !this.debugViewNormals;
    frame ??= new PIXI.Rectangle(0, 0, this.gl.canvas.width, this.gl.canvas.height);

    // Set WebGL2 state.
    webGL2.setViewport(frame);
    webGL2.setCulling(true);
    webGL2.setStencilTest(useStencil);
    webGL2.setCullFace("BACK");

    // Clear.
    webGL2.setClearColor(WebGL2.blackClearColor);
    if ( clear ) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // Performance: Use the stencil buffer to discard pixels outside the target shape.
    if ( useStencil && colorCoded ) {
      gl.stencilFunc(gl.EQUAL, 1, 0xFF); // Draw only where the target shape is present.
      gl.stencilMask(0x00); // Disable writing to the stencil buffer.
    }

    // Draw blue obstacles.
    if ( hasObstacles ) {
      this._setMaterial("obstacle");
      webGL2.setBlending(false);
      if ( colorCoded ) webGL2.setColorMask(WebGL2.blueAlphaMask);
      else webGL2.setColorMask(WebGL2.noColorMask); // Either red from target, blue

      // this._renderConstrainingWalls(this.drawableNonTerrainWalls, target, viewer, frustum, viewpoint);

      webGL2.setDepthTest(true);
      this.drawableObstacles.forEach(drawableObj => drawableObj.render(target, viewer, frustum));
    }

    // Draw green limited (terrain) walls.
    if ( hasTerrain ) {
      this._setMaterial("terrain");
      webGL2.setBlending(true);
      webGL2.setDepthTest(false);
      if ( colorCoded ) webGL2.setColorMask(WebGL2.greenAlphaMask);
      else webGL2.setColorMask(WebGL2.noColorMask); // Either red from target, blue

      const srcRGB = colorCoded ? gl.ONE : gl.SRC_ALPHA;
      const dstRGB = colorCoded ? gl.ONE : gl.SRC_ALPHA;
      const srcAlpha = colorCoded ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA;
      const dstAlpha = colorCoded ? gl.ZERO : gl.ONE_MINUS_SRC_ALPHA;
      gl.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);

      // this._renderConstrainingWalls(this.drawableTerrainWalls, target, viewer, frustum, viewerLocation);
      this.drawableTerrain.forEach(drawableObj => drawableObj.render(target, viewer, frustum));
    }
    // this.gl.flush();
  }

  // Draw walls that intersect the target border and are in front of the target border.
  // This is an alternative to drawing separate constrained tokens.
  _renderConstrainingWalls(drawables, target, viewer, frustum, viewerLocation) {
    for ( const drawable of drawables ) {
      // Draw only the intersecting walls that are in front of the center of the token from this camera view.
      const intersectingWalls = [];
      intersectingWalls.push(...constrainingWallsForDrawable(drawable, target, viewerLocation));
      if ( !intersectingWalls.length ) continue;

      this.webGL2.setDepthTest(false);

      // Temporarily override the instances and render the intersecting walls only.
      const intersectingIndexes = intersectingWalls
        .map(wall => drawable.trackers.model.facetIdMap.get(wall.sourceId))
        .filter(idx => drawable.instanceSet.has(idx)); // Just in case.
      const oldSet = new Set([...drawable.instanceSet]);
      drawable.instanceSet.clear();
      intersectingIndexes.forEach(idx => drawable.instanceSet.add(idx));
      drawable.render(target, viewer, frustum);

      // Keep only the non-intersecting instances.
      drawable.instanceSet = oldSet.difference(drawable.instanceSet);
    }
  }

  destroy() {}
}

// Set up the material colors
RenderObstaclesWebGL2.MATERIAL_COLORS.target.set([1, 0, 0, 1]);
RenderObstaclesWebGL2.MATERIAL_COLORS.obstacle.set([0, 0, 1, 1]);
RenderObstaclesWebGL2.MATERIAL_COLORS.terrain.set([0, 0.5, 0, 0.5]);

function constrainingWallsForDrawable(drawable, target, viewerLocation) {
  const intersectingWalls = [];
  for ( const idx of drawable.instanceSet ) {
    // Walls are all instanced.
    const id = drawable.trackers.model.facetIdMap.getKeyAtIndex(idx);
    const wall = drawable.placeableTracker.getPlaceableFromId(id);
    if ( !wall ) continue;
    const { a, b } = wall.edge;
    if ( !sameSide(a, b, target.center, viewerLocation)
      && target.tokenBorder.lineSegmentIntersects(a, b, { inside: true }) ) intersectingWalls.push(wall);
  }
  return intersectingWalls;
}
