/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { RenderObstacles } from "./RenderObstacles.js";
import { WebGPUSumRedPixels } from "./SumPixels.js";

export class PercentVisibleCalculator {
  /** @type {RenderObstacles} */
  renderObstacles = new RenderObstacles();

  /** @type {WebGPUSumRedPixels} */
  sumRedPixels;

  // TODO: Set debug flag and render to the debug viewer.
  // Just the obstacle view. For now, make same; no lighting effects etc.

  async initialize({ width = 256, height = 256, senseType = "sight" } = {}) {
    this.renderObstacles.senseType = senseType;
    await this.renderObstacles.getDevice();
    this.renderObstacles.renderSize = { width, height };
    this.renderObstacles.setRenderTextureToInternalTexture()
    await this.renderObstacles.initialize();
    await this.renderObstacles.prerender();
    this.renderObstacles.registerPlaceableHooks();

    this.sumRedPixels = new WebGPUSumRedPixels(this.renderObstacles.device);
    await this.sumRedPixels.initialize()
  }

  async percentVisible(viewerLocation, target, { viewer, targetLocation } = {}) {
    viewerLocation ??= CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer);
    const targetArea = await this.targetPixelArea(viewerLocation, target, { viewer, targetLocation });
    const targetObscuredArea = await this.targetPixelAreaWithObstacles(viewerLocation, target, { viewer, targetLocation });
    return targetObscuredArea / targetArea;
  }

  async targetPixelArea(viewerLocation, target, { viewer, targetLocation } = {}) {
    await this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation, targetOnly: true });
    return await this.sumRedPixels.compute(this.renderObstacles.renderTexture);
  }

  async targetPixelAreaWithObstacles(viewerLocation, target, { viewer, targetLocation } = {}) {
    await this.renderObstacles.render(viewerLocation, target, { viewer, targetLocation });
    return await this.sumRedPixels.compute(this.renderObstacles.renderTexture);
  }

  destroy() {
    this.renderObstacles.destroy();
    this.sumRedPixels.destroy();
  }
}