/* globals
renderTemplate
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";

// Patches for the DrawingConfig class
export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * Add controls to the measured template configuration.
 * Inject html to add controls to the drawing configuration.
 * If Levels module is active, allow the user to set drawings as holes for Area2d and Area3d.
 */
async function renderDrawingConfig(app, html, data) {
  if ( !MODULES_ACTIVE.LEVELS ) return;
  const template = `modules/${MODULE_ID}/templates/token-visibility-drawing-config.html`;
  const myHTML = await renderTemplate(template, data);
  html.find("div[data-tab='position']").find(".form-group").last().after(myHTML);
}

PATCHES.BASIC = { renderDrawingConfig };
