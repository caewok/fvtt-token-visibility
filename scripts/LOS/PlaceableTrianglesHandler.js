/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "../const.js";

import {
  AbstractPlaceableTriangles,
  DirectionalWallTriangles,
  WallTriangles,
  TileTriangles,
  TokenTriangles } from "./PlaceableTriangles.js";

/**
 * Class to handle on-demand updating and destroying of the geometry.
 * Only build when necessary; rebuild when destroyed.
 * Geometry is stored on the object, at object.tokenvisibility.geometry.
 */
export class PlaceableTrianglesHandler {
  /** @type {string} */
  static ID = "_atvShapeTriangles";

  /** @type {class} */
  static TRI_CLASS = AbstractPlaceableTriangles;

  /** @type {string[]} */
  static UPDATE_TRIGGERS = [];

  /** @type {string[]} */
  static REBUILD_TRIGGERS = [];

  /** @type {PlaceableObject} */
  object;

  // If the object already has a geometry handler, that handler is returned
  constructor(object) {
    const id = this.constructor.ID;
    const existingHandler = object[id];
    if ( existingHandler ) return existingHandler;
    this.object = object;
    object[id] = this;
    this._initialize();
  }

  /**
   * Initialize the underlying triangle object for this placeable.
   */
  _initialize() {
    this.triObject = new this.constructor.TRI_CLASS(this.object);
    this.triObject.initialize();
  }

  /** @type {AbstractPlaceableTriangles} */
  triObject;

  /** @type {Triangle} */
  get triangles() { return this.triObject.triangles; }

  /**
   * Create a new triangle object for this placeable.
   * @returns {boolean} True if this resulted in a change.
   */
  rebuild() { this._initialize(); return true; }

  /**
   * Update the existing triangles object. May result in a rebuild.
   * @param {Set<string>} changes         Change keys for the source.
   * @returns {boolean} True if this resulted in a change.
   */
  update(changes) {
    if ( !changes ) return this.triObject.update(); // Force update.
    if ( this.constructor.REBUILD_TRIGGERS.some(t => changes.has(t)) ) return this.rebuild();
    if ( !this.constructor.UPDATE_TRIGGERS.some(t => changes.has(t)) ) return false;
    this.triObject.update();
    return true;
  }

  /**
   * Get all the placeables of this type in the scene and register each.
   * @override
   */
  static registerPlaceables() { }
}

export class WallTrianglesHandler extends PlaceableTrianglesHandler {
  /** @type {Wall} */
  get wall() { return this.object; }

  // Walls only get rebuilt.
  /** @type {string[]} */
  static REBUILD_TRIGGERS = [
    "c",
    "flags.elevatedvision.elevation.top",
    "flags.elevatedvision.elevation.bottom",
    "dir"];

  /**
   * Initialize the underlying triangle object for this placeable.
   */
  _initialize() {
    if ( this.wall.direction ) this.triObject = new DirectionalWallTriangles(this.wall);
    else this.triObject = new WallTriangles(this.wall);
    this.triObject.initialize();
    this.triObject.update();
  }

  /**
   * Get all walls in the scene and register each.
   * @override
   */
  static registerPlaceables() {
    const walls = canvas.walls?.placeables;
    if ( !walls ) return;
    walls.forEach(wall => new this(wall));
  }
}

export class TokenTrianglesHandler extends PlaceableTrianglesHandler {
  /** @type {Token} */
  get token() { return this.object; }

  /** @type {class} */
  static TRI_CLASS = TokenTriangles;

  /** @type {string[]} */
  static REBUILD_TRIGGERS = ["height", "width"];

  /** @type {string[]} */
  static UPDATE_TRIGGERS = ["x", "y", "elevation"];

  /**
   * Get all tokens in the scene and register each.
   * @override
   */
  static registerPlaceables() {
    const tokens = canvas.tokens?.placeables;
    if ( !tokens ) return;
    tokens.forEach(token => new this(token));
  }
}

export class TileTrianglesHandler extends PlaceableTrianglesHandler {
  /** @type {Tile} */
  get tile() { return this.object; }

  /** @type {class} */
  static TRI_CLASS = TileTriangles;

  /** @type {string[]} */
  static REBUILD_TRIGGERS = ["height", "width", "rotation"];

  /** @type {string[]} */
  static UPDATE_TRIGGERS = ["x", "y", "elevation"];

  /**
   * If not overhead, don't update.
   */
  update() {
    if ( this.tile.document.elevation === 0 ) return;
    super.update();
  }

  /**
   * Get all tiles in the scene and register each.
   */
  static registerPlaceables() {
    const tiles = canvas.tiles?.placeables;
    if ( !tiles ) return;
    tiles.forEach(tile => new this(tile));
  }
}
