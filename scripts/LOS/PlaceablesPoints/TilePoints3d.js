/* globals
CONFIG
*/
"use strict";

// Represent a Wall in as a set of 4 3d points.

import { HorizontalPoints3d } from "./HorizontalPoints3d.js";
import { Point3d } from "../geometry/3d/Point3d.js";

export class TilePoints3d extends HorizontalPoints3d {
  constructor(object) {
    const { x, y, width, height, elevation } = object.document;
    const eZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(elevation); // There is a tile.document.z value but not sure from where -- Levels?

    const rightX = x + width;
    const bottomY = y + height;

    const points = new Array(4);
    points[0] = new Point3d(x, y, eZ);
    points[1] = new Point3d(rightX, y, eZ);
    points[2] = new Point3d(rightX, bottomY, eZ);
    points[3] = new Point3d(x, bottomY, eZ);

    super(object, points);
  }
}
