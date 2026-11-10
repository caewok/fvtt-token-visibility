/* globals
foundry,
game,
ui,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, SETTINGS, ENUMS } from "./const.js";
import { SettingsSubmenu } from "./SettingsSubmenu.js";
import { ModuleSettingsAbstract } from "./ModuleSettingsAbstract.js";
import { ViewerLOS } from "./LOS/ViewerLOS.js";

export class ATVSettingsSubmenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    initialCategory: "losTarget",
    subtemplates: {
      sidebarFooter: `modules/${MODULE_ID}/templates/settings-submenu-buttons.html`,
    },
    actions: {
      resetDND5e: ATVSettingsSubmenu.#onResetDND5e,
      reset3d: ATVSettingsSubmenu.#onReset3d,
      resetDefaults: ATVSettingsSubmenu.#onResetDefaults,
    },
  };

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const tabs = this.element.querySelectorAll('[data-tab="losTarget"]');
    const targetTab = tabs.length > 1 ? tabs[1] : null;
    if ( targetTab ) {
      // Add data action to the algorithm selector.
      const algSelector = targetTab.querySelector(`[name="${MODULE_ID}.${SETTINGS.LOS.TARGET.ALGORITHM}"]`);
      if ( !algSelector ) return;
      algSelector.addEventListener("change", ATVSettingsSubmenu._onAlgorithmSelect.bind(this));
      await ATVSettingsSubmenu._onAlgorithmSelect.call(this);
    }
  }

  static async #onResetDND5e() {
    // Set each value in the application.
    const PI = ViewerLOS.POINT_INDICES;
    const { LOS, RANGE } = SETTINGS;
    const opts = {
      losTarget: {
        [LOS.TARGET.ALGORITHM]: ENUMS.ALGORITHM_TYPES.POINTS,
        [LOS.TARGET.PERCENT]: 0,
        [LOS.TARGET.LARGE]: true,
        [LOS.TARGET.POINTS]: [PI.CORNERS.FACING, PI.CORNERS.BACK, PI.CORNERS.MID],
        [LOS.TARGET.INSET]: 0,
      },
      losViewer: {
        [LOS.VIEWER.POINTS]: [PI.CORNERS.FACING, PI.CORNERS.MID], // Viewers have no back corners / sides.
        [LOS.VIEWER.INSETS.TOP]: 0,
        [LOS.VIEWER.INSETS.BOTTOM]: 0,
        [LOS.VIEWER.INSETS.SIDES]: 0,
      },
      range: {
        [RANGE.ALGORITHM]: ENUMS.POINT_TYPES.NINE,
        [RANGE.POINTS3D]: false,
        [RANGE.DISTANCE3D]: false,
      },
    };
    setOptionValues.call(this, opts);
    await this.constructor._onAlgorithmSelect.call(this);
    const moduleName = game.i18n.localize(`${MODULE_ID}.name`);
    const message = game.i18n.localize(`${MODULE_ID}.settings.submenu.notifyDND5e`);
    ui.notifications.notify(`${moduleName} | ${message}`);
  }

  static async #onReset3d() {
    // Set each value in the application.
    const PI = ViewerLOS.POINT_INDICES;
    const { LOS, RANGE } = SETTINGS;
    const opts = {
      losTarget: {
        [LOS.TARGET.ALGORITHM]: ENUMS.ALGORITHM_TYPES.WEBGL2,
        [LOS.TARGET.PERCENT]: 0.2,
        [LOS.TARGET.LARGE]: false,
        [LOS.TARGET.POINTS]: [PI.CENTER],
        [LOS.TARGET.INSET]: 0,
      },
      losViewer: {
        [LOS.VIEWER.POINTS]: [PI.CENTER],
        [LOS.VIEWER.INSETS.TOP]: 0,
        [LOS.VIEWER.INSETS.BOTTOM]: 0,
        [LOS.VIEWER.INSETS.SIDES]: 0,
      },
      range: {
        [RANGE.ALGORITHM]: ENUMS.POINT_TYPES.NINE,
        [RANGE.POINTS3D]: true,
        [RANGE.DISTANCE3D]: true,
      },
    };
    setOptionValues.call(this, opts);
    await this.constructor._onAlgorithmSelect.call(this);
    const moduleName = game.i18n.localize(`${MODULE_ID}.name`);
    const message = game.i18n.localize(`${MODULE_ID}.settings.submenu.notify3d`);
    ui.notifications.notify(`${moduleName} | ${message}`);
  }

  static async #onResetDefaults() {
    // Reset to module default settings defined in registration.
    // Only keys specific to the LOS settings, range.
    const opts = {
      losTargets: {},
      losViewer: {},
      range: {},
      other: {},
    };

    const losTargetKeys = Object.values(foundry.utils.flattenObject(SETTINGS.LOS.TARGET));
    const losViewerKeys = Object.values(foundry.utils.flattenObject(SETTINGS.LOS.VIEWER));
    const rangeKeys = Object.values(foundry.utils.flattenObject(SETTINGS.RANGE));
    const otherKeys = Object.values(foundry.utils.flattenObject(SETTINGS.LOS.BLOCKING));

    for ( const key of losTargetKeys ) opts.losTargets[key] = ModuleSettingsAbstract.getDefaultKey(key);
    for ( const key of losViewerKeys ) opts.losViewer[key] = ModuleSettingsAbstract.getDefaultKey(key);
    for ( const key of rangeKeys ) opts.range[key] = ModuleSettingsAbstract.getDefaultKey(key);
    for ( const key of otherKeys ) opts.other[key] = ModuleSettingsAbstract.getDefaultKey(key);

    setOptionValues.call(this, opts);
    await this.constructor._onAlgorithmSelect.call(this);
    const moduleName = game.i18n.localize(`${MODULE_ID}.name`);
    const message = game.i18n.localize(`${MODULE_ID}.settings.submenu.notifyDefaults`)
      || "Settings reset to defaults.";
    ui.notifications.notify(`${moduleName} | ${message}`);
  }

  static async _onAlgorithmSelect() {
    const losTab = this.element.querySelectorAll('[data-tab="losTarget"]')[1];
    if ( losTab ) {
      // Add data action to the algorithm selector.
      const algSelector = losTab.querySelector(`[name="${MODULE_ID}.${SETTINGS.LOS.TARGET.ALGORITHM}"]`);
      if ( !algSelector ) return;
      const isPoints = algSelector.value === ENUMS.ALGORITHM_TYPES.POINTS;

      const targetOptionsElem = losTab.querySelector(`[name="${MODULE_ID}.${SETTINGS.LOS.TARGET.POINTS}"]`);
      if ( targetOptionsElem ) {
        targetOptionsElem.parentElement.parentElement.style.display = isPoints ? "block" : "none";
      }

      const targetInsetElem = losTab.querySelector(`[name="${MODULE_ID}.${SETTINGS.LOS.TARGET.INSET}"]`);
      if ( targetInsetElem ) {
        targetInsetElem.parentElement.parentElement.style.display = isPoints ? "block" : "none";
      }
    }
    this.setPosition(this.position); // Force display refresh.
  }
}

/**
 * Helper to set different elements of the settings submenu.
 * @param {object} tabOpts
 *   - @prop {object} tab name
 *     - @prop {object} setting name: setting value
 */
function setOptionValues(tabOpts) {
  for ( const tab of Object.keys(tabOpts) ) {
    const tabElem = this.element.querySelectorAll(`[data-tab="${tab}"]`)[1];
    if ( !tabElem ) continue; // Failsafe.
    for ( let [key, value] of Object.entries(tabOpts[tab]) ) {
      const optionElem = tabElem.querySelector(`[name="${MODULE_ID}.${key}"]`);
      if ( !optionElem ) continue;

      // Handle HTML input types properly (checkboxes vs values/selects)
      if ( optionElem.type === "checkbox" ) {
        optionElem.checked = Boolean(value);
      } else {
        if ( Array.isArray(value) ) value = value.map(v => String(v)); // Arrays are stored as string arrays.
        optionElem.value = value;
      }
    }
  }
}
