/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstaclesWebGL2 } from "./RenderObstaclesWebGL2.js";

// Base folder
import { MODULE_ID } from "../../const.js";

// LOS folder
import { AbstractViewpoint } from "../AbstractViewpoint.js";
import { PercentVisibleRenderCalculatorAbstract } from "../PercentVisibleCalculator.js";
import { DebugVisibilityViewerWithPopoutAbstract } from "../DebugVisibilityViewer.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class WebGL2Viewpoint extends AbstractViewpoint {
  // TODO: Handle config and filtering obstacles.

  constructor(...args) {
    super(...args);
    this.calc = CONFIG[MODULE_ID].sightCalculators.webGL2;
  }

  _percentVisible() {
    // TODO: Handle configuration options.
    const viewer =  this.viewerLOS.viewer;
    const target = this.viewerLOS.target;
    const viewerLocation = this.viewpoint;
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
    return this.calc.percentVisible(viewer, target, { viewerLocation, targetLocation });
  }
}

export class PercentVisibleCalculatorWebGL2 extends PercentVisibleRenderCalculatorAbstract {
  /** @type {Uint8Array} */
  bufferData;

  /** @type {OffscreenCanvas} */
  static glCanvas;

  /** @type {WebGL2Context} */
  gl;

  constructor(opts) {
    super(opts);
    const { WIDTH, HEIGHT } = this.constructor;
    this.constructor.glCanvas ??= new OffscreenCanvas(WIDTH, HEIGHT);
    const gl = this.gl = this.constructor.glCanvas.getContext("webgl2");
    this.renderObstacles = new RenderObstaclesWebGL2({ gl, senseType: this.senseType });
    this.bufferData = new Uint8Array(gl.canvas.width * gl.canvas.height * 4);
  }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    super._calculatePercentVisible(viewer, target, viewerLocation, targetLocation)
  }

  _percentRedPixels() {
    const gl = this.gl;
    this.gl.readPixels(0, 0, gl.canvas.width, gl.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, this.bufferData);
    const pixels = this.bufferData;
    const terrainThreshold = this.constructor.TERRAIN_THRESHOLD;
    let countRed = 0;
    let countRedBlocked = 0;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const hasR = Boolean(r === 255);

      countRed += hasR;
      countRedBlocked += hasR * (Boolean(b === 255) || Boolean(g > terrainThreshold))
    }
    return (countRed - countRedBlocked) / countRed;
  }
}

export class DebugVisibilityViewerWebGL2 extends DebugVisibilityViewerWithPopoutAbstract {
  static CONTEXT_TYPE = "webgl2";

  /** @type {boolean} */
  debugView = true;

  constructor(opts = {}) {
    super(opts);
    this.debugView = opts.debugView ?? true;
    this.calc = new PercentVisibleCalculatorWebGL2({ senseType: this.senseType });
  }

  async initialize() {
    await super.initialize();
    await this.calc.initialize();
  }

  async openPopout() {
    await super.openPopout();
    if ( this.renderer ) this.renderer.destroy();
    this.renderer = new RenderObstaclesWebGL2({
      senseType: this.senseType,
      debugViewNormals: this.debugView,
      gl: this.gl,
    });
    await this.renderer.initialize();
  }

  _render(viewer, target, viewerLocation, targetLocation) {
    this.renderer.prerender();
    this.renderer.render(viewerLocation, target, { viewer, targetLocation });
  }

  percentVisible(viewer, target, viewerLocation, targetLocation) {
    return this.calc.percentVisible(viewer, target, { viewerLocation, targetLocation });
  }

  destroy() {
    if ( this.calc ) this.calc.destroy();
    if ( this.renderer ) this.renderer.destroy();
    super.destroy();
  }
}
