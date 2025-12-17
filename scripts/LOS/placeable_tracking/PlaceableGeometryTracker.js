/* globals
canvas,
CONFIG,
foundry,
Hooks,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { ATV_ID, TRACKER_IDS } from "../../const.js";
import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";
import { AABB3d } from "../../geometry/AABB.js";
import { almostBetween } from "../../geometry/util.js";
import { FixedLengthTrackingBuffer } from "./TrackingBuffer.js";

/* Store key geometry information for each placeable.
- AABB
- rotation, scaling, and translation matrices from an ideal shape.
- Polygon3ds for faces
- Triangle3ds for faces
- Update key

Regions store information per-shape.
Matrices are stored in a single buffer in the static class property
Tracks only changes to the physical representation of the placeable in the scene
Stored on each placeable
*/

/** Abstract class
- Create object on each placeable
- Hooks to trigger updates
- Tracking update number
*/

/** @type {MatrixFlat<4,4>} */
const identityM = MatrixFloat32.identity(4, 4);
Object.freeze(identityM);

export class AbstractPlaceableGeometryTracker {
  static ID = TRACKER_IDS.GEOMETRY.PLACEABLE;

  /* ----- NOTE: Hooks ----- */

  /**
   * @typedef {object} PlaceableHookData
   * Description of a hook to use.
   * @prop {object} name: methodName        Name of the hook and method; e.g. updateWall: "_onPlaceableUpdate"
   */
  /** @type {PlaceableHookData} */
  static HOOKS = {};  // Also define in each child class to avoid all classes using the same object.

  /** @type {number[]} */
  static _hooks = []; // Also define in each child class to avoid all classes using the same array.

  /**
   * Change keys in that indicate a relevant change to the placeable.
   * @param {Set<string>}
   */
  static UPDATE_KEYS = new Set();

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

  /**
   * Deregister hooks for this placeable type that record updates.
   */
  static deregisterPlaceableHooks() {
    this._hooks.forEach(hook => Hooks.off(hook.name, hook.id));
    this._hooks.length = 0;
  }

  /**
   * Create a handler for all placeables.
   */
  static registerExistingPlaceables(placeables) {
    placeables ??= canvas[this.layer].placeables;
    placeables.forEach(placeable => {
      const handler = new this(placeable);
      handler.initialize();
    });
  }

  /**
   * On placeable document creation, create the handler and update.
   * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
   * @param {Document} document                       The new Document instance which has been created
   * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
   * @param {string} userId                           The ID of the User who triggered the creation workflow
   */
  static _onPlaceableDocumentCreation(placeableD, _options, _userId) {
    if ( !placeableD.object ) return;
    const handler = new this(placeableD.object);
    handler.initialize();
  }

  /**
   * Update the object's handler if the changes match 1+ update keys.
   *
   * A hook event that fires for every Document type after conclusion of an update workflow.
   * @param {Document} document                       The existing Document which was updated
   * @param {object} changed                          Differential data that was used to update the document
   * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
   * @param {string} userId                           The ID of the User who triggered the update workflow
   */
  static _onPlaceableDocumentUpdate(placeableD, changed, _options, _userId) {
    const placeable = placeableD.object;
    if ( !placeable ) return;
    const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
    if ( changeKeys.some(key => this.UPDATE_KEYS.has(key)) ) placeable[ATV_ID][this.ID].update();
  }

  /**
   * A hook event that fires for every Document type after conclusion of an deletion workflow.
   * @param {Document} document                       The existing Document which was deleted
   * @param {Partial<DatabaseDeleteOperation>} options Additional options which modified the deletion request
   * @param {string} userId                           The ID of the User who triggered the deletion workflow
   */
  static _onPlaceableDocumentDeletion(_placeableD, _options, _userId) {}

  /**
   * A hook event that fires when a {@link PlaceableObject} is initially drawn.
   * @param {PlaceableObject} object    The object instance being drawn
   */
  static _onPlaceableDraw(placeable) {
    const handler = new this(placeable);
    handler.initialize();
  }

  /**
   * A hook event that fires when a {@link PlaceableObject} is incrementally refreshed.
   * @param {PlaceableObject} object    The object instance being refreshed
   * @param {RenderFlags} flags
   */
  static _onPlaceableRefresh(placeable, flags) {
    // TODO: Can flags be set to false? Need this filter if so.
    // const changeKeys = Object.entries(flags).filter([key, value] => value).map([key, value] => key);
    const changeKeys = Object.keys(flags);
    if ( changeKeys.some(key => this.UPDATE_KEYS.has(key)) ) placeable[ATV_ID][this.ID].update();
  }

  /**
   * A hook event that fires when a {@link PlaceableObject} is destroyed.
   * @param {PlaceableObject} object    The object instance being destroyed
   */
  static _onPlaceableDestroy(placeable) {
    const geometry = placeable?.[ATV_ID]?.[this.ID];
    if ( !geometry ) return;
    geometry.destroy();
  }

  /* ----- NOTE: Constructor ----- */

  /** @type {Placeable} */
  placeable;

  constructor(placeable) {
    this.placeable = placeable;
    placeable[ATV_ID] ??= {};
    placeable[ATV_ID][this.constructor.ID] = this;
  }

  initialize() {
    this.update();
  }

  /**
   * Increment every time there is an update.
   * @type {number}
   */
  #updateId = 0;

  get updateId() { return this.#updateId; }

  update() {
    this.#updateId += 1;
  }

  destroy() {}


}


// Add matrices
export const matricesMixin = function(Base) {
  class PlaceableMatrices extends Base {

    static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

    /** @type {ArrayBuffer} */
    #matrixBuffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 16 * 3);

    /** @type {object<MatrixFloat32>} */
    matrices = {
      rotation: new MatrixFloat32(new Float32Array(this.#matrixBuffer, 0, 16), 4, 4),
      translation: new MatrixFloat32(new Float32Array(this.#matrixBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16), 4, 4),
      scale: new MatrixFloat32(new Float32Array(this.#matrixBuffer, 32 * Float32Array.BYTES_PER_ELEMENT, 16), 4, 4),
    };

    get modelMatrix() {
      const arr = this.constructor.modelMatrixTracker.viewFacetById(this.placeableId);
      return new MatrixFloat32(arr, 4, 4);
    }

    get placeableId() { return this.placeable.sourceId; }


    initialize() {
      this.constructor.modelMatrixTracker.addFacet({ id: this.placeableId, newValues: identityM.arr });
      for ( const M of Object.values(this.matrices) ) identityM.copyTo(M);
      super.initialize();
    }

    update() {
      this._updateTrackingBuffer();
      this._updateMatrices();
      super.update();
    }

    _updateMatrices() {
      this.calculateTranslationMatrix();
      this.calculateRotationMatrix();
      this.calculateScaleMatrix();
      const { rotation, translation, scale } = this.matrices;
      const M = this.modelMatrix;
      scale
        .multiply4x4(rotation, M)
        .multiply4x4(translation, M);
    }

    _updateTrackingBuffer() {
      const newValues = this.modelMatrix.arr;
      this.constructor.modelMatrixTracker.updateFacet(this.placeableId, { newValues });
    };

    calculateTranslationMatrix() {}

    calculateRotationMatrix() {}

    calculateScaleMatrix() {}

    static _onPlaceableDocumentDeletion(placeableD, _options, _userId) {
      this.modelMatrixTracker.deleteFacet(this._sourceIdForPlaceableDocument(placeableD));
    }

    static _sourceIdForPlaceableDocument(placeableD) { return placeableD.id; }

    destroy() {
      this.constructor.modelMatrixTracker.deleteFacet(this.sourceId);
    }
  }
  return PlaceableMatrices;
}

// Add AABB
export const aabbMixin = function(Base) {
  class PlaceableAABB extends Base {
    aabb = new AABB3d();

    update() {
      this._updateAABB();
      super.update();
    }

    _updateAABB() {}
  }
  return PlaceableAABB;
}

// Add Polygon3ds
export const faceMixin = function(Base) {
  class PlaceableFaces extends Base {

    faces = {
      top: null,
      bottom: null,
      sides: [],
    };

    *iterateFaces() {
      if ( this.faces.top ) yield this.faces.top;
      if ( this.faces.bottom ) yield this.faces.bottom;
      for ( const side of this.faces.sides ) yield side;
    }

    update() {
      super.update();
      this._updateFaces();
    }

    _updateFaces() {}

    /* ----- NOTE: Intersection ----- */

    /**
     * Determine where a ray hits this object's faces.
     * Stops at the first hit.
     * Ignores intersections behind the ray.
     * @param {Point3d} rayOrigin
     * @param {Point3d} rayDirection
     * @param {number} [cutoff=1]   Ignore hits further along the ray from this (treat ray as segment)
     * @returns {number|null} The distance along the ray
     */
    rayIntersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
      for ( const face of this.iterateFaces() ) {
        const t = face.intersectionT(rayOrigin, rayDirection);
        if ( t !== null && almostBetween(t, minT, maxT) ) return t;
      }
      return null;
    }

    // ----- NOTE: Debug ----- //

    /**
     * Draw face, omitting an axis.
     */
    draw2d(opts) {
      for ( const face of this.iterateFaces() ) face.draw2d(opts);
    }
  }
  return PlaceableFaces;
}

// Add Vertices and indices to render triangles.
export const verticesIndicesMixin = function(Base) {
  class PlaceableVerticesIndices extends Base {
    static geomClass;

    initialize() {
      this._addGeom(this.placeable);
      super.initialize();
    }

    _addGeom(placeable) {
      this.geom = new this.constructor.geomClass({ addNormals: true, addUVs: this.constructor.addUVs, placeable: this.placeable });
    }


    update() {
      this._updateVerticesIndices();
      super.update();
    }

    static addUVs = false;

    /**
     * Update triangles based on prototype triangles for this placeable.
     */
    _updateVerticesIndices() {}

  }
  return PlaceableVerticesIndices;
}

export const allGeometryMixin = function(Base) {
  return verticesIndicesMixin(faceMixin(aabbMixin(matricesMixin(Base))));
}