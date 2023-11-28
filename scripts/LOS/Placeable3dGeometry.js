/* globals
canvas,
glMatrix,
PIXI,
PolygonMesher
*/
"use strict";

import { Point3d } from "../geometry/3d/Point3d.js";

const vec3 = glMatrix.vec3;

class Placeable3dGeometry extends PIXI.Geometry {
  /** @type {PlaceableObject} */
  object;

  static NUM_VERTICES = 4;

  static colorVertices = [];

  static indices = [];

  constructor(object) {
    super();
    this.object = object;
    this.initializeObjectPoints();
    this.initializeVertices();
    this.initializeIndices();
    this.initializeColors(); // For debugging.
    this.updateVertices();
  }

  // Cache the object points
  objectPoints = [];

  /**
   * Build the set of 3d points used to frame the object.
   * Should be ordered so that outward faces are clockwise and consistent with indices.
   * @returns {Point3d[]}
   */
  constructObjectPoints() {
    console.error("Placeable3dGeometry|constructObjectPoints must be implemented by child class.");
  }

  initializeObjectPoints() { this.objectPoints = this.constructObjectPoints(); }

  // May be overriden by subclass to avoid building new Point3d.
  updateObjectPoints() { this.objectPoints = this.constructObjectPoints(); }

  initializeVertices() {
    this.addAttribute("aVertex", new Float32Array(this.constructor.NUM_VERTICES * 3));
  }

  updateVertices() {
    const objectVertices = this.objectPoints.map(pt => vec3.fromValues(pt.x, pt.y, pt.z));
    const buffer = this.getBuffer("aVertex");
    const data = buffer.data;
    objectVertices.forEach((v, idx) => data.set(v, idx * 3));
    buffer.update(data);
  }

  initializeIndices() {
    this.addIndex(this.constructor.indices);
  }

  initializeColors() { this.addAttribute("aColor", this.constructor.colorVertices, 3); }
}

export class Grid3dGeometry extends Placeable3dGeometry {
  static NUM_VERTICES = 8;

  static colorVertices = [
    // Top: Shades of orange
    1.0, 0.00, 0.0,
    1.0, 0.25, 0.0,
    1.0, 0.75, 0.0,
    1.0, 1.00, 0.0,

    // Bottom: Shades of blue
    0.0, 0.00, 1.0,
    0.0, 0.25, 1.0,
    0.0, 0.75, 1.0,
    0.0, 1.00, 1.0
  ];

  /*
   TL: 0, 4
   TR: 1, 5
   BR: 2, 6,
   BL: 3, 7

    TL --- TR
    |      |
    |      |
    BL --- BR
  */
  static indices = new Uint16Array([
    // Top
    0, 1, 2, // TL - TR - BR
    0, 2, 3, // TL - BR - BL

    // Bottom
    4, 7, 6, // TL - BL - BR
    4, 6, 5, // TL - BR - TR

    // Sides (from top)
    0, 3, 7, // TL (top) - BL (top) - BL (bottom)
    0, 7, 4, // TL (top) - BL (bottom) - TL (bottom)

    1, 0, 4, // TR (top) - TL (top) - TL (bottom)
    1, 4, 5, // TR (top) - TL (bottom) - TR (bottom)

    2, 1, 5, // BR (top) - TR (top) - TR (bottom)
    2, 5, 6, // BR (top) - TR (bottom) - BR (bottom)

    3, 2, 6, // BL (top) - BR (top) - BR (bottom)
    3, 6, 7 // BL (top) - BR (bottom) - BL (bottom)
  ]);

  static cubePoints(token) {
    // Construct a grid unit cube at the token center.
    const center = Point3d.fromTokenCenter(token);
    const size = canvas.dimensions.size;
    const size_1_2 = (size * 0.5) - 1; // Shrink by 1 pixel to avoid z-fighting if wall is at token edge.
    const elevationOffset = 1; // Shrink top/bottom by 1 pixel for same reason.
    const z = size_1_2 - elevationOffset;
    const pts = [
      new Point3d(-size_1_2, -size_1_2, z),
      new Point3d(size_1_2, -size_1_2, z),
      new Point3d(size_1_2, size_1_2, z),
      new Point3d(-size_1_2, size_1_2, z),

      new Point3d(-size_1_2, -size_1_2, -z),
      new Point3d(size_1_2, -size_1_2, -z),
      new Point3d(size_1_2, size_1_2, -z),
      new Point3d(-size_1_2, size_1_2, -z)
    ];

    pts.forEach(pt => center.add(pt, pt));
    return pts;
  }

  constructor(object) {
    super(object);
    this._updateTokenCenter();
  }

  // Cache the relevant token properties and update when the token is updated.
  #tokenCenter = new Point3d();

  _updateTokenCenter() { this.#tokenCenter = Point3d.fromTokenCenter(this.object); }

  constructObjectPoints() { return this.constructor.cubePoints(this.object); }

  updateObjectPoints() {
    const newCenter = Point3d.fromTokenCenter(this.object);
    const delta = newCenter.subtract(this.#tokenCenter);
    this.objectPoints.forEach(pt => pt.add(delta, pt));
    this._updateTokenCenter();
  }
}

export class Token3dGeometry extends Grid3dGeometry {

  static cubePoints(token) {
    const centerPts = Point3d.fromToken(token);
    const { width, height } = token.document;
    const w = width * canvas.dimensions.size;
    const h = height * canvas.dimensions.size;
    const w_1_2 = (w * 0.5) - 1;  // Shrink by 1 pixel to avoid z-fighting if wall is at token edge.
    const h_1_2 = (h * 0.5) - 1;  // (common with square grids)
    const elevationOffset = 1; // Shrink top/bottom by 1 pixel for same reason.
    return [
      centerPts.top.add(new Point3d(-w_1_2, -h_1_2, -elevationOffset)),
      centerPts.top.add(new Point3d(w_1_2, -h_1_2, -elevationOffset)),
      centerPts.top.add(new Point3d(w_1_2, h_1_2, -elevationOffset)),
      centerPts.top.add(new Point3d(-w_1_2, h_1_2, -elevationOffset)),

      centerPts.bottom.add(new Point3d(-w_1_2, -h_1_2, elevationOffset)),
      centerPts.bottom.add(new Point3d(w_1_2, -h_1_2, elevationOffset)),
      centerPts.bottom.add(new Point3d(w_1_2, h_1_2, elevationOffset)),
      centerPts.bottom.add(new Point3d(-w_1_2, h_1_2, elevationOffset))
    ];
  }

  constructor(object) {
    super(object);
    this._updateTokenSize();
  }

  _updateTokenSize() {
    const { width, height } = this.object.document;
    this.#tokenWidth = width;
    this.#tokenHeight = height;
  }

  #tokenWidth = 0;

  #tokenHeight = 0;

  updateObjectPoints() {
    // If token width or height has changed, rebuild the points.
    if ( this.object.document.width !== this.#tokenWidth
      || this.object.document.height !== this.#tokenHeight ) {

      this._updateTokenSize();
      this._updateTokenCenter();
      this.initializeObjectPoints();
    }
    super.updateObjectPoints();
  }
}

export class ConstrainedToken3dGeometry extends Token3dGeometry {

  // TODO: Can we always assume a rectangular border is equivalent to the unconstrained border?
  /** @type {boolean} */
  get isConstrained() { return !(this.object.constrainedTokenBorder instanceof PIXI.Rectangle); }

  updateVertices() {
    if ( !this.isConstrained ) {
      // Fix the buffer lengths.
      const vBuffer = this.getBuffer("aVertex");
      const n = this.constructor.NUM_VERTICES * 3;
      if ( vBuffer.data.length !== n ) vBuffer.data = new Float32Array(n);

      const cBuffer = this.getBuffer("aColor");
      if ( cBuffer.data.length !== n ) cBuffer.data = new Float32Array(n);

      // Replace the index buffer.
      this.indexBuffer.update(this.constructor.indices);

      return super.updateVertices();
    }

    // TODO: Is it necessary to both set the data and update the buffer?
    // Can we trigger one update after all this instead?
    const { vertices, indices, colors } = this._buildConstrainedGeometry();
    const vBuffer = this.getBuffer("aVertex");
    vBuffer.update(vertices);

    const cBuffer = this.getBuffer("aColor");
    cBuffer.update(colors);

    const iBuffer = this.indexBuffer;
    iBuffer.update(indices);
  }

  _indexSides(n) {
    // Top points: 0 - (n - 1)
    // Bottom points: n - (n * 2 - 1)
    // e.g., if 4 sides, then 0 - 3, 4 - 7
    const sides = new Uint16Array(n * 6);
    for ( let s = 0; s < n; s += 1 ) {
      const i = s * 6;
      const minus1 = ((s + n) - 1) % n;

      sides[i] = s;
      sides[i + 1] = minus1;
      sides[i + 2] = minus1 + n;

      sides[i + 3] = s;
      sides[i + 4] = minus1 + n;
      sides[i + 5] = s + n;
    }
    return sides;
  }

  _buildConstrainedGeometry() {
    const triangulatedFace = this._triangulateConstrainedTop();
    const vertices = this._constrainedVertices();
    const nSides = vertices.length / 6; // 3 coordinates per side, top + bottom
    const sideIndices = this._indexSides(nSides);

    // Map the triangulated top indices to the vertices.
    // Note that vertices are top, bottom, so can skip second half.
    //
    const indicesMap = new Map();
    const triV = new PIXI.Point();
    const V = new PIXI.Point();
    const triVertices = triangulatedFace.vertices;
    const lnTop = triangulatedFace.vertices.length;
    const lnTopVertices = nSides * 3;
    for ( let i = 0; i < lnTop; i += 2 ) {
      triV.set(triVertices[i], triVertices[i + 1]);
      for ( let j = 0; j < lnTopVertices; j += 3 ) {
        V.set(vertices[j], vertices[j + 1]);
        if ( triV.almostEqual(V) ) {
          indicesMap.set(i / 2, j / 3);
          break;
        }
      }
    }

    // Is the map always the same?
    for ( const [key, value] of indicesMap.entries()) {
      if ( key !== value ) {
        console.debug("indicesMap key ≠ value", {key, value});
      }
    }

    const topIndices = triangulatedFace.indices.map(i => indicesMap.get(i));
    const bottomIndices = topIndices.map(i => i + nSides);

    // Merge the sides, top, bottom indices. All rely on the same side points.
    const sidesLn = sideIndices.length;
    const topLn = topIndices.length;
    const indices = new Uint16Array(sidesLn + topLn + topLn);
    indices.set(sideIndices);
    indices.set(topIndices, sidesLn);
    indices.set(bottomIndices.reverse(), sidesLn + topLn);

    // Colors cycle around the top/bottom face.
    // Top: shades of orange.
    // Bottom: shades of blue.
    const mult = 1 / (nSides - 1);
    const ln = nSides * 2;
    const colors = new Float32Array(nSides * 3 * 2);
    for ( let i = 0, s = 0; s < nSides; i += 3, s += 1 ) {
      const shade = s * mult;
      colors[i] = 1.0;
      colors[i + 1] = shade;
      colors[i + 2] = 0.0;

      const j = i + (nSides * 3);
      colors[j] = 0.0;
      colors[j + 1] = 1.0;
      colors[j + 2] = shade;
      console.log({i, s, j})
    }

    return {
      vertices,
      indices,
      colors
    };

    /* For debugging, construct the top triangles.
    triangles = [];
    for ( let i = 0; i < topIndices.length; i += 3 ) {
      const j0 = topIndices[i] * 3
      const j1 = topIndices[i+1] * 3;
      const j2 = topIndices[i+2] * 3;
      triangles.push(new PIXI.Polygon([
        vertices[j0],
        vertices[j0+1],
        vertices[j1],
        vertices[j1+1],
        vertices[j2],
        vertices[j2+1]
      ]))
    }

    triangles.forEach(tri => Draw.shape(tri))
    */

    /* Print triangle points
      pts = [];
      triangles = [];
      for ( let i = 0; i < indices.length; i += 3 ) {
        const j0 = indices[i] * 3
        const j1 = indices[i+1] * 3;
        const j2 = indices[i+2] * 3;
        const pt0 = new Point3d(vertices[j0], vertices[j0+1], vertices[j0+2]);
        const pt1 = new Point3d(vertices[j1], vertices[j1+1], vertices[j1+2]);
        const pt2 = new Point3d(vertices[j2], vertices[j2+1], vertices[j2+2]);
        pts.push(pt0, pt1, pt2);

        triangles.push(new PIXI.Polygon([
          pt0.x,
          pt0.y,
          pt1.x,
          pt1.y,
          pt2.x,
          pt2.y
        ]));
      }

      sideTriangles = triangles.slice(0, nSides * 2)
      topTriangles = triangles.slice(nSides * 2, nSides * 2 + topLn / 3)
      bottomTriangles = triangles.slice(nSides * 2 + topLn / 3)



    */

  }

  _constrainedVertices() {
    // Clockwise order for both top and bottom.
    // Will reverse the bottom in the indices.
    const border = this.object.constrainedTokenBorder;
    const { topZ, bottomZ } = this.object;
    if ( !border.isClockwise ) border.reverseOrientation();

    // Each side has 4 vertices, with 3 coordinates for each.
    // Shared vertices between edges means we need nSide vertices * 3 top, same for bottom
    const pts = [...border.iteratePoints({close: false})];
    const nPts = pts.length;
    const vertices = new Float32Array(nPts * 3 * 2); // 3 coordinates per point, top + bottom.
    const bottomStartI = nPts * 3;
    for ( let i = 0; i < nPts; i += 1 ) {
      const { x, y } = pts[i];

      // Top vertices
      const v = i * 3;  // 3 coordinates per vertex.
      vertices[v] = x;
      vertices[v + 1] = y;
      vertices[v + 2] = topZ;

      // Bottom vertices
      const w = v + bottomStartI; // Add after all top vertices.
      vertices[w] = x;
      vertices[w + 1] = y;
      vertices[w + 2] = bottomZ;
    }
    return vertices;
  }

  //   _constrainedSides() {
  //     const border = this.object.constrainedTokenBorder;
  //     const { topZ, bottomZ } = this.object;
  //     if ( border.isClockwise ) border.reverseOrientation();
  //
  //     // Each edge represents the top/bottom of a side.
  //     // So nSides === nEdges.
  //     // Each side has 4 vertices, with 3 coordinates for each.
  //     // Shared vertices between edges means we need nSide vertices * 2 * 3
  //     const edges = [...border.iterateEdges({close: true})];
  //     const nSides = edges.length;
  //     const vertices = new Float32Array(nSides * 2 * 3);
  //     for ( let i = 0; i < nSides; i += 1 ) {
  //       const {x, y} = edges[i].B;
  //       const v = i * 2 * 3; // 2 vertices per side, 3 coordinates per vertex.
  //       vertices[v] = x;
  //       vertices[v + 1] = y;
  //       vertices[v + 2] = topZ;
  //       vertices[v + 3] = x;
  //       vertices[v + 4] = y;
  //       vertices[v + 5] = bottomZ;
  //     }
  //
  //     // 2 triangles per side; 3 indices per triangle
  //     // Vertices are TL, BL, TR, BR...
  //     // Arrange CW: TL - TR - BR and TL - BR - BL
  //     const indices = new Uint16Array(nSides * 2 * 3);
  //     for ( let i = 0; i < nSides; i += 1 ) {
  //       const j = i * 6; // Which indice (6 per side).
  //       const v = i * 2; // Which vertex (2 per side, repeated other 2).
  //
  //       indices[j] = v;           // TL
  //       indices[j + 1] = v + 2;   // TR
  //       indices[j + 2] = v + 3;   // BR
  //
  //       indices[j + 3] = v;       // TL
  //       indices[j + 4] = v + 3;   // BR
  //       indices[j + 5] = v + 1;   // BL
  //     }
  //     // The final right vertices circle back to the beginning.
  //     const j = (nSides - 1) * 6;
  //     indices[j + 1] = 0;
  //     indices[j + 2] = 1;
  //     indices[j + 4] = 1;
  //
  //     return { vertices, indices };
  //   }

  /** @type {PIXI.Geometry} */
  _constrainedTopGeometry;


  _triangulateConstrainedTop() {
    // Don't trust PolygonMesher._defaultOptions.
    const opts = {
      normalize: false,
      offset: 0,
      x: 0,
      y: 0,
      radius: 0,
      depthOuter: 0,
      depthInner: 1,
      scale: 10e8,
      miterLimit: 7,
      interleaved: false
    };

    const border = this.object.constrainedTokenBorder;
    const mesh = new PolygonMesher(border, opts);
    this._constrainedTopGeometry = mesh.triangulate(this._constrainedTopGeometry);

    return {
      vertices: this._constrainedTopGeometry.getBuffer("aVertexPosition").data,
      indices: this._constrainedTopGeometry.getIndex().data
    };

    /* For debugging, construct the triangles.
    vertices = constrainedTopGeometry.getBuffer("aVertexPosition").data;
    indices = constrainedTopGeometry.getIndex().data;
    triangles = [];
    for ( let i = 0; i < indices.length; i += 3 ) {
      const j0 = indices[i] * 2;
      const j1 = indices[i+1] * 2;
      const j2 = indices[i+2] * 2;
      triangles.push(new PIXI.Polygon([
        vertices[j0],
        vertices[j0+1],
        vertices[j1],
        vertices[j1+1],
        vertices[j2],
        vertices[j2+1]
      ]))
    }
    triangles.forEach(tri => Draw.shape(tri, { color: Draw.COLORS.red}))

    */
  }

  destroy() {
    if ( this._constrainedTopGeometry
      && this._constrainedTopGeometry.indices ) this._constrainedTopGeometry.destroy();
  }

}

export class Wall3dGeometry extends Placeable3dGeometry {
  static NUM_VERTICES = 4;

  static colorVertices = [
    // Top: Shades of orange
    1.0, 0.00, 0.0,
    1.0, 0.25, 0.0,
    1.0, 0.75, 0.0,
    1.0, 1.00, 0.0
  ];

  /*
   TL: 0
   TR: 1
   BR: 2
   BL: 3

    TL --- TR
    |      |
    |      |
    BL --- BR
  */
  static indices = [
    // Top
    0, 1, 2, // TL - TR - BR
    0, 2, 3, // TL - BR - BL

    // Bottom
    0, 3, 2, // TL - BL - BR
    0, 2, 1 // TL - BR - TR
  ];

  constructObjectPoints() {
    const pts = Point3d.fromWall(this.object, { finite: true });
    return [
      pts.A.top,
      pts.B.top,
      pts.B.bottom,
      pts.A.bottom
    ];
  }
}

export class DirectionalWall3dGeometry extends Wall3dGeometry {
  /*
   TL: 0
   TR: 1
   BR: 2
   BL: 3

    TL --- TR
    |      |
    |      |
    BL --- BR
  */
  static indices = [
    // Top
    0, 1, 2, // TL - TR - BR
    0, 2, 3 // TL - BR - BL
  ];
}

export class Tile3dGeometry extends Wall3dGeometry {
  static uvs = [
    // Top, looking down
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1 // BL
  ];

  constructor(object) {
    super(object);
    this.initializeUVs();
  }

  initializeUVs() { this.addAttribute("aTextureCoord", this.constructor.uvs, 2); }

  constructObjectPoints() {
    const pts = Point3d.fromTile(this.object);
    return [
      pts.tl,
      pts.tr,
      pts.br,
      pts.bl
    ];
  }
}
