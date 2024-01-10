/* globals
canvas,
PIXI
*/
"use strict";

import { VerticalPoints3d } from "./VerticalPoints3d.js";
import { HorizontalPoints3d } from "./HorizontalPoints3d.js";

// Geometry folder
import { Point3d } from "../../geometry/3d/Point3d.js";
import { Draw } from "../../geometry/Draw.js";


export class TokenPoints3d {
  /** @type {Token} */
  token;

  /** @type {object} */
  config = {
    type: "sight",  /** @type {string} */
    pad: 0        /** @type {number} */
  };

  /* @type {boolean} */
  viewIsSet = false;

  /* @type {PIXI.Polygon} */
  borderPolygon;

  /** @type {HorizontalPoints3d} */
  bottomSide;

  /** @type {HorizontalPoints3d} */
  topSide;

  /** @type {VerticalPoints3d|HorizontalPoints3d[]} */
  faces = [];

  /** @type {Point3d} */
  viewingPoint = undefined;

  /**
   * @param {Token} token
   * @param {object} [options]
   * @param {string} [options.type]         Wall restriction type, for constructing the
   *                                        constrained token shape
   * @param {number} [options.pad]          How many pixels to add to (or subtract from)
   *                                        the token shape. See issue #49.
   * @param {PIXI.Polygon} [options.tokenBorder] The border of the token, if not the constrained token border
   */
  constructor(token, { type = "sight", pad = 0, tokenBorder } = {}) {
    this.token = token;
    this.config.type = type;
    this.config.pad = pad;
    this._setTokenBorder(tokenBorder);
    this._setTopBottomPoints();
  }

  /**
   * Determine the polygon representation of the token border.
   * @param {PIXI.Polygon} [tokenBorder] The border of the token, if not the constrained token border
   */
  _setTokenBorder(tokenBorder) {
    tokenBorder ??= this.token.constrainedTokenBorder;
    this.borderPolygon = tokenBorder instanceof PIXI.Rectangle
      ? tokenBorder.toPolygon() : tokenBorder;
    if ( this.config.pad ) this.borderPolygon = this.borderPolygon.pad(this.config.pad);
  }

  /**
   * Create the 3d top and bottom points for this token.
   */
  _setTopBottomPoints() {
    const points = this.borderPolygon.points;
    const { topZ, bottomZ } = this;

    const nPts = points.length * 0.5;
    const topPoints = Array(nPts);
    const bottomPoints = Array(nPts);
    for ( let i = 0, j = 0; i < nPts; i += 1, j += 2 ) {
      const x = points[j];
      const y = points[j + 1];
      topPoints[i] = new Point3d(x, y, topZ);
      bottomPoints[i] = new Point3d(x, y, bottomZ);
    }

    this.topSide = new HorizontalPoints3d(this.token, topPoints);
    this.bottomSide = new HorizontalPoints3d(this.token, bottomPoints);
  }

  /** @type {number} */
  get bottomZ() {
    return this.token.bottomZ;
  }

  /** @type {number} */
  get topZ() {
    const { topZ, bottomZ } = this.token;
    return topZ === bottomZ ? (topZ + 2) : topZ;
  }

  /**
   * Set the point from which this token is being viewed and construct the viewable faces.
   * Determines how many faces are visible.
   * @param {Point3d} viewingPoint
   */
  setViewingPoint(viewingPoint) {
    this.viewingPoint = viewingPoint;
    this.faces = this._viewableFaces(viewingPoint);
  }

  /**
   * Set the view matrix used to transform the faces and transform the faces.
   * @param {Matrix} M
   */
  setViewMatrix(M) {
    this.faces.forEach(f => f.setViewMatrix(M));
    this.viewIsSet = true;
  }

  /**
   * Get the top, bottom and sides viewable from a given 3d position in space.
   * @param {Point3d} viewingPoint
   * @returns {object}  Object with properties:
   *   {Points3d|undefined} top
   *   {Points3d|undefined} bottom
   *   {Points3d[]} sides
   */
  _viewableFaces(viewingPoint) {
    const sides = this._viewableSides(viewingPoint);
    const topBottom = this._viewableTopBottom(viewingPoint);
    if ( topBottom ) sides.push(topBottom);
    return sides;
  }

  /**
   * Return top or bottom face or null, depending on given 3d position in space
   * @param {Point3d} viewingPoint
   * @return {Points3d|null}
   */
  _viewableTopBottom(viewingPoint) {
    if ( viewingPoint.z > this.topZ ) return this.topSide;
    else if ( viewingPoint.z < this.bottomZ ) return this.bottomSide;
    return null;
  }

  /*
   * Transform the faces to a 2d perspective.
   * @returns {PIXI.Point[][]}
   */
  perspectiveTransform() {
    return this.faces.map(side => side.perspectiveTransform());
  }

  /**
   * Calculate all the vertical sides of the token
   * @returns {Point3d[][]} Array of sides, each containing 4 points.
   */
  _allSides() {
    const { topSide, bottomSide, token } = this;
    const topPoints = topSide.points;
    const bottomPoints = bottomSide.points;
    const nSides = topPoints.length;
    const sides = Array(nSides);

    let t0 = topPoints[nSides - 1];
    let b0 = bottomPoints[nSides - 1];
    for ( let i = 0; i < nSides; i += 1 ) {
      const t1 = topPoints[i];
      const b1 = bottomPoints[i];
      sides[i] = [t0, t1, b1, b0];
      t0 = t1;
      b0 = b1;
    }

    return sides.map(s => new VerticalPoints3d(token, s));
  }

  /**
   * Determine which edges of the token polygon are viewable in a 2d sense.
   * Viewable if the line between center and edge points is not blocked.
   * For now, this returns the points.
   * TODO: Depending on token shape, it may be faster to return indices and only keep the unique points.
   * @param {Point3d} viewingPoint
   * @returns {Point3d[][]} Array of sides, each containing 4 points.
   */
  _viewableSides(viewingPoint) {
    const { topSide, bottomSide, borderPolygon, token } = this;
    const topPoints = topSide.points;
    const bottomPoints = bottomSide.points;

    const keys = borderPolygon.viewablePoints(viewingPoint, { returnKeys: true });
    const nSides = keys.length - 1;
    const sides = Array(nSides);
    for ( let i = 0; i < nSides; i += 1 ) {
      const t0 = topPoints[keys[i]];
      const t1 = topPoints[keys[i+1]];
      const b0 = bottomPoints[keys[i]];
      const b1 = bottomPoints[keys[i+1]];
      sides[i] = [t0, t1, b1, b0];
    }

    return sides.map(s => new VerticalPoints3d(token, s));
  }

  /**
   * Draw the constrained token shape and the points on the 2d canvas.
   */
  draw(drawingOptions = {}) {
    const drawTool = drawingOptions.drawTool ?? new Draw();

    drawTool.shape(this.borderPolygon, drawingOptions);
    if ( this.viewingPoint ) drawTool.segment(
      { A: this.viewingPoint, B: this.token.center },
      { color: Draw.COLORS.blue, alpha: 0.5 });
    this.topSide.draw(drawingOptions);
  }

  /**
   * Draw the transformed faces.
   * @param {object} [options]
   * @param {boolean} [perspective]   Draw using 2d perspective.
   */
  drawTransformed(opts) {
    if ( !this.viewIsSet ) {
      console.warn(`TokenPoints3d: View is not yet set for Token ${this.token.name}.`);
      return;
    }

    this.faces.forEach(f => f.drawTransformed(opts));
  }
}

/**
 * Instead of using the full token size, this creates points for a grid-square-sized cube
 * centered on the token.
 */
export class UnitTokenPoints3d extends TokenPoints3d {
  #token;

  constructor(token, opts = {}) {
    const center = Point3d.fromTokenCenter(token);
    const size = canvas.dimensions.size;
    const size_1_2 = size * 0.5;

    let tokenBorder = canvas.grid.isHex
      ? new PIXI.Polygon(canvas.grid.grid.getBorderPolygon(1, 1, 0))
      : new PIXI.Rectangle(0, 0, size, size);
    tokenBorder = tokenBorder.translate(center.x - size_1_2, center.y - size_1_2);

    opts.tokenBorder = tokenBorder;
    const fakeToken = {
      topZ: center.z + size_1_2,
      bottomZ: center.z - size_1_2,
      center: token.center,
      name: token.name
    }

    super(fakeToken, opts);
    this.#token = token;
  }
}
