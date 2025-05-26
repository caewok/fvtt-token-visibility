/* globals
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/*
1. Basic vision caching.
At vision test:
No cached value --> calculate and store, synchronously.
Cached value -->
  --> Change to viewer, target, or other placeable --> recalculate and store, synchronously
  --> No change? --> Use cached value.

Alternatives:
2. Delayed recalculation
At vision test:
No cached value --> Set to 0.
  --> Async calculation --> trigger new visibility test.
Cached value --> Use cached value.
  --> Change to viewer, target, or other placeable --> async calculation --> trigger new visibility test.
More complex and requires a dummy variable. Can avoid dummy value by calculating synchronously but then doing #1.

3. Calc on change.
On placeable change:
--> Async calculation queue --> On completion for each, set the cached value. Possibly trigger new visibility test.
At vision test:
--> Same as #1 but less likely to require new calcs.

Token visibility triggered on:
- Selecting 1+ tokens.
- Dragging or moving 1+ tokens.
- Triggered 2x when selecting tokne

Not triggered when editing walls, etc.
So #3 could help but would result in a lot of extra calls versus just waiting for token selection.

Then need to track:
- Changes to obstacles; any change counts.
- Per-token changes, including movement changes that are not document-based changes.

*/


/*
Hook placeable and placeable document updates.

Each time one updates, increment a counter.


Documents:
- use change keys; track only certain keys.

Placeables:
- use render flags; track only certain flags.


Any function can query the update for the latest counter increment.
If the counter is higher than the stored one, something changed since last query.


Track per placeable.


1 Token moves y
{ x: 0, y: 1, elevation: 0, width: 0, height: 0 }

2 Token moves x
{ x: 1, y: 1, elevation: 0, width: 0, height: 0 }

3 token moves y
{ x: 1, y: 2, elevation: 0, width: 0, height: 0 }

4 Token moves elevation
{ x: 1, y: 2, elevation: 1, width: 0, height: 0 }

5 Token width, height change
{ x: 1, y: 2, elevation: 1, width: 1, height: 1 }

6 Token moves x,y
{ x: 2, y: 3, elevation: 1, width: 1, height: 1 }

Track x, y, elevation. Each needs to be handled separately.

{x: 0, y:0, elevation:0}

1. { y: 1} --> {x: 0, y: 1, elevation: 0 } --> update
2. { x: 1 } --> {x: 1} --> update
3. { y: 2 } --> {y: 2} --> update
4. { elevation: 1} --> { elevation: 1} --> update
5. {width: 1, height: 1 } --> {} --> no update
6. { x: 2, y: 3} --> {x: 2, y: 3} --> update
*/

// TODO: Track if any placeable / placeableDoc has been created or destroyed.

/**
 * Update hooks handled by the instance.
 * Create an instance to track specific qualities.
 */
export class DocumentUpdateTracker {
  static LOS_ATTRIBUTES = {
    Wall: [
      "c",
      "flags.elevatedvision.elevation.top",
      "flags.elevatedvision.elevation.bottom",
      "flags.wall-height.top",
      "flags.wall-height.top",
      "dir",
    ],
    Tile: [
      "x",
      "y",
      "elevation",
      "width",
      "height",
      "rotation",
    ],
    // TODO: Region
  };

  /**
   * @typedef {Map<string, number>} AttributeMap
   * Holds counters that is incremented whenever its respective attribute is changed.
   */

  static trackedDocumentCreation = {
    Token: 0,
    Wall: 0,
    Tile: 0,
    AmbientLight: 0,
    Sound: 0,
    Region: 0,
  }

  static trackedDocumentDeletion = {
    Token: 0,
    Wall: 0,
    Tile: 0,
    AmbientLight: 0,
    Sound: 0,
    Region: 0,
  }

  static trackedDocumentUpdateAttributes = {
    Token: new Map(),
    Wall: new Map(),
    Tile: new Map(),
    AmbientLight: new Map(),
    AmbientSound: new Map(),
    Region: new Map(),
  }

  // Not currently used but could be use to track placeable refresh, e.g. preview token movement.
  /*
  static trackedPlaceableAttributes = {
    Token: new Map(),
    Wall: new Map(),
    Tile: new Map(),
    AmbientLight: new Map(),
    AmbientSound: new Map(),
    Region: new Map(),
  }
  */

  static #createDocumentHooks = [];

  static #updateDocumentHooks = [];

  static #removeDocumentHooks = [];

  static registerCreateDocumentHook(type) {
    if ( this.#createDocumentHooks.some(obj => obj.type === type) ) return; // Only register once.
    const name = `create${type}`;
    const method = this._onPlaceableDocumentCreation;
    const id = Hooks.on(name, method.bind(this, type));
    this.#createDocumentHooks.push({ name, method, id, type});
  }

  static registerUpdateDocumentHook(type) {
    if ( this.#updateDocumentHooks.some(obj => obj.type === type) ) return; // Only register once.
    const name = `update${type}`;
    const method = this._onPlaceableDocumentUpdate;
    const id = Hooks.on(name, method.bind(this, type));
    this.#updateDocumentHooks.push({ name, method, id, type});
  }

  static registerRemoveDocumentHook(type) {
    if ( this.#removeDocumentHooks.some(obj => obj.type === type) ) return; // Only register once.
    const name = `delete${type}`;
    const method = this._onPlaceableDocumentDeletion;
    const id = Hooks.on(name, method.bind(this, type));
    this.#removeDocumentHooks.push({ name, method, id, type});
  }

  static deregisterHooks() {
    this.#createDocumentHooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this.#updateDocumentHooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this.#removeDocumentHooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this.#createDocumentHooks.length = 0;
    this.#updateDocumentHooks.length = 0;
    this.#removeDocumentHooks.length = 0;
  }

  /**
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * @param {Document} document                       The new Document instance which has been created
   * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
   * @param {string} userId                           The ID of the User who triggered the creation workflow
   */
  static _onPlaceableDocumentCreation(type, _document, _options, _userId) {
    this.trackedDocumentCreation[type] += 1;
  }

  /**
   * A hook event that fires for every Document type after conclusion of an deletion workflow.
   * Substitute the Document name in the hook event to target a specific Document type, for example "deleteActor".
   * This hook fires for all connected clients after the deletion has been processed.
   *
   * @event deleteDocument
   * @category Document
   * @param {Document} document                       The existing Document which was deleted
   * @param {Partial<DatabaseDeleteOperation>} options Additional options which modified the deletion request
   * @param {string} userId                           The ID of the User who triggered the deletion workflow
   */
  static _onPlaceableDocumentDeletion(type, _document, _options, _userId) {
    this.trackedDocumentDeletion[type] += 1;
  }

  /**
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * @param {Document} document                       The existing Document which was updated
   * @param {object} changed                          Differential data that was used to update the document
   * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
   * @param {string} userId                           The ID of the User who triggered the update workflow
   */
  static _onPlaceableDocumentUpdate(type, _document, changed, _options, _userId) {
    const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
    const attrMap = this.trackedDocumentUpdateAttributes[type];
    for ( const key of changeKeys ) {
      if ( !attrMap.has(key) ) continue;
      attrMap.set(key, attrMap.get(key) + 1);
    }
  }

  static trackDocumentCreation(type) {
    if ( typeof this.trackedDocumentCreation[type] === "undefined" ) {
      console.error(`${this.constructor.name}|trackDocumentCreation|type ${type} not recognized.`);
      return;
    }
    this.registerCreateDocumentHook(type);
  }

  static trackDocumentDeletion(type) {
    if ( typeof this.trackedDocumentDeletion[type] === "undefined" ) {
      console.error(`${this.constructor.name}|trackDocumentDeletion|type ${type} not recognized.`);
      return;
    }
    this.registerRemoveDocumentHook(type);
  }

  static trackDocumentAttributes(type, attributes = []) {
    if ( !this.trackedDocumentUpdateAttributes[type] ) {
      console.error(`${this.constructor.name}|trackDocumentAttributes|type ${type} not recognized.`);
      return;
    }
    this.registerUpdateDocumentHook(type);
    attributes.forEach(attr => this.trackedDocumentUpdateAttributes[type].set(attr, 0));
  }

  static trackDocument(type, attributes = []) {
    this.trackDocumentCreation(type);
    this.trackDocumentDeletion(type);
    this.trackDocumentAttributes(type, attributes);
  }

  /** @type {number} */
  #creationKey = -1; // Set to -1 to force update the first time.

  /** @type {number} */
  #deletionKey = -1; // Set to -1 to force update the first time.

  /** @type {number} */
  #attributeKeys = new Map();

  /** @type {string} */
  type = ""

  constructor(type, attributes) {
    this.type = type;
    this.constructor.trackDocument(type, attributes);

    // Set each attribute key to -1 to force update on each the first time.
    const attrMap = this.#attributeKeys;
    attributes.forEach(attr => attrMap.set(attr, -1));
  }

  /**
   * Check for whether type was created or deleted since last update, but do not store the change.
   * If called repeatedly, will return the same value each time.
   * @returns {boolean}
   */
  get creationOccurred() { return this.constructor.trackedDocumentCreation[this.type] > this.#creationKey }

  /**
   * Store the latest creation/deletion trigger.
   * If called repeatedly, will return false after the first time until (another) update occurs.
   * @returns {boolean} True if an update was required.
   */
  logCreation() {
    const needsUpdate = this.creationOccurred;
    this.#creationKey = this.constructor.trackedDocumentCreation[this.type];
    return needsUpdate;
  }

  /**
   * Check for whether type was created or deleted since last update, but do not store the change.
   * If called repeatedly, will return the same value each time.
   * @returns {boolean}
   */
  get deletionOccurred() { return this.constructor.trackedDocumentDeletion[this.type] > this.#deletionKey; }

  /**
   * Store the latest creation/deletion trigger.
   * If called repeatedly, will return false after the first time until (another) update occurs.
   * @returns {boolean} True if an update was required.
   */
  logDeletion() {
    const needsUpdate = this.deletionOccurred;
    this.#deletionKey = this.constructor.trackedDocumentDeletion[this.type];
    return needsUpdate;
  }

  /**
   * Check for whether type was updated since last update, but do not store the change.
   * If called repeatedly, will return the same value each time.
   * @returns {boolean}
   */
  get updateOccurred() {
    const attrMap = this.#attributeKeys;
    for ( const [key, value] of this.constructor.trackedDocumentUpdateAttributes[this.type].entries() ) {
      if ( !attrMap.has(key) ) continue;
      if ( value > attrMap.get(key) ) return true;
    }
    return false;
  }

  /**
   * Store the latest update trigger.
   * If called repeatedly, will return false after the first time until (another) update occurs.
   * @returns {boolean} True if an update was required.
   */
  logUpdate() {
    const needsUpdate = this.updateOccurred;
    if ( !needsUpdate ) return false;
    const attrMap = this.#attributeKeys;
    for ( const [key, value] of this.constructor.trackedDocumentUpdateAttributes[this.type].entries() ) {
      if ( !attrMap.has(key) ) continue;
      attrMap.set(key, value);
    }
    return needsUpdate;
  }
}

export class TokenUpdateTracker {
  /** @type {WeakMap<Token, AttributeMap>} */
  static trackedTokens = new WeakMap();

  /** @type {Set<string>} */
  static trackedAttributes = new Set();

  static #updateTokenHook;

  static #refreshTokenHook;

  static registerUpdateTokenDocumentHook() {
    if ( this.#updateTokenHook ) return; // Only register once.
    const name = `updateToken`;
    const method = this._onTokenDocumentUpdate;
    const id = Hooks.on(name, method.bind(this));
    this.#updateTokenHook = { name, method, id };
  }

  static registerRefreshTokenHook() {
    if ( this.#refreshTokenHook ) return; // Only register once.
    const name = `refreshToken`;
    const method = this._onTokenRefresh;
    const id = Hooks.on(name, method.bind(this));
    this.#refreshTokenHook = { name, method, id };
  }

  static deregisterHooks() {
    Hooks.off(this.#updateTokenHook.name, this.#updateTokenHook.id);
    Hooks.off(this.#refreshTokenHook.name, this.#refreshTokenHook.id);
    this.#updateTokenHook = undefined;
    this.#refreshTokenHook = undefined;
  }

  static buildAttributeMap() {
    const attrMap = new Map();
    this.trackedAttributes.forEach(attr => attrMap.set(attr, 0));
    return attrMap;
  }

  static #updateAttributeMap(token, changeKeys) {
    const attrMap = this.trackedTokens.get(token);
    for ( const key of changeKeys ) {
      if ( !this.trackedAttributes.has(key) ) continue;
      attrMap.set(key, (attrMap.get(key) || 0) + 1); // Key may be missing from this token's map.
    }
  }

  /**
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * @param {Document} document                       The existing Document which was updated
   * @param {object} changed                          Differential data that was used to update the document
   * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
   * @param {string} userId                           The ID of the User who triggered the update workflow
   */
  static _onTokenDocumentUpdate(document, changed, _options, _userId) {
    const token = document.object;
    if ( !token ) return;
    if ( !this.trackedTokens.has(token) ) this.trackedTokens.set(token, this.buildAttributeMap());
    const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
    this.#updateAttributeMap(token, changeKeys);
  }

  /**
   * A hook event that fires when a {@link PlaceableObject} is incrementally refreshed.
   * The dispatched event name replaces "Object" with the named PlaceableObject subclass, i.e. "refreshToken".
   * @event refreshObject
   * @category PlaceableObject
   * @param {PlaceableObject} object    The object instance being refreshed
   */
  static _onTokenRefresh(token, flags) {
    if ( !this.trackedTokens.has(token) ) this.trackedTokens.set(token, this.buildAttributeMap());

    // TODO: Are flags ever set to false and should be ignored?
    this.#updateAttributeMap(token, Object.keys(flags));
  }

  static trackTokenDocumentAttributes(attributes = []) {
    if ( !attributes.length ) return;
    this.registerUpdateTokenDocumentHook();
    attributes.forEach(attr => this.trackedAttributes.add(attr));
  }

  static trackTokenRefreshFlags(flags = []) {
    if ( !flags.length ) return;
    this.registerRefreshTokenHook();
    flags.forEach(flag => this.trackedAttributes.add(flag)); // Flags and attributes do not share names, so can combine here.
  }

  /** @type {WeakMap<Token, AttributeMap>} */
  trackedTokens = new WeakMap();

  constructor(attributes = [], flags = []) {
    this.constructor.trackTokenDocumentAttributes(attributes);
    this.constructor.trackTokenRefreshFlags(flags);
  }

  /**
   * Check for whether token was updated since last update, but do not store the change.
   * If called repeatedly, will return the same value each time.
   * @param {Token} token     The token to check for updates
   * @returns {boolean}
   */
  updateOccurred(token) {
    if ( !this.constructor.trackedTokens.has(token) ) return false;
    if ( !this.trackedTokens.has(token) ) this.trackedTokens.set(token, this.constructor.buildAttributeMap());
    const attrMap = this.trackedTokens.get(token);
    for ( const [key, value] of this.constructor.trackedTokens.get(token) ) {
      if ( !attrMap.has(key) ) continue;
      if ( value > attrMap.get(key) ) return true;
    }
    return false;
  }

  /**
   * Store the latest update trigger.
   * If called repeatedly, will return false after the first time until (another) update occurs.
   * @param {Token} token   The token to check for updates
   * @returns {boolean} True if an update was required.
   */
  logUpdate(token) {
    const needsUpdate = this.updateOccurred(token);
    if ( !needsUpdate ) return false;
    const attrMap = this.trackedTokens.get(token);
    for ( const [key, value] of this.constructor.trackedTokens.get(token).entries() ) {
      if ( !attrMap.has(key) ) continue;
      attrMap.set(key, value);
    }
    return needsUpdate;
  }

  static LOS_ATTRIBUTES = [
    "x",
    "y",
    "elevation",
    "width",
    "height",
  ];

  static LOS_FLAGS = [
    "refreshPosition",
    "refreshSize",
  ];
}
