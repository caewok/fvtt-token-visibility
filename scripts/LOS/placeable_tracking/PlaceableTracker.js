/* globals
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";
import { FixedLengthTrackingBuffer } from "./TrackingBuffer.js";

// Base folder


// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const rotationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const tmpMat = MatrixFloat32.identity(4, 4);

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

  /**
   * Initialize all placeables.
   */
  initializePlaceables() {
    this.instanceIndexFromId.clear();
    this.placeableFromInstanceIndex.clear();
    const placeables = this.getPlaceables();
    this._initializePlaceables(placeables);
    placeables.forEach((placeable, idx) => this._initializePlaceable(placeable, idx));
  }

  _initializePlaceables(placeables) { return; }

  /**
   * Initialize a single placeable at a given index.
   * @param {PlaceableObject|Edge} placeable
   * @param {number} idx
   */
  _initializePlaceable(placeable, idx) {
    // TODO: Are these maps still needed?
    this.instanceIndexFromId.set(placeable.id, idx);
    this.placeableFromInstanceIndex.set(idx, placeable);
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


  /* ----- NOTE: Hooks and updating ----- */

  // Increment every time the buffer is created.
  /** @type {number} */
  #bufferId = 0;

  get bufferId() { return this.#bufferId; }

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
    if ( this.instanceIndexFromId.has(placeable.id) ) return false;
    if ( !this.includePlaceable(placeable) ) return false;

    this.#updateId += 1;
    this.instanceIndexFromId.set(idx, placeable.id);
    this.placeableFromInstanceIndex.set(idx, placeable);
    this.instanceLastUpdated.set(idx, this.#updateId);
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
    const alreadyTracking = this.instanceIndexFromId.has(placeable.id);
    const shouldTrack = this.includePlaceable(placeable);
    if ( !(alreadyTracking && shouldTrack) ) return false;
    if ( alreadyTracking && !shouldTrack ) return this.removePlaceable(placeable.id);
    else if ( !alreadyTracking && shouldTrack ) return this.addPlaceable(placeable);

    // If the changes include one or more relevant keys, update.
    if ( !changeKeys.some(key => this.constructor.UPDATE_KEYS.has(key)) ) return false;
    const idx = this.instanceIndexFromId.get(placeable.id);
    this.#updateId += 1;
    this.instanceLastUpdated.set(idx, this.#updateId);
    if ( !this._updatePlaceable(placeable) ) this.initializePlaceables(); // Redo the instance buffer.
    return true;
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
    if ( !this._removePlaceable(placeableId) ) this.initializePlaceables(); // Redo the instance buffer.
    return true;
  }

  // Subclass methods

  /**
   * Attempt to add the placeable to the tracker.
   * Return false if unable to add, triggering re-initialization of the placeables.
   */
  _addPlaceable(placeable) { return true; }

  _updatePlaceable(placeable) { return true; }

  _removePlaceable(placeableId) { return true; }

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

/**
 * Update a 4x4 matrix (stored as 16-element array) as placeables are updated.
 * Tracks rotation, scale, translation.
 */
export class PlaceableModelMatrixTracker extends PlaceableTracker {

  /** @type {number} */
  static MODEL_ELEMENT_LENGTH = 16; // Single mat4x4.

  static MODEL_ELEMENT_SIZE = this.MODEL_ELEMENT_LENGTH * Float32Array.BYTES_PER_ELEMENT;

  get modelMatrixBuffer() { return this.tracker.buffer; }

  /** @type {FixedLengthTrackingBuffer} */
  tracker;

  _initializePlaceables(placeables) {
    const tracker = this.tracker = new FixedLengthTrackingBuffer(placeables.length, { facetLengths: this.constructor.MODEL_ELEMENT_LENGTH });

    // Track placeable ids so removing placeables is easier.
    placeables.forEach((placeable, idx) => tracker.setFacetId(placeable.id, idx));
  }

  _initializePlaceable(placeable, idx) {
    super._initializePlaceable(placeable, idx);

    // Track placeable ids so removing placeables is easier.
    this.tracker.setFacetId(placeable.id, idx);
  }

  rotationMatrixForPlaceable(placeable) { return identityM.copyTo(rotationM); }

  translationMatrixForPlaceable(placeable) { return identityM.copyTo(translationM); }

  scaleMatrixForPlaceable(placeable) { return identityM.copyTo(scaleM); }

  getMatrixForPlaceableId(placeableId) {
    const arr = this.tracker.viewFacetForId(placeableId);
    return new CONFIG.GeometryLib.MatrixFloat32(arr, 4, 4);
  }

  /**
   * Update the model matrix of a specific placeable.
   * @param {string} placeableId          Id of the placeable
   * @param {number} [idx]                Optional placeable index; will be looked up using placeableId otherwise
   * @param {Placeable|Edge} [placeable]  The placeable associated with the id; will be looked up otherwise
   */
  updatePlaceableModelMatrix(placeable) {
    const rotation = this.rotationMatrixForPlaceable(placeable);
    const translation = this.translationMatrixForPlaceable(placeable);
    const scale = this.scaleMatrixForPlaceable(placeable);
    const M = this.getMatrixForPlaceableId(placeable.id);
    scale
      .multiply4x4(rotation, M)
      .multiply4x4(translation, M);
  }

  _addPlaceable(placeable) {
    // TODO: Do we need to track if the buffer was modified?
    const bufferModified = this.tracker.addFacet({ id: placeable.id });
    this.updatePlaceableModelMatrix(placeable);
    return true;
  }

  _updatePlaceable(placeable) {
    this.updatePlaceableModelMatrix(placeable);
    return true;
  }

  _removePlaceable(placeableId) {
    // TODO: Do we need to track if the buffer was modified?
    const bufferModified = this.tracker.deleteFacetById(placeableId);
    return true;
  }
}
