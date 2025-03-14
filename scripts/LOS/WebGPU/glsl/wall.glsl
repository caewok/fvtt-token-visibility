struct VertexIn {
  @location(0) pos: vec4f,
  @builtin(vertex_index) vertexIndex : u32,
}

struct VertexOut {
  @builtin(position) pos: vec4f,
}

struct CameraUniforms {
  perspectiveM: mat4x4f,
  lookAtM: mat4x4f,
  offsetM: mat4x4f,
}
@group(0) @binding(0) var<uniform> camera: CameraUniforms;

// ----- Vertex shader ----- //
@vertex
fn vertexMain(in: VertexIn) -> VertexOut {
  var out: VertexOut;
  // let vertexPos = camera.lookAtM * in.pos;
  // out.pos = camera.offsetM * camera.perspectiveM * vertexPos;

  let pos = array(
    vec2f( 0.0,  0.5),  // top center
    vec2f(-0.5, -0.5),  // bottom left
    vec2f( 0.5, -0.5)   // bottom right
  );
  out.pos = vec4f(pos[vertexIndex], 0.0, 1.0);
  return out;
}

// ----- Fragment shader ----- //
// Some hardcoded lighting for use with debugging.
const baseColor = vec4f(1.0, 0.0, 0.0, 1.0);

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  return baseColor;
}
