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
  WallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
} = api.webgpu;

let {
  WebGL2,
  NonDirectionalWallInstanceHandlerWebGL2,
  DirectionalWallInstanceHandlerWebGL2,
  TileInstanceHandlerWebGL2,
  TokenInstanceHandlerWebGL2,
} = api.webgl;

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



gl = canvas.app.renderer.gl

glCanvas = new OffscreenCanvas(1, 1);
gl = glCanvas.getContext('webgl2');

popout = new Area3dPopoutCanvas({ width: 400, height: 475, resizable: false })
await popout._render(true, { contextType: "webgl2"});
gl = popout.context




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

