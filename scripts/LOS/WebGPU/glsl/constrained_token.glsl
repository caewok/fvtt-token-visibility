struct VertexIn {
  @location(0) pos: vec3f,

  #if ${debugViewNormals}
  @location(1) norm: vec3f,
  #endif

  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
}

struct VertexOut {
  @builtin(position) pos: vec4f,

  #if ${debugViewNormals}
  @location(0) norm: vec3f,
  #endif

  // @location(1) @interpolate(flat) v: u32,
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

// ----- Vertex shader ----- //
@vertex fn vertexMain(in: VertexIn) -> VertexOut {
  var out: VertexOut;

  let cameraPos = camera.lookAtM * vec4f(in.pos, 1.0);
  out.pos = camera.perspectiveM * cameraPos;

  // Transform normals to view space.
  // Need to avoid scaling.
  #if ${debugViewNormals}
  out.norm = normalize((camera.lookAtM * vec4f(in.norm, 0)).xyz);
  #endif

  // out.v = in.vertexIndex / 6;

  return out;
}

// ----- Fragment shader ----- //

// Some hardcoded lighting
const lightDir = normalize(vec3f(0.25, 0.5, 1.0));
const lightColor = vec3f(1, 1, 1);
const ambientColor = vec3f(0.03, 0.03, 0.03);

@fragment fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  /*
  var out = vec4f(0.0, 0.0, 0.0, 1.0);
  switch ( in.v ) {
    case 0: { out.r = 1.0; } // Red, south
    case 1: { out.g = 1.0; } // Green, north
    case 2: { out.b = 1.0; } // Blue, west
    case 3: { out.r = 1.0; out.g = 1.0; } // Yellow, east
    case 4: { out.g = 1.0; out.b = 1.0; } // Cyan (light blue), top
    case 5: { out.r = 1.0; out.b = 1.0; } // Magenta, bottom
    default: { out = vec4f(1.0); } // White
  }
  return out;
  */

  // return vec4f(in.uv0.x, in.uv0.y, 1.0, 1.0);

  var baseColor = material.color;
  // return baseColor;

  // Extremely simple directional lighting model to give the model some shape.
  #if ${debugViewNormals}
    let N = normalize(in.norm);
    let NDotL = max(dot(N, lightDir), 0.0);
    let surfaceColor = (baseColor.rgb * ambientColor) + (baseColor.rgb * NDotL);
    baseColor = vec4(surfaceColor, baseColor.a);
  #endif

  return baseColor;
}