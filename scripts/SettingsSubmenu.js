/* globals
CONST,
foundry,
game,
ui,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";

export class SettingsSubmenu extends foundry.applications.settings.SettingsConfig {
  static DEFAULT_OPTIONS = {
    id: `settings-config-submenu-${MODULE_ID}`,
    actions: {
      resetDefaults: SettingsSubmenu.#onResetDefaults,
    }
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
      if ( !this.constructor.includeSetting(setting) ) continue;
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

  static includeSetting(setting) {
    return setting.namespace === MODULE_ID
      && setting.tab
      && ((setting.scope !== CONST.SETTING_SCOPES.WORLD) || game.user.can("SETTINGS_MODIFY"));
  }

  static async #onResetDefaults() {
    console.log("onResetDefaults");
    const form = this.form;
    for ( const [key, setting] of game.settings.settings.entries() ) {
      if ( !this.constructor.includeSetting(setting) ) continue;
      const input = form[key];
      if ( !input ) continue;
      if ( input.type === "checkbox" ) input.checked = setting.default;
      else input.value = setting.default;
      input.dispatchEvent(new Event("change"));
    }
    ui.notifications.info("SETTINGS.ResetInfo", {localize: true});
  }


}
