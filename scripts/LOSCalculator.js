/* globals
*/
"use strict";

import { Settings } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { AbstractViewerLOS } from "./LOS/AbstractViewerLOS.js";

/** Testing
api = game.modules.get("tokenvisibility").api
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL1)
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_WEBGL2)
api.losCalculator._updateAlgorithm(api.Settings.KEYS.LOS.TARGET.TYPES.AREA3D_GEOMETRIC)
*/

export function buildLOSCalculator(token) {
  return new AbstractViewerLOS(token);
}

export function buildCustomLOSCalculator(token, algorithm) {
  const losCalc = new AbstractViewerLOS(token);
  losCalc._updateAlgorithm(algorithm);
  return losCalc;
}
