/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { rangeTestPointsForToken } from "./visibility_range.js";
import { Settings, SETTINGS } from "./settings.js";
import { Draw } from "./geometry/Draw.js";
import { AbstractViewerLOS } from "./LOS/AbstractViewerLOS.js";


export const ATVTokenHandlerID = "visibility";

export class ATVTokenHandler {

  /** @type {string} */
  static ID = ATVTokenHandlerID;
  
  /** @type {enum} */
  static LIGHTING_TYPES = {
    DARK: 0,
    DIM: 1,
    BRIGHT: 2,
  };

  /** @type {Token} */
  viewer;
 
  constructor(token) {
    this.viewer = token;
    token[MODULE_ID] ??= {};
    token[MODULE_ID][this.constructor.ID] = this;
  }
  
  get losCalc() { return this.viewer[MODULE_ID].losCalc; }
  
  /**
   * @param {CONFIG.Canvas.detectionModes|CONFIG.Canvas.visionModes} [detectionMode]
   */
  setConfigForDetectionMode(dm) {
    this.losCalc.setConfigForDetectionMode(dm);
  }
  
  /**
   * @param {Token} target
   * @returns {number}
   */
  percentVisibilityToToken(target) {
    const losCalc = this.losCalc;
    losCalc.target = target;
    losCalc.calculate();
    return losCalc.hasLOS;
    
  }
  
  hasLOSToToken(target, range) {
    if ( !this.tokenWithinLimitedAngleVision(target) ) return false;
    if ( range && !this.tokenWithinVisibleRange(target, range) ) return false;
    return this.percentVisibilityToToken(target);
  }
  
  /**
   * Is a target token within the visible range of this viewer?
   * @param {Token} target
   * @param {number} range
   * @returns {boolean} True if within range.
   */
  tokenWithinVisibleRange(target, range) {  
    if ( range <= 0 ) return false;
    // range ??= 
  
		const testPoints = rangeTestPointsForToken(target);
		const visionOrigin = Point3d.fromPointSource(this.viewer.visionSource);
		const radius2 = this.viewer.getLightRadius(range) ** 2;
	
		// Duplicate below so that the if test does not need to be inside the loop.
		if ( Settings.get(SETTINGS.DEBUG.RANGE) ) {
			const draw = new Draw(Settings.DEBUG_RANGE);
	
			// Sort the unique elevations and draw largest radius for bottom.
			const elevationSet = new Set(testPoints.map(pt => pt.z));
			const elevationArr = [...elevationSet];
			elevationArr.sort((a, b) => a - b);
	
			// Color all the points red or green.
			// Need to draw test points from lowest to highest elevation.
			testPoints.sort((a, b) => a.z - b.z);
			testPoints.forEach(pt => {
				const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
				const inRange = dist2 <= radius2;
				const radius = elevationArr.length < 2 ? 3
					: [7, 5, 3][elevationArr.findIndex(elem => elem === pt.z)] ?? 3;
				draw.point(pt, { alpha: 1, radius, color: inRange ? Draw.COLORS.green : Draw.COLORS.red });
			})
		}
	  
	  // Test each point; return once one is found.
		return testPoints.some(pt => {
			const dist2 = Point3d.distanceSquaredBetween(pt, visionOrigin);
			return dist2 <= radius2;
		});
  }
  
  /**
   * Is a target token within the visible range of this viewer?
   * @param {Token} target
   * @param {number} range
   * @returns {boolean} True if within range.
   */
  tokenWithinLimitedAngleVision(target) {
    return AbstractViewerLOS.targetWithinLimitedAngleVision(this.token.vision, target);
  }
    
  get lightingType() {
    // For now, use only the points calculator. Other versions would require dealing with faces.
    const pointsCalc = CONFIG[MODULE_ID].losCalculators.points;
    const oldConfig = pointsCalc.config;
    pointsCalc.config = {
      pointAlgorithm: CONFIG[MODULE_ID].lightMeasurementNumPoints,
    }
  
    const { dim, bright } = pointsCalc.calculateLightingTypeForTarget(this.token);
    pointsCalc.config = oldConfig;
    
    const { TYPES } = this.constructor.LIGHTING_TYPES;
    if ( bright.percentVisible >= CONFIG[MODULE_ID].brightThreshold ) return TYPES.BRIGHT;
    if ( dim.percentVisible >= CONFIG[MODULE_ID].dimThreshold ) return TYPES.DIM;
    return TYPES.DARK;
  }
}