/* globals
canvas,
CONFIG,
CONST,
foundry,
Hooks,
PIXI,
Region,
*/
"use strict";

import { MODULE_ID } from "../const.js";
import { Polygon3dVertices } from "./geometry/BasicVertices.js";
import { GeometryToken, GeometryConstrainedToken, GeometryLitToken, GeometrySquareGrid } from "./geometry/GeometryToken.js";
import { GeometryWall } from "./geometry/GeometryWall.js";
import { GeometryTile } from "./geometry/GeometryTile.js";
import { PlaceableTracker  } from "./placeable_tracking/PlaceableTracker.js";
import { WallTracker } from "./placeable_tracking/WallTracker.js";
import { TileTracker } from "./placeable_tracking/TileTracker.js";
import { TokenTracker } from "./placeable_tracking/TokenTracker.js";
import { Polygon3d, Triangle3d, Polygons3d } from "./Polygon3d.js";
import { regionElevation, convertRegionShapeToPIXI } from "./util.js";

import * as MarchingSquares from "../marchingsquares-esm.js";

/**
Store triangles representing Foundry object shapes.
*/
Hooks.on("canvasReady", function() {
  console.debug(`${MODULE_ID}|PlaceableTriangles|canvasReady`);
  WallTriangles.registerExistingPlaceables();
  TileTriangles.registerExistingPlaceables();
  TokenTriangles.registerExistingPlaceables();
  RegionTriangles.registerExistingPlaceables();
  WallTriangles.registerPlaceableHooks();
  TileTriangles.registerPlaceableHooks();
  TokenTriangles.registerPlaceableHooks();
  RegionTriangles.registerPlaceableHooks();
});

const SENSE_TYPES = {};
CONST.WALL_RESTRICTION_TYPES.forEach(type => SENSE_TYPES[type] = Symbol(type));

export const AbstractPolygonTrianglesID = "geometry";

/**
 * Stores 1+ prototype triangles and corresponding transformed triangles to represent
 * a basic shape in 3d space.
 */
class AbstractPolygonTriangles {
  static ID = AbstractPolygonTrianglesID;

  /* ----- NOTE: Hooks ----- */

  /**
   * @typedef {object} PlaceableHookData
   * Description of a hook to use.
   * @prop {object} name: methodName        Name of the hook and method; e.g. updateWall: "_onPlaceableUpdate"
   */
  /** @type {object[]} */
  static HOOKS = {};

  /** @type {number[]} */
  static _hooks = [];

  /**
   * Register hooks for this placeable type that record updates.
   */
  static registerPlaceableHooks() {
    if ( this._hooks.length ) return; // Only register once.
    for ( const [name, methodName] of Object.entries(this.HOOKS) ) {
      const id = Hooks.on(name, this[methodName].bind(this));
      this._hooks.push({ name, methodName, id });
    }
  }

  static deregisterPlaceableHooks() {
    this._hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.length = 0;
  }

  static registerExistingPlaceables(placeables) {
    placeables.forEach(placeable => new this(placeable));
  }

  static _onPlaceableDocumentCreation(placeableD) {
    if ( !placeableD.object ) return;
    new this(placeableD.object);
  }

  /* ----- NOTE: Constructor ----- */

  /** @type {Placeable} */
  placeable;

  constructor(placeable) {
    this.placeable = placeable;
    placeable[MODULE_ID] ??= {};
    placeable[MODULE_ID][AbstractPolygonTrianglesID] = this;
  }

  get triangles() { return []; }

  /* ----- NOTE: Debug ----- */

  draw(placeable, opts) { this.triangles.forEach(tri => tri.draw(opts)); }

  /**
   * Draw shape but swap z and y positions.
   */
  drawSplayed(placeable, opts) { this.triangles.forEach(tri => tri.drawSplayed(opts)); }
}

class AbstractPolygonTrianglesWithPrototype extends AbstractPolygonTriangles {
  static geomClass;

  static geomOpts = {};

  /** @type {Triangle3d[]} */
  static _prototypeTriangles;

  static get prototypeTriangles() {
    this.geom ??= new this.geomClass(this.geomOpts);
    return (this._prototypeTriangles ??= Triangle3d.fromVertices(this.geom.vertices, this.geom.indices));
  }

  /** @type {class} */
  static instanceHandlerClass = PlaceableTracker;

  /** @type {PlaceableInstanceHandler} */
  static _instanceHandler; // Cannot use # with static getter if it will change based on child class.

  static get instanceHandler() {
    if ( this._instanceHandler ) return this._instanceHandler;
    this._instanceHandler = this.instanceHandlerClass.cachedBuild();
    this._instanceHandler.initializePlaceables();
    return this._instanceHandler;
  }

  /* ----- NOTE: Constructor ----- */

  get triangles() {
    const M = this.constructor.instanceHandler.getMatrixForPlaceable(this.placeable);
    if ( !M ) return [];
    return this.constructor.prototypeTriangles.map(tri => tri.transform(M));
  }

  /* ----- NOTE: Debug ----- */

  drawPrototypes(opts) { this.prototypeTriangles.forEach(tri => tri.draw(opts)); }

  drawPrototypesSplayed(opts) { this.prototypeTriangles.forEach(tri => tri.drawSplayed(opts)); }

}

export class WallTriangles extends AbstractPolygonTrianglesWithPrototype {
  /** @type {GeometryDesc} */
  static geomClass = GeometryWall;

  /** @type {Triangle3d[]} */
  static _prototypeTriangles;

  /** @type {class} */
  static instanceHandlerClass = WallTracker;

  static _instanceHandler;

  /** @type {object[]} */
  static HOOKS = {
    createWall: "_onPlaceableDocumentCreation",
  };

  /** @type {number[]} */
  static _hooks = [];

  get triangle() {
    const M = this.constructor.instanceHandler.getMatrixForPlaceable(this.placeable);
    if ( !M ) return [];
    const instance = WallTracker.isDirectional(this.placeable.edge)
          ? DirectionalWallTriangles : WallTriangles;
    return instance.prototypeTriangles.map(tri => tri.transform(M));
  }

  static registerExistingPlaceables() {
    super.registerExistingPlaceables(canvas.walls.placeables);
  }
}

export class DirectionalWallTriangles extends WallTriangles {
  /** @type {GeometryDesc} */
  static geomClass = GeometryWall;

  static geomOpts = { type: "directional" };

  /** @type {Triangle3d[]} */
  static _prototypeTriangles;
}

export class TileTriangles extends AbstractPolygonTrianglesWithPrototype {
  /** @type {GeometryDesc} */
  static geomClass = GeometryTile;

  /** @type {Triangle3d[]} */
  static _prototypeTriangles;

  /** @type {class} */
  static instanceHandlerClass = TileTracker;

  static _instanceHandler;

  /** @type {object[]} */
  static HOOKS = {
    createTile: "_onPlaceableDocumentCreation",
  };

    /** @type {number[]} */
  static _hooks = [];

  static registerExistingPlaceables() {
    super.registerExistingPlaceables(canvas.tiles.placeables);
  }

  /**
   * On placeable creation hook, also add isoband polygons representing solid areas of the tile.
   */


  /* ----- NOTE: Constructor ----- */

  /** @type {Polygons3d[2]} */
  alphaThresholdPolygons = Array(2);

  /** @type {Triangle3d[]} */
  alphaThresholdTriangles = [];

  /** @type {ClipperPaths|ClipperPaths2} */
  #alphaThresholdPaths;

  constructor(placeable) {
    super(placeable);

    // Add in alpha threshold polygons.
    this._updateAlphaPaths();
    this._updatePathsToFacePolygons();
    this._updatePathsToFaceTriangles();
  }

  _updateAlphaPaths() {
    this.#alphaThresholdPaths = this.convertTileToIsoBands();
  }

  /**
   * Convert clipper paths representing a tile shape to top and bottom faces.
   * Bottom faces have opposite orientation.
   */
  _updatePathsToFacePolygons() {
    const paths = this.#alphaThresholdPaths;
    if ( !paths ) return;
    const top = Polygons3d.fromClipperPaths(paths)
    const bottom = top.clone();
    bottom.reverseOrientation(); // Reverse orientation but keep the hole designations.
    this.alphaThresholdPolygons[0] = top;
    this.alphaThresholdPolygons[1] = bottom;
  }

  /**
   * Triangulate an array of polygons or clipper paths, then convert into 3d face triangles.
   * Both top and bottom faces.
   * @param {PIXI.Polygon|ClipperPaths} polys
   * @returns {Triangle3d[]}
   */
  _updatePathsToFaceTriangles() {
    const polys = this.#alphaThresholdPaths;
    if ( !polys ) return;

    // Convert the polygons to top and bottom faces.
    // Then make these into triangles.
    // Trickier than leaving as polygons but can dramatically cut down the number of polys
    // for more complex shapes.
    const tris = [];
    const elev = this.placeable.elevationZ;
    const { top, bottom } = Polygon3dVertices.polygonTopBottomFaces(polys, {  topZ: elev, bottomZ: elev });

    // Trim the UVs and Normals.
    const topTrimmed = Polygon3dVertices.trimNormalsAndUVs(top);
    const bottomTrimmed = Polygon3dVertices.trimNormalsAndUVs(bottom);
    tris.push(
      ...Triangle3d.fromVertices(topTrimmed),
      ...Triangle3d.fromVertices(bottomTrimmed)
    );

    // Drop any triangles that are nearly collinear or have very small areas.
    // Note: This works b/c the triangles all have z values of 0, which can be safely ignored.
    this.alphaThresholdTriangles = tris.filter(tri => !foundry.utils.orient2dFast(tri.a, tri.b, tri.c).almostEqual(0, 1e-06) );
  }

  /**
   * For a given tile, convert its pixels to an array of polygon isobands representing
   * alpha values at or above the threshold. E.g., alpha between 0.75 and 1.
   * @param {Tile} tile
   * @returns {ClipperPaths|null} The polygon paths or, if error, the local alpha bounding box.
   *   Coordinates returned are local to the tile pixels, between 0 and width/height of the tile pixels.
   *   Null is returned if no alpha threshold is set or no evPixelCache is defined.
   */
  convertTileToIsoBands() {
    const tile = this.placeable;

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

  triangles3dForAlphaBounds() {
    const tile = this.placeable;
    if ( !tile.evPixelCache ) return this.constructor.prototypeTriangles;
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


  get triangles() {
    const tile = this.placeable;

    if ( !this.constructor.instanceHandler.placeables.has(tile) ) return [];
    if ( !tile.evPixelCache ) return super.triangles.call(this);


    const triType = CONFIG[MODULE_ID].tileThresholdShape;
    const obj = tile[MODULE_ID] ?? {};

    // Don't pull triType directly, which could result in infinite loop if it is "triangle".
    const tris = (triType === "triangles"|| !Object.hasOwn(obj, triType))
      ? this.triangles3dForAlphaBounds() : obj[triType];

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

export class TokenTriangles extends AbstractPolygonTrianglesWithPrototype {
  /** @type {GeometryDesc} */
  static geomClass = GeometryToken;

  /** @type {Triangle3d[]} */
  static _prototypeTriangles;

  /** @type {class} */
  static instanceHandlerClass = TokenTracker;

  static _instanceHandler;

  /** @type {object[]} */
  static HOOKS = {
    createToken: "_onPlaceableDocumentCreation",
  };

  /** @type {number[]} */
  static _hooks = [];

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

  /* ----- NOTE: Constructor ----- */


  get litTriangles() {
    const token = this.placeable;
    if ( !token.litTokenBorder ) return null;

    const geom = new GeometryLitToken({ token });
    return Triangle3d.fromVertices(geom.vertices, geom.indices);
  }

  get constrainedTriangles() {
    const token = this.placeable;
    const geom = new GeometryConstrainedToken({ token });
    return Triangle3d.fromVertices(geom.vertices, geom.indices);
  }

  get triangles() {
     if ( this.placeable.isConstrainedTokenBorder ) return this.constrainedTriangles;
     else return super.triangles;
  }

  static registerExistingPlaceables() {
    super.registerExistingPlaceables(canvas.tokens.placeables);
  }
}

// TODO: Can we use entirely static methods for grid triangles?
//       Can these be reset on scene load? Maybe a hook?

export class Grid3dTriangles extends AbstractPolygonTriangles {

  /** @type {Triangle3d[]} */
  static prototypeTriangles;

  static buildGridGeom() {
    // TODO: Hex grids
    const geom = new GeometrySquareGrid();
    this.prototypeTriangles = Triangle3d.fromVertices(geom.vertices, geom.indices);
  }

  static trianglesForGridShape() {
    if ( !this.prototypeTriangles ) this.buildGridGeom();
    return this.prototypeTriangles.map(tri => tri.clone());
  }
}

export class RegionTriangles extends AbstractPolygonTriangles {

  static CHANGE_KEYS = [
    "flags.terrainmapper.elevationAlgorithm",
    "flags.terrainmapper.plateauElevation",
    "flags.terrainmapper.rampFloor",
    "flags.terrainmapper.rampDirection",
    // "flags.terrainmapper.rampStepSize",
    "flags.terrainmapper.splitPolygons",

    "elevation.bottom",
    "elevation.top",

    "shapes",
  ];

  static HOOKS = {
    createRegion: "_onPlaceableDocumentCreation",
    updateRegion: "_onPlaceableDocumentUpdate",
  };

  /** @type {number[]} */
  static _hooks = [];


  /** @type {Polygon3d[]} */
  tops = [];

  sides = [];

  bottoms = [];

  polygons = [];

  constructor(region) {
    super(region);
    this.updateRegionPolygons();
  }

  get triangles() { return this.polygons; }

  updateRegionPolygons() {
    // TODO: Handle holes
    // TODO: Handle combining polygons.
    this.buildRegionPolygons3d();

    // Tops and bottoms are Polygons3d and can simply be added to the polygons array.
    // Sides are arrays of Polygon3d and must be flattened.
    this.polygons = [
      ...this.tops,
      ...this.bottoms,
      ...this.sides.flatMap(elem => elem),
    ];
  }

  /**
   * On region update hook, add/update polygons for any shapes
   */
  static _onPlaceableDocumentUpdate(placeableD, changed) {
    const region = placeableD.object;
    if ( !region ) return;
    // NOTE: Keep the polygons regardless of whether the region would block.
    // TODO: If only updating elevation, don't update the entire group of polygons.
    const changeKeys = new Set(Object.keys(foundry.utils.flattenObject(changed)));
    if ( !this.CHANGE_KEYS.some(key => changeKeys.has(key)) ) return;
    region[MODULE_ID][AbstractPolygonTrianglesID].updateRegionPolygons();
  }

  combineRegionShapes() {
    const region = this.placeable;
    const nShapes = region.shapes.length;
    if ( !nShapes ) return [];

    // Form groups of shapes. If any shape overlaps another, they share a group.
    // So if A overlaps B and B overlaps C, [A,B,C] form a group regardless of whether A overlaps C.
    const usedShapes = new Set();
    const uniqueShapes = [];
    for ( let i = 0; i < nShapes; i += 1 ) {
      if ( usedShapes.has(i) ) continue; // Don't need to add to usedShapes b/c not returning to this i.
      const shape = region.shapes[i];
      const shapePIXI = convertRegionShapeToPIXI(shape).clone();
      const shapeGroup = [{ shape, shapePIXI }];
      uniqueShapes.push(shapeGroup);
      for ( let j = i + 1; j < nShapes; j += 1 ) {
        if ( usedShapes.has(j) ) continue;
        const other = region.shapes[j];
        const otherPIXI = convertRegionShapeToPIXI(other); // Temporary.

        // Any overlap counts.
        for ( const obj of shapeGroup ) {
          if ( obj.shapePIXI.overlaps(otherPIXI) ) {
            shapeGroup.push({ shape: other, shapePIXI: otherPIXI.clone() });
            usedShapes.add(j);
            break;
          }
        }
      }
    }
    return uniqueShapes;
  }

  buildRegionPolygons3d() {
    const ClipperPaths = CONFIG[MODULE_ID].ClipperPaths;
    const region = this.placeable;

    // Clear prior data.
    this.tops.length = 0;
    this.bottoms.length = 0;
    this.sides.length = 0;
    if ( !region.shapes.length ) return;

    const { topZ, bottomZ } = regionElevation(region);
    const uniqueShapes = this.combineRegionShapes();
    const nUnique = uniqueShapes.length;
    this.tops.length = this.bottoms.length = this.sides.length = nUnique;
    for ( let i = 0; i < nUnique; i += 1 ) {
      // Combine and convert to Polygons3d.
      // Technically, all of these could be a single Polygons3d but better to keep separate for culling.
      const paths = uniqueShapes[i].map(shapeObj => this.constructor.shapeToClipperPaths(shapeObj.shape));
      const combinedPaths = paths.length === 1 ? paths[0] : ClipperPaths.joinPaths(paths);

      const path = combinedPaths.combine();
      const polys = Polygons3d.fromClipperPaths(path, topZ);
      const t = this.tops[i] = polys;
      const b = this.bottoms[i] = polys.clone();
      b.setZ(bottomZ); // topZ already set above.

      // Set side rectangles.
      // NOTE: Cannot iterate the bottom edges once reversed.
      // Must create sides for each polygon in the set (incl. holes)
      const nPolys = polys.polygons.length;
      const sidePolys = this.sides[i] = [];
      for ( let j = 0; j < nPolys; j += 1 ) {
        const tPoly = t.polygons[j];
        const bPoly = b.polygons[j];
        // Iterate through each edge and construct the corresponding side rectangle.
        const topIter = tPoly.iterateEdges({ close: true });
        const bottomIter = bPoly.iterateEdges({ close: true });
        while ( true ) {
          const topEdge = topIter.next().value;
          const bottomEdge = bottomIter.next().value;
          if ( !(topEdge || bottomEdge ) ) break;

          // Counter-clockwise.
          const side = Polygon3d.from3dPoints([topEdge.B, topEdge.A, bottomEdge.A, bottomEdge.B]);
          sidePolys.push(side);
        }
      }

      // Fix the bottom orientation now that we have iterated through the sides.
      b.reverseOrientation();
    }
  }

  /**
   * Convert a shape's clipper points to the clipper path class.
   */
  static shapeToClipperPaths(shape) {
    const clipperPoints = shape.clipperPaths;
    const scalingFactor = Region.CLIPPER_SCALING_FACTOR;
    const ClipperPaths = CONFIG.tokenvisibility.ClipperPaths;
    switch ( CONFIG[MODULE_ID].clipperVersion ) {
      // For both, the points are already scaled, so just pass through the scaling factor to the constructor.
      case 1: return new ClipperPaths(clipperPoints, { scalingFactor });
      case 2: return new ClipperPaths(ClipperPaths.pathFromClipper1Points(clipperPoints), { scalingFactor });
    }
  }

  static registerExistingPlaceables() {
    super.registerExistingPlaceables(canvas.regions.placeables);
  }
}



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
