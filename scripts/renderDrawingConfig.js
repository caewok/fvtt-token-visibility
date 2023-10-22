/* globals
renderTemplate
*/

"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";

/**
 * Inject html to add controls to the drawing configuration.
 * If Levels module is active, allow the user to set drawings as holes for Area2d and Area3d.
 */
export async function renderDrawingConfigHook(app, html, data) {
  if ( !MODULES_ACTIVE.LEVELS ) return;
  const template = `modules/${MODULE_ID}/templates/token-visibility-drawing-config.html`;
  const myHTML = await renderTemplate(template, data);
  html.find("div[data-tab='position']").find(".form-group").last().after(myHTML);
}
