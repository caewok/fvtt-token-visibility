Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d;
Matrix = CONFIG.GeometryLib.Matrix;
let { mat4, vec3, vec4 } = glMatrix;

class TokenGeometry extends PIXI.Geometry {
  /** @type {Token} */
  token;

  constructor(token) {
    super();
    this.token = token;
    this.initializeVertices();
    this.initializeColors(); // For debugging.
    this.initializeIndices();
  }

  initializeVertices() {
    this.addAttribute("aVertex", new Float32Array(24));
    this.updateVertices();
  }

  initializeColors() {
    // Color each vertex.
    // Ignore alpha; let the shader set it.
    const aColors = [
      // Top: Shades of orange
      1.0, 0.00, 0.0,
      1.0, 0.25, 0.0,
      1.0, 0.75, 0.0,
      1.0, 1.00, 0.0,

      // Bottom: Shades of blue
      0.0, 0.00, 1.0,
      0.0, 0.25, 1.0,
      0.0, 0.75, 1.0,
      0.0, 1.00, 1.0,
    ];
    this.addAttribute("aColor", aColors, 3);
  }

  /**
   * Indices to draw two triangles per face.
   * Top, bottom, sides 0 through 3.
   */
  initializeIndices() {
    /*
     TL: 0, 4
     TR: 1, 5
     BR: 2, 6,
     BL: 3, 7

      TL --- TR
      |      |
      |      |
      BL --- BR
    */
    const indices = [
      // Top
      0, 1, 2, // TL - TR - BR
      0, 2, 3, // TL - BR - BL

      // Bottom
      4, 7, 6, // TL - BL - BR
      4, 6, 5, // TL - BR - TR

      // Sides (from top)
      0, 3, 7, // TL (top) - BL (top) - BL (bottom)
      0, 7, 4, // TL (top) - BL (bottom) - TL (bottom)

      1, 0, 4, // TR (top) - TL (top) - TL (bottom)
      1, 4, 5, // TR (top) - TL (bottom) - TR (bottom)

      2, 1, 5, // BR (top) - TR (top) - TR (bottom)
      2, 5, 6, // BR (top) - TR (bottom) - BR (bottom)

      3, 2, 6, // BL (top) - BR (top) - BR (bottom)
      3, 6, 7, // BL (top) - BR (bottom) - BL (bottom)
    ];
    this.addIndex(indices);
  }

  updateVertices() {
    const tokenPts = this.constructor.cubePoints(this.token);
    const tokenVertices = tokenPts.map(pt => vec3.fromValues(pt.x, pt.y, pt.z));
    const buffer = this.getBuffer("aVertex");
    const data = buffer.data;
    data.set(tokenVertices[0], 0);
    data.set(tokenVertices[1], 3);
    data.set(tokenVertices[2], 6);
    data.set(tokenVertices[3], 9);
    data.set(tokenVertices[4], 12);
    data.set(tokenVertices[5], 15);
    data.set(tokenVertices[6], 18);
    data.set(tokenVertices[7], 21);
    buffer.update(data);
  }

  static cubePoints(token) {
    const centerPts = Point3d.fromToken(token);
    const { width, height } = token.document;
    const w = width * canvas.dimensions.size;
    const h = height * canvas.dimensions.size;
    const w_1_2 = w * 0.5;
    const h_1_2 = h * 0.5;

    return [
      centerPts.top.add(new Point3d(-w_1_2, -h_1_2, 0)),
      centerPts.top.add(new Point3d(w_1_2, -h_1_2, 0)),
      centerPts.top.add(new Point3d(w_1_2, h_1_2, 0)),
      centerPts.top.add(new Point3d(-w_1_2, h_1_2, 0)),

      centerPts.bottom.add(new Point3d(-w_1_2, -h_1_2, 0)),
      centerPts.bottom.add(new Point3d(w_1_2, -h_1_2, 0)),
      centerPts.bottom.add(new Point3d(w_1_2, h_1_2, 0)),
      centerPts.bottom.add(new Point3d(-w_1_2, h_1_2, 0)),
    ];
  }
}

class WallGeometry extends PIXI.Geometry {
  /** @type {Wall} */
  wall;

  constructor(wall) {
    super();
    this.wall = wall;
    this.initializeVertices();
    this.initializeColors(); // For debugging.
    this.initializeIndices();
  }

  initializeVertices() {
    this.addAttribute("aVertex", new Float32Array(12));
    this.updateVertices();
  }

  updateVertices() {
    const wallPts = Point3d.fromWall(this.wall, { finite: true });
    const wallVertices = [
      vec3.fromValues(wallPts.A.top.x, wallPts.A.top.y, wallPts.A.top.z),
      vec3.fromValues(wallPts.B.top.x, wallPts.B.top.y, wallPts.B.top.z),
      vec3.fromValues(wallPts.B.bottom.x, wallPts.B.bottom.y, wallPts.B.bottom.z),
      vec3.fromValues(wallPts.A.bottom.x, wallPts.A.bottom.y, wallPts.A.bottom.z),
    ];

    const buffer = this.getBuffer("aVertex");
    const data = buffer.data;
    // wallVertices.forEach((v, idx) => data.set(v, idx * 4));
    data.set(wallVertices[0], 0);
    data.set(wallVertices[1], 3);
    data.set(wallVertices[2], 6);
    data.set(wallVertices[3], 9);
    buffer.update(data);
  }

  initializeColors() {
    // Color each vertex.
    // Ignore alpha; let the shader set it.
    const aColors = [
      // Top: Shades of orange
      1.0, 0.00, 0.0,
      1.0, 0.25, 0.0,
      1.0, 0.75, 0.0,
      1.0, 1.00, 0.0,
    ];
    this.addAttribute("aColor", aColors, 3);
  }

  /**
   * Indices to draw two triangles per face.
   * Top, bottom, sides 0 through 3.
   */
  initializeIndices() {
    /*
     TL: 0
     TR: 1
     BR: 2
     BL: 3

      TL --- TR
      |      |
      |      |
      BL --- BR
    */
    const indices = [
      // Top
      0, 1, 2, // TL - TR - BR
      0, 2, 3, // TL - BR - BL

      // Bottom
      0, 3, 2, // TL - BL - BR
      0, 2, 1, // TL - BR - TR
    ];
    this.addIndex(indices);
  }
}


class Placeable3dShader extends AbstractEVShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec3 aColor;

out vec4 vColor;
uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;
uniform mat4 uOffsetMatrix;

void main() {
  vColor = vec4(aColor, 1.0);
  vec4 cameraPosition = uLookAtMatrix * vec4(aVertex, 1.0);
  gl_Position = uOffsetMatrix * uPerspectiveMatrix * cameraPosition;
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec4 vColor;
out vec4 fragColor;

void main() {
  fragColor = vColor;
}`;

  static defaultUniforms = {
    uPerspectiveMatrix: mat4.create(),
    uLookAtMatrix: mat4.create(),
    uOffsetMatrix: mat4.create()
  };

  static create(viewerPt, targetPt, defaultUniforms = {}) {
    const res = super.create(defaultUniforms);
    res._initializeLookAtMatrix(viewerPt, targetPt);
    res._calculatePerspectiveMatrix();
    return res;
  }


  // ----- Perspective Matrix ----- //

  #fovy = Math.toRadians(90);

  #aspect = 1;

  #near = 0.1;

  #far = 1000;

  set fovy(value) {
    this.#fovy = value;
    this._calculatePerspectiveMatrix();
  }

  set aspect(value) {
    this.#fovy = value;
    this._calculatePerspectiveMatrix();
  }

  set near(value) {
    this.#near = value;
    this._calculatePerspectiveMatrix();
  }

  set far(value) {
    this.#far = value;
    this._calculatePerspectiveMatrix();
  }

  _initializePerspectiveMatrix(fovy, aspect, near, far) {
    this.#fovy = fovy;
    this.#aspect = aspect;
    this.#near = near;
    this.#far = far;
    this._calculatePerspectiveMatrix();
  }

  _calculatePerspectiveMatrix() {
    mat4.perspective(this.uniforms.uPerspectiveMatrix, this.#fovy, this.#aspect, this.#near, this.#far);
  }

  // ----- LookAt Matrix ----- //
  #eye = vec3.create();

  #center = vec3.create();

  #up = vec3.fromValues(0, 0, 1);

  set eye(value) {
    vec3.set(this.#eye, value.x, value.y, value.z);
    this._calculateLookAtMatrix();
  }

  set center(value) {
    vec3.set(this.#center, value.x, value.y, value.z);
    this._calculateLookAtMatrix();
  }

  set up(value) {
    vec3.set(this.#up, value.x, value.y, value.z);
    this._calculateLookAtMatrix();
  }

  _initializeLookAtMatrix(viewerPt, targetPt) {
    vec3.set(this.#eye, viewerPt.x, viewerPt.y, viewerPt.z);
    vec3.set(this.#center, targetPt.x, targetPt.y, targetPt.z);
    this._calculateLookAtMatrix();
  }

  _calculateLookAtMatrix() {
    mat4.lookAt(this.uniforms.uLookAtMatrix, this.#eye, this.#center, this.#up);
  }
}



viewer = _token
let [target] = game.user.targets;

viewerPt = Point3d.fromTokenCenter(viewer);
targetPt = Point3d.fromTokenCenter(target);

shader = Placeable3dShader.create(viewerPt, targetPt);
mat4.fromScaling(shader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
shader.aspect = window.outerWidth / window.outerHeight;

geomTarget = new TokenGeometry(target);
meshTarget = new PIXI.Mesh(geomTarget, shader)

walls = canvas.walls.placeables;
geomWall0 = new WallGeometry(walls[0]);
meshWall0 = new PIXI.Mesh(geomWall0, shader);

geomWall1 = new WallGeometry(walls[1]);
meshWall1 = new PIXI.Mesh(geomWall1, shader);

geomWall2 = new WallGeometry(walls[2]);
meshWall2 = new PIXI.Mesh(geomWall2, shader);

canvas.stage.addChild(meshTarget)
canvas.stage.addChild(meshWall0)
canvas.stage.addChild(meshWall1)
canvas.stage.addChild(meshWall2)

canvas.stage.removeChild(meshTarget)
canvas.stage.removeChild(meshWall0)
canvas.stage.removeChild(meshWall1)
canvas.stage.removeChild(meshWall2)


meshTarget.state.depthTest = true
meshWall0.state.depthTest = true
meshWall1.state.depthTest = true
meshWall2.state.depthTest = true

api = game.modules.get("tokenvisibility").api
QBenchmarkLoopFn = api.benchFunctions.QBenchmarkLoopFn

function geometryCreation(wall) {
  const res = new WallGeometry(wall);
  res.destroy();
}

function meshCreation(geom, shader) {
  const res = new PIXI.Mesh(geom, shader);
  res.destroy();
}

function shaderCreation(viewerPt, targetPt) {
  const res = Placeable3dShader.create(viewerPt, targetPt);
  res.destroy();
}

N = 10000
await QBenchmarkLoopFn(N, geometryCreation, "geometryCreation", walls[0]);
await QBenchmarkLoopFn(N, geometryCreation, "geometryCreation", walls[1]);
await QBenchmarkLoopFn(N, geometryCreation, "geometryCreation", walls[2]);
await QBenchmarkLoopFn(N, meshCreation, "meshCreation", geomWall0, meshWall0);
await QBenchmarkLoopFn(N, shaderCreation, "shaderCreation", viewerPt, targetPt);



// NOTE: Test using the Placeable3dGeometry and Placeable3dShader
Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d;
Matrix = CONFIG.GeometryLib.Matrix;
let { mat4, vec3, vec4 } = glMatrix;

api = game.modules.get("tokenvisibility").api
Placeable3dShader = api.Placeable3dShader
Tile3dShader = api.Tile3dShader
Area3d = api.Area3d

// Use Area3d to determine blocking obstacles
viewer = canvas.tokens.controlled[0]
let [target] = game.user.targets;

calc = new Area3d(viewer, target)
calc.percentVisible()

// Switch to array just for debugging
blockingWalls = [...calc.blockingObjects.walls];

/* Determine frustrum size
Forms isosceles triangle.
   ø     Where ø is the fov.
  /\
 /  \
/A   \
------
Angle at A is 90 - (ø * 0.5).
If length of near is 1, then
half the base is a / tan(A)
*/

function frustrumBase(fov, dist) {
  const A = 90 - (fov * 0.5);
  return (dist / Math.tan(Math.toRadians(A))) * 2;
}

// We want the target token to be within the viewable frustrum.
// Use the full token shape, not constrained shape, so that the angle captures the whole token.
boundaryPts = target.bounds.viewablePoints(viewer.center);

// Angle is between the two segments from the origin.
center = new PIXI.Point(viewer.center.x, viewer.center.y)
angleRad = PIXI.Point.angleBetween(boundaryPts[0], center, boundaryPts[1])

// Near distance has to be close to the viewer.
// We can assume we don't want to view anything within 1/2 grid unit?
near = canvas.dimensions.size * 0.5;

// Far distance is distance to the center of the target plus 1/2 the diagonal.
let { w, h } = target
diagDist = Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2)) * 0.5
dist = Point3d.distanceBetween(Point3d.fromTokenCenter(viewer), Point3d.fromTokenCenter(target)) + diagDist;
far = Math.ceil(dist)

// Create the shaders, 1 for the target and 1 for the walls.
// Add a buffer in the fov so we capture the entire token.
targetShader = Placeable3dShader.create(Point3d.fromTokenCenter(viewer), Point3d.fromTokenCenter(target))
targetShader._initializePerspectiveMatrix(angleRad + Math.toRadians(1), 1, near, far)
targetShader.uniforms.uPerspectiveMatrix = targetShader.uniforms.uPerspectiveMatrix


mat4.fromScaling(targetShader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
targetShader.setColor(1, 0, 0, 1);

// For debugging, adjust aspect ratio
targetShader.aspect = window.outerWidth / window.outerHeight;


wallShader = Placeable3dShader.create(Point3d.fromTokenCenter(viewer), Point3d.fromTokenCenter(target));
wallShader._initializePerspectiveMatrix(angleRad + Math.toRadians(1), 1, near, far)
wallShader.uniforms.uPerspectiveMatrix = wallShader.uniforms.uPerspectiveMatrix

mat4.fromScaling(wallShader.uniforms.uOffsetMatrix, [-1, 1, 1]); // Mirror along the y axis
wallShader.aspect = window.outerWidth / window.outerHeight;

// Draw the target and walls
buildMesh = (obj, shader) => {
  const mesh = new PIXI.Mesh(obj.tokenvisibility.geometry, shader);
  mesh.state.depthTest = true;
  mesh.state.culling = true;
  mesh.state.clockwiseFrontFace = true;
  return mesh;
}

targetMesh = buildMesh(target, targetShader);
canvas.stage.addChild(targetMesh)
canvas.stage.removeChild(targetMesh)

// Draw each wall
wallMeshes = blockingWalls.map(wall => buildMesh(wall, wallShader))
wallMeshes.forEach(wallMesh => canvas.stage.addChild(wallMesh));
wallMeshes.forEach(wallMesh => canvas.stage.removeChild(wallMesh));


// ----- NOTE: Test using Area3d
Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d;

api = game.modules.get("tokenvisibility").api
QBenchmarkLoopFn = api.benchFunctions.QBenchmarkLoopFn

AREA3D_POPOUTS = api.AREA3D_POPOUTS
DefaultLOS = api.AlternativeLOS
PointsLOS = api.PointsLOS
Area2dLOS = api.Area2dLOS
Area3dLOSGeometric = api.Area3dLOSGeometric
Area3dLOSWebGL = api.Area3dLOSWebGL
Area3dLOSWebGL2 = api.Area3dLOSWebGL2



viewer = canvas.tokens.controlled[0]
let [target] = game.user.targets;

calcDefault = new DefaultLOS(viewer, target, { largeTarget: false })
calcPoints = new PointsLOS(viewer, target, { largeTarget: false })
calcArea2d = new Area2dLOS(viewer, target, { largeTarget: false })
calcArea3dGeometric = new Area3dLOSGeometric(viewer, target, { largeTarget: false })
calcArea3dWebGL1 = new Area3dLOSWebGL(viewer, target, { largeTarget: false })
calcArea3dWebGL2 = new Area3dLOSWebGL2(viewer, target, { largeTarget: false })

percentVisibleDefault = calcDefault.percentVisible();
percentVisiblePoints = calcPoints.percentVisible();
percentVisibleArea2d = calcArea2d.percentVisible();
percentVisibleArea3dGeometric = calcArea3dGeometric.percentVisible();
percentVisibleArea3dWebGL1 = calcArea3dWebGL1.percentVisible();
percentVisibleArea3dWebGL2 = calcArea3dWebGL2.percentVisible();

console.table({
  percentVisibleDefault,
  percentVisiblePoints,
  percentVisibleArea2d,
  percentVisibleArea3dGeometric,
  percentVisibleArea3dWebGL1,
  percentVisibleArea3dWebGL2
});


losCalc = api.losCalculator;


calcDefault._drawCanvasDebug()
calcDefault._clearCanvasDebug();

calcPoints._drawCanvasDebug()
calcArea2d._drawCanvasDebug()


await calcArea3dGeometric._enableDebugPopout()
calcArea3dGeometric._draw3dDebug()

await calcArea3dWebGL1._enableDebugPopout()
calcArea3dWebGL1._draw3dDebug()

await calcArea3dWebGL2._enableDebugPopout()
calcArea3dWebGL2._draw3dDebug()
calcArea3dWebGL2.config.useDebugShaders = true


calc = new Area3d(viewer, target, { algorithm: "webGL2", largeTarget: false })
calc.percentVisible();

calc.config.algorithm = "webGL";
calc.percentVisible();

calc.config.algorithm = "geometric";
calc.percentVisible();

calc.debug = true

calc._percentVisibleGeometric();
calc._percentVisibleWebGL();
calc._percentVisibleWebGL2();


stage = AREA3D_POPOUTS.webGL2.app.pixiApp.stage
s = new PIXI.Sprite(calc.renderTexture);
s = PIXI.Sprite.from(calc.renderTexture)
stage.addChild(s); // Does not display or is not rendered on screen
stage.removeChild(s);
canvas.stage.addChild(s); // But does display on canvas

[tile] = canvas.tiles.placeables;
sTile = new PIXI.Sprite(tile)
stage.addChild(sTile)


// NOTE: Timing
defaultBenchFn = function(viewer, target) {
  const calc = new DefaultLOS(viewer, target, { largeTarget: false })
  return calc.percentVisible();
}

pointsBenchFn = function(viewer, target) {
  const calc = new PointsLOS(viewer, target, { largeTarget: false })
  return calc.percentVisible();
}

area2dBenchFn = function(viewer, target) {
  const calc = new Area2dLOS(viewer, target, { largeTarget: false })
  return calc.percentVisible();
}

geometricBenchFn = function(viewer, target) {
  const calc = new Area3dLOSGeometric(viewer, target, { largeTarget: false })
  return calc.percentVisible();
}

webGLBenchFn = function(viewer, target) {
  const calc = new Area3dLOSWebGL(viewer, target, { largeTarget: false })
  const res = calc.percentVisible();
  calc.destroy();
  return res;
}

webGL2BenchFn = function(viewer, target) {
  const calc = new Area3dLOSWebGL2(viewer, target, { largeTarget: false })
  const res = calc.percentVisible();
  calc.destroy();
  return res;
}

calcWebGL1 = new Area3dLOSWebGL(viewer, target, { largeTarget: false });
webGLBenchFn2 = function(viewer, target) {
  return calcWebGL1.percentVisible();
}

calcWebGL2 = new Area3dLOSWebGL2(viewer, target, { largeTarget: false })
webGL2BenchFn2 = function(viewer, target) {
  return calcWebGL2.percentVisible();
}

// Full resolution
calcWebGL1.renderTexture.setResolution(1)
calcWebGL2._renderTexture.setResolution(1);

viewer = canvas.tokens.controlled[0]
let [target] = game.user.targets;
calcWebGL1 = new Area3dLOSWebGL(viewer, target, { largeTarget: false });
calcWebGL2 = new Area3dLOSWebGL2(viewer, target, { largeTarget: false })

N = 1000
await QBenchmarkLoopFn(N, defaultBenchFn, "default", viewer, target);
await QBenchmarkLoopFn(N, pointsBenchFn, "points", viewer, target);
await QBenchmarkLoopFn(N, area2dBenchFn, "area2d", viewer, target);
await QBenchmarkLoopFn(N, geometricBenchFn, "geometric", viewer, target);
await QBenchmarkLoopFn(N, webGLBenchFn, "webGL", viewer, target);
await QBenchmarkLoopFn(N, webGLBenchFn2, "webGL single", viewer, target);
await QBenchmarkLoopFn(N, webGL2BenchFn, "webGL2", viewer, target);
await QBenchmarkLoopFn(N, webGL2BenchFn2, "webGL2 single", viewer, target);

// Half resolution
calcWebGL1.renderTexture.setResolution(0.5)
calcWebGL2._renderTexture.setResolution(0.5);
await QBenchmarkLoopFn(N, webGLBenchFn2, "webGL single", viewer, target);
await QBenchmarkLoopFn(N, webGL2BenchFn2, "webGL2 single", viewer, target);

// Quarter resolution
calcWebGL1.renderTexture.setResolution(0.25)
calcWebGL2._renderTexture.setResolution(0.25);


// NOTE: Peformance measures
measures = [
  "startWebGL2",
  "targetMesh",
  "obstacleMesh",
  "renderTargetMesh",
  "targetCache",
  "renderObstacleMesh",
  "obstacleCache",
  "endWebGL2"
];
total = performance.measure("total", measures[0], measures.at(-1))

res = {};
for ( let i = 0; i < measures.length - 1; i += 1 ) {
  startName = measures[i];
  endName = measures[i + 1];
  res[startName] = performance.measure(startName, startName, endName);
}
res.total = total.duration;
console.table(res)


// ------ NOTE: Testing WebGL2

Matrix = CONFIG.GeometryLib.Matrix
Draw = CONFIG.GeometryLib.Draw
AREA3D_POPOUTS = api.AREA3D_POPOUTS
PixelCache = api.PixelCache;
extractPixels = api.extractPixels
calc = calcArea3dWebGL2
calc.config.useDebugShaders = true;

percentVisible = calc._simpleVisibilityTest();
if ( typeof percentVisible !== "undefined" ) console.log(percentVisible);

obstacleContainer = calc._obstacleContainer
renderTexture = calc._renderTexture
shaders = calc.debugShaders;


target = calc.target;
blockingObjects = calc.blockingObjects;
let { near, far, fov, frame } = calc.frustrum;
renderTexture.resize(frame.width, frame.height, true);

// Create shaders, mesh, draw to texture.
// TODO: Store and update shaders instead of creating.
renderTexture.resize(frame.width, frame.height, true);
buildMesh = calc.constructor.buildMesh;

// canvas.stage.addChild(meshContainer)


// 1 for the target, in red
// aspect = window.outerWidth / window.innerHeight
targetShader = shaders.target;
targetShader.uniforms.uOffsetMatrix = mat4.create()
targetShader._initializePerspectiveMatrix(fov, 1, near, far);
targetMesh = buildMesh(target, targetShader);

// targetShader._initializePerspectiveMatrix(fov, 1, -.1, -2000);
// meshContainer.addChild(targetMesh);
// canvas.stage.addChild(targetMesh)

/* Debug transformations
let { vec3, vec4, mat4 } = glMatrix

Matrix.lookAt(Point3d.fromTokenCenter(calc.viewer), Point3d.fromTokenCenter(calc.target), new Point3d(0, 0, 1))
targetShader.uniforms.uLookAtMatrix


aTextureCoords = []
aVertexData = targetMesh.geometry.getBuffer("aVertex").data
// for ( let i = 2; i < aVertexData.length; i += 3 ) {
//   aVertexData[i] *= -1
// }

for ( let i = 0; i < aVertexData.length; i += 3 ) {
  aTextureCoords.push(aVertexData.subarray(i, i + 3))
}

cameraPositions = [];
// uLookAtMatrix = targetMesh.shader.uniforms.uLookAtMatrix
uLookAtMatrix = mat4.create();
mat4.lookAt(uLookAtMatrix, targetShader.eye, targetShader.center, targetShader.up);


for ( let i = 0; i < aTextureCoords.length; i += 1 ) {
  const aTextureCoord = aTextureCoords[i];
  const v4 = vec4.fromValues(aTextureCoord[0], aTextureCoord[1], aTextureCoord[2], 1);
  const cameraPosition = vec4.create();
  vec4.transformMat4(cameraPosition, v4, uLookAtMatrix);
  cameraPositions.push(cameraPosition);
}

// Convert to points and draw
cameraPoints = cameraPositions.map(arr => new Point3d(arr[0], arr[1], arr[2]))
indices = targetMesh.geometry.indexBuffer.data
for ( let i = 0; i < indices.length; i += 3 ) {
  const a = indices[i];
  const b = indices[i + 1];
  const c = indices[i + 2]
  Draw.connectPoints([cameraPoints[a], cameraPoints[b], cameraPoints[c]])
}


uPerspectiveMatrix = targetMesh.shader.uniforms.uPerspectiveMatrix
glPositions = [];
for ( let i = 0; i < cameraPositions.length; i += 1 ) {
  const cameraPosition = cameraPositions[i];
  const glPosition = vec4.create();
  vec4.transformMat4(glPosition, cameraPosition, uPerspectiveMatrix);
  glPositions.push(glPosition);
}


// Divide by w, convert by points, draw
glPoints = glPositions.map(arr => new Point3d(arr[0] / arr[3], arr[1] / arr[3], arr[2] / arr[3]))
indices = targetMesh.geometry.indexBuffer.data

xMinMax = Math.minMax(...glPoints.map(pt => pt.x))
yMinMax = Math.minMax(...glPoints.map(pt => pt.y))

trMat = Matrix.translation(-xMinMax.min * 100, -yMinMax.min * 100, 0);
scaleMat = Matrix.scale(100, 100, 1);

for ( let i = 0; i < indices.length; i += 3 ) {
  const a = indices[i];
  const b = indices[i + 1];
  const c = indices[i + 2]

  const pt0 = trMat.multiplyPoint3d(scaleMat.multiplyPoint3d(glPoints[a]))
  const pt1 = trMat.multiplyPoint3d(scaleMat.multiplyPoint3d(glPoints[b]))
  const pt2 = trMat.multiplyPoint3d(scaleMat.multiplyPoint3d(glPoints[c]))

  Draw.connectPoints([pt0, pt1, pt2])
}
*/




// TODO: Fix garbage handling; destroy the shaders and meshes.

// 1 for the terrain walls
if ( blockingObjects.terrainWalls.size ) {
  // Can we set alpha to 0.5 and add overlapping walls to get to 1.0 blue?
  // Or multiply, so 0.7 * 0.7 = 0.49?
  // Or set to green and then process with pixel cache?
  // Then process the pixel cache to ignore blue alpha?
  // For the moment, draw with blue alpha
  const terrainWallShader = calc._terrainWallShader;
  terrainWallShader._initializePerspectiveMatrix(fov, 1, near, far);
  for ( terrainWall of blockingObjects.terrainWalls ) {
    const mesh = buildMesh(terrainWall, terrainWallShader);
    obstacleContainer.addChild(mesh);
  }
}

// 1 for the walls/tokens, in blue
otherBlocking = blockingObjects.walls.union(blockingObjects.tokens);
if ( otherBlocking.size ) {
  const obstacleShader = calc._obstacleShader;
  obstacleShader._initializePerspectiveMatrix(fov, 1, near, far);
  for ( obj of otherBlocking ) {
    const mesh = buildMesh(obj, wallShader);
    obstacleContainer.addChild(mesh);
  }
}

// 1 for the tiles
if ( blockingObjects.tiles.size ) {
  for ( tile of blockingObjects.tiles ) {
    const tileShader = calc._buildTileShader(fov, near, far, tile);
    const mesh = buildMesh(tile, tileShader);
    obstacleContainer.addChild(mesh);
  }
}

sumRedPixels = function(targetCache) {
  const pixels = targetCache.pixels;
  const nPixels = pixels.length;
  let sumTarget = 0;
  for ( let i = 0; i < nPixels; i += 4 ) sumTarget += Boolean(targetCache.pixels[i]);
  return sumTarget;
};


// NOTE Test Calculate area remaining.
// TODO: Handle terrain walls.
canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });
targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);
sumTarget = sumRedPixels(targetCache);

canvas.app.renderer.render(obstacleContainer, { renderTexture, clear: false });
obstacleCache = canvas.app.renderer.extract._rawPixels(renderTexture);
sumWithObstacles = sumRedPixels(obstacleCache);

sumWithObstacles / sumTarget;

children = obstacleContainer.removeChildren();
children.forEach(c => c.destroy());


// Unique pixels
s = new Map();
pixels = obstacleCache.pixels
RED = 256 * 256 * 256;
GREEN = 256 * 256
BLUE = 256
for ( let i = 0; i < pixels.length; i += 4 ) {
  const r = pixels[i];
  const g = pixels[i+1];
  const b = pixels[i+2];
  const a = pixels[i+3];
  const idx = r * RED + g * GREEN + b * BLUE + a;
  if ( s.has(idx) ) continue;
  s.set(idx, { r, g, b, a });
}






// Test speed for getting pixel extraction

texConfig = {
  resolution: 0.25,
  width: calc.frustrum.frame.width,
  height: calc.frustrum.frame.height,
  scaleMode: PIXI.SCALE_MODES.NEAREST,
  multisample: PIXI.MSAA_QUALITY.NONE,
  alphaMode: PIXI.NO_PREMULTIPLIED_ALPHA
}

texConfig = {
  resolution: 0.25,
  width: calc.frustrum.frame.width,
  height: calc.frustrum.frame.height,
  scaleMode: PIXI.SCALE_MODES.NEAREST,
  multisample: PIXI.MSAA_QUALITY.NONE,
  alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA,
  format: PIXI.FORMATS.RED
}

tmpRT = PIXI.RenderTexture.create(texConfig);

useTempRTfn = function() {
  canvas.app.renderer.render(targetMesh, { renderTexture: tmpRT, clear: true });
  return canvas.app.renderer.extract.pixels(tmpRT);
}

useNewRTfn = function() {
  const renderTexture = PIXI.RenderTexture.create(texConfig);
  canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });
  const pixels = canvas.app.renderer.extract.pixels(renderTexture);
  renderTexture.destroy();
  return pixels;
}

useExtractFn = function() {
  return canvas.app.renderer.extract.pixels(targetMesh);
}

useExtractFn2 = function() {
  return canvas.app.renderer.extract.pixels(targetMesh, calc.frustrum.frame);
}

// Format RED: same speed.

N = 1000
await QBenchmarkLoopFn(N, useTempRTfn, "useTempRTfn");    // 0.51 ms  // 0.25 resolution: 0.39 ms
await QBenchmarkLoopFn(N, useNewRTfn, "useNewRTfn");      // 0.68 ms  // 0.25 resolution: 0.50 ms

N = 100
await QBenchmarkLoopFn(N, useExtractFn, "useExtractFn");  // 21.93 ms
await QBenchmarkLoopFn(N, useExtractFn, "useExtractFn2"); // 21.93 ms


// Speed of different RT extractions

function renderExtractFn() {
  canvas.app.renderer.render(targetMesh, { renderTexture: tmpRT, clear: true });
  return canvas.app.renderer.extract.pixels(tmpRT);
}

function renderPixelsExtractFn() {
  canvas.app.renderer.render(targetMesh, { renderTexture: tmpRT, clear: true });
  return canvas.app.renderer.extract._rawPixels(tmpRT);
}

function pixelCacheFn() {
  canvas.app.renderer.render(targetMesh, { renderTexture: tmpRT, clear: true });
  return PixelCache.fromTexture(tmpRT,
      { resolution: CACHE_RESOLUTION, channel: 0 });
}

TE = new TextureExtractor(canvas.app.renderer)
pixels = await TE.extract({ texture: tmpRT }) // Only the red channel

async function foundryExtract() {
  return TE.extract({ texture: tmpRT });
}

// basically same for red texture
N = 1000
await QBenchmarkLoopFn(N, renderExtractFn, "renderExtractFn");              // 0.39 ms
await QBenchmarkLoopFn(N, renderPixelsExtractFn, "renderPixelsExtractFn");  // 0.36 ms
await QBenchmarkLoopFn(N, pixelCacheFn, "pixelCacheFn");                    // 0.36 ms

N = 100
await QBenchmarkLoopFn(N, foundryExtract, "foundryExtract");                // 92 ms; RED: 79 ms



// NOTE: Test webGL1

AlphaCutoffFilter = api.AlphaCutoffFilter
AREA3D_POPOUTS = api.AREA3D_POPOUTS
PixelCache = api.PixelCache;
extractPixels = api.extractPixels
calc = calcArea3dWebGL1

percentVisible = calc._simpleVisibilityTest();
if ( typeof percentVisible !== "undefined" ) console.log(percentVisible);

if ( !calc.viewIsSet ) calc.calculateViewMatrix();
TARGET_COLOR = Draw.COLORS.red;
OBSTACLE_COLOR = Draw.COLORS.blue;
blockingPoints = calc.blockingPoints;
renderer = calc.renderer;

// Set width = 0 to avoid drawing a border line. The border line will use antialiasing
// and that causes a lighter-color border to appear outside the shape.
drawOpts = {
  color: TARGET_COLOR,
  width: 0,
  fill: TARGET_COLOR,
  fillAlpha: 1,
  drawTool: undefined
};

blockingContainer = calc.blockingContainer;
targetGraphics = calc.targetGraphics;

// Draw the target shape.
targetGraphics = calc.targetGraphics;
drawOpts.drawTool = new Draw(targetGraphics);
calc.targetPoints.drawTransformed(drawOpts);

// Draw walls and other tokens.
if ( blockingPoints.walls.length || blockingPoints.tokens.length ) {
  const blockingGraphics = calc.blockingGraphics;
  blockingGraphics.clear();
  blockingContainer.addChild(blockingGraphics);
  drawOpts.drawTool = new Draw(blockingGraphics);
  drawOpts.color = OBSTACLE_COLOR;
  drawOpts.fill = OBSTACLE_COLOR;

  // Draw wall obstacles, if any
  blockingPoints.walls.forEach(w => w.drawTransformed(drawOpts));

  // Draw token obstacles, if any
  blockingPoints.tokens.forEach(t => t.drawTransformed(drawOpts));
}

// Draw terrain walls.
// Use a separate container with an AlphaCutoffFilter.
// For an additive blend, can set each terrain to alpha 0.4. Any overlap will be over 0.5.
if ( blockingPoints.terrainWalls.length ) {
  const terrainGraphics = calc.terrainGraphics;
  terrainGraphics.clear();
  blockingContainer.addChild(terrainGraphics);
  drawOpts.drawTool = new Draw(terrainGraphics);
  drawOpts.color = OBSTACLE_COLOR;
  drawOpts.fill = OBSTACLE_COLOR;
  drawOpts.fillAlpha = 0.5;
  blockingPoints.terrainWalls.forEach(w => w.drawTransformed(drawOpts));
}

// Draw tiles.
// Each requires its own container.
tileContainer = calc.tileContainer;
tileFilter = new AlphaCutoffFilter(0.75);
Sprite2d = PIXI.projection.Sprite2d;

// TODO: Does _blockingObjectsPoints work for tiles under a target token?
for ( const tilePts of calc.blockingObjectsPoints.tiles ) {
  blockingContainer.addChild(tileContainer);
  // TODO: Need to cutoff tiles at the z=0 point. And need to have the uv coordinates reflect this.
  // Any chance mapSprite will do this?
  const containerSprite = new Sprite2d(tilePts.object.texture);
  containerSprite.filters = [tileFilter];
  tileContainer.addChild(containerSprite);
  const perspectivePoints = tilePts.perspectiveTransform();
  containerSprite.proj.mapSprite(containerSprite, perspectivePoints);

  // Adjust the uvs points if the tile is cutoff behind the viewer.
  containerSprite.calculateVertices(); // Force uvs to be calculated.
  const tileUVs = tilePts.uvs;
  for ( let i = 0; i < 8; i += 1 ) containerSprite.uvs[i] = tileUVs[i];
}

// Translate the points to fit in the render texture.
txPtsArray = calc.targetPoints.faces.map(face => face.perspectiveTransform());
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
rtWidth = xMinMax.max - xMinMax.min;
rtHeight = yMinMax.max - yMinMax.min;
debug = false
if ( debug ) {
  rtWidth = Math.max(rtWidth, 400);
  rtHeight = Math.max(rtHeight, 400);
}

// Center everything.
renderTexture = calc.renderTexture;
renderTexture.resize(rtWidth, rtHeight, true);
targetGraphics.position = new PIXI.Point(rtWidth * 0.5, rtHeight * 0.5)
blockingContainer.position = new PIXI.Point(rtWidth * 0.5, rtHeight * 0.5);

// Set blend mode to remove red covered by the blue.
blockingContainer.blendMode = PIXI.BLEND_MODES.DST_OUT;



sumRedPixels = function(targetCache) {
  const pixels = targetCache.pixels;
  const nPixels = pixels.length;
  let sumTarget = 0;
  for ( let i = 0; i < nPixels; i += 4 ) sumTarget += Boolean(targetCache.pixels[i]);
  return sumTarget;
};

sumRedObstaclesPixels = function(targetCache) {
  const pixels = targetCache.pixels;
  const nPixels = pixels.length;
  let sumTarget = 0;
  for ( let i = 0; i < nPixels; i += 4 ) {
    const px = pixels[i];
    if ( px < 128 ) continue;
    sumTarget += Boolean(targetCache.pixels[i]);
  }
  return sumTarget;
};
obstacleSum = blockingPoints.terrainWalls.length ? sumRedObstaclesPixels : sumRedPixels;

// Render only the target shape and calculate its rendered visible area.
renderer.render(targetGraphics, { renderTexture, clear: true });
targetCache = canvas.app.renderer.extract._rawPixels(renderTexture);
sumTarget = sumRedPixels(targetCache);

// Render all the obstacles and calculate the remaining area.
renderer.render(blockingContainer, { renderTexture, clear: false });
obstacleCache = canvas.app.renderer.extract._rawPixels(renderTexture);
sumWithObstacles = obstacleSum(obstacleCache);
