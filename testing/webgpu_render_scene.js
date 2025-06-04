
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
MODULE_ID = "tokenvisibility"
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
Plane = CONFIG.GeometryLib.threeD.Plane
AbstractViewpoint = api.AbstractViewpoint
ClipperPaths = CONFIG.GeometryLib.ClipperPaths
Clipper2Paths = CONFIG.GeometryLib.Clipper2Paths

QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn
QBenchmarkLoopFnWithSleep = CONFIG.GeometryLib.bench.QBenchmarkLoopFnWithSleep
extractPixels = CONFIG.GeometryLib.utils.extractPixels
GEOMETRY_ID = "_atvPlaceableGeometry";
MatrixFlat = CONFIG.GeometryLib.MatrixFlat
MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32
Area3dPopout = api.Area3dPopout
Area3dPopoutCanvas = api.Area3dPopoutCanvas
Settings = api.Settings
let { DocumentUpdateTracker, TokenUpdateTracker } = api;


buildDebugViewer = api.buildDebugViewer

let {
  WebGPUDevice,
  WebGPUShader,
  WebGPUBuffer,
  WebGPUTexture,
  Camera,
  GeometryWallDesc,
  GeometryCubeDesc,
  GeometryTileDesc,
  GeometryConstrainedTokenDesc,
  RenderWalls,
  RenderTokens,
  RenderTiles,
  RenderObstacles,
  WebGPUSumRedPixels,
  AsyncQueue,
  PlaceableInstanceHandler
  // wgsl
} = api.webgpu


let {
  Triangle,
  ConstrainedTokenTriangles,
  DirectionalWallTriangles,
  Grid3dTriangles,
  TileTriangles,
  TokenTriangles,
  WallTriangles,
} = api.triangles


device = await WebGPUDevice.getDevice()

viewer = _token
target = game.user.targets.first()


CONFIG.tokenvisibility.useCaching = false
CONFIG.tokenvisibility.tileThresholdShape = "triangles"
CONFIG.tokenvisibility.tileThresholdShape = "alphaThresholdTriangles"
CONFIG.tokenvisibility.tileThresholdShape = "alphaThresholdPolygons"

CONFIG.tokenvisibility.clipperVersion = 1
CONFIG.tokenvisibility.clipperVersion = 2

CONFIG.tokenvisibility.filterInstances = true
CONFIG.tokenvisibility.filterInstances = false

CONFIG.tokenvisibility.useRenderTexture = true;
CONFIG.tokenvisibility.useRenderTexture = false;

CONFIG.tokenvisibility.pixelCounterType = "loopCount2"
CONFIG.tokenvisibility.pixelCounterType = "blendCount2"
CONFIG.tokenvisibility.pixelCounterType = "reductionCount2"
CONFIG.tokenvisibility.pixelCounterType = "readPixelsCount"
CONFIG.tokenvisibility.pixelCounterType = "readPixelsCount2"
CONFIG.tokenvisibility.pixelCounterType = "loopCountTransform"

N = 20
await api.bench.benchTokenLOS(N, { sleep: false, movement: false })
await api.bench.benchTokenLOS(N, { sleep: false, movement: true })
await api.bench.benchTokenLOS(N, { sleep: true, movement: true })

await api.bench.benchTokenLOSAlgorithm(N, { sleep: false, movement: true, algorithm: Settings.KEYS.LOS.TARGET.TYPES.WEBGL2 })


let { vec3, vec4, mat4, quat } = api.glmatrix


// Giant Ape, Sprite
// Test Camera lookat
viewerLoc = Point3d.fromTokenCenter(viewer)
targetLoc = Point3d.fromTokenCenter(target)

camera = new Camera({
 glType: "webGL2",
  perspectiveType: "perspective",
  up: new CONFIG.GeometryLib.threeD.Point3d(0, 0, -1),
  mirrorMDiag: new CONFIG.GeometryLib.threeD.Point3d(1, 1, 1),
});

out = mat4.create()
eye = [...viewerLoc]
center = [...targetLoc]
up = [0, 0, -1]
mat4.lookAt(out, eye, center, up)

glLookAt = new MatrixFlat(out, 4, 4)


camera.cameraPosition = viewerLoc;
camera.targetPosition = targetLoc;
cameraLookAt = camera.lookAtMatrix

glLookAt.print()
cameraLookAt.print()


targetPolys = target.tokenvisibility.triangles
facingPolys = targetPolys.filter(poly => poly.isFacing(viewerLoc));
facingPolys.map(poly => poly
  .transform(camera.lookAtMatrix)
)

res = facingPolys.map(poly => [...poly.iteratePoints({close: false})].map(pt =>
  vec4.transformMat4(vec4.create(), [...pt, 1], out)
));


vec4.transformMat4(vec4.create(), [...pts[0], 1], out)



// Draw borders around tiles and borders for walls
canvas.walls.placeables.forEach(wall => Draw.segment(wall));
canvas.tiles.placeables.forEach(tile => Draw.shape(tile.bounds, { color: Draw.COLORS.red }))


popout = new Area3dPopoutCanvas({ width: 400, height: 475, resizable: false })
await popout._render(true);


presentationFormat = navigator.gpu.getPreferredCanvasFormat();
popout.context.configure({
  device,
  format: presentationFormat,
  alphamode: "premultiplied", // Instead of "opaque"
});


calc = new api.calcs.points();
calc = new api.calcs.geometric();
calc = new api.calcs.PIXI();
calc = new api.calcs.webGL2();
calc = new api.calcs.webGPU({ device })
calc = new api.calcs.webGPUAsync({ device })

await calc.initialize()
calc.percentVisible(viewer, target)
await calc.percentVisibleAsync(viewer, target)




// debugViewer = new api.debugViewers.points();
// debugViewer = new api.debugViewers.geometry();
// debugViewer = new api.debugViewers.PIXI();
// debugViewer = new api.debugViewers.webGL2();
// debugViewer = new api.debugViewers.webGPU({ device });
// debugViewer = new api.debugViewers.webGPUAsync({ device });

debugViewer = buildDebugViewer(api.debugViewers.points)
debugViewer = buildDebugViewer(api.debugViewers.geometric)
debugViewer = buildDebugViewer(api.debugViewers.PIXI, { width: 512, height: 512 })
debugViewer = buildDebugViewer(api.debugViewers.webGL2)
debugViewer = buildDebugViewer(api.debugViewers.webGL2, { debugView: false })
debugViewer = buildDebugViewer(api.debugViewers.webGL2, { largeTarget: true })

debugViewer = buildDebugViewer(api.debugViewers.webGPU)
debugViewer = buildDebugViewer(api.debugViewers.webGPUAsync)
debugViewer = buildDebugViewer(api.debugViewers.hybrid)

await debugViewer.initialize();
debugViewer.render();
debugViewer.destroy()



CONFIG.tokenvisibility.tileThresholdShape = "triangles"
CONFIG.tokenvisibility.tileThresholdShape = "alphaThresholdTriangles"
CONFIG.tokenvisibility.tileThresholdShape = "alphaThresholdPolygons"


debugViewers = {};
for ( const key of ["geometric", "webGL2", "webGPU", "webGPUAsync"] ) {
  const debugViewer = buildDebugViewer(api.debugViewers[key])
  await debugViewer.initialize();
  debugViewer.render();
  debugViewers[key] = debugViewer
}
Object.values(debugViewers).forEach(debugViewer => debugViewer.destroy())




// All at once
calcPoints = new api.calcs.points();
calcGeometric = new api.calcs.geometric();
calcWebGL2 = new api.calcs.webGL2();
calcWebGL2Instancing = new api.calcs.webGL2({ useInstancing: true });
calcHybrid = new api.calcs.hybrid();
calcWebGPU = new api.calcs.webGPU({ device });
calcWebGPUAsync = new api.calcs.webGPUAsync({ device });



await calcPoints.initialize();
await calcGeometric.initialize();
await calcWebGL2.initialize();
await calcWebGL2Instancing.initialize();
await calcHybrid.initialize();
await calcWebGPU.initialize();
await calcWebGPUAsync.initialize();


console.table({
  calcPoints: calcPoints.percentVisible(viewer, target),
  calcGeometric: calcGeometric.percentVisible(viewer, target),
  calcWebGL2: calcWebGL2.percentVisible(viewer, target),
  calcWebGL2Instancing: calcWebGL2Instancing.percentVisible(viewer, target),
  // calcHybrid: calcHybrid.percentVisible(viewer, target),
  calcWebGPU: calcWebGPU.percentVisible(viewer, target),
  calcWebGPUAsync: calcWebGPUAsync.percentVisible(viewer, target),

//   async_calcPoints: await calcPoints.percentVisibleAsync(viewer, target),
//   asyc_calcPIXI: await calcPIXI.percentVisibleAsync(viewer, target),
//   async_calcWebGL2: await calcWebGL2.percentVisibleAsync(viewer, target),
//   async_calcWebGL2Instancing: await calcWebGL2Instancing.percentVisibleAsync(viewer, target),
//   async_calcWebGPU: await calcWebGPU.percentVisibleAsync(viewer, target),
//   async_calcWebGPUAsync: await calcWebGPUAsync.percentVisibleAsync(viewer, target),
//   async_calcHybrid: await calcHybrid.percentVisibleAsync(viewer, target),
});

calcWebGPU.config = { largeTarget: true }

QBenchmarkLoop = CONFIG.GeometryLib.bench.QBenchmarkLoop;
QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn;

function percentFn(calc) {
  const tokens = canvas.tokens.placeables;
  const out = [];
  for ( const viewer of tokens ) {
    for ( const target of tokens ) {
      if ( viewer === target ) continue;
      out.push(calc.percentVisible(viewer, target));
    }
  }
  return out;
}

async function percentFnAsync(calc) {
  const tokens = canvas.tokens.placeables;
  const out = [];
  for ( const viewer of tokens ) {
    for ( const target of tokens ) {
      if ( viewer === target ) continue;
      out.push(await calc.percentVisibleAsync(viewer, target));
    }
  }
  return out;
}





CONFIG.tokenvisibility.useCaching = false
CONFIG.tokenvisibility.tileThresholdShape = "triangles"
CONFIG.tokenvisibility.tileThresholdShape = "alphaThresholdTriangles"
CONFIG.tokenvisibility.tileThresholdShape = "alphaThresholdPolygons"

CONFIG.tokenvisibility.clipperVersion = 1
CONFIG.tokenvisibility.clipperVersion = 2

CONFIG.tokenvisibility.filterInstances = true
CONFIG.tokenvisibility.filterInstances = false

N = 100
await QBenchmarkLoop(N, calcPoints, "percentVisible", viewer, target)
await QBenchmarkLoop(N, calcGeometric, "percentVisible", viewer, target)
await QBenchmarkLoop(N, calcHybrid, "percentVisible", viewer, target)
await QBenchmarkLoop(N, calcWebGL2, "percentVisible", viewer, target)
await QBenchmarkLoop(N, calcWebGPU, "percentVisible", viewer, target)
await QBenchmarkLoop(N, calcWebGPUAsync, "percentVisible", viewer, target)
await QBenchmarkLoop(N, calcWebGPUAsync, "percentVisibleAsync", viewer, target)


calcs = [calcPoints, calcGeometric, calcHybrid, calcPIXI, calcWebGL2, calcWebGL2Instancing, calcWebGPU, calcWebGPUAsync];
N = 20;
for ( const calc of calcs ) {
  console.log(`\n${calc.constructor.name}`);
  for ( const clipperVersion of [1, 2] ) {
    CONFIG.tokenvisibility.clipperVersion = clipperVersion;
    console.log(`\t${CONFIG.tokenvisibility.ClipperPaths.name}`);
    for ( const shape of Object.values(CONFIG.tokenvisibility.tileThresholdShapeOptions) ) {
      CONFIG.tokenvisibility.tileThresholdShape = shape;
      console.log(`\t\t${CONFIG.tokenvisibility.tileThresholdShape}`);
      if ( calc instanceof api.calcs.webGL2 ) {
        CONFIG.tokenvisibility.filterInstances = true;
        console.log(`\t\tfilterInstances? ${CONFIG.tokenvisibility.filterInstances}`);
        await QBenchmarkLoop(N, calc, "percentVisible", viewer, target);

        CONFIG.tokenvisibility.filterInstances = false;
        console.log(`\t\tfilterInstances? ${CONFIG.tokenvisibility.filterInstances}`);
        await QBenchmarkLoop(N, calc, "percentVisible", viewer, target);

      } else await QBenchmarkLoop(N, calc, "percentVisible", viewer, target);
    }
  }
}

for ( const clipperVersion of [1, 2] ) {
  CONFIG.tokenvisibility.clipperVersion = clipperVersion;
  for ( const shape of Object.values(CONFIG.tokenvisibility.tileThresholdShapeOptions) ) {
    CONFIG.tokenvisibility.tileThresholdShape = shape;

    console.log(`\n${CONFIG.tokenvisibility.tileThresholdShape} ${CONFIG.tokenvisibility.ClipperPaths.name}`);
    await QBenchmarkLoop(N, calcPoints, "percentVisible", viewer, target)
    await QBenchmarkLoop(N, calcGeometric, "percentVisible", viewer, target)
    await QBenchmarkLoop(N, calcHybrid, "percentVisible", viewer, target)
    await QBenchmarkLoop(N, calcPIXI, "percentVisible", viewer, target)
    await QBenchmarkLoop(N, calcWebGL2, "percentVisible", viewer, target)
    await QBenchmarkLoop(N, calcWebGPU, "percentVisible", viewer, target)
    await QBenchmarkLoop(N, calcWebGPUAsync, "percentVisible", viewer, target)
    await QBenchmarkLoop(N, calcWebGPUAsync, "percentVisibleAsync", viewer, target)
  }
}
await QBenchmarkLoop(N, calcWebGPUAsync, "percentVisibleAsync", viewer, target)

// Beiro --> Zanna




N = 20;
for ( const clipperVersion of [1, 2] ) {
  CONFIG.tokenvisibility.clipperVersion = clipperVersion;
  for ( const shape of ['triangles', 'alphaThresholdPolygons'] ) { // Object.values(CONFIG.tokenvisibility.tileThresholdShapeOptions) ) {
    CONFIG.tokenvisibility.tileThresholdShape = shape;

    console.log(`\n${CONFIG.tokenvisibility.tileThresholdShape} ${CONFIG.tokenvisibility.ClipperPaths.name}`);
    await QBenchmarkLoopFn(N, percentFn, "Points", calcPoints);
    await QBenchmarkLoopFn(N, percentFn, "Geometric", calcGeometric);
    await QBenchmarkLoopFn(N, percentFn, "Hybrid", calcHybrid);
    await QBenchmarkLoopFn(N, percentFn, "PIXI", calcPIXI);

    CONFIG.tokenvisibility.useRenderTexture = false;
    CONFIG.tokenvisibility.filterInstances = true;
    console.log(`\n\tFilter instances`);
    await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
    await QBenchmarkLoopFn(N, percentFn, "WebGL2 Instancing", calcWebGL2Instancing);
    // await QBenchmarkLoopFn(N, percentFnAsync, "WebGL2 Async", calcWebGL2);

    CONFIG.tokenvisibility.useRenderTexture = true;
    console.log(`\n\RenderTexture instances`);
    await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
    await QBenchmarkLoopFn(N, percentFn, "WebGL2 Instancing", calcWebGL2Instancing);

//     console.log(`\n\tStencil instances`);
//     CONFIG.tokenvisibility.useStencil = true;
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2 Instancing", calcWebGL2Instancing);
//     await QBenchmarkLoopFn(N, percentFnAsync, "WebGL2 Async", calcWebGL2);
//
//     console.log(`\n\tNo Stencil instances`);
//     CONFIG.tokenvisibility.useStencil = false;
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2 Instancing", calcWebGL2Instancing);
//     await QBenchmarkLoopFn(N, percentFnAsync, "WebGL2 Async", calcWebGL2);
//
//
//     CONFIG.tokenvisibility.filterInstances = false;
//     console.log(`\n\tNo filtering`);
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2 Instancing", calcWebGL2Instancing);
//     await QBenchmarkLoopFn(N, percentFnAsync, "WebGL2 Async", calcWebGL2);
//
//     console.log(`\n\tStencil instances`);
//     CONFIG.tokenvisibility.useStencil = true;
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2 Instancing", calcWebGL2Instancing);
//     await QBenchmarkLoopFn(N, percentFnAsync, "WebGL2 Async", calcWebGL2);
//
//     console.log(`\n\tNo Stencil instances`);
//     CONFIG.tokenvisibility.useStencil = false;
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
//     await QBenchmarkLoopFn(N, percentFn, "WebGL2 Instancing", calcWebGL2Instancing);
//     await QBenchmarkLoopFn(N, percentFnAsync, "WebGL2 Async", calcWebGL2);

    console.log(`\n\tWebGPU`);
    await QBenchmarkLoopFn(N, percentFn, "WebGPU", calcWebGPU);
    await QBenchmarkLoopFn(N, percentFn, "WebGPUAsync", calcWebGPUAsync);
// //     await QBenchmarkLoopFn(N, percentFnAsync, "async Points", calcPoints)
//     await QBenchmarkLoopFn(N, percentFnAsync, "async Geometric", calcGeometric)
//     await QBenchmarkLoopFn(N, percentFnAsync, "async Hybrid", calcHybrid)
//     await QBenchmarkLoopFn(N, percentFnAsync, "async PIXI", calcPIXI)
//     await QBenchmarkLoopFn(N, percentFnAsync, "async WebGL", calcWebGL2)
//     await QBenchmarkLoopFn(N, percentFnAsync, "async WebGPU", calcWebGPU)
   // await QBenchmarkLoopFn(N, percentFnAsync, "async WebGPUAsync", calcWebGPUAsync);
  }
}

calcWebGL2.percentVisible(viewer, target)
await calcWebGL2.percentVisibleAsync(viewer, target)

// Test different read pixel options.
CONFIG.tokenvisibility.tileThresholdShape = "alphaThresholdPolygons";
CONFIG.tokenvisibility.clipperVersion = 2;
CONFIG.tokenvisibility.useRenderTexture = true
// CONFIG.tokenvisibility.filterInstances = false;

N = 10;
await QBenchmarkLoopFn(N, percentFn, "Points", calcPoints);
await QBenchmarkLoopFn(N, percentFn, "Geometric", calcGeometric);
await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
await QBenchmarkLoopFn(N, percentFn, "WebGPU", calcWebGPU);

for ( const counterType of ["loopCount", "blendCount", "reductionCount", "readPixelsCount", "loopCount2", "blendCount2", "reductionCount2", "readPixelsCount", "readPixelsCount2"]) {
  CONFIG.tokenvisibility.pixelCounterType = counterType;
  console.log(`\n${counterType}`);
  await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
  await QBenchmarkLoopFn(N, percentFn, "WebGPU", calcWebGPU);
  await QBenchmarkLoopFn(N, percentFnAsync, "WebGL2", calcWebGL2);
}

await QBenchmarkLoop(N, calcWebGL2, "percentVisible", viewer, target)
await QBenchmarkLoop(N, calcWebGL2, "percentVisibleAsync", viewer, target)

fn = (viewer, target) => calcWebGL2.percentVisible(viewer, target)
fnAsync = async (viewer, target) => calcWebGL2.percentVisibleAsync(viewer, target)

await foundry.utils.benchmark(fn, 20, viewer, target)
await foundry.utils.benchmark(fnAsync, 20, viewer, target)



// Firefox and Safari
N = 20;
(async() => {
  for ( const clipperVersion of [1, 2] ) {
    CONFIG.tokenvisibility.clipperVersion = clipperVersion;
    for ( const shape of ['triangles', 'alphaThresholdPolygons'] ) { // Object.values(CONFIG.tokenvisibility.tileThresholdShapeOptions) ) {
      CONFIG.tokenvisibility.tileThresholdShape = shape;

      console.log(`\n${CONFIG.tokenvisibility.tileThresholdShape} ${CONFIG.tokenvisibility.ClipperPaths.name}`);
      await QBenchmarkLoopFn(N, percentFn, "Points", calcPoints);
      await QBenchmarkLoopFn(N, percentFn, "Geometric", calcGeometric);
      await QBenchmarkLoopFn(N, percentFn, "Hybrid", calcHybrid);
      await QBenchmarkLoopFn(N, percentFn, "PIXI", calcPIXI);

      CONFIG.tokenvisibility.filterInstances = true;
      console.log(`\n\tFilter instances`);
      await QBenchmarkLoopFn(N, percentFn, "WebGL2", calcWebGL2);
      await QBenchmarkLoopFn(N, percentFn, "WebGL2 Instancing", calcWebGL2Instancing);

    }
  }
})()



tri = VisionTriangle.build(Point3d.fromTokenCenter(viewer), target)
tri.draw()
canvas.walls.placeables.filter(wall => tri.containsWall(wall));
canvas.tokens.placeables.filter(token => tri.containsToken(token))


renderWalls = new RenderWalls();
await renderWalls.getDevice(); // So renderSize can be set
// renderWalls.sampleCount = 4
renderWalls.sampleCount = 1
renderWalls.renderSize = { width: 400, height: 400 } // Must set width/height to match canvas so depthTex works.
await renderWalls.initialize({ debugViewNormals: true });
renderWalls.setRenderTextureToCanvas(popout.canvas)
await renderWalls.prerender();
await renderWalls.render(Point3d.fromTokenCenter(viewer), target, { viewer })
renderWalls.registerPlaceableHooks();


renderTokens = new RenderTokens();
await renderTokens.getDevice();
renderTokens.sampleCount = 1
renderTokens.renderSize = { width: 256, height: 256 } // Must set width/height to match canvas so depthTex works.
await renderTokens.initialize({ debugViewNormals: true });
renderTokens.setRenderTextureToCanvas(popout.canvas)
await renderTokens.prerender();
await renderTokens.render(Point3d.fromTokenCenter(viewer), target, { viewer })
renderTokens.registerPlaceableHooks();

renderTokens.setRenderTextureToInternalTexture()
imgData = await renderTokens.readTexturePixels()
imgData = await renderTokens.readTexturePixels(true)


renderTiles = new RenderTiles({ width: 400, height: 400 });
await renderTiles.getDevice();
renderTiles.sampleCount = 1
await renderTiles.initialize({ debugViewNormals: true });
renderTiles.setRenderTextureToCanvas(popout.canvas)
await renderTiles.prerender();
await renderTiles.render(Point3d.fromTokenCenter(viewer), target, { viewer })


renderObstacles = new RenderObstacles(device, { debugViewNormals: true, width: 256, height: 256 });
// renderObstacles.renderSize = { width: 256, height: 256 } // Must set width/height to match canvas so depthTex works.
await renderObstacles.initialize();
renderObstacles.setRenderTextureToCanvas(popout.canvas)
// await renderObstacles.prerender();
renderObstacles.render(Point3d.fromTokenCenter(viewer), target, { viewer })

renderObstacles.registerPlaceableHooks();


// Render to WebGL2 texture
device = renderObstacles.device
let width = 256
let height = 256
gpuCanvas = new OffscreenCanvas(1, 1);
gpuCtx = gpuCanvas.getContext('webgpu');
glCanvas = new OffscreenCanvas(1, 1);
gl = glCanvas.getContext('webgl2');
texture = gl.createTexture();
framebuffer = gl.createFramebuffer();

gl.bindTexture(gl.TEXTURE_2D, texture);
gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);


// Resize the WebGPU canvas
gpuCanvas.width = width;
gpuCanvas.height = height;
gpuCtx.configure({
    device,
    format: 'bgra8unorm',
  });

renderObstacles.setRenderTextureToCanvas(gpuCanvas)
await renderObstacles.prerender();
await renderObstacles.render(Point3d.fromTokenCenter(viewer), target, { viewer })


readbackSize = width * height * 4;
bufferData = new Uint8Array(readbackSize);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gpuCanvas);
gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bufferData);
imgData = { pixels: bufferData, x: 0, y: 0, width, height }


gl = canvas.app.renderer.gl
let { width, height } = popout.canvas
readbackSize = width * height * 4;
bufferData = new Uint8Array(readbackSize);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, popout.canvas);
gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bufferData);


function summarizePixelData(pixels) {
  if ( Object.hasOwn(pixels, "pixels") ) pixels = pixels.pixels;
  const acc = Array(12).fill(0);
  const max = Array(4).fill(0);
  const min = Array(4).fill(0)
  pixels.forEach((px, idx) => {
    acc[idx % 4] += px;
    acc[idx % 4 + 4] += Boolean(px);
    acc[idx % 4 + 8] += !px;
    max[idx % 4] = Math.max(px, max[idx % 4])
    min[idx % 4] = Math.min(px, min[idx % 4])
  });
  let redBlocked = 0;
  const terrainThreshold = 255 * 0.75;
  for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    redBlocked += Boolean(r) * Boolean(b || (g > terrainThreshold))
  }

  console.table([
    { label: "sum", r: acc[0], g: acc[1], b: acc[2], a: acc[3] },
    { label: "count", r: acc[4], g: acc[5], b: acc[6], a: acc[7] },
    { label: "zeroes", r: acc[8], g: acc[9], b: acc[10], a: acc[11] },
    { label: "min", r: min[0], g: min[1], b: min[2], a: min[3] },
    { label: "max", r: max[0], g: max[1], b: max[2], a: max[3] },
    { label: "redBlocked", r: redBlocked, g: redBlocked, b: redBlocked, a: redBlocked}
  ])
}

// Render to texture
renderObstacles.setRenderTextureToInternalTexture()
renderObstacles.render(Point3d.fromTokenCenter(viewer), target, { viewer })

imgData = await renderObstacles.readTexturePixels()
summarizePixelData(imgData.pixels)

sumPixels = new WebGPUSumRedPixels(renderObstacles.device)
await sumPixels.initialize()
res = await sumPixels.compute(renderObstacles.renderTexture)

sumPixels.computeSync(renderObstacles.renderTexture)


visCalc = new PercentVisibleCalculator();
await visCalc.initialize({ senseType: "sight" })
await visCalc.percentVisible(Point3d.fromTokenCenter(viewer), target, { viewer })
visibleTextElem = popout.element[0].getElementsByTagName("p")[0]



// Full test with popout debug
// renderObstacles = new RenderObstacles();
// await renderObstacles.getDevice();
// renderObstacles.sampleCount = 1
// renderObstacles.renderSize = { width: 256, height: 256 } // Must set width/height to match canvas so depthTex works.
// renderObstacles.setRenderTextureToInternalTexture()
// await renderObstacles.initialize({ debugViewNormals: false });
// await renderObstacles.prerender();

visCalc = new PercentVisibleCalculator();
await visCalc.initialize({ senseType: "sight" })
visibleTextElem = popout.element[0].getElementsByTagName("p")[0]

renderObstaclesDebug = new RenderObstacles();
await renderObstaclesDebug.getDevice();
renderObstaclesDebug.sampleCount = 1
renderObstaclesDebug.renderSize = { width: 256, height: 256 } // Must set width/height to match canvas so depthTex works.
await renderObstaclesDebug.initialize({ debugViewNormals: true });
renderObstaclesDebug.setRenderTextureToCanvas(popout.canvas)
await renderObstaclesDebug.prerender();

renderQueue = new AsyncQueue()

queueObjectFunction = function(viewer, target) { return rerender; }

async function rerenderAsync() {
  // await renderObj.prerender();
  console.debug(`Rerendering ${viewer.name} (${Point3d.fromTokenCenter(viewer)} -> ${target.name} (${Point3d.fromTokenCenter(target)}))`);
  await renderObstacles.render(Point3d.fromTokenCenter(viewer), target, { viewer });
  const percentVis = await visCalc.percentVisible(Point3d.fromTokenCenter(viewer), target, { viewer });

  await renderObstaclesDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer });
  visibleTextElem.innerHTML = `Percent visible:${Math.round(percentVis * 100)}%`;
  console.debug(`${viewer.name} --> ${target.name} ${Math.round(percentVis * 100)}%`);
}

function rerender() {
  console.debug(`Rerendering ${viewer.name} (${Point3d.fromTokenCenter(viewer)} -> ${target.name} (${Point3d.fromTokenCenter(target)}))`);
  // renderObstacles.renderSync(Point3d.fromTokenCenter(viewer), target, { viewer });
  const percentVis = visCalc.percentVisibleSync(Point3d.fromTokenCenter(viewer), target, { viewer });

  renderObstaclesDebug.renderSync(Point3d.fromTokenCenter(viewer), target, { viewer });
  visibleTextElem.innerHTML = `Percent visible:${Math.round(percentVis * 100)}%`;
  console.debug(`${viewer.name} --> ${target.name} ${Math.round(percentVis * 100)}%`);
}

Hooks.on("controlToken", (token, controlled) => {
  if ( controlled ) viewer = token;
  // rerender();
  console.debug(`Control changed to ${token.name} (${controlled})`);
//   const queueObject = queueObjectFunction(viewer, token);
//   renderQueue.enqueue(queueObject);
  rerender();
});

Hooks.on("targetToken", (user, targetToken, targeted) => {
  if ( !targeted || game.user !== user ) return;
  target = targetToken;
  // rerender();
  console.debug(`Target changed to ${target.name}`);
  rerender();

//   const queueObject = queueObjectFunction(viewer, token);
//   renderQueue.enqueue(queueObject);
})

tokenPositionCache = new WeakMap();
Hooks.on("refreshToken", (token, flags) => {
  if ( token !== viewer && token !== target ) return;
  if ( !(flags.refreshPosition
      || flags.refreshElevation
      || flags.refreshSize ) ) return;
  // rerender();

  const currPosition = Point3d.fromTokenCenter(token)
  const lastPosition = tokenPositionCache.get(_token);
  if ( !flags.refreshSize && lastPosition && currPosition.equals(lastPosition) ) return;
  tokenPositionCache.set(_token, currPosition);

  console.debug(`Refreshing ${token.name} at position ${currPosition},`, {...flags});
  rerender();
//   const queueObject = queueObjectFunction(viewer, token);
//   renderQueue.enqueue(queueObject);
})


// Hooks to change rendering on move
renderType = "Walls"
renderType = "Tokens"
renderType = "Tiles"
renderType = "Obstacles"

async function rerenderObj(renderObj, viewer, target) {
  // await renderObj.prerender();
  await renderObj.render(Point3d.fromTokenCenter(viewer), target, { viewer });
  //const percentVis = await visCalc.percentVisible(Point3d.fromTokenCenter(viewer), target, { viewer })
  //visibleTextElem.innerHTML = `Percent visible: ${percentVis.toFixed(2) * 100}%`;
}

// rerender = () => {
//   let renderObj;
//   switch ( renderType ) {
//     case "Walls": renderObj = renderWalls; break;
//     case "Tokens": renderObj = renderTokens; break;
//     case "Tiles": renderObj = renderTiles; break;
//     case "Obstacles": renderObj = renderObstacles; break;
//   }
//   rerenderObj(renderObj, viewer, target);
// }

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

/**
 * Handle multiple sheet refreshes by using an async queue.
 * If the actor sheet is rendering, wait for it to finish.
 */
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay)); // eslint-disable-line no-promise-executor-return

const renderQueue = new AsyncQueue();

const queueObjectFn = function(ms, actor) {
  return async function rerenderActorSheet() {
    log(`AbstractUniqueEffect#rerenderActorSheet|Testing sheet for ${actor.name}`);

    // Give up after too many iterations.
    const MAX_ITER = 10;
    let iter = 0;
    while ( iter < MAX_ITER && actor.sheet?._state === Application.RENDER_STATES.RENDERING ) {
      iter += 1;
      await sleep(ms);
    }
    if ( actor.sheet?.rendered ) {
      log(`AbstractUniqueEffect#rerenderActorSheet|Refreshing sheet for ${actor.name}`);
      await actor.sheet.render(true);
    }
  };
};

function queueSheetRefresh(actor) {
  log(`AbstractUniqueEffect#rerenderActorSheet|Queuing sheet refresh for ${actor.name}`);
  const queueObject = queueObjectFn(100, actor);
  renderQueue.enqueue(queueObject); // Could break up the queue per actor but probably unnecessary?
}


// Read pixels
async function readTexturePixels(device, texture) {
  // copyTextureToBuffer requires 256 byte widths for bytesPerRow
  const width = Math.ceil((texture.width * 4) / 256) * (256 / 4);
  const height = texture.height;
  const renderResult = device.createBuffer({
    label: "renderResult",
    size: width * height * 4, // 1 bytes per (u8)
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const encoder = device.createCommandEncoder({ label: 'Read texture pixels' });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: renderResult, bytesPerRow: width * 4 },
    { width: texture.width, height: texture.height }, // height: 1, depthOrArrayLayers: 1
  );


  device.queue.submit([encoder.finish()]);

  await renderResult.mapAsync(GPUMapMode.READ);
  const pixels = new Uint8Array(renderResult.getMappedRange());

  // Do a second copy so the original buffer can be unmapped.
  const imgData = {
    pixels: new Uint8Array(pixels),
    x: 0,
    y: 0,
    width,
    height,
  };
  renderResult.unmap();
  renderResult.destroy();
  return imgData;
}
imgData = await readTexturePixels(renderObstacles.device, renderObstacles.renderTexture)

tex = PIXI.Texture.fromBuffer(imgData.pixels, imgData.width, imgData.height)
sprite = new PIXI.Sprite(tex);
canvas.app.stage.addChild(sprite);
canvas.app.stage.removeChild(sprite);

acc = Array(12).fill(0);
max = Array(4).fill(0);
min = Array(4).fill(0)
imgData.pixels.forEach((px, idx) => {
  acc[idx % 4] += px;
  acc[idx % 4 + 4] += Boolean(px);
  acc[idx % 4 + 8] += !Boolean(px);
  max[idx % 4] = Math.max(px, max[idx % 4])
  min[idx % 4] = Math.min(px, min[idx % 4])
});
console.table([
  { label: "sum", r: acc[0], g: acc[1], b: acc[2], a: acc[3] },
  { label: "count", r: acc[4], g: acc[5], b: acc[6], a: acc[7] },
  { label: "zeroes", r: acc[8], g: acc[9], b: acc[10], a: acc[11] },
  { label: "min", r: min[0], g: min[1], b: min[2], a: min[3] },
  { label: "max", r: max[0], g: max[1], b: max[2], a: max[3] }
])

function sumRedPixels(targetCache) {
  const pixels = targetCache.pixels;
  const nPixels = pixels.length;
  let sumTarget = 0;
  for ( let i = 0; i < nPixels; i += 4 ) sumTarget += Boolean(targetCache.pixels[i]);
  return sumTarget;
}
function sumRedObstaclesPixels(targetCache) {
  const pixels = targetCache.pixels;
  const nPixels = pixels.length;
  let sumTarget = 0;
  for ( let i = 0; i < nPixels; i += 4 ) {
    const px = pixels[i];
    if ( px < 128 ) continue;
    sumTarget += Boolean(targetCache.pixels[i]);
  }
  return sumTarget;
}
sumRedPixels(imgData)
sumRedObstaclesPixels(imgData)

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
    srcFactor: "one", // Could use src-alpha and set clear canvas to alpha = 0. But if no other green, this is simpler.
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


/*
Simplest version:
Keep all red channel for target. On overlap, keep anyway.
Write to green channel for terrain. Add two 50% green to get to 100%.
Write all other obstacles to blue at 100%.
Set tile pixels to blue if greater than alphaThreshold.

Now can write one texture for all:
- Sum red to get area of target without obstacles.
- Sum red if not 100% green and not 100% blue to get area of target w/ obstacles.

*/






