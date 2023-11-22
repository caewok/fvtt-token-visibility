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
      [RANGE.ALGORITHM]: SETTINGS.POINT_TYPES.NINE,
      [RANGE.POINTS3D]: false,
      [RANGE.DISTANCE3D]: false,

      // LOS Viewer
      [VIEWER.NUM_POINTS]: SETTINGS.POINT_TYPES.CENTER,
      // Unused: [SETTINGS.LOS.VIEWER.INSET]: 0

      // LOS Target
      [TARGET.ALGORITHM]: TARGET.TYPES.POINTS,
      [TARGET.PERCENT]: 0,
      [TARGET.LARGE]: false,

      // LOS Point options
      [TARGET.POINT_OPTIONS.NUM_POINTS]: SETTINGS.POINT_TYPES.NINE,
      [TARGET.POINT_OPTIONS.INSET]: 0.75,
      [TARGET.POINT_OPTIONS.POINTS3D]: false
    };
  }

  static get dnd5e() {
    const { RANGE, LOS } = SETTINGS;
    const { VIEWER, TARGET } = LOS;
    return {
      // Range
      [RANGE.ALGORITHM]: SETTINGS.POINT_TYPES.NINE,
      [RANGE.POINTS3D]: false,
      [RANGE.DISTANCE3D]: false,

      // LOS Viewer
      [VIEWER.NUM_POINTS]: SETTINGS.POINT_TYPES.FOUR,
      [VIEWER.INSET]: 0,

      // LOS Target
      [TARGET.ALGORITHM]: TARGET.TYPES.POINTS,
      [TARGET.PERCENT]: 0,
      [TARGET.LARGE]: true,

      // LOS Point options
      [TARGET.POINT_OPTIONS.NUM_POINTS]: SETTINGS.POINT_TYPES.FOUR,
      [TARGET.POINT_OPTIONS.INSET]: 0,
      [TARGET.POINT_OPTIONS.POINTS3D]: false
    };
  }

  static get threeD() {
    const { RANGE, LOS } = SETTINGS;
    const { VIEWER, TARGET } = LOS;
    return {
      // Range
      [RANGE.ALGORITHM]: SETTINGS.POINT_TYPES.NINE,
      [RANGE.POINTS3D]: true,
      [RANGE.DISTANCE3D]: true,

      // LOS Viewer
      [VIEWER.NUM_POINTS]: SETTINGS.POINT_TYPES.CENTER,

      // LOS Target
      [TARGET.ALGORITHM]: TARGET.TYPES.AREA3D,
      [TARGET.PERCENT]: 0.2,
      [TARGET.LARGE]: true
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
          initial: "los_target"
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
    html.find(`[name="${MODULE_ID}.${SETTINGS.LOS.TARGET.ALGORITHM}"]`).change(this.losAlgorithmChanged.bind(this));
    html.find(`[name="${MODULE_ID}.${SETTINGS.LOS.VIEWER.NUM_POINTS}"]`).change(this.losViewerPointsChanged.bind(this));
    html.find(`[name="${MODULE_ID}.${SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS}"]`).change(this.losTargetPointsChanged.bind(this));

    // Buttons to reset settings to defaults.
    html.find(`[name="${MODULE_ID}-button-foundry"]`).click(this.submitSettingUpdates.bind(this, "foundry"));
    html.find(`[name="${MODULE_ID}-button-dnd5e"]`).click(this.submitSettingUpdates.bind(this, "dnd5e"));
    html.find(`[name="${MODULE_ID}-button-threeD"]`).click(this.submitSettingUpdates.bind(this, "threeD"));
  }

  /**
   * Comparable to SettingsConfig.prototype._updateObject
   */
  async _updateObject(event, formData) {
    let requiresClientReload = false;
    let requiresWorldReload = false;
    const promises = [];
    for ( let [k, v] of Object.entries(foundry.utils.flattenObject(formData)) ) {
      let s = game.settings.settings.get(k);
      let current = game.settings.get(s.namespace, s.key);
      if ( v === current ) continue;
      requiresClientReload ||= (s.scope === "client") && s.requiresReload;
      requiresWorldReload ||= (s.scope === "world") && s.requiresReload;
      promises.push(game.settings.set(s.namespace, s.key, v));
    }
    await Promise.allSettled(promises);
    Settings.cache.clear();
    if ( requiresClientReload || requiresWorldReload ) SettingsConfig.reloadConfirm({world: requiresWorldReload});
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
    const algorithm = Settings.get(LOS.TARGET.ALGORITHM);
    const viewerPoints = Settings.get(LOS.VIEWER.NUM_POINTS);
    const targetPoints = Settings.get(LOS.TARGET.POINT_OPTIONS.NUM_POINTS);
    this.#updatePointOptionDisplay(algorithm);
    this.#updateViewerInsetDisplay(viewerPoints);
    this.#updateTargetInsetDisplay(targetPoints, algorithm);
    this.setPosition(this.position);
  }

  _updateDisplayOptions() {
    const algorithm = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.TARGET.ALGORITHM}`).value;
    const viewerPoints = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.VIEWER.NUM_POINTS}`).value;
    const targetPoints = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS}`).value;
    this.#updatePointOptionDisplay(algorithm);
    this.#updateViewerInsetDisplay(viewerPoints);
    this.#updateTargetInsetDisplay(targetPoints, algorithm);
    this.setPosition(this.position);
  }

  losViewerPointsChanged(event) {
    const viewerPoints = event.target.value;
    this.#updateViewerInsetDisplay(viewerPoints);
    this.setPosition(this.position);
  }

  #updateViewerInsetDisplay(numPoints) {
    const displayInsetOpts = numPoints !== SETTINGS.POINT_TYPES.CENTER ? "block" : "none";
    const elem = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.VIEWER.INSET}`);
    const div = elem[0].parentElement.parentElement;
    div.style.display = displayInsetOpts;
  }

  losAlgorithmChanged(event) {
    const losAlgorithm = event.target.value;
    this.#updatePointOptionDisplay(losAlgorithm);
    this.setPosition(this.position);
  }

  #updatePointOptionDisplay(losAlgorithm) {
    const displayPointOpts = losAlgorithm === SETTINGS.LOS.TARGET.TYPES.POINTS ? "block" : "none";
    const PT_OPTS = SETTINGS.LOS.TARGET.POINT_OPTIONS;
    for ( const opt of Object.values(PT_OPTS) ) {
      const elem = document.getElementsByName(`${MODULE_ID}.${opt}`);
      const div = elem[0].parentElement.parentElement;
      div.style.display = displayPointOpts;
    }

    const numPointsTarget = Settings.get(SETTINGS.LOS.TARGET.POINT_OPTIONS.NUM_POINTS);
    this.#updateTargetInsetDisplay(numPointsTarget, losAlgorithm);
  }

  losTargetPointsChanged(event) {
    const targetPoints = event.target.value;

    const elem = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.TARGET.ALGORITHM}`);
    const losAlgorithm = elem[0].value;
    this.#updateTargetInsetDisplay(targetPoints, losAlgorithm);
    this.setPosition(this.position);
  }

  #updateTargetInsetDisplay(numPoints, losAlgorithm) {
    const hasMultiplePoints = losAlgorithm === SETTINGS.LOS.TARGET.TYPES.POINTS
      && numPoints !== SETTINGS.POINT_TYPES.CENTER;
    const displayInsetOpts = hasMultiplePoints ? "block" : "none";
    const elem = document.getElementsByName(`${MODULE_ID}.${SETTINGS.LOS.TARGET.POINT_OPTIONS.INSET}`);
    const div = elem[0].parentElement.parentElement;
    div.style.display = displayInsetOpts;
  }

  /**
   * Modify the settings in the form based on some predetermined settings values.
   * For example, change range and LOS to match Foundry defaults.
   */
  submitSettingUpdates(defaultSettingName) {
    event.preventDefault();
    event.stopPropagation();
    const settings = DefaultSettings[defaultSettingName];

    ui.notifications.notify(game.i18n.localize(`${MODULE_ID}.settings.button-${defaultSettingName}.Notification`));
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
  }
}
