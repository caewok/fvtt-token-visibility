struct VertexIn {
  @builtin(instance_index) instanceIndex: u32,
  @location(${AttribLocation.position}) pos: vec4f,
  @location(${AttribLocation.normal}) norm: vec3f,
  @location(${AttribLocation.texcoord0}) uv0: vec2f,
}

struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) norm: vec3f,
  @location(1) uv0: vec2f,
}

struct CameraUniforms {
  projection: mat4x4f,
  view: mat4x4f,
  frustum: array<vec4f, 6>,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;

struct Material {
  color: vec4f,
}

@group(1) @binding(0) var<uniform> material: Material;

@group(2) @binding(0) var<storage, read> instances: array<mat4x4f>;

// ----- Vertex shader ----- //
@vertex
fn vertexMain(in: VertexIn) -> VertexOut {
  var out: VertexOut;
  let instanceIndex = in.instanceIndex;
  let model = instances[instanceIndex];
  out.pos = camera.projection * camera.view * model * in.pos;
  out.norm = normalize((camera.view * model * vec4f(in.norm, 0)).xyz);
  out.uv0 = in.uv0;
  return out;
}

// ----- Fragment shader ----- //
// Some hardcoded lighting for use with debugging.
const lightDir = normalize(vec3f(0.25, 0.5, 1.0));
const lightColor = vec3f(1.0, 1.0, 1.0);
const ambientColor = vec3f(0.03, 0.03, 0.03);

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  let baseColor = material.color;
  let N = normalize(in.norm);

  // An extremely simple directional lighting model, to give the obstacles some shape.
  let L = lightDir;
  let NDotL = max(dot(N, L), 0.0);
  let surfaceColor = (baseColor.rgb * ambientColor) + (baseColor.rgb * NDotL);

  return vec4(surfaceColor, baseColor.a);
}
