/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstacles } from "./RenderObstacles.js";
import { WebGPUSumRedPixels } from "./SumPixels.js";
import { SumPixelsWebGL2 } from "./SumPixelsWebGL2.js";

export class PercentVisibleCalculator {
  /** @type {RenderObstacles} */
  renderObstacles;

  /** @type {WebGPUSumRedPixels} */
  // sumRedPixels;

  /** @type {SumPixelsWebGL2} */
  sumPixelsWebGL2;

  // TODO: Set debug flag and render to the debug viewer.
  // Just the obstacle view. For now, make same; no lighting effects etc.

  async initialize({ width = 128, height = 128, senseType = "sight" } = {}) {
    const device = await RenderObstacles.getDevice();
    this.renderObstacles = new RenderObstacles(device, { width, height, senseType });
    this.sumPixelsWebGL2 = new SumPixelsWebGL2({ width, height, device });
    this.renderObstacles.setRenderTextureToCanvas(this.sumPixelsWebGL2.gpuCanvas);
    // this.renderObstacles.setRenderTextureToInternalTexture()
    await this.renderObstacles.initialize();
    await this.renderObstacles.prerender();
    this.renderObstacles.registerPlaceableHooks();

    this.sumRedPixels = new WebGPUSumRedPixels(this.renderObstacles.device);
    await this.sumRedPixels.initialize();


  }

  async percentVisible(viewerLocation, target, { viewer, targetLocation } = {}) {
    this.renderObstacles.prerender();
    viewerLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer);
    const targetArea = await this.targetPixelArea(viewerLocation, target, { viewer, targetLocation });
    // console.debug(`${this.constructor.name}|${targetArea} target pixels`);
    const targetObscuredArea = await this.targetPixelAreaWithObstacles(viewerLocation, target, { viewer, targetLocation });
    // console.debug(`${this.constructor.name}|${targetObscuredArea} obscured target pixels: ${targetObscuredArea / targetArea * 100}% visible`);
    return targetObscuredArea / targetArea;
  }

  async targetPixelArea(viewerLocation, target, { viewer, targetLocation } = {}) {
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation, targetOnly: true });
    return this.sumRedPixels.compute(this.renderObstacles.renderTexture);
  }

  async targetPixelAreaWithObstacles(viewerLocation, target, { viewer, targetLocation } = {}) {
    await this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
    return this.sumRedPixels.compute(this.renderObstacles.renderTexture);
  }

  percentVisibleSync(viewerLocation, target, { viewer, targetLocation } = {}) {
    this.renderObstacles.prerender();
    viewerLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer);
    const targetArea = this.targetPixelAreaSync(viewerLocation, target, { viewer, targetLocation });
    // console.debug(`${this.constructor.name}|${targetArea} target pixels`);
    const targetObscuredArea = this.targetPixelAreaWithObstaclesSync(viewerLocation, target, { viewer, targetLocation });
    // console.debug(`${this.constructor.name}|${targetObscuredArea} obscured target pixels: ${targetObscuredArea / targetArea * 100}% visible`);
    return targetObscuredArea / targetArea;
  }

  targetPixelAreaSync(viewerLocation, target, { viewer, targetLocation } = {}) {
    this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation, targetOnly: true });
    // return this.sumRedPixels.computeSync(this.renderObstacles.renderTexture);

    const imgData = this.sumPixelsWebGL2.pixelDataFromRender();
    return this.sumPixelsWebGL2.sumRedPixels(imgData.pixels);
  }

  targetPixelAreaWithObstaclesSync(viewerLocation, target, { viewer, targetLocation } = {}) {
    this.renderObstacles.renderSync(viewerLocation, target, { viewer, targetLocation });
    // return this.sumRedPixels.computeSync(this.renderObstacles.renderTexture);
    const imgData = this.sumPixelsWebGL2.pixelDataFromRender();
    return this.sumPixelsWebGL2.sumRedPixels(imgData.pixels);
  }

  destroy() {
    this.renderObstacles.destroy();
    // this.sumRedPixels.destroy();
  }
}