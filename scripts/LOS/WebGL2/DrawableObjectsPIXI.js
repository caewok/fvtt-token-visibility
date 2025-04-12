/* globals
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { Camera } from "../WebGPU/Camera.js";
import { combineTypedArrays } from "../util.js";
import { GeometryDesc } from "../WebGPU/GeometryDesc.js";
import { GeometryWallDesc } from "../WebGPU/GeometryWall.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc } from "../WebGPU/GeometryToken.js";
import { GeometryHorizontalPlaneDesc } from "../WebGPU/GeometryTile.js";
import {
  // WallInstanceHandler,
  DirectionalWallInstanceHandler,
  NonDirectionalWallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
} from "../WebGPU/PlaceableInstanceHandler.js";


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
 * Load code from a GLSL file.
 * @param {string} fileName       Name of the GLSL file, found at scripts/glsl/
 * @param {object} params         Parameters used to interpolate the loaded code string
 * @returns {string}
 */
async function sourceFromGLSLFile(filename, params) {
  const code = await fetchGLSLCode(filename);
  return interpolate(code, params);
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


class DrawableObjectsPIXI {
  /** @type {string} */
  static vertexShaderFile = "";

  /** @type {string} */
  static fragmentShaderFile = "";

  /** @type {Camera} */
  camera;

  /** @type {Map<*, object} */
  drawables = new Map();

  constructor(camera, { senseType = "sight" } = {}) {
    this.camera = camera;
    this.senseType = senseType;
  }

  /** @type {boolean} */
  #debugViewNormals = false;

  get debugViewNormals() { return this.#debugViewNormals; }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize({ debugViewNormals = false } = {}) {
    this.#debugViewNormals = debugViewNormals;
    this.shaderSources = await this._getShaderSources();

    // Create static buffers.
    this._createStaticGeometries();
    this._createStaticDrawables();
    this._setStaticGeometriesBuffers();

    // Initialize the changeable buffers.
    this.initializePlaceableBuffers();

    // Construct the mesh used for rendering.
    this.createMesh();
  }

  async _getShaderSources() {
    const debugViewNormals = this.debugViewNormals ? 1 : 0;
    const vertexSource = await sourceFromGLSLFile(this.constructor.vertexShaderFile, { debugViewNormals });
    const fragmentSource = await sourceFromGLSLFile(this.constructor.fragmentShaderFile, { debugViewNormals });
    return { vertexSource, fragmentSource };
  }

  _createShader(vertexSource, fragmentSource, uniforms = {}) {
    uniforms.uPerspectiveMatrix = this.camera.perspectiveMatrix;
    uniforms.uLookAtMatrix = this.camera.lookAtMatrix;
    uniforms.uColor ??= [0, 0, 1, 1];
    const program = PIXI.Program.from(vertexSource, fragmentSource)
    return new PIXI.Shader(program, uniforms);
  }

 /**
  * Define the shader used to render these objects.
  */
  _defineShader(uniforms) {
    const { vertexSource, fragmentSource } = this.shaderSources;
    return this._createShader(vertexSource, fragmentSource, uniforms);
  }

 /**
   * Set up part of the render chain dependent on the number of placeables.
   * Called whenever a placeable is added or deleted (but not necessarily just updated).
   * E.g., wall is added.
   * @override
   */
  initializePlaceableBuffers() {}

  /**
   * Define static geometries for the shapes handled in this class.
   * @override
   */
  _createStaticGeometries() {}

  /**
   * Insert drawables that rarely change into the drawables map.
   * @override
   */
  _createStaticDrawables() {}

  /**
   * Define vertex and index buffers for the static geometries.
   */
  _setStaticGeometriesBuffers() {
    if ( !this.geometries.size ) return;
    for ( const drawable of this.drawables.values() ) {
      drawable.staticGeometry = new PIXI.Geometry();
      drawable.staticGeometry.addAttribute("aPos", drawable.geom.vertices, 3, false, PIXI.TYPES.FLOAT, 0, 0, false);
      drawable.staticGeometry.addIndex(drawable.geom.indices);
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
   * Create a mesh for each drawable.
   */
  createMesh() {
    for ( const drawable of this.drawables.values() ) {
      drawable.mesh = this.constructor.buildMesh(drawable.geometry, drawable.shader);
    }
  }

  initializeRender() {
    for ( const drawable of this.drawables.values() ) {
      if ( !drawable.render ) continue;
      drawable.shader.uniformGroup.update();
      // drawable.shader.uniforms.uPerspectiveMatrix =
    }
  }



  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender(_opts) {
    // Update the types.

    // Update geometry?

  }

  render(container) {
    for ( const drawable of this.drawables.values() ) {
      if ( !drawable.render ) continue;
      container.addChild(drawable.mesh);
    }
  }

  _postRender(_opts) {}

  destroy() {
    for ( const drawable of this.drawables.values() ) {
      if ( drawable.staticGeometry ) drawable.staticGeometry.destroy();
      if ( drawable.shader ) drawable.shader.destroy();
      if ( drawable.mesh ) drawable.mesh.destroy();
    }
  }

}

class DrawableInstancesPIXI extends DrawableObjectsPIXI {

  /**
   * Set up part of the render chain dependent on the number of placeables.
   * Called whenever a placeable is added or deleted (but not necessarily just updated).
   * E.g., wall is added.
   */
  initializePlaceableBuffers() {
    // super.initializePlaceableBuffers()
    this._createInstanceBuffer();
  }

  /**
   * Define instance attributes and related buffers.
   */
  _createInstanceBuffer() {
    if ( !this.geometries.size ) return;
    for ( const drawable of this.drawables.values() ) {
      if ( drawable.instanceGeometry ) drawable.instanceGeometry.destroy();
      drawable.placeableHandler.initializePlaceables();
      // drawable.instanceGeometry = new PIXI.Geometry();
      // drawable.instanceGeometry.addAttribute("aiModel", drawable.placeableHandler.instanceArrayValues, 16, false, PIXI.TYPES.FLOAT, 0, 0, true);

      // Define the mesh for each drawable, used for rendering.
      // drawable.geometry = PIXI.Geometry.merge([drawable.staticGeometry, drawable.instanceGeometry]);
      drawable.geometry = new PIXI.Geometry();
      for ( const [key, attr] of Object.entries(drawable.staticGeometry.attributes) ) {
        drawable.geometry.addAttribute(key, drawable.staticGeometry.getBuffer(key), attr.size, attr.normalized, attr.type, attr.stride, attr.start, attr.instance);
      }
      drawable.geometry.addIndex(drawable.staticGeometry.indexBuffer);
      drawable.geometry.addAttribute("aiModel", drawable.placeableHandler.instanceArrayValues, 4, false, PIXI.TYPES.FLOAT, 4 * 4, 0, true);
      drawable.geometry.instanced = true;
      drawable.geometry.instanceCount = drawable.placeableHandler.numInstances;
    }
  }

  /**
   * Set up parts of the render chain that change often but not necessarily every render.
   * Called whenever a placeable is added, deleted, or updated.
   * E.g., tokens that move a lot vs a camera view that changes every render.
   */
  prerender(_opts) {
    // Update the types.

    // Update geometry?

    for ( const drawable of this.drawables.values() ) {
      drawable.render = Boolean(drawable.placeableHandler.numInstances);
    }
  }

  destroy() {
    super.destroy();
    for ( const drawable of this.drawables.values() ) {
      if ( drawable.instanceGeometry ) drawable.instanceGeometry.destroy();
    }
  }


}

export class DrawableWallInstancesPIXI extends DrawableInstancesPIXI {
  /** @type {string} */
  static vertexShaderFile = "wall_vertex";

  /** @type {string} */
  static fragmentShaderFile = "wall_fragment";

  /** @type {Map<INSTANCE_TYPES, GeometryWallDesc>} */
  geometries = new Map();

  /**
   * Define static geometries for the shapes handled in this class.
   */
  _createStaticGeometries() {
    const { NON_DIRECTIONAL, DIRECTIONAL } = this.constructor.INSTANCE_TYPES;
    this.geometries.set(NON_DIRECTIONAL, new GeometryWallDesc({ directional: false, addNormals: this.debugViewNormals, addUVs: false }));
    this.geometries.set(DIRECTIONAL, new GeometryWallDesc({ directional: true, addNormals: this.debugViewNormals, addUVs: false }));
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
    const normalShader = this._defineShader({ uColor: [0, 0, 1, 1] });
    const terrainShader = this._defineShader({ uColor: [0, 0, 0.5, 0.5] });
    const senseType = this.senseType;
    const ndirHandler = new NonDirectionalWallInstanceHandler({ senseType });
    const dirHandler = new DirectionalWallInstanceHandler({ senseType });
    ndirHandler.initializePlaceables();
    dirHandler.initializePlaceables();

    this.drawables.set(NON_DIRECTIONAL | NORMAL, {
      label: "Non-directional wall",
      geom: this.geometries.get(NON_DIRECTIONAL),
      placeableHandler: ndirHandler,
      shader: normalShader,
      render: true,
    });
    this.drawables.set(DIRECTIONAL | NORMAL, {
      label: "Directional wall",
      geom: this.geometries.get(DIRECTIONAL),
      placeableHandler: dirHandler,
      shader: normalShader,
      render: true,
    });
    this.drawables.set(NON_DIRECTIONAL | TERRAIN, {
      label: "Non-directional terrain wall",
      geom: this.geometries.get(NON_DIRECTIONAL),
      placeableHandler: ndirHandler,
      shader: terrainShader,
      render: true,
    });
    this.drawables.set(DIRECTIONAL | TERRAIN, {
      label: "Directional terrain wall",
      geom: this.geometries.get(DIRECTIONAL),
      placeableHandler: dirHandler,
      shader: terrainShader,
      render: true,
    });
  }
}

