/* globals
canvas,
CONFIG,
PIXI
*/
"use strict";

import { Draw } from "../geometry/Draw.js";
import { Ray3d, Ray2d } from "./Ray.js";
import { BlockingTriangle, BlockingTile, BlockingEdge, BlockingToken } from "./BlockingObject.js";

/* Bounded Volume Hierarchy (BVH)
See:
https://alister-chowdhury.github.io/posts/20230620-raytracing-in-2d/
https://www.scratchapixel.com/lessons/3d-basic-rendering/introduction-acceleration-structure/what-else.html
https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/

Store a BVH of canvas objects. Keep separate BVHs for:
- Edges. Rebuild only on addition/deletion.
- Tiles. Rebuild only on addition/deletion.
- Tokens. Rebuild based on distance moved from last rebuild.

As needed:
- Triangles. For more refined intersection tests.

BVH also can be trimmed using a vision triangle.
*/

/**
 * @typedef {object} AABB2d
 * @property {PIXI.Point} min
 * @property {PIXI.Point} max
 */
export class BVHNode2d {
  /** @type {AABB2d} */
  aabb = {
    min: new PIXI.Point(0, 0),
    max: new PIXI.Point(canvas.dimensions.width, canvas.dimensions.height)
  };

  /** @type {uint} */
  leftFirst = 0;

  /** @type {uint} */
  objCount = 0;

  /** @type {bool} */
  get isLeaf() { return this.objCount > 0.0; }

  /** @type {object[]} */
  objData = [];

  /** @type {int[]} */
  objIdx = [];

  /**
   * @param {object[]} objData    Array holding the data objects referenced by nodes
   * @param {int[]} objIdx        Array holding indices referencing the data objects
   */
  constructor(objData = [], objIdx = []) {
    this.objData = objData;
    this.objIdx = objIdx;
  }

  /**
   * Update the bounds for this node based on the walls.
   */
  updateBounds() {
    // Reset bounds.
    const aabb = this.aabb;
    for ( const axis of Object.keys(aabb.min) ) {
      aabb.min[axis] = Number.POSITIVE_INFINITY;
      aabb.max[axis] = Number.NEGATIVE_INFINITY;
    }

    // Cycle through each data object in the node.
    for ( let i = 0; i < this.objCount; i += 1 ) {
      // Pull the associated triangle data.
      const leafObjIdx = this.objIdx[this.leftFirst + i];
      const leafObj = this.objData[leafObjIdx];

      // Check the minimums/maximums of each vertex.
      const objBounds = leafObj.aabb;
      aabb.min = aabb.min.min(objBounds.min);
      aabb.max = aabb.max.max(objBounds.max);
    }
  }

  /**
   * Intersect the bounding box.
   * TODO: See https://tavianator.com/2022/ray_box_boundary.html
   * @param {Ray2d} ray
   * @returns {bool}
   */
  hasBoundsIntersection(ray) {
    const aabb = this.aabb;
    return ray.intersectsAABB(aabb.min, aabb.max);
  }

  hasObjectIntersection(ray, opts = {}) {
    // If more than one object, retest the bounds.
    switch ( this.objCount ) {
      case 0: return false;
      case 1: return this.objData[this.objIdx[this.leftFirst]].hasObjectIntersection(ray);
      default: {
        for ( let i = 0; i < this.objCount; i += 1 ) {
          const obj = this.objData[this.objIdx[this.leftFirst + i]];
          if ( !obj.hasBoundsIntersection(ray) ) continue;
          if ( obj.hasObjectIntersection(ray, opts) ) return true;
        }
      }
    }
    return false;
  }

  sah() {
    // NOTE: Originally used this.objectCount * distance(bmax, bmin).
    // See variance option in comments https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/
    const { min: bmin, max: bmax } = this.aabb;
    return this.objCount * this.objCount * bmax.constructor.distanceSquaredBetween(bmax, bmin);
  }

  // ----- NOTE: Vision triangle ----- //

  /**
   * Get the subset of objects between two rays that form a "vision triangle" from a viewer.
   * It is assumed that anything beyond the triangle or above/below the elevation is unneeded.
   * @param {Ray2d} rCCW        CCW ray; must share origin with rCW
   * @param {Ray2d} rCW         CW ray; must share origin with rCCW
   * @param {number} top
   * @param {number} bottom
   */
  hasVisionTriangleIntersection(a, b, c, top = Number.POSITIVE_INFINITY, bottom = Number.NEGATIVE_INFINITY) {
    const { min, max } = this.aabb;
    const minE = min.z ?? 0;
    const maxE = max.z ?? 0;
    if ( minE > top || maxE < bottom ) return false;

    // Either 1+ rays intersect, the bounds are between the rays, or there is overlap.
    const aabb = this.aabb;
    if ( Ray2d.fromPoints(a, b).intersectsAABB(aabb.min.to2d(), aabb.max.to2d())
      || Ray2d.fromPoints(a, c).intersectsAABB(aabb.min.to2d(), aabb.max.to2d()) ) return true;

    // If no intersection, then the entire bounds lies within the triangle.
    const bary0 = barycentric(this.centroid.to2d(), a, b, c);
    return barycentricPointInsideTriangle(bary0);
  }

  // ----- NOTE: Debugging ----- //
  /** @type {PIXI.Rectangle} */
  get boundsRect() {
    const aabb = this.aabb;
    return new PIXI.Rectangle(
      aabb.min.x,
      aabb.min.y,
      aabb.max.x - aabb.min.x,
      aabb.max.y - aabb.min.y
    );
  }

  /**
   * Draw the rectangle for this node.
   */
  drawBounds(opts = {}) { Draw.shape(this.boundsRect, opts); }

  /**
   * String object describing this node.
   */
  description(idx = 0) {
    return {
      node: `node ${idx.toString().padStart(5)}`,
      leftFirst: `lf ${this.leftFirst.toString().padStart(7)}`,
      objCount: `objs ${this.objCount.toString().padStart(5)}`,
      sah: `SAH ${Math.round(this.sah()).toString().padStart(6)}`
    };
  }
}

/**
 * See https://jacco.ompf2.com/2022/04/13/how-to-build-a-bvh-part-1-basics/
 * https://alister-chowdhury.github.io/posts/20230620-raytracing-in-2d/
 * https://github.com/alister-chowdhury/alister-chowdhury.github.io/blob/master/_source/res/bvh_v1/generate_bvh_v1.cpp
 * To facilitate use with webGL, use a b-tree approach where each end node refers to a single
 * edge. Thus, the end node's bbox is the same as the edge's bbox.
 */
export class BVH2d {
  /** @type {BVHNode} */
  get root() { return this.nodes[0]; }

  /** @type {BVHNode[]} */
  nodes = [];

  /** @type {object[]} */
  objData = [];

  /** @type {int[]} */
  objIdx = [];

  /** @type {int} */
  nodesUsed = 0;

  /** @type {BVHNode} */
  static nodeClass = BVHNode2d;

  constructor(objData, objIdx) {
    this.objData = objData;
    this.objIdx = objIdx;
    const N = objIdx.length;
    this.nodes.length = Math.max(1, (N * 2 ) - 1);
    this.nodes[0] = new this.constructor.nodeClass(this.objData, this.objIdx);
    this.nodesUsed += 1;
    this.root.objCount = N;
  }

  static build(objData, objIdx) {
    const bvh = new this(objData, objIdx);
    bvh.rebuild();
    return bvh;
  }

  /**
   * Subdivide the BVH tree.
   * @param {int} nodeIdx
   */
  subdivide(nodeIdx) {
    // Terminate recursion.
    const node = this.nodes[nodeIdx];
    const N = node.objCount;
    // Debug: console.log(`nodeIdx ${nodeIdx} objCount ${N} leftFirst ${node.leftFirst}`);

    if ( N <= 1 ) return;
    if ( N === 2 ) return this._split(node, 1);
    if ( N === 3 ) {
      this._split(node, 1);
      const rightChildIdx = this.nodesUsed - 1;
      this.subdivide(rightChildIdx);
      return;
    }

    // Use SAH to calculate the cost of splitting, and attempt to minimize.
    // Force an even number of entries by pulling out the largest edge at the root node
    // if not even.
    if ( nodeIdx === 0 && isOdd(N) ) {
      let largestIdx = 0;
      let largestDiameter = 0;
      for ( let i = 0; i < N; i += 1 ) {
        const obj = this.objData[this.objIdx[i]];
        const { min, max } = obj.aabb;
        const diam2 = max.constructor.distanceSquaredBetween(max, min);
        if ( diam2 > largestDiameter ) {
          largestDiameter = diam2;
          largestIdx = i;
        }
      }
      // Split out the largest.
      this._swap(0, largestIdx);
      this._split(node, 1); // Pull out the largest
    } else {
      if ( isOdd(N) ) return console.error(`N is ${N}! at nodeIdx ${nodeIdx}`, node);

      const cost0 = this._evaluateSAH(node, 0);
      const cost1 = this._evaluateSAH(node, 1);

      // Redo the sort for the split b/c it was changed by cost calculation.
      const best = cost0.sah < cost1.sah ? cost0 : cost1;
      this._swapAtPosition(node, best.splitPosition, best.axis);
      this._split(node, best.leftCount);
    }

    // Recurse. See setting of leftChildIdx and rightChildIdx in #split.
    const leftChildIdx = this.nodesUsed - 2;
    const rightChildIdx = this.nodesUsed - 1;
    this.subdivide(leftChildIdx);
    this.subdivide(rightChildIdx);
  }

  _evaluateSAH(node, axis = 0) {
    // Sort the object centroids from low to high; pick numLeft as the test position.
    const n = node.objCount;
    const splitOptions = Array(node.objCount);
    for ( let i = 0; i < n; i += 1 ) splitOptions[i] = this.objData[this.objIdx[node.leftFirst + i]].centroid[axis];
    splitOptions.sort((a, b) => a - b);

    // Test different even splits. E.g. for n = 6: 2, 4 and 4, 2.
    // Assumes n >= 4.
    const out = {
      splitPosition: splitOptions[0],
      sah: Number.POSITIVE_INFINITY,
      leftCount: 0,
      axis
    };
    for ( let leftCount = 2; leftCount < n; leftCount += 2 ) {
      const splitPosition = splitOptions[leftCount];

      // Per above, the chosen position will split the centroids into exactly two groups
      // unless the chosen position has multiple equal centroids.
      // Sort along the chosen split position.
      this._swapAtPosition(node, splitPosition, axis);

      // Calculate the bboxes for each half.
      // Because we are lazy, create new BVHNodes based on the split. See #split.
      const leftNode = new this.constructor.nodeClass(this.objData, this.objIdx);
      const rightNode = new this.constructor.nodeClass(this.objData, this.objIdx);
      leftNode.leftFirst = node.leftFirst;
      leftNode.objCount = leftCount;
      rightNode.leftFirst = node.leftFirst + leftCount;
      rightNode.objCount = node.objCount - leftCount;
      const sah = leftNode.sah() + rightNode.sah();
      if ( sah < out.sah ) {
        out.sah = sah;
        out.splitPosition = splitPosition;
        out.leftCount = leftCount;
      }
    }
    return out;
  }

  _swapAtPosition(node, splitPosition, axis) {
    // Sort along the chosen split position.
    let i = node.leftFirst;
    let j = i + node.objCount - 1;
    while ( i <= j ) {
      if ( this.objData[this.objIdx[i]].centroid[axis] < splitPosition ) i += 1;
      else this._swap(i, j--);
    }
  }

  _split(node, leftCount) {
    const leftChildIdx = this.nodesUsed++;
    const rightChildIdx = this.nodesUsed++;
    this.nodes[leftChildIdx] = new this.constructor.nodeClass(this.objData, this.objIdx);
    this.nodes[rightChildIdx] = new this.constructor.nodeClass(this.objData, this.objIdx);
    this.nodes[leftChildIdx].leftFirst = node.leftFirst;
    this.nodes[leftChildIdx].objCount = leftCount;
    this.nodes[rightChildIdx].leftFirst = node.leftFirst + leftCount;
    this.nodes[rightChildIdx].objCount = node.objCount - leftCount;
    node.leftFirst = leftChildIdx;
    node.objCount = 0;
    this.nodes[leftChildIdx].updateBounds();
    this.nodes[rightChildIdx].updateBounds();
  }

  /**
   * Swap two data indices in the object index
   * @param {int} idx0
   * @param {int} idx1
   */
  _swap(idx0, idx1) { [this.objIdx[idx1], this.objIdx[idx0]] = [this.objIdx[idx0], this.objIdx[idx1]]; }

  // ----- NOTE: Intersection ----- //

  /**
   * Intersect the bounding boxes with a ray.
   * TODO: Add variable to return the intersecting node to test as a caching mechanism.
   * @param {Ray|Ray2d} ray
   * @param {int} nodeIdx
   * @returns {bool}
   */
  hasIntersection(ray, nodeIdx = 0) {
    const node = this.nodes[nodeIdx];
    if ( !node.hasBoundsIntersection(ray) ) return false;
    if ( node.isLeaf ) {
      if ( node.hasObjectIntersection(ray) ) return true;
    } else {
      // Recurse.
      if ( this.hasIntersection(ray, node.leftFirst) ) return true;
      if ( this.hasIntersection(ray, node.leftFirst + 1) ) return true;
    }
    return false;
  }

  /**
   * TODO: For GLSL, could use a stack version that prioritizes closer bbox distances first.
   * TODO: Use a parent link instead of the stack array.
   * See https://alister-chowdhury.github.io/posts/20230620-raytracing-in-2d/
   * @param {Ray}
   */
  hasIntersectionNonRecursive(ray) {
    // For now, don't bother with fake pulling values from the texture arrays.
    // Handle the root node and return if no collision or there is only 1 edge.
    let currLevel = 0;
    let currNode = this.nodes[0];
    if ( !currNode.hasBoundsIntersection(ray) ) return false;
    if ( currNode.isLeaf ) return currNode.hasObjectIntersection(ray);

    // Track the next node for each level of the tree.
    const stack = new Uint16Array(Math.floor(this.nodes.length * 0.5) + 2); // Plus 1 for root.
    stack[0] = 1;  // Root left child is 1; root right child is 2.
    while ( currLevel >= 0 ) {
      // Debug: console.log(`hasIntersectionNonRecursive|currLevel ${currLevel}`, [...stack])

      // Pull the current node.
      currNode = this.nodes[stack[currLevel]];

      // Set the left side for this node.
      stack[currLevel + 1] = currNode.leftFirst;

      // May have the right node remaining. Right is always 1 more than left.
      // Note: left is odd, right is even.
      stack[currLevel] = isEven(stack[currLevel]) ? 0 : stack[currLevel] + 1;

      // Test bounds for this node; if hit, investigate further.
      // If node is leaf, also test object intersection and possibly end early.
      let goDown = currNode.hasBoundsIntersection(ray);
      if ( goDown && currNode.isLeaf ) {
        if ( currNode.hasObjectIntersection(ray) ) return true;
        goDown = false;
      }

      // In next loop, either:
      // 1. Move down to next level.
      // 2. Test the right node.
      // 3. Move up to prior level(s).
      if ( goDown ) currLevel += 1;
      else while ( currLevel >= 0 && stack[currLevel] === 0 ) currLevel -= 1;
    }
    return false;
  }

  // ----- NOTE: Vision triangle ----- //

  /**
   * Get all objects that have a vision triangle intersection.
   * @param {PIXI.Point} a      Origin point of the vision triangle
   * @param {PIXI.Point} b      CCW endpoint
   * @param {PIXI.Point} c      CW endpoint
   * @param {number} top        Maximum elevation
   * @param {number} bottom     Minimum elevation
   * @param {int} nodeIdx
   * @returns {*[]}
   */
  hasVisionTriangleIntersection(a, b, c, top, bottom, nodeIdx = 0, out = []) {
    const node = this.nodes[nodeIdx];
    if ( !node.hasVisionTriangleIntersection(a, b, c, top, bottom) ) return false;
    if ( node.isLeaf ) {
      // TODO: Check the object intersection?
      out.push(node.object);
      return true;
    } else {
      // Recurse.
      if ( this.hasIntersection(ray, node.leftFirst) ) return true;
      if ( this.hasIntersection(ray, node.leftFirst + 1) ) return true;
    }
    return false;
  }

  // ----- NOTE: Updating ----- //

  /**
   * Add an object to the bvh.
   * Causes a full recalculation of the bvh.
   * @param {Object[]} objData
   * @param {number[]} idx
   */
  addObjects(objData, objIdx) {
    this.objData.splice(this.objData.length, ...objData);
    this.objIdx.splice(this.objIdx.length, ...objIdx);
    this.rebuild();
  }

  /**
   * Update an existing object in the bvh.
   * Causes the bvh to refit.
   * @param {Set<number>} indices
   */
  updateObjects(indices) {
    if ( !(indices instanceof Set) ) indices = new Set(indices);
    this.refit(indices);
  }

  /**
   * Remove an object from the bvh.
   * Causes a full recalculation of the bvh.
   * @param {Set<number>} indices     Indices of objData/objIdx to remove.
   */
  removeObjects(indices) {
    if ( !(indices instanceof Set) ) indices = new Set(indices);
    arrayMultiDelete(this.objData, indices);
    arrayMultiDelete(this.objIdx, indices);
    this.rebuild();
  }

  rebuild() {
    this.nodesUsed = 1;
    this.root.leftFirst = 0; // Set already but just to be sure.
    this.root.updateBounds();

    // Subdivide recursively
    this.subdivide(0);
  }

  /**
   * Refit the bvh and update the texture cache accordingly.
   * Size of the bvh does not change.
   * May result in a less efficient bvh tree structure.
   * See https://jacco.ompf2.com/2022/04/26/how-to-build-a-bvh-part-4-animation/
   * @param {Set<number>} [indices]     Optional (leaf) indices to refit.
   */
  refit(indices) {
    indices ??= new Set(Array.fromRange(this.nodesUsed));
    for ( let i = this.nodesUsed - 1; i >= 0; i -= 1 ) {
      if ( i === 1 ) continue;
      const node = this.nodes[i];
      if ( node.isLeaf && indices.has(i) ) {
        node.updateBounds();
        continue;
      }

      // Interior node: Adjust bounds to child node bounds.
      const leftChild = this.nodes[node.leftFirst];
      const rightChild = this.nodes[node.leftFirst + 1];
      const leftAABB = leftChild.aabb;
      const rightAABB = rightChild.aabb;

      node.aabb.min = leftAABB.min.min(rightAABB.min);
      node.aabb.max = leftAABB.max.max(rightAABB.max);
    }
  }

  destroy() {
    this.objData.length = 0;
    this.objIdx.length = 0;
  }

  // ----- NOTE: Debugging ----- //
  static COLORS = [
    Draw.COLORS.lightblue,
    Draw.COLORS.lightgreen,
    Draw.COLORS.lightorange,
    Draw.COLORS.lightred,
    Draw.COLORS.lightyellow,
  ];

  /**
   * Draw the bounds of each node.
   */
  drawBounds() {
    for ( let i = 0; i < this.nodesUsed; i += 1 ) {
      const color = this.constructor.COLORS[i % this.constructor.COLORS.length];
      this.nodes[i].drawBounds({ color });
    }
  }

  /**
   * Display in the console a node hierarchy.
   */
  displayHierarchy() {
    /*    (width: 10 chars)
          node XXXXX
          objs XXXXX
          SAH XXXXXX
         /          \


    */

    const addLeft = (oldStr, newStr) => {
      for ( const key of Object.keys(newStr) ) newStr[key] = newStr[key].concat("\t\t", oldStr[key]);
      return newStr;
    };
    const addRight = (oldStr, newStr) => {
      for ( const key of Object.keys(newStr) ) newStr[key] = oldStr[key].concat("\t\t", newStr[key]);
      return newStr;
    };

    // Run left --> right.
    const addSubNode = function(bvh, node, nodeStr, level = 1) {
      if ( node.objCount ) return;

      // Shift the prev node string by 1 tab so we can add the left here. Propagates upward.
      let currStr = nodeStr;
      while ( currStr ) {
        currStr.tabs += 1;
        currStr = currStr.prev;
      }

      const leftNode = bvh.nodes[node.leftFirst];
      const leftNodeStr = leftNode.description(node.leftFirst);
      leftNodeStr.tabs = nodeStr.tabs - 1;
      leftNodeStr.prev = nodeStr;
      const levelArr = levels[level] ??= [];
      levelArr.push(leftNodeStr);
      addSubNode(bvh, leftNode, leftNodeStr, level + 1);

      const rightNode = bvh.nodes[node.leftFirst + 1];
      const rightNodeStr = rightNode.description(node.leftFirst + 1);
      rightNodeStr.tabs = 2;
      rightNodeStr.prev = nodeStr;
      levelArr.push(rightNodeStr);
      addSubNode(bvh, rightNode, rightNodeStr, level + 1);
    };

    const levels = [[this.root.description(0)]];
    levels[0][0].tabs = 0;
    addSubNode(this, this.root, levels[0][0], 1);

    let finalStr = "";
    levels.forEach(level => {
      let levelObj = {};
      for ( let i = 0; i < level.length; i += 1 ) {
        const tabs = Array.fromRange(level[i].tabs).fill("\t").join("");
        Object.keys(level[i]).forEach(key => {
          if ( key === "tabs" || key === "prev" ) return;
          levelObj[key] ??= "";
          levelObj[key] += `${tabs}${level[i][key]}`;
        });
      }
      let levelStr = "";
      Object.keys(levelObj).forEach(key => levelStr = levelStr.concat(levelObj[key], "\n"));
      finalStr += levelStr;
    });

    console.log(finalStr);
    return levels;
  }
}

/**
 * @typedef {object} AABB3d
 * @property {Point3d} min
 * @property {Point3d} max
 */
export class BVHNode3d extends BVHNode2d {
  /** @type {AABB3d} */
  aabb = {
    min: new CONFIG.GeometryLib.threeD.Point3d(0, 0, Number.MIN_SAFE_INTEGER),
    max: new CONFIG.GeometryLib.threeD.Point3d(canvas.dimensions.width, canvas.dimensions.height, Number.MAX_SAFE_INTEGER)
  };
}

export class BVH3d extends BVH2d {
  /** @type {BVHNode} */
  static nodeClass = BVHNode3d;
}

/**
 * Test if a number is even.
 */
function isEven(n) { return n % 2 === 0; }

/**
 * Test if a number is odd.
 */
function isOdd(n) { return n % 2 !== 0; }

/**
 * Remove a set of positive indices from an array, in place.
 * Using negative indices will fail silently. Indices larger than the array are ignored.
 * @param {*[]} arr
 * @param {Set<number>|number[]} indices
 */
function arrayMultiDelete(arr, indices) {
  // Reverse sort the indices and splice each in turn.
  indices = [...indices];
  indices.sort((a, b) => b - a);
  indices.forEach(i => arr.splice(i, 1));
}

/**
 * Test whether a vertex lies between two boundary rays.
 * If the angle is greater than 180, test for points between rMax and rMin (inverse).
 * Otherwise, keep vertices that are between the rays directly.
 * @param {PIXI.Point} point        The candidate point
 * @param {PolygonRay} rMin         The counter-clockwise bounding ray
 * @param {PolygonRay} rMax         The clockwise bounding ray
 * @param {number} angle            The angle being tested, in degrees
 * @returns {boolean}               Is the vertex between the two rays?
 */
function pointBetweenRays(point, rMin, rMax) {
  const ccw = foundry.utils.orient2dFast;
  /*
  if ( angle > 180 ) {
    const outside = (ccw(rMax.A, rMax.B, point) <= 0) && (ccw(rMin.A, rMin.B, point) >= 0);
    return !outside;
  }
  */
  return (ccw(rMin.A, rMin.B, point) <= 0) && (ccw(rMax.A, rMax.B, point) >= 0);
}

/**
 * Calculate barycentric position within a given triangle
 * For point p and triangle abc, return the barycentric uvw as a vec3 or vec2.
 * See https://ceng2.ktu.edu.tr/~cakir/files/grafikler/Texture_Mapping.pdf
 * @param {vec3|vec2} p
 * @param {vec3|vec2} a
 * @param {vec3|vec2} b
 * @param {vec3|vec2} c
 * @returns {vec3}
 */
function barycentric(p, a, b, c) {
  const v0 = b.subtract(a, a.constructor._tmp); // Fixed for given triangle
  const v1 = c.subtract(a, a.constructor._tmp2); // Fixed for given triangle
  const v2 = p.subtract(a, a.constructor._tmp3);

  const d00 = v0.dot(v0); // Fixed for given triangle
  const d01 = v0.dot(v1); // Fixed for given triangle
  const d11 = v1.dot(v1); // Fixed for given triangle
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const denom = ((d00 * d11) - (d01 * d01));
  // TODO: Is this test needed? if ( denom == 0.0 ) return new vec3(-1.0);

  const denomInv = 1.0 / denom; // Fixed for given triangle
  const v = ((d11 * d20) - (d01 * d21)) * denomInv;
  const w = ((d00 * d21) - (d01 * d20)) * denomInv;
  const u = 1.0 - v - w;
  return { u, v, w };
}

/**
 * Test if a barycentric coordinate is within its defined triangle.
 * @param {vec3} bary     Barycentric coordinate; x,y,z => u,v,w
 * @returns {bool} True if inside
 */
function barycentricPointInsideTriangle(bary) {
  return bary.u >= 0.0 && bary.v >= 0.0 && (bary.v + bary.w) <= 1.0;
}


/* Testing
Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
let { BVH3d, BlockingEdge, Ray3d, VisionPolygon, BaryTriangle2d, BaryTriangle3d, BaryTriangle3dNormal } = api.bvh

objData = [...canvas.edges.values()].filter(edge => edge.type === "wall").map(edge => new BlockingEdge(edge))
objIdx = Array.fromRange(objData.length)

// Build edge bvh.
bvh = BVH3d.build(objData, objIdx)
bvh.drawBounds()
bvh.displayHierarchy()

// Test ray
viewer = _token
target = game.user.targets.first()

a = Point3d.fromTokenCenter(viewer)
b = Point3d.fromTokenCenter(target)
r = Ray3d.fromPoints(a, b)

bvh.nodes.map(n => n.hasBoundsIntersection(r))

bvh.hasIntersection(r)
bvh.hasIntersectionNonRecursive(r)




// Benchmark against collisions and quadtree
bvhTest = function(r) { return bvh.hasIntersection(r); }
bvhTestNonRecursive = function(r) { return bvh.hasIntersectionNonRecursive(r); }

collisionTest = function(a, b) { return PointSourcePolygon.testCollision3d(a, b, { mode: "any", type: "move" }) }

quadTest = function(a, b) {
  const xMinMax = Math.minMax(a.x, b.x);
  const yMinMax = Math.minMax(a.y, b.y);
  const bounds = new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min)
  const collisionTest = (o, rect) => foundry.utils.lineSegmentIntersects(o.t.edge.a, o.t.edge.b, a, b);
  return canvas.walls.quadtree.getObjects(bounds, { collisionTest }).size > 0;
}
bvhTest(r)
bvhTestNonRecursive(r)
collisionTest(a, b)
quadTest(a,b)

N = 10000
await foundry.utils.benchmark(bvhTest, N, r)
await foundry.utils.benchmark(bvhTestNonRecursive, N, r)
await foundry.utils.benchmark(collisionTest, N, a, b)
await foundry.utils.benchmark(quadTest, N, a, b)
await foundry.utils.benchmark(collisionTest, N, a, b)
await foundry.utils.benchmark(bvhTestNonRecursive, N, r)
await foundry.utils.benchmark(bvhTest, N, r)
await foundry.utils.benchmark(quadTest, N, a, b)


// Barycentric quad test
visionPoly = VisionPolygon.build(viewer, target)

pts = [...visionPoly.iteratePoints({close: false})]


tri = BaryTriangle2d.fromPoints(pts[2], pts[0], pts[1])


a = Point3d.fromObject(pts[2])
b = Point3d.fromObject(pts[0])
c = Point3d.fromObject(pts[1])
pt = Point3d.fromTokenCenter(_token)
tri2 = BaryTriangle3d.fromPoints(a, b, c)
tri3 = BaryTriangle3dNormal.fromPoints(a, c, b)

Draw.shape(new PIXI.Polygon(a, b, c))

tri.pointInsideTriangle(pt)
tri2.pointInsideTriangle(pt)
tri3.pointInsideTriangle(pt)


*/

