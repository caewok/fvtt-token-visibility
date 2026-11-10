/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for Wall configuration rendering.

import { TEMPLATES } from "./const.js";
import { injectOpacityControl } from "./util.js";

export const PATCHES = {};
PATCHES.BASIC = {};

function renderWallConfig(app, html, data) {
  injectOpacityControl(app, html, data, {
    template: TEMPLATES.WALL_CONFIG,
    containerSelector: "div[data-application-part='body']",
  });
}

PATCHES.BASIC.HOOKS = {
  renderWallConfig
};
