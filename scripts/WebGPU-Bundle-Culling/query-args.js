/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// From https://github.com/toji/webgpu-bundle-culling/blob/3098596aef18acd91e93d85156b49f08fcee9831/js/query-args.js
/**
 * Provides a simple way to get values from the query string if they're present
 * and use a default value if not.
 *
 * @example
 * // For the URL http://example.com/index.html?particleCount=1000
 * QueryArgs.getInt("particleCount", 100); // URL overrides, returns 1000
 * QueryArgs.getInt("particleSize", 10); // Not in URL, returns default of 10
 */

let searchParams = null;
function clearArgsCache() {
  // Force re-parsing on next access
  searchParams = null;
}
window.addEventListener('popstate', clearArgsCache);
window.addEventListener('hashchange', clearArgsCache);

function ensureArgsCached() {
  if (!searchParams) {
    searchParams = new URLSearchParams(window.location.search);
  }
}

export class QueryArgs {
  static getString(name, defaultValue) {
    ensureArgsCached();
    return searchParams.get(name) || defaultValue;
  }

  static getInt(name, defaultValue) {
    ensureArgsCached();
    return searchParams.has(name) ? parseInt(searchParams.get(name), 10) : defaultValue;
  }

  static getFloat(name, defaultValue) {
    ensureArgsCached();
    return searchParams.has(name) ? parseFloat(searchParams.get(name)) : defaultValue;
  }

  static getBool(name, defaultValue) {
    ensureArgsCached();
    return searchParams.has(name) ? parseInt(searchParams.get(name), 10) != 0 : defaultValue;
  }
}

/*
Adapted from https://github.com/toji/webgpu-bundle-culling

MIT License

Copyright (c) 2023 Brandon Jones

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/