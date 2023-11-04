/* globals
CONFIG
*/
"use strict";

// Represent a Wall in as a set of 4 3d points.

import { HorizontalPoints3d } from "./HorizontalPoints3d.js";

// Geometry folder
import { Point3d } from "../../geometry/3d/Point3d.js";

export class TilePoints3d extends HorizontalPoints3d {
  /** @type {number[8]} */
  #uvs = new Float32Array(8);

  /** @type {Matrix} */
  #invM;

  /** @type {number} */
  #xMin;

  /** @type {number} */
  #yMin;

  /** @type {width} */
  #width;

  /** @type {height} */
  #height;

  /** @type {boolean} */
  flipped = false;

  constructor(object, { viewerElevationZ } = {}) {
    const { x, y, width, height, elevation } = object.document;
    const eZ = object.elevationZ;
    const rightX = x + width;
    const bottomY = y + height;

    const points = new Array(4);
    points[0] = new Point3d(x, y, eZ);
    points[1] = new Point3d(rightX, y, eZ);
    points[2] = new Point3d(rightX, bottomY, eZ);
    points[3] = new Point3d(x, bottomY, eZ);

    super(object, points);

    // Texture flipped if viewing the bottom of the tile
    this.flipped = (typeof viewerElevationZ !== "undefined") && viewerElevationZ < eZ;

    // Set the uvs values for this texture.
    // This may be later modified if the texture points are cut off due to perspective.
    this._initializeUVs();
    this.#xMin = x;
    this.#yMin = y;
    this.#width = width;
    this.#height = height;
  }

  get uvs() {
    const UVs = [...this.#uvs];
    if ( this.flipped ) {
      const one = UVs[1];
      const three = UVs[3];
      UVs[1] = UVs[5];
      UVs[3] = UVs[7];
      UVs[5] = one;
      UVs[7] = three;
    }
    return UVs;
  }

  _initializeUVs() {
    const uvs = this.#uvs;
    // TL
    uvs[0] = 0;
    uvs[1] = 0;

    // TR
    uvs[2] = 1;
    uvs[3] = 0;

    // BR
    uvs[4] = 1;
    uvs[5] = 1;

    // BL
    uvs[6] = 0;
    uvs[7] = 1;
  }

  _truncatePlanePoints() {
    // Get the new border points for the texture.
    // Calculate the percentage change.
    const oldPoints = [...this._tPoints];
    super._truncatePlanePoints();

    const xMin = this.#xMin;
    const yMin = this.#yMin;
    const w = this.#width;
    const h = this.#height;
    for ( let i = 0; i < 4; i += 1 ) {
      const oldPt = oldPoints[i];
      const newPt = this._tPoints[i];
      if ( oldPt.almostEqual(newPt) ) continue;

      // Constants needed to calculate the position on the original texture.
      this.#invM ??= this.M.invert();

      // Calculate the original position.
      const newOrig = this.#invM.multiplyPoint3d(newPt);
      const xPercent = (newOrig.x - xMin) / w;
      const yPercent = (newOrig.y - yMin) / h;

      // Change the uvs.
      const j = i * 2;
      this.#uvs[j] = xPercent;
      this.#uvs[j + 1] = yPercent;
    }
  }

}
