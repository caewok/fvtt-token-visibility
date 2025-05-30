/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { wgsl } from "../WebGPU/wgsl-preprocessor.js";
import * as twgl from "./twgl.js";
import { applyConsecutively } from "../util.js";

/*
PIXI: Only does basic instancing. No apparent way to filter which instances to use.
Could pull instances from a texture maybe.
But for now, just define the instance buffer at render to be only those needed to draw that viewpoint.

For WebGL2, cannot start at a specific instance index:
https://stackoverflow.com/questions/37469193/webgl-drawelementsinstancedangle-with-a-starting-offset-on-the-instanced-array
glDrawElementsInstancedBaseInstance only on GL 4:
https://registry.khronos.org/OpenGL-Refpages/gl4/html/glDrawElementsInstancedBaseInstance.xhtml
From stackoverflow: Could set an offset when binding the instance attribute(s)
See:
https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/vertexAttribPointer
*/

/**
 * Misc functions to assist with WebGL2 rendering.
 */
export class WebGL2 {

  /** @type {WebGL2RenderingContext} */
  gl;


  /**
   * @param {WebGL2RenderingContext} gl
   */
  constructor(gl) {
    this.gl = gl;
  }


  /**
   * Load code from a GLSL file.
   * @param {string} fileName       Name of the GLSL file, found at scripts/glsl/
   * @param {object} params         Parameters used to interpolate the loaded code string
   * @returns {string}
   */
  static async sourceFromGLSLFile(filename, params) {
    const code = await this.fetchGLSLCode(filename);
    return interpolate(code, params);
  }

  /**
   * Fetch GLSL code as text.
   * @param {string} fileName     The file name without extension or directory path.
   * @returns {string}
   */
  static async fetchGLSLCode(fileName) {
    const resp = await foundry.utils.fetchWithTimeout(`modules/${MODULE_ID}/scripts/LOS/WebGL2/glsl/${fileName}.glsl`);
    return resp.text();
  }




 /**
  * Draw representation of pixels
  */
 static drawPixels(imgData, { minX = 0, maxX, minY = 0, maxY, channel = 0 } = {}) {
   let str = "";
   maxX ??= imgData.width;
   maxY ??= imgData.height;

   // 0,0 is bottom left
   // pixel is data[(width * height - 1) * pixelSize]
   for ( let y = imgData.height - 1; y >= 0; y -= 1 ) {
     for ( let x = 0; x < imgData.width; x += 1 ) {
       if ( x < minX || x > maxX ) continue;
       if ( y < minY || y > maxY ) continue;
       const px = imgData.pixels[(x * y * 4) + channel];
       const nStr = `${px}`;
       const paddingLn = 3 - nStr.length;
       const paddedStr = "0".repeat(paddingLn) + nStr;
       str += `${paddedStr} `;
     }
     str += "\n";
   }
   console.log(str);
   // return str;
 }


  /**
   * Given image data or image pixels, print summary of the 4 color channels to console.
   * @param {object|TypedArray} pixels      Object with pixels parameter or an array of pixels
   */
  static summarizePixelData(pixels) {
    if ( Object.hasOwn(pixels, "pixels") ) pixels = pixels.pixels;
    const acc = Array(12).fill(0);
    const max = Array(4).fill(0);
    const min = Array(4).fill(0)
    pixels.forEach((px, idx) => {
      acc[idx % 4] += px;
      acc[idx % 4 + 4] += Boolean(px);
      acc[idx % 4 + 8] += !px;
      max[idx % 4] = Math.max(px, max[idx % 4])
      min[idx % 4] = Math.min(px, min[idx % 4])
    });
    let redBlocked = 0;
    const terrainThreshold = 255 * 0.75;
    for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      redBlocked += Boolean(r) * Boolean(b || (g > terrainThreshold))
    }

    console.table([
      { label: "sum", r: acc[0], g: acc[1], b: acc[2], a: acc[3] },
      { label: "count", r: acc[4], g: acc[5], b: acc[6], a: acc[7] },
      { label: "zeroes", r: acc[8], g: acc[9], b: acc[10], a: acc[11] },
      { label: "min", r: min[0], g: min[1], b: min[2], a: min[3] },
      { label: "max", r: max[0], g: max[1], b: max[2], a: max[3] },
      { label: "redBlocked", r: redBlocked, g: redBlocked, b: redBlocked, a: redBlocked}
    ])
  }



  static draw(gl, count, offset = 0) {
    const primitiveType = gl.TRIANGLES;
    const indexType = gl.UNSIGNED_SHORT;
    gl.drawElements(primitiveType, count, indexType, offset);
  }


  static drawSet(gl, instanceSet, offsetData) {
    if ( !(instanceSet.size || instanceSet.length) ) return;

    // Handle either instances all same number of vertices or different number.
    const instanceLength = Number.isNumeric(offsetData.index.lengths)
      ? offsetData.index.lengths : 0;

    // For a consecutive group, draw all at once.
    // So if 0–5, 7–9, 12, should result in 3 draw calls.
    applyConsecutively(instanceSet, (firstInstance, instanceCount) => {
      // Pull the offset and count from the offsetData.
      const offset = offsetData.index.offsets[firstInstance];
      const count = (instanceLength * instanceCount)
        || sumArray(offsetData.index.lengths.slice(firstInstance, firstInstance + instanceCount));
      this.draw(gl, count, offset);
    });
  }

  static drawInstanced(gl, elementCount, offset = 0, instanceCount = 1) {
    const primitiveType = gl.TRIANGLES;
    const indexType = gl.UNSIGNED_SHORT;
    gl.drawElementsInstanced(primitiveType, elementCount, indexType, offset, instanceCount);
  }
}

function sumArray(arr) { return arr.reduce((acc, curr) => acc + curr, 0); }


/**
 * Limited string replacement so the imported glsl code can be treated as a template literal
 * (without using eval).
 * See https://stackoverflow.com/questions/29182244/convert-a-string-to-a-template-string
 * @param {string} str      String with ${} values to replace
 * @param {object} params   Valid objects that can be replaced; either variables or function names
 * @returns {string}
 */
function interpolate(str, params = {}) {
  // Replace the names with the relevant values.
  const names = Object.keys(params);
  const vals = Object.values(params);
  return new Function("wgsl", ...names, `return wgsl\`${str}\`;`)(wgsl, ...vals);
}



