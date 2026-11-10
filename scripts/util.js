/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, FLAGS } from "./const.js";
import { renderTemplateSync } from "./geometry/util.js";


/**
 * Faster version of PlaceableDocument#getFlag.
 * Keyed to this module. Does not handle nested flag properties (use only the base flag property).
 * @param {PlaceableDocument} placeableD
 * @param {string} flag
 * @returns {*} Flag at that position or undefined.
 */
export function fastFlag(placeableD, flag) { return placeableD.flags[MODULE_ID]?.[flag]; }

/**
 * Log if this module's debug config is enabled.
 */
export function log(...args) {
  try {
    if ( CONFIG[MODULE_ID].debug ) console.debug(MODULE_ID, "|", ...args);
  } catch(_e) {  // eslint-disable-line no-unused-vars
    // Empty
  }
}

/* globals
document,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";


/**
 * Shared helper for the config hooks (token, wall) that add an opacity slider to a document's config sheet.
 * The template must contain a `range-picker` (percent) and a hidden input (stored 0–1 value).
 *
 * @param {ApplicationV2} app                     The config application being rendered
 * @param {HTMLElement} html                      The application element
 * @param {object} data                           Render context passed to the hook
 * @param {object} opts
 * @param {string} opts.template                  Path to the handlebars template to render
 * @param {string} opts.containerSelector         Where in `html` to append the rendered control
 * @returns {HTMLElement|undefined} The injected container, if added
 */
export function injectOpacityControl(app, html, data, { template, containerSelector } = {}) {
  const target = html.querySelector(containerSelector);
  if ( !target ) return;

  // Avoid duplicates if the application part is rendered again without being replaced.
  const marker = `data-${MODULE_ID}-opacity`;
  if ( target.querySelector(`[${marker}]`) ) return;

  const doc = app.document ?? app.token;
  const opacity = fastFlag(doc, FLAGS.OPACITY) ?? 1;
  const opacityPercent = Math.round(opacity * 100);

  const myHTML = renderTemplateSync(template, {
    ...data,
    [MODULE_ID]: { opacity, opacityPercent },
  });
  if ( !myHTML ) return;

  const container = document.createElement("div");
  container.setAttribute(marker, "");
  container.innerHTML = myHTML;

  // Keep the stored 0–1 value in sync with the percentage picker.
  const picker = container.querySelector("range-picker");
  const hidden = container.querySelector("input[type='hidden']");
  if ( !picker || !hidden ) return;
  picker.addEventListener("change", () => {
    hidden.value = Math.round(picker.value) / 100;
  });

  target.appendChild(container);
  app.setPosition(app.position);
  return container;
}
