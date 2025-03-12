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
Area3dPopout = api.Area3dPopout
Area3dPopoutCanvas = api.Area3dPopoutCanvas


let {
  WebGPUDevice,
  WebGPUShader,
  WebGPUBuffer,
  WebGPUTexture,
  Geometry,
  WebGPUSceneObstacles,
  GridDemo,
} = api.webgpu

let { vec3, vec4, mat4, quat } = api.glmatrix


viewer = _token
target = game.user.targets.first()

losCalc = viewer.vision.tokenvisibility.losCalc
losCalc.target = target
vp = losCalc.viewpoints[0]


device = await WebGPUDevice.getDevice()

popout = new Area3dPopoutCanvas({ width: 800, height: 800, resizable: true })
await popout._render(true);
presentationFormat = navigator.gpu.getPreferredCanvasFormat();
popout.context.configure({
  device,
  format: presentationFormat,
});

demo = new GridDemo(device, popout.canvas)
await demo.initialize();
demo.render();

popout.close()


sceneObstacles = new WebGPUSceneObstacles(device);
await sceneObstacles.initialize()
sceneObstacles.setRenderTextureToCanvas(popout.context);
sceneObstacles.renderScene(Point3d.fromTokenCenter(viewer), target)

