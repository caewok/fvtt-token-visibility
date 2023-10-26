/* globals
game,
renderTemplate,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { SETTINGS, getSetting } from "./settings.js";
import { DOCUMENTATION_URL, ISSUE_URL } from "./const.js";

// Patches for the VisionSource class
export const PATCHES = {};
PATCHES.BASIC = {};


// ----- NOTE: Hooks ----- //

/**
 * Settings manipulations to hide unneeded settings
 * Wipe the settings cache on update
 * @param {Application} application     The Application instance being rendered
 * @param {jQuery} html                 The inner HTML of the document that will be displayed and may be modified
 * @param {object} data                 The object of data used when rendering the application
 */
async function renderSettingsConfig(app, html, data) {
  if ( !game.user.isGM ) return;

  const settings = html.find(`section[data-tab="${MODULE_ID}"]`);
  if ( !settings || !settings.length ) return;

  const template = `modules/${MODULE_ID}/templates/settings-buttons.html`;
  const myHTML = await renderTemplate(template, data);
  settings.last().after(myHTML);
  app.setPosition(app.position);

  activateListenersSettingsConfig(app, html);
}

PATCHES.BASIC.HOOKS = { renderSettingsConfig };

// ----- NOTE: Helper functions ----- //

function activateListenersSettingsConfig(app, html) {
  // Documentation button
  html.find(`[name="${MODULE_ID}-${SETTINGS.BUTTONS.DOCUMENTATION}"]`).click(openDocumentation.bind(app));
  html.find(`[name="${MODULE_ID}-${SETTINGS.BUTTONS.ISSUE}"]`).click(openIssue.bind(app));
}

function openDocumentation(event) {
  window.open(DOCUMENTATION_URL, "_blank");
}

function openIssue(event) {
  window.open(ISSUE_URL, "_blank");
}