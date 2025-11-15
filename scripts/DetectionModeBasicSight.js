/* globals
Token
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export const PATCHES = {};
PATCHES.BASIC = {};

/* Benchmark light intersection
ClipperPaths = CONFIG.GeometryLib.ClipperPaths
api = game.modules.get("tokenvisibility").api
QBenchmarkLoopFn = api.bench.QBenchmarkLoopFn

tokenBounds = _token.bounds
tokenBorder = _token.constrainedTokenBorder;
lights = [...canvas.effects.lightSources].filter(l => !(l instanceof GlobalLightSource)
  && l.shape.points.length >= 6)

// How fast to find light that overlaps the token border?
function overlaps(tokenShape, lights) {
  return lights.some(l => tokenShape.overlaps(l.shape));
}

N = 100000
await QBenchmarkLoopFn(N, overlaps, "Overlaps bounds", tokenBounds, lights);
await QBenchmarkLoopFn(N, overlaps, "Overlaps border", tokenBorder, lights);

Overlaps bounds | 100000 iterations | 231.6ms | 0.0023ms per | 10/50/90: 0 / 0 / 0
Overlaps border | 100000 iterations | 166.9ms | 0.0017ms per | 10/50/90: 0 / 0 / 0

// How fast to find light that envelops token?
function envelops(tokenShape, lights) {
  return lights.some(l => l.shape.envelops(tokenShape))
}

N = 100000
await QBenchmarkLoopFn(N, envelops, "Envelops bounds", tokenBounds, lights);
await QBenchmarkLoopFn(N, envelops, "Envelops border", tokenBorder, lights);

Envelops bounds | 100000 iterations | 96.9ms | 0.001ms per | 10/50/90: 0 / 0 / 0
Envelops border | 100000 iterations | 129.9ms | 0.0013ms per | 10/50/90: 0 / 0 / 0


// How fast to find token/light intersection?
function intersect(tokenShape, lights) {
  const paths = ClipperPaths.fromPolygons(lights.map(light => light.shape));
  if ( tokenShape instanceof PIXI.Rectangle ) tokenShape = tokenShape.toPolygon();
  const tokenPath = ClipperPaths.fromPolygons([tokenShape]);
  const combined = paths
    .combine()
    .intersectPaths(tokenPath)
    .clean();

  if ( combined.paths.length === 1 ) return combined.simplify();
  return combined.toPolygons();
}

N = 10000
await QBenchmarkLoopFn(N, intersect, "Intersect bounds", tokenBounds, lights);
await QBenchmarkLoopFn(N, intersect, "Intersect border", tokenBorder, lights);

Intersect bounds | 10000 iterations | 984ms | 0.0984ms per | 10/50/90: 0 / 0.1 / 0.2
Intersect border | 10000 iterations | 999.2ms | 0.0999ms per | 10/50/90: 0 / 0.1 / 0.2

// So intersection is 0.1; envelops is 0.001. Meaning that testing envelops makes sense basically every time.
// At 0.002 for overlaps, that would make sense as well, to limit what is getting intersected.

*/


/**
 * Mixed wrap DetectionModeBasicSight.prototype._testPoint
 * Modify if the target is not within range, modify the target shape to be only the
 * portion within one or more lights.
 * Does not, at the moment, consider 3d shapes of either the token or the light(s).
 */
function _testPoint(wrapped, visionSource, mode, target, test) {
  // Only apply this test to tokens
  if ( !(target instanceof foundry.canvas.placeables.Token) ) return wrapped(visionSource, mode, target, test);

  // If within range, counts if any portion of the token is visible.
  if ( this._testRange(visionSource, mode, target, test)
    && this._testLOS(visionSource, mode, target, test, { testLighting: false }) ) return true;

  // Outside of vision range, token is visible if the lit portions are visible.
  return this._testLOS(visionSource, mode, target, test, { testLighting: true });
}


PATCHES.BASIC.MIXES = { _testPoint };


/**
 * Take a token and intersects it with a set of lights.
 * @param {Token} token
 * @returns {PIXI.Polygon|PIXI.Rectangle|ClipperPaths}
 */
// function constrainTokenShapeWithLights(token) {
//   const tokenBorder = token.constrainedTokenBorder;
//
//   // If the global light source is present, then we can use the whole token.
//   if ( canvas.environment.globalLightSource.active ) return undefined;
//
//   // Cannot really use quadtree b/c it doesn't contain all light sources.
//   const lightShapes = [];
//   for ( const light of canvas.effects.lightSources.values() ) {
//     const lightShape = light.shape;
//     if ( !light.active || lightShape.points < 6 ) continue; // Avoid disabled or broken lights.
//
//     // If a light envelops the token shape, then we can use the entire token shape.
//     if ( lightShape.envelops(tokenBorder) ) return undefined;
//
//     // If the token overlaps the light, then we may need to intersect the shape.
//     if ( tokenBorder.overlaps(lightShape) ) lightShapes.push(lightShape);
//   }
//   if ( !lightShapes.length ) return null;
//
//   const paths = ClipperPaths.fromPolygons(lightShapes);
//   const tokenPath = ClipperPaths.fromPolygons(tokenBorder instanceof PIXI.Rectangle
//     ? [tokenBorder.toPolygon()] : [tokenBorder]);
//   const combined = paths
//     .combine()
//     .intersectPaths(tokenPath)
//     .clean()
//     .simplify();
//   return combined;
// }


