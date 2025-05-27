/* globals
canvas,
CONST,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// BBEdit notes: mark, fixme, fi-me, note, nyi, review, todo, to-do, xxx, ???, !!!
// TODO: todo
// FIXME: fixme!
// REVIEW: review
// !!!: exclamation
// NYI: nyi
// MARK: mark
// NOTE: note
// XXX xs
// ???: questions


import { GeometryDesc } from "./GeometryDesc.js";

/**
 * Describe a square cube (token) by its vertices, normals, and uvs.
 * By default, 1x1 token centered at origin 0,0,0.
 */
export class GeometryCubeDesc extends GeometryDesc {
  /** @type {string} */
  label = "Cube";

  /**
   * Define the vertices and optional indices for this geometry.
   * @param {object} [opts]
   * @param {number} [opts.w]           Width of the token (in x direction)
   * @param {number} [opts.d]           Depth of the token (in y direction)
   * @param {number} [opts.h]           Height of token (in z direction)
   * @param {number} [opts.x]           Location on -axis
   * @param {number} [opts.y]           Location on -axis
   * @param {number} [opts.z]           Location on -axis
   */
  static defineVertices({ w, d, h } = {}) {
//     const indices = [
//       0, 1, 2, 3, 0, 2,        // S facing 0–3
//       4, 5, 6, 4, 6, 7,        // N facing 4–7
//       8, 9, 10, 11, 8, 10,     // W facing 8–11
//       12, 13, 14, 12, 14, 15,  // E facing 12–15
//       16, 17, 18, 19, 16, 18,  // Top 16–19
//       20, 21, 22, 20, 22, 23,  // Bottom 20–23
//     ];

    return [
      // Position    Normal   UV
      // Side CCW if token goes from -w to w.
      // S facing
      w, d, h,  0, 1, 0,  1, 0, // a, e    0
      -w, d, h,  0, 1, 0,  0, 0, // b       1
      -w, d, -h,  0, 1, 0,  0, 1, // c, f    2
      w, d, -h,  0, 1, 0,  1, 1, // d       3

      w, d, h,  0, 1, 0,  1, 0, // a, e    0
      -w, d, -h,  0, 1, 0,  0, 1, // c, f    2

      // N facing: reverse of South. c,b,a,f,e,d
      -w, -d, -h,  0, -1, 0,  1, 1, // c, f   4
      -w, -d, h,  0, -1, 0,  1, 0, // b      5
      w, -d, h,  0, -1, 0,  0, 0, // a, e   6

      -w, -d, -h,  0, -1, 0,  1, 1, // c, f   4
      w, -d, h,  0, -1, 0,  0, 0, // a, e   6

      w, -d, -h,  0, -1, 0,  0, 1, // d      7

      // W facing
      -w, d, h,  -1, 0, 0,  1, 0, // a, e   8
      -w, -d, h,  -1, 0, 0,  0, 0, // b      9
      -w, -d, -h,  -1, 0, 0,  0, 1, // c, f   10
      -w, d, -h,  -1, 0, 0,  1, 1, // d      11

      -w, d, h,  -1, 0, 0,  1, 0, // a, e   8
      -w, -d, -h,  -1, 0, 0,  0, 1, // c, f   10

      // E facing: reverse of West c,b,a,f,e,d
      w, -d, -h,  1, 0, 0,  1, 1, // c, f     12
      w, -d, h,  1, 0, 0,  1, 0, // b        13
      w, d, h,  1, 0, 0,  0, 0, // a, e     14

      w, -d, -h,  1, 0, 0,  1, 1, // c, f     12
      w, d, h,  1, 0, 0,  0, 0, // a, e     14

      w, d, -h,  1, 0, 0,  0, 1, // d        15

      // Top
      -w, -d, h,  0, 0, 1,   0, 0,  // a, e   16
      -w, d, h,  0, 0, 1,   0, 1,  // b      17
      w, d, h,  0, 0, 1,   1, 1,  // c, f   18
      w, -d, h,  0, 0, 1,   1, 0,  // d      19

      -w, -d, h,  0, 0, 1,   0, 0,  // a, e   16
      w, d, h,  0, 0, 1,   1, 1,  // c, f   18

      // Bottom: reverse of Top c,b,a,f,e,d
      w, d, -h,  0, 0, -1,  1, 0,  // c, f   20
      -w, d, -h,  0, 0, -1,  0, 0,  // b      21
      -w, -d, -h,  0, 0, -1,  0, 1,  // a, e   22

      w, d, -h,  0, 0, -1,  1, 0,  // c, f   20
      -w, -d, -h,  0, 0, -1,  0, 1,  // a, e   22

      w, -d, -h,  0, 0, -1,  1, 1,  // d      23
    ];
  }
}

export class GeometryTokenDesc extends GeometryDesc {
  /** @type {string} */
  label = "Token";

  /** @type {Token} */
  token;

  static defineVertices({ token, w, d, h, r, R } = {}) {
    if ( shape instanceof PIXI.Rectangle ) {
      this.label += " Cube";
      return GeometryCubeDesc.defineVertices({ w, d, h });
    }
    if ( !(shape instanceof PIXI.Polygon) ) console.error("Token shape not recognized", shape);

    if ( token.document.width === 1 && token.document.height === 1 ) {
      this.label += " Hex";
      const GT = CONST.GRID_TYPES;
      switch ( canvas.grid.type ) {
        case GT.HEXEVENQ:
        case GT.HEXODDQ: return GeometryHexColumnDesc.defineVertices({ r, R });
        case GT.HEXEVENR:
        case GT.HEXODDR: return GeometryHexRowDesc.defineVertices({ r, R });
      }
    }

    // Center the shape.
    // Shrink to unit size 1.
    const ctr = token.center;
    const bounds = token.bounds;
    const minD = Math.min(bounds.width, bounds.height); // Token with size = 1 has min bounds equal to canvas.scene.dimensions.size
    const shape = token.getShape()
      .translateScale({ dx: token.x - ctr.x, dy: token.y - ctr.y, scaleX: 1/minD, scaleY: 1/minD });
    const topZ = 0.5 * h;
    const bottomZ = -0.5 * h;
    return this.define3dPolygonVertices(poly, { topZ, bottomZ });
  }
}

export class GeometryHexTokenShapesDesc extends GeometryDesc {
  /** @type {string} */
  label = "Hex Token Shapes";

  /**
   * Get the hexagonal shape given the type, width, and height.
   * @param {number} hexagonalShape   The hexagonal shape (one of {@link CONST.TOKEN_HEXAGONAL_SHAPES})
   * @param {number} width       The width of the Token (positive) (should be 0.5, 1, 2, etc.)
   * @param {number} height      The height of the Token (positive) (should be 0.5, 1, 2, etc.)
   */
  static defineVertices({ width, height, hexagonalShape, h, ...opts } = {}) {
    if ( width === 1 && height === 1 ) {
      const cl = canvas.scene.grid.columns ? GeometryHexColumnDesc : GeometryHexRowDesc;
      return cl.defineVertices(opts);
    }
    const res = this.getHexagonalShape(canvas.scene.grid.columns, hexagonalShape, width, height);

    // Recenter to 0,0.
    // Shrink to unit size 1.
    const scale = 1 / Math.max(width, height);
    const poly = (new PIXI.Polygon(res.shape)).translateScale({ dx: -res.center.x, dy: -res.center.y, scaleX: scale, scaleY: scale });
    h ??= Math.max(width, height);
    const topX = 0.5 * h;
    const bottomZ = -0.5 * h;
    return this.define3dPolygonVertices(poly, { topZ, bottomZ });
  }

  /**
   * The cache of hexagonal shapes.
   * @type {Map<string, DeepReadonly<TokenHexagonalShape>>}
   */
  static #hexagonalShapes = new Map();

  // Taken from foundry.js Token.#getHexagonalShape.
  /**
   * Get the hexagonal shape given the type, width, and height.
   * @param {boolean} columns    Column-based instead of row-based hexagonal grid?
   * @param {number} type        The hexagonal shape (one of {@link CONST.TOKEN_HEXAGONAL_SHAPES})
   * @param {number} width       The width of the Token (positive)
   * @param {number} height      The height of the Token (positive)
   * @returns {DeepReadonly<TokenHexagonalShape>|null}    The hexagonal shape or null if there is no shape
   *                                                      for the given combination of arguments
   */
  static getHexagonalShape(columns, type, width, height) {
    if ( !Number.isInteger(width * 2) || !Number.isInteger(height * 2) ) return null;
    const key = `${columns ? "C" : "R"},${type},${width},${height}`;
    let shape = this.#hexagonalShapes.get(key);
    if ( shape ) return shape;
    const T = CONST.TOKEN_HEXAGONAL_SHAPES;
    const M = CONST.GRID_SNAPPING_MODES;

    // Hexagon symmetry
    if ( columns ) {
      const rowShape = this.getHexagonalShape(false, type, height, width);
      if ( !rowShape ) return null;

      // Transpose and reverse the points of the shape in row orientation
      const points = [];
      for ( let i = rowShape.points.length; i > 0; i -= 2 ) {
        points.push(rowShape.points[i - 1], rowShape.points[i - 2]);
      }
      shape = {
        points,
        center: {x: rowShape.center.y, y: rowShape.center.x},
        snapping: {
          behavior: rowShape.snapping.behavior,
          anchor: {x: rowShape.snapping.anchor.y, y: rowShape.snapping.anchor.x}
        }
      };
    }

    // Small hexagon
    else if ( (width === 0.5) && (height === 0.5) ) {
      shape = {
        points: [0.25, 0.0, 0.5, 0.125, 0.5, 0.375, 0.25, 0.5, 0.0, 0.375, 0.0, 0.125],
        center: {x: 0.25, y: 0.25},
        snapping: {behavior: {mode: M.CENTER, resolution: 1}, anchor: {x: 0.25, y: 0.25}}
      };
    }

    // Normal hexagon
    else if ( (width === 1) && (height === 1) ) {
      shape = {
        points: [0.5, 0.0, 1.0, 0.25, 1, 0.75, 0.5, 1.0, 0.0, 0.75, 0.0, 0.25],
        center: {x: 0.5, y: 0.5},
        snapping: {behavior: {mode: M.TOP_LEFT_CORNER, resolution: 1}, anchor: {x: 0.0, y: 0.0}}
      };
    }

    // Hexagonal ellipse or trapezoid
    else if ( type <= T.TRAPEZOID_2 ) {
      shape = this.#createHexagonalEllipseOrTrapezoid(type, width, height);
    }

    // Hexagonal rectangle
    else if ( type <= T.RECTANGLE_2 ) {
      shape = this.#createHexagonalRectangle(type, width, height);
    }

    // Cache the shape
    if ( shape ) {
      Object.freeze(shape);
      Object.freeze(shape.points);
      Object.freeze(shape.center);
      Object.freeze(shape.snapping);
      Object.freeze(shape.snapping.behavior);
      Object.freeze(shape.snapping.anchor);
      this.#hexagonalShapes.set(key, shape);
    }
    return shape;
  }

  /**
   * Create the row-based hexagonal ellipse/trapezoid given the type, width, and height.
   * @param {number} type                   The shape type (must be ELLIPSE_1, ELLIPSE_1, TRAPEZOID_1, or TRAPEZOID_2)
   * @param {number} width                  The width of the Token (positive)
   * @param {number} height                 The height of the Token (positive)
   * @returns {TokenHexagonalShape|null}    The hexagonal shape or null if there is no shape
   *                                        for the given combination of arguments
   */
  static #createHexagonalEllipseOrTrapezoid(type, width, height) {
    if ( !Number.isInteger(width) || !Number.isInteger(height) ) return null;
    const T = CONST.TOKEN_HEXAGONAL_SHAPES;
    const M = CONST.GRID_SNAPPING_MODES;
    const points = [];
    let top;
    let bottom;
    switch ( type ) {
      case T.ELLIPSE_1:
        if ( height >= 2 * width ) return null;
        top = Math.floor(height / 2);
        bottom = Math.floor((height - 1) / 2);
        break;
      case T.ELLIPSE_2:
        if ( height >= 2 * width ) return null;
        top = Math.floor((height - 1) / 2);
        bottom = Math.floor(height / 2);
        break;
      case T.TRAPEZOID_1:
        if ( height > width ) return null;
        top = height - 1;
        bottom = 0;
        break;
      case T.TRAPEZOID_2:
        if ( height > width ) return null;
        top = 0;
        bottom = height - 1;
        break;
    }
    let x = 0.5 * bottom;
    let y = 0.25;
    for ( let k = width - bottom; k--; ) {
      points.push(x, y);
      x += 0.5;
      y -= 0.25;
      points.push(x, y);
      x += 0.5;
      y += 0.25;
    }
    points.push(x, y);
    for ( let k = bottom; k--; ) {
      y += 0.5;
      points.push(x, y);
      x += 0.5;
      y += 0.25;
      points.push(x, y);
    }
    y += 0.5;
    for ( let k = top; k--; ) {
      points.push(x, y);
      x -= 0.5;
      y += 0.25;
      points.push(x, y);
      y += 0.5;
    }
    for ( let k = width - top; k--; ) {
      points.push(x, y);
      x -= 0.5;
      y += 0.25;
      points.push(x, y);
      x -= 0.5;
      y -= 0.25;
    }
    points.push(x, y);
    for ( let k = top; k--; ) {
      y -= 0.5;
      points.push(x, y);
      x -= 0.5;
      y -= 0.25;
      points.push(x, y);
    }
    y -= 0.5;
    for ( let k = bottom; k--; ) {
      points.push(x, y);
      x += 0.5;
      y -= 0.25;
      points.push(x, y);
      y -= 0.5;
    }
    return {
      points,
      // We use the centroid of the polygon for ellipse and trapzoid shapes
      center: foundry.utils.polygonCentroid(points),
      snapping: {
        behavior: {mode: bottom % 2 ? M.BOTTOM_RIGHT_VERTEX : M.TOP_LEFT_CORNER, resolution: 1},
        anchor: {x: 0.0, y: 0.0}
      }
    };
  }

  /**
   * Create the row-based hexagonal rectangle given the type, width, and height.
   * @param {number} type                   The shape type (must be RECTANGLE_1 or RECTANGLE_2)
   * @param {number} width                  The width of the Token (positive)
   * @param {number} height                 The height of the Token (positive)
   * @returns {TokenHexagonalShape|null}    The hexagonal shape or null if there is no shape
   *                                        for the given combination of arguments
   */
  static #createHexagonalRectangle(type, width, height) {
    if ( (width < 1) || !Number.isInteger(height) ) return null;
    if ( (width === 1) && (height > 1) ) return null;
    if ( !Number.isInteger(width) && (height === 1) ) return null;
    const T = CONST.TOKEN_HEXAGONAL_SHAPES;
    const M = CONST.GRID_SNAPPING_MODES;
    const even = (type === T.RECTANGLE_1) || (height === 1);
    let x = even ? 0.0 : 0.5;
    let y = 0.25;
    const points = [x, y];
    while ( x + 1 <= width ) {
      x += 0.5;
      y -= 0.25;
      points.push(x, y);
      x += 0.5;
      y += 0.25;
      points.push(x, y);
    }
    if ( x !== width ) {
      y += 0.5;
      points.push(x, y);
      x += 0.5;
      y += 0.25;
      points.push(x, y);
    }
    while ( y + 1.5 <= 0.75 * height ) {
      y += 0.5;
      points.push(x, y);
      x -= 0.5;
      y += 0.25;
      points.push(x, y);
      y += 0.5;
      points.push(x, y);
      x += 0.5;
      y += 0.25;
      points.push(x, y);
    }
    if ( y + 0.75 < 0.75 * height ) {
      y += 0.5;
      points.push(x, y);
      x -= 0.5;
      y += 0.25;
      points.push(x, y);
    }
    y += 0.5;
    points.push(x, y);
    while ( x - 1 >= 0 ) {
      x -= 0.5;
      y += 0.25;
      points.push(x, y);
      x -= 0.5;
      y -= 0.25;
      points.push(x, y);
    }
    if ( x !== 0 ) {
      y -= 0.5;
      points.push(x, y);
      x -= 0.5;
      y -= 0.25;
      points.push(x, y);
    }
    while ( y - 1.5 > 0 ) {
      y -= 0.5;
      points.push(x, y);
      x += 0.5;
      y -= 0.25;
      points.push(x, y);
      y -= 0.5;
      points.push(x, y);
      x -= 0.5;
      y -= 0.25;
      points.push(x, y);
    }
    if ( y - 0.75 > 0 ) {
      y -= 0.5;
      points.push(x, y);
      x += 0.5;
      y -= 0.25;
      points.push(x, y);
    }
    return {
      points,
      // We use center of the rectangle (and not the centroid of the polygon) for the rectangle shapes
      center: {
        x: width / 2,
        y: ((0.75 * Math.floor(height)) + (0.5 * (height % 1)) + 0.25) / 2
      },
      snapping: {
        behavior: {mode: even ? M.TOP_LEFT_CORNER : M.BOTTOM_RIGHT_VERTEX, resolution: 1},
        anchor: {x: 0.0, y: 0.0}
      }
    };
  }

}


/**
 * Construct vertices for a token shape that is constrained.
 * Unlike GeometryCubeDesc, this constructs a token in world space.
 * Constructor options must include token.
 */
export class GeometryConstrainedTokenDesc extends GeometryDesc {
  /** @type {string} */
  label = "Constrained Token";

  /** @type {Token} */
  token;

  static defineVertices({ token, border } = {}) {
    // Set the token border to center at 0,0,0 to match handling of other geometries.
    // Then pass through the token position to translate it back.
    border ??= token.constrainedTokenBorder || token.tokenBorder;
    const { topZ, bottomZ } = token;
    if ( border instanceof PIXI.Rectangle ) {
      this.label += " Cube"
      // Divide in half to center at 0,0, with half on +, half on -
      const w = border.width * 0.5;
      const d = border.height * 0.5;
      const h = (topZ - bottomZ) * 0.5
      return GeometryCubeDesc.defineVertices({ w, d, h });
    }
    const { x, y, z } = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
    const txBorder = border.translate(-x, -y, -z);
    return this.define3dPolygonVertices(border, { topZ, bottomZ });
  }

  // Override x,y,z to translate the token object to world space.
  // Can be overriden by passing specific x,y,z opts that are not 0.
  _defineVerticesAndIndices(opts) {
    const token = opts.token;
    const { x, y, z } = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
    opts.x ||= x;
    opts.y ||= y;
    opts.z ||= z;
    return super._defineVerticesAndIndices(opts);
  }
}

/**
 * Construct vertices for a lit token shape
 * Unlike GeometryCubeDesc, this constructs a token in world space.
 * Constructor options must include token.
 */
export class GeometryLitTokenDesc extends GeometryConstrainedTokenDesc {
  /** @type {string} */
  label = "Lit Token";

  static defineVertices(opts = {}) {
    opts.border ??= opts.token.litTokenBorder || opts.token.constrainedTokenBorder || opts.token.tokenBorder;
    return super.defineVertices(opts);
  }
}


/**
 * Describe a row hexagon by its vertices, normals, and uvs.
 * By default, hex centered at origin 0,0,0.
 * See https://en.wikipedia.org/wiki/Hexagon
 * Maximum circumradius of 0.5, so diameter of 1 and side length of 0.5.
 * Minimal diameter is twice the inradius.
 * r = SQRT3 / 2 * R
 */
export class GeometryHexRowDesc extends GeometryDesc {
  /** @type {string} */
  label = "HexRow"

  /**
   * Define the vertices and optional indices for this geometry.
   * @param {object} [opts]
   * @param {number} [opts.R]           Length of the circumradius
   * @param {number} [opts.r]           Length of the inradius
   * @param {number} [opts.h]           Height
   */
  static defineVertices({ r, R, h } = {}) {
/*
R = 0.5
r = sqrt(3) / 2 * R
yLen = R^2 - r^2 = 1 - sqrt(r)

T:  0.0, -R
B:  0.0, R
TR: r, -yLen
BR: r, yLen
TL: -r, -yLen
BL: -r, yLen

       T
     /  \
    /    \
  TL      TR
  |       |
  |       |
  BL      BR
   \     /
    \   /
      B
*/

    R ??= 0.5;
    r ??= (Math.SQRT3 / 2) * R;
    const yLen = Math.pow(R, 2) - Math.pow(r, 2);
    const topZ = h * 0.5;
    const bottomZ = h * -0.5;
    const pts = [
      { x: 0.0, y: -R },    // T
      { x: -r, y: -yLen },  // TL
      { x: -r, y: yLen },   // BL
      { x: 0.0, y: R },     // B
      { x: r, y: yLen },    // BR
      { x: r, y: -yLen },   // TR
    ];

    // Save a bit of processing by setting the top and bottom here (avoids using earcut).
    // Set UVs to the coordinate within the bounding box.
    const { top, bottom, poly } = defineHexPolygonTopBottom(pts, topZ, bottomZ)
    return this.define3dPolygonVertices(poly, { topZ, bottomZ, top, bottom });
  }
}

/**
 * Describe a row hexagon by its vertices, normals, and uvs.
 * By default, hex centered at origin 0,0,0.
 * See https://en.wikipedia.org/wiki/Hexagon
 * Maximum circumradius of 0.5, so diameter of 1 and side length of 0.5.
 * Minimal diameter is twice the inradius.
 * r = SQRT3 / 2 * R
 */
export class GeometryHexColumnDesc extends GeometryDesc {
  /** @type {string} */
  label = "HexColumn"

  /**
   * Define the vertices and optional indices for this geometry.
   * @param {object} [opts]
   * @param {number} [opts.R]           Length of the circumradius
   * @param {number} [opts.r]           Length of the inradius
   * @param {number} [opts.h]           Height
   */
  static defineVertices({ r, R, h } = {}) {
/*
R = 0.5
r = sqrt(3) / 2 * R
yLen = R^2 - r^2 = 1 - sqrt(r)

T:  0.0, -R
B:  0.0, R
TR: r, -yLen
BR: r, yLen
TL: -r, -yLen
BL: -r, yLen
      TL-----TR
     /         \
    /           \
   /             \
  L               R
   \             /
    \           /
     \         /
      BL-----BR
*/

    R ??= 0.5;
    r ??= (Math.SQRT3 / 2) * R;
    h ??= 1;
    const xLen = Math.pow(R, 2) - Math.pow(r, 2);
    const topZ = h * 0.5;
    const bottomZ = h * -0.5;
    const pts = [
      { x: -xLen, y: -r },   // TL
      { x: -R, y: 0.0 },    // L
      { x: -xLen, y: r },   // BL
      { x: xLen, y: r },    // BR
      { x: R, y: 0.0 },     // R
      { x: xLen, y: -r },   // TR
    ];

    // Save a bit of processing by setting the top and bottom here (avoids using earcut).
    // Set UVs to the coordinate within the bounding box.
    const { top, bottom, poly } = defineHexPolygonTopBottom(pts, topZ, bottomZ)
    return this.define3dPolygonVertices(poly, { topZ, bottomZ, top, bottom });
  }
}

function defineHexPolygonTopBottom(pts, topZ, bottomZ) {
  const poly = new PIXI.Polygon(...pts);
  const bounds = poly.getBounds();
  const uOrig = x => (x - bounds.x) / bounds.width;
  const vOrig = y => (y - bounds.y) / bounds.height;

  // Make each a triangle centered at 0.0
  // Results in 6 triangles instead of 4 but is nicely centered and easy to do.
  const top = [];
  const bottom = [];
  for ( let i = 0, j = 1; i < 6; i += 1, j += 1 ) {
    const k = j % 6;
    const { x: xi, y: yi } = pts[i];
    const { x: xk, y: yk } = pts[k];
    top.push(
      // Position         Normal      UV
      xi, yi, topZ,       0, 0, 1,    uOrig(xi), vOrig(yi),
      xk, yk, topZ,       0, 0, 1,    uOrig(xk), vOrig(yk),
      0.0, 0.0, topZ,     0, 0, 1,    0.5, 0.5,
    );

    bottom.push(
      // Position         Normal      UV
      xi, yi, bottomZ,    0, 0, -1,   uOrig(xi), vOrig(yi),
      xk, yk, bottomZ,    0, 0, -1,   uOrig(xk), vOrig(yk),
      0.0, 0.0, bottomZ,  0, 0, -1,   0.5, 0.5,
    );
  }
  return { top, bottom }
}

/**
 * Describe the current grid shape as 3d, centered at origin 0,0,0
 */
export class GeometryGridDesc extends GeometryDesc {
  /** @type {string} */
  label = "GridShape"

  /**
   * Define the vertices and optional indices for this geometry.
   * @param {object} [opts]
   * @param {number} [opts.R]           Length of the circumradius
   * @param {number} [opts.r]           Length of the inradius
   * @param {number} [opts.h]           Height
   */
  static defineVertices() {
    const poly = new PIXI.Polygon(...canvas.grid.getShape());
    const topZ = canvas.grid.size * 0.5;
    const bottomZ = canvas.grid.size * -0.5;
    return this.define3dPolygonVertices(poly, { topZ, bottomZ });
  }
}

// Centered on token.
export class GeometryGridFromTokenDesc extends GeometryConstrainedTokenDesc {
  /** @type {string} */
  label = "GridShape from Token"

  /**
   * Define the vertices and optional indices for this geometry.
   * @param {object} [opts]
   * @param {number} [opts.R]           Length of the circumradius
   * @param {number} [opts.r]           Length of the inradius
   * @param {number} [opts.h]           Height
   */
  static defineVertices({ token }) {
    let poly = new PIXI.Polygon(...canvas.grid.getShape());
    const ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
    poly = poly.translate(...ctr)
    const topZ = canvas.grid.size * 0.5 + ctr.z;
    const bottomZ = canvas.grid.size * -0.5 + ctr.z;
    return this.define3dPolygonVertices(poly, { topZ, bottomZ });
  }
}


/* Test for normal
Point3d = CONFIG.GeometryLib.threeD.Point3d
poly = target.constrainedTokenBorder
geom = GeometryConstrainedTokenDesc.polygonTopVertices(poly, { flip: false })

tris = [];
Ns = [];
orientations = [];
vs = geom.vertices;
for ( let i = 0; i < geom.indices.length; i += 3 ) {
  let j = geom.indices[i] * 8;
  const a = new Point3d(vs[j], vs[j + 1], vs[j + 2])

  j = geom.indices[i+1] * 8;
  const b = new Point3d(vs[j], vs[j + 1], vs[j + 2])

  j = geom.indices[i+2] * 8;
  const c = new Point3d(vs[j], vs[j + 1], vs[j + 2])

  tris.push([a, b, c]);

  deltaAB = b.subtract(a)
  deltaAC = c.subtract(a)
  Ns.push(deltaAB.cross(deltaAC).normalize())
  orientations.push(foundry.utils.orient2dFast(a, b, c));
}

tris.forEach(tri => Draw.connectPoints(tri))
tris.forEach(tri => tri.forEach(pt => Draw.point(pt, { radius: 2 })))


*/


/*

w = 0.5;
d = 0.5
h = 0.5;

x = 0
y = 0
z = 0

const indices = [
  0, 1, 2, 3, 0, 2,        // S facing 0–3
  4, 5, 6, 4, 6, 7,        // N facing 4–7
  8, 9, 10, 11, 8, 10,     // W facing 8–11
  12, 13, 14, 12, 14, 15,  // E facing 12–15
  16, 17, 18, 19, 16, 18,  // Top 16–19
  20, 21, 22, 20, 22, 23,  // Bottom 20–23
];

arr = [
  // Position     Normal     UV
  // Side CCW if token goes from -w to w.
  // S facing
  w, d, h,  0, 1, 0,  1, 0, // a, e    0
  -w, d, h,  0, 1, 0,  0, 0, // b       1
  -w, d, -h,  0, 1, 0,  0, 1, // c, f    2
  w, d, -h,  0, 1, 0,  1, 1, // d       3

  w, d, h,  0, 1, 0,  1, 0, // a, e    0
  -w, d, -h,  0, 1, 0,  0, 1, // c, f    2


  // N facing: reverse of South. c,b,a,f,e,d
  -w, -d, -h,  0, -1, 0,  1, 1, // c, f   4
  -w, -d, h,  0, -1, 0,  1, 0, // b      5
  w, -d, h,  0, -1, 0,  0, 0, // a, e   6

  -w, -d, -h,  0, -1, 0,  1, 1, // c, f   4
  w, -d, h,  0, -1, 0,  0, 0, // a, e   6

  w, -d, -h,  0, -1, 0,  0, 1, // d      7

  // W facing
  -w, d, h,  -1, 0, 0,  1, 0, // a, e   8
  -w, -d, h,  -1, 0, 0,  0, 0, // b      9
  -w, -d, -h,  -1, 0, 0,  0, 1, // c, f   10
  -w, d, -h,  -1, 0, 0,  1, 1, // d      11

  -w, d, h,  -1, 0, 0,  1, 0, // a, e   8
  -w, -d, -h,  -1, 0, 0,  0, 1, // c, f   10


  // E facing: reverse of West c,b,a,f,e,d
  w, -d, -h,  1, 0, 0,  1, 1, // c, f     12
  w, -d, h,  1, 0, 0,  1, 0, // b        13
  w, d, h,  1, 0, 0,  0, 0, // a, e     14

  w, -d, -h,  1, 0, 0,  1, 1, // c, f     12
  w, d, h,  1, 0, 0,  0, 0, // a, e     14

  w, d, -h,  1, 0, 0,  0, 1, // d        15

  // Top
  -w, -d, h,  0, 0, 1,   0, 0,  // a, e   16
  -w, d, h,  0, 0, 1,   0, 1,  // b      17
  w, d, h,  0, 0, 1,   1, 1,  // c, f   18
  w, -d, h,  0, 0, 1,   1, 0,  // d      19

  -w, -d, h,  0, 0, 1,   0, 0,  // a, e   16
  w, d, h,  0, 0, 1,   1, 1,  // c, f   18

  // Bottom: reverse of Top c,b,a,f,e,d
  w, d, -h,  0, 0, -1,  1, 0,  // c, f   20
  -w, d, -h,  0, 0, -1,  0, 0,  // b      21
  -w, -d, -h,  0, 0, -1,  0, 1,  // a, e   22

  w, d, -h,  0, 0, -1,  1, 0,  // c, f   20
  -w, -d, -h,  0, 0, -1,  0, 1,  // a, e   22

  w, -d, -h,  0, 0, -1,  1, 1,  // d      23
];

// Convert to indices
stride = 8; // How many elements between vertices?
length = 8; // How many elements make up a vertex?

vertices = [];
indices = new Uint16Array(arr.length / stride);
uniqueV = new Map();
tmpKey = new Array(length)
for ( let i = 0, n = arr.length, v = 0; i < n; i += stride, v += 1 ) {
  for ( let j = 0; j < length; j += 1 ) tmpKey[j] = arr[i + j];
  const key = tmpKey.join("_");
  if ( !uniqueV.has(key) ) {
    uniqueV.set(key, uniqueV.size);
    vertices.push(...arr.slice(i, i + length))
  }
  indices[v] = uniqueV.get(key);
}

// Skip normals and uvs
length = 3


// Skip uvs
length = 6



*/



/*
Adapted from https://github.com/toji/webgpu-bundle-culling

MIT License

Copyright (c) 2023 Brandon Jones

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/