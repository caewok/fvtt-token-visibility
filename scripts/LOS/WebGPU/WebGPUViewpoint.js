/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../../const.js";

// LOS folder
import { AbstractViewpoint } from "../AbstractViewpoint.js";

/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class WebGPUViewpoint extends AbstractViewpoint {
  // TODO: Handle config and filtering obstacles.

  constructor(...args) {
    super(...args);
    this.calc = CONFIG[MODULE_ID].sightCalculators.webGPU;
  }

  /** @type {boolean} */
  useCache = true;

  _percentVisible() {
    // TODO: Handle configuration options.
    const viewer =  this.viewerLOS.viewer;
    const target = this.viewerLOS.target;
    const viewerLocation = this.viewpoint;
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);

    if ( this.useCache ) return this.calc.percentVisible(viewer, target, { viewerLocation, targetLocation });
    return this.calc._percentVisible(viewer, target, viewerLocation, targetLocation);
  }
}

export class WebGPUViewpointAsync extends AbstractViewpoint {
  // TODO: Handle config and filtering obstacles.

  constructor(...args) {
    super(...args);
    this.calc = CONFIG[MODULE_ID].sightCalculators.webGPUAsync;
  }

  /** @type {boolean} */
  useCache = true;

  _percentVisible(callback) {
    // TODO: Handle configuration options.
    const viewer =  this.viewerLOS.viewer;
    const target = this.viewerLOS.target;
    const viewerLocation = this.viewpoint;
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);

    if ( this.useCache ) return this.calc.percentVisible(viewer, target, { viewerLocation, targetLocation });
    return this.calc._percentVisible(viewer, target, { viewerLocation, targetLocation });
  }

  async _percentVisibleAsync() {
    // TODO: Handle configuration options.
    const viewer =  this.viewerLOS.viewer;
    const target = this.viewerLOS.target;
    const viewerLocation = this.viewpoint;
    const targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);

    if ( this.useCache ) return this.calc.percentVisibleAsync(viewer, target, { viewerLocation, targetLocation });
    return this.calc._percentVisibleAsync(viewer, target, viewerLocation, targetLocation);
  }
}
