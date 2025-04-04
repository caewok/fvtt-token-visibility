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
  GeometryTokenDesc,
  GeometryTileDesc,
  GeometryConstrainedTokenDesc,
  WallInstanceHandler,
  TileInstanceHandler,
  TokenInstanceHandler,
} = api.webgpu;

WebGL2 = api.webgl.WebGL2;



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




// Test drawing triangle
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



// Test drawing target token.
debugViewNormals = false
camera = new Camera();
placeableHandler = new TokenInstanceHandler("sight");
geom = new GeometryConstrainedTokenDesc({ token: target, addNormals: debugViewNormals, addUVs: false })
vertexShaderSource = await WebGL2.sourceFromGLSLFile("constrained_token_vertex", { debugViewNormals: Number(debugViewNormals) })
fragmentShaderSource = await WebGL2.sourceFromGLSLFile("wall_fragment", { debugViewNormals: 0 })
vertexShader = WebGL2.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
fragmentShader = WebGL2.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
program = WebGL2.createProgram(gl, vertexShader, fragmentShader)


// Set vertex buffer
posAttribLoc = gl.getAttribLocation(program, "aPos")
posBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
gl.bufferData(gl.ARRAY_BUFFER, geom.vertices, gl.STATIC_DRAW)

// Link vao to the vertex buffer
vao = gl.createVertexArray()
gl.bindVertexArray(vao)
gl.enableVertexAttribArray(posAttribLoc)
size = 3
type = gl.FLOAT
stride = 0
offset = 0
normalize = false
gl.vertexAttribPointer(posAttribLoc, size, type, normalize, stride, offset);

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
//camera.setTargetTokenFrustrum(target);

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

// Draw (all of them)
primitiveType = gl.TRIANGLES;
offset = 0;
count = geom.indices.length;
indexType = gl.UNSIGNED_SHORT
gl.drawElements(primitiveType, count, indexType, offset)



// Set normals
if ( debugViewNormals ) {}



vertexShader = WebGL2.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);

this.module = await WebGPUShader.fromGLSLFile(device, this.constructor.shaderFile, `${this.constructor.name} Shader`, { debugViewNormals });




