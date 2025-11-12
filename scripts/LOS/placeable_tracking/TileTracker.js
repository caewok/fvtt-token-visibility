/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableModelMatrixTracker } from "./PlaceableTracker.js";
import { MatrixFloat32 } from "../../geometry/MatrixFlat.js";
import { OTHER_MODULES } from "../../const.js";
import { getFlagFast } from "../util.js";

// Base folder


// Temporary matrices.
/** @type {MatrixFlat<4,4>} */
const translationM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const scaleM = MatrixFloat32.identity(4, 4);

/** @type {MatrixFlat<4,4>} */
const rotationM = MatrixFloat32.identity(4, 4);

export class TileTracker extends PlaceableModelMatrixTracker {
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

  static layer = "tiles";

  /**
   * Should this tile be included in the scene render?
   */
  includePlaceable(tile) {
    // Exclude tiles at elevation 0 because these overlap the ground.
    if ( !tile.elevationZ ) return false;

    // For Levels, "noCollision" is the "Allow Sight" config option. Drop those tiles.
    const LEVELS = OTHER_MODULES;
    if ( LEVELS.ACTIVE
      // && this.senseType === "sight"
      && getFlagFast(tile.document, LEVELS.KEY, LEVELS.FLAGS.ALLOW_SIGHT) ) return false;

    return true;
  }

  translationMatrixForPlaceable(tile) {
    // Move from center of tile.
    const ctr = this.constructor.tileCenter(tile);
    CONFIG.GeometryLib.MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, translationM);
    return translationM;
  }

  scaleMatrixForPlaceable(tile) {
    // Scale based on width, height of tile.
    const { width, height } = this.constructor.tileDimensions(tile);
    CONFIG.GeometryLib.MatrixFloat32.scale(width, height, 1.0, scaleM);
    return scaleM;
  }

  rotationMatrixForPlaceable(tile) {
    // Rotate based on tile rotation.
    CONFIG.GeometryLib.MatrixFloat32.rotationZ(this.constructor.tileRotation(tile), true, rotationM);
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
    const dims = Point3d.tmp.set(width, height, 0);
    const TL = Point3d.tmp.set(x, y, elevation);
    const BR = TL.add(dims, Point3d.tmp);
    TL.add(BR, out).multiplyScalar(0.5, out);
    Point3d.release(dims, TL, BR);
    return out;
  }
}

export class SceneBackgroundTracker extends TileTracker {
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
