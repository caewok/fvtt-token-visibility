/* globals
canvas,
CONFIG,
CONST,
foundry,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


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
export class UpdateTracker() {

  static trackedDocumentCreationDeletion = {
    Token: 0,
    Wall: 0,
    Tile: 0,
    AmbientLight: 0,
    Sound: 0,
    Region: 0,
  }

  static trackedDocumentChange = {

  }


  static trackedDocumentAttributes = {
    Token: new Set(),
    Wall: new Set(),
    Tile: new Set(),
    AmbientLight: new Set(),
    AmbientSound: new Set(),
    Region: new Set(),
  }

  static trackedPlaceableAttributes = {
    Token: new Set(),
    Wall: new Set(),
    Tile: new Set(),
    AmbientLight: new Set(),
    AmbientSound: new Set(),
    Region: new Set(),
  }

  static #createDeleteHooks = [];

  static registerCreationDeletionHooks() {
    if ( this.#createDeleteHooks.length ) return; // Only register once.
    const method = this._onPlaceableDocumentCreationDeletion;
    for ( const key of Object.keys(this.trackedDocumentCreationDeletion) ) {
      const createName = `create${key}`;
      const createId = Hooks.on(createName, method.bind(this, key));
      this.#createDeleteHooks.push({ name: createName, method, id: createId });

      const deleteName = `remove${key}`;
      const deleteId = Hooks.on(deleteName, method.bind(this, key));
      this.#createDeleteHooks.push({ name: deleteName, method, id: deleteId });
    }
  }

  static deregisterHooks() {
    this.#createDeleteHooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this.#createDeleteHooks.length = 0;
  }

  /**
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * @param {Document} document                       The new Document instance which has been created
   * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
   * @param {string} userId                           The ID of the User who triggered the creation workflow
   */
  static _onPlaceableDocumentCreationDeletion(type, document, _options, _userId) {
    this.trackedDocumentCreationDeletion[type] += 1;
  }

  static addTrackedDocumentAttributes(type, attributes = []) {
    if ( !(new Set(Object.keys(this.trackedDocumentAttributes))).has(type) ) {
      console.error(`${this.constructor.name}|addTrackedDocumentAttributes|type ${type} not recognized.`);
      return;
    }
    if ( !this.trackedDocumentAttributes[type].size ) this.
  }

  /**
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * @param {Document} document                       The existing Document which was updated
   * @param {object} changed                          Differential data that was used to update the document
   * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
   * @param {string} userId                           The ID of the User who triggered the update workflow
   */
  static _onPlaceableUpdate(document, changed, _options, _userId) {
    const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
    this.updatePlaceable(document.object, changeKeys);
  }

  /**
   * A hook event that fires for every Document type after conclusion of an deletion workflow.
   * @param {Document} document                       The existing Document which was deleted
   * @param {Partial<DatabaseDeleteOperation>} options Additional options which modified the deletion request
   * @param {string} userId                           The ID of the User who triggered the deletion workflow
   */
  static _onPlaceableDeletion(document, _options, _userId) { this.removePlaceable(document.id); }

  /**
   * A hook event that fires when a {@link PlaceableObject} is initially drawn.
   * @param {PlaceableObject} object    The object instance being drawn
   */
  static _onPlaceableDraw(object) { this.addPlaceable(object); }

  /**
   * A hook event that fires when a {@link PlaceableObject} is incrementally refreshed.
   * @param {PlaceableObject} object    The object instance being refreshed
   * @param {RenderFlags} flags
   */
  static _onPlaceableRefresh(object, flags) {
    // TODO: Can flags be set to false? Need this filter if so.
    // const changeKeys = Object.entries(flags).filter([key, value] => value).map([key, value] => key);
    const changeKeys = Object.keys(flags);
    this.updatePlaceable(object, changeKeys);
  }

  /**
   * A hook event that fires when a {@link PlaceableObject} is destroyed.
   * @param {PlaceableObject} object    The object instance being destroyed
   */
  static _onPlaceableDestroy(object) { this.removePlaceable(object.id); }




}

