/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Camera } from "../WebGPU/Camera.js";
import { combineTypedArrays } from "../util.js";
import { NonDirectionalWallInstanceHandler, DirectionalWallInstanceHandler } = "../WebGPU/PlaceableInstanceHandler.js";
import { VisionTriangle } from "../VisionPolygon.js";

/*
PIXI: Only does basic instancing. No apparent way to filter which instances to use.
Could pull instances from a texture maybe.
But for now, just define the instance buffer at render to be only those needed to draw that viewpoint.

For WebGL2, cannot start at a specific instance index:
https://stackoverflow.com/questions/37469193/webgl-drawelementsinstancedangle-with-a-starting-offset-on-the-instanced-array
glDrawElementsInstancedBaseInstance only on GL 4:
https://registry.khronos.org/OpenGL-Refpages/gl4/html/glDrawElementsInstancedBaseInstance.xhtml
From stackoverflow: Could set an offset when binding the instance attribute(s)
See:
https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer
*/

/**
 * Misc functions to assist with WebGL2 rendering.
 */
export class WebGL2 {
  /**
   * Load code from a GLSL file.
   * @param {string} fileName       Name of the GLSL file, found at scripts/glsl/
   * @param {object} params         Parameters used to interpolate the loaded code string
   * @returns {string}
   */
  static async sourceFromGLSLFile(filename, params) {
    const code = await fetchGLSLCode(filename);
    return interpolate(code, params);
  }
}

/**
 * Fetch GLSL code as text.
 * @param {string} fileName     The file name without extension or directory path.
 * @returns {string}
 */
async function fetchGLSLCode(fileName) {
  const resp = await foundry.utils.fetchWithTimeout(`modules/${MODULE_ID}/scripts/LOS/WebGL2/glsl/${fileName}.glsl`);
  return resp.text();
}

/**
 * Limited string replacement so the imported glsl code can be treated as a template literal
 * (without using eval).
 * See https://stackoverflow.com/questions/29182244/convert-a-string-to-a-template-string
 * @param {string} str      String with ${} values to replace
 * @param {object} params   Valid objects that can be replaced; either variables or function names
 * @returns {string}
 */
function interpolate(str, params = {}) {
  // Replace the names with the relevant values.
  const names = Object.keys(params);
  const vals = Object.values(params);
  return new Function(...names, `return \`${str}\`;`)(...vals);
}

export class RenderObstaclesAbstractPIXI {
  /** @type {class} */
  static drawableClasses = [];

  /** @type {Camera} */
  camera = new Camera();

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize(opts) {
    this.drawableObjects.forEach(drawableObject => drawableObject.destroy());
    this.drawableObjects.length = 0;
    const device = await this.getDevice();
    this.materials = new MaterialsTracker(device);
    await this._initializeDrawObjects(opts);
    this._allocateRenderTargets();
    this.prerender();
  }

  /**
   * Define one ore more DrawObjects used to render the scene.
   */
  async _initializeDrawObjects(opts) {
    const device = this.device;
    const materials = this.materials;
    this._createCameraBindGroup();

    const senseType = this.senseType;
    const promises = [];
    for ( const cl of this.constructor.drawableClasses ) {
      const drawableObj = new cl(device, materials, camera, { senseType });
      this.drawableObjects.push(drawableObj);
      await drawableObj.initialize(opts);
      // promises.push(drawableObj.initialize());
    }
    return Promise.allSettled(promises);
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {
    for ( const drawableObj of this.drawableObjects ) drawableObj.prerender();
  }

  /**
   * Render the scene to a RenderTexture.
   */
  render(viewerLocation, target, opts) {
    const opts = { viewer, target, targetOnly };
    const device = this.device;
    this._setCamera(viewerLocation, target, { viewer, targetLocation });
    // const visionTriangle = targetOnly ? null : VisionTriangle.build(viewerLocation, target);



    return this.device.queue.onSubmittedWorkDone();
  }
}


export class DrawableWallInstancesPIXI {

  static vertexShaderFile = "wall_vertex";

  static fragmentShaderFile = "wall_fragment";

  /** @type {Camera} */
  camera;

  /** @type {TypedArray[]} */
  buffers = {};

  constructor(camera, { senseType = "sight" } = {}) {
    this.camera = camera;
    this.senseType = senseType;
    this.placeableHandler = new this.constructor.handlerClass(this.senseType);
  }

  /** @type {boolean} */
  #debugViewNormals = false;

  get debugViewNormals() { return this.#debugViewNormals; }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize({ debugViewNormals = false } = {}) {
    this.#debugViewNormals = debugViewNormals;


    // Define shader and geometry.
    const { vertexSource, fragmentSource } = await this._getShaderSources();
    this._createShader(vertexSource, fragmentSource);



    this.module = await WebGPUShader.fromGLSLFile(device, this.constructor.shaderFile, `${this.constructor.name} Shader`, { debugViewNormals });
    this._setRenderPipelineOpts();
    this.pipeline = device.createRenderPipeline(this.RENDER_PIPELINE_OPTS);

    // Create static buffers.
    this._createStaticGeometries();
    this._createStaticDrawables();
    this._setStaticGeometriesBuffers();

    // Initialize the changeable buffers.
    this.initializePlaceableBuffers();
  }

  async _getShaderSources() {
    const vertexSrc = await WebGL2.sourceFromGLSLFile(this.vertexShaderFile);
    const fragmentSrc = await WebGL2.sourceFromGLSLFile(this.fragmentShaderFile);
    return { vertexSrc, fragmentSrc };
  }

  _createShader(vertexSource, fragmentSource) {
    const uniforms = {
      uPerspectiveMatrix: this.camera.perspectiveMatrix,
      uLookAtMatrix: this.camera.lookAtMatrix,
    };
    this.shader = new PIXI.Shader(vertexSource, fragmentSource, uniforms);
  }

  /**
   * Set up part of the render chain dependent on the number of placeables.
   * Called whenever a placeable is added or deleted (but not necessarily just updated).
   * E.g., wall is added.
   */
  initializePlaceableBuffers() {
    const senseType = this.senseType;
    // super.initializePlaceableBuffers()
    this._createInstanceBuffer();
  }

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {
    this.geometries.set("wall", new GeometryWallDesc({ directional: false, addNormals: this.debugViewNormals, addUVs: false }));
    this.geometries.set("wall-dir", new GeometryWallDesc({ directional: true, addNormals: this.debugViewNormals, addUVs: false }));
  }

  /** @type {enum} */
  static INSTANCE_TYPES = {
    NON_DIRECTIONAL: 1,
    DIRECTIONAL: 2,
    NORMAL: 4,
    TERRAIN: 8,
    // ND | NORMAL = 5
    // DIR | NORMAL = 6
    // ND | TERRAIN = 9
    // DIR | TERRAIN = 10
  }

  /**
   * Insert drawables that rarely change into the drawables map.
   */
  _createStaticDrawables() {
    const { NON_DIRECTIONAL, DIRECTIONAL, NORMAL, TERRAIN } = this.constructor.INSTANCE_TYPES;
    this.drawables.set(NON_DIRECTIONAL, {
      label: "Non-directional wall",
      geom: this.geometries.get("wall"),
      instanceSet: new Set(),
      placeableHandler: new NonDirectionalWallInstanceHandler({ senseType }),
    });
    this.drawables.set(DIRECTIONAL, {
      label: "Directional wall",
      geom: this.geometries.get("wall-dir"),
      instanceSet: new Set(),
      placeableHandler: new DirectionalWallInstanceHandler({ senseType }),
    });

  /**
   * Define vertex and index buffers for the static geometries.
   */
  _setStaticGeometriesBuffers() {
    if ( !this.geometries.size ) return;
    for ( const drawable of this.drawables ) {
      drawable.geometry = new PIXI.Geometry();
      drawable.geometry.addAttribute("aPos", drawable.geom.vertexBuffer, 3, false, PIXI.TYPES.FLOAT, 0, 0, false);
      drawable.geometry.addIndex(drawable.geom.indexBuffer);
    }
  }

  /**
   * Define instance attributes and related buffers.
   */
  _createInstanceBuffer() {
    if ( !this.geometries.size ) return;
    for ( const drawable of this.drawables ) {
      drawable.placeableHandler.initializePlaceables();
      drawable.geometry.addAttribute("aiModel", drawable.placeableHandler.instanceArrayBuffer, 16, false, PIXI.TYPES.FLOAT, 0, 0, true);

      // Track whether it is terrain or wall setting
      // (In WebGPU, this would be the material buffer; here pass the type.)
      drawable.typeBuffer = new Uint32Array(drawable.placeableHandler.numInstances);
      drawable.geometry.addAttribute("aiType", drawable.typeBuffer, 1, false, PIXI.TYPES.UNSIGNED_INT, 0, 0, true);

      // Define the mesh for each drawable, used for rendering.
      drawable.mesh = this.constructor.buildMesh(drawable.geometry, this.shader);
    }
  }

  static buildMesh(geometry, shader) {
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.state.depthTest = true;
    mesh.state.culling = true;
    mesh.state.clockwiseFrontFace = false;
    mesh.state.depthMask = true;
    return mesh;
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender() {}

  /**
   * Render this drawable.
   */
  render() {
    this.drawables.forEach(drawable => this._renderDrawable(drawable));
  }



}