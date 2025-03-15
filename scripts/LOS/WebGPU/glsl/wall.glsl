struct VertexIn {
  @location(0) pos: vec3f,
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
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

  let cameraPos = camera.lookAtM * vec4f(in.pos, 1.0);
  out.pos = camera.offsetM * camera.perspectiveM * cameraPos;

  return out;
}

// ----- Fragment shader ----- //
const baseColor = vec4f(0.0, 0.0, 1.0, 1.0);

@fragment fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  return baseColor;
}