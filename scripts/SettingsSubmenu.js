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



export class SettingsSubmenu extends SettingsConfig {
  static DEFAULT_OPTIONS = {
    id: `settings-config-submenu-${MODULE_ID}`,
  };

  static TABS = {};

  // Mostly same as SettingsConfig#_prepareCategoryData.
  _prepareCategoryData() {
    const categories = {};
    const getCategory = tab => {
      const id = tab;
      const label = game.i18n.localize(`${MODULE_ID}.settings-submenu.tabs.${tab}`);
      return categories[id] ??= { id, label, entries: [] };
    };

    // Classify all menus
    const canConfigure = game.user.can("SETTINGS_MODIFY");

    // Currently no need to have submenus for the submenu!
//     for ( const menu of game.settings.menus.values() ) {
//       if ( menu.restricted && !canConfigure ) continue;
//       if ( (menu.key === "core.permissions") && !game.user.hasRole("GAMEMASTER") ) continue;
//       const category = getCategory(menu.namespace);
//       category.entries.push({
//         key: menu.key,
//         icon: menu.icon,
//         label: menu.name,
//         hint: menu.hint,
//         menu: true,
//         buttonText: menu.label
//       });
//     }

    // Classify all settings
    for ( const setting of game.settings.settings.values() ) {
      // if ( !setting.config || (!canConfigure && (setting.scope === CONST.SETTING_SCOPES.WORLD)) ) continue;

      if ( setting.namespace !== MODULE_ID
        || !setting.tab
        || (!canConfigure && (setting.scope === CONST.SETTING_SCOPES.WORLD)) ) continue;

      const data = {
        label: setting.value,
        value: game.settings.get(setting.namespace, setting.key),
        menu: false
      };

      // Define a DataField for each setting not originally defined with one
      const fields = foundry.data.fields;
      if ( setting.type instanceof fields.DataField ) {
        data.field = setting.type;
      }
      else if ( setting.type === Boolean ) {
        data.field = new fields.BooleanField({initial: setting.default ?? false});
      }
      else if ( setting.type === Number ) {
        const {min, max, step} = setting.range ?? {};
        data.field = new fields.NumberField({
          required: true,
          choices: setting.choices,
          initial: setting.default,
          min,
          max,
          step
        });
      }
      else if ( setting.filePicker ) {
        const categories = {
          audio: ["AUDIO"],
          folder: [],
          font: ["FONT"],
          graphics: ["GRAPHICS"],
          image: ["IMAGE"],
          imagevideo: ["IMAGE", "VIDEO"],
          text: ["TEXT"],
          video: ["VIDEO"]
        }[setting.filePicker] ?? Object.keys(CONST.FILE_CATEGORIES).filter(c => c !== "HTML");
        if ( categories.length ) {
          data.field = new fields.FilePathField({required: true, blank: true, categories});
        }
        else {
          data.field = new fields.StringField({required: true}); // Folder paths cannot be FilePathFields
          data.folderPicker = true;
        }
      }
      else {
        data.field = new fields.StringField({required: true, choices: setting.choices});
      }
      data.field.name = `${setting.namespace}.${setting.key}`;
      data.field.label ||= game.i18n.localize(setting.name ?? "");
      data.field.hint ||= game.i18n.localize(setting.hint ?? "");

      // Categorize setting
      const category = getCategory(setting.tab);
      category.entries.push(data);
    }

    return categories;
  }
}
