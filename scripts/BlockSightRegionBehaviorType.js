/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Region behavior to trigger blocking of sight for the region.
 * Currently just a flag with no additional user options or properties.
 */
export class BlockSightRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {};
  }
}


