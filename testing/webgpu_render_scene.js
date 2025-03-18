
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
});


renderWalls = new RenderWalls(device);
// renderWalls.sampleCount = 4
renderWalls.sampleCount = 1
renderWalls.renderSize = { width: 400, height: 400 } // Must set width/height to match canvas so depthTex works.
await renderWalls.initialize();
renderWalls.setRenderTextureToCanvas(popout.canvas)
await renderWalls.renderScene(Point3d.fromTokenCenter(viewer), target, vp)




renderWalls.camera.cameraPosition = Point3d.fromTokenCenter(viewer)
renderWalls.camera.targetPosition = Point3d.fromTokenCenter(target)
renderWalls.camera.setTargetTokenFrustrum(target)
renderWalls.camera.cameraPosition
renderWalls.camera.targetPosition
renderWalls.camera.lookAtMatrix
renderWalls.camera.perspectiveMatrix
renderWalls.camera.offsetMatrix


renderTokens = new RenderTokens(device);
renderTokens.sampleCount = 1
renderTokens.renderSize = { width: 400, height: 400 } // Must set width/height to match canvas so depthTex works.
await renderTokens.initialize();
renderTokens.setRenderTextureToCanvas(popout.canvas)
await renderTokens.renderScene(Point3d.fromTokenCenter(viewer), target, vp)


renderTiles = new RenderTiles(device);
renderTiles.sampleCount = 1
renderTiles.renderSize = { width: 400, height: 400 } // Must set width/height to match canvas so depthTex works.
await renderTiles.initialize();
renderTiles.setRenderTextureToCanvas(popout.canvas)
await renderTiles.renderScene(Point3d.fromTokenCenter(viewer), target, vp)


// Hooks to change rendering on move
renderType = "Walls"
renderType = "Tokens"
renderType = "Tiles"

rerender = () => {
  const losCalc = viewer.vision.tokenvisibility.losCalc
  losCalc.target = target
  const vp = losCalc.viewpoints[0]
  switch ( renderType ) {
    case "Walls": renderWalls.renderScene(Point3d.fromTokenCenter(viewer), target, vp); break;
    case "Tokens": renderTokens.renderScene(Point3d.fromTokenCenter(viewer), target, vp); break;
    case "Tiles": renderTiles.renderScene(Point3d.fromTokenCenter(viewer), target, vp); break;
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








