/* Test rendering full scene using WebGL2

*/
MODULE_ID = "tokenvisibility"
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get(MODULE_ID).api
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
VisionTriangle = api.bvh.VisionTriangle
VisionPolygon = api.bvh.VisionPolygon


let {
  Camera,
  GeometryDesc,
  GeometryWallDesc,
  GeometryTokenDesc,
  GeometryTileDesc,
  GeometryConstrainedTokenDesc,
  AsyncQueue,
  WallInstanceHandler, TileInstanceHandler, TokenInstanceHandler
  // wgsl
} = api.webgpu;

let {
  DrawableWallInstancesPIXI,
  RenderWallsPIXI,
} = api.webgl;


let { vec3, vec4, mat4, quat } = api.glmatrix

// Draw borders around tiles and borders for walls
canvas.walls.placeables.forEach(wall => Draw.segment(wall));
canvas.tiles.placeables.forEach(tile => Draw.shape(tile.bounds, { color: Draw.COLORS.red }))


viewer = _token
target = game.user.targets.first()

renderWalls = new RenderWallsPIXI()
await renderWalls.initialize()
renderWalls.prerender()
renderWalls.render(Point3d.fromTokenCenter(viewer), target, { viewer })



tex = renderWalls.renderTexture
sprite = new PIXI.Sprite(tex);
canvas.app.stage.addChild(sprite);
canvas.app.stage.removeChild(sprite)

container = renderWalls.obstacleContainer
canvas.app.stage.addChild(container);
canvas.app.stage.removeChild(container)

