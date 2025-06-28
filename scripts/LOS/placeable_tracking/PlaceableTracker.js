/* globals
canvas,
CONFIG,
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";
import { FixedLengthTrackingBuffer } from "./TrackingBuffer.js";
import { isString } from "../util.js";

// Base folder


// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const rotationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const identityM = MatrixFloat32.identity(4, 4);



/**
Track when given placeables are added, updated or removed.
Base class sets up the hooks and calls a base update method.
Instance class tracks translation/scale/rotation matrices.
*/

export class PlaceableTracker {

  /**
   * Only keep one instance of each handler type. Class and sense type.
   * @type {Map<string, PlaceableInstanceHandler>}
   */
  static handlers = new WeakMap();

  /**
   * Change keys in updateDocument hook that indicate a relevant change to the placeable.
   */
  static docUpdateKeys = new Set();

  /**
   * Flags in refreshObject hook that indicate a relevant change to the placeable.
   */
  static refreshFlags = new Set();

  /** @type {string} */
  static layer = ""; // e.g. "walls"

  /**
   * Build a new Placeable Tracker and cache to reuse in future.
   */
  static cachedBuild() {
    const handlers = this.handlers;
    if ( handlers.has(this) ) return handlers.get(this);
    const out = new this();
    handlers.set(this, out);
    return out;
  }

  getPlaceableFromId(id) {
    // const suffix = ".preview$";
    // const escapedSuffix = suffix.replace(/\./g, "\\.");
    // const regex = new RegExp(escapedSuffix);
    const isPreview = id.endsWith(".preview");
    const regex = /\.preview$/;
    id = id.replace(regex, "");
    const doc = canvas[this.constructor.layer].documentCollection.get(id);
    if ( !doc ) return null;
    return isPreview ? (doc.object._preview ?? doc.object) : doc.object;
  }

  /**
   * Track when each placeable was last updated.
   * @type {Map<PlaceableObject, number>}
   */
  placeableLastUpdated = new foundry.utils.IterableWeakMap();

  hasPlaceable(placeable) { return this.placeableLastUpdated.has(placeable); }

  get placeables() { return this.placeableLastUpdated.keys(); }

  /**
   * Initialize all placeables.
   */
  initializePlaceables() {
    const oldPlaceables = new Set([...this.placeables]);
    const newPlaceables = new Set([...this.getPlaceables()]);
    const toDelete = oldPlaceables.difference(newPlaceables);
    const toAdd = newPlaceables.difference(oldPlaceables);
    if ( !toDelete.size && !toAdd.size ) return;
    this.#updateId += 1;
    toDelete.forEach(p => {
      this.placeableLastUpdated.delete(p);
      this._removePlaceables(p, p.id);
    });
    toAdd.forEach(p => {
      this.placeableLastUpdated.set(p, this.#updateId);
      this._addPlaceable(p);
    });
  }

  /**
   * Subclass locate placeables.
   * @returns {Placeable|Edge[]}
   * @override
   */
  getPlaceables() { return canvas[this.constructor.layer].placeables.filter(p => this.includePlaceable(p)); }

  /**
   * Subclass test for placeable inclusion in the instance array.
   * @param {Placeable|Edge}
   * @returns {boolean}
   * @override
   */
  includePlaceable(_placeable) { return true; }


  /* ----- NOTE: Hooks and updating ----- */

  // Increment every time there is an update.
  /** @type {number} */
  #updateId = 0;

  get updateId() { return this.#updateId; }

  /** @type {Set<string>} */
  static UPDATE_KEYS = new Set();

  /**
   * Add the placeable to the instance array. May trigger a rebuild of the array.
   * @param {PlaceableObject} placeable
   * @returns {boolean} True if it resulted in a change.
   */
  addPlaceable(placeable) {
    if ( this.hasPlaceable(placeable) ) return false;
    if ( !this.includePlaceable(placeable) ) return false;

    this.#updateId += 1;
    this.placeableLastUpdated.set(placeable, this.#updateId);
    if ( !this._addPlaceable(placeable) ) this.initializePlaceables(); // Redo the instance buffer.
    return true;
  }

  /**
   * Update some data about the placeable in the array.
   * @param {PlaceableObject} placeable
   * @param {string[]} changeKeys       Change keys (flags/properties modified)
   * @returns {boolean} True if it resulted in a change.
   */
  updatePlaceable(placeable, changeKeys) {
    // Possible that the placeable needs to be added or removed instead of simply updated.
    const alreadyTracking = this.hasPlaceable(placeable);
    const shouldTrack = this.includePlaceable(placeable);
    if ( !(alreadyTracking && shouldTrack) ) return false;
    if ( alreadyTracking && !shouldTrack ) return this.removePlaceable(placeable.sourceId);
    else if ( !alreadyTracking && shouldTrack ) return this.addPlaceable(placeable);

    // If the changes include one or more relevant keys, update.
    if ( !changeKeys.some(key => this.constructor.UPDATE_KEYS.has(key)) ) return false;
    this.#updateId += 1;
    this.placeableLastUpdated.set(placeable, this.#updateId);
    if ( !this._updatePlaceable(placeable) ) this.initializePlaceables(); // Redo the instance buffer.
    return true;
  }

  _placeableOrId(placeable) {
    let placeableId;
    if ( isString(placeable) ) {
      placeableId = placeable;
      placeable = this.getPlaceableFromId(placeableId);
    } else placeableId = placeable.sourceId;
    return { placeable, placeableId };
  }

  /**
   * Remove the placeable from the instance array. Simply removes the associated index
   * without rebuilding the array.
   * @param {PlaceableObject|string} placeable object or its id
   * @returns {boolean} True if it resulted in a change.
   */
  removePlaceable(placeableOrId) {
    // Attempt to retrieve the placeable and its id. Placeable may be undefined.
    const { placeable, placeableId } = this._placeableOrId(placeableOrId);
    if ( placeable ) {
      if ( !this.hasPlaceable(placeable) ) return false;
      this.placeableLastUpdated.delete(placeable);
    }
    if ( !this._removePlaceable(placeable, placeableId) ) this.initializePlaceables();
    this.#updateId += 1;
    return true;
  }

  // Subclass methods

  /**
   * Attempt to add the placeable to the tracker.
   * Return false if unable to add, triggering re-initialization of the placeables.
   */
  _addPlaceable(_placeable) { return true; }

  _updatePlaceable(_placeable) { return true; }

  _removePlaceable(_placeable, _placeableId) { return true; }

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
    this.initializePlaceables();
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
  _onPlaceableDestroy(object) { this.removePlaceable(object); }
}

/**
 * Update a 4x4 matrix (stored as 16-element array) as placeables are updated.
 * Tracks rotation, scale, translation.
 * Uses ids to track b/c the placeables do not necessarily get deleted (gc'd) when removed from canvas.
 * Particularly true of tokens.
 */
export class PlaceableModelMatrixTracker extends PlaceableTracker {

  /** @type {number} */
  static MODEL_ELEMENT_LENGTH = 16; // Single mat4x4.

  static MODEL_ELEMENT_SIZE = this.MODEL_ELEMENT_LENGTH * Float32Array.BYTES_PER_ELEMENT;

  get modelMatrixBuffer() { return this.tracker.buffer; }

  /** @type {FixedLengthTrackingBuffer} */
  tracker;

  initializePlaceables() {
    if ( !this.tracker ) {
      const placeables = [...this.placeables];
      this.tracker = new FixedLengthTrackingBuffer({
        numFacets: placeables.length,
        facetLengths: this.constructor.MODEL_ELEMENT_LENGTH,
        ids: placeables.map(p => p.id)
      });
    }
    super.initializePlaceables();
  }

  rotationMatrixForPlaceable(_placeable) { return identityM.copyTo(rotationM); }

  translationMatrixForPlaceable(_placeable) { return identityM.copyTo(translationM); }

  scaleMatrixForPlaceable(_placeable) { return identityM.copyTo(scaleM); }

  getMatrixForPlaceable(placeable) {
    const arr = this.tracker.viewFacetById(placeable.sourceId);
    if ( !arr ) return null;
    return new CONFIG.GeometryLib.MatrixFloat32(arr, 4, 4);
  }

  /**
   * Update the model matrix of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updatePlaceableModelMatrix(placeable) {
    const M = this.getMatrixForPlaceable(placeable);
    if ( !M ) return;
    const rotation = this.rotationMatrixForPlaceable(placeable);
    const translation = this.translationMatrixForPlaceable(placeable);
    const scale = this.scaleMatrixForPlaceable(placeable);
    scale
      .multiply4x4(rotation, M)
      .multiply4x4(translation, M);
  }

  _addPlaceable(placeable) {
    // TODO: Do we need to track if the buffer was modified?
    const bufferModified = this.tracker.addFacet({ id: placeable.sourceId });
    this.updatePlaceableModelMatrix(placeable);
    return true;
  }

  _updatePlaceable(placeable) {
    this.updatePlaceableModelMatrix(placeable);
    return true;
  }

  _removePlaceable(_placeable, placeableId) {
    // TODO: Do we need to track if the buffer was modified?
    const bufferModified = this.tracker.deleteFacet(placeableId);
    return true;
  }
}

/** Testing
api = game.modules.get("tokenvisibility").api;
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
let { TileTracker, TokenTracker, WallTracker, RegionTracker } = api.placeableTracker;

tileH = TileTracker.cachedBuild()
tokenH = TokenTracker.cachedBuild()
wallH = WallTracker.cachedBuild()
regionH = RegionTracker.cachedBuild()

tileH.initializePlaceables();
tokenH.initializePlaceables();
wallH.initializePlaceables();
regionH.initializePlaceables();

*/
