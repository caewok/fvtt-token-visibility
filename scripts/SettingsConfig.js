/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { SETTINGS, getSetting } from "./settings.js";

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
export function renderSettingsConfig(app, html, _data) {
  activateListenersSettingsConfig(app, html);

  const tvSettings = html.find(`section[data-tab="${MODULE_ID}"]`);
  if ( !tvSettings || !tvSettings.length ) return;

  const losAlgorithm = getSetting(SETTINGS.LOS.ALGORITHM);
  const coverAlgorithm = getSetting(SETTINGS.COVER.ALGORITHM);

  const displayArea = losAlgorithm === SETTINGS.LOS.TYPES.POINTS ? "none" : "block";
  const inputLOSArea = tvSettings.find(`input[name="${MODULE_ID}.${SETTINGS.LOS.PERCENT_AREA}"]`);
  const divLOSArea = inputLOSArea.parent().parent();
  divLOSArea[0].style.display = displayArea;

  const [displayCoverTriggers, displayCenterCoverTrigger] = coverAlgorithm === SETTINGS.COVER.TYPES.CENTER_CENTER
    ? ["none", "block"] : ["block", "none"];

  const inputCenter = tvSettings.find(`select[name="${MODULE_ID}.${SETTINGS.COVER.TRIGGER_CENTER}"]`);
  const inputLow = tvSettings.find(`input[name="${MODULE_ID}.${SETTINGS.COVER.TRIGGER_PERCENT.LOW}"]`);
  const inputMedium = tvSettings.find(`input[name="${MODULE_ID}.${SETTINGS.COVER.TRIGGER_PERCENT.MEDIUM}"]`);
  const inputHigh = tvSettings.find(`input[name="${MODULE_ID}.${SETTINGS.COVER.TRIGGER_PERCENT.HIGH}"]`);

  const divInputCenter = inputCenter.parent().parent();
  const divInputLow = inputLow.parent().parent();
  const divInputMedium = inputMedium.parent().parent();
  const divInputHigh = inputHigh.parent().parent();

  if ( divInputCenter.length ) divInputCenter[0].style.display = displayCenterCoverTrigger;
  if ( divInputLow.length ) divInputLow[0].style.display = displayCoverTriggers;
  if ( divInputMedium.length ) divInputMedium[0].style.display = displayCoverTriggers;
  if ( divInputHigh.length ) divInputHigh[0].style.display = displayCoverTriggers;
}

PATCHES.BASIC.HOOKS = { renderSettingsConfig };

// ----- NOTE: Helper functions ----- //

function activateListenersSettingsConfig(app, html) {
  html.find(`[name="${MODULE_ID}.${SETTINGS.LOS.ALGORITHM}"]`).change(losAlgorithmChanged.bind(app));
  html.find(`[name="${MODULE_ID}.${SETTINGS.COVER.ALGORITHM}"]`).change(coverAlgorithmChanged.bind(app));
}

function losAlgorithmChanged(event) {
  const losAlgorithm = event.target.value;
  const displayArea = (losAlgorithm === SETTINGS.LOS.TYPES.AREA
    || losAlgorithm === SETTINGS.LOS.TYPES.AREA3D) ? "block" : "none";

  const inputLOSArea = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.PERCENT_AREA}`);
  const divLOSArea = inputLOSArea[0].parentElement.parentElement;
  divLOSArea.style.display = displayArea;
}

function coverAlgorithmChanged(event) {
  const coverAlgorithm = event.target.value;
  const [displayCoverTriggers, displayCenterCoverTrigger] = coverAlgorithm === SETTINGS.COVER.TYPES.CENTER_CENTER
    ? ["none", "block"] : ["block", "none"];

  const inputCenter = document.getElementsByName(`${MODULE_ID}.${SETTINGS.COVER.TRIGGER_CENTER}`);
  const inputLow = document.getElementsByName(`${MODULE_ID}.${SETTINGS.COVER.TRIGGER_PERCENT.LOW}`);
  const inputMedium = document.getElementsByName(`${MODULE_ID}.${SETTINGS.COVER.TRIGGER_PERCENT.MEDIUM}`);
  const inputHigh = document.getElementsByName(`${MODULE_ID}.${SETTINGS.COVER.TRIGGER_PERCENT.HIGH}`);

  const divInputCenter = inputCenter[0].parentElement.parentElement;
  const divInputLow = inputLow[0].parentElement.parentElement;
  const divInputMedium = inputMedium[0].parentElement.parentElement;
  const divInputHigh = inputHigh[0].parentElement.parentElement;

  divInputCenter.style.display = displayCenterCoverTrigger;
  divInputLow.style.display = displayCoverTriggers;
  divInputMedium.style.display = displayCoverTriggers;
  divInputHigh.style.display = displayCoverTriggers;
}
