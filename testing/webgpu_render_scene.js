
/* Render the scene using WebGPU

Objects:

To pass a 4x4 matrix requires 4 * 4 = 16 data points.

For each below, assume
- UVs: x2 per vertex. (Could be a 0/1, but likely not worth the trouble)
- Normals: x3 per vertex.
- So in theory an instance could also store those 5 values.

- For simplicity, always use vec3 for the vertices?


1. Tokens

Cubes: 8 vertices total; 24 coordinates. (vec3)
Hexes: 12 vertices total; 36 coordinates (vec3)
Partial shape based on wall or tile occlusion:
Partial shape based on lighting:
- Really needs to be handled by JS prior. Easier to determine if the shape is behind a wall.
- In GPU, the token shape could poke through the wall.

Partial shapes will be singular; no instances.

2. Walls

In Foundry, walls defined by two vertices, a bottom height and a top height.
Even if defining separate top/bottom for a and b, that is still only 2 vertices; 2 * 4 = 8 total coordinates.
Could use separate shader for terrain walls.
So no instancing. But need 8 + 2*2 + 3*2 = 18 to have coordinates + uvs + normals. (8 all that is needed for non-debug)

Alternative. Store:
- length (float)
- position at wall center (vec2)
- rotation along z-axis (float)
- top elevation (float)
- bottom elevation (float)
--> 6 total coordinates for an instance; construct translation, scale, and rotation matrix in vertex shader.

Instance requires another 4 vec2 vertices (+ 4 vec3 normals)


3. Tiles
Same as walls but now we have 4 2d coordinates plus elevation. So 4 * 2 + 1 = 9.
So no instancing.
But need 9 + 2*4 + 3*4 = 29 for coordinates + uvs + normals. 9 + 12 for just uvs = 21.

Alternative. Store:
- width
- height
- position at tile center (vec2)
- rotation along z-axis (float)
- elevation
--> 6 total coordinates for an instance; construct translation, scale, and rotation matrix in vertex shader.

Instance requires another 4 vec2 vertices + 4 vec2 uvs (+ 4 vec3 normals)

*/

Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
WallTriangles = api.triangles.WallTriangles
Plane = CONFIG.GeometryLib.threeD.Plane
ClipperPaths = CONFIG.GeometryLib.ClipperPaths
let { PolygonVerticalTriangles, Square2dTriangles, SquareVerticalTriangles, Triangle } = api.triangles
QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn
QBenchmarkLoopFnWithSleep = CONFIG.GeometryLib.bench.QBenchmarkLoopFnWithSleep
extractPixels = CONFIG.GeometryLib.utils.extractPixels
GEOMETRY_ID = "_atvPlaceableGeometry";
MatrixFlat = CONFIG.GeometryLib.MatrixFlat
MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32
Area3dPopout = api.Area3dPopout
Area3dPopoutCanvas = api.Area3dPopoutCanvas


let {
  WebGPUDevice,
  WebGPUShader,
  WebGPUBuffer,
  WebGPUTexture,
  Camera,
  GeometryWallDesc,
  GeometryTokenDesc,
  GeometryTileDesc,
  Geometry,
  RenderWalls,
  RenderTokens,
  RenderTiles,
} = api.webgpu

let { vec3, vec4, mat4, quat } = api.glmatrix

// Draw borders around tiles and borders for walls
canvas.walls.placeables.forEach(wall => Draw.segment(wall));
canvas.tiles.placeables.forEach(tile => Draw.shape(tile.bounds, { color: Draw.COLORS.red }))


viewer = _token
target = game.user.targets.first()

losCalc = viewer.vision.tokenvisibility.losCalc
losCalc.target = target
vp = losCalc.viewpoints[0]


device = await WebGPUDevice.getDevice()

popout = new Area3dPopoutCanvas({ width: 400, height: 400, resizable: true })
await popout._render(true);


presentationFormat = navigator.gpu.getPreferredCanvasFormat();
popout.context.configure({
  device,
  format: presentationFormat,
  alphamode: "premultiplied", // Instead of "opaque"
});


renderWalls = new RenderWalls(device);
// renderWalls.sampleCount = 4
renderWalls.sampleCount = 1
renderWalls.renderSize = { width: 400, height: 400 } // Must set width/height to match canvas so depthTex works.
await renderWalls.initialize();
renderWalls.setRenderTextureToCanvas(popout.canvas)
await renderWalls.renderScene(Point3d.fromTokenCenter(viewer), target, vp)


renderTokens = new RenderTokens(device);
renderTokens.sampleCount = 1
renderTokens.renderSize = { width: 400, height: 400 } // Must set width/height to match canvas so depthTex works.
await renderTokens.initialize();
renderTokens.setRenderTextureToCanvas(popout.canvas)
await renderTokens.renderScene(Point3d.fromTokenCenter(viewer), target, { vp, viewer })


renderTiles = new RenderTiles(device);
renderTiles.sampleCount = 1
renderTiles.renderSize = { width: 400, height: 400 } // Must set width/height to match canvas so depthTex works.
await renderTiles.initialize();
renderTiles.setRenderTextureToCanvas(popout.canvas)
await renderTiles.renderScene(Point3d.fromTokenCenter(viewer), target, { vp, viewer })


// Hooks to change rendering on move
renderType = "Walls"
renderType = "Tokens"
renderType = "Tiles"

rerender = () => {
  const losCalc = viewer.vision.tokenvisibility.losCalc
  losCalc.target = target
  const vp = losCalc.viewpoints[0]
  switch ( renderType ) {
    case "Walls": renderWalls.renderScene(Point3d.fromTokenCenter(viewer), target, { vp, viewer }); break;
    case "Tokens": renderTokens.renderScene(Point3d.fromTokenCenter(viewer), target, { vp, viewer }); break;
    case "Tiles": renderTiles.renderScene(Point3d.fromTokenCenter(viewer), target, { vp, viewer }); break;
  }
}

Hooks.on("controlToken", (token, controlled) => {

  if ( controlled ) viewer = token;
  rerender();
});

Hooks.on("targetToken", (user, targetToken, targeted) => {
  if ( !targeted || game.user !== user ) return;
  target = targetToken;
  rerender();
})

Hooks.on("refreshToken", (token, flags) => {
  if ( token !== viewer && token !== target ) return;
  if ( !(flags.refreshPosition
      || flags.refreshElevation
      || flags.refreshSize ) ) return;
  rerender();
})



// Test matrix outputs
let [[edgeId, edge]] = renderWalls.edges;
tmpMat = MatrixFloat32.empty(4, 4)
res = renderWalls.updateEdgeInstanceData(edgeId);

camera = renderWalls.camera
perspectiveM = camera.perspectiveMatrix
lookAtM = camera.lookAtMatrix
offsetM = camera.offsetMatrix

res.scale.print()
res.rotation.print()
res.translation.print()

res.scale
    .multiply4x4(res.rotation, tmpMat)
    .multiply4x4(res.translation, tmpMat);
tmpMat.print()
tmpMat.toColumnMajorArray()

geom = new GeometryWallDesc();
arr = geom.verticesData[0];

edgeElev = renderWalls.constructor.edgeElevation(edge);
console.log(`Edge ${edge.a.x},${edge.a.y} -> ${edge.b.x},${edge.b.y} | top ${edgeElev.top} | bottom ${edgeElev.bottom}`)
modelPts = [];
worldPts = [];
cameraPts = [];
perspectivePts = [];
offsetPts = [];
ndcPts = []

for ( let i = 0; i < arr.length; i += 8) {
  // modelPt = new Point3d(...arr.slice(i, 3));
  // worldPt = tmpMat.multiplyPoint3d(modelPt)
  // cameraPt = lookAtM.multiplyPoint3d(worldPt)
  // perspectivePt = perspectiveM.multiplyPoint3d(cameraPt);
  // offsetPt = offsetM.multiplyPoint3d(perspectivePt);

  const modelPt = MatrixFloat32.fromRowMajorArray([...arr.slice(i, i+3), 1], 1, 4);
  const worldPt = modelPt.multiply(tmpMat);
  const cameraPt = worldPt.multiply(lookAtM);
  const perspectivePt = cameraPt.multiply(perspectiveM);
  const offsetPt = perspectivePt.multiply(offsetM);
  const ndcPt = offsetPt.toPoint3d()

  modelPts.push(modelPt);
  worldPts.push(worldPt);
  cameraPts.push(cameraPt)
  perspectivePts.push(perspectivePt);
  offsetPts.push(offsetPt);
  ndcPts.push(ndcPt);
  arrToStr = (arr) => `${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3]}`;

  console.log(`${arrToStr(modelPt.arr)} -> ${arrToStr(worldPt.arr)} -> ${arrToStr(cameraPt.arr)}\n\t -> ${arrToStr(perspectivePt.arr)} -> ${arrToStr(offsetPt.arr)} -> ${ndcPt}`)
}

// Token
let [[edgeId, edge]] = renderTokens.tokens;
tmpMat = MatrixFloat32.empty(4, 4)
res = renderTokens.updateTokenInstanceData(target.id);

camera = renderTokens.camera
perspectiveM = camera.perspectiveMatrix
lookAtM = camera.lookAtMatrix
offsetM = camera.offsetMatrix

console.log("Perspective"); perspectiveM.print();
console.log("LookAt"); lookAtM.print();
console.log("Offset"); offsetM.print();

res.scale.print()
res.translation.print()

res.scale
    .multiply4x4(res.translation, tmpMat);
tmpMat.print()

geom = new GeometryTokenDesc();
arr = geom.verticesData[0];

console.log(`Token
  x: ${target.center.x - target.w * 0.5} -> ${target.center.x + target.w * 0.5}
  y: ${target.center.y - target.h * 0.5} -> ${target.center.y + target.h * 0.5}
  z: ${target.bottomZ} -> ${target.topZ}`);
modelPts = [];
worldPts = [];
cameraPts = [];
perspectivePts = [];
offsetPts = [];
ndcPts = [];

for ( let i = 0; i < arr.length; i += 8) {
 // modelPt = new Point3d(...arr.slice(i, 3));
  // worldPt = tmpMat.multiplyPoint3d(modelPt)
  // cameraPt = lookAtM.multiplyPoint3d(worldPt)
  // perspectivePt = perspectiveM.multiplyPoint3d(cameraPt);
  // offsetPt = offsetM.multiplyPoint3d(perspectivePt);

  const modelPt = MatrixFloat32.fromRowMajorArray([...arr.slice(i, i+3), 1], 1, 4);
  const worldPt = modelPt.multiply(tmpMat);
  const cameraPt = worldPt.multiply(lookAtM);
  const perspectivePt = cameraPt.multiply(perspectiveM);
  const offsetPt = perspectivePt.multiply(offsetM);
  const ndcPt = offsetPt.toPoint3d()

  modelPts.push(modelPt);
  worldPts.push(worldPt);
  cameraPts.push(cameraPt)
  perspectivePts.push(perspectivePt);
  offsetPts.push(offsetPt);
  ndcPts.push(ndcPt);
  arrToStr = arr => `${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3]}`;

  if ( (i / 8) % 6 === 0 ) {
    console.log("\n")
    switch ( Math.floor(i / 8 / 6) ) {
      case 0: { console.log("South"); break; }
      case 1: { console.log("North"); break; }
      case 2: { console.log("West"); break; }
      case 3: { console.log("East"); break; }
      case 4: { console.log("Top"); break; }
      case 5: { console.log("Bottom"); break; }
    }
  }

  console.log(`${arrToStr(modelPt.arr)} -> ${arrToStr(worldPt.arr)} -> ${arrToStr(cameraPt.arr)}\n\t -> ${arrToStr(perspectivePt.arr)} -> ${arrToStr(offsetPt.arr)} -> ${ndcPt}`)

}

// After all transformations, dividing by w should result in NDC between {-1, -1, 0} and {1, 1, 1}



ctr = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
let { width, height, zHeight } = renderTokens.constructor.tokenDimensions(target);

// Move from center of token.
translationMat4 = mat4.create()
mat4.fromTranslation(translationMat4, vec3.fromValues(ctr.x, ctr.y, ctr.z));
res.translation.arr

// Scale based on width, height, zHeight of token.
scaleMat4 = mat4.create()
mat4.fromScaling(scaleMat4, vec3.fromValues(width, height, zHeight));
res.scale.arr

modelMat4 = mat4.create()
mat4.mul(modelMat4, translationMat4, scaleMat4)
res.out.arr

let { fov, aspect, zNear, zFar } = camera.perspectiveParameters;
mat4.perspectiveZO(mat4.create(), fov, aspect, zNear, zFar)
camera.perspectiveMatrix.arr

eye = camera.cameraPosition;
targetCtr = camera.targetPosition;
up = vec3.fromValues(0, -1, 1)

mat4.lookAt(mat4.create(),
  vec3.fromValues(eye.x, eye.y, eye.z),
  vec3.fromValues(targetCtr.x, targetCtr.y, targetCtr.z),
  up)
camera.lookAtMatrix.arr



// Tile
tile = canvas.tiles.controlled[0]

tmpMat = MatrixFloat32.empty(4, 4)
res = renderTiles.updateTileInstanceData(tile.id);

camera = renderTiles.camera
perspectiveM = camera.perspectiveMatrix
lookAtM = camera.lookAtMatrix
offsetM = camera.offsetMatrix

console.log("Perspective"); perspectiveM.print();
console.log("LookAt"); lookAtM.print();
console.log("Offset"); offsetM.print();

res.scale.print()
res.translation.print()

res.scale
    .multiply4x4(res.translation, tmpMat);
tmpMat.print()

geom = new GeometryTileDesc();
arr = geom.verticesData[0];

console.log(`Tile
  TL: ${tile.bounds.left}, ${tile.bounds.top}, ${tile.elevationZ}
  TR: ${tile.bounds.right}, ${tile.bounds.top}, ${tile.elevationZ}
  BR: ${tile.bounds.right}, ${tile.bounds.bottom}, ${tile.elevationZ}
  BL: ${tile.bounds.left}, ${tile.bounds.bottom}, ${tile.elevationZ}`)
modelPts = [];
worldPts = [];
cameraPts = [];
perspectivePts = [];
offsetPts = [];
ndcPts = [];

for ( let i = 0; i < arr.length; i += 8) {
 // modelPt = new Point3d(...arr.slice(i, 3));
  // worldPt = tmpMat.multiplyPoint3d(modelPt)
  // cameraPt = lookAtM.multiplyPoint3d(worldPt)
  // perspectivePt = perspectiveM.multiplyPoint3d(cameraPt);
  // offsetPt = offsetM.multiplyPoint3d(perspectivePt);

  const modelPt = MatrixFloat32.fromRowMajorArray([...arr.slice(i, i+3), 1], 1, 4);
  const worldPt = modelPt.multiply(tmpMat);
  const cameraPt = worldPt.multiply(lookAtM);
  const perspectivePt = cameraPt.multiply(perspectiveM);
  const offsetPt = perspectivePt.multiply(offsetM);
  const ndcPt = offsetPt.toPoint3d()

  modelPts.push(modelPt);
  worldPts.push(worldPt);
  cameraPts.push(cameraPt)
  perspectivePts.push(perspectivePt);
  offsetPts.push(offsetPt);
  ndcPts.push(ndcPt);
  arrToStr = arr => `${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3]}`;

  if ( (i / 8) % 6 === 0 ) {
    console.log("\n")
    switch ( Math.floor(i / 8 / 6) ) {
      case 0: { console.log("Top"); break; }
      case 1: { console.log("Bottom"); break; }
    }
  }

  console.log(`${arrToStr(modelPt.arr)} -> ${arrToStr(worldPt.arr)} -> ${arrToStr(cameraPt.arr)}\n\t -> ${arrToStr(perspectivePt.arr)} -> ${arrToStr(offsetPt.arr)} -> ${ndcPt}`)
}


/* Transparency for terrain walls
https://webgpufundamentals.org/webgpu/lessons/webgpu-transparency.html

Prototype different operations and results.
Only really need:
Normal color, e.g., blue (0, 0, 1, 1)
Terrain color, e.g., green (0, 1, 0, 0.5)
*/

/**
 * Calculate a resulting blend.
 * @param {vec4} src
 * @param {vec4} dst
 * @param {object} [blendOpts = {}]
 */
function testBlend(src, dst, blendOpts = {})  {
  blendOpts.color ??= {};
  blendOpts.alpha ??= {};
  blendOpts.color.operation ??= "add";
  blendOpts.color.srcFactor ??= "one";
  blendOpts.color.dstFactor ??= "zero";
  blendOpts.alpha.operation ??= "add";
  blendOpts.alpha.srcFactor ??= "one";
  blendOpts.alpha.dstFactor ??= "zero";

  const factors = {
    color: {
      src: blendFactor(blendOpts.color.srcFactor, src, dst),
      dst: blendFactor(blendOpts.color.dstFactor, src, dst),
    },
    alpha: {
      src: blendFactor(blendOpts.alpha.srcFactor, src, dst),
      dst: blendFactor(blendOpts.alpha.dstFactor, src, dst),
    }
  }

  const outColor = blendOp(blendOpts.color.operation, src, dst, factors.color.src, factors.color.dst);
  const outAlpha = blendOp(blendOpts.alpha.operation, src, dst, factors.alpha.src, factors.alpha.dst);
  return vec4.fromValues(outColor[0], outColor[1], outColor[2], outAlpha[3]);
}

function blendFactor(factorLabel, src, dst) {
  const vOnes = vec4.fromValues(1, 1, 1, 1);
  const alpha = v => vec4.fromValues(v[3], v[3], v[3], v[3]);
  switch ( factorLabel ) {
    case "zero": return vec4.fromValues(0, 0, 0, 0);
    case "one": return vOnes;
    case "src": return src;
    case "one-minus-src": return vec4.subtract(vec4.create(), vOnes, src);
    case "src-alpha": return alpha(src);
    case "one-minus-src-alpha": return vec4.subtract(vec4.create(), vOnes, alpha(src));
    case "dst": return dst;
    case "one-minus-dst": return vec4.subtract(vec4.create(), vOnes, dst);
    case "dst-alpha": return alpha(dst);
    case "one-minus-dst-alpha": return vec4.subtract(vec4.create(), vOnes, alpha(dst));
//     case "src-alpha-saturated":
//     case "constant":
//     case "one-minus-constant"
  }
}

function blendOp(op, src, dst, srcFactor, dstFactor) {
  // result = operation((src * srcFactor),  (dst * dstFactor))
  const tmp1 = vec4.create();
  const tmp2 = vec4.create();
  const out = vec4.create();

  switch ( op ) {
    case "add": return vec4.add(out, vec4.multiply(tmp1, src, srcFactor), vec4.multiply(tmp2, dst, dstFactor));
    case "subtract": return vec4.subtract(out, vec4.multiply(tmp1, src, srcFactor), vec4.multiply(tmp2, dst, dstFactor));
    case "reverse-subtract": return vec4.subtract(out, vec4.multiply(tmp2, dst, dstFactor), vec4.multiply(tmp1, src, srcFactor));
    case "min": return vec4.min(out, vec4.multiply(tmp1, src, srcFactor), vec4.multiply(tmp2, dst, dstFactor));
    case "max": return vec4.max(out, vec4.multiply(tmp1, src, srcFactor), vec4.multiply(tmp2, dst, dstFactor));
  }
}


targetSrc = vec4.fromValues(1, 0, 0, 1);
obstacleSrc = vec4.fromValues(0, 0, 1, 1);
terrainSrc = vec4.fromValues(0, 0.5, 0, 1);
canvasDst = vec4.fromValues(0, 0, 0, 1);

blendOpts = {
  color: {
    operation: "add",
    srcFactor: "one",
    dstFactor: "one",
  },
  alpha: {
    operation: "add",
    srcFactor: "one",
    dstFactor: "one",
  },
}


dst = testBlend(targetSrc, canvasDst, blendOpts)
dst = testBlend(obstacleSrc, canvasDst, blendOpts)
dst = testBlend(terrainSrc, canvasDst, blendOpts)

dst2 = testBlend(targetSrc, dst, blendOpts)
dst2 = testBlend(obstacleSrc, dst, blendOpts)
dst2 = testBlend(terrainSrc, dst, blendOpts)



