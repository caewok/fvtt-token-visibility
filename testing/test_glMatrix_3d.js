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

calcDefault.percentVisible();
calcPoints.percentVisible();
calcArea2d.percentVisible();
calcArea3dGeometric.percentVisible();
calcArea3dWebGL1.percentVisible();
calcArea3dWebGL2.percentVisible();


calcDefault._drawCanvasDebug()
calcDefault._clearCanvasDebug();

calcPoints._drawCanvasDebug()
calcArea2d._drawCanvasDebug()


calcArea3dGeometric._enableDebugPopout()
calcArea3dGeometric._draw3dDebug()

calcArea3dWebGL1._enableDebugPopout()
calcArea3dWebGL1._draw3dDebug()

calcArea3dWebGL2._enableDebugPopout()
calcArea3dWebGL2._draw3dDebug()



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


// Timing
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
  return calc.percentVisible();
}

webGL2BenchFn = function(viewer, target) {
  const calc = new Area3dLOSWebGL2(viewer, target, { largeTarget: false })
  return calc.percentVisible();
}

N = 1000
await QBenchmarkLoopFn(N, defaultBenchFn, "default", viewer, target);
await QBenchmarkLoopFn(N, pointsBenchFn, "points", viewer, target);
await QBenchmarkLoopFn(N, area2dBenchFn, "area2d", viewer, target);
await QBenchmarkLoopFn(N, geometricBenchFn, "geometric", viewer, target);
await QBenchmarkLoopFn(N, webGLBenchFn, "webGL", viewer, target);
await QBenchmarkLoopFn(N, webGL2BenchFn, "webGL2", viewer, target);



total = performance.measure("total", "Start_webGL2", "end_webGL2")
a = performance.measure("start", "Start_webGL2", "create_renderTexture")
b = performance.measure("create render texture", "create_renderTexture", "targetmesh")
c = performance.measure("create target mesh", "targetmesh", "renderTargetMesh")
d = performance.measure("render target mesh", "renderTargetMesh", "targetCache_start")
e = performance.measure("target cache", "targetCache_start", "obstaclemesh")
f = performance.measure("obstacle mesh", "obstaclemesh", "obstacleCache")
g = performance.measure("obstacle cache", "obstacleCache", "end_webGL2")

res = {
  [a.name]: a.duration,
  [b.name]: b.duration,
  [c.name]: c.duration,
  [d.name]: d.duration,
  [e.name]: e.duration,
  [f.name]: f.duration,
  [g.name]: g.duration,
  [total.name]: total.duration
}


console.table(res)


// ------ NOTE: Testing render texture

     RADIANS_90 = Math.toRadians(90);
     RADIANS_1 = Math.toRadians(1);
     mat4 = glMatrix.mat4;
    target = calc.target;
    blockingObjects = calc.blockingObjects;

    // We want the target token to be within the viewable frustrum.
    // Use the full token shape, not constrained shape, so that the angle captures the whole token.
    targetBoundaryPts = target.bounds.viewablePoints(calc.viewerPoint);

    // Angle is between the two segments from the origin.
    // TODO: Handle limited angle vision.
    angleRad = PIXI.Point.angleBetween(targetBoundaryPts[0], calc.viewerPoint, targetBoundaryPts[1]);
    fov = angleRad + RADIANS_1;

    // Near distance has to be close to the viewer.
    // We can assume we don't want to view anything within 1/2 grid unit?
    near = canvas.dimensions.size * 0.5;

    // Far distance is distance to the center of the target plus 1/2 the diagonal.
    let { w, h } = target;
    diagDist = Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2)) * 0.5;
    dist = Point3d.distanceBetween(calc.viewerPoint, calc.targetCenter) + diagDist;
    far = Math.ceil(dist);

    // Create texture
    frustrumBase = Math.ceil(calc.constructor.frustrumBase(fov, far));
    texConfig = {
      resolution: 1,
      width: frustrumBase,
      height: frustrumBase,
      scaleMode: PIXI.SCALE_MODES.NEAREST
    };

    // For the moment, create the texture and container
    await calc.popoutDebug("webGL2");
    stage = AREA3D_POPOUTS.webGL2.app.pixiApp.stage;
    popoutApp = AREA3D_POPOUTS.webGL2.app.pixiApp


    // Test different rendererrs
    rtAuto = PIXI.RenderTexture.create(texConfig);
    rtCanvas = PIXI.RenderTexture.create(texConfig);
    rtPopout = PIXI.RenderTexture.create(texConfig);






    meshContainer = new PIXI.Container();

    // TODO: Keep and clear instead of destroying the render texture.
    renderTexture = PIXI.RenderTexture.create(texConfig);

    // Create shaders, mesh, draw to texture.
    buildMesh = calc.constructor.buildMesh;

    // Unused:
    // const CACHE_RESOLUTION = 1.0;

    // 1 for the target, in red
    targetShader = calc._buildDebugShader(fov, near, far, { r: 1, g: 0, b: 0, a: 1 });
    targetMesh = buildMesh(target, targetShader);
    meshContainer.addChild(targetMesh);


    pixels = canvas.app.renderer.extract.pixels(meshContainer)

    // Render target and calculate its visible area alone.
    // TODO: This will always calculate the full area, even if a wall intersects the target.
    canvas.app.renderer.render(targetMesh, { renderTexture, clear: true });

    renderer = PIXI.autoDetectRenderer();
    renderer.render(meshContainer, { renderTexture: rtAuto, clear: true });
    canvas.app.renderer.render(meshContainer, { renderTexture: rtCanvas, clear: true });
    popoutApp.render(meshContainer, { renderTexture: rtPopout, clear: true });


    sTex = PIXI.Sprite.from(renderTexture)
    sAuto = PIXI.Sprite.from(rtAuto)
    sCanvas = PIXI.Sprite.from(rtCanvas)
    sPopout = PIXI.Sprite.from(rtPopout)

    canvas.stage.addChild(sTex)    // Works, wrong orientation
    canvas.stage.removeChild(sTex)

    canvas.stage.addChild(sAuto)  // Doesn't work
    canvas.stage.removeChild(sAuto)

    canvas.stage.addChild(sCanvas)  // Works, wrong orientation
    canvas.stage.removeChild(sCanvas)

    popoutApp.stage.addChild(sPopout)  // Doesn't work (at all)
    popoutApp.stage.removeChild(sPopout)

    popoutApp.stage.addChild(meshContainer) // Works




// Test creating new Point3d values
Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d;

api = game.modules.get("tokenvisibility").api
QBenchmarkLoop = api.benchFunctions.QBenchmarkLoop
QBenchmarkLoopFn = api.benchFunctions.QBenchmarkLoopFn

token = _token

tmpPoint = new Point3d();


N = 100_000
await QBenchmarkLoop(N, Point3d, "fromTokenCenter", token);            // ~ .0021 ms
await QBenchmarkLoop(N, Point3d, "fromTokenCenter2", token);           // ~ .0018 ms
await QBenchmarkLoop(N, Point3d, "fromTokenCenter2", token, tmpPoint); // ~ .0017 ms

fn1 = function(token, n = 100) {
  let pt;
  for ( let i = 1; i < n; i += 1 ) {
    pt = Point3d.fromTokenCenter(token);
    pt.x += Math.random(); // Break the cache.
  }
  return pt;
}

fn2 = function(token, n = 100) {
  let pt;
  for ( let i = 1; i < n; i += 1 ) {
    pt = Point3d.fromTokenCenter2(token);
    pt.x += Math.random(); // Break the cache.
  }
  return pt;
}

fn3 = function(token, n = 100) {
  const tmpPoint = new Point3d();
  let pt;
  for ( let i = 1; i < n; i += 1 ) {
    Point3d.fromTokenCenter2(token, tmpPoint);
    tmpPoint.x += Math.random(); // Break the cache.
  }
  return tmpPoint;
}

N = 10000
await QBenchmarkLoopFn(N, fn1, "fromTokenCenter", token);            // ~ .0021 ms
await QBenchmarkLoopFn(N, fn2, "fromTokenCenter2", token);           // ~ .0018 ms
await QBenchmarkLoopFn(N, fn3, "fromTokenCenter2 with tmpPoint", token); // ~ .0017 ms

