/* globals
FormApplication
foundry,
game,
SettingsConfig,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Settings, SETTINGS } from "./settings.js";
import { SettingsSubmenu } from "./SettingsSubmenu.js";

export class DefaultSettings {
  static get changeableSettings() {
    const { RANGE, LOS } = SETTINGS;
    const { VIEWER, TARGET } = LOS;
    return [
      RANGE.ALGORITHM,
      RANGE.POINTS3D,
      RANGE.DISTANCE3D,

      VIEWER.NUM_POINTS,
      VIEWER.INSET,

      TARGET.ALGORITHM,
      TARGET.PERCENT,
      TARGET.LARGE,

      TARGET.POINT_OPTIONS.NUM_POINTS,
      TARGET.POINT_OPTIONS.INSET,
      TARGET.POINT_OPTIONS.POINTS3D
    ];
  }

  static get foundry() {
    const { RANGE, LOS } = SETTINGS;
    const { VIEWER, TARGET } = LOS;
    return {
      // Range
//       [RANGE.ALGORITHM]: SETTINGS.POINT_TYPES.NINE,
      [RANGE.POINTS3D]: false,
      [RANGE.DISTANCE3D]: false,

      // LOS Viewer
//       [VIEWER.NUM_POINTS]: SETTINGS.POINT_TYPES.CENTER,
      // Unused: [SETTINGS.LOS.VIEWER.INSET]: 0

      // LOS Target
      [TARGET.ALGORITHM]: TARGET.TYPES.POINTS,
      [TARGET.PERCENT]: 0,
      [TARGET.LARGE]: false,

      // LOS Point options
//       [TARGET.POINT_OPTIONS.NUM_POINTS]: SETTINGS.POINT_TYPES.NINE,
      [TARGET.POINT_OPTIONS.INSET]: 0.75,
      [TARGET.POINT_OPTIONS.POINTS3D]: false
    };
  }

  static get dnd5e() {
    const { RANGE, LOS } = SETTINGS;
    const { VIEWER, TARGET } = LOS;
    return {
      // Range
//       [RANGE.ALGORITHM]: SETTINGS.POINT_TYPES.NINE,
      [RANGE.POINTS3D]: false,
      [RANGE.DISTANCE3D]: false,

      // LOS Viewer
//       [VIEWER.NUM_POINTS]: SETTINGS.POINT_TYPES.FOUR,
      [VIEWER.INSET]: 0,

      // LOS Target
      [TARGET.ALGORITHM]: TARGET.TYPES.POINTS,
      [TARGET.PERCENT]: 0,
      [TARGET.LARGE]: true,

      // LOS Point options
//       [TARGET.POINT_OPTIONS.NUM_POINTS]: SETTINGS.POINT_TYPES.FOUR,
      [TARGET.POINT_OPTIONS.INSET]: 0,
      [TARGET.POINT_OPTIONS.POINTS3D]: false
    };
  }

  static get threeD() {
    const { RANGE, LOS } = SETTINGS;
    const { VIEWER, TARGET } = LOS;
    return {
      // Range
//       [RANGE.ALGORITHM]: SETTINGS.POINT_TYPES.NINE,
      [RANGE.POINTS3D]: true,
      [RANGE.DISTANCE3D]: true,

      // LOS Viewer
//       [VIEWER.NUM_POINTS]: SETTINGS.POINT_TYPES.CENTER,

      // LOS Target
      [TARGET.ALGORITHM]: TARGET.TYPES.AREA3D,
      [TARGET.PERCENT]: 0.2,
      [TARGET.LARGE]: true
    };
  }
}

export class ATVSettingsSubmenu extends SettingsSubmenu {
  static DEFAULT_OPTIONS = {
    initialCategory: "losTarget",
    subtemplates: {
      sidebarFooter: `modules/${MODULE_ID}/templates/settings-submenu-buttons.html`,
    },
    actions: {
      resetDND5e: ATVSettingsSubmenu.#onResetDND5e,
      reset3d: ATVSettingsSubmenu.#onReset3d,
    },
  };

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const losTab = this.element.querySelectorAll('[data-tab="losTarget"]')[1];
    if ( losTab ) {
      // Add data action to the algorithm selector.
      const algSelector = losTab.querySelector('[name="tokenvisibility.los-algorithm"]');
      algSelector.addEventListener("change", ATVSettingsSubmenu._onAlgorithmSelect.bind(this));
      await ATVSettingsSubmenu._onAlgorithmSelect.call(this);
    }
  }

  static async #onResetDND5e() {
    console.log("onResetDND5e");
  }

  static async #onReset3d() {
    console.log("onReset3d");
  }

  static async _onAlgorithmSelect() {
    const losTab = this.element.querySelectorAll('[data-tab="losTarget"]')[1];
    if ( losTab ) {
    // Add data action to the algorithm selector.
      const algSelector = losTab.querySelector('[name="tokenvisibility.los-algorithm"]');
      const isPoints = algSelector.value === "los-algorithm-points";
      const targetOptionsElem = losTab.querySelector('[name="tokenvisibility.los-points-options-target"]');
      targetOptionsElem.parentElement.parentElement.style.display = isPoints ? "block" : "none";

      const targetInsetElem = losTab.querySelector('[name="tokenvisibility.los-inset-target"]');
      targetInsetElem.parentElement.parentElement.style.display = isPoints ? "block" : "none";
    }
    this.setPosition(this.position); // Force display refresh.
  }
}

