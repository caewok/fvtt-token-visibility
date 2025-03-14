
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
Area3dPopout = api.Area3dPopout
Area3dPopoutCanvas = api.Area3dPopoutCanvas


let {
  WebGPUDevice,
  WebGPUShader,
  WebGPUBuffer,
  WebGPUTexture,
  Camera,
  GeometryWallDesc,
  Geometry,
  RenderWalls,
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

renderWalls = new RenderWalls(device);
await renderWalls.initialize();
renderWalls.setRenderTextureToCanvas(popout.context);
await renderWalls.renderScene(Point3d.fromTokenCenter(viewer), target)



popout.close()

renderWalls.camera.






