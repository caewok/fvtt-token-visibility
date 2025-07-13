/* globals
canvas,
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
import { PercentVisibleRenderCalculatorAbstract } from "./PercentVisibleCalculator.js";
import { DebugVisibilityViewerArea3dPIXI } from "./DebugVisibilityViewer.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { BarycentricPoint, BaryTriangleData } from "./geometry/Barycentric.js";
import { regionElevation } from "./util.js";

// Debug
import { Draw } from "../geometry/Draw.js";

// NOTE: Temporary objects
const RED = 0;
const OCCLUDED = 1;
const BRIGHT = 2;
const DIM = 3;
const DARK = 4;

const tmpIx = new Point3d();

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

export class PercentVisibleCalculatorPerPixel extends PercentVisibleRenderCalculatorAbstract {
  static get viewpointClass() { return PerPixelViewpoint; }

  static get POINT_ALGORITHMS() { return Settings.KEYS.LOS.TARGET.POINT_OPTIONS; }

  static defaultConfiguration = {
    ...PercentVisibleRenderCalculatorAbstract.defaultConfiguration,
    scale: 50,
  };

  /** @type {Camera} */
  camera = new Camera({
    glType: "webGL2",
    perspectiveType: "perspective",
    up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
    mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
  });

  static OCCLUSION_TYPES = {
    RED: 0,
    OCCLUDED :1,
    BRIGHT: 2,
    DIM: 3,
    DARK: 4,
  };

  viewer;

  target;

  viewpoint;

  targetLocation;

  get targetArea() { return this.counts[RED]; }

  get obscuredArea() { return this.counts[OCCLUDED]; }

  _calculatePercentVisible(viewer, target, viewerLocation, targetLocation) {
    this.viewer = viewer;
    this.target = target;
    this.viewpoint = viewerLocation;
    this.targetLocation = targetLocation;

    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustum(target);
    /*
    this.camera.perspectiveParameters = {
      fov: Math.toRadians(90),
      aspect: 1,
      zNear: 1,
      zFar: Infinity,
    };
    */

    this.countTargetPixels();
  }

  _totalTargetArea() { return this.targetArea; }

  _viewableTargetArea() { return this.obscuredArea; }


  /* ----- NOTE: Pixel testing ----- */

  counts = new Uint16Array(5);

  countTargetPixels() {
    this.counts.fill(0);
    const ndcTris = this.transformTargetToNDC();
    const viewerObstacles = this.locateViewerObstacles();
    let srcs = [];
    let srcObstacles = [];
    if ( this.config.useLitTargetShape ) {
      srcs = canvas[this.config.sourceType].placeables;
      srcObstacles = this.locateSourceObstacles();
    }
    const scale = this.config.scale;
    for ( let x = -scale; x < scale; x += 1 ) {
      for ( let y = -scale; y < scale; y += 1 ) {
        this._testPixelOcclusion(x, y, ndcTris, viewerObstacles, srcs, srcObstacles);
      }
    }
  }

  #gridPoint = new PIXI.Point();

  #fragmentPoint = new Point3d();

  #rayDirection = new Point3d();

  _testPixelOcclusion(x, y, ndcTris, viewerObstacles = [], srcs = [], srcObstacles = []) {
    this.#gridPoint.set(x, y);
    const containingTri = this._locateFragmentTriangle(ndcTris, this.#gridPoint);
    if ( !containingTri ) return;

    // Determine where the fragment lies in 3d canvas space. Interpolate from the original triangle.
    this.counts[RED] += 1;
    const origTri = containingTri._original;
    containingTri._baryPoint.interpolatePoint(origTri.a, origTri.b, origTri.c, this.#fragmentPoint);

    // Now we have a 3d point, compare to the viewpoint and lighting viewpoints to determine occlusion and bright/dim/dark
    // Is it occluded from the camera/viewer?
    this.#fragmentPoint.subtract(this.viewpoint, this.#rayDirection);
    if ( this.obstaclesOcclude(this.viewpoint, this.#rayDirection, viewerObstacles, this.config.senseType) ) {
      this.counts[OCCLUDED] += 1;
      return;
    }

    // Fragment brightness for each source.
    if ( this.config.useLitTargetShape ) this._testPixelBrightness(origTri, srcs, srcObstacles);
  }

  #srcOrigin = new Point3d();

  _testPixelBrightness(origTri, srcs, srcObstacles) {
    const srcOrigin = this.#srcOrigin;
    const rayDirection = this.#rayDirection;
    const senseType = this.config.senseType;

    let isBright = false;
    let isDim = false;
    const side = origTri.plane.whichSide(this.viewpoint);
    for ( let i = 0, iMax = srcs.length; i < iMax; i += 1 ) {
      const src = srcs[i];
      const obstacles = srcObstacles[i];
      Point3d.fromPointSource(src, srcOrigin);
      if ( (side * origTri.plane.whichSide(srcOrigin)) < 0 ) continue; // On opposite side of the triangle from the camera.
      const dist2 = Point3d.distanceSquaredBetween(this.#fragmentPoint, srcOrigin);
      if ( dist2 > (src.dimRadius ** 2) ) continue; // Not within source dim radius.

      // If blocked, then not bright or dim.
      this.#fragmentPoint.subtract(srcOrigin, rayDirection); // NOTE: Don't normalize so the wall test can use 0 < t < 1.
      if ( this.obstaclesOcclude(srcOrigin, rayDirection, obstacles, senseType) ) continue;

      // TODO: handle light/sound attenuation from threshold walls.
      isBright ||= (dist2 <= (src.brightRadius ** 2));
      isDim ||= isBright || (dist2 <= (src.dimRadius ** 2));
      if ( isBright ) break; // Once we know a fragment is bright, we should know the rest.
    }
    this.counts[BRIGHT] += isBright;
    this.counts[DIM] += isDim;
    this.counts[DARK] += !(isBright || isDim);
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
      BarycentricPoint.fromTriangleData(gridPoint, tri._baryData, tri._baryPoint);
      return tri._baryPoint.isInsideTriangle();
    });

    // If no containment, move to next.
    if ( !containingTris.length ) return null;

    // Simple shapes should have a single facing triangle but it is possible for there to be more than 1 at a given point.
    // Take the closest z.
    if ( containingTris.length > 1 ) {
      const tri0 = containingTris[0];
      let containingPt = tri0._baryPoint.interpolatePoint(tri0.a, tri0.b, tri0.c);
      let newPt = new BarycentricPoint();
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

  locateViewerObstacles() {
    const { senseType, blocking: blockingOpts } = this.config;
    const viewerObstacles = AbstractViewpoint.findBlockingObjects(this.viewpoint, this.target, { senseType, blockingOpts });
    viewerObstacles.terrainWalls = AbstractViewpoint.pullOutTerrainWalls(viewerObstacles.walls, senseType);
    viewerObstacles.proximateWalls = AbstractViewpoint.pullOutTerrainWalls(viewerObstacles.walls, senseType);
    return viewerObstacles;
  }

  locateSourceObstacles(srcs) {
    const { senseType, sourceType, blocking: blockingOpts } = this.config;
    srcs ??= canvas[sourceType].placeables;
    return srcs.map(src => {
      const obstacles = AbstractViewpoint.findBlockingObjects(Point3d.fromPointSource(src), this.target, { senseType, blockingOpts });
      obstacles.terrainWalls = AbstractViewpoint.pullOutTerrainWalls(obstacles.walls, senseType);
      obstacles.proximateWalls = AbstractViewpoint.pullOutTerrainWalls(obstacles.walls, senseType);
      return obstacles;
    });
  }


  transformTargetToNDC() {
    const triangleType = CONFIG[MODULE_ID].constrainTokens ? "constrainedTriangles" : "triangles";
    const targetTris = this.target[MODULE_ID][AbstractPolygonTrianglesID][triangleType].filter(poly => poly.isFacing(this.viewpoint));
    const { lookAtMatrix, perspectiveMatrix } = this.camera;
    const trisTransformed = targetTris.map(poly => {
      poly = poly.transform(lookAtMatrix).clipZ();
      poly.transform(perspectiveMatrix, poly);
      return poly;
    }).filter(tri => tri.isValid());

    // Transform the triangles so they fit between -1 and 1.
    let xMinMax = { };
    let yMinMax = { };
    trisTransformed.forEach(tri => {
      xMinMax = Math.minMax(...Object.values(xMinMax), tri.a.x, tri.b.x, tri.c.x);
      yMinMax = Math.minMax(...Object.values(yMinMax), tri.a.y, tri.b.y, tri.c.y);
    });

    const xScale = Math.min(-1 / xMinMax.min, 1 / xMinMax.max);
    const yScale = Math.min(-1 / yMinMax.min, 1 / yMinMax.max);

    // Scale up to -50 to 50 so that we can easily get approximately 100 x 100 pixels.
    // Avoids where the frustum does not adequately capture the target.
    // trisScaled = trisTransformed.map(tri => tri.multiplyScalar(scale))
    // Ensure the scale is the same in x and y.
    const scale = Math.min(xScale, yScale) * this.config.scale;
    // const x = this.config.scale * scale;
    // const y = this.config.scale * scale;
    const scaleOpts = { x: scale, y: scale, z: 1 };
    const trisScaled = trisTransformed.map(tri => tri.scale(scaleOpts));
    trisScaled.forEach((tri, idx) => {
      tri._original = targetTris[idx]
      tri._baryData = BaryTriangleData.fromTriangle3d(tri);
      tri._baryPoint = new BarycentricPoint();
    });

    // TODO: Filter trisScaled by z? If z unscaled, between z = 0 and z = 1?

    return trisScaled;
  }


  /* ----- NOTE: Placeable occlusion testing ---- */

  // TODO: Build a function that returns a function that varies based on which tests to run.
  // Customize tilesOcclude and tokensOcclude for CONFIGs (alpha, constrained)
  obstaclesOcclude(rayOrigin, rayDirection, obstacles, senseType) {
    return this.wallsOcclude(rayOrigin, rayDirection, obstacles.walls, senseType)
      || this.terrainWallsOcclude(rayOrigin, rayDirection, obstacles.terrainWalls, senseType)
      || this.proximateWallsOcclude(rayOrigin, rayDirection, obstacles.proximateWalls, senseType)
      || this.tilesOccludeAlpha(rayOrigin, rayDirection, obstacles.tiles, senseType)
      || this.tokensOcclude(rayOrigin, rayDirection, obstacles.tokens, senseType)
      || this.regionsOcclude(rayOrigin, rayDirection, obstacles.regions, senseType);
  }

  // TODO: In PlaceableTriangles.js, handle points and cached updating
  // - Quad points for walls and tiles (incl. alpha texture points)
  // - Cache and clear triangles and points on placeable update.
  wallsOcclude(rayOrigin, rayDirection, walls) {
    for ( const wall of walls ) {
      /* Handled elsewhere
      if ( wall.document[senseType] === types.NONE
        || wall.isOpen
        || (wall.document.dir && wall.edge.orientPoint(rayOrigin) !== wall.document.dir) ) continue;
      */

      /*
      const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
      const t = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c)
        ?? Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri1.a, tri1.b, tri1.c);
      */
      const quad = wall[MODULE_ID][AbstractPolygonTrianglesID].quad3d;
      const t = quad.intersectionT(rayOrigin, rayDirection);
      if ( t !== null && t.between(0, 1, false) ) return true;
    }
    return false;
  }

  terrainWallsOcclude(rayOrigin, rayDirection, walls) {
    let limitedOcclusion = 0;
    for ( const wall of walls ) {
      /* Handled elsewhere
      if ( wall.document[senseType] === types.NONE
        || wall.isOpen
        || (wall.document.dir && wall.edge.orientPoint(rayOrigin) !== wall.document.dir) ) continue;
      */

      /*
      const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
      const t = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c)
        ?? Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri1.a, tri1.b, tri1.c);
      */
      const quad = wall[MODULE_ID][AbstractPolygonTrianglesID].quad3d;
      const t = quad.intersectionT(rayOrigin, rayDirection);
      if ( t === null || !t.between(0, 1, false) ) continue;
      if ( limitedOcclusion++ ) return true;
    }
    return false;
  }

  proximateWallsOcclude(rayOrigin, rayDirection, walls, senseType = "light") {
    for ( const wall of walls ) {
      if ( wall.edge.applyThreshold(senseType, rayOrigin) ) continue; // If the proximity threshold is met, this edge excluded from perception calculations.
      /* Handled elsewhere
      if ( wall.document[senseType] === types.NONE
        || wall.isOpen
        || (wall.document.dir && wall.edge.orientPoint(rayOrigin) !== wall.document.dir) ) continue;
      */

      /*
      const [tri0, tri1] = wall.tokenvisibility.geometry.triangles;
      const t = Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri0.a, tri0.b, tri0.c)
        ?? Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri1.a, tri1.b, tri1.c);
      */
      const quad = wall[MODULE_ID][AbstractPolygonTrianglesID].quad3d;
      const t = quad.intersectionT(rayOrigin, rayDirection);
      if ( t === null || !t.between(0, 1, false) ) continue;
    }
    return false;
  }

  tilesOcclude(rayOrigin, rayDirection, tiles) {
    for ( const tile of tiles ) {
      const quad = tile[MODULE_ID][AbstractPolygonTrianglesID].quad3d;
      const t = quad.intersectionT(rayOrigin, rayDirection);
      if ( t === null || !t.between(0, 1, false) ) continue;
      return true;
    }
    return false;
  }

  tilesOccludeAlpha(rayOrigin, rayDirection, tiles) {
    if ( !CONFIG[MODULE_ID].alphaThreshold ) return this.tilesOcclude(rayOrigin, rayDirection, tiles);
    const pxThreshold = 255 * CONFIG[MODULE_ID].alphaThreshold;

    for ( const tile of tiles ) {
      const quad = tile[MODULE_ID][AbstractPolygonTrianglesID].alphaQuad3d;
      const t = quad.intersectionT(rayOrigin, rayDirection);
      if ( t === null || !t.between(0, 1, false) ) continue;

      // Check if the intersection is transparent.
      rayOrigin.add(rayDirection.multiplyScalar(t, tmpIx), tmpIx);
      const px = tile.evPixelCache.pixelAtCanvas(tmpIx.x, tmpIx.y);
      if ( px > pxThreshold ) return true;
    }
    return false;
  }

  tokensOcclude(rayOrigin, rayDirection, tokens) {
    // TODO: Would it be more performant to split out rectangular tokens and test quads separately? Or all non-custom tokens?
    //       Could test top/bottom only as needed.
    for ( const token of tokens ) {
      for ( const tri of token[MODULE_ID][AbstractPolygonTrianglesID].triangles ) {
        if ( tri.isFacing(rayOrigin) ) {
          const t = CONFIG.GeometryLib.threeD.Plane.rayIntersectionTriangle3d(rayOrigin, rayDirection, tri.a, tri.b, tri.c);
          if ( t !== null && t.between(0, 1, false) ) return true;
        }
      }
    }
    return false;
  }

  regionsOcclude(rayOrigin, rayDirection, regions) {
    for ( const region of regions ) {
      const handler = region[MODULE_ID][AbstractPolygonTrianglesID];
      const { topZ, bottomZ, rampFloor } = regionElevation(region);
      const testTop = rayOrigin > (rampFloor ?? topZ) && rayDirection.z < 0; // Ray above region top, moving down.
      const testBottom = rayOrigin < bottomZ && rayDirection.z > 0; // Ray below region bottom, moving up.
      const ixTB = testTop ? handler.topPlane.rayIntersection(rayOrigin, rayDirection)
        : testBottom ? handler.bottomPlane.rayIntersection(rayOrigin, rayDirection)
          : null;

      let containsTB = 0;
      for ( const shape of region.shapes ) {
        // If the point is contained by more shapes than holes, it must intersect a non-hole.
        // Example: Rect contains ellipse hole that contains circle. If in circle, than +2 - 1 = 1. If in ellipses, +1 -1 = 0.
        if ( ixTB && handler.shapesPixi.get(shape).contains(ixTB.x, ixTB.y) ) containsTB += (1 * (-1 * shape.data.hole));

        // Construct sides and test. Sides of a hole still block, so can treat all shapes equally.
        // A side is a vertical quad; basically a wall.
        // Check if facing.
        for ( const quad of handler.shapesSides.get(shape) ) {
          if ( !quad.isFacing(rayOrigin) ) continue;
          const t = quad.intersectionT(rayOrigin, rayDirection);
          if ( t !== null && t.between(0, 1, false) ) return true;
        }
      }
      if ( containsTB > 0 ) return true;
    }
    return false;
  }


  /* ----- NOTE: Pixel Indexing ----- */

  static setPixel(pixels, x, y, scale, arr) {
    const offset = this.pixelIndex(x + scale, y + scale, scale * 2);
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

  static drawPixels(pixels, scale) {
    const width = scale * 2;
    for ( let i = 0; i < pixels.length; i += 4 ) {
      const px = pixels.subarray(i, i + 3);
      const color = parseInt(this.rgbToHex(px[0], px[1], px[2]), 16);
      const coords = this.pixelCoordinates(i, width);
      CONFIG.GeometryLib.Draw.point({ x: coords.x - scale, y: coords.y - scale }, { radius: 1, color })
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

  pixels = new Uint8Array(((this.constructor.DEBUG_SCALE * 2) ** 2) * 4)

  #fragmentColor = new Point3d();

  containingTris = new Set();

  static DEBUG_SCALE = 50;

  countTargetPixelsDebug() {
    this.pixels.fill(0);
    this.containingTris.clear();

    this.counts.fill(0);
    const ndcTris = this.transformTargetToNDC();
    const viewerObstacles = this.locateViewerObstacles();
    let srcs = [];
    let srcObstacles = [];
    if ( this.config.useLitTargetShape ) {
      srcs = canvas[this.config.sourceType].placeables;
      srcObstacles = this.locateSourceObstacles();
    }
    const scale = this.constructor.DEBUG_SCALE;
    for ( let x = -scale; x < scale; x += 1 ) {
      for ( let y = -scale; y < scale; y += 1 ) {
        this._testPixelOcclusionDebug(x, y, ndcTris, viewerObstacles, srcs, srcObstacles);

        this.#fragmentColor.multiplyScalar(255, this.#fragmentColor);
        this.constructor.setPixel(this.pixels, x, y, this.config.scale, [...this.#fragmentColor, 255]);
      }
    }
  }

  _testPixelOcclusionDebug(x, y, ndcTris, viewerObstacles, srcs, srcObstacles) {
    // x = -x;
    // y = -y;
//     const tmp = x;
//     x = -y;
//     y = tmp;

    this.#fragmentColor.set(0, 0, 0);
    this.#gridPoint.set(x, y);
    const containingTri = this._locateFragmentTriangle(ndcTris, this.#gridPoint);
    if ( !containingTri ) return;

    // Determine where the fragment lies in 3d canvas space. Interpolate from the original triangle.
    this.containingTris.add(containingTri);
    this.counts[RED] += 1;

    // if ( containingTri === this.containingTris.first() ) { this.#fragmentColor.y = 1; }
    // return;
    if ( containingTri !== this.containingTris.first() ) return;

    const origTri = containingTri._original;
    containingTri._baryPoint.interpolatePoint(origTri.a, origTri.b, origTri.c, this.#fragmentPoint);

    const midZ = (Math.max(origTri.a.z, origTri.b.z, origTri.c.z) - Math.min(origTri.a.z, origTri.b.z, origTri.c.z)) / 2;
    if ( this.#fragmentPoint.z > midZ ) this.#fragmentColor.y = 1;
    else this.#fragmentColor.x = 1;
    return;


    this.#fragmentColor.x = 1;

    // Now we have a 3d point, compare to the viewpoint and lighting viewpoints to determine occlusion and bright/dim/dark
    // Is it occluded from the camera/viewer?
    this.#fragmentPoint.subtract(this.viewpoint, this.#rayDirection);
    if ( this.obstaclesOcclude(this.viewpoint, this.#rayDirection, viewerObstacles, this.config.senseType) ) {
      this.counts[OCCLUDED] += 1;
      this.#fragmentColor.z = 1; // Blue.
      this.#fragmentColor.x = 0; // Remove red.
      return;
    }

    // Fragment brightness for each source.
    if ( this.config.useLitTargetShape ) this._testPixelBrightnessDebug(origTri, srcs, srcObstacles);

  }

  #lightDirection = new Point3d();

  #reflectedLightColor = new Point3d();

  #specularLightColor = new Point3d();

  #ambientLightColor = new Point3d(0.2, 0.2, 0.2);

  #viewDirection = new Point3d();

  shininess = 100;

  _testPixelBrightnessDebug(origTri, srcs, srcObstacles) {
    const srcOrigin = this.#srcOrigin;
    const rayDirection = this.#rayDirection;
    const senseType = this.config.senseType;
    this.#reflectedLightColor.set(0, 0, 0);
    this.#specularLightColor.set(0, 0, 0);
    this.viewpoint.subtract(this.#fragmentPoint, this.#viewDirection); // Should be just the reverse of #rayDirection.

    let isBright = false;
    let isDim = false;
    const side = origTri.plane.whichSide(this.viewpoint);
    for ( let i = 0, iMax = srcs.length; i < iMax; i += 1 ) {
      const src = srcs[i];
      const obstacles = srcObstacles[i];
      Point3d.fromPointSource(src, srcOrigin);
      if ( (side * origTri.plane.whichSide(srcOrigin)) < 0 ) continue; // On opposite side of the triangle from the camera.
      const dist2 = Point3d.distanceSquaredBetween(this.#fragmentPoint, srcOrigin);
      if ( dist2 > (src.dimRadius ** 2) ) continue; // Not within source dim radius.

      // If blocked, then not bright or dim.
      this.#fragmentPoint.subtract(srcOrigin, rayDirection); // NOTE: Don't normalize so the wall test can use 0 < t < 1.
      if ( this.obstaclesOcclude(srcOrigin, rayDirection, obstacles, senseType) ) continue;

      // TODO: handle light/sound attenuation from threshold walls.
      isBright ||= (dist2 <= (src.brightRadius ** 2));
      isDim ||= isBright || (dist2 <= (src.dimRadius ** 2));

      // Don't break so we can add in color contributions from each light source to display in debugging.
      // if ( isBright ) break; // Once we know a fragment is bright, we should know the rest.
      if ( !(isBright || isDim) ) break;

      // Apply simplified point lighting to the fragment color.
      // See https://stackoverflow.com/questions/30594511/webgl-fragment-shader-for-multiple-light-sources

      // Reflected light from this source.
      const lightColor = Point3d._tmp1;
      const srcReflectedColor = Point3d._tmp2;

      srcOrigin.subtract(this.#fragmentPoint, this.#lightDirection).normalize(this.#lightDirection);
      const lightStrength = Math.max(origTri.plane.normal.dot(this.#lightDirection), 0) * (isDim ? 0.5 : 1.0);
      lightColor.set(...src.lightSource.colorRGB);
      lightColor.multiplyScalar(lightStrength, srcReflectedColor);
      this.#reflectedLightColor.add(srcReflectedColor, this.#reflectedLightColor);

      // Specular from this source.
      if ( lightStrength ) {
        const srcSpecularColor = Point3d._tmp2;
        const halfVector = Point3d._tmp3;

        this.#lightDirection.add(this.#viewDirection, halfVector).normalize(halfVector);
        const specularStrength = Math.pow(origTri.plane.normal.dot(halfVector), this.shininess);
        lightColor.multiplyScalar(specularStrength, srcSpecularColor);
        this.#specularLightColor.add(srcSpecularColor, this.#specularLightColor);
      }
    }
    this.counts[BRIGHT] += isBright;
    this.counts[DIM] += isDim;
    this.counts[DARK] += !(isBright || isDim);

    this.#fragmentColor.x = isBright ? 1 : isDim ? 0.75 : 0.25;

    // this.#fragmentColor
//       .add(this.#ambientLightColor, this.#fragmentColor)
//       .add(this.#reflectedLightColor, this.#fragmentColor)
//       .add(this.#specularLightColor, this.#fragmentColor);
  }


  #debugTexture;

  #debugSprite;

  /**
   * For debugging.
   * Draw the 3d objects in the popout.
   */
  _draw3dDebug(viewer, target, viewerLocation, targetLocation, { draw, container } = {}) {
    draw ??= new CONFIG.GeometryLib.Draw();

    // Set up container if necessary.
    if ( this.#debugTexture && this.#debugTexture.destroyed ) {
      this.#debugTexture = undefined;
      this.#debugSprite = undefined;
    }
    this.#debugTexture ??= PIXI.Texture.fromBuffer(this.pixels, this.constructor.DEBUG_SCALE * 2, this.constructor.DEBUG_SCALE * 2);
    if ( !this.#debugSprite ) {
      this.#debugSprite = new PIXI.Sprite(this.#debugTexture);
      container.addChild(this.#debugSprite);

      // Rotate the sprite to match expected view.
      // this.#debugSprite.anchor.set(0.5);
      // this.#debugSprite.rotation = Math.PI / 2; // 90º
      this.#debugSprite.position.set(-this.config.scale, -this.config.scale);

      container.sortableChildren = true;
      draw.g.zIndex = 10;
    }

    // Reset as needed.
    this.viewer = viewer;
    this.target = target;
    this.viewpoint = viewerLocation;
    this.targetLocation = targetLocation;

    this.camera.cameraPosition = viewerLocation;
    this.camera.targetPosition = targetLocation;
    this.camera.setTargetTokenFrustum(target);

    // Recalculate, using debug.
    this.countTargetPixelsDebug();

    // Update the texture; the underlying buffer should remain the same as we did not change the typed array.
    this.#debugTexture.update();

    // Draw the triangle outlines.
    this.containingTris.forEach(tri => tri.draw2d({ color: Draw.COLORS.green, alpha: 0.75, draw }));
  }
}

export class DebugVisibilityViewerPerPixel extends DebugVisibilityViewerArea3dPIXI {
  static viewpointClass = PerPixelViewpoint;

  algorithm = Settings.KEYS.LOS.TARGET.TYPES.PER_PIXEL;
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
