// Test summing a 128x128 RGBA8 texture
api = game.modules.get("tokenvisibility").api
twgl = api.webgl.twgl


// Don't use reserved word "canvas"
offscreen1 = new OffscreenCanvas(1, 1);
gl = offscreen1.getContext("webgl2");
gl.getExtension("EXT_float_blend");
gl.getExtension("EXT_color_buffer_float");


width = 128
height = 128
nPixels = width * height;
data = new Uint8Array(nPixels * 4);
numRed = 0;
for (let i = 0; i < nPixels; ++i) {
  const isRed = (Math.random() > 0.5);
  numRed += isRed;
  data[i * 4 + 0] = isRed ? 255 : 0; // red
  data[i * 4 + 1] = 0;
  data[i * 4 + 2] = 0;
  data[i * 4 + 3] = 255;
}
numRed

tex = twgl.createTexture(gl, {
  src: data,
  width,
  height,
  internalFormat: gl.RGBA,
  format: gl.RGBA,
  type: gl.UNSIGNED_BYTE,
  minMag: gl.NEAREST,
  wrap: gl.CLAMP_TO_EDGE,
});

async function loadImage(url) {
  return new Promise((resolve, reject) => {
  	const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = reject;
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

img = await loadImage("https://i.imgur.com/9WFTldz.jpg");
offscreen2 = new OffscreenCanvas(img.width, img.height)
ctx = offscreen2.getContext("2d")
ctx.drawImage(img, 0, 0);
imgData = new Uint8Array(ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data)

// Convert to 16 bit values
imgData16 = new Uint16Array(ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data)
for ( let i = 0, iMax = imgData16.length; i < iMax; i += 1 ) imgData16[i] *= 256;

offscreen2 = null;
numRed = imgData.reduce((acc, curr, currIdx) => {
  if ( (currIdx % 4) !== 0 ) return acc;
  return acc + (curr > 0.5 * 255)
}, 0)


data = imgData16
width = img.width
height = img.height

tex = twgl.createTexture(gl, {
  src: data,
  width,
  internalFormat: gl.RGBA16UI,
  minMag: gl.NEAREST,
  wrap: gl.CLAMP_TO_EDGE,
});

countVS =
`#version 300 es

in vec4 position;
void main() {
  gl_Position = position;
}
`;

countFS =
`#version 300 es
precision mediump float;


uniform sampler2D uTexture;
out vec4 outColor;

const int mipLevel = 0;

void main() {
  vec4 sumColor = vec4(0.0);

  // Determine texture size.
  ivec2 size = textureSize(uTexture, mipLevel);
  for ( int y = 0; y < size.y; y += 1 ) {
    for ( int x = 0; x < size.x; x += 1 ) {
      ivec2 uv = ivec2(x, y);
      vec4 texColor = texelFetch(uTexture, uv, mipLevel);
      bvec4 isSaturated = greaterThan(texColor, vec4(0.5));
      sumColor += vec4(isSaturated);
    }
  }
  outColor = sumColor;
}
`;




quadBufferInfo = twgl.primitives.createXYQuadBufferInfo(gl)

sumFBInfo = twgl.createFramebufferInfo(gl, [
  {
    internalFormat: gl.RGBA32F,
    minMag: gl.NEAREST,
    wrap: gl.CLAMP_TO_EDGE
  },
], 1, 1);

twgl.bindFramebufferInfo(gl, sumFBInfo);
// gl.clearColor(0, 0, 0, 0);
// gl.clear(gl.COLOR_BUFFER_BIT);

sumProgramInfo = twgl.createProgramInfo(gl, [countVS, countFS]);
gl.useProgram(sumProgramInfo.program);
twgl.setBuffersAndAttributes(gl, sumProgramInfo, quadBufferInfo);
twgl.setUniforms(sumProgramInfo, { uTexture: tex });

// Clear the render texture

twgl.drawBufferInfo(gl, quadBufferInfo);
gl.flush()

bufferData = new Float32Array(1 * 1 * 4);
gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, bufferData);
bufferData


// Build histogram using blending. But use an RGBA8 texture
// histVS = `#version 300 es
// precision highp float;
// precision highp sampler2D;
//
// uniform sampler2D uTexture;
// uniform uvec4 uColorMult;
//
// void main() {
//   const int mipLevel = 0;
//   ivec2 size = textureSize(uTexture, mipLevel);
//
//   // based on an id (0, 1, 2, 3 ...) compute the pixel x, y for the source image
//   ivec2 pixel = ivec2(
//       gl_VertexID % size.x,
//       gl_VertexID / size.x);
//
//   // get the pixels but 0 out channels we don't want
//   // Modify 0-1 to 0-255 to indicate distinct colors.
//   uvec4 color = uint(texelFetch(uTexture, pixel, mipLevel) * 255.0) * uColorMult;
//
//   // add up all the channels. Since 3 are zeroed out we'll get just one channel
//   uint colorSum = color.r + color.g + color.b + color.a;
//
//   // set the position to be over a single pixel in the 256x256 destination texture
//   uvec2 pos = uvec2(
//      colorSum % 256u,
//      colorSum / 256u);
//
//   gl_Position = vec4(((vec2(pos) + 0.5) / 256.0) * 2.0 - 1.0, 0.0, 1.0);
//   gl_PointSize = 1.0;
// }
// `;

histVS = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTexture;

out vec4 color;

void main() {
  const int mipLevel = 0;
  ivec2 size = textureSize(uTexture, mipLevel);

  // based on an id (0, 1, 2, 3 ...) compute the pixel x, y for the source image
  ivec2 pixel = ivec2(
      gl_VertexID % size.x,
      gl_VertexID / size.x);

  // get the pixels but 0 out channels we don't want
  // Modify 0-1 to 0-255 to indicate distinct colors.
  color = texelFetch(uTexture, pixel, mipLevel);

  // set the position to be over a single pixel in the 256x256 destination texture
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

histFS =
`#version 300 es
precision highp float;

in vec4 color;

out vec4 fragColor;
void main() {
  fragColor = vec4(color.r > 0.5 ? 1.0 : 0.0, 0.0, 0.0, 0.0);
}
`;

histProgramInfo = twgl.createProgramInfo(gl, [histVS, histFS]);
histFBi = twgl.createFramebufferInfo(gl, [
  {
    internalFormat: gl.R32F,
    minMag: gl.NEAREST,
    wrap: gl.CLAMP_TO_EDGE,
  },
], 1, 1)

// we're going to render a gl.POINT for each pixel in the source image
// That point will be positioned based on the color of the source image
// we're just going to render vec4(1,1,1,1). This blend function will
// mean each time we render to a specific point that point will get
// incremented by 1.
gl.blendFunc(gl.ONE, gl.ONE);
gl.enable(gl.BLEND);
gl.useProgram(histProgramInfo.program);
// bind the framebufer and set the viewport
twgl.bindFramebufferInfo(gl, histFBi);

// render each channel separately since we can only position each POINT
// for one channel at a time.

// for (let channel = 0; channel < 4; ++channel) {
channel = 0
  gl.colorMask(channel === 0, channel === 1, channel === 2, channel === 3);
  twgl.setUniforms(histProgramInfo, {
    uTexture: tex,
  });
  // no buffer data needed in WebGL2 as we can
  // use gl_VertexID
  gl.drawArrays(gl.POINTS, 0, width * height);
// }

// Reset
gl.colorMask(true, true, true, true);
gl.blendFunc(gl.ONE, gl.ZERO);
gl.disable(gl.BLEND);
gl.flush()

// Pull data
bufferData = new Float32Array(1 * 1 * 4);
gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, bufferData);
bufferData

// For R32F, use gl.RED
// For RG32F, use gl.RG`
// R16F appears not to work.

bufferData.reduce((acc, curr) => acc + curr, 0)
uniqueIdx = [];
for ( let i = 0, iMax = bufferData.length; i < iMax; i += 4 ) {
  const px = bufferData[i];
  if ( px > 0 ) uniqueIdx.push({ i, px })
}






// See https://stackoverflow.com/questions/58015221/how-to-create-a-histogram-in-webgl2-using-16-bit-data
// https://webgl2fundamentals.org/webgl/lessons/webgl-qna-get-the-size-of-a-point-for-collision-checking.html
// Use a 1x1 float destination.
// Use gl.POINTS to call the shader for each pixel.
// Use additive blending to sum all the values.

/*
If multiple channels desired, set a multiplier:
uniform uvec4 u_colorMult;
...
uvec4 color = texelFetch(u_texture, pixel, mipLevel) * u_colorMult;
uint colorSum = color.r + color.g + color.b + color.a;
*/

vs =
`#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTexture;
const int mipLevel = 0;

out vec4 color;

void main() {
  ivec2 size = textureSize(uTexture, mipLevel);

  // Based on an id (0, 1, 2, 3, ...) compute the pixel x,y for the source image.
  ivec2 pixel = ivec2(
    gl_VertexID % size.x,
    gl_VertexID / size.x);

  // Get the desired color.
  color = texelFetch(uTexture, pixel, mipLevel);

  vec2 outputPixel = vec2(0.0, 0.0);

  // Set the position to be over the single output pixel.
  gl_Position = vec4((outputPixel + 0.5) / 128.0 * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

fs =
`#version 300 es
precision highp float;

in vec4 color;
out vec4 fragColor;

void main() {
  // For simple red calculation, set the red channel alone.
  // 128x128 texture has maximum 2^14 (16384) red values.
  // So have to use float render texture (blending doesn't work with int textures).

  // Can do other calculations based on obstacle colors here.
  // TODO: Does alpha need to be set?
  fragColor = vec4(color.r, 0.0, 0.0, 1.0);
}
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.debug(source);
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

function checkFramebufferStatus(gl, framebuffer) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    let errorMessage = `Framebuffer error: ${status}`;
    switch (status) {
      case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
        errorMessage = "Framebuffer incomplete: Attachment is missing or invalid";
        break;
      case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
        errorMessage = "Framebuffer incomplete: Missing attachment";
        break;
      case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
        errorMessage = "Framebuffer incomplete: Dimensions are mismatched";
        break;
      case gl.FRAMEBUFFER_UNSUPPORTED:
        errorMessage = "Framebuffer incomplete: Unsupported format";
        break;
      case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE:
        errorMessage = "Framebuffer incomplete: Multisample settings are inconsistent";
        break;
      default:
        errorMessage = `Framebuffer error: ${status}`;
    }
    console.error(errorMessage);
  }
  return status === gl.FRAMEBUFFER_COMPLETE;
}





// Create the test RGBA8 input texture
inputTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, inputTexture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texSize, texSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

// Test
fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D, inputTexture, 0);
bufferData = new Uint8Array(128 * 128 * 4);
gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, bufferData);
gl.bindFramebuffer(gl.FRAMEBUFFER, null)

program = createProgram(gl, vs, fs)

// Create the 1x1 render texture.
// TODO: Could use gl.RED or gl.RG if we only need one or two values.
renderTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, renderTexture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 128, 128, 0, gl.RGBA, gl.FLOAT, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

// Build the framebuffer
fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTexture, 0);
checkFramebufferStatus(gl, fb)


gl.viewport(0, 0, 128, 128);
gl.useProgram(program);

gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, inputTexture);

// gl.bindFramebuffer(gl.FRAMEBUFFER, fb); If needed

// Clear the render texture
gl.clearColor(0, 0, 0, 0);
gl.clear(gl.COLOR_BUFFER_BIT);

// Turn on additive blending

gl.blendEquation(gl.FUNC_ADD);
const src = gl.ONE;
const dst = gl.ONE;
gl.blendFunc(src, dst);
gl.enable(gl.BLEND)

// Reset
gl.blendFunc(gl.ONE, gl.ZERO);
gl.disable(gl.BLEND);

// For each point in the input texture, draw using additive blending to the destination point.
numPixels = inputTexture.width * inputTexture.height;
gl.drawArrays(gl.POINTS, 0, numPixels);

// Read the result.
// gl.bindFramebuffer(gl.FRAMEBUFFER, fb); // If needed.
bufferData = new Float32Array(128 * 128 * 4);
gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.FLOAT, bufferData);
bufferData



