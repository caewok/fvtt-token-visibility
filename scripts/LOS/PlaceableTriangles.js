/* globals
canvas,
CONFIG,
CONST,
foundry,
Hooks,
PIXI,
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { GeometryDesc } from "./WebGPU/GeometryDesc.js";
import { GeometryCubeDesc, GeometryConstrainedTokenDesc, GeometryLitTokenDesc } from "./WebGPU/GeometryToken.js";
import { GeometryWallDesc } from "./WebGPU/GeometryWall.js";
import { GeometryHorizontalPlaneDesc } from "./WebGPU/GeometryTile.js";
import { PlaceableInstanceHandler, WallInstanceHandler, TileInstanceHandler, TokenInstanceHandler, } from "./WebGPU/PlaceableInstanceHandler.js";
import { Polygons3d, Triangle3d } from "./Polygon3d.js";

import * as MarchingSquares from "../marchingsquares-esm.js";

Hooks.on("canvasReady", function() {
  console.debug(`${MODULE_ID}|PlaceableTriangles|canvasReady`);
  WallTriangles.registerExistingPlaceables();
  TileTriangles.registerExistingPlaceables();
  TokenTriangles.registerExistingPlaceables();
  WallTriangles.registerPlaceableHooks();
  TileTriangles.registerPlaceableHooks();
  TokenTriangles.registerPlaceableHooks();
});

/**
Store triangles representing Foundry object shapes.
*/


const SENSE_TYPES = {};
CONST.WALL_RESTRICTION_TYPES.forEach(type => SENSE_TYPES[type] = Symbol(type));

export const AbstractPolygonTrianglesID = "tokenvisibility";

/**
 * Stores 1+ prototype triangles and corresponding transformed triangles to represent
 * a basic shape in 3d space.
 */
export class AbstractPolygonTriangles {
  static ID = AbstractPolygonTrianglesID;

  static geom;

  /** @type {Triangle3d[]} */
  static _prototypeTriangles;

  static get prototypeTriangles() {
    return (this._prototypeTriangles ??= Triangle3d.fromVertices(this.geom.vertices, this.geom.indices));
  }

  /** @type {class} */
  static instanceHandlerClass = PlaceableInstanceHandler;

  /** @type {PlaceableInstanceHandler} */
  static _instanceHandler; // Cannot use # with static getter if it will change based on child class.

  static get instanceHandler() {
    if ( this._instanceHandler ) return this._instanceHandler;
    this._instanceHandler = new this.instanceHandlerClass();
    this._instanceHandler.initializePlaceables();
    return this._instanceHandler;
  }

  static trianglesForPlaceable(placeable) {
    const idx = this.instanceHandler.instanceIndexFromId.get(placeable.id);
    const M = this.instanceHandler.matrices[idx];
    if ( !M ) return [];
    return this.prototypeTriangles.map(tri => tri.transform(M));
  }

  /* ----- Hooks ----- */

  /** @type {number[]} */
  static _hooks = [];

  /**
   * @typedef {object} PlaceableHookData
   * Description of a hook to use.
   * @prop {object} name: methodName        Name of the hook and method; e.g. updateWall: "_onPlaceableUpdate"
   */
  /** @type {object[]} */
  static HOOKS = [];

  /**
   * Register hooks for this placeable that record updates.
   */
  static registerPlaceableHooks() {
    if ( this._hooks.length ) return; // Only register once.
    for ( const hookDatum of this.HOOKS ) {
      const [name, methodName] = Object.entries(hookDatum)[0];
      const id = Hooks.on(name, this[methodName].bind(this));
      this._hooks.push({ name, methodName, id });
    }
  }

  static deregisterPlaceableHooks() {
    this._hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.length = 0;
  }

  static registerExistingPlaceables(placeables) {
    placeables.forEach(placeable => this._onPlaceableCreation(placeable));
  }

  static _onPlaceableDocumentCreation(placeableD) {
    this._onPlaceableCreation(placeableD.object);
  }

  /**
   * On placeable creation, add getter to the placeable.
   */
  static _onPlaceableCreation(placeable) {
    const obj = placeable[this.ID] ??= {};
    const self = this;
    Object.defineProperty(obj, "triangles", {
      get() { return self.trianglesForPlaceable(placeable); },
      configurable: true,
    });
  }


  /* ----- Debug ----- */

  static draw(placeable, opts) { this.trianglesForPlaceable(placeable).forEach(tri => tri.draw(opts)); }

  static drawPrototypes(opts) { this.prototypeTriangles.forEach(tri => tri.draw(opts)); }

  /**
   * Draw shape but swap z and y positions.
   */
  static drawSplayed(placeable, opts) { this.trianglesForPlaceable(placeable).forEach(tri => tri.drawSplayed(opts)); }

  static drawPrototypesSplayed(opts) { this.prototypeTriangles.forEach(tri => tri.drawSplayed(opts)); }
}


export class WallTriangles extends AbstractPolygonTriangles {
  /** @type {GeometryDesc} */
  static geom = new GeometryWallDesc({ directional: false });

  /** @type {Triangle[]} */
  static _prototypeTriangles;

  /** @type {class} */
  static instanceHandlerClass = WallInstanceHandler;

  /** @type {object[]} */
  static HOOKS = [
    { createWall: "_onPlaceableDocumentCreation" },
  ];

  /**
   * On placeable creation hook, add an instance of this to the placeable.
   */
  static _onPlaceableCreation(placeable) {
    const obj = placeable[this.ID] ??= {};
    Object.defineProperty(obj, "triangles", {
      configurable: true,
      get() {
        const instance = WallInstanceHandler.isDirectional(placeable.edge)
          ? DirectionalWallTriangles : WallTriangles;
        return instance.trianglesForPlaceable(placeable);
      },
    });
  }

  static registerExistingPlaceables() {
    canvas.walls.placeables.forEach(wall => this._onPlaceableCreation(wall));
  }
}

export class DirectionalWallTriangles extends WallTriangles {
  /** @type {GeometryDesc} */
  static geom = new GeometryWallDesc({ directional: true });

  /** @type {Triangle3d[]} */
  static _prototypeTriangles;

}

export class TileTriangles extends AbstractPolygonTriangles {
  /** @type {GeometryDesc} */
  static geom = new GeometryHorizontalPlaneDesc();

  /** @type {Triangle3d[]} */
  static _prototypeTriangles;

  /** @type {class} */
  static instanceHandlerClass = TileInstanceHandler;

  /** @type {object[]} */
  static HOOKS = [
    { createTile: "_onPlaceableDocumentCreation" },
  ];

  static registerExistingPlaceables() {
    canvas.tiles.placeables.forEach(tile => this._onPlaceableCreation(tile));
  }

  /**
   * On placeable creation hook, also add isoband polygons representing solid areas of the tile.
   */
  static _onPlaceableCreation(tile) {
    const obj = tile[this.ID] ??= {};
    const self = this;
    Object.defineProperty(obj, "triangles", {
      get() { return self.trianglesForPlaceable(tile); },
      configurable: true,
    });

    obj.alphaThresholdPolygons = null;
    obj.alphaThresholdTriangles = null;
    obj.alphaThresholdPaths = this.convertTileToIsoBands(tile);
    if ( obj.alphaThresholdPaths ) {
      obj.alphaThresholdPolygons = this.pathsToFacePolygons(obj.alphaThresholdPaths);
      obj.alphaThresholdTriangles = this.pathsToFaceTriangles(obj.alphaThresholdPaths);
    }
  }

  /**
   * Convert clipper paths representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   * @param {ClipperPaths} paths
   * @returns {Polygons3d[2]}
   */
  static pathsToFacePolygons(paths) {
    const top = Polygons3d.fromClipperPaths(paths)
    const bottom = top.clone();
    bottom.reverseOrientation(); // Reverse orientation but keep the hole designations.
    return [top, bottom];
  }

  /**
   * Triangulate an array of polygons or clipper paths, then convert into 3d face triangles.
   * Both top and bottom faces.
   * @param {PIXI.Polygon|ClipperPaths} polys
   * @returns {Triangle3d[]}
   */
  static pathsToFaceTriangles(polys) {
    // Convert the polygons to top and bottom faces.
    // Then make these into triangles.
    // Trickier than leaving as polygons but can dramatically cut down the number of polys
    // for more complex shapes.
    const tris = [];
    const topFace = GeometryDesc.polygonTopBottomFaces(polys, { top: true, addUVs: false, addNormals: false });
    const bottomFace = GeometryDesc.polygonTopBottomFaces(polys, { top: false, addUVs: false, addNormals: false });
    tris.push(
      ...Triangle3d.fromVertices(topFace.vertices, topFace.indices),
      ...Triangle3d.fromVertices(bottomFace.vertices, bottomFace.indices)
    );

    // Drop any triangles that are nearly collinear or have very small areas.
    // Note: This works b/c the triangles all have z values of 0, which can be safely ignored.
    return tris.filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06) );
  }

  /**
   * For a given tile, convert its pixels to an array of polygon isobands representing
   * alpha values at or above the threshold. E.g., alpha between 0.75 and 1.
   * @param {Tile} tile
   * @returns {ClipperPaths|null} The polygon paths or, if error, the local alpha bounding box.
   *   Coordinates returned are local to the tile pixels, between 0 and width/height of the tile pixels.
   *   Null is returned if no alpha threshold is set or no evPixelCache is defined.
   */
  static convertTileToIsoBands(tile) {
    if ( !CONFIG[MODULE_ID].alphaThreshold
      || !tile.evPixelCache ) return null;
    const threshold = 255 * CONFIG[MODULE_ID].alphaThreshold;
    const pixels = tile.evPixelCache.pixels;
    const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;

    // Convert pixels to isobands.
    const width = tile.evPixelCache.width
    const height = tile.evPixelCache.height
    const rowViews = new Array(height);
    for ( let r = 0, start = 0, rMax = height; r < rMax; r += 1, start += width ) {
      rowViews[r] = [...pixels.slice(start, start + width)];
    }

    let bands;
    try {
      bands = MarchingSquares.isoBands(rowViews, threshold, 256 - threshold);
    } catch ( err ) {
      console.error(err);
      const poly = tile.evPixelCache.getThresholdLocalBoundingBox(CONFIG[MODULE_ID].alphaThreshold).toPolygon();
      return ClipperPaths.fromPolygons([poly]);
    }

    /* Don't want to scale between 0 and 1 b/c using evPixelCache transform on the local coordinates.
    // Create polygons scaled between 0 and 1, based on width and height.
    const invWidth = 1 / width;
    const invHeight = 1 / height;
    const nPolys = lines.length;
    const polys = new Array(nPolys);
    for ( let i = 0; i < nPolys; i += 1 ) {
      polys[i] = new PIXI.Polygon(bands[i].flatMap(pt => [pt[0] * invWidth, pt[1] * invHeight]))
    }
    */
    const nPolys = bands.length;
    const polys = new Array(nPolys);
    for ( let i = 0; i < nPolys; i += 1 ) {
      const poly = new PIXI.Polygon(bands[i].flatMap(pt => pt)); // TODO: Can we lose the flatMap?

      // Polys from MarchingSquares are CW if hole; reverse
      poly.reverseOrientation();
      polys[i] = poly;
    }

    // Use Clipper to clean the polygons. Leave as clipper paths for earcut later.
    const paths = CONFIG[MODULE_ID].ClipperPaths.fromPolygons(polys, { scalingFactor: 100 });
    return paths.clean().trimByArea(CONFIG[MODULE_ID].alphaAreaThreshold);
  }

  static triangles3dForAlphaBounds(tile) {
    if ( !tile.evPixelCache ) return this.prototypeTriangles;
    const bounds = tile.evPixelCache.getThresholdLocalBoundingBox(CONFIG[MODULE_ID].alphaThreshold);
    const pts = [...bounds.iteratePoints({ close: false })];

    const tri0 = Triangle3d.from2dPoints(pts.slice(0,3));
    const tri1 = Triangle3d.from2dPoints([pts[0], pts[2], pts[3]]);
    return [
      tri0,
      tri1,
      tri0.clone().reverseOrientation(),
      tri1.clone().reverseOrientation(),
    ];

    /* Or could use polygon3d.
    const poly = Polygon3d.from2dPoints([...bounds.iteratePoints({ close: false })], 0);
    return [
      poly,
      poly.clone().reverseOrientation().
    ];
    */
  }


  static trianglesForPlaceable(tile) {
    if ( !this.instanceHandler.instanceIndexFromId.has(tile.id) ) return [];
    if ( !tile.evPixelCache ) return AbstractPolygonTriangles.trianglesForPlaceable.call(this, tile);


    const triType = CONFIG[MODULE_ID].tileThresholdShape;
    const obj = tile[MODULE_ID] ?? {};

    // Don't pull triType directly, which could result in infinite loop if it is "triangle".
    const tris = (triType === "triangles"|| !Object.hasOwn(obj, triType))
      ? this.triangles3dForAlphaBounds(tile) : obj[triType];

    // Expand the canvas conversion matrix to 4x4.
    // Last row of the 3x3 is the translation matrix, which should be moved to row 4.
    const toCanvasM3x3 = tile.evPixelCache.toCanvasTransform;
    const toCanvasM = CONFIG.GeometryLib.MatrixFlat.identity(4, 4);
    toCanvasM.setElements((elem, r, c) => {
      if ( r < 2 && c < 3 ) return toCanvasM3x3.arr[r][c];
      if ( r === 3 && c < 2 ) return  toCanvasM3x3.arr[2][c];
      return elem;
    });

    // Add elevation translation.
    const elevationT = CONFIG.GeometryLib.MatrixFlat.translation(0, 0, tile.elevationZ);
    const M = toCanvasM.multiply4x4(elevationT);
    return tris.map(tri => tri.transform(M));
  }
}

export class TokenTriangles extends AbstractPolygonTriangles {
  /** @type {GeometryDesc} */
  static geom = new GeometryCubeDesc();

  /** @type {Triangle3d[]} */
  static _prototypeTriangles;

  /** @type {class} */
  static instanceHandlerClass = TokenInstanceHandler;

  /** @type {object[]} */
  static HOOKS = [
    { createToken: "_onPlaceableDocumentCreation" },
    { updateToken: "_onTokenDocumentUpdate" },
  ];


  /* Debugging
  static get prototypeTriangles() {
    // 12 triangles total, 36 indices.
    // South facing (first 2 triangles)
    // return (this._prototypeTriangles ??= Triangle3d.fromVertices(this.geom.vertices, this.geom.indices.slice(3*0, 3*2)));

    // Top facing (second to last 2 triangles)
    // return (this._prototypeTriangles ??= Triangle3d.fromVertices(this.geom.vertices, this.geom.indices.slice(3*8, 3*10)));

    // Bottom facing (last 2 triangles)
    return (this._prototypeTriangles ??= Triangle3d.fromVertices(this.geom.vertices, this.geom.indices.slice(3*8, 3*10)));
  }
  */


  /**
   * On placeable creation hook, add an instance of this to the placeable.
   */
  static _onPlaceableCreation(token) {
    const obj = token[this.ID] ??= {};
    Object.defineProperty(obj, "triangles", {
      configurable: true,
      get() {
        const instance = token.isConstrainedTokenBorder
          ? ConstrainedTokenTriangles : TokenTriangles;
        return instance.trianglesForPlaceable(token);
      },
    });
    Object.defineProperty(obj, "litTriangles", {
      configurable: true,
      get() {
        if ( !token.litTokenBorder ) return null;
        return LitTokenTriangles.trianglesForPlaceable(token);
      }
    });
  }

  static registerExistingPlaceables() {
    canvas.tokens.placeables.forEach(token => this._onPlaceableCreation(token));
  }
}

export class ConstrainedTokenTriangles extends TokenTriangles {
  static trianglesForPlaceable(token) {
    const geom = new GeometryConstrainedTokenDesc({ token });
    return Triangle3d.fromVertices(geom.vertices, geom.indices);
  }
}

export class LitTokenTriangles extends TokenTriangles {
  static trianglesForPlaceable(token) {
    const geom = new GeometryLitTokenDesc({ token });
    return Triangle3d.fromVertices(geom.vertices, geom.indices);
  }
}



// TODO: Can we use entirely static methods for grid triangles?
//       Can these be reset on scene load? Maybe a hook?

export class Grid3dTriangles extends AbstractPolygonTriangles {

  /** @type {class} */
  static instanceHandlerClass = null;

  /** @type {Triangle3d[]} */
  static prototypeTriangles;

  static buildGridGeom() {
    // TODO: Hex grids
    const w = canvas.grid.sizeX;
    const d = canvas.grid.sizeY;
    const h = canvas.dimensions.size;
    const geom = new GeometryCubeDesc({ w, d, h });
    this.prototypeTriangles = Triangle3d.fromVertices(geom.vertices, geom.indices);
  }

  static trianglesForGridShape() {
    if ( !this.prototypeTriangles ) this.buildGridGeom();
    return this.prototypeTriangles.map(tri => tri.clone());
  }
}



/* Orient3dFast license
https://github.com/mourner/robust-predicates/tree/main
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>

*/

/* Testing
api = game.modules.get("tokenvisibility").api;
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
MatrixFlat = CONFIG.GeometryLib.MatrixFlat
let { Triangle, DirectionalWallTriangles, WallTriangles, TileTriangles, TokenTriangles } = api.triangles

tri = Triangle3d.fromPoints(
  new Point3d(0, 0, 0),
  new Point3d(500, 0, 0),
  new Point3d(0, 1000, 0)
)
tri.draw({ color: Draw.COLORS.blue })
tM = MatrixFlat.translation(1000, 1000, 0)
triT = tri.transform(tM)
triT.draw({ color: Draw.COLORS.blue })
wall = canvas.walls.controlled[0]

rM = MatrixFlat.rotationZ(Math.toRadians(45))
triT = tri.transform(rM.multiply4x4(tM))
triT.draw({ color: Draw.COLORS.blue })


wall = canvas.walls.controlled[0]
wallTri = new DirectionalWallTriangles(wall)
wallTri = new WallTriangles(wall)
wallTri.initialize()
wallTri.update()
wallTri.drawPrototypes({ color: Draw.COLORS.blue })
wallTri.draw({ color: Draw.COLORS.blue }) // Same
wallTri.drawSplayed({ color: Draw.COLORS.gray })

tile = canvas.tiles.controlled[0]
tileTri = new TileTriangles(tile)
tileTri.initialize()
tileTri.update()

tokenTri = new TokenTriangles(_token)
tokenTri.initialize()
tokenTri.update()

tokenTri.top.drawPrototypes({ color: Draw.COLORS.blue })
tokenTri.bottom.drawPrototypes({ color: Draw.COLORS.blue })

tokenTri.top.draw({ color: Draw.COLORS.blue })
tokenTri.bottom.draw({ color: Draw.COLORS.blue })

tokenTri.sides.drawPrototypes({ color: Draw.COLORS.blue })
tokenTri.sides.draw({ color: Draw.COLORS.blue })

tokenTri.drawPrototypes({ color: Draw.COLORS.blue })
tokenTri.draw({ color: Draw.COLORS.blue })
tokenTri.drawSplayed({ color: Draw.COLORS.red })

Draw = CONFIG.GeometryLib.Draw

*/
