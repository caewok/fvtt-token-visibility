/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { BasicVertices } from "./BasicVertices.js";
import { combineTypedArrays } from "../util.js";

const keywordRE = /(\w*)(?: )*(.*)/;
const STOP = Symbol("STOP");


/**
 * Minimal parsing of an OBJ file to pull out vertices, normals, uvs.
 * See https://paulbourke.net/dataformats/obj/minobj.html
 *     https://paulbourke.net/dataformats/obj/
 * Borrowed heavily from https://webglfundamentals.org/webgl/lessons/webgl-load-obj.html
 */
export class OBJParser {
  url = ""

  objectName = "";

  objText = "";

  constructor(url, { objectName = "" } = {}) {
    this.url = url;
    this.objectName = objectName;
  }

  async loadObjectFile(url) {
    if ( url ) this.url = url;
    const response = await fetch(this.url);
    if ( !response.ok ) {
      console.error(`loadObjectFile for URL ${url} failed with error ${response.status}: ${response.text}`, response);
      return false;
    }
    this.objText = await response.text();
    return true;
  }

  // ----- NOTE: Temporary track of object parameters ----- //
  #objPositions = [[0, 0, 0]];

  #objTexCoords = [[0, 0]];

  #objNormals = [[0, 0, 0]];

  // Because indices are base 1, use placeholder for 0th data.
  objVertexData = [
    this.#objPositions,
    this.#objTexCoords,
    this.#objNormals,
  ];

  // Organized position (3), normal (3), uv (2)
  webglVertexData = [];

  objects = new Map();

  // ----- NOTE: Track state ----- //
  #state = {
    o: "",
    usemtl: "",
    materials: {},
    mtllib: "",
  };

  clear() {
    this.#clearVertices();
    this.#clearObject();
    this.objects.clear();
  }

  #clearVertices() {
    // Vertices are used for multiple objects, so keep until done with file.
    this.#objPositions.length = 0;
    this.#objTexCoords.length = 0;
    this.#objNormals.length = 0;
    this.#objPositions.push([0, 0, 0]);
    this.#objTexCoords.push([0, 0]);
    this.#objNormals.push([0, 0, 0]);
  }

  #clearObject() {
    this.#clearMaterial();
    this.#state.materials = {};
    this.#state.o = "";
  }

  #clearMaterial() {
    this.webglVertexData.length = 0;
    this.#state.usemtl = "";
  }

  #setObject() {
    if ( this.webglVertexData.length ) this.#setMaterial();
    const obj = new OBJObject(this.#state.o);
    for ( const material of Object.values(this.#state.materials) ) obj.materials.set(material.label, material);
    this.objects.set(obj.label, obj);
  }

  #setMaterial() {
    const material = new OBJMaterial();
    material.setValues({
      label: this.#state.usemtl,
      data: new Float32Array(this.webglVertexData),
      hasUVs: Boolean(this.#objTexCoords.length),
      hasNormals: Boolean(this.#objNormals.length),
      materialLib: this.#state.mtllib,
    });
    this.#state.materials[material.label] = material;
  }

  parse(text) {
    this.clear();
    text ??= this.objText;
    const lines = text.split("\n");

    if ( this.objectName ) {
      // Skip to the object name

    }

    let l = 0;
    for ( const line of lines ) {
      // console.debug(`Line ${l}`);
      l += 1;
      const trimmedLine = line.trim();
      if ( isComment(trimmedLine) ) continue;
      const m = keywordRE.exec(trimmedLine);
      if ( !m ) continue;

      // Handle the keyword for this line.
      const [, keyword, unparsedArgs] = m;
      const parts = trimmedLine.split(/\s+/).slice(1);
      const handler = this.keywords[keyword];
      if ( !handler ) {
        console.warn(`Unhandled keyword ${keyword} at line ${l}`);
        continue;
      }
      const res = handler(parts, unparsedArgs);
      if ( res === STOP ) return;
    }
    this.#setMaterial();
    this.#setObject();
  }

  // v are positions. E.g., v 1.000000 1.000000 -1.000000
  #vHandler(parts) { this.#objPositions.push(parts.map(parseFloat)); }

  // vn are normals. E.g., vn 0.0000 1.0000 0.0000
  #vnHandler(parts) { this.#objNormals.push(parts.map(parseFloat)); }

  // vt are texture coords. E.g., vt 0.375000 0.000000
  #vtHandler(parts) { this.#objTexCoords.push(parts.map(parseFloat)); }

  // f is face, with indices for positions, texture coords, normals.
  // Face can have 3+ (e.g., 4 for quad). Convert to triangles, assume concave polygon.
  // f 1 2 3              # indices for positions only
  // f 1/1 2/2 3/3        # indices for positions and texcoords
  // f 1/1/1 2/2/2 3/3/3  # indices for positions, texcoords, and normals
  // f 1//1 2//2 3//3     # indices for positions and normals
  #fHandler(parts) {
    // console.debug(`fHandler ${parts}`);
    const numTriangles = parts.length - 2;
    for ( let tri = 0; tri < numTriangles; tri += 1 ) {
      this.addVertex(parts[0]);
      this.addVertex(parts[tri + 1]);
      this.addVertex(parts[tri + 2]);
    }
  }

  // o signifies the start of a new object.
  #oHandler(_parts, unparsedArgs) {
    if ( this.#state.o ) {
      this.#setObject();
      this.#clearObject();
    }
    if ( this.objectName && this.objectName !== unparsedArgs ) return STOP;
    this.#state.o = unparsedArgs;
  }

  // usemtl signifies a material to use.
  // a single object could have multiple materials.
  #usemtlHandler(_parts, unparsedArgs) {
    if ( this.#state.usemtl ) {
      this.#setMaterial();
      this.#clearMaterial();
    }
    this.#state.usemtl = unparsedArgs;
  }

  // mtllib identifies a material library file (.mtl)
  #mtllibHandler(_parts, unparsedArgs) { this.#state.mtllib = unparsedArgs; }

  /**
   * Add vertex to the shape data.
   *
   * @param {string} vert      The text indices for a vertex, e.g., "1", "2/2/2", "3//3", "1/1"
   *                           where the indices are for position/texcoord/normal
   */
  addVertex(vert) {
    // console.debug(`addVertex ${vert}`);
    const ptn = vert.split("/");
    const components = Array(3);
    ptn.forEach((idxStr, i) => {
      if ( !idxStr ) return;
      const objIndex = parseInt(idxStr);
      const index = objIndex + (objIndex >= 0 ? 0 : this.objVertexData[i].length);
      components[i] = this.objVertexData[i][index];
    });
    this.webglVertexData.push(...components[0]);    // Position
    this.webglVertexData.push(...(components[2] ?? [0, 0, 0]));  // Normal
    this.webglVertexData.push(...(components[1] ?? [0, 0])); // UV
  }

  // Functions to handle distinct keywords of the OBJ file.
  keywords = {
    v: this.#vHandler.bind(this),
    vn: this.#vnHandler.bind(this),
    vt: this.#vtHandler.bind(this),
    f: this.#fHandler.bind(this),
    o: this.#oHandler.bind(this),
    usemtl: this.#usemtlHandler.bind(this),
    mtllib: this.#mtllibHandler.bind(this),
  };
}

function isComment(str) { return !str || str.startsWith("#"); }

class OBJObject {

  label = "";

  materials = new Map();

  constructor(label = "") { this.label = label; }

  clone() {
    const materials = new Map();
    for ( const material of this.materials.values() ) materials.set(material.label, material.clone());
    const out = new this.constructor();
    out.label = this.label;
    out.materials = materials;
    return out;
  }

  addNewMaterial(materialValues = {}) {
    const material = new OBJMaterial();
    material.setValues(materialValues);
    this.materials.set(material.label, material);
  }

  combineMaterials({ keepUVs = true, keepNormals = true } = {}) {
    const materialArrs = Array(this.materials.size);
    let i = 0;
    this.materials.forEach(material => materialArrs[i++] = material.data);
    const vs = combineTypedArrays(...materialArrs);
    const trimmed = BasicVertices.trimNormalsAndUVs(vs, { keepNormals, keepUVs });
    return BasicVertices.condenseVertexData(trimmed, { stride: (3 + (keepNormals * 3) + (keepUVs * 2)) });
  }
}

class OBJMaterial {

  label = "";

  data = new Float32Array();

  hasUVs = true;

  hasNormals = true;

  materialLib = "";

  constructor(label = foundry.utils.randomID()) { this.label = label; }

  clone() {
    const out = new this.constructor();
    const { label, data, hasUVs, hasNormals, materialLib } = this;
    out.setValues({ label, data, hasUVs, hasNormals, materialLib });
    return out;
  }

  setValues(values = {}) {
    for ( const [key, value] of Object.entries(values) ) {
      if ( this[key] ) this[key] = value;
    }
  }

  #indices;

  #vertices;

  get stride() { return 3 + this.hasUVs * 2 + this.hasNormals * 3; }

  get indices() {
    if ( !this.#indices ) this.__calculateIndicesVertices();
    return this.#indices;
  }

  get vertices() {
    if ( !this.#vertices ) this._calculateIndicesVertices();
    return this.#vertices;
  }

  _calculateIndicesVertices() {
    const { hasUVs, hasNormals } = this;
    const vs = BasicVertices.trimNormalsAndUVs(this.data, { keepNormals: hasNormals, keepUVs: hasUVs });
    const res = BasicVertices.condenseVertexData(vs, { stride: this.stride });
    this.#indices = res.indices;
    this.#vertices = res.vertices;
  }
}

/* Testing
api = game.modules.get("tokenvisibility").api
BasicVertices = api.geometry.BasicVertices
OBJParser = api.geometry.OBJParser

parser = new OBJParser("modules/tokenvisibility/icons/Cube.obj")
await parser.loadObjectFile()
parser.parse()
cube = parser.objects.get("Cube")
cube.combineMaterials()
cube.combineMaterials({ keepUVs: false, keepNormals: false })

parser = new OBJParser("modules/tokenvisibility/icons/box.obj")
await parser.loadObjectFile()
parser.parse()


parser = new OBJParser("modules/tokenvisibility/icons/BGE_Dragon_2.5_Blender_Game_Engine_2.obj")
await parser.loadObjectFile()
parser.parse()
*/