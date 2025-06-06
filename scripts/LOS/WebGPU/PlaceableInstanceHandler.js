/* globals
canvas,
CONFIG,
CONST,
foundry,
game,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";
import { MODULE_ID, MODULES_ACTIVE } from "../../const.js";

// Base folder


// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const rotationM = MatrixFloat32.identity(4, 4);


export class PlaceableInstanceHandler {

  /**
   * Only keep one instance of each handler type. Class and sense type.
   * @type {Map<string, PlaceableInstanceHandler>}
   */
  static handlers = new WeakMap();

  /** @type {number} */
  static INSTANCE_ELEMENT_LENGTH = 16; // Single mat4x4.

  static INSTANCE_ELEMENT_SIZE = this.INSTANCE_ELEMENT_LENGTH * Float32Array.BYTES_PER_ELEMENT;

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static docUpdateKeys = new Set();

  /**
   * Flags in refreshObject hook that indicate a relevant change to the placeable.
   */
  static refreshFlags = new Set();

  constructor() {
    const handlers = this.constructor.handlers;
    if ( handlers.has(this.constructor) ) return handlers.get(this.constructor);
    handlers.set(this.constructor, this);
  }

  /** @type {Map<string, number>} */
  instanceIndexFromId = new Map();

  /** @type {Map<number, Placeable|Edge>} */
  placeableFromInstanceIndex = new Map();

  /**
   * Track when each instance index was last updated, by updateId
   * @type {Map<number, number>}
   */
  instanceLastUpdated = new Map();

  /** @type {number} */
  get numInstances() { return this.instanceIndexFromId.size; }

  /** @type {ArrayBuffer} */
  instanceArrayBuffer;

  get instanceArrayValues() { return new Float32Array(this.instanceArrayBuffer); }

  /** @type {MatrixFloat32[]} */
  matrices = [];

  /**
   * Initialize all placeables.
   */
  initializePlaceables() {
    this.instanceIndexFromId.clear();
    this.placeableFromInstanceIndex.clear();
    const placeables = this.getPlaceables();

    // mat4x4 for each placeable; 4 bytes per entry.
    this._createInstanceBuffer(placeables.length);
    placeables.forEach((placeable, idx) => this._initializePlaceable(placeable, idx));
  }

  /**
   * Construct data related to the number of instances.
   * @param {number} numPlaceables
   */
  _createInstanceBuffer(numPlaceables) {
    this.instanceArrayBuffer = new ArrayBuffer(numPlaceables * this.constructor.INSTANCE_ELEMENT_SIZE);
    this.matrices.length = numPlaceables;
    this.#bufferId += 1;
    this.instanceLastUpdated.clear();
  }

  /**
   * Initialize a single placeable at a given index.
   * @param {PlaceableObject|Edge} placeable
   * @param {number} idx
   */
  _initializePlaceable(placeable, idx) {
    this.instanceIndexFromId.set(placeable.id, idx);
    this.placeableFromInstanceIndex.set(idx, placeable);
    this.matrices[idx] = new MatrixFloat32(this.getPlaceableInstanceData(placeable.id, idx), 4, 4);
    this.updateInstanceBuffer(idx);
  }

  /**
   * Subclass locate placeables.
   * @returns {Placeable|Edge[]}
   * @override
   */
  getPlaceables() { return []; }

  /**
   * Subclass test for placeable inclusion in the instance array.
   * @param {Placeable|Edge}
   * @returns {boolean}
   * @override
   */
  includePlaceable(_placeable) { return true; }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(idx, { rotation, translation, scale } = {}) {
    this.instanceLastUpdated.set(idx, this.#updateId);
    rotation ??= MatrixFloat32.identity(4, 4, rotationM);
    translation ??= MatrixFloat32.identity(4, 4, translationM);
    scale ??= MatrixFloat32.identity(4, 4, scaleM);

    const M = this.matrices[idx];
    scale
      .multiply4x4(rotation, M)
      .multiply4x4(translation, M);

    // NOTE: Return only for debugging.
    return {
      translation,
      scale,
      rotation,
      out: M
    };
  }

  rotationMatrixForInstance(_idx) {
    return MatrixFloat32.identity(4, 4, rotationM);
  }

  /**
   * Retrieve the array views associated with a given placeable.
   * @param {string} placeableId  Id of the placeable
   * @param {number} [idx]        Optional placeable index; will be looked up using placeableId otherwise
   */
  getPlaceableInstanceData(placeableId, idx) {
    idx ??= this.instanceIndexFromId.get(placeableId);
    const i = idx * this.constructor.INSTANCE_ELEMENT_SIZE;
    return new Float32Array(this.instanceArrayBuffer, i, 16);
  }

  /* ----- NOTE: Hooks and updating ----- */

  // Increment every time the buffer is created.
  /** @type {number} */
  #bufferId = 0;

  get bufferId() { return this.#bufferId; }

  // Increment every time there is an update.
  /** @type {number} */
  #updateId = 0;

  get updateId() { return this.#updateId; }

  // Track what instance indices are not currently used.
  /** @type {Set<number>} */
  #emptyIndices = new Set();

  /**
   * Add the placeable to the instance array. May trigger a rebuild of the array.
   * @param {PlaceableObject} placeable
   * @returns {boolean} True if it resulted in a change.
   */
  addPlaceable(placeable) {
    if ( this.instanceIndexFromId.has(placeable.id) ) return false;
    if ( !this.includePlaceable(placeable) ) return false;

    this.#updateId += 1;
    if ( this._addPlaceableUsingIndex(placeable) ) return true;
    this.initializePlaceables(); // Redo the instance buffer.
    return true;
  }

  /**
   * Attempt to add the placeable object to the existing instance array.
   * Only works if there are empty spaces in the array.
   * @param {PlaceableObject} placeable
   * @returns {boolean} True if successfully added.
   */
  _addPlaceableUsingIndex(placeable) {
    if ( !this.#emptyIndices.size ) return false;
    const idx = this.#emptyIndices.first();
    this.#emptyIndices.delete(idx);
    this.instanceIndexFromId.set(idx, placeable.id);
    this.placeableFromInstanceIndex.set(idx, placeable);
    this.updateInstanceBuffer(idx);
  }

  /**
   * Remove the placeable from the instance array. Simply removes the associated index
   * without rebuilding the array.
   * @param {PlaceableObject} placeable
   * @returns {boolean} True if it resulted in a change.
   */
  removePlaceable(placeableId) {
    if ( !this.instanceIndexFromId.has(placeableId) ) return false;

    this.#updateId += 1;
    const idx = this.instanceIndexFromId.get(placeableId);
    this.instanceIndexFromId.delete(placeableId);
    this.placeableFromInstanceIndex.delete(idx);
    this.instanceLastUpdated.delete(idx);
    this.#emptyIndices.add(idx);
    return true;
  }

  /** @type {Set<string>} */
  static UPDATE_KEYS = new Set();

  /**
   * Update some data about the placeable in the array.
   * @param {PlaceableObject} placeable
   * @param {string[]} changeKeys       Change keys (flags/properties modified)
   * @returns {boolean} True if it resulted in a change.
   */
  updatePlaceable(placeable, changeKeys) {
    // Possible that the placeable needs to be added or removed instead of simply updated.
    const alreadyTracking = this.instanceIndexFromId.has(placeable.id);
    const shouldTrack = this.includePlaceable(placeable);
    if ( !(alreadyTracking && shouldTrack) ) return false;
    if ( alreadyTracking && !shouldTrack ) return this.removePlaceable(placeable.id);
    else if ( !alreadyTracking && shouldTrack ) return this.addPlaceable(placeable);

    // If the changes include one or more relevant keys, update.
    if ( !changeKeys.some(key => this.constructor.UPDATE_KEYS.has(key)) ) return false;
    return this._updatePlaceable(placeable);
  }

  /**
   * Update the placeable; assumes the placeable is tracked and need not be added/deleted.
   * @param {PlaceableObject} placeable
   * @returns {boolean} True if it resulted in a change.
   */
  _updatePlaceable(placeable) {
    const idx = this.instanceIndexFromId.get(placeable.id);
    this.#updateId += 1;
    this.updateInstanceBuffer(idx);
    return true;
  }

  /** @type {number[]} */
  _hooks = [];

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
  registerPlaceableHooks() {
    if ( this._hooks.length ) return; // Only register once.
    for ( const hookDatum of this.constructor.HOOKS ) {
      const [name, methodName] = Object.entries(hookDatum)[0];
      const id = Hooks.on(name, this[methodName].bind(this));
      this._hooks.push({ name, methodName, id });
    }
  }

  deregisterPlaceableHooks() {
    this._hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.length = 0;
  }

  /**
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * @param {Document} document                       The new Document instance which has been created
   * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
   * @param {string} userId                           The ID of the User who triggered the creation workflow
   */
  _onPlaceableCreation(document, _options, _userId) { this.addPlaceable(document.object); }

  /**
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * @param {Document} document                       The existing Document which was updated
   * @param {object} changed                          Differential data that was used to update the document
   * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
   * @param {string} userId                           The ID of the User who triggered the update workflow
   */
  _onPlaceableUpdate(document, changed, _options, _userId) {
    const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
    this.updatePlaceable(document.object, changeKeys);
  }

  /**
   * A hook event that fires for every Document type after conclusion of an deletion workflow.
   * @param {Document} document                       The existing Document which was deleted
   * @param {Partial<DatabaseDeleteOperation>} options Additional options which modified the deletion request
   * @param {string} userId                           The ID of the User who triggered the deletion workflow
   */
  _onPlaceableDeletion(document, _options, _userId) { this.removePlaceable(document.id); }

  /**
   * A hook event that fires when a {@link PlaceableObject} is initially drawn.
   * @param {PlaceableObject} object    The object instance being drawn
   */
  _onPlaceableDraw(object) { this.addPlaceable(object); }

  /**
   * A hook event that fires when a {@link PlaceableObject} is incrementally refreshed.
   * @param {PlaceableObject} object    The object instance being refreshed
   * @param {RenderFlags} flags
   */
  _onPlaceableRefresh(object, flags) {
    // TODO: Can flags be set to false? Need this filter if so.
    // const changeKeys = Object.entries(flags).filter([key, value] => value).map([key, value] => key);
    const changeKeys = Object.keys(flags);
    this.updatePlaceable(object, changeKeys);
  }

  /**
   * A hook event that fires when a {@link PlaceableObject} is destroyed.
   * @param {PlaceableObject} object    The object instance being destroyed
   */
  _onPlaceableDestroy(object) { this.removePlaceable(object.id); }
}

export class WallInstanceHandler extends PlaceableInstanceHandler {
  static HOOKS = [
    { createWall: "_onPlaceableCreation" },
    { updateWall: "_onPlaceableUpdate" },
    { removeWall: "_onPlaceableDeletion" },
  ];

  /**
   * Change keys in updateWall hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
    "x",
    "y",
    "flags.elevatedvision.elevation.top",
    "flags.elevatedvision.elevation.bottom",
    "flags.wall-height.top",
    "flags.wall-height.top",
    "c",
    "dir",
  ]);


  /**
   * Get walls in the scene.
   */
  getPlaceables() {
    return canvas.walls.placeables.filter(wall => this.includePlaceable(wall));
  }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(idx) {
    const edge = this.placeableFromInstanceIndex.get(idx)?.edge;
    if ( !edge ) return;

    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;

    const pos = this.constructor.edgeCenter(edge);
    const { top, bottom } = this.constructor.edgeElevation(edge);
    const rot = this.constructor.edgeAngle(edge);
    const ln = this.constructor.edgeLength(edge);

    // Add in translate to center to 0,0 if elevations do not match.
    // e.g., bottom elevation -1e05, top elevation 200.
    let z = 0.0;
    let scaleZ = 1.0;
    if ( top != bottom ) {
      z = ((0.5 * top) + (0.5 * bottom));
      scaleZ = top - bottom;
    }

    // Move from center of wall.
    MatrixFloat32.translation(pos.x, pos.y, z, translationM);

    // Scale by its length and elevation (height).
    MatrixFloat32.scale(ln, 1.0, scaleZ, scaleM);

    // Rotate around Z axis to match wall direction.
    MatrixFloat32.rotationZ(rot, true, rotationM);

    return super.updateInstanceBuffer(idx,
      { rotation: rotationM, translation: translationM, scale: scaleM });
  }

  rotationMatrixForInstance(idx) {
    const edge = this.placeableFromInstanceIndex.get(idx)?.edge;
    if ( !edge ) return super.rotationMatrixForInstance(idx);
    const rot = this.constructor.edgeAngle(edge);
    MatrixFloat32.rotationZ(rot, true, rotationM);
    return rotationM;
  }

  /**
   * Determine the top and bottom edge elevations. Null values will be given large constants.
   * @param {Edge} edge
   * @returns {object}
   * - @prop {number} top         1e05 if null
   * - @prop {number} bottom      -1e05 if null
   */
  static edgeElevation(edge) {
    let { top, bottom } = edge.elevationLibGeometry.a;
    top ??= 1e05;
    bottom ??= -1e05;
    top = CONFIG.GeometryLib.utils.gridUnitsToPixels(top);
    bottom = CONFIG.GeometryLib.utils.gridUnitsToPixels(bottom);
    return { top, bottom };
  }

  /**
   * Determine the 2d center point of the edge.
   * @param {Edge} edge
   * @returns {PIXI.Point}
   */
  static edgeCenter(edge) {
    const ctr = new PIXI.Point();
    return edge.a.add(edge.b, ctr).multiplyScalar(0.5, ctr);
  }

  /**
   * Determine the 2d length of the edge.
   * @param {Edge} edge
   * @returns {number}
   */
  static edgeLength(edge) { return PIXI.Point.distanceBetween(edge.a, edge.b); }

  /**
   * Angle of the edge on the 2d canvas.
   * @param {Edge} edge
   * @returns {number} Angle in radians
   */
  static edgeAngle(edge) {
    const delta = edge.b.subtract(edge.a, PIXI.Point._tmp3);
    return Math.atan2(delta.y, delta.x);
  }

  /**
   * Is this a terrain (limited) edge?
   * @param {Edge} edge
   * @returns {boolean}
   */
  static isTerrain(edge, { senseType = "sight" } = {}) {
    return edge[senseType] === CONST.WALL_SENSE_TYPES.LIMITED;
  }

  /**
   * Is this a directional edge?
   * @param {Edge} edge
   * @returns {boolean}
   */
  static isDirectional(edge) { return Boolean(edge.direction); }
}

export class NonTerrainWallInstanceHandler extends WallInstanceHandler {
  constructor({ senseType = "sight" } = {}) {
    super();
    this._senseType = senseType;
  }

  _senseType = "sight";

  get senseType() { return this._senseType; }

  set senseType(value) {
    this._senseType = value;
    this.initializePlaceables();
  }

  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return !this.constructor.isTerrain(wall.edge, { senseType: this.senseType });
  }
}

export class TerrainWallInstanceHandler extends WallInstanceHandler {
  constructor({ senseType = "sight" } = {}) {
    super();
    this._senseType = senseType;
  }

  _senseType = "sight"; // Avoid # b/c TypeError: Cannot initialize #senseType twice on the same object

  get senseType() { return this._senseType; }

  set senseType(value) {
    this._senseType = value;
    this.initializePlaceables();
  }

  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return this.constructor.isTerrain(wall.edge, { senseType: this.senseType });
  }
}

export class NonDirectionalWallInstanceHandler extends NonTerrainWallInstanceHandler {
  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return !this.constructor.isDirectional(wall.edge);
  }
}

export class DirectionalWallInstanceHandler extends NonTerrainWallInstanceHandler {
  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return this.constructor.isDirectional(wall.edge);
  }
}

export class NonDirectionalTerrainWallInstanceHandler extends TerrainWallInstanceHandler {
  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return !this.constructor.isDirectional(wall.edge);
  }
}

export class DirectionalTerrainWallInstanceHandler extends TerrainWallInstanceHandler {
  includePlaceable(wall) {
    if ( !super.includePlaceable(wall) ) return false;
    return this.constructor.isDirectional(wall.edge);
  }
}

export class TileInstanceHandler extends PlaceableInstanceHandler {
  static HOOKS = [
    { createTile: "_onPlaceableCreation" },
    { updateTile: "_onPlaceableUpdate" },
    { removeTile: "_onPlaceableDeletion" },
  ];

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
    "x",
    "y",
    "elevation",
    "width",
    "height",
    "rotation",
  ]);

  /**
   * Get tiles in the scene.
   */
  getPlaceables() {
    return canvas.tiles.placeables.filter(tile => this.includePlaceable(tile));
  }

  /**
   * Should this tile be included in the scene render?
   */
  includePlaceable(tile) {
    // Exclude tiles at elevation 0 because these overlap the ground.
    if ( !tile.elevationZ ) return false;

    // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
    if ( MODULES_ACTIVE.LEVELS
      // && this.senseType === "sight"
      && tile.document?.flags?.levels?.noCollision ) return false;

    return true;
  }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   */
  updateInstanceBuffer(idx) {
    const tile = this.placeableFromInstanceIndex.get(idx);
    if ( !tile ) return;
    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;

    const ctr = this.constructor.tileCenter(tile);
    const { width, height } = this.constructor.tileDimensions(tile);

    // Move from center of tile.
    MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, translationM);

    // Scale based on width, height of tile.
    MatrixFloat32.scale(width, height, 1.0, scaleM);

    // Rotate based on tile rotation.
    MatrixFloat32.rotationZ(this.constructor.tileRotation(tile), true, rotationM);

    return super.updateInstanceBuffer(idx,
      { rotation: rotationM, translation: translationM, scale: scaleM });
  }

  rotationMatrixForInstance(idx) {
    const tile = this.placeableFromInstanceIndex.get(idx);
    if ( !tile ) return super.rotationMatrixForInstance(idx);
    const rot = this.constructor.tileRotation(tile)
    MatrixFloat32.rotationZ(rot, true, rotationM);
    return rotationM;
  }

  /**
   * Determine the tile rotation.
   * @param {Tile} tile
   * @returns {number}    Rotation, in radians.
   */
  static tileRotation(tile) { return Math.toRadians(tile.document.rotation); }

  /**
   * Determine the tile 3d dimensions, in pixel units.
   * Omits alpha border.
   * @param {Tile} tile
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} elevation   In z direction
   */
  static tileDimensions(tile) {
    const { x, y, width, height } = tile.document;
    return {
      x, y, width, height,
      elevation: tile.elevationZ,
    };
  }

  /**
   * Determine the center of the tile, in pixel units.
   * @param {Tile} tile
   * @returns {Point3d}
   */
  static tileCenter(tile) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const out = new Point3d();
    const { x, y, width, height, elevation } = this.tileDimensions(tile);
    const TL = Point3d._tmp2.set(x, y, elevation);
    const BR = TL.add(out.set(width, height, 0), out);
    return TL.add(BR, out).multiplyScalar(0.5, out)
  }
}

export class TokenInstanceHandler extends PlaceableInstanceHandler {
  static HOOKS = [
    { drawToken: "_onPlaceableDraw" },
    { refreshToken: "_onPlaceableRefresh" },
    { destroyToken: "_onPlaceableDestroy" },
  ];

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
    "refreshPosition",
    "refreshSize",
  ]);

  /**
   * Get edges in the scene.
   */
  getPlaceables() {
    return canvas.tokens.placeables.filter(token => this.includePlaceable(token));
  }

  /**
   * Should this token be included in the scene render?
   * Constrained tokens included here; handled later in prerender.
   */
  // includePlaceable(_token) { return true; }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updateInstanceBuffer(idx) {
    const token = this.placeableFromInstanceIndex.get(idx);
    if ( !token ) return;
    const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;

    const ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(token);
    const { width, height, zHeight } = this.constructor.tokenDimensions(token);

    // Move from center of token.
    MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, translationM);

    // Scale based on width, height, zHeight of token.
    MatrixFloat32.scale(width, height, zHeight, scaleM);

    return super.updateInstanceBuffer(idx,
      { translation: translationM, scale: scaleM });
  }

  /**
   * Determine the token 3d dimensions, in pixel units.
   * @param {Token} token
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} zHeight     In z direction
   */
  static tokenDimensions(token) {
    // Shrink tokens slightly to avoid z-fighting with walls and tiles.
    return {
      width: token.document.width * canvas.dimensions.size * .99,
      height: token.document.height * canvas.dimensions.size * .99,
      zHeight: (token.topZ - token.bottomZ) * .99,
    };
  }
}

export class SceneInstanceHandler extends TileInstanceHandler {
  static HOOKS = []; // TODO: Scene hook if the scene background changes?

  getPlaceables() {
    if ( !canvas.scene.background.src ) return [];
    return [{ id: canvas.scene.id, ...canvas.scene.background}];
  }

  // includePlaceable(sceneObj) { return Boolean(canvas.scene.background.src); }

  static tileRotation() { return 0; }

  static tileDimensions() { return canvas.dimensions.sceneRect; }

  static tileCenter() {
    const ctr = canvas.dimensions.rect.center;
    return new CONFIG.GeometryLib.threeD.Point3d(ctr.x, ctr.y, 0);
  }
}

export class RegionInstanceHandler extends PlaceableInstanceHandler {
  static HOOKS = [
    { createRegion: "_onPlaceableCreation" },
    { updateTile: "_onPlaceableUpdate" },
    { removeTile: "_onPlaceableDeletion" },
  ];

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static UPDATE_KEYS = new Set([
    "flags.terrainmapper.elevationAlgorithm",
    "flags.terrainmapper.plateauElevation",
    "flags.terrainmapper.rampFloor",
    "flags.terrainmapper.rampDirection",
    "flags.terrainmapper.rampStepSize",
    "flags.terrainmapper.splitPolygons",

    "elevation.bottom",
    "elevation.top",

    "shapes",
  ]);

  /**
   * Get relevant regions in the scene.
   */
  getPlaceables() {
    return canvas.regions.placeables.filter(region => this.includePlaceable(region));
  }

  /**
   * Should this regino be included in the scene render?
   */
  includePlaceable(region) {
    if ( region.shapes.length === 0 ) return false;
    if ( !game.modules.has("terrainmapper") ) return false;

    // TODO: Change this to a setting in the region config, and specifies sense type(s) that block.
    if ( !CONFIG[MODULE_ID].regionsBlock ) return false;

    // TODO: Allow None to block using the elevation range. Use the sense type choice to filter.
    const algo = region.document.getFlag("terrainmapper", "elevationAlgorithm");
    return algo && (algo === "ramp" || algo === "plateau");
  }

  /**
   * Update the instance array of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   */
  updateInstanceBuffer(idx) {
    const region = this.placeableFromInstanceIndex.get(idx);
    if ( !region ) return;
//     const MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32;
//
//     const ctr = this.constructor.tileCenter(tile);
//     const { width, height } = this.constructor.tileDimensions(tile);
//
//     // Move from center of tile.
//     MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, translationM);
//
//     // Scale based on width, height of tile.
//     MatrixFloat32.scale(width, height, 1.0, scaleM);
//
//     // Rotate based on tile rotation.
//     MatrixFloat32.rotationZ(this.constructor.tileRotation(tile), true, rotationM);
//
//     return super.updateInstanceBuffer(idx,
//       { rotation: rotationM, translation: translationM, scale: scaleM });
  }

}
