/* globals
document,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for Token configuration rendering.

import { MODULE_ID, TEMPLATES, FLAGS } from "./const.js";
import { fastFlag } from "./util.js";
import { renderTemplateSync } from "./geometry/util.js";

export const PATCHES = {};
PATCHES.BASIC = {};

function renderTokenConfig(app, html, data) {
  const doc = app.document ?? app.token;
  const opacity = fastFlag(doc, FLAGS.OPACITY) ?? 1;
  const opacityPercent = Math.round(opacity * 100);

  const myHTML = renderTemplateSync(TEMPLATES.TOKEN_CONFIG, {
    ...data,
    [MODULE_ID]: { opacity, opacityPercent },
  });
  if ( !myHTML ) return;

  const container = document.createElement("div");
  container.innerHTML = myHTML;

  // Keep the stored 0–1 value in sync with the percentage picker..
  const picker = container.querySelector("range-picker");
  const hidden = container.querySelector("input[type='hidden']");
  if ( !picker || !hidden ) return;
  picker.addEventListener("change", () => {
    hidden.value = Math.round(picker.value) / 100;
  });

  const divSet = html.querySelector("div[data-tab='identity']");
  if ( !divSet ) return;
  divSet.appendChild(container);
  app.setPosition(app.position);
}

PATCHES.BASIC.HOOKS = {
  renderTokenConfig
};
