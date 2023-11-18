/* Calculating 3d area:

In a render texture:

- Limit the viewable area based on token vision angle.

1. Construct and draw the token shape from viewer perspective. Either drawn from points or scaled

2. Scale tiles and draw. These must be rendered and scaled.

3. Scale walls and draw. Either drawn from points or scaled

4. Draw obscuring token shapes.  Either drawn from points or scaled

*/

/* Transformations
Matrix = CONFIG.GeometryLib.Matrix
Matrix.rotationZ(Ø):
[ cos Ø   sin Ø   0   0 ]
[ -sin Ø  cos Ø   0   0 ]
[ 0       0       1   0 ]
[ 0       0       0   1 ]

Matrix.rotationY(Ø):
[ cos Ø   0   sin Ø   0 ]
[ 0       1   0       0 ]
[ -sin Ø  0   cos Ø   0 ]
[ 0       0   0       1 ]

Matrix.rotationX(Ø):
[ 1   0       0       0 ]
[ 0   cos Ø   sin Ø   0 ]
[ 0   -sin Ø  cos Ø   0 ]
[ 0   0       0       1 ]

Matrix.translation(x, y, z):
[ 1   0   0   0 ]
[ 0   1   0   0 ]
[ 0   0   1   0 ]
[ x   y   z   1 ]

Matrix.scale(x, y, z):
[ x   0   0   0 ]
[ 0   y   0   0 ]
[ 0   0   z   0 ]
[ 0   0   0   1 ]


CSS skew (shear):
[ 1       tan ax    0   0 ] // Might be tan ay
[ tan ay  1         0   0 ] // Might be tan ax
[ 0       0         1   0 ]
[ 0       0         0   1 ]



*/


Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
api = game.modules.get("tokenvisibility").api;
Area3dLOS = api.Area3dLOS;
PixelCache = api.PixelCache

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;


calc = new Area3dLOS(viewer, target)
calc.percentVisible()

calc.targetPoints.drawTransformed();
calc._calculateViewerCameraMatrix()

targetG = new PIXI.Graphics();
draw = new Draw(targetG);

faces = calc.targetPoints.faces


bottomFace = calc.targetPoints.faces[2];
pts = bottomFace.points
txPts = bottomFace.perspectiveTransform()

poly = new PIXI.Polygon(txPts);
Draw.shape(poly, { color: Draw.COLORS.red })

[0]: 2700, 3800
[2]: 2800, 3900

b1 = [ 2700 ]
     [ 3800 ]

b2 = [ 2800 ]
     [ 3900 ]

c1 = [ 78.4 ]
     [ 154.1 ]
c2 = [ -107.5 ]
     [ -5.9 ]


bMat = new Matrix([
  [ 2700, 3800],
  [ 2800, 3900],
])

cMat = new Matrix([
  [ 78.4, 154.1],
  [ -107.5, -5.9]
])

bMat = new Matrix([
  [ 2700, 2800],
  [ 3800, 3900],
])

cMat = new Matrix([
  [ 78.4, -107.5],
  [ 154.1, -5.9]
])

cMatInv = cMat.invert()

basis = cMatInv.multiply(bMat)
basis = bMat.multiply(cMatInv)


b1 = new Matrix([
 [2700],
 [3800]
])

b2 = new Matrix([
  [2800],
  [3900]
])

// https://math.stackexchange.com/questions/2562188/how-do-i-find-the-transformation-matrix-between-two-sets-of-points
function linearTransform(r, p) {
   return [
    [  (r[1].x * p[0].y - r[0].x * p[1].y) / (p[1].x * p[0].y - p[0].x * p[1].y),
      -(r[1].x * p[0].x - r[0].x * p[1].x) / (p[1].x * p[0].y - p[0].x * p[1].y) ],
    [  (r[1].y * p[0].y - r[0].y * p[1].y) / (p[1].x * p[0].y - p[0].x * p[1].y),
      -(r[1].y * p[0].x - r[0].y * p[1].x) / (p[1].x * p[0].y - p[0].x * p[1].y) ]
  ]
}

tx = linearTransform(pts, txPts)
txMat = new Matrix(tx)

b0 = new Matrix([[pts[0].x], [pts[0].y]])
b1 = new Matrix([[pts[1].x], [pts[1].y]])
b2 = new Matrix([[pts[2].x], [pts[2].y]])
b3 = new Matrix([[pts[3].x], [pts[3].y]])

txMat.invert().multiply(b0)
txMat.invert().multiply(b1)
txMat.invert().multiply(b2)
txMat.invert().multiply(b3)


tex = await PIXI.Assets.load('https://v2-pixijs.com/assets/bg_grass.jpg');
plane = new PIXI.SimplePlane(tex, 2, 2);
canvas.stage.addChild(plane)

buffer = plane.geometry.getBuffer('aVertexPosition');
buffer.data[0] = txPts[0].x
buffer.data[1] = txPts[0].y
buffer.data[2] = txPts[1].x
buffer.data[3] = txPts[1].y
buffer.data[4] = txPts[2].x
buffer.data[5] = txPts[2].y
buffer.data[6] = txPts[3].x
buffer.data[7] = txPts[3].y
buffer.update()

// This version works
buffer.data[0] = txPts[0].x
buffer.data[1] = txPts[0].y
buffer.data[4] = txPts[1].x
buffer.data[5] = txPts[1].y
buffer.data[6] = txPts[2].x
buffer.data[7] = txPts[2].y
buffer.data[2] = txPts[3].x
buffer.data[3] = txPts[3].y
buffer.update()


// NOTE: Draw token shape to render texture and calculate its area using pixels
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
api = game.modules.get("tokenvisibility").api;
Area3dLOS = api.Area3dLOS;
PixelCache = api.PixelCache

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;


targetG = new PIXI.Graphics();
draw = new Draw(targetG);

calc = new Area3dLOS(viewer, target)
calc.percentVisible()
calc.targetPoints.drawTransformed({ color: Draw.COLORS.red, fill: Draw.COLORS.red, fillAlpha: 1, drawTool: draw })

txPtsArray = calc.targetPoints.faces.map(face => face.perspectiveTransform())
xValues = [];
yValues = [];
for ( const ptArray of txPtsArray ) {
  for ( const pt of ptArray ) {
    xValues.push(pt.x);
    yValues.push(pt.y);
  }
}
xMinMax = Math.minMax(...xValues);
yMinMax = Math.minMax(...yValues);

// Translate the points to fit in the render texture.
targetG.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);


texConfig = {
  resolution: 1,
  width: xMinMax.max - xMinMax.min,
  height: yMinMax.max - yMinMax.min,
  scaleMode: PIXI.SCALE_MODES.NEAREST
}
rt =  PIXI.RenderTexture.create(texConfig);
canvas.app.renderer.render(targetG, { renderTexture: rt, clear: true });
s = new PIXI.Sprite(rt)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)


cache = PixelCache.fromTexture(rt)
cache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0)
sum = cache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);
total = cache.pixels.length; // Or cache.area

console.log(`Total red pixels: ${sum}; total texture area: ${cache.pixels.length} or ${cache.area} (area).`)


tTarget = calc.targetPoints.perspectiveTransform();
sidePolys = tTarget.map(side => new PIXI.Polygon(side));

sidesArea = sidePolys.reduce((area, poly) =>
      area += poly.scaledArea({scalingFactor: Area3dLOS.SCALING_FACTOR}), 0);

console.log(`Geometric area is ${sidesArea} versus pixel area of ${sum}`)

// NOTE: Draw token shape and blocking wall and calculate visible area using pixels
targetG.position = new PIXI.Point(0, 0);
wallsG = new PIXI.Graphics();


draw = new Draw(wallsG)
wallPts = calc.blockingPoints.walls;
wallPolys = wallPts.map(w => new PIXI.Polygon(w.perspectiveTransform()));
wallPolys.forEach(poly => draw.shape(poly, { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 1}));

targetG.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
wallsG.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
// wallsG.blendMode = PIXI.BLEND_MODES.SRC_IN; // Works: blue on red.
// wallsG.blendMode = PIXI.BLEND_MODES.DST_IN; // Doesn't work: red on red.
wallsG.blendMode = PIXI.BLEND_MODES.DST_OUT; // Works: removes the red.

rt =  PIXI.RenderTexture.create(texConfig);
canvas.app.renderer.render(targetG, { renderTexture: rt, clear: true });
canvas.app.renderer.render(wallsG, { renderTexture: rt, clear: false });
s = new PIXI.Sprite(rt)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

cacheWalls = PixelCache.fromTexture(rt)
cacheWalls.pixels.reduce((acc, curr) => acc += Boolean(curr), 0)
sumWalls = cacheWalls.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);

calcNoTiles = new Area3dLOS(viewer, target, { tilesBlock: false })
calcNoTiles.percentVisible()

console.log(`Pixel percent visible: ${sumWalls / sum}; geometric percent visible: ${calcNoTiles.percentVisible()}`)


// NOTE: Draw token shape and blocking tile and calculate visible area using pixels
targetG.position = new PIXI.Point(0, 0);
tilesG = new PIXI.Container()
let [tile] = calc.blockingObjects.tiles

tileTex = PIXI.Texture.from(tile.texture.baseTexture)
plane = new PIXI.SimplePlane(tileTex, 2, 2);

// testing
canvas.stage.addChild(plane);
canvas.stage.removeChild(plane)

let [tilePts] = calc.blockingObjectsPoints.tiles

tilePts = calc.blockingPoints.tiles[0]
tileOrigPts = tilePts.points
tileTxPts = tilePts.perspectiveTransform()

poly = new PIXI.Polygon(tileTxPts.flatMap(pt => [pt.x, pt.y]))

tileTxPts = calc.blockingPoints.tiles[0].perspectiveTransform()

poly = new PIXI.Polygon(tilePts.tPoints.flatMap(pt => [pt.x, pt.y]))
Draw.shape(poly, { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.5})

0: TL: -329, -194

1: BR: -1095, 782

2: BL: -290, 1038

3: TR: 676, -194


pts = tileTxPts
pts = tilePts.tPoints
pts = tilePts.perspectiveTransform(); // This is the full tile shape in perspective.

poly = new PIXI.Polygon(
  pts[0].x, pts[0].y,
  pts[3].x, pts[3].y,
  pts[2].x, pts[2].y,
  pts[1].x, pts[1].y,
)
Draw.shape(poly, { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.5})


buffer = plane.geometry.getBuffer('aVertexPosition');
// BR
buffer.data[0] = pts[1].x
buffer.data[1] = pts[1].y

// BL
buffer.data[2] = pts[2].x
buffer.data[3] = pts[2].y


// TR
buffer.data[4] = pts[3].x
buffer.data[5] = pts[3].y

// TL
buffer.data[6] = pts[0].x
buffer.data[7] = pts[0].y
buffer.update()


// BR
buffer.data[0] = 69
buffer.data[1] = 218

// BL
buffer.data[2] = -235
buffer.data[3] = 144


// TR
buffer.data[4] = 267
buffer.data[5] = 50

// TL
buffer.data[6] = -103
buffer.data[7] = -73
buffer.update()


// 0 is TL --> buffer 6,7
// 1 is BR --> buffer 0,1
// 2 is BL --> buffer 2,3
// 3 is TR --> buffer 4,5


// Texture points:
// 0,1: TL: 0,0
// 2,3: TR: texture width, 0
// 4,5: BL: 0, texture height
// 6,7: BR: width, height

// Blocking points:
// 0: TL
// 1: TR
// 2: BR
// 3: BL

buffer = plane.geometry.getBuffer('aVertexPosition');

// TL
buffer.data[0] = tileTxPts[0].x
buffer.data[1] = tileTxPts[0].y

// TR
buffer.data[2] = tileTxPts[1].x
buffer.data[3] = tileTxPts[1].y


// BL
buffer.data[4] = tileTxPts[3].x
buffer.data[5] = tileTxPts[3].y

// BR
buffer.data[6] = tileTxPts[2].x
buffer.data[7] = tileTxPts[2].y
buffer.update()


// Plane buffer is two triangles:
0, 1, 2
1, 3, 2

// Texture is:
0, 0
1, 0
0, 1
1, 1

// Coords are length 8. Four coordinates
tri 0: x0 (0), y0 (1)  <-- 0,0  Top left texture
tri 1: x1 (2), y1 (3)  <-- w,0  Top right texture
tri 2: x2 (4), y2 (5)  <-- 0,h  Bottom left texture

tri 1: x1 (2), y1 (3)  (TR)
tri 3: x3 (6), y3 (7)  <-- w,h  Bottom right texture
tri 2: x2 (4), y2 (5)  (BL)


// TL
buffer.data[0] = pts[3].x
buffer.data[1] = pts[3].y

// BL
buffer.data[4] = pts[2].x
buffer.data[5] = pts[2].y

// TR
buffer.data[2] = pts[0].x
buffer.data[3] = pts[0].y

// BL
buffer.data[6] = pts[1].x
buffer.data[7] = pts[1].y

// TR
buffer.data[2] = tileTxPts[1].x
buffer.data[3] = tileTxPts[1].y


// BL
buffer.data[4] = tileTxPts[3].x
buffer.data[5] = tileTxPts[3].y

// BR
buffer.data[6] = tileTxPts[2].x
buffer.data[7] = tileTxPts[2].y
buffer.update()



plane.tint = 0x00FF00 // Should really use a ColorMatrixFilter instead, to shift red to blue and green to blue

colorMatrix = new PIXI.ColorMatrixFilter()
// https://stackoverflow.com/questions/51307062/pixi-change-only-non-transparent-pixels-of-sprite-to-one-solid-color
colorMatrix.reset()

colorMatrix.matrix = [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0
];


// Red to Blue; blue to Red
colorMatrix.matrix = [
    0, 0, 1, 0, 0,  // Red
    0, 1, 0, 0, 0,  // Green
    1, 0, 0, 0, 0,  // Blue
    0, 0, 0, 1, 0   // Alpha
];

colorMatrix.matrix = [
    0, 0, 1, 0, 0,  // Red
    0, 1, 0, 0, 0,  // Green
    1, 0, 0, 0, 0,  // Blue
    0, 0, 0, 1, 0   // Alpha
];

// Red and Green to Blue?
// TODO: What about alpha?
colorMatrix.matrix = [
    0, 0, 1, 0, 0,  // Red
    0, 1, 1, 0, 0,  // Green
    1, 0, 1, 0, 0,  // Blue
    0, 0, 0, 1, 0   // Alpha
];


let { width, height } = tile.texture;
tilePoints = {
  center: new PIXI.Point(width * 0.5, height * 0.5),
  tl: new PIXI.Point(0, 0),
  tr: new PIXI.Point(width, 0),
  bl: new PIXI.Point(0, height),
  br: new PIXI.Point(width, height),
}

tileShader = TileShader.create(tile)
tileGeom = new CenteredQuadGeometry(tilePoints)
tilePlane = new PIXI.Mesh(tileGeom, tileShader)

// With warped points
tileCenter = new Point3d(tile.bounds.center.x, tile.bounds.center.y, tile.elevationZ)
tileCenterT = tilePts.M.multiplyPoint3d(tileCenter);
tileTxPts = tilePts.perspectiveTransform()


PlanePoints3d = api.PlanePoints3d
tilePoints = {
  center: PlanePoints3d.perspectiveTransform(tileCenterT),
  tl: tileTxPts[3],
  tr: tileTxPts[0],
  bl: tileTxPts[2],
  br: tileTxPts[1]
}

tileGeom = new CenteredQuadGeometry(tilePoints)
tilePlane = new PIXI.Mesh(tileGeom, tileShader)



plane.filters = [colorMatrix]

tilesG.addChild(plane);

targetG.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
tilesG.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);

tilesG.blendMode = PIXI.BLEND_MODES.DST_OUT; // Works: removes the red.

rt =  PIXI.RenderTexture.create(texConfig);
canvas.app.renderer.render(targetG, { renderTexture: rt, clear: true });
canvas.app.renderer.render(tilesG, { renderTexture: rt, clear: false });
s = new PIXI.Sprite(rt)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)






https://pixijs.io/examples-v4/#/plugin-projection/quad-homo.js
https://stackoverflow.com/questions/15242507/perspective-correct-texturing-of-trapezoid-in-opengl-es-2-0
https://stackoverflow.com/questions/29847342/how-to-correctly-map-texture-when-doing-perspective-warping-in-glsl-using-opengl
https://registry.khronos.org/OpenGL-Refpages/gl4/html/texture.xhtml
https://registry.khronos.org/OpenGL-Refpages/gl4/html/textureProj.xhtml
https://forum.openframeworks.cc/t/projective-texture-mapping-glsl/23677
https://paroj.github.io/gltut/Texturing/Tut17%20Projective%20Texture.html
https://forum.openframeworks.cc/t/projective-texture-mapping-glsl/23677


let [tilePts] = calc.blockingObjectsPoints.tiles
points = {
  tl: tilePts.tPoints[0],
  tr: tilePts.tPoints[1],
  br: tilePts.tPoints[2],
  bl: tilePts.tPoints[3]
}

points.bl.z *= -1
points.br.z *= -1
points.tl.z *= -1
points.tr.z *= -1

tileGeom = new QuadProjectionGeometry(points);
tileShader = TileProjectionShader.create(tile, { uMultiplier: 1000 })
tilePlane = new PIXI.Mesh(tileGeom, tileShader)
canvas.stage.addChild(tilePlane)
canvas.stage.removeChild(tilePlane)



pts = tilePts.perspectiveTransform(); // This is the full tile shape in perspective.

poly = new PIXI.Polygon(
  pts[0].x, pts[0].y,
  pts[3].x, pts[3].y,
  pts[2].x, pts[2].y,
  pts[1].x, pts[1].y,
)
Draw.shape(poly, { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.5})
Draw.point(pts[0], { color: Draw.COLORS.red })
Draw.point(pts[1], { color: Draw.COLORS.green })
Draw.point(pts[2], { color: Draw.COLORS.yellow })
Draw.point(pts[3], { color: Draw.COLORS.orange })



// Points at different locations:
Center
tile.bounds.center: 3150, 3850, 200 --> translated {x: -126.49110640673507, y: 221.8280272694367, z: -676.2339286946121}
mid-TL-TR: 2300, 3400, 200          --> translated {x: -284.60498941515425, y: -257.2169343435494, z: 142.61643904861194}
mid-TL-BL: 2000, 900, 200           --> translated {x: -2561.444904736387, y: -800.1345575049331, z: 1070.6468558242652}


// Translate to texture space [0,1]
scaleTexM = Matrix.scale(tile.bounds.width, tile.bounds.height, 1)
translateM = Matrix.translation(0.5, 0.5, 0.5);
scaleM = Matrix.scale(0.5, 0.5, 0.5)
trMat = scaleTexM.multiply(translateM).multiply(scaleM)

center = new Point3d(3150, 3850, 200)
centerTx = tilePts.M.multiplyPoint3d(center)
trMat.multiplyPoint3d(centerTx)

tmp = trMat.multiplyPoint3d(centerTx)
tmp.x / tmp.z
tmp.y / tmp.z


tmp = translateM.multiplyPoint3d(centerTx)
tmp = scaleM.multiplyPoint3d(tmp)


translateM = Matrix.translation(0.5, 0.5, 0.0);
scaleM = Matrix.scale(0.5, 0.5, 1.0)


trW = tilePts.tPoints[]
scaleTexM = Matrix.scale(tile.bounds.width, tile.bounds.height, 1)


// Do it in the shader...

let [tilePts] = calc.blockingObjectsPoints.tiles
points = {
  tl: tilePts.points[0],
  tr: tilePts.points[1],
  br: tilePts.points[2],
  bl: tilePts.points[3]
}

points = {
  tl: tilePts.tPoints[0],
  tr: tilePts.tPoints[1],
  br: tilePts.tPoints[2],
  bl: tilePts.tPoints[3]
}


tileGeom = new QuadProjectionGeometry(points);

targetPoint = Point3d.fromTokenCenter(calc.target)
tileShader = TileProjectionShader.create(tile, {
  uMultiplier: 1000,
  uViewerPosition: [calc.viewerPoint.x, calc.viewerPoint.y, calc.viewerPoint.z],
  uTargetPosition: [targetPoint.x, targetPoint.y, targetPoint.z]
})
tilePlane = new PIXI.Mesh(tileGeom, tileShader)
canvas.stage.addChild(tilePlane)
canvas.stage.removeChild(tilePlane)


poly = new PIXI.Polygon(tilePts.tPoints.flatMap(pt => [pt.x, pt.y]))
Draw.shape(poly, { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.5})


poly = new PIXI.Polygon(tilePts.tPoints.flatMap(pt => {
  const ptT = tilePts.constructor.perspectiveTransform(pt, -1);
  return [ptT.x, ptT.y];
}))
Draw.shape(poly, { color: Draw.COLORS.red, fill: Draw.COLORS.red, fillAlpha: 0.2})

poly = new PIXI.Polygon(tilePts.tPoints.flatMap(pt => {
  const ptT = tilePts.constructor.perspectiveTransform(pt, -1000);
  return [ptT.x, ptT.y];
}))
Draw.shape(poly, { color: Draw.COLORS.red, fill: Draw.COLORS.red, fillAlpha: 0.2})




translationMatrix = tileShader.uniforms.translationMatrix;
projectionMatrix = tileShader.uniforms.globals.uniforms.projectionMatrix.toArray();

translationMatrix = Matrix.fromFlatArray(translationMatrix, 3, 3);
projectionMatrix = Matrix.fromFlatArray(projectionMatrix, 3, 3);

// 2d
projectionMatrix.multiplyPoint2d(translationMatrix.multiplyPoint2d(points.tl))

// 3d
ptMat = new Matrix([[points.tl.x], [points.tl.y], [points.tl.z]])
projectionMatrix.multiply(translationMatrix.multiply(ptMat))


// 3d alt
pt2d = new PIXI.Point()
pt2d.copyFrom(points.tl)
pt2d.multiplyScalar(1/points.tl.z, pt2d)

projectionMatrix.multiplyPoint2d(translationMatrix.multiplyPoint2d(pt2d))


// ------ NOTE: Full tile, tokens, wall implementation ----- //
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
api = game.modules.get("tokenvisibility").api;
Area3dLOS = api.Area3dLOS;
PixelCache = api.PixelCache
AlphaCutoffFilter = api.AlphaCutoffFilter

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;

calc = new Area3dLOS(viewer, target)
calc.percentVisible()

// Draw the target shape.
targetG = new PIXI.Graphics();
drawTool = new Draw(targetG);

// Set width = 0 to avoid drawing a border line. The border line will use antialiasing
// and that causes a lighter-color border to appear outside the shape.
calc.targetPoints.drawTransformed({ color: Draw.COLORS.red, width: 0, fill: Draw.COLORS.red, fillAlpha: 1, drawTool })

// Draw walls
blockingGraphics = new PIXI.Graphics();
drawTool = new Draw(blockingGraphics)
wallPts = calc.blockingPoints.walls;
wallPts.forEach(w => w.drawTransformed({ color: Draw.COLORS.blue, width: 0, fill: Draw.COLORS.blue, fillAlpha: 1, drawTool }));

// Draw token obstacles
tokens = calc.blockingPoints.tokens;
tokens.forEach(t => t.drawTransformed({ color: Draw.COLORS.blue, width: 0, fill: Draw.COLORS.blue, fillAlpha: 1, drawTool }));

// Draw terrain walls
// Use a separate container with an AlphaCutoffFilter.
// For an additive blend, can set each terrain to alpha 0.4. Any overlap will be over 0.5.
terrainGraphics = new PIXI.Graphics();
drawTool = new Draw(terrainGraphics);
terrainWallPts = calc.blockingPoints.terrainWalls;
terrainWallPts.forEach(w => w.drawTransformed({ color: Draw.COLORS.green, width: 0, fill: Draw.COLORS.green, fillAlpha: 0.4, drawTool }));
terrainFilter = new AlphaCutoffFilter(0.5);
terrainGraphics.filters = [terrainFilter];

// Draw tiles
// Each requires its own container.
tileContainer = new PIXI.Container();
tileFilter = new AlphaCutoffFilter(0.75);
Sprite2d = PIXI.projection.Sprite2d


for ( const tilePts of calc._blockingObjectsPoints.tiles ) {
  // TODO: Need to cutoff tiles at the z=0 point. And need to have the uv coordinates reflect this.
  // Any chance mapSprite will do this?
  const containerSprite = new Sprite2d(tilePts.object.texture);
  tileContainer.addChild(containerSprite);
  const perspectivePoints = tilePts.perspectiveTransform();
  containerSprite.proj.mapSprite(containerSprite, perspectivePoints);

  // Adjust the uvs points if the tile is cutoff behind the viewer.
  containerSprite.calculateVertices(); // Force uvs to be calculated.
  const tileUVs = tilePts.uvs;
  for ( let i = 0; i < 8; i += 1 ) containerSprite.uvs[i] = tileUVs[i];

  containerSprite.filters = [tileFilter];

  // Compare with full tile perspective
//   tilePts._transform(tilePts.M)
//   perspectivePoints2 = tilePts.perspectiveTransform({forceClockwise: false});
//   containerSprite.proj.mapSprite(containerSprite, perspectivePoints2);

  // This one might be correct...
//   perspectivePoints3 = tilePts.tPoints.map(pt => PlanePoints3d.perspectiveTransform(pt, -1000));
//   containerSprite.proj.mapSprite(containerSprite, perspectivePoints3);
}



// Draw everything. Need to first draw the red target token, then draw all the blue obstacles on top.
blockingContainer = new PIXI.Container();
blockingContainer.addChild(blockingGraphics);
blockingContainer.addChild(terrainGraphics);
blockingContainer.addChild(tileContainer);

// Translate the points to fit in the render texture.
txPtsArray = calc.targetPoints.faces.map(face => face.perspectiveTransform())
xValues = [];
yValues = [];
for ( const ptArray of txPtsArray ) {
  for ( const pt of ptArray ) {
    xValues.push(pt.x);
    yValues.push(pt.y);
  }
}
xMinMax = Math.minMax(...xValues);
yMinMax = Math.minMax(...yValues);

targetG.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
blockingContainer.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
blockingContainer.blendMode = PIXI.BLEND_MODES.DST_OUT; // Works: removes the red.

texConfig = {
  resolution: 1,
  width: xMinMax.max - xMinMax.min,
  height: yMinMax.max - yMinMax.min,
  scaleMode: PIXI.SCALE_MODES.NEAREST
}

rt =  PIXI.RenderTexture.create(texConfig);
canvas.app.renderer.render(targetG, { renderTexture: rt, clear: true });
cacheTarget = PixelCache.fromTexture(rt);
cacheTarget.pixels.reduce((acc, curr) => acc += Boolean(curr), 0)
sumTarget = cacheTarget.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);

canvas.app.renderer.render(wallsG, { renderTexture: rt, clear: false });
s = new PIXI.Sprite(rt)
canvas.stage.addChild(s)
canvas.stage.removeChild(s)

cacheBlocked = PixelCache.fromTexture(rt)
cacheBlocked.pixels.reduce((acc, curr) => acc += Boolean(curr), 0)
sumWithObstacles = cacheBlocked.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);

console.log(`Pixel percent visible: ${sumWithObstacles / sumTarget}; geometric percent visible: ${calc.percentVisible()}`)




Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
api = game.modules.get("tokenvisibility").api;
Area3dLOS = api.Area3dLOS;
PixelCache = api.PixelCache
AlphaCutoffFilter = api.AlphaCutoffFilter

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;

calc = new Area3dLOS(viewer, target)
calc.percentVisible()


function geomVisibility(viewer, target) {
  const calc = new Area3dLOS(viewer, target);
  return calc._percentVisibleGeometric();
}

function geomWebGL(viewer, target) {
  const calc = new Area3dLOS(viewer, target);
  return calc._percentVisibleWebGL();
}

function renderObstacles(calc) {
  const blockingContainer = new PIXI.Container();
  blockingContainer.addChild(calc.blockingGraphics);
  blockingContainer.addChild(calc.terrainGraphics);
  blockingContainer.addChild(calc.tileContainer);

  // Translate the points to fit in the render texture.
  const txPtsArray = calc.targetPoints.faces.map(face => face.perspectiveTransform());
  const xValues = [];
  const yValues = [];
  for ( const ptArray of txPtsArray ) {
    for ( const pt of ptArray ) {
      xValues.push(pt.x);
      yValues.push(pt.y);
    }
  }
  const xMinMax = Math.minMax(...xValues);
  const yMinMax = Math.minMax(...yValues);

  calc.targetGraphics.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
  blockingContainer.position = new PIXI.Point(-xMinMax.min, -yMinMax.min);
  blockingContainer.blendMode = PIXI.BLEND_MODES.DST_OUT; // Works: removes the red.

  const texConfig = {
    resolution: 1,
    width: xMinMax.max - xMinMax.min,
    height: yMinMax.max - yMinMax.min,
    scaleMode: PIXI.SCALE_MODES.NEAREST
  };
  const renderTexture = PIXI.RenderTexture.create(texConfig);

  // Render only the target shape and calculate its rendered visible area.
  canvas.app.renderer.render(calc.targetGraphics, { renderTexture, clear: true });

  // Render all the obstacles and calculate the remaining area.
  canvas.app.renderer.render(blockingContainer, { renderTexture, clear: false });

  renderTexture.destroy();
  blockingContainer.destroy();
}

// Takes 90 ms to count. 241 x 263 = 63383. Could get it smaller.
// Using 1/4 resolution for the pixel cache, it is down to 6.7 ms.
// And 2.5 ms total instead of 6 ms.
function countPixels(calc) {
  return calc.obstacleCache.pixels.reduce((acc, curr) => acc += Boolean(curr), 0);
}


QBenchmarkLoopFn = api.benchFunctions.QBenchmarkLoopFn

N = 100
await QBenchmarkLoopFn(N, geomVisibility, "geomVisibility", viewer, target);
await QBenchmarkLoopFn(N, geomWebGL, "geomWebGL", viewer, target);

calc = new Area3dLOS(viewer, target)
calc._percentVisibleWebGL()
await QBenchmarkLoopFn(N, renderObstacles, "renderObstacles", calc);
await QBenchmarkLoopFn(N, countPixels, "countPixels", calc);





