struct VertexIn {
  @location(0) pos: vec3f,

  #if ${debugViewNormals}
    @location(1) norm: vec3f,
    @location(2) uv0: vec2f,
  #else
    @location(1) uv0: vec2f,
  #endif
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
}

struct VertexOut {
  @builtin(position) pos: vec4f,

  #if ${debugViewNormals}
    @location(0) norm: vec3f,
    @location(1) uv0: vec2f,
  #else
    @location(0) uv0: vec2f,
  #endif
  // @location(2) @interpolate(flat) v: u32,
}

struct CameraUniforms {
  perspectiveM: mat4x4f,
  lookAtM: mat4x4f,
}
@group(0) @binding(0) var<uniform> camera: CameraUniforms;

struct Material {
  color: vec4f,
}
@group(1) @binding(0) var<uniform> material: Material;

struct Instance {
  model: mat4x4f,
}
@group(2) @binding(0) var<storage, read> instances: array<Instance>;

@group(3) @binding(0) var tileSampler: sampler;
@group(3) @binding(1) var tileTexture: texture_2d<f32>;

// ----- Vertex shader ----- //
@vertex fn vertexMain(in: VertexIn) -> VertexOut {
  var out: VertexOut;

  // For debugging. Set drawIndexed(3).
  /*
  let pos = array(
    vec2f( 0.0,  0.5),  // top center
    vec2f(-0.5, -0.5),  // bottom left
    vec2f( 0.5, -0.5)   // bottom right
  );
  out.pos = vec4f(pos[in.vertexIndex], 0.0, 1.0);
  */

  // For debugging using vertices set between -1 and 1.
  // out.pos = vec4f(in.pos, 1.0);
  let instanceIndex = in.instanceIndex;
  let model = instances[instanceIndex].model;

  let cameraPos = camera.lookAtM * model * vec4f(in.pos, 1.0);
  out.pos = camera.perspectiveM * cameraPos;

  // Transform normals to view space.
  // Need to avoid scaling.
  #if ${debugViewNormals}
    out.norm = normalize((camera.lookAtM * model * vec4f(in.norm, 0)).xyz);
  #endif

  // Pass through the uvs.
  out.uv0 = in.uv0;

  // out.v = in.vertexIndex / 6;

  return out;
}

// ----- Fragment shader ----- //

// Mark tile pixels less than this alpha as clear.
const alphaValue = 0.75;

// Some hardcoded lighting
const lightDir = normalize(vec3f(0.25, 0.5, 1.0));
const lightColor = vec3f(1, 1, 1);
const ambientColor = vec3f(0.3, 0.3, 0.3);
const baseColor = vec4f(0.0, 0.0, 1.0, 1.0);

@fragment fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  /*var out = vec4f(0.0, 0.0, 0.0, 1.0);
  switch ( in.v ) {
    case 0: { out.r = 1.0; } // Red, top
    case 1: { out.g = 1.0; } // Green, bottom
    case 2: { out.b = 1.0; } // Blue
    case 3: { out.r = 1.0; out.g = 1.0; } // Yellow
    case 4: { out.g = 1.0; out.b = 1.0; } // Cyan (light blue)
    case 5: { out.r = 1.0; out.b = 1.0; } // Magenta
    default: { out = vec4f(1.0); } // White
  }
  return out;
  */
  // return vec4f(in.uv0.x, in.uv0.y, 1.0, 1.0);

  let texColor = textureSample(tileTexture, tileSampler, in.uv0);
  var baseColor = texColor;

  // Use discard so we don't have to deal with transparency for the textures.
  if ( texColor.a < alphaValue ) { discard; }

  #if ${debugViewNormals}
    // Extremely simple directional lighting model to give the model some shape.
    let N = normalize(in.norm);
    let NDotL = max(dot(N, lightDir), 0.0);
    let surfaceColor = (baseColor.rgb * ambientColor) + (baseColor.rgb * NDotL);
    baseColor = vec4(surfaceColor, baseColor.a);
  #else
    baseColor = material.color;
    fragColor.a = texColor.a; // Already discarded low alphas above.
    // baseColor.a = step(alphaValue, texColor.a); // (edge, x) => returns 1.0 if edge ≤ x
  #endif

  return baseColor;
}