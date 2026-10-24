/* globals
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";

/**
 * Region behavior to trigger blocking of sight for the region.
 * Currently just a flag with no additional user options or properties.
 */
export class BlockSightRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      opacity: new foundry.data.fields.NumberField({
        label: `${MODULE_ID}.behavior.types.set-cover.fields.opacity.name`,
        hint: `${MODULE_ID}.behavior.types.set-cover.fields.opacity.hint`,
        initial: 0,
        min: 0,
        max: 1,
        step: 0.05,
      }),
    };
  }
}
