// Use WebGL2 directly

MODULE_ID = "tokenvisibility"
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get(MODULE_ID).api
MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32
Area3dPopout = api.Area3dPopout
Area3dPopoutCanvas = api.Area3dPopoutCanvas

let {
  Camera,
  GeometryDesc,
  GeometryWallDesc,
  GeometryCubeDesc,
  GeometryTileDesc,
  GeometryConstrainedTokenDesc,
  GeometryHorizontalPlaneDesc,
  WallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
  PlaceableInstanceHandler,
} = api.webgpu;

let {
  WebGL2,
  NonDirectionalWallInstanceHandlerWebGL2,
  DirectionalWallInstanceHandlerWebGL2,
  TileInstanceHandlerWebGL2,
  TokenInstanceHandlerWebGL2,
  DrawableNonDirectionalWallWebGL2,
  DrawableDirectionalWallWebGL2,
  DrawableNonDirectionalTerrainWallWebGL2,
  DrawableDirectionalTerrainWallWebGL2,
  DrawableTileWebGL2,
  DrawableTokenWebGL2,
  DrawableSceneBackground,
  RenderObstaclesAbstractWebGL2,
  RenderWallObstaclesWebGL2,
  RenderTileObstaclesWebGL2,
  RenderObstaclesWebGL2,
  RenderObstaclesWithBackgroundWebGL2,
  twgl,
  PercentVisibleCalculatorWebGL2,
  DebugVisibilityViewerWebGL2,
} = api.webgl;

glmatrix = api.glmatrix;

function combineTypedArrays(...arrs) {
  const len = arrs.reduce((acc, curr) => acc + curr.length, 0);
  const out = new arrs[0].constructor(len);
  out.set(arrs[0]);
  let idx = 0;
  for ( let i = 0, n = arrs.length; i < n; i += 1 ) {
    out.set(arrs[i], idx);
    idx += arrs[i].length;
  }
  return out;
}




canvas.walls.placeables.forEach(wall => Draw.segment(wall));
canvas.tiles.placeables.forEach(tile => Draw.shape(tile.bounds, { color: Draw.COLORS.red }))


viewer = _token
target = game.user.targets.first()



// gl = canvas.app.renderer.gl
//
// glCanvas = new OffscreenCanvas(1, 1);
// gl = glCanvas.getContext('webgl2');

popout = new Area3dPopoutCanvas({ width: 400, height: 475, resizable: false })
await popout._render(true, { contextType: "webgl2"});
gl = popout.context

// Test PercentVisibleCalculator
calc = new PercentVisibleCalculatorWebGL2({ senseType: "sight" });
await calc.initialize()
calc.percentVisible(viewer, target)
calc.percentVisible(target, viewer)

// Test debug viewer
debugViewer = new DebugVisibilityViewerWebGL2({ senseType: "sight", debugView: true })
await debugViewer.initialize();
debugViewer.destroy();


debugViewer = new DebugVisibilityViewerWebGL2({ senseType: "sight", debugView: false })
await debugViewer.initialize();


// NOTE: Test rendering to texture and then to canvas

renderObstacles = new RenderObstaclesWebGL2()
await renderObstacles.initialize({ gl, senseType: "sight" })

renderObstaclesDebug = new RenderObstaclesWebGL2()
await renderObstaclesDebug.initialize({ gl, senseType: "sight", debugViewNormals: true })

// Create a texture to render to.
textureOpts = {
  target: gl.TEXTURE_2D,
  level: 0,
  minMag: gl.NEAREST,
  wrap: gl.CLAMP_TO_EDGE,
  internalFormat: gl.RGBA,
  format: gl.RGBA,
  type: gl.UNSIGNED_BYTE,
  width: 256,
  height: 256,
}
// targetTextureWidth = 256;
// targetTextureHeight = 256;
// renderTexture = WebGL2.createAndSetupTexture(gl);
// WebGL2.formatTexture(gl, { width: targetTextureWidth, height: targetTextureHeight });

renderTexture = twgl.createTexture(gl, textureOpts)
// gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

// Attach texture to it.
mipLevel = 0;
attachmentPoint = gl.COLOR_ATTACHMENT0;
gl.framebufferTexture2D(gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, renderTexture, mipLevel);

// Draw into the framebuffer with the texture attached.
gl.canvas.width = 256
gl.canvas.height = 256
WebGL2.bindFramebufferAndSetViewport(gl, fb, textureOpts.width, textureOpts.height)

// framebufferInfo = twgl.createFramebufferInfo(gl, { attachment: renderTexture })
// twgl.bindFramebufferInfo(gl, framebufferInfo, textureOpts.width, textureOpts.height)


renderObstaclesDebug.camera.UP = new Point3d(-1, 0, 1)
renderObstaclesDebug.camera.mirrorM.setIndex(0, 0, -1)
renderObstaclesDebug.camera.mirrorM.setIndex(1, 1, 1)
renderObstaclesDebug.camera.mirrorM.setIndex(2, 2, -1)
renderObstaclesDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer })


viewerLocation = Point3d.fromTokenCenter(viewer)
targetLocation = Point3d.fromTokenCenter(target)
flippedViewerLocation = viewerLocation.projectToward(targetLocation, 2)

viewerLocation.y *= -1
viewerLocation.y = 1 - viewerLocation.y
targetLocation.y = 1 - targetLocation.y
renderObstaclesDebug.render(viewerLocation, target, { viewer })


readbackSize = textureOpts.width * textureOpts.height * 4;
bufferData = new Uint8Array(readbackSize)
// gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, targetTexture)
gl.readPixels(0, 0, textureOpts.width, textureOpts.height, gl.RGBA, gl.UNSIGNED_BYTE, bufferData);
imgData =  { pixels: bufferData, x: 0, y: 0, width: textureOpts.width, height: textureOpts.height };
WebGL2.summarizePixelData(imgData)

/*
canvas.app.stage.removeChild(sprite);
tex = PIXI.Texture.fromBuffer(imgData.pixels, imgData.width, imgData.height)
sprite = new PIXI.Sprite(tex);
canvas.app.stage.addChild(sprite);
canvas.app.stage.removeChild(sprite);

*/


// Now render same to canvas
// twgl.bindFramebufferInfo(gl, null)
gl.canvas.width = 400
gl.canvas.height = 400
WebGL2.bindFramebufferAndSetViewport(gl, null, gl.canvas.width, gl.canvas.height)

renderObstacles.camera.mirrorM.setIndex(0, 0, -1)
renderObstacles.camera.mirrorM.setIndex(1, 1, 1)
renderObstacles.camera.mirrorM.setIndex(2, 2, 1)
renderObstaclesDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer })

// Now render debug to canvas
renderObstaclesDebug.camera.mirrorM.setIndex(0, 0, -1)
renderObstaclesDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer })


width = gl.canvas.width
height = gl.canvas.height
readbackSize = width * height * 4;
bufferData = new Uint8Array(readbackSize)
// gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, targetTexture)

// gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, popout.canvas);
gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bufferData);
imgData =  { pixels: bufferData, x: 0, y: 0, width, height };
WebGL2.summarizePixelData(imgData)


// Try rendering to offscreen canvas
width = 256
height = 256
glCanvas = new OffscreenCanvas(width, height);
gl = glCanvas.getContext('webgl2');
// texture = gl.createTexture();
// framebuffer = gl.createFramebuffer();
// gl.bindTexture(gl.TEXTURE_2D, texture);
// gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
// gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
readbackSize = width * height * 4;
bufferData = new Uint8Array(readbackSize)

renderObstaclesDebug = new RenderObstaclesWebGL2()
await renderObstaclesDebug.initialize({ gl, senseType: "sight", debugViewNormals: true })
renderObstaclesDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer })
gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bufferData);
imgData =  { pixels: bufferData, x: 0, y: 0, width, height };
WebGL2.summarizePixelData(imgData)

canvas.app.stage.removeChild(sprite);
tex = PIXI.Texture.fromBuffer(imgData.pixels, imgData.width, imgData.height)
sprite = new PIXI.Sprite(tex);
canvas.app.stage.addChild(sprite);



// NOTE: Test renderWall


renderWalls = new RenderWallObstaclesWebGL2()
await renderWalls.initialize({ gl, senseType: "sight" })
renderWalls.render(Point3d.fromTokenCenter(viewer), target, { viewer })

renderWallsDebug = new RenderWallObstaclesWebGL2()
await renderWallsDebug.initialize({ gl, senseType: "sight", debugViewNormals: true })
renderWallsDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer })

renderTiles = new RenderTileObstaclesWebGL2()
await renderTiles.initialize({ gl, senseType: "sight" })
renderTiles.render(Point3d.fromTokenCenter(viewer), target, { viewer })

renderTilesDebug = new RenderTileObstaclesWebGL2()
await renderTilesDebug.initialize({ gl, senseType: "sight", debugViewNormals: true })
renderTilesDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer })



renderTerrainWalls = new RenderTerrainWallsWebGL2()
await renderTerrainWalls.initialize({ gl, senseType: "sight" })
renderTerrainWalls.render(Point3d.fromTokenCenter(viewer), target, { viewer })

renderTerrainWallsDebug = new RenderTerrainWallsWebGL2()
await renderTerrainWallsDebug.initialize({ gl, senseType: "sight", debugViewNormals: true })
renderTerrainWallsDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer })

renderObstacles = new RenderObstaclesWebGL2({ gl, senseType: "sight" })
await renderObstacles.initialize()
renderObstacles.render(Point3d.fromTokenCenter(viewer), target, { viewer })

renderObstaclesDebug = new RenderObstaclesWebGL2({ gl, senseType: "sight", debugViewNormals: true })
await renderObstaclesDebug.initialize()
renderObstaclesDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer })

renderSceneBackground = new RenderObstaclesWithBackgroundWebGL2()
await renderSceneBackground.initialize({ gl, senseType: "sight" })
renderSceneBackground.render(Point3d.fromTokenCenter(viewer), target, { viewer })

renderSceneBackgroundDebug = new RenderObstaclesWithBackgroundWebGL2()
await renderSceneBackgroundDebug.initialize({ gl, senseType: "sight", debugViewNormals: true })
renderSceneBackgroundDebug.render(Point3d.fromTokenCenter(viewer), target, { viewer })




renderTokensDebug = new RenderTokensWebGL2()
renderTokensDebug.camera = new Camera({ glType: "webGPU", perspectiveType: "perspective" })
renderTokensDebug.camera = new Camera({ glType: "webGPU", perspectiveType: "orthogonal" })
renderTokensDebug.camera = new Camera({ glType: "webGL2", perspectiveType: "orthogonal" })


renderWalls._setCamera()

drawableObj = renderWalls.drawableObjects[0]






// NOTE: Test drawing triangle
// https://webgl2fundamentals.org/webgl/lessons/webgl-fundamentals.html
vertexShaderSource =
`#version 300 es
in vec4 a_position;

void main() {
  gl_Position = a_position;
}
`;

fragmentShaderSource =
`#version 300 es
precision highp float;

out vec4 outColor;

void main() {
  outColor = vec4(1.0, 0.0, 0.5, 1.0);
}
`;

// create GLSL shaders, upload the GLSL source, compile the shaders
vertexShader = WebGL2.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
fragmentShader = WebGL2.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

// Link the two shaders into a program
program = WebGL2.createProgram(gl, vertexShader, fragmentShader)

// Look up where the vertex data needs to go.
positionAttribLoc = gl.getAttribLocation(program, "a_position");

// Create a buffer and put three 2d clip space points in it
positionBuffer = gl.createBuffer(); // WebGLBuffer

// Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
positions = [
  0, 0,
  0, 0.5,
  0.7, 0,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

// Create a vertex array object (attribute state)
vao = gl.createVertexArray();

// and make it the one we're currently working with
gl.bindVertexArray(vao);

// Turn on the attribute
gl.enableVertexAttribArray(positionAttribLoc);

// Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
size = 2;          // 2 components per iteration
type = gl.FLOAT;   // the data is 32bit floats
normalize = false; // don't normalize the data
stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
offset = 0;        // start at the beginning of the buffer
gl.vertexAttribPointer(positionAttribLoc, size, type, normalize, stride, offset);


// Set render to canvas
WebGL2.bindFramebufferAndSetViewport(gl, null, gl.canvas.width, gl.canvas.height)

// gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
// Clear the canvas
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT);

// Tell it to use our program (pair of shaders)
gl.useProgram(program);

// Bind the attribute/buffer set we want.
gl.bindVertexArray(vao);

// draw
primitiveType = gl.TRIANGLES;
offset = 0;
count = 3;
gl.drawArrays(primitiveType, offset, count);


// Create a texture to render to.
targetTextureWidth = 256;
targetTextureHeight = 256;
targetTexture = WebGL2.createAndSetupTexture(gl);
WebGL2.formatTexture(gl, { width: targetTextureWidth, height: targetTextureHeight });

// Create framebuffer.
fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

// Attach texture to it.
mipLevel = 0;
attachmentPoint = gl.COLOR_ATTACHMENT0;
gl.framebufferTexture2D(gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, targetTexture, mipLevel);


// Drawing
// Tell WebGL to use the pair of shaders
gl.useProgram(program);

// Bind the attribute/buffer set we want.
gl.bindVertexArray(vao)

// Draw into the framebuffer with the texture attached.
WebGL2.bindFramebufferAndSetViewport(gl, fb, targetTextureWidth, targetTextureHeight)

// Draw
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT);
primitiveType = gl.TRIANGLES
offset = 0
count = 3
gl.drawArrays(primitiveType, offset, count)


// Set the texture to a PIXI Texture
// https://pixijs.download/v7.x/docs/PIXI.BaseTexture.html
/*
gl.bindTexture(gl.TEXTURE_2D, targetTexture)
res = new PIXI.Resource(targetTexture,  { width: targetTextureWidth, height: targetTextureHeight })
baseTexture = new PIXI.BaseTexture(res, {
   width: targetTextureWidth,
   height: targetTextureHeight,
   scaleMode: PIXI.SCALE_MODES.LINEAR,
   format: PIXI.FORMATS.RGBA,
   type: PIXI.TYPES.UNSIGNED_BYTE,
   target: PIXI.TARGETS.TEXTURE_2D,
   // alphaMode
});
texture = new PIXI.Texture(baseTexture);
sprite = new PIXI.Sprite(texture);
canvas.stage.addChild(sprite) // Fails hard
*/

// Works for capturing from render texture, assuming that texture's framebuffer was just used.
readbackSize = targetTextureWidth * targetTextureHeight * 4;
bufferData = new Uint8Array(readbackSize)
// gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, targetTexture)
gl.readPixels(0, 0, targetTextureWidth, targetTextureHeight, gl.RGBA, gl.UNSIGNED_BYTE, bufferData);
imgData =  { pixels: bufferData, x: 0, y: 0, width: targetTextureWidth, height:targetTextureHeight };
WebGL2.summarizePixelData(imgData)

// Works for capturing from canvas
readbackSize = gl.canvas.height * gl.canvas.width * 4;
bufferData = new Uint8Array(readbackSize)
// gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, popout.canvas)
gl.readPixels(0, 0, gl.canvas.height, gl.canvas.width, gl.RGBA, gl.UNSIGNED_BYTE, bufferData);
imgData =  { pixels: bufferData, x: 0, y: 0, width: gl.canvas.height, height: gl.canvas.width };
WebGL2.summarizePixelData(imgData)



// NOTE: Test drawing target token.
debugViewNormals = true
camera = new Camera();
placeableHandler = new TokenInstanceHandler("sight");
placeableHandler.initializePlaceables()

// geom = new GeometryConstrainedTokenDesc({ token: target, addNormals: debugViewNormals, addUVs: false })
vertexShaderSource = await WebGL2.sourceFromGLSLFile("constrained_token_vertex", { debugViewNormals })
fragmentShaderSource = await WebGL2.sourceFromGLSLFile("wall_fragment", { debugViewNormals })
vertexShader = WebGL2.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
fragmentShader = WebGL2.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
program = WebGL2.createProgram(gl, vertexShader, fragmentShader)



// gl.getShaderSource(vertexShader)
// gl.getShaderSource(fragmentShader)

// combine tokens
geoms = new Array(placeableHandler.numInstances);
for ( const [idx, token] of placeableHandler.placeableFromInstanceIndex.entries() ) {
  geoms[idx] = new GeometryConstrainedTokenDesc({ token, addNormals: debugViewNormals, addUVs: false })
}
offsetData = GeometryDesc.computeBufferOffsets(geoms);
vertices = combineTypedArrays(...geoms.map(g => g.vertices));

// Redo the indices count.
offset = 0;
for ( let i = 1, iMax = geoms.length; i < iMax; i += 1 ) {
  offset += geoms[i].numVertices;
  const size = offsetData.index.lengths[i];
  for ( let j = 0, jMax = size; j < jMax; j += 1 ) geoms[i].indices[j] += offset;
}
indices = combineTypedArrays(...geoms.filter(g => Boolean(g.indices)).map(g => g.indices));


// Set vertex buffer
vBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer)
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

// Link vao to the vertex buffer
vao = gl.createVertexArray()
gl.bindVertexArray(vao)

// For offset and stride, see https://stackoverflow.com/questions/16380005/opengl-3-4-glvertexattribpointer-stride-and-offset-miscalculation
posAttribLoc = gl.getAttribLocation(program, "aPos")
gl.enableVertexAttribArray(posAttribLoc)
size = 3
type = gl.FLOAT
stride = vertices.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3);
offset = 0
normalize = false
gl.vertexAttribPointer(posAttribLoc, size, type, normalize, stride, offset);

if ( debugViewNormals ) {
  normAttribLoc = gl.getAttribLocation(program, "aNorm");
  gl.enableVertexAttribArray(normAttribLoc)
  size = 3
  type = gl.FLOAT
  // stride = vertices.BYTES_PER_ELEMENT * 6;
  offset = 3 * vertices.BYTES_PER_ELEMENT
  normalize = false
  gl.vertexAttribPointer(normAttribLoc, size, type, normalize, stride, offset);
}

// Set index buffer
indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

// Tell it to use our program (pair of shaders)
gl.useProgram(program);

gl.bindVertexArray(vao);

// Set uniforms
viewerLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer)
targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
camera.cameraPosition = viewerLocation;
camera.targetPosition = targetLocation;
camera.setTargetTokenFrustrum(target);
camera.perspectiveParameters = { fov: camera.perspectiveParameters.fov * 2, zFar: camera.perspectiveParameters.zFar + 50 }

transpose = false
perspectiveMat4UniformLoc = gl.getUniformLocation(program, "uPerspectiveMatrix");
gl.uniformMatrix4fv(perspectiveMat4UniformLoc, transpose, camera.perspectiveMatrix.arr);

lookAtMat4UniformLoc = gl.getUniformLocation(program, "uLookAtMatrix");
gl.uniformMatrix4fv(lookAtMat4UniformLoc, transpose, camera.lookAtMatrix.arr);

colorUniformLoc = gl.getUniformLocation(program, "uColor");
gl.uniform4fv(colorUniformLoc, [1, 0, 0, 1]);


// Set render to canvas
WebGL2.bindFramebufferAndSetViewport(gl, null, gl.canvas.width, gl.canvas.height)

// Attach depth buffer
// depthTexture = WebGL2.createAndSetupTexture(gl)

// Make a depth buffer the same size as the render target
// WebGL2.formatTexture(gl, { width: gl.canvas.width, height: gl.canvas.height, internalFormat: gl.DEPTH_COMPONENT24, srcFormat: gl.DEPTH_COMPONENT, srcType: gl.UNSIGNED_INT })

// attach the depth texture to the framebuffer
// mipLevel = 0;
// gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, mipLevel);


// Init draw
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

// Draw (all of them except viewer)
primitiveType = gl.TRIANGLES;
offset = 0;
count = 72
// count = indices.length; // Need to skip the viewer or it may be drawn black if inside viewer.
indexType = gl.UNSIGNED_SHORT
gl.drawElements(primitiveType, count, indexType, offset)




instanceSet = new Set(placeableHandler.instanceIndexFromId.values())
instanceSet.delete(placeableHandler.instanceIndexFromId.get(viewer.id))

WebGL2.drawSet(gl, instanceSet, offsetData)


// NOTE: Draw tokens as instances.
debugViewNormals = true
camera = new Camera();
placeableHandler = new TokenInstanceHandler("sight");
placeableHandler.initializePlaceables()

// geom = new GeometryConstrainedTokenDesc({ token: target, addNormals: debugViewNormals, addUVs: false })
vertexShaderSource = await WebGL2.sourceFromGLSLFile("token_vertex", { debugViewNormals })
fragmentShaderSource = await WebGL2.sourceFromGLSLFile("wall_fragment", { debugViewNormals })
vertexShader = WebGL2.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
fragmentShader = WebGL2.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
program = WebGL2.createProgram(gl, vertexShader, fragmentShader)



// gl.getShaderSource(vertexShader)
// gl.getShaderSource(fragmentShader)

geom = new GeometryCubeDesc({ addNormals: debugViewNormals, addUVs: false });

// Set vertex buffer
vBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer)
gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW)

/*
// Temporary: test if we need to transpose the matrices.
for ( const idx of placeableHandler.instanceIndexFromId.values() ) {
  res = placeableHandler.updateInstanceBuffer(idx);
  tmp = res.out.transpose()
  tmp.clone(res.out)
}
*/

// Set model matrices (instance) buffer
modelBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffer)
gl.bufferData(gl.ARRAY_BUFFER, placeableHandler.instanceArrayValues, gl.DYNAMIC_DRAW); // Could just pass the size: placeableHandler.instanceArrayValues.byteLength.

// Link vao to the vertex buffer
vao = gl.createVertexArray()
gl.bindVertexArray(vao)

// Position attribute
// For offset and stride, see https://stackoverflow.com/questions/16380005/opengl-3-4-glvertexattribpointer-stride-and-offset-miscalculation
posAttribLoc = gl.getAttribLocation(program, "aPos")
gl.enableVertexAttribArray(posAttribLoc)
size = 3
type = gl.FLOAT
stride = geom.vertices.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3);
offset = 0
normalize = false
gl.vertexAttribPointer(posAttribLoc, size, type, normalize, stride, offset);

// Normal attribute
if ( debugViewNormals ) {
  normAttribLoc = gl.getAttribLocation(program, "aNorm");
  gl.enableVertexAttribArray(normAttribLoc)
  size = 3
  type = gl.FLOAT
  stride = geom.vertices.BYTES_PER_ELEMENT * 6;
  offset = 3 * geom.vertices.BYTES_PER_ELEMENT
  normalize = false
  gl.vertexAttribPointer(normAttribLoc, size, type, normalize, stride, offset);
}

// Model attribute
// Set up the 4 consecutive slots for the matrix.
// See https://webgl2fundamentals.org/webgl/lessons/webgl-instanced-drawing.html
stride = placeableHandler.instanceArrayValues.BYTES_PER_ELEMENT * 16;
modelAttribLoc = gl.getAttribLocation(program, "model");
size = 4;
type = gl.FLOAT
normalize = false
for ( let i = 0; i < 4; i += 1 ) {
  const loc = modelAttribLoc + i;
  gl.enableVertexAttribArray(loc);
  const offset = i * 16;  // 4 floats per row, 4 bytes per float
  gl.vertexAttribPointer(loc, size, type, normalize, stride, offset) // column

  // This line says this attribute only changes for each 1 instance
  gl.vertexAttribDivisor(loc, 1);
}

// Set index buffer
indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);

// Tell it to use our program (pair of shaders)
gl.useProgram(program);

gl.bindVertexArray(vao);

// Set uniforms
viewerLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer)
targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
camera.cameraPosition = viewerLocation;
camera.targetPosition = targetLocation;
camera.setTargetTokenFrustrum(target);
camera.perspectiveParameters = { fov: camera.perspectiveParameters.fov * 2, zFar: camera.perspectiveParameters.zFar + 50 }

transpose = false
perspectiveMat4UniformLoc = gl.getUniformLocation(program, "uPerspectiveMatrix");
gl.uniformMatrix4fv(perspectiveMat4UniformLoc, transpose, camera.perspectiveMatrix.arr);

lookAtMat4UniformLoc = gl.getUniformLocation(program, "uLookAtMatrix");
gl.uniformMatrix4fv(lookAtMat4UniformLoc, transpose, camera.lookAtMatrix.arr);

colorUniformLoc = gl.getUniformLocation(program, "uColor");
gl.uniform4fv(colorUniformLoc, [1, 0, 0, 1]);


// Set render to canvas
WebGL2.bindFramebufferAndSetViewport(gl, null, gl.canvas.width, gl.canvas.height)

// Attach depth buffer
// depthTexture = WebGL2.createAndSetupTexture(gl)

// Make a depth buffer the same size as the render target
// WebGL2.formatTexture(gl, { width: gl.canvas.width, height: gl.canvas.height, internalFormat: gl.DEPTH_COMPONENT24, srcFormat: gl.DEPTH_COMPONENT, srcType: gl.UNSIGNED_INT })

// attach the depth texture to the framebuffer
// mipLevel = 0;
// gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, mipLevel);


// Init draw
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

// Draw (all of them except viewer)
primitiveType = gl.TRIANGLES;
offset = 0;
count = geom.indices.length;
indexType = gl.UNSIGNED_SHORT
instanceCount = 1
gl.drawElementsInstanced(primitiveType, count, indexType, offset, instanceCount)


// NOTE: Draw instanced walls
debugViewNormals = false
camera = new Camera();
placeableHandler = new WallInstanceHandler("sight");
placeableHandler.initializePlaceables()

vertexShaderSource = await WebGL2.sourceFromGLSLFile("wall_vertex", { debugViewNormals })
fragmentShaderSource = await WebGL2.sourceFromGLSLFile("wall_fragment", { debugViewNormals })
vertexShader = WebGL2.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
fragmentShader = WebGL2.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
program = WebGL2.createProgram(gl, vertexShader, fragmentShader)

geom = new GeometryWallDesc({ directional: false, addNormals: debugViewNormals, addUVs: false });

// Set vertex buffer
vBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer)
gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW)

// Set model matrices (instance) buffer
modelBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, modelBuffer)
gl.bufferData(gl.ARRAY_BUFFER, placeableHandler.instanceArrayValues, gl.DYNAMIC_DRAW); // Could just pass the size: placeableHandler.instanceArrayValues.byteLength.

// Link vao to the vertex buffer
vao = gl.createVertexArray()
gl.bindVertexArray(vao)

// Position attribute
// For offset and stride, see https://stackoverflow.com/questions/16380005/opengl-3-4-glvertexattribpointer-stride-and-offset-miscalculation
posAttribLoc = gl.getAttribLocation(program, "aPos")
gl.enableVertexAttribArray(posAttribLoc)
size = 3
type = gl.FLOAT
stride = geom.vertices.BYTES_PER_ELEMENT * 6
offset = 0
normalize = false
gl.vertexAttribPointer(posAttribLoc, size, type, normalize, stride, offset);

// Normal attribute
if ( debugViewNormals ) {
  normAttribLoc = gl.getAttribLocation(program, "aNorm");
  gl.enableVertexAttribArray(normAttribLoc)
  size = 3
  type = gl.FLOAT
  stride = geom.vertices.BYTES_PER_ELEMENT * 6;
  offset = 3 * geom.vertices.BYTES_PER_ELEMENT
  normalize = false
  gl.vertexAttribPointer(normAttribLoc, size, type, normalize, stride, offset);
}

// Model attribute
// Set up the 4 consecutive slots for the matrix.
// See https://webgl2fundamentals.org/webgl/lessons/webgl-instanced-drawing.html
stride = placeableHandler.instanceArrayValues.BYTES_PER_ELEMENT * 16;
modelAttribLoc = gl.getAttribLocation(program, "model");
size = 4;
type = gl.FLOAT
normalize = false
for ( let i = 0; i < 4; i += 1 ) {
  const loc = modelAttribLoc + i;
  gl.enableVertexAttribArray(loc);
  const offset = i * 16;  // 4 floats per row, 4 bytes per float
  gl.vertexAttribPointer(loc, size, type, normalize, stride, offset)

  // This line says this attribute only changes for each 1 instance
  gl.vertexAttribDivisor(loc, 1);
}

// Set index buffer
indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);

// Tell it to use our program (pair of shaders)
gl.useProgram(program);

gl.bindVertexArray(vao);

// Set uniforms
viewerLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer)
targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
camera.cameraPosition = viewerLocation;
camera.targetPosition = targetLocation;
camera.setTargetTokenFrustrum(target);
camera.perspectiveParameters = { fov: camera.perspectiveParameters.fov * 2, zFar: camera.perspectiveParameters.zFar + 50 }

transpose = false
perspectiveMat4UniformLoc = gl.getUniformLocation(program, "uPerspectiveMatrix");
gl.uniformMatrix4fv(perspectiveMat4UniformLoc, transpose, camera.perspectiveMatrix.arr);

lookAtMat4UniformLoc = gl.getUniformLocation(program, "uLookAtMatrix");
gl.uniformMatrix4fv(lookAtMat4UniformLoc, transpose, camera.lookAtMatrix.arr);

colorUniformLoc = gl.getUniformLocation(program, "uColor");
gl.uniform4fv(colorUniformLoc, [0, 0, 1, 1]);

// Set render to canvas
WebGL2.bindFramebufferAndSetViewport(gl, null, gl.canvas.width, gl.canvas.height)

// Init draw
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

// Draw (all of them except viewer)
primitiveType = gl.TRIANGLES;
offset = 0;
count = geom.indices.length;
indexType = gl.UNSIGNED_SHORT
instanceCount = 3
gl.drawElementsInstanced(primitiveType, count, indexType, offset, instanceCount)


// NOTE: Draw tokens with uniform model matrices
debugViewNormals = true
camera = new Camera();
placeableHandler = new TokenInstanceHandler("sight");
placeableHandler.initializePlaceables()

vertexShaderSource = await WebGL2.sourceFromGLSLFile("token_model_matrices_vertex", { debugViewNormals })
fragmentShaderSource = await WebGL2.sourceFromGLSLFile("wall_fragment", { debugViewNormals })
vertexShader = WebGL2.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
fragmentShader = WebGL2.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
program = WebGL2.createProgram(gl, vertexShader, fragmentShader)

geom = new GeometryCubeDesc({ addNormals: debugViewNormals, addUVs: false });

// Set vertex buffer
vBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer)
gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW)

// Link vao to the vertex buffer
vao = gl.createVertexArray()
gl.bindVertexArray(vao)

// Position attribute
// For offset and stride, see https://stackoverflow.com/questions/16380005/opengl-3-4-glvertexattribpointer-stride-and-offset-miscalculation
posAttribLoc = gl.getAttribLocation(program, "aPos")
gl.enableVertexAttribArray(posAttribLoc)
size = 3
type = gl.FLOAT
stride = geom.vertices.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3);
offset = 0
normalize = false
gl.vertexAttribPointer(posAttribLoc, size, type, normalize, stride, offset);

// Normal attribute
if ( debugViewNormals ) {
  normAttribLoc = gl.getAttribLocation(program, "aNorm");
  gl.enableVertexAttribArray(normAttribLoc)
  size = 3
  type = gl.FLOAT
  stride = geom.vertices.BYTES_PER_ELEMENT * 6;
  offset = 3 * geom.vertices.BYTES_PER_ELEMENT
  normalize = false
  gl.vertexAttribPointer(normAttribLoc, size, type, normalize, stride, offset);
}

// Set index buffer
indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);

// Tell it to use our program (pair of shaders)
gl.useProgram(program);

gl.bindVertexArray(vao);

// Set uniforms
viewerLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer)
targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
camera.cameraPosition = viewerLocation;
camera.targetPosition = targetLocation;
camera.setTargetTokenFrustrum(target);
camera.perspectiveParameters = { fov: camera.perspectiveParameters.fov * 2, zFar: camera.perspectiveParameters.zFar + 50 }

transpose = false
perspectiveMat4UniformLoc = gl.getUniformLocation(program, "uPerspectiveMatrix");
gl.uniformMatrix4fv(perspectiveMat4UniformLoc, transpose, camera.perspectiveMatrix.arr);

lookAtMat4UniformLoc = gl.getUniformLocation(program, "uLookAtMatrix");
gl.uniformMatrix4fv(lookAtMat4UniformLoc, transpose, camera.lookAtMatrix.arr);

colorUniformLoc = gl.getUniformLocation(program, "uColor");
gl.uniform4fv(colorUniformLoc, [0, 0, 1, 1]);




// Set render to canvas
WebGL2.bindFramebufferAndSetViewport(gl, null, gl.canvas.width, gl.canvas.height)

// Init draw
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

instanceSet = new Set(placeableHandler.instanceIndexFromId.values())
instanceSet.delete(placeableHandler.instanceIndexFromId.get(viewer.id))
for ( const i of instanceSet.values() ) {
  modelUniformLoc = gl.getUniformLocation(program, "model");
  gl.uniformMatrix4fv(modelUniformLoc, transpose, placeableHandler.instanceArrayValues.slice(i * 16, (i * 16) + 16))

  // Draw (all of them except viewer)
  primitiveType = gl.TRIANGLES;
  offset = 0;
  count = geom.indices.length;
  indexType = gl.UNSIGNED_SHORT
  gl.drawElements(primitiveType, count, indexType, offset)
}


// NOTE: Draw walls individually
debugViewNormals = true
camera = new Camera();
placeableHandler = new NonDirectionalWallInstanceHandlerWebGL2({ senseType: "sight", addNormals: debugViewNormals });
placeableHandler.initializePlaceables()

vertexShaderSource = await WebGL2.sourceFromGLSLFile("obstacle_vertex", { debugViewNormals })
fragmentShaderSource = await WebGL2.sourceFromGLSLFile("obstacle_fragment", { debugViewNormals })
vertexShader = WebGL2.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
fragmentShader = WebGL2.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
program = WebGL2.createProgram(gl, vertexShader, fragmentShader)

// Set vertex buffer
vBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer)
gl.bufferData(gl.ARRAY_BUFFER, placeableHandler.verticesArray, gl.STATIC_DRAW)

// Link vao to the vertex buffer
vao = gl.createVertexArray()
gl.bindVertexArray(vao)

// Position attribute
// For offset and stride, see https://stackoverflow.com/questions/16380005/opengl-3-4-glvertexattribpointer-stride-and-offset-miscalculation
posAttribLoc = gl.getAttribLocation(program, "aPos")
gl.enableVertexAttribArray(posAttribLoc)
size = 3
type = gl.FLOAT
stride = placeableHandler.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3);
offset = 0
normalize = false
gl.vertexAttribPointer(posAttribLoc, size, type, normalize, stride, offset);

// Normal attribute
if ( debugViewNormals ) {
  normAttribLoc = gl.getAttribLocation(program, "aNorm");
  gl.enableVertexAttribArray(normAttribLoc)
  size = 3
  type = gl.FLOAT
  stride = placeableHandler.verticesArray.BYTES_PER_ELEMENT * 6;
  offset = 3 * placeableHandler.verticesArray.BYTES_PER_ELEMENT
  normalize = false
  gl.vertexAttribPointer(normAttribLoc, size, type, normalize, stride, offset);
}

// Set index buffer
indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, placeableHandler.indicesArray, gl.STATIC_DRAW);

// Tell it to use our program (pair of shaders)
gl.useProgram(program);

gl.bindVertexArray(vao);

// Set uniforms
viewerLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer)
targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
camera.cameraPosition = viewerLocation;
camera.targetPosition = targetLocation;
camera.setTargetTokenFrustrum(target);
camera.perspectiveParameters = { fov: camera.perspectiveParameters.fov * 2, zFar: camera.perspectiveParameters.zFar + 50 }

transpose = false
perspectiveMat4UniformLoc = gl.getUniformLocation(program, "uPerspectiveMatrix");
gl.uniformMatrix4fv(perspectiveMat4UniformLoc, transpose, camera.perspectiveMatrix.arr);

lookAtMat4UniformLoc = gl.getUniformLocation(program, "uLookAtMatrix");
gl.uniformMatrix4fv(lookAtMat4UniformLoc, transpose, camera.lookAtMatrix.arr);

colorUniformLoc = gl.getUniformLocation(program, "uColor");
gl.uniform4fv(colorUniformLoc, [0, 0, 1, 1]);


// Set render to canvas
WebGL2.bindFramebufferAndSetViewport(gl, null, gl.canvas.width, gl.canvas.height)

// Init draw
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

instanceSet = new Set(placeableHandler.instanceIndexFromId.values())
// instanceSet.delete(placeableHandler.instanceIndexFromId.get(viewer.id))

offsetData = {
  index: {
    offsets: new Array(placeableHandler.numInstances),
    lengths: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.indices.length),
    sizes: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.indices.byteLength),
  }
}
offsetData.index.sizes.forEach((ln, i) => offsetData.index.offsets[i] = ln * i)
WebGL2.drawSet(gl, instanceSet, offsetData)

// NOTE: Draw walls individually using twgl
debugViewNormals = true
camera = new Camera();
placeableHandler = new NonDirectionalWallInstanceHandlerWebGL2({ senseType: "sight", addNormals: debugViewNormals });
placeableHandler.initializePlaceables()

vertexShaderSource = await WebGL2.sourceFromGLSLFile("obstacle_vertex", { debugViewNormals })
fragmentShaderSource = await WebGL2.sourceFromGLSLFile("obstacle_fragment", { debugViewNormals })
programInfo = twgl.createProgramInfo(gl, [vertexShaderSource, fragmentShaderSource])

// Set vertex buffer
vBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer)
gl.bufferData(gl.ARRAY_BUFFER, placeableHandler.verticesArray, gl.STATIC_DRAW)

// See https://github.com/greggman/twgl.js/issues/132
wallBufferData = {
  aPos: {
    numComponents: 3,
    buffer: vBuffer,
    stride: placeableHandler.verticesArray.BYTES_PER_ELEMENT * (debugViewNormals ? 6 : 3),
    offset: 0,
  },
  indices: placeableHandler.indicesArray,
};

if ( debugViewNormals ) wallBufferData.aNorm = {
  numComponents: 3,
  buffer: vBuffer,
  stride: placeableHandler.verticesArray.BYTES_PER_ELEMENT * 6,
  offset: 3 * placeableHandler.verticesArray.BYTES_PER_ELEMENT,
};
bufferInfo = twgl.createBufferInfoFromArrays(gl, wallBufferData);

vertexArrayInfo = twgl.createVertexArrayInfo(gl, programInfo, bufferInfo);

// Draw
viewerLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(viewer)
targetLocation = CONFIG.GeometryLib.threeD.Point3d.fromTokenCenter(target);
camera.cameraPosition = viewerLocation;
camera.targetPosition = targetLocation;
camera.setTargetTokenFrustrum(target);
camera.perspectiveParameters = { fov: camera.perspectiveParameters.fov * 2, zFar: camera.perspectiveParameters.zFar + 50 }

gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)

uniforms = {
  uColor: new Float32Array([0, 0, 1, 1]),
  uPerspectiveMatrix: camera.perspectiveMatrix.arr,
  uLookAtMatrix: camera.lookAtMatrix.arr,
};

gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.useProgram(programInfo.program);

twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
twgl.setUniforms(programInfo, uniforms);

gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
// gl.bufferSubData(gl.ARRAY_BUFFER, 0, particleBuf); // If updating vertices
gl.bindVertexArray(vertexArrayInfo.vertexArrayObject);

instanceSet = new Set(placeableHandler.instanceIndexFromId.values())
// instanceSet.delete(placeableHandler.instanceIndexFromId.get(viewer.id))

offsetData = {
  index: {
    offsets: new Array(placeableHandler.numInstances),
    lengths: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.indices.length),
    sizes: (new Array(placeableHandler.numInstances)).fill(placeableHandler.geom.indices.byteLength),
  }
}
offsetData.index.sizes.forEach((ln, i) => offsetData.index.offsets[i] = ln * i)
WebGL2.drawSet(gl, instanceSet, offsetData)


// Testing
camera = drawableObj.camera
gl.viewport(0, 0,cgl.canvas.width, gl.canvas.height)
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

drawableObj = renderWalls.drawableObjects[0]
uniforms = drawableObj.uniforms
programInfo = drawableObj.programInfo
bufferInfo = drawableObj.bufferInfo
placeableHandler = drawableObj.placeableHandler
offsetData = drawableObj.offsetData
vertexBuffer = drawableObj.vertexBuffer
vertexArrayInfo = drawableObj.vertexArrayInfo

gl.useProgram(programInfo.program);
twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
twgl.setUniforms(programInfo, uniforms);
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
gl.bindVertexArray(vertexArrayInfo.vertexArrayObject);
instanceSet = new Set(placeableHandler.instanceIndexFromId.values())
WebGL2.drawSet(gl, instanceSet, offsetData)

gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
gl.enable(gl.DEPTH_TEST);
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
drawableObj.render()


// NOTE: Render simple texture
// See https://webgl2fundamentals.org/webgl/lessons/webgl-image-processing.html

vertexShaderSource = `#version 300 es

in vec2 a_position;
in vec2 a_texCoord;

// Used to pass in the resolution of the canvas
uniform vec2 u_resolution;

// Used to pass the texture coordinates to the fragment shader
out vec2 v_texCoord;

// all shaders have a main function
void main() {

  // convert the position from pixels to 0.0 to 1.0
  vec2 zeroToOne = a_position / u_resolution;

  // convert from 0->1 to 0->2
  vec2 zeroToTwo = zeroToOne * 2.0;

  // convert from 0->2 to -1->+1 (clipspace)
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

  // pass the texCoord to the fragment shader
  // The GPU will interpolate this value between points.
  v_texCoord = a_texCoord;
}
`;

fragmentShaderSource = `#version 300 es
precision highp float;

// our texture
uniform sampler2D u_image;

// the texCoords passed in from the vertex shader.
in vec2 v_texCoord;

// we need to declare an output for the fragment shader
out vec4 outColor;

void main() {
  outColor = texture(u_image, v_texCoord);
}
`;

tile = canvas.tiles.controlled[0]
image = tile.texture.baseTexture.resource.source;

image = new Image()
image.src = tile.document.texture.src
image.onload = function() {
  console.log(image);
  renderImage();
}

image = new Image();
image.src = "https://webgl2fundamentals.org/webgl/resources/leaves.jpg";  // MUST BE SAME DOMAIN!!!
image.onload = function() { console.log(image); }
image.onload = function() { renderImage(image); }


programInfo = twgl.createProgramInfo(gl, [vertexShaderSource, fragmentShaderSource]);
program = programInfo.program

// look up where the vertex data needs to go.
positionAttributeLocation = gl.getAttribLocation(program, "a_position");
texCoordAttributeLocation = gl.getAttribLocation(program, "a_texCoord");

// lookup uniforms
resolutionLocation = gl.getUniformLocation(program, "u_resolution");
imageLocation = gl.getUniformLocation(program, "u_image");

// Create a vertex array object (attribute state)
vao = gl.createVertexArray();

// and make it the one we're currently working with
gl.bindVertexArray(vao);

// Create a buffer and put a single pixel space rectangle in
// it (2 triangles)
positionBuffer = gl.createBuffer();

// Turn on the attribute
gl.enableVertexAttribArray(positionAttributeLocation);

// Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

// Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
let size = 2;          // 2 components per iteration
let type = gl.FLOAT;   // the data is 32bit floats
let normalize = false; // don't normalize the data
let stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
let offset = 0;        // start at the beginning of the buffer
gl.vertexAttribPointer(
    positionAttributeLocation, size, type, normalize, stride, offset);

// provide texture coordinates for the rectangle.
texCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0.0,  0.0,
    1.0,  0.0,
    0.0,  1.0,
    0.0,  1.0,
    1.0,  0.0,
    1.0,  1.0,
]), gl.STATIC_DRAW);

// Turn on the attribute
gl.enableVertexAttribArray(texCoordAttributeLocation);

// Tell the attribute how to get data out of texCoordBuffer (ARRAY_BUFFER)
size = 2;          // 2 components per iteration
type = gl.FLOAT;   // the data is 32bit floats
normalize = false; // don't normalize the data
stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
offset = 0;        // start at the beginning of the buffer
gl.vertexAttribPointer(
    texCoordAttributeLocation, size, type, normalize, stride, offset);

// Create a texture.
texture = gl.createTexture();

// make unit 0 the active texture uint
// (ie, the unit all other texture commands will affect
gl.activeTexture(gl.TEXTURE0 + 0);

// Bind it to texture unit 0' 2D bind point
gl.bindTexture(gl.TEXTURE_2D, texture);

// Set the parameters so we don't need mips and so we're not filtering
// and we don't repeat at the edges
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

// Upload the image into the texture.
let mipLevel = 0;               // the largest mip
let internalFormat = gl.RGBA;   // format we want in the texture
let srcFormat = gl.RGBA;        // format of data we are supplying
let srcType = gl.UNSIGNED_BYTE; // type of data we are supplying
gl.texImage2D(gl.TEXTURE_2D,
              mipLevel,
              internalFormat,
              srcFormat,
              srcType,
              image);


// resizeCanvasToDisplaySize(gl.canvas);

// Tell WebGL how to convert from clip space to pixels
gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

// Clear the canvas
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

// Tell it to use our program (pair of shaders)
gl.useProgram(program);

// Bind the attribute/buffer set we want.
gl.bindVertexArray(vao);

// Pass in the canvas resolution so we can convert from
// pixels to clipspace in the shader
gl.uniform2f(resolutionLocation, gl.canvas.width, gl.canvas.height);

// Tell the shader to get the texture from texture unit 0
gl.uniform1i(imageLocation, 0);

// Bind the position buffer so gl.bufferData that will be called
// in setRectangle puts data in the position buffer
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

// Set a rectangle the same size as the image.

setRectangle(gl, 0, 0, image.width, image.height);

// Draw the rectangle.
let primitiveType = gl.TRIANGLES;
offset = 0;
let count = 6;
gl.drawArrays(primitiveType, offset, count);


function resizeCanvasToDisplaySize(canvas, multiplier) {
  multiplier = multiplier || 1;
  const width  = canvas.clientWidth  * multiplier | 0;
  const height = canvas.clientHeight * multiplier | 0;
  if (canvas.width !== width ||  canvas.height !== height) {
    canvas.width  = width;
    canvas.height = height;
    return true;
  }
  return false;
}

function setRectangle(gl, x, y, width, height) {
  var x1 = x;
  var x2 = x + width;
  var y1 = y;
  var y2 = y + height;
  return new Float32Array([
     x1, y1,
     x2, y1,
     x1, y2,
     x1, y2,
     x2, y1,
     x2, y2,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
     x1, y1,
     x2, y1,
     x1, y2,
     x1, y2,
     x2, y1,
     x2, y2,
  ]), gl.STATIC_DRAW);
}


// NOTE: Another attempt to display a texture
// https://webgl2fundamentals.org/webgl/lessons/webgl-3d-textures.html
vertexShaderSource =
`#version 300 es
in vec4 a_position;

out vec2 v_texCoord;

void main() {
  gl_Position = a_position;
  v_texCoord = a_position.xy;
}
`;

fragmentShaderSource =
`#version 300 es
precision highp float;

uniform sampler2D u_image;
in vec2 v_texCoord;

out vec4 outColor;

void main() {
  outColor = texture(u_image, v_texCoord);
  // outColor = vec4(1.0, 0.0, 0.5, 1.0);
}
`;

// create GLSL shaders, upload the GLSL source, compile the shaders
vertexShader = WebGL2.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
fragmentShader = WebGL2.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

// Link the two shaders into a program
program = WebGL2.createProgram(gl, vertexShader, fragmentShader)

// Look up where the vertex data needs to go.
positionAttribLoc = gl.getAttribLocation(program, "a_position");

// Create a buffer and put three 2d clip space points in it
positionBuffer = gl.createBuffer(); // WebGLBuffer

// Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
positions = [
  0, 0,
  1, 0,
  0, 1,
  0, 1,
  1, 0,
  1, 1,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

// Create a vertex array object (attribute state)
vao = gl.createVertexArray();

// and make it the one we're currently working with
gl.bindVertexArray(vao);

// Turn on the attribute
gl.enableVertexAttribArray(positionAttribLoc);

// Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
size = 2;          // 2 components per iteration
type = gl.FLOAT;   // the data is 32bit floats
normalize = false; // don't normalize the data
stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
offset = 0;        // start at the beginning of the buffer
gl.vertexAttribPointer(positionAttribLoc, size, type, normalize, stride, offset);


// Create a texture.
var texture = gl.createTexture();

// make unit 0 the active texture uint
// (ie, the unit all other texture commands will affect
gl.activeTexture(gl.TEXTURE0 + 0);

// Bind it to texture unit 0' 2D bind point
gl.bindTexture(gl.TEXTURE_2D, texture);

// Set the parameters so we don't need mips and so we're not filtering
// and we don't repeat at the edges
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

// Upload the image into the texture.
var mipLevel = 0;               // the largest mip
var internalFormat = gl.RGBA;   // format we want in the texture
var srcFormat = gl.RGBA;        // format of data we are supplying
var srcType = gl.UNSIGNED_BYTE; // type of data we are supplying

async function loadImageBitmap(url, opts = {}) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await createImageBitmap(blob, opts);
}

// url = tile.document.texture.src;
// image = await loadImageBitmap(url, {
//   imageOrientation: "flipY",
//   premultiplyAlpha: "premultiply",
// });
image = tile.texture.baseTexture.resource.source;

gl.texImage2D(gl.TEXTURE_2D,
              mipLevel,
              internalFormat,
              srcFormat,
              srcType,
              image);

// Set render to canvas
WebGL2.bindFramebufferAndSetViewport(gl, null, gl.canvas.width, gl.canvas.height)

// gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
// Clear the canvas
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT);

// Tell it to use our program (pair of shaders)
gl.useProgram(program);

// Bind the attribute/buffer set we want.
gl.bindVertexArray(vao);

// draw
primitiveType = gl.TRIANGLES;
offset = 0;
count = 6;
gl.drawArrays(primitiveType, offset, count);

// NOTE: Test with twgl
vertexShaderSource =
`#version 300 es
in vec2 a_position;

out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_position.xy;
}
`;

fragmentShaderSource =
`#version 300 es
precision highp float;

uniform sampler2D u_image;
in vec2 v_texCoord;

out vec4 outColor;

void main() {
  outColor = texture(u_image, v_texCoord);
  // outColor = vec4(1.0, 0.0, 0.5, 1.0);
}
`;

// Link the two shaders into a program
programInfo = twgl.createProgramInfo(gl, [vertexShaderSource, fragmentShaderSource])
program = programInfo.program

const bufferData = {
  a_position: {
    numComponents: 2,
    data: [
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ],
  }
}
bufferInfo = twgl.createBufferInfoFromArrays(gl, bufferData);
vertexArrayInfo = twgl.createVertexArrayInfo(gl, programInfo, bufferInfo);

image = tile.texture.baseTexture.resource.source;
textureOpts = {
  target: gl.TEXTURE_2D,
  level: 0,
  minMag: gl.NEAREST,
  wrap: gl.CLAMP_TO_EDGE,
  internalFormat: gl.RGBA,
  format: gl.RGBA,
  type: gl.UNSIGNED_BYTE,
  src: image,
}
texture = twgl.createTexture(gl, textureOpts)
uniforms = { u_image: texture }

// Set render to canvas
WebGL2.bindFramebufferAndSetViewport(gl, null, gl.canvas.width, gl.canvas.height)

// gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
// Clear the canvas
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT);

gl.useProgram(programInfo.program);
twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
gl.bindVertexArray(vertexArrayInfo.vertexArrayObject);
twgl.setUniforms(programInfo, uniforms);


// draw
primitiveType = gl.TRIANGLES;
offset = 0;
count = 6;
gl.drawArrays(primitiveType, offset, count);

