/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { SETTINGS, getSetting, setSetting } from "./settings.js";

class DefaultSettings {
  static get foundry() {
    return {
      // Range
      [SETTINGS.RANGE.ALGORITHM]: SETTINGS.POINT_TYPES.NINE,
      [SETTINGS.RANGE.POINTS3D]: false,
      [SETTINGS.RANGE.DISTANCE3D]: false,

      // LOS Viewer
      [SETTINGS.LOS.VIEWER.NUM_POINTS]: SETTINGS.POINT_TYPES.CENTER,
      // Unused: [SETTINGS.LOS.VIEWER.INSET]: 0

      // LOS Target
      [SETTINGS.LOS.ALGORITHM]: SETTINGS.LOS.TYPES.POINTS,
      [SETTINGS.LOS.PERCENT]: 0,
      [SETTINGS.LOS.LARGE_TARGET]: false,

      // LOS Point options
      [SETTINGS.LOS.POINT_OPTIONS.NUM_POINTS]: SETTINGS.POINT_TYPES.NINE,
      [SETTINGS.LOS.POINT_OPTIONS.INSET]: 0.75,
      [SETTINGS.LOS.POINT_OPTIONS.POINTS3D]: false
    };
  }

  static get dnd5e() {
    return {
      // Range
      [SETTINGS.RANGE.ALGORITHM]: SETTINGS.POINT_TYPES.NINE,
      [SETTINGS.RANGE.POINTS3D]: false,
      [SETTINGS.RANGE.DISTANCE3D]: false,

      // LOS Viewer
      [SETTINGS.LOS.VIEWER.NUM_POINTS]: SETTINGS.POINT_TYPES.FOUR,
      [SETTINGS.LOS.VIEWER.INSET]: 0,

      // LOS Target
      [SETTINGS.LOS.ALGORITHM]: SETTINGS.LOS.TYPES.POINTS,
      [SETTINGS.LOS.PERCENT]: 0,
      [SETTINGS.LOS.LARGE_TARGET]: true,

      // LOS Point options
      [SETTINGS.LOS.POINT_OPTIONS.NUM_POINTS]: SETTINGS.POINT_TYPES.FOUR,
      [SETTINGS.LOS.POINT_OPTIONS.INSET]: 0,
      [SETTINGS.LOS.POINT_OPTIONS.POINTS3D]: false
    };
  }

  static get threeD() {
    return {
      // Range
      [SETTINGS.RANGE.ALGORITHM]: SETTINGS.POINT_TYPES.NINE,
      [SETTINGS.RANGE.POINTS3D]: true,
      [SETTINGS.RANGE.DISTANCE3D]: true,

      // LOS Viewer
      [SETTINGS.LOS.VIEWER.NUM_POINTS]: SETTINGS.POINT_TYPES.CENTER,

      // LOS Target
      [SETTINGS.LOS.ALGORITHM]: SETTINGS.LOS.TYPES.AREA3D,
      [SETTINGS.LOS.PERCENT]: 0.2,
      [SETTINGS.LOS.LARGE_TARGET]: true
    };
  }
}

export class SettingsSubmenu extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: game.i18n.localize(`${MODULE_ID}.settings.submenu.title`),
      template: `modules/${MODULE_ID}/templates/settings-menu.html`,
      height: "auto",
      width: 700,
      tabs: [
        {
          navSelector: ".tabs",
          contentSelector: "form",
          initial: "range"
        }
      ]
    });
  }

  getData(options={}) {
    return foundry.utils.mergeObject(super.getData(options), {
      settings: this._prepareCategoryData()
    });
  }

  activateListeners(html) {
    this._initializeDisplayOptions();
    super.activateListeners(html);

    // Hide certain settings depending on options selected.
    html.find(`[name="${MODULE_ID}.${SETTINGS.LOS.ALGORITHM}"]`).change(this.losAlgorithmChanged.bind(this));
    html.find(`[name="${MODULE_ID}.${SETTINGS.LOS.VIEWER.NUM_POINTS}"]`).change(this.losViewerPointsChanged.bind(this));
    html.find(`[name="${MODULE_ID}.${SETTINGS.LOS.POINT_OPTIONS.NUM_POINTS}"]`).change(this.losTargetPointsChanged.bind(this));

    // Buttons to reset settings to defaults.
    html.find(`[name="${MODULE_ID}-${SETTINGS.BUTTONS.FOUNDRY_DEFAULT}"]`).click(this.submitSettingUpdates.bind(this, "button-foundry-default", DefaultSettings.foundry));
    html.find(`[name="${MODULE_ID}-${SETTINGS.BUTTONS.DND_5E_DMG}"]`).click(this.submitSettingUpdates.bind(this, "button-dnd5e-dmg", DefaultSettings.dnd5e));
    html.find(`[name="${MODULE_ID}-${SETTINGS.BUTTONS.THREE_D}"]`).click(this.submitSettingUpdates.bind(this, "button-three-d", DefaultSettings.threeD));
  }

  async _updateObject(event, formData) {
    await game.settings._sheet._updateObject(event, formData);
  }

  /**
   * Comparable to SettingsConfig.prototype._prepareCategoryData.
   * Prepare the settings data for this module only.
   * Exclude settings that are do not have a tab property.
   */
  _prepareCategoryData() {
    const settings = [];
    const canConfigure = game.user.can("SETTINGS_MODIFY");
    for ( let setting of game.settings.settings.values() ) {
      if ( setting.namespace !== MODULE_ID
        || !setting.tab
        || (!canConfigure && (setting.scope !== "client")) ) continue;

      // Update setting data
      const s = foundry.utils.deepClone(setting);
      s.id = `${s.namespace}.${s.key}`;
      s.name = game.i18n.localize(s.name);
      s.hint = game.i18n.localize(s.hint);
      s.value = game.settings.get(s.namespace, s.key);
      s.type = setting.type instanceof Function ? setting.type.name : "String";
      s.isCheckbox = setting.type === Boolean;
      s.isSelect = s.choices !== undefined;
      s.isRange = (setting.type === Number) && s.range;
      s.isNumber = setting.type === Number;
      s.filePickerType = s.filePicker === true ? "any" : s.filePicker;

      settings.push(s);
    }
    return settings;
  }

  _initializeDisplayOptions() {
    const LOS = SETTINGS.LOS;
    const algorithm = getSetting(LOS.ALGORITHM);
    const viewerPoints = getSetting(LOS.VIEWER.NUM_POINTS);
    const targetPoints = getSetting(LOS.POINT_OPTIONS.NUM_POINTS);
    this.#updatePointOptionDisplay(algorithm);
    this.#updateViewerInsetDisplay(viewerPoints);
    this.#updateTargetInsetDisplay(targetPoints, algorithm);
  }

  _updateDisplayOptions() {
    const algorithm = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.ALGORITHM}`);
    const viewerPoints = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.VIEWER.NUM_POINTS}`);
    const targetPoints = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.POINT_OPTIONS.NUM_POINTS}`);
    this.#updatePointOptionDisplay(algorithm);
    this.#updateViewerInsetDisplay(viewerPoints);
    this.#updateTargetInsetDisplay(targetPoints, algorithm);
  }

  losViewerPointsChanged(event) {
    const viewerPoints = event.target.value;
    this.#updateViewerInsetDisplay(viewerPoints);
  }

  #updateViewerInsetDisplay(numPoints) {
    const displayInsetOpts = numPoints !== SETTINGS.POINT_TYPES.CENTER ? "block" : "none";
    const elem = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.VIEWER.INSET}`);
    const div = elem[0].parentElement.parentElement;
    div.style.display = displayInsetOpts;
    this.setPosition(this.position);
  }

  losAlgorithmChanged(event) {
    const losAlgorithm = event.target.value;
    this.#updatePointOptionDisplay(losAlgorithm);
  }

  #updatePointOptionDisplay(losAlgorithm) {
    const displayPointOpts = losAlgorithm === SETTINGS.LOS.TYPES.POINTS ? "block" : "none";
    const PT_OPTS = SETTINGS.LOS.POINT_OPTIONS;
    for ( const opt of Object.values(PT_OPTS) ) {
      const elem = document.getElementsByName(`${MODULE_ID}.${opt}`);
      const div = elem[0].parentElement.parentElement;
      div.style.display = displayPointOpts;
    }

    const numPointsTarget = getSetting(SETTINGS.LOS.POINT_OPTIONS.NUM_POINTS);
    this.#updateTargetInsetDisplay(numPointsTarget, losAlgorithm);
    this.setPosition(this.position);
  }

  losTargetPointsChanged(event) {
    const targetPoints = event.target.value;

    const elem = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.ALGORITHM}`);
    const losAlgorithm = elem[0].value;
    this.#updateTargetInsetDisplay(targetPoints, losAlgorithm);
  }

  #updateTargetInsetDisplay(numPoints, losAlgorithm) {
    const hasMultiplePoints = losAlgorithm === SETTINGS.LOS.TYPES.POINTS
      && numPoints !== SETTINGS.POINT_TYPES.CENTER;
    const displayInsetOpts = hasMultiplePoints ? "block" : "none";
    const elem = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.POINT_OPTIONS.INSET}`);
    const div = elem[0].parentElement.parentElement;
    div.style.display = displayInsetOpts;
    this.setPosition(this.position);
  }

  /**
   * Modify the settings in the form based on some predetermined settings values.
   * For example, change range and LOS to match Foundry defaults.
   */
  submitSettingUpdates(defaultSettingName, settings) {
    event.preventDefault();
    event.stopPropagation();
    ui.notifications.notify(game.i18n.localize(`${MODULE_ID}.settings.${defaultSettingName}.Notification`));
    const formElements = [...this.form.elements];
    for ( const [settingName, settingValue] of Object.entries(settings) ) {
      const key = `${MODULE_ID}.${settingName}`;
      // The following does not work alone but is useful for updating the display options..
      const elem = document.getElementsByName(key);
      elem.value = settingValue;

      const formElem = formElements.find(elem => elem.name === key);
      formElem.value = settingValue;
    }

    this._updateDisplayOptions();
    this.setPosition(this.position);
  }
}
