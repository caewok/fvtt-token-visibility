/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/**
Class for handling configuration of an object.
Meant to be used in a class, like:

class rectangle {
  config = new ConfigHandler({
    senseType: "sight",
    walls: true,
  });
}
rectangle.config.senseType;

config.senseType = () => Math.random();

√ Add properties:
config.add({ tiles: true, levels: { background: true, foreground: false }})
config.tiles

√ Update properties without affecting other:
config.update({ levels: { background: false }}) OR
config.levels.background = false

√ Add a function that returns a config property dynamically:
config.add({ date: () => Date() })
config.date

√ Temporarily change the configuration.
config.useTemporary = true
config.tiles = false;
config.tiles // returns false
config.useTemporary = false;
config.tiles // returns true

√ Enumerate the object, returning only config keys/values.
Object.entries(config)

*/


export class ConfigHandler {

  constructor(cfgs = {}) {
    this.add(cfgs);
  }

  #permanentCfg = {};

  #cfg = this.#permanentCfg;

  #useTemporary = false;

  get useTemporary() { return this.#useTemporary; }

  set useTemporary(value) {
    if ( value ) this.#cfg = cloneWithFunctions(this.#permanentCfg);
    else this.#cfg = this.#permanentCfg;
    this.#useTemporary = value;
  }

  add(cfgs) {
    if ( isObjectEmpty(cfgs) ) return;
    foundry.utils.mergeObject(this.#cfg, cfgs, { inplace: true, insertKeys: true, recursive: true });
    Object.defineProperties(this, this.#getProperties(cfgs));
  }

  #getProperties(cfgs) {
    const props = {};
    for ( const key of Object.keys(cfgs) ) {
      if ( !Object.hasOwn(this.#cfg, key) ) continue;
      props[key] = {
        get: () => {
          const val = this.#cfg[key];
          return typeof val === "function" ? val() : val;
        },
        set: (value) => this.#cfg[key] = value,
        enumerable: true, // So Object.keys(), etc. work.
        configurable: true, // Required for deletion.
      };
    }
    return props;
  }

  delete(key) {
    delete this.#cfg[key];
    delete this[key];
  }

  set(cfgs) {
    if ( isObjectEmpty(cfgs) ) return;
    foundry.utils.mergeObject(this.#cfg, cfgs, { inplace: true, insertKeys: false, recursive: true });
    // Object.defineProperties(this, this.#getProperties(cfgs)); // Should not be necessary; covered by add.
  }
}

/**
 * Handle properties that may be functions when cloning.
 */
function cloneWithFunctions(value) {
  const functions = new Map();
  let id = 0;

  // Step 1: Deep traverse to replace functions with unique string placeholders
  function replaceFunctions(val) {
    if ( typeof val === 'function' ) {
      const placeholder = `__FUNC_REF_${id++}__`;
      functions.set(placeholder, val);
      return placeholder;
    }

    if ( val !== null && typeof val === 'object' ) {
      // Avoid mutating the original object structure
      if (Array.isArray(val)) return val.map(replaceFunctions);

      // Handle plain objects (skip specialized built-in objects like Date, RegExp, etc.)
      if (val.constructor === Object || !val.constructor) {
        const copy = {};
        for ( const key of Object.keys(val) ) copy[key] = replaceFunctions(val[key]);
        return copy;
      }
    }

    return val;
  }

  // Step 2: Restore function references in the cloned object
  function restoreFunctions(val) {
    if ( typeof val === 'string' && functions.has(val) ) return functions.get(val);

    if (val !== null && typeof val === 'object') {
      if (Array.isArray(val)) return val.map(restoreFunctions);
      if ( val.constructor === Object || !val.constructor ) {
        for (const key of Object.keys(val)) val[key] = restoreFunctions(val[key]);
      }
    }

    return val;
  }

  // Pre-process, run structuredClone, then restore function references
  const preprocessed = replaceFunctions(value);
  const cloned = structuredClone(preprocessed);
  return restoreFunctions(cloned);
}

/**
 * Is this object empty?
 * @param {object} obj
 * @returns {boolean}
 */
function isObjectEmpty(obj) { return !Object.keys(obj).length; }