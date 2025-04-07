/* globals
CONST,
foundry,
Hooks,
Wall,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { combineTypedArrays } from "../util.js";
import { GeometryDesc } from "../WebGPU/GeometryDesc.js";
import { GeometryWallDesc } from "../WebGPU/GeometryWall.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc } from "../WebGPU/GeometryToken.js";
import { GeometryHorizontalPlaneDesc } from "../WebGPU/GeometryTile.js";
import { WebGL2 } from "./WebGL2.js";
import {
  NonDirectionalWallInstanceHandlerWebGL2,
  DirectionalWallInstanceHandlerWebGL2,
  TileInstanceHandlerWebGL2,
  TokenInstanceHandlerWebGL2,
} from "../WebGPU/PlaceableInstanceHandler.js";


class DrawableObjectsWebGL2Abstract {
  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "sight";

  /** @type {class} */
  static handlerClass;

  /** @type {string} */
  static vertexFile = "";

  /** @type {string} */
  static fragmentFile = "";

  /** @type {PlaceableInstanceHandler} */
  placeableHandler;

  /** @type WebGL2 */
  webGL2;

  constructor(gl, camera, { senseType = "sight" } = {}) {
    this.webGL2 = new WebGL2(gl);
    this.camera = camera;
    this.senseType = senseType;
  }

  #debugViewNormals = false;

  get debugViewNormals() { return this.#debugViewNormals; }

  /**
   * Set up all parts of the render pipeline that will not change often.
   */
  async initialize({ debugViewNormals = false } = {}) {
    this.#debugViewNormals = debugViewNormals;
    const placeableHandler = this.placeableHandler = new this.constructor.handlerClass({
      senseType: this.senseType,
      addNormals: debugViewNormals
    });
    placeableHandler.initializePlaceables()

    // TODO: Split placeableHandler and program creation from buffer creation so buffers can be updated when placeables change.
    const webGL2 = this.webGL2;
    await webGL2.createProgramFromFiles(this.vertexFile, this.fragmentFile, { debugViewNormals });

    const stride = placeableHandler.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3);
    const type = webGL2.gl.FLOAT;
    webGL2.addAttribute("aPos", { size: 3, type, stride, offset: 0 });
    if ( debugViewNormals ) {
      const offset = 3 * placeableHandler.verticesArray.BYTES_PER_ELEMENT;
      webGL2.addAttribute("aNorm", { size: 3, type, stride, offset })
    }
    webGL2.addVertexBuffer(this.placeableHandler.verticesArray);
    webGL2.addIndexBuffer(this.placeableHandler.indicesArray);
    webGL2.createVAOAndSetAttributes()

    const offsetData = this.offsetData = {
      index: {
        offsets: new Array(placeableHandler.numInstances),
        lengths: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.indices.length),
        sizes: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.indices.byteLength),
      }
    }
    offsetData.index.sizes.forEach((ln, i) => offsetData.index.offsets[i] = ln * i);
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
  render(viewerLocation, targetLocation, target, visionTriangle) {
    const webGL2 = this.webGL2;
    webGL2.useProgram();
    webGL2.bindVAO();

    this.setCamera(viewerLocation, targetLocation, target);
    webGL2.setUniform("uColor", "vec4", this.color);

    // TODO: Use visionTriangle
    // TODO: Swap between canvas and renderTexture.
    webGL2.bindFramebufferAndSetViewport(null);

    const instanceSet = new Set(this.placeableHandler.instanceIndexFromId.values());
    webGL2.drawSet(instanceSet, this.offsetData);
    webGL2.unbindVAO();
  }

  /** @type {Array(4)} */
  color = [0, 0, 1, 1];

  setCamera(viewerLocation, targetLocation, target) {
    const { camera, webGL2 } = this;
    webGL2.setUniform("uPerspectiveMatrix", "mat4", camera.perspectiveMatrix.arr);
    webGL2.setUniform("uLookAtMatrix", "mat4", camera.lookAtMatrix.arr);
  }
}

export class DrawableNonDirectionalWallWebGL2 extends DrawableObjectsWebGL2Abstract {
  /** @type {class} */
  static handlerClass = NonDirectionalWallInstanceHandlerWebGL2;

  /** @type {string} */
  static vertexFile = "";

  /** @type {string} */
  static fragmentFile = "";
}