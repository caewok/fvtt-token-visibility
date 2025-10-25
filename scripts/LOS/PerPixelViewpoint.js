/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Base folder
import { MODULE_ID } from "../const.js";
import { Settings } from "../settings.js";

// LOS folder
import { AbstractViewpoint } from "./AbstractViewpoint.js";
import { AbstractPolygonTrianglesID } from "./PlaceableTriangles.js";
import { Camera } from "./Camera.js";
import { PercentVisibleCalculatorAbstract, PercentVisibleResult } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerArea3dPIXI } from "./DebugVisibilityViewer.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { BitSet } from "./BitSet/BitSet.js";

// Debug
import { Draw } from "../geometry/Draw.js";

export class PercentVisiblePerPixelResult extends PercentVisibleResult {

  _config = {
    ...this._config,
    numPoints: 1,
  };

  data = new BitSet();

  constructor(target, opts) {
    super(target, opts);
    this.data = BitSet.empty(this._config.numPoints);
  }

  static fromCalculator(calc, opts) {
    opts.numPoints = calc.scale ** 2;
    return super.fromCalculator(calc, opts);
  }

  get totalTargetArea() { return this._config.numPoints; }

  // Handled by the calculator, which combines multiple results.
  get largeTargetArea() { return this.totalTargetArea; }

  get visibleArea() { return this.data.cardinality; }

  /**
   * Blend this result with another result, taking the maximum values at each test location.
   * Used to treat viewpoints as "eyes" in which 2+ viewpoints are combined to view an object.
   * @param {PercentVisibleResult} other
   * @returns {PercentVisibleResult} A new combined set.
   */
  blendMaximize(other) {
    const out = new this.constructor(this.target, this.config);
    out.data = this.data.or(other.data);
    return out;
  }
}


/**
 * An eye belong to a specific viewer.
 * It defines a specific position, relative to the viewer, from which the viewpoint is used.
 * Draws lines from the viewpoint to points on the target token to determine LOS.
 */
export class PerPixelViewpoint extends AbstractViewpoint {
  static get calcClass() { return PercentVisibleCalculatorPerPixel; }

  /* ----- NOTE: Debugging methods ----- */
  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(draw, renderer, container, { width = 100, height = 100 } = {}) {
    this.calculator._draw3dDebug(this.viewer, this.target, this.viewpoint, this.targetLocation, { draw, renderer, container, width, height });
  }
}

export class PercentVisibleCalculatorPerPixel extends PercentVisibleCalculatorAbstract {
  static resultClass = PercentVisiblePerPixelResult;
  
  static get viewpointClass() { return PerPixelViewpoint; }

  static get POINT_ALGORITHMS() { return Settings.KEYS.LOS.TARGET.POINT_OPTIONS; }

  /** @type {Camera} */
  camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective",
    up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
    mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
  });

  _scale = 0; // Allow override of scale

  get scale() { return this._scale || CONFIG[MODULE_ID].perPixelScale; }

  initializeCalculations() {
    super.initializeCalculations();
    this._initializeCamera();
  }

  _calculate() {
    this.countTargetPixels();
  }

  _initializeCamera() {
    this.camera.cameraPosition = this.viewpoint;
    this.camera.targetPosition = this.targetLocation;
    this.camera.setTargetTokenFrustum(this.target);
  }

  _generateTargetFaces() {
    const litMethod = CONFIG[MODULE_ID].litToken;
    if ( this.config.testLighting
      && litMethod === CONFIG[MODULE_ID].litTokenOptions.CONSTRAIN ) return this.target[MODULE_ID][AbstractPolygonTrianglesID].litTriangles;
    if ( CONFIG[MODULE_ID].constrainTokens ) return this.target[MODULE_ID][AbstractPolygonTrianglesID].constrainedTriangles;
    return this.target[MODULE_ID][AbstractPolygonTrianglesID].triangles;
  }

  /* ----- NOTE: Pixel testing ----- */

  counts = new Uint16Array(5);

  countTargetPixels() {
    const scale = this.scale;
    const ndcTris = CONFIG[MODULE_ID].perPixelQuickInterpolation ? this.transformTargetToNDC() : this.transformTargetToNDC2();
    let srcs = [];
    let srcObstacles = [];
//     if ( this.config.testLighting ) {
//       srcs = canvas[this.config.sourceType].placeables;
//       srcObstacles = this.locateSourceObstacles();
//     }
    
    let i = 0;
    for ( let x = 0; x < scale; x += 1 ) {
      for ( let y = 0; y < scale; y += 1 ) {
        const isOccluded = this._testPixelOcclusion(x, y, ndcTris, srcs, srcObstacles);
        this.lastResult.data.set(i++, !isOccluded);
      }
    }
  }

  _testPixelOcclusion(x, y, ndcTris) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const fragmentPoint = Point3d.tmp;
    const gridPoint = PIXI.Point.tmp.set(x, y);
    const containingTri = this._locateFragmentTriangle(ndcTris, gridPoint);
    if ( !containingTri ) return false;

    // Determine where the fragment lies in 3d canvas space. Interpolate from the original triangle.
    // this.counts[TOTAL] += 1;

    // TODO: Is it necessary to implement perspective correct interpolation?
    // See https://webglfundamentals.org/webgl/lessons/webgl-3d-perspective-correct-texturemapping.html
    if ( CONFIG[MODULE_ID].perPixelQuickInterpolation ) {
      const origTri = containingTri._original;
      containingTri._baryPoint.interpolatePoint(origTri.a, origTri.b, origTri.c, fragmentPoint);
    } else {
      // Or use the matrix to convert back to 2d space.
      // Need to determine where the grid point hits the containing triangle on the z axis.
      const Point3d = CONFIG.GeometryLib.threeD.Point3d;
      const gridZ = containingTri._baryPoint.interpolateNumber(containingTri.a.z, containingTri.b.z, containingTri.c.z)
      this.#invModelProjectionScaleMatrix.multiplyPoint3d(Point3d.tmp.set(gridPoint.x, gridPoint.y, gridZ), fragmentPoint);
    }

    // Now we have a 3d point, compare to the viewpoint and lighting viewpoints to determine occlusion and bright/dim/dark
    // Is it occluded from the camera/viewer?
    const rayDirection = Point3d.tmp;
    fragmentPoint.subtract(this.viewpoint, rayDirection);
    const isOccluded = this.occlusionTester._rayIsOccluded(rayDirection);
    // this.counts[OBSCURED] += isOccluded;

    // Fragment brightness for each source.
    // if ( !isOccluded ) this._testLightingForPoint(fragmentPoint);

    rayDirection.release();
    gridPoint.release();
    fragmentPoint.release();
    
    return isOccluded;
  }

  /**
   * Locate the viewable triangle for this fragment.
   * Simple shapes should have a single facing triangle but it is possible for there to be more than 1 at a given point.
   * Returns the closest z.
   * @param {Triangle3d[]} ndcTris    Triangles in ndc space
   * @param {PIXI.Point} gridPoint       The ndc grid location of the fragment (between -1 and 1 on x and y axes)
   * @returns { Triangle3d|null}
   */
  _locateFragmentTriangle(ndcTris, gridPoint) {
    // Locate the viewable triangle for this fragment.
    // Simple shapes should have a single facing triangle but it is possible for there to be more than 1 at a given point.
    // Take the closest z.
    const containingTris = ndcTris.filter(tri => {
      CONFIG.GeometryLib.threeD.BarycentricPoint.fromTriangleData(gridPoint, tri._baryData, tri._baryPoint);
      return tri._baryPoint.isInsideTriangle();
    });

    // If no containment, move to next.
    if ( !containingTris.length ) return null;

    // Simple shapes should have a single facing triangle but it is possible for there to be more than 1 at a given point.
    // Take the closest z.
    if ( containingTris.length > 1 ) {
      const tri0 = containingTris[0];
      let containingPt = tri0._baryPoint.interpolatePoint(tri0.a, tri0.b, tri0.c);
      let newPt = new CONFIG.GeometryLib.threeD.BarycentricPoint();
      for ( let i = 1, iMax = containingTris.length; i < iMax; i += 1 ) {
        const tri = containingTris[i];
        tri._baryPoint.interpolatePoint(tri._baryPoint, tri.a, tri.b, tri.c, newPt);
        if ( newPt.z < containingPt.z ) {
          containingTris[0] = tri;
          containingPt = newPt;
        }
      }
    }
    return containingTris[0];
  }

  #modelProjectionMatrix = CONFIG.GeometryLib.MatrixFlat.identity(4);

  #modelProjectionScaleMatrix = CONFIG.GeometryLib.MatrixFlat.identity(4);

  #invModelProjectionScaleMatrix = CONFIG.GeometryLib.MatrixFlat.identity(4);

  #tmpScalingMatrix = CONFIG.GeometryLib.MatrixFlat.identity(4);

  #scalingM = new CONFIG.GeometryLib.MatrixFlat([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0.5, 0,
    0, 0, 0.5, 1 ], 4, 4);

  /**
   * Scale an ndc point (between {-1,-1,-1} and {1,1,1}) to be within a window from 0 --> scale.
   * See
   *  https://registry.khronos.org/OpenGL-Refpages/gl2.1/xhtml/gluProject.xml
   *  https://registry.khronos.org/OpenGL-Refpages/gl2.1/xhtml/gluUnProject.xml
   */
  get scalingM() {
    // Scale to 0 --> this.scale.
    // Here, view[0] = 0 and view[1] = 0. view[2] === view[3] === scale.
    const A = this.scale * 0.5; // B === A.
    // const C = A + view[0] = A
    // const D = B + view[1] = B = A;
    this.#scalingM.setIndex(0, 0, A);
    this.#scalingM.setIndex(1, 1, A); // B
    this.#scalingM.setIndex(3, 0, A); // C
    this.#scalingM.setIndex(3, 1, A); // D

    // Rest is already set in #scalingM.
    return this.#scalingM;

    /*
    Where view is [x, y, width, height] of the viewport.

    A = view[2] * 0.5
    B = view[3] * 0.5
    C = A + view[0]
    D = B + view[1]

    [ A, 0, 0, 0 ]
    [ 0, B, 0, 0 ]
    [ 0, 0, 0.5, 0 ]
    [ C, D, 0.5, 1]
    */
  }

  transformTargetToNDC2() {
    const camera = this.camera;
    const targetTris = this._generateTargetFaces().filter(poly => poly.isFacing(this.viewpoint));

    camera.lookAtMatrix.multiply4x4(camera.perspectiveMatrix, this.#modelProjectionMatrix);
    const trisTransformed = targetTris.map(tri => tri.transform(this.#modelProjectionMatrix))

    let xMinMax = { };
    let yMinMax = { };
    trisTransformed.forEach(tri => {
      xMinMax = Math.minMax(...Object.values(xMinMax), tri.a.x, tri.b.x, tri.c.x);
      yMinMax = Math.minMax(...Object.values(yMinMax), tri.a.y, tri.b.y, tri.c.y);
    });

    const xScale = Math.min(-1 / xMinMax.min, 1 / xMinMax.max);
    const yScale = Math.min(-1 / yMinMax.min, 1 / yMinMax.max);
    const scaleXY = Math.min(xScale, yScale);

    CONFIG.GeometryLib.MatrixFlat.scale(scaleXY, scaleXY, 1, this.#tmpScalingMatrix);

    // Scale to a view window between 0 and this.scale.
    // Determine the inverse.
    this.#tmpScalingMatrix.multiply4x4(this.scalingM, this.#tmpScalingMatrix);
    this.#modelProjectionMatrix.multiply4x4(this.#tmpScalingMatrix, this.#modelProjectionScaleMatrix)
    this.#modelProjectionScaleMatrix.invert(this.#invModelProjectionScaleMatrix);

    return targetTris.map((tri, idx) => {
      const out = tri.transform(this.#modelProjectionScaleMatrix)

      // For later use in interpolation.
      out._original = targetTris[idx];
      out._baryData = CONFIG.GeometryLib.threeD.BaryTriangleData.fromTriangle3d(out);
      out._baryPoint = new CONFIG.GeometryLib.threeD.BarycentricPoint();
      return out;
    });
  }


  transformTargetToNDC() {
    const targetTris = this._generateTargetFaces().filter(poly => poly.isFacing(this.viewpoint));

    // Old version (with change to scaling approach)
    const { lookAtMatrix, perspectiveMatrix } = this.camera;
    let trisTransformed = targetTris.map(poly => {
      poly = poly.transform(lookAtMatrix).clipZ();
      poly.transform(perspectiveMatrix, poly);
      return poly;
    }).filter(tri => tri.isValid());

    let xMinMax = { };
    let yMinMax = { };
    trisTransformed.forEach(tri => {
      xMinMax = Math.minMax(...Object.values(xMinMax), tri.a.x, tri.b.x, tri.c.x);
      yMinMax = Math.minMax(...Object.values(yMinMax), tri.a.y, tri.b.y, tri.c.y);
    });

    const xScale = Math.min(-1 / xMinMax.min, 1 / xMinMax.max);
    const yScale = Math.min(-1 / yMinMax.min, 1 / yMinMax.max);
    const scaleXY = Math.min(xScale, yScale) * this.scale * 0.5;

    // Move from { -scale/2, scale/2 } to {0, scale}
    const translateM = CONFIG.GeometryLib.MatrixFlat.translation(this.scale * 0.5, this.scale * 0.5, 0);
    const scaleM = CONFIG.GeometryLib.MatrixFlat.scale(scaleXY, scaleXY, 1);
    const stM = scaleM.multiply4x4(translateM);
    const trisScaled = trisTransformed.map(tri => tri.transform(stM));
    trisScaled.forEach((tri, idx) => {
      tri._original = targetTris[idx];
      tri._baryData = CONFIG.GeometryLib.threeD.BaryTriangleData.fromTriangle3d(tri);
      tri._baryPoint = new CONFIG.GeometryLib.threeD.BarycentricPoint();
    })
    return trisScaled;

    // trisScaled.forEach(tri => console.log(tri.a, tri.b, tri.c))
    // trisTransformed.map(tri => tri.transform(this.#tmpScalingMatrix)).forEach(tri => console.log(tri.a, tri.b, tri.c))
    // targetTris.map(tri => tri.transform(this.#modelProjectionScaleMatrix)).forEach(tri => console.log(tri.a, tri.b, tri.c))
    // targetTris.map(tri => tri.transform(this.#modelProjectionScaleMatrix)).map(tri => tri.transform(this.#invModelProjectionScaleMatrix)).forEach(tri => console.log(tri.a, tri.b, tri.c))


    // targetTris.map(tri => tri.transform(this.#modelProjectionMatrix)).forEach(tri => console.log(tri.a, tri.b, tri.c))
    // trisTransformed.forEach(tri => console.log(tri.a, tri.b, tri.c))

    // targetTris.map(tri => tri.transform(this.#modelProjectionScaleMatrix)).forEach(tri => console.log(tri.a, tri.b, tri.c))
    // trisScaled.forEach(tri => console.log(tri.a, tri.b, tri.c))

    // targetTris.map(tri => tri.transform(this.#modelProjectionScaleMatrix)).map(tri => tri.transform(this.#invModelProjectionScaleMatrix)).forEach(tri => console.log(tri.a, tri.b, tri.c))
    // targetTris.forEach(tri => console.log(tri.a, tri.b, tri.c))

    // trisScaled.map(tri => tri.transform(this.#invModelProjectionScaleMatrix)).forEach(tri => console.log(tri.a, tri.b, tri.c))
    // targetTris.forEach(tri => console.log(tri.a, tri.b, tri.c))


    // Scale the target triangles, which were already in NDC space.
    // TODO: Filter trisScaled by z? If z unscaled, between z = 0 and z = 1?
//     return trisTransformed.map((tri, idx) => {
//       const out = tri.transform(this.#tmpScalingMatrix);
//
//       // For later use in interpolation.
//       out._original = targetTris[idx];
//       out._baryData = BaryTriangleData.fromTriangle3d(tri);
//       out._baryPoint = new BarycentricPoint();
//       return out;
//     });

  }

  /* ----- NOTE: Pixel Indexing ----- */

  static setPixel(pixels, x, y, width, arr) {
    const offset = this.pixelIndex(x, y, width);
    pixels.set(arr, offset);
  }

  static pixelIndex(x, y, width = 1, channel = 0, numChannels = 4) {
    return (y * width * numChannels) + (x * numChannels) + channel;
  }

  static pixelCoordinates(i, width = 1, numChannels = 4) {
    const channel = i % 4;
    const idx = ~~(i / numChannels)

    const x = (idx % width);
    const y = ~~(idx / width);
    return { x, y, channel };
  }

  /* ----- NOTE: Debugging methods ----- */

  static componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
  }

  static rgbToHex(r, g, b) {
    return "0x" + this.componentToHex(r) + this.componentToHex(g) + this.componentToHex(b);
  }

  static drawPixels(pixels, width) {
    for ( let i = 0; i < pixels.length; i += 4 ) {
      const px = pixels.subarray(i, i + 3);
      const color = parseInt(this.rgbToHex(px[0], px[1], px[2]), 16);
      const coords = this.pixelCoordinates(i, width);
      CONFIG.GeometryLib.Draw.point({ x: coords.x, y: coords.y }, { radius: 1, color })
    }
  }

  static summarizePixels(pixels, numChannels = 4) {
    const out = new Array(numChannels);
    for ( let i = 0; i < numChannels; i += 1 ) out[i] = new Map();
    for ( let i = 0; i < pixels.length; i += numChannels ) {
      for ( let j = 0; j < numChannels; j += 1 ) {
        const px = pixels[i + j];
        const count = out[j].get(px) || 0;
        out[j].set(px, count + 1);
      }
    }
    return out;
  }

  // ----- NOTE: Debugging ----- //

  get pixelsLength() { return (this.scale ** 2) * 4; } // 4 channels: rgba

  pixels = new Uint8Array(this.pixelsLength);

  #fragmentColor = new Point3d();

  containingTris = new Set();

  countTargetPixelsDebug() {
    this.pixels.fill(0);
    this.containingTris.clear();

    const scale = this.scale;
    this.counts.fill(0);
    const ndcTris = CONFIG[MODULE_ID].perPixelQuickInterpolation ? this.transformTargetToNDC() : this.transformTargetToNDC2();

    for ( let x = 0; x < scale; x += 1 ) {
      for ( let y = 0; y < scale; y += 1 ) {
        this._testPixelOcclusionDebug(x, y, ndcTris);

        this.#fragmentColor.multiplyScalar(255, this.#fragmentColor);
        this.constructor.setPixel(this.pixels, x, y, scale, [...this.#fragmentColor, 255]);
      }
    }
  }

  _testPixelOcclusionDebug(x, y, ndcTris) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const gridPoint = PIXI.Point.tmp.set(x, y);
    const fragmentPoint = Point3d.tmp;

    this.#fragmentColor.set(0, 0, 0);

    const containingTri = this._locateFragmentTriangle(ndcTris, gridPoint);
    if ( !containingTri ) return;

    // Determine where the fragment lies in 3d canvas space. Interpolate from the original triangle.
    this.containingTris.add(containingTri);
    // this.counts[TOTAL] += 1;

    if ( CONFIG[MODULE_ID].perPixelQuickInterpolation ) {
      const origTri = containingTri._original;
      containingTri._baryPoint.interpolatePoint(origTri.a, origTri.b, origTri.c, fragmentPoint);
    } else {
      // Or use the matrix to convert back to 2d space.
      // Need to determine where the grid point hits the containing triangle on the z axis.
      const Point3d = CONFIG.GeometryLib.threeD.Point3d;
      const gridZ = containingTri._baryPoint.interpolateNumber(containingTri.a.z, containingTri.b.z, containingTri.c.z)
      this.#invModelProjectionScaleMatrix.multiplyPoint3d(Point3d.tmp.set(gridPoint.x,gridPoint.y, gridZ), fragmentPoint);
    }

    this.#fragmentColor.x = 1;

    // Now we have a 3d point, compare to the viewpoint and lighting viewpoints to determine occlusion and bright/dim/dark
    // Is it occluded from the camera/viewer?
    const rayDirection = Point3d.tmp;
    fragmentPoint.subtract(this.viewpoint, rayDirection);
//    const isOccluded = this.occlusionTester._rayIsOccluded(rayDirection);
//     if ( isOccluded ) {
//       // this.counts[OBSCURED] += 1;
//       this.#fragmentColor.z = 1; // Blue.
//       this.#fragmentColor.x = 0; // Remove red.
//       rayDirection.release();
//       gridPoint.release();
//       fragmentPoint.release();
//       return;
//     }

    // Fragment brightness for each source. (For debug, always run.)
//     if ( CONFIG[MODULE_ID].perPixelDebugLit ) {
//       const { isBright, isDim } = this._testLightingForPoint(fragmentPoint);
//       this.#fragmentColor.x = isBright ? 1 : isDim ? 0.75 : 0.25;
//     }
    // this._testPixelBrightnessDebug(containingTri._original, srcs, srcObstacles);

    rayDirection.release();
    gridPoint.release();
    fragmentPoint.release();
  }

//   #lightDirection = new Point3d();
//
//   #reflectedLightColor = new Point3d();
//
//   #specularLightColor = new Point3d();
//
//   #ambientLightColor = new Point3d(0.2, 0.2, 0.2);
//
//   #viewDirection = new Point3d();

  shininess = 100;

/*
  _testPixelBrightnessDebug(origTri, srcs) {
    const srcOrigin = this.#sourceOrigin;
    const rayDirection = this.#rayDirection;
    this.#reflectedLightColor.set(0, 0, 0);
    this.#specularLightColor.set(0, 0, 0);
    this.#fragmentPoint.subtract(this.viewpoint, this.#viewDirection); // Should be just the reverse of #rayDirection.

    let isBright = false;
    let isDim = false;
    for ( let i = 0, iMax = srcs.length; i < iMax; i += 1 ) {
      const src = srcs[i];
      Point3d.fromPointSource(src, srcOrigin);
      if ( !origTri.isFacing(srcOrigin) ) continue; // On opposite side of the triangle from the camera.

      // Are we within the light radius?
      const dist2 = Point3d.distanceSquaredBetween(this.#fragmentPoint, srcOrigin);
      if ( dist2 > (src.dimRadius ** 2) ) continue; // Not within source dim radius.

      // If blocked, then not bright or dim.
      this.#fragmentPoint.subtract(srcOrigin, rayDirection); // NOTE: Don't normalize so the wall test can use 0 < t < 1.
      if ( this.occlusionTesters.get(src)._rayIsOccluded(rayDirection) ) continue;

      // TODO: handle light/sound attenuation from threshold walls.
      isBright ||= (dist2 <= (src.brightRadius ** 2));
      isDim = true; // Already tested distance above.
      // isDim ||= isBright || (dist2 <= (src.dimRadius ** 2));

      // Don't break so we can add in color contributions from each light source to display in debugging.
      // if ( isBright ) break; // Once we know a fragment is bright, we should know the rest.
      if ( !(isBright || isDim) ) break;

      // Apply simplified point lighting to the fragment color.
      // See https://stackoverflow.com/questions/30594511/webgl-fragment-shader-for-multiple-light-sources

      // Reflected light from this source.
      const lightColor = Point3d.tmp;
      const srcReflectedColor = Point3d.tmp;
      const N = origTri.plane.normal.multiplyScalar(-1, Point3d.tmp);

      this.#fragmentPoint.subtract(srcOrigin, this.#lightDirection).normalize(this.#lightDirection);
      const lightStrength = Math.max(N.dot(this.#lightDirection), 0) * (isDim ? 0.5 : 1.0);
      lightColor.set(...src.lightSource.colorRGB);
      lightColor.multiplyScalar(lightStrength, srcReflectedColor);
      this.#reflectedLightColor.add(srcReflectedColor, this.#reflectedLightColor);

      // Specular from this source.
      if ( lightStrength ) {
        const srcSpecularColor = Point3d.tmp;
        const halfVector = Point3d.tmp;

        this.#lightDirection.add(this.#viewDirection, halfVector).normalize(halfVector);
        const specularStrength = Math.pow(N.dot(halfVector), this.shininess);
        lightColor.multiplyScalar(specularStrength, srcSpecularColor);
        this.#specularLightColor.add(srcSpecularColor, this.#specularLightColor);
      }
    }
    this.counts[BRIGHT] += isBright;
    this.counts[DIM] += isDim;
    this.counts[DARK] += !(isBright || isDim);

    this.#fragmentColor.x = isBright ? 1 : isDim ? 0.75 : 0.25;
    }
*/
    // Multiply the various light strengths by the fragment color and add
    /*
    this.#ambientLightColor.multiply(this.#fragmentColor, this.#ambientLightColor);
    this.#reflectedLightColor.multiply(this.#fragmentColor, this.#reflectedLightColor);
    this.#specularLightColor.multiply(this.#fragmentColor, this.#specularLightColor);

    this.#ambientLightColor
      .add(this.#reflectedLightColor, this.#fragmentColor)
      .add(this.#specularLightColor, this.#fragmentColor);
    */


  #debugTexture;

  #debugSprite;

  #verifyDebugContainer(container, draw, width = this.scale) {
    draw.g.position.set(-width * 0.5, -width * 0.5);

    // Set up container if necessary.
    if ( this.#debugTexture && this.#debugTexture.destroyed ) {
      this.#debugTexture = undefined;
      this.#debugSprite = undefined;
    }

    // Resize if needed.
    if ( this.pixelsLength !== this.pixels.length ) {
      if ( this.#debugTexture ) {
        container.removeChild(this.#debugSprite);
        this.#debugTexture.destroy();
        this.#debugSprite.destroy();
        this.#debugTexture = undefined;
        this.#debugSprite = undefined;
      }
      this.pixels = new Uint8Array(this.pixelsLength);
    }

    this.#debugTexture ??= PIXI.Texture.fromBuffer(this.pixels, width, width);
    if ( !this.#debugSprite ) {
      this.#debugSprite = new PIXI.Sprite(this.#debugTexture);
      container.addChild(this.#debugSprite);

      // Rotate the sprite to match expected view.
      this.#debugSprite.anchor.set(0.5);
      // this.#debugSprite.rotation = Math.PI / 2; // 90º
      // this.#debugSprite.position.set(-scale , -scale);

      container.sortableChildren = true;
      draw.g.zIndex = 10;
    }
  }

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(viewer, target, viewpoint, targetLocation, { draw, container, width = 100 } = {}) {
    draw ??= new CONFIG.GeometryLib.Draw();

    // Store the original scale
    const oldScale = this._scale;
    this._scale = width;
    this.#verifyDebugContainer(container, draw, width);

    // Reset as needed.
    this.viewer = viewer;
    this.target = target;
    this.viewpoint = viewpoint;
    this.targetLocation = targetLocation;

    this.camera.cameraPosition = viewpoint;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustum(target);

    // Recalculate, using debug.
    this.countTargetPixelsDebug();

    // Update the texture; the underlying buffer should remain the same as we did not change the typed array.
    this.#debugTexture.update();

    // Draw the triangle outlines.
    this.containingTris.forEach(tri => tri.draw2d({ color: Draw.COLORS.green, alpha: 0.75, draw }));

    this._scale = oldScale;
  }

  destroy() {
    if ( this.#debugSprite ) {
      if ( !this.#debugSprite.destroyed ) this.#debugSprite.destroy();
      this.#debugSprite = undefined;
    }
    if ( this.#debugTexture ) {
      if ( !this.#debugTexture.destroyed ) this.#debugTexture.destroy();
      this.#debugTexture = undefined;
    }

    super.destroy();
  }
}

export class DebugVisibilityViewerPerPixel extends DebugVisibilityViewerArea3dPIXI {
  static viewpointClass = PerPixelViewpoint;

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
