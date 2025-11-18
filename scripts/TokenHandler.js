/* globals
CONFIG,
DetectionMode,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "./const.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { rangeTestPointsForToken } from "./visibility_range.js";
import { Settings, SETTINGS } from "./settings.js";
import { Draw } from "./geometry/Draw.js";
import { ViewerLOS } from "./LOS/ViewerLOS.js";
import { buildLOSViewer } from "./LOSCalculator.js";

export const ATVTokenHandlerID = "visibility";

/** @type {Object<CONST.WALL_RESTRICTION_TYPES|DetectionMode.DETECTION_TYPES>} */
const DM_SENSE_TYPES = {
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT]: "sight",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND]: "sound",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.MOVE]: "move",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER]: "light",
  "sight": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
  "sound": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND,
  "move": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.MOVE,
  "light": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER, // No "light" equivalent
}

/** @type {Object<"lighting"|"sounds"|DetectionMode.DETECTION_TYPES>} */
const DM_SOURCE_TYPES = {
  "lighting": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
  "sounds": foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND,
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT]: "lighting",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SOUND]: "sounds",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.MOVE]: "lighting",
  [foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER]: "lighting",
};

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

  /** @type {ViewerLOS} */
  losViewer;

  constructor(token) {
    token[MODULE_ID] ??= {};
    token[MODULE_ID][this.constructor.ID] = this;
    this.losViewer = buildLOSViewer(token);
    this.viewer = token;
  }

  get losCalc() { return this.losViewer.losCalc; }

  /**
   * Set this LOS configuration to match a detection mode's settings.
   * See CONFIG.Canvas.detectionModes (and CONFIG.Canvas.visionModes)
   * @param {CONFIG.Canvas.detectionModes|CONFIG.Canvas.visionModes} [detectionMode]
   */
  setConfigForDetectionMode(dm = CONFIG.Canvas.detectionModes.basicSight) {
    const calcConfig = {
      blocking: {
        walls: dm.walls,
        tiles: dm.walls,
        regions: dm.walls,
      },
      senseType: DM_SENSE_TYPES[dm.type],
      sourceType: DM_SOURCE_TYPES[dm.type],
    };
    this.losViewer.config = { angle: dm.angle };
    this.losViewer.calculator.config = calcConfig;
  }

  /**
   * @param {Token} target
   * @returns {number}
   */
  percentVisibilityToToken(target) {
    const losViewer = this.losViewer;
    losViewer.target = target;
    losViewer.calculate();
    return losViewer.percentVisible;
  }

  hasLOSToToken(target, range) {
    if ( !this.tokenWithinLimitedAngleVision(target) ) return false;
    if ( range && !this.tokenWithinVisibleRange(target, range) ) return false;
    const losViewer = this.losViewer;
    losViewer.target = target;
    losViewer.calculate();
    return losViewer.hasLOS;
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
		const visionOrigin = Point3d.fromPointSource(this.viewer.vision);
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
    return ViewerLOS.targetWithinLimitedAngleVision(this.viewer.vision, target);
  }

  get lightingType() {
    // For now, use only the points calculator. Other versions would require dealing with faces.
    const pointsCalc = CONFIG[MODULE_ID].losCalculators.points;
    const oldConfig = pointsCalc.config;
    pointsCalc.config = {
      pointAlgorithm: CONFIG[MODULE_ID].lightMeasurementNumPoints,
    }

    const { dim, bright } = pointsCalc.calculateLightingTypeForTarget(this.viewer);
    pointsCalc.config = oldConfig;

    const { TYPES } = this.constructor.LIGHTING_TYPES;
    if ( bright.percentVisible >= CONFIG[MODULE_ID].brightThreshold ) return TYPES.BRIGHT;
    if ( dim.percentVisible >= CONFIG[MODULE_ID].dimThreshold ) return TYPES.DIM;
    return TYPES.DARK;
  }
}