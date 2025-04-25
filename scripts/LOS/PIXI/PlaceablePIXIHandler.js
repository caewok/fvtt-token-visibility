/* globals
canvas,
CONFIG,
CONST,
Hooks,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


import { MODULE_ID } from "../../const.js";
import { GeometryWallDesc } from "../WebGPU/GeometryWall.js";
import { GeometryCubeDesc, GeometryHexColumnDesc, GeometryHexRowDesc, GeometryConstrainedTokenDesc } from "../WebGPU/GeometryToken.js";
import { GeometryHorizontalPlaneDesc } from "../WebGPU/GeometryTile.js";
import { AbstractShader } from "../AbstractShader.js";
import { WallInstanceHandler, TileInstanceHandler, TokenInstanceHandler } from "../WebGPU/PlaceableInstanceHandler.js";

/* PIXI area 3d new version (2025-04)

Create instance geometry for wall, token (cube), token (hex unit 1 / 0.5), tile.

Create shader for normal obstacles and tile
Use placeableInstanceHandler to track matrix to convert the models.

Create separate geometry for constrained or other hex tokens

Store mesh for each placeable.

Draw each separately, following approach of Area3dWebGL2Viewpoint
*/


export class WallPIXIHandler {
  /** @type {string} */
  static ID = "atvPIXIHandler";

  /** @type {GeometryDesc} */
  static directionalGeom;

  /** @type {GeometryDesc} */
  static nonDirectionalGeom;

  static directionalPIXIGeom;

  static nonDirectionalPIXIGeom;

  static shader;

  static directionalMesh;

  static nonDirectionalMesh;

  wall;

  instanceHandler;

  constructor(wall) {
    this.wall = wall;
    const obj = wall["tokenvisibility"] ??= {};
    obj[this.constructor.ID] = this;
    this.constructor.initializeGeometry();
    this.constructor.initializeShader();
    this.constructor.initializeMesh();
    this.instanceHandler = new WallInstanceHandler();
  }

  static initializeGeometry() {
    this.directionalGeom ??= new GeometryWallDesc({ directional: true });
    this.nonDirectionalGeom ??= new GeometryWallDesc({ directional: false });
    if ( !this.directionalPIXIGeom || this.directionalPIXIGeom.destroyed ) {
      this.directionalPIXIGeom = new PIXI.Geometry();
      this.directionalPIXIGeom.addAttribute("aVertex", this.directionalGeom.vertices);
      this.directionalPIXIGeom.addIndex(this.directionalGeom.indices);
    }
    if ( !this.nonDirectionalPIXIGeom || this.nonDirectionalPIXIGeom.destroyed ) {
      this.nonDirectionalPIXIGeom = new PIXI.Geometry();
      this.nonDirectionalPIXIGeom.addAttribute("aVertex", this.nonDirectionalGeom.vertices);
      this.nonDirectionalPIXIGeom.addIndex(this.nonDirectionalGeom.indices);
    }
  }

  static initializeShader() {
    this.shader ??= Placeable3dShader.create();
  }

  static initializeMesh() {
    this.directionalMesh ??= new PIXI.Mesh(this.directionalPIXIGeom, this.shader);
    this.nonDirectionalMesh ??= new PIXI.Mesh(this.nonDirectionalPIXIGeom, this.shader);
  }

  get geometry() {
    return this.wall.edge.direction
      ? this.constructor.directionalPIXIGeom
      : this.constructor.nonDirectionalPIXIGeom;
  }

  get shader() {
    return this.constructor.shader;
  }

  get mesh() {
    return this.wall.edge.direction
      ? this.constructor.directionalMesh
      : this.constructor.nonDirectionalMesh;
  }

  lookAtPerspective(perspectiveM, lookAtM) {
    // TODO: Can we store the model matrix by linking the uniform to the instance matrix?
    // If so, can then just call uniform.update as needed.
    const h = this.instanceHandler;
    this.shader.uniforms.uModelMatrix = h.matrices[h.instanceIndexFromId(this.wall.id)];
    this.shader.uniforms.perspectiveM = perspectiveM;
    this.shader.uniforms.lookAtM = lookAtM;
    this.shader.uniformGroup.update();
  }

  destroy() {}

  static destroy() {
    if ( this.directionalMesh && !this.directionalMesh.destroyed ) this.directionalMesh.destroy();
    if ( this.nonDirectionalMesh && !this.nonDirectionalMesh.destroyed ) this.nonDirectionalMesh.destroy();
    if ( this.directionalPIXIGeom && !this.directionalPIXIGeom.destroyed ) this.directionalPIXIGeom.destroy();
    if ( this.nonDirectionalPIXIGeom && !this.nonDirectionalPIXIGeom.destroyed ) this.nonDirectionalPIXIGeom.destroy();
    if ( this.shader && !this.shader.destroyed ) this.shader.destroy();
  }

  /* ----- Hooks ----- */

  /** @type {number[]} */
  static _hooks = [];

  /**
   * @typedef {object} PlaceableHookData
   * Description of a hook to use.
   * @prop {object} name: methodName        Name of the hook and method; e.g. updateWall: "_onPlaceableUpdate"
   */
  /** @type {object[]} */
  static HOOKS = [
    { createWall: "_onPlaceableCreation" }
  ];

  /**
   * Register hooks for this placeable that record updates.
   */
  static registerPlaceableHooks() {
    if ( this._hooks.length ) return; // Only register once.
    for ( const hookDatum of this.HOOKS ) {
      const [name, methodName] = Object.entries(hookDatum)[0];
      const id = Hooks.on(name, this[methodName].bind(this));
      this._hooks.push({ name, methodName, id });
    }
  }

  static deregisterPlaceableHooks() {
    this._hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.length = 0;
  }

  static _onPlaceableCreation(document, _options, _userId) {
    new this(document);
  }

  static _onPlaceableDestroy(object) { object[MODULE_ID][this.ID].destroy(); }
}

export class TilePIXIHandler {
  /** @type {string} */
  static ID = "atvPIXIHandler";

  /** @type {GeometryDesc} */
  static geom;

  static geomPIXI;

  static shader;

  static mesh;

  tile;

  instanceHandler;

  constructor(tile) {
    this.tile = tile;
    const obj = tile["tokenvisibility"] ??= {};
    obj[this.constructor.ID] = this;
    this.constructor.initializeGeometry();
    this.constructor.initializeShader();
    this.constructor.initializeMesh();
    this.instanceHandler = new TileInstanceHandler();
  }

  static initializeGeometry() {
    this.geom ??= new GeometryHorizontalPlaneDesc();
    if ( !this.geomPIXI || this.geomPIXI.destroyed ) {
      this.geomPIXI = new PIXI.Geometry();
      this.geomPIXI.addAttribute("aVertex", this.geom.vertices);
      this.geomPIXI.addIndex(this.geom.indices);
    }
  }

  static initializeShader() {
    this.shader ??= Tile3dShader.create();
  }

  static initializeMesh() {
    this.mesh ??= new PIXI.Mesh(this.geomPIXI, this.shader);
  }

  get geometry() { return this.constructor.geom; }

  get shader() { return this.constructor.shader; }

  get mesh() { return this.constructor.mesh; }

  lookAtPerspective(perspectiveM, lookAtM) {
    // TODO: Can we store the model matrix by linking the uniform to the instance matrix?
    // If so, can then just call uniform.update as needed.
    const h = this.instanceHandler;
    this.shader.uniforms.uModelMatrix = h.matrices[h.instanceIndexFromId(this.tile.id)];
    this.shader.uniforms.perspectiveM = perspectiveM;
    this.shader.uniforms.lookAtM = lookAtM;
    this.shader.uTileTexture = this.tile.texture.baseTexture;
    this.shader.uniformGroup.update();
  }

  destroy() {}

  static destroy() {
    if ( this.mesh && !this.mesh.destroyed ) this.mesh.destroy();
    if ( this.geom && !this.geom.destroyed ) this.geom.destroy();
    if ( this.geomPIXI && !this.geomPIXI.destroyed ) this.geomPIXI.destroy();
    if ( this.shader && !this.shader.destroyed ) this.shader.destroy();
  }

  /* ----- Hooks ----- */

  /** @type {number[]} */
  static _hooks = [];

  /**
   * @typedef {object} PlaceableHookData
   * Description of a hook to use.
   * @prop {object} name: methodName        Name of the hook and method; e.g. updateWall: "_onPlaceableUpdate"
   */
  /** @type {object[]} */
  static HOOKS = [
    { createWall: "_onPlaceableCreation" }
  ];

  /**
   * Register hooks for this placeable that record updates.
   */
  static registerPlaceableHooks() {
    if ( this._hooks.length ) return; // Only register once.
    for ( const hookDatum of this.HOOKS ) {
      const [name, methodName] = Object.entries(hookDatum)[0];
      const id = Hooks.on(name, this[methodName].bind(this));
      this._hooks.push({ name, methodName, id });
    }
  }

  static deregisterPlaceableHooks() {
    this._hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.length = 0;
  }

  static _onPlaceableCreation(document, _options, _userId) {
    new this(document);
  }

  static _onPlaceableDestroy(object) { object[MODULE_ID][this.ID].destroy(); }
}

export class TokenPIXIHandler {
  /** @type {string} */
  static ID = "atvPIXIHandler";

  /** @type {GeometryDesc} */
  static geom;

  static geomPIXI;

  static shader;

  static mesh;

  geomConstrained;

  geomConstrainedPIXI;

  meshConstrained;

  token;

  instanceHandler;

  constructor(token) {
    this.token = token;
    const obj = token["tokenvisibility"] ??= {};
    obj[this.constructor.ID] = this;
    this.constructor.initializeGeometry();
    this.constructor.initializeShader();
    this.constructor.initializeMesh();
    this.instanceHandler = new TokenInstanceHandler();
  }

  static initializeGeometry() {
    if ( canvas.grid.isHexagonal ) {
      const cl = (canvas.grid.type === CONST.GRID_TYPES.HEXEVENQ
        || canvas.grid.type === CONST.GRID_TYPES.HEXODDQ)
          ? GeometryHexColumnDesc : GeometryHexRowDesc;
      this.geom ??= new cl();
    } else this.geom ??= new GeometryCubeDesc

    if ( !this.geomPIXI || this.geomPIXI.destroyed ) {
      this.geomPIXI = new PIXI.Geometry();
      this.geomPIXI.addAttribute("aVertex", this.geom.vertices);
      this.geomPIXI.addIndex(this.geom.indices);
    }
  }

  static initializeShader() {
    this.shader ??= Placeable3dShader.create();
  }

  static initializeMesh() {
    this.mesh ??= new PIXI.Mesh(this.geomPIXI, this.shader);
  }

  initializeConstrainedGeometry() {
    this.geomConstrained = new GeometryConstrainedTokenDesc({ token: this.token });
    if ( this.geomConstrainedPIXI && !this.geomConstrainedPIXI.destroyed ) this.geomConstrainedPIXI = this.geomConstrainedPIXI.destroy();
    this.geomConstrainedPIXI = new PIXI.Geometry();
    this.geomConstrainedPIXI.addAttribute("aVertex", this.geomConstrained.vertices);
    this.geomConstrainedPIXI.addIndex(this.geomConstrained.indices);
  }

  initializeConstrainedMesh() {
    this.meshConstrained = new PIXI.Mesh(this.geomConstrained, this.constructor.shader);
  }

  get geometry() {
    return this.useConstrainedGeometry ? this.geomConstrainedPIXI : this.constructor.geomPIXI;
  }

  get shader() { return this.constructor.shader; }

  get mesh() {
    return this.useConstrainedGeometry ? this.meshConstrained : this.constructor.mesh;
  }

  get useConstrainedGeometry() {
    return this.token.isConstrainedTokenBorder || (canvas.grid.isHexagonal
        && (this.token.document.width !== this.token.document.height
         || this.token.document.width > 1));
  }

  lookAtPerspective(perspectiveM, lookAtM, isTarget = false) {
    // TODO: Can we store the model matrix by linking the uniform to the instance matrix?
    // If so, can then just call uniform.update as needed.
    const h = this.instanceHandler;
    this.shader.uniforms.uModelMatrix = h.matrices[h.instanceIndexFromId(this.token.id)];
    this.shader.uniforms.perspectiveM = perspectiveM;
    this.shader.uniforms.lookAtM = lookAtM;
    if ( isTarget ) {
      this.shader.uniforms.uColor[0] = 1;
      this.shader.uniforms.uColor[2] = 0;
    } else {
      this.shader.uniforms.uColor[0] = 0;
      this.shader.uniforms.uColor[2] = 1;
    }
    this.shader.uniformGroup.update();
  }

  destroy() {
    if ( this.meshConstrained && !this.meshConstrained.destroyed ) this.meshConstrained.destroy();
    if ( this.geomConstrainedPIXI && !this.geomConstrainedPIXI.destroyed ) this.geomConstrainedPIXI.destroy();
  }

  static destroy() {
    if ( this.mesh && !this.mesh.destroyed ) this.mesh.destroy();
    if ( this.geom && !this.geom.destroyed ) this.geom.destroy();
    if ( this.geomPIXI && !this.geomPIXI.destroyed ) this.geomPIXI.destroy();
    if ( this.shader && !this.shader.destroyed ) this.shader.destroy();
  }

  /* ----- Hooks ----- */

  /** @type {number[]} */
  static _hooks = [];

  /**
   * @typedef {object} PlaceableHookData
   * Description of a hook to use.
   * @prop {object} name: methodName        Name of the hook and method; e.g. updateWall: "_onPlaceableUpdate"
   */
  /** @type {object[]} */
  static HOOKS = [
    { createWall: "_onPlaceableCreation" }
  ];

  /**
   * Register hooks for this placeable that record updates.
   */
  static registerPlaceableHooks() {
    if ( this._hooks.length ) return; // Only register once.
    for ( const hookDatum of this.HOOKS ) {
      const [name, methodName] = Object.entries(hookDatum)[0];
      const id = Hooks.on(name, this[methodName].bind(this));
      this._hooks.push({ name, methodName, id });
    }
  }

  static deregisterPlaceableHooks() {
    this._hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.length = 0;
  }

  static _onPlaceableCreation(document, _options, _userId) {
    new this(document);
  }

  static _onPlaceableDestroy(object) { object[MODULE_ID][this.ID].destroy(); }
}

class Placeable3dShader extends AbstractShader {

  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
uniform mat4 uModelMatrix;
uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

void main() {
  vec4 cameraPosition = uLookAtMatrix * uModelMatrix * vec4(aVertex, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;

out vec4 fragColor;
uniform vec4 uColor;

void main() {
  fragColor = uColor;
}`;

  static defaultUniforms = {
    uModelMatrix: new Float32Array(16),
    uPerspectiveMatrix: new Float32Array(16),
    uLookAtMatrix: new Float32Array(16),
    uColor: [0, 0, 1, 1]
  };
}

class Tile3dShader extends Placeable3dShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

uniform mat4 uModelMatrix;
uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;
uniform mat4 uOffsetMatrix;

void main() {
  vTextureCoord = aTextureCoord;
  vec4 cameraPosition = uLookAtMatrix * uModelMatrix * vec4(aVertex, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vTextureCoord;
out vec4 fragColor;
uniform float uAlphaThreshold;
uniform vec4 uColor;
uniform sampler2D uTileTexture;

void main() {
  vec4 texPixel = texture(uTileTexture, vTextureCoord);
  fragColor = texPixel.a > uAlphaThreshold ? uColor : vec4(0.0);
}`;

  static defaultUniforms = {
    uPerspectiveMatrix: new Float32Array(16),
    uLookAtMatrix: new Float32Array(16),
    uColor: [0, 0, 1, 1],
    uAlphaThreshold: 0.75,
    uTileTexture: -1
  };

  static create(viewerPt, targetPt, defaultUniforms = {}) {
    defaultUniforms.uAlphaThreshold ??= CONFIG[MODULE_ID].alphaThreshold;
    return super.create(viewerPt, targetPt, defaultUniforms);
  }
}


