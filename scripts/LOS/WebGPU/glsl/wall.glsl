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

struct Instance {
  model: mat4x4f,
}
@group(2) @binding(0) var<storage, read> instances: array<Instance>;

struct CulledInstances {
  instances: array<u32>,
}
@group(3) @binding(0) var<storage, read> culled: CulledInstances;

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

  let instanceIndex = culled.instances[in.instanceIndex]; // Culled version.
  // let instanceIndex = in.instanceIndex; // Non-culled version.
  let model = instances[instanceIndex].model;


  let cameraPos = camera.lookAtM * model * vec4f(in.pos, 1.0);
  out.pos = camera.perspectiveM * cameraPos;

  // Transform normals to view space.
  // Need to avoid scaling.
  #if ${debugViewNormals}
  out.norm = normalize((camera.lookAtM * model * vec4f(in.norm, 0)).xyz);
  #endif

  // See https://stackoverflow.com/questions/17401922/transforming-normal-to-view-space-in-vertex-shader
  // Need to pass the transpose(inverse(model)) matrix.
  // Alternatively, pass a model matrix without the scaling.
  // Or could construct the model matrix from components here, although that is expensive for many vertices (instances).
  // https://stackoverflow.com/questions/29008847/normal-matrix-for-non-uniform-scaling/29015501#29015501
  /*
  var matN = mat4x4f(vec4f(model[0].xyz, 0.0), vec4f(model[1].xyz, 0.0), vec4f(model[2].xyz, 0.0), vec4f(0.0, 0.0, 0.0, 1.0));
  matN[0] /= dot(matN[0], matN[0]);
  matN[1] /= dot(matN[1], matN[1]);
  matN[2] /= dot(matN[2], matN[2]);
  out.norm = normalize((camera.lookAtM * matN * vec4f(in.norm, 0)).xyz);
  */

  // out.v = in.vertexIndex / 6;

  return out;
}

// ----- Fragment shader ----- //

// Some hardcoded lighting
const lightDir = normalize(vec3f(0.25, 0.5, 1.0));
const lightColor = vec3f(1, 1, 1);
const ambientColor = vec3f(0.1, 0.1, 0.1);
const baseColor = vec4f(0.0, 0.0, 1.0, 1.0);

@fragment fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  /*

  var out = vec4f(0.0, 0.0, 0.0, 1.0);
  switch ( in.v ) {
    case 0: { out.r = 1.0; } // Red, south
    case 1: { out.g = 1.0; } // Green, north
    case 2: { out.b = 1.0; } // Blue
    case 3: { out.r = 1.0; out.g = 1.0; } // Yellow
    case 4: { out.g = 1.0; out.b = 1.0; } // Cyan (light blue)
    case 5: { out.r = 1.0; out.b = 1.0; } // Magenta
    default: { out = vec4f(1.0); } // White
  }
  return out;
  */

  var baseColor = material.color;

  // Extremely simple directional lighting model to give the model some shape.
  #if ${debugViewNormals}
    let N = normalize(in.norm);
    let NDotL = max(dot(N, lightDir), 0.0);
    let surfaceColor = (baseColor.rgb * ambientColor) + (baseColor.rgb * NDotL);
    baseColor = vec4(surfaceColor, baseColor.a);
  #endif

  return baseColor;
}