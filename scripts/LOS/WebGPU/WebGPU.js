/* globals
foundry
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../../const.js";
import { wgsl } from "./wgsl-preprocessor.js";


/* WebGPU
Two approaches to WebGPU calc for visibility:
1. Filter objects in JS and render only the relevant ones.
2. Render all and use camera to filter out irrelevant ones.

For now use #1.

Basic approach:
- Define instances for a token cube, wall, directional wall.
- Each object gets a world matrix.
- Camera matrix defines the view. Zoom to fit the target token.
- Color target token red. Color other obstacles something, e.g. blue.
- Render two at once: target only and target + obstacles.
- Use compute to sum red pixels for each RT.
*/

/**
 * Abstract class that is meant to return a GPUDevice with some added information.
 */
export class WebGPUDevice {
  /** @type {string[]} */
  static FEATURES = [ "bgra8unorm-storage", "timestamp-query", "texture-compression-bc", "texture-compression-etc2", "occlusion-query"];

  /** @type {string} */
  static #presentationFormat = "rgba8unorm";

  static get presentationFormat() { return this.#presentationFormat; }

  /**
   * Attempt to retrieve a WebGPU device.
   * Note: Use [...device.features] or device.features.has() to test for features.
   * @param {number} [tries = 2]
   * @returns {GPUDevice|undefined}
   */
  static async getDevice(tries = 2) {
    if ( tries < 0 ) return;
    if ( !navigator.gpu ) return console.warn("This browser does not support WebGPU.");

    const adapter = await navigator.gpu.requestAdapter();
    if ( !adapter ) return console.warn("This browser supports WebGPU but it appears disabled.");

    const requiredFeatures = [];
    for ( const feature of this.FEATURES ) {
      if ( adapter.features.has(feature) ) requiredFeatures.push(feature);
    }

    // Change the presentation format if bgra8unorm-storage is an option.
    this.#presentationFormat = adapter.features.has("bgra8unorm-storage")
      ? navigator.gpu.getPreferredCanvasFormat() : "rgba8unorm"

    const device = await adapter?.requestDevice({ requiredFeatures });
    device.lost.then((info) => {
      console.error(`WebGPU device was lost: ${info.message}`);

      // 'reason' will be 'destroyed' if we intentionally destroy the device.
      if (info.reason !== 'destroyed') {
        // try again
        this.getDevice(tries--);
      }
    });
    return device;
  }
}

export class WebGPUShader {
  /**
   * Load code from a GLSL file.
   * @param {GPUDevice} device      GPUDevice to use for the shader
   * @param {string} fileName       Name of the GLSL file, found at scripts/glsl/
   * @param {string} label          Optional label for the shader
   * @param {object} params         Parameters used to interpolate the loaded code string
   * @returns {WebGPUShader}
   */
  static async fromGLSLFile(device, filename, label = "", params = {}) {
    let code = await fetchGLSLCode(filename);
    if ( !code ) return undefined;
    return this.fromCodeString(device, code, label, params);
  }

  /**
   * Create a shader on the device.
   * @param {GPUDevice} device      GPUDevice to use for the shader
   * @param {string} label          Optional label for the shader
   * @param {object} params         Parameters used to interpolate the loaded code string
   * @returns {WebGPUShader}
   */
  static fromCodeString(device, code, label = "", params = {}) {
    if ( !foundry.utils.isEmpty(params) ) code = interpolateWGSL(code, params);
    const out = device.createShaderModule({ label, code });
    out._sourceCode = code;
    return out;
  }
}

export class WebGPUBuffer {
  /**
   * Create a vertex buffer.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {TypedArray} arr        Array to use for the buffer
   * @param {object} [opts]         Options passed to createBuffer
   * @param {string} [opts.label]
   * @param {number} [opts.size]    Size
   * @param {usage} [opts.usage]    Combined with the vertex usage.
   * @returns {GPUBuffer}
   */
  static createVertices(device, arr, { label = "vertices", size, usage = 0 } = {}) {
    usage |= GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
    return this._createAndWriteBuffer(device, arr, { label, size, usage })
  }

  /**
   * Create an index buffer.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {TypedArray} arr        Array to use for the buffer
   * @param {object} [opts]         Options passed to createBuffer
   * @param {string} [opts.label]
   * @param {number} [opts.size]    Size
   * @param {usage} [opts.usage]    Combined with the vertex usage.
   * @returns {GPUBuffer}
   */
  static createIndices(device, arr, { label = "indices", size, usage = 0 } = {}) {
    if ( !arr ) {
      arr = new Uint16Array(size);
      size = undefined;
    }
    usage |= GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST;
    return this._createAndWriteBuffer(device, arr, { label, size, usage })
  }

  /**
   * Create a uniform buffer.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {TypedArray} arr        Array to use for the buffer
   * @param {object} [opts]         Options passed to createBuffer
   * @param {string} [opts.label]
   * @param {number} [opts.size]    Size
   * @param {usage} [opts.usage]    Combined with the vertex usage.
   * @returns {GPUBuffer}
   */
  static createUniforms(device, arr, { label = "uniforms", size, usage = 0 } = {}) {
    usage |= GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    return this._createAndWriteBuffer(device, arr, { label, size, usage })
  }

 /**
  * Create a storage buffer.
  * @param {GPUDevice} device      WebGPU device to use
  * @param {object} [opts]         Options passed to createBuffer
  * @param {string} [opts.label]
  * @param {number} [opts.size]    Size
  * @param {usage} [opts.usage]    Combined with the vertex usage.
  * @returns {GPUBuffer}
  */
  static createStorage(device, { label = "storage", size, usage = 0 } = {}) {
    usage |= GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
    return this._createBuffer(device, { label, size, usage });
  }

 /**
  * Create a result buffer, used to map from GPU.
  * @param {GPUDevice} device      WebGPU device to use
  * @param {object} [opts]         Options passed to createBuffer
  * @param {string} [opts.label]
  * @param {number} [opts.size]    Size
  * @param {usage} [opts.usage]    Combined with the vertex usage.
  * @returns {GPUBuffer}
  */
  static createResult(device, { label = "result", size, usage = 0 } = {}) {
    usage |= GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
    return this._createBuffer(device, { label, size, usage });
  }


 /**
  * Create a generic buffer and write the data.
  * @param {GPUDevice} device      WebGPU device to use
  * @param {TypedArray} arr        Array to use for the buffer
  * @param {object} [opts]         Options passed to createBuffer
  * @returns {GPUBuffer}
  */
  static _createAndWriteBuffer(device, arr, opts = {}) {
    opts.size ??= arr.byteLength;
    const buffer = device.createBuffer(opts);
    device.queue.writeBuffer(buffer, 0, arr);
    return buffer;
  }

  /**
   * Create a uniform buffer, map it, and copy the values.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {class} arrayCl         TypedArray class to use
   * @param {function} callback     Function used to initialize the array.
   *   - @param {TypedArray} arr    The mapped array from the buffer creation.
   * @param {object} [opts]         Options passed to createBuffer
   * @returns {GPUBuffer}
   */
  static initializeUniforms(device, arrayCl, callback, opts = {}) {
    opts.label ??= "Uniforms";
    opts.usage |= GPUBufferUsage.UNIFORM;
    return this._initializeBuffer(device, arrayCl, callback, opts);
  }

  /**
   * Create a vertex buffer, map it, and copy the values.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {class} arrayCl         TypedArray class to use
   * @param {function} callback     Function used to initialize the array.
   *   - @param {TypedArray} arr    The mapped array from the buffer creation.
   * @param {object} [opts]         Options passed to createBuffer
   * @returns {GPUBuffer}
   */
  static initializeVertices(device, arrayCl, callback, opts = {}) {
    opts.label ??= "Vertices";
    opts.usage |= GPUBufferUsage.VERTEX;
    return this._initializeBuffer(device, arrayCl, callback, opts);
  }

  /**
   * Create an index buffer, map it, and copy the values.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {class} arrayCl         TypedArray class to use
   * @param {function} callback     Function used to initialize the array.
   *   - @param {TypedArray} arr    The mapped array from the buffer creation.
   * @param {object} [opts]         Options passed to createBuffer
   * @returns {GPUBuffer}
   */
  static initializeIndices(device, arrayCl, callback, opts = {}) {
    opts.label ??= "Indices";
    opts.usage |= GPUBufferUsage.INDEX;
    return this._initializeBuffer(device, arrayCl, callback, opts);
  }

  /**
   * Create a generic buffer, map it, and copy the values.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {class} arrayCl         TypedArray class to use
   * @param {function} callback     Function used to initialize the array.
   *   - @param {TypedArray} arr    The mapped array from the buffer creation.
   * @param {object} [opts]         Options passed to createBuffer
   * @returns {GPUBuffer}
   */
  static _initializeBuffer(device, arrayCl, callback, opts = {}) {
    opts.size ??= arrayCl.BYTES_PER_ELEMENT * 4;
    opts.mappedAtCreation = true;
    const buffer = device.createBuffer(opts);
    const arr = new arrayCl(buffer.getMappedRange());
    callback(arr);
    buffer.unmap();
    return buffer;
  }

  /**
   * Create a generic buffer without data.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {object} [opts]         Options passed to createBuffer
   * @returns {GPUBuffer}
   */
  static _createBuffer(device, opts = {}) { return device.createBuffer(opts); }
}

export class WebGPUTexture {

  /**
   * Create a render texture.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {number} width
   * @param {number} height
   * @param {string} format
   */
  static createRenderTexture(device, { width = 1, height = 1, format, label = "render texture" } = {}) {
    format ??= WebGPUDevice.presentationFormat;
    const tex = device.createTexture({
      label,
      size: [width, height, 1],
      dimension: "2d",
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, // Unneeded: GPUTextureUsage.TEXTURE_BINDING,
    });
    tex.createDescriptor = label => {
      label ??= tex.label;
      return {
        label,
        colorAttachments: [{
          view: tex.createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        }],
      };
    };
    return tex;
  }

  /**
   * Construct an image texture from pixel data.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {TypedArray} arr        Data array
   * @param {object} [opts]         Options
   * @param {number} [opts.width]
   * @param {number} [opts.height]
   * @param {string} [opts.format]
   * @param {number} [opts.channels=4]
   * @returns {GPUTexture}
   */
  static _createAndWriteImageTexture(device, arr, { width = 1, height = 1, format, channels = 4, usage } = {}) {
    format ??= WebGPUDevice.presentationFormat;
    usage ??=  GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST;
    const texOpts = {
      size: [width, height],
      format,
      usage
    };
    const dataLayout = {
      bytesPerRow: width * channels
    };
    const size = { width, height };
    return this._createAndWriteTexture(device, arr, texOpts, dataLayout, size);
  }

  /**
   * Create a generic texture.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {object} [opts]         Passed to createTexture
   * @returns {GPUTexture}
   */
  static _createTexture(device, opts) { return device.createTexture(opts); }

  /**
   * Create and write a generic texture.
   * @param {GPUDevice} device      WebGPU device to use
   * @param {object} [opts]         Passed to createTexture
   * @returns {GPUTexture}
   */
  static _createAndWriteTexture(device, data, texOpts, dataLayout, size) {
    const texture = this._createTexture(device, texOpts);
    return device.queue.writeTexture({ texture }, data, dataLayout, size);
  }
}


// ----- NOTE: Helper functions ----- //

/**
 * Fetch GLSL code as text.
 * @param {string} fileName     The file name without extension or directory path.
 * @returns {string}
 */
async function fetchGLSLCode(fileName) {
  const resp = await foundry.utils.fetchWithTimeout(`modules/${MODULE_ID}/scripts/LOS/WebGPU/glsl/${fileName}.glsl`);
  return resp.text();
}

/**
 * Limited string replacement so the imported glsl code can be treated as a template literal
 * (without using eval).
 * See https://stackoverflow.com/questions/29182244/convert-a-string-to-a-template-string
 * @param {string} str      String with ${} values to replace
 * @param {object} params   Valid objects that can be replaced; either variables or function names
 * @returns {string}
 */
function interpolateWGSL(str, params = {}) {
  // Replace the names with the relevant values.
  const names = Object.keys(params);
  const vals = Object.values(params);
  return new Function("wgsl", ...names, `return wgsl\`${str}\`;`)(wgsl, ...vals);
}
