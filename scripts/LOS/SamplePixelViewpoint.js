/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { AbstractPolygonTrianglesID } from "./PlaceableTriangles.js";
import { PercentVisibleCalculatorAbstract } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerArea3dPIXI } from "./DebugVisibilityViewer.js";
import { ObstacleOcclusionTest } from "./ObstacleOcclusionTest.js";

// NOTE: Temporary objects
const TOTAL = 0;
const OBSCURED = 1;
const BRIGHT = 2;
const DIM = 3;
const DARK = 4;

/* Sample pixel viewpoint
Instead of transforming to perspective coordinates, keep everything in model space.
More like visibility testing using an orthographic view. Faces further away count more than
they would with perspective view, but hopefully much faster.
*/


/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class SamplePixelViewpoint extends AbstractViewpoint {
  static get calcClass() { return PercentVisibleCalculatorSamplePixel; }

  /* ----- NOTE: Debugging methods ----- */
  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(draw, renderer, container, { width = 100, height = 100 } = {}) {
    this.calculator._draw3dDebug(this.viewer, this.target, this.viewpoint, this.targetLocation, { draw, renderer, container, width, height });
  }
}

export class PercentVisibleCalculatorSamplePixel extends PercentVisibleCalculatorAbstract {
  static get viewpointClass() { return SamplePixelViewpoint; }

  static get POINT_ALGORITHMS() { return Settings.KEYS.LOS.TARGET.POINT_OPTIONS; }


  occlusionTester = new ObstacleOcclusionTest();

  /** @type {WeakMap<PointSource, ObstacleOcclusionTest>} */
  occlusionTesters = new WeakMap();

  #rayDirection = new CONFIG.GeometryLib.threeD.Point3d();

  #sourceOrigin = new CONFIG.GeometryLib.threeD.Point3d();

  _calculate() {
    const faces = this._generateTargetFaces(); // Not in initialization b/c may vary depending on _tokenShapeType
    for ( const face of faces ) {
      if ( !face.isFacing(this.viewpoint) ) continue;
      this._testTargetFace(face);
    }
  }

  _generateTargetFaces() {
    const litMethod = CONFIG[MODULE_ID].litToken;
    if ( this.config.testLighting
      && litMethod === CONFIG[MODULE_ID].litTokenOptions.CONSTRAIN ) return this.target[MODULE_ID][AbstractPolygonTrianglesID].litTriangles;
    if ( CONFIG[MODULE_ID].constrainTokens ) return this.target[MODULE_ID][AbstractPolygonTrianglesID].constrainedTriangles;
    return this.target[MODULE_ID][AbstractPolygonTrianglesID].triangles;
  }

  /**
   * Test a grid of points along a given face of the target.
   * The face can be the entire polygon face or a portion (e.g. triangle)
   */
  _testTargetFace(face) {
    // To sample evenly across different faces:
    // Project grid of points from a rectangular plane onto the face.
    // Use the token 3d border as the edges of the grid.
    // Drop points that are not within the face.
    const { axisNormal, pts } = this._generatePointsForFace(face);

    for ( const pt of pts ) {
      const ix = face.intersection(pt, axisNormal, Number.NEGATIVE_INFINITY); // Set t to -∞ so it intersects either direction.
      if ( ix === null ) continue;
      this.counts[TOTAL] += 1;
      pt.subtract(this.viewpoint, this.#rayDirection);
      const isOccluded = this.occlusionTester._rayIsOccluded(this.#rayDirection);
      this.counts[OBSCURED] += isOccluded

      const debugObject = { A: this.viewpoint, B: pt, isOccluded, isDim: null, isBright: null };
      this.debugPoints.push(debugObject);
      if ( !isOccluded ) this._testLightingForPoint(pt, debugObject, face);
    }
  }

  debugPoints = [];

  _generatePointsForFace(face) {
    // Plane normals
    // • 0, 0, 1: parallel to the 2d canvas.
    // • 0, 1, 1: slanting upward as it moves along y
    // • 1, 0, 1: slanting upward as it moves along x
    // • 1, 0, 0: vertical, runs along y axis
    // • 0, 1, 0: vertical, runs along x axis
    // Take the major axis
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const N = face.plane.normal;
    const Nx = Math.abs(N.x);
    const Ny = Math.abs(N.y);
    const Nz = Math.abs(N.z);
    const axis = Nx > Ny && Nx > Nz ? "x" : Ny > Nz ? "y" : "z";

    const target = this.target;
    const numPtsWide = Math.floor(Math.sqrt(CONFIG[MODULE_ID].samplePixelNumberSamples));
    const pts = new Array(numPtsWide ** 2);
    const border = target.tokenBorder;
    const axisNormal = new Point3d();
    switch ( axis ) {
      case "x": {
        const x = border.x;
        let i = 0;
        const zHeight = target.topZ - target.bottomZ;
        const incr = 1 / (numPtsWide - 1);
        for ( let yi = 0; yi < numPtsWide; yi += 1 ) {
          const yPercent = yi * incr;
          for ( let zi = 0; zi < numPtsWide; zi += 1 ) {
            const zPercent = zi * incr;
            pts[i++] = new Point3d(x, border.y + (yPercent * border.height), target.bottomZ + (zPercent * zHeight));
          }
        }
        axisNormal.set(1, 0, 0);
        break;
      }
      case "y": {
        const y = border.y;
        let i = 0;
        const zHeight = target.topZ - target.bottomZ;
        const incr = 1 / (numPtsWide - 1);
        for ( let xi = 0; xi < numPtsWide; xi += 1 ) {
          const xPercent = xi * incr;
          for ( let zi = 0; zi < numPtsWide; zi += 1 ) {
            const zPercent = zi * incr;
            pts[i++] = new Point3d(border.x + (xPercent * border.width), y, target.bottomZ + (zPercent * zHeight));
          }
        }
        axisNormal.set(0, 1, 0);
        break;
      }

      case "z": {
        const z = this.target.bottomZ;
        let i = 0;
        const incr = 1 / (numPtsWide - 1);
        for ( let xi = 0; xi < numPtsWide; xi += 1 ) {
          const xPercent = xi * incr;
          for ( let yi = 0; yi < numPtsWide; yi += 1 ) {
            const yPercent = yi * incr;
            pts[i++] = new Point3d(border.x + (xPercent * border.width), border.y + (yPercent * border.height), z);
          }
        }
        axisNormal.set(0, 0, 1);
        break;
      }
    }

    return { axis, axisNormal, pts };
  }

}

export class DebugVisibilityViewerSamplePixel extends DebugVisibilityViewerArea3dPIXI {
  static viewpointClass = SamplePixelViewpoint;

  algorithm = Settings.KEYS.LOS.TARGET.TYPES.PER_PIXEL;

  updatePopoutFooter(percentVisible) {
    super.updatePopoutFooter(percentVisible);
    const calc = this.viewerLOS.calculator;

    const { RED, BRIGHT, DIM, DARK } = calc.constructor.OCCLUSION_TYPES;
    const area = calc.counts[RED];
    const bright = calc.counts[BRIGHT] / area;
    const dim = calc.counts[DIM] / area;
    const dark = calc.counts[DARK] / area;

    const footer2 = this.popout.element[0].getElementsByTagName("p")[1];
    footer2.innerHTML = `${(bright * 100).toFixed(0)}% bright | ${(dim * 100).toFixed(0)}% dim | ${(dark * 100).toFixed(0)}% dark`;
  }
}


/*
PercentVisibleCalculatorPerPixel = api.calcs.perPixel

debugViewer = buildDebugViewer(api.debugViewers.perPixel)
await debugViewer.initialize();
debugViewer.render();

calc = debugViewer.viewerLOS.calculator
PercentVisibleCalculatorPerPixel.summarizePixels(calc.pixels)

calc.countTargetPixels()
calc.counts

calc.countTargetPixelsDebug();
calc.counts

// Fill buffer to test order.

buffer = new Uint8Array(100 * 100 * 4);
q = buffer.length / 4;
for ( let i = 0; i < q; i += 4 ) buffer.set([255, 255, 255, 255], i);
for ( let i = q; i < q * 2; i += 4 ) buffer.set([255, 0, 0, 255], i);
for ( let i = q * 2; i < q * 3; i += 4 ) buffer.set([0, 255, 0, 255], i);
for ( let i = q * 3; i < q * 4; i += 4 ) buffer.set([0, 0, 255, 255], i);

tex = PIXI.Texture.fromBuffer(buffer, 100, 100)
sprite = new PIXI.Sprite(tex)
canvas.stage.addChild(sprite)
canvas.stage.removeChild(sprite)

// Texture is displayed from top --> right, moving down.
/* So striped
white
red
green
blue
*/
