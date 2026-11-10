/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for Token configuration rendering.

import { TEMPLATES } from "./const.js";
import { injectOpacityControl } from "./util.js";

export const PATCHES = {};
PATCHES.BASIC = {};

function renderTokenConfig(app, html, data) {
  injectOpacityControl(app, html, data, {
    template: TEMPLATES.TOKEN_CONFIG,
    containerSelector: "div[data-tab='identity']",
  });
}

PATCHES.BASIC.HOOKS = {
  renderTokenConfig
};
