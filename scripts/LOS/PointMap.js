/* globals
PIXI
*/
"use strict";

export class PointSet extends Set {

  add(point) {
    return super.add( point.toString());
  }

  has(point) {
    return super.has(point.toString());
  }

  delete(point) {
    return super.delete(point.toString());
  }
}

export class PointKeySet extends Set {
  add(point) {
    return super.add(point.key);
  }

  has(point) {
    return super.has(point.key);
  }

  delete(point) {
    return super.delete(point.key);
  }
}


export class PointMap extends Map {
  get(point) {
    return super.get(point.toString());
  }

  set(point, value) {
    return super.set(point.toString(), value);
  }

  has(point) {
    return super.has(point.toString());
  }

  delete(point) {
    return super.delete(point.toString());
  }
}


export class PointKeyMap extends Map {
  get(point) {
    if ( !(point instanceof PIXI.Point) ) console.error("PointKeyMap requires PIXI Points.");
    return super.get(point.key);
  }

  set(point, value) {
    if ( !(point instanceof PIXI.Point) ) console.error("PointKeyMap requires PIXI Points.");
    return super.set(point.key, value);
  }

  has(point) {
    return super.has(point.key);
  }

  delete(point) {
    return super.delete(point.key);
  }
}


