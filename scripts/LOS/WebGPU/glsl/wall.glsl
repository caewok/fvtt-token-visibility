struct VertexIn {
  @location(0) pos: vec3f,
  @location(1) norm: vec3f,
  @location(2) uv0: vec2f,
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
}

struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) norm: vec3f,
  @location(1) uv0: vec2f,
}

struct CameraUniforms {
  perspectiveM: mat4x4f,
  lookAtM: mat4x4f,
  offsetM: mat4x4f,
}
@group(0) @binding(0) var<uniform> camera: CameraUniforms;

struct Instance {
  pos: vec2f,
  elev: vec2f,
  rot: f32,
  len: f32,
}
@group(1) @binding(0) var<storage, read> instances: array<Instance>;


/**
 * Construct a matrix representing a translation by given x,y,z.
 * @param {vec3f} v
 * @returns {mat4x4f}
 */
fn translationMatrix(v: vec3f) -> mat4x4f {
  // Column-wise
  // See glMatrix mat4.
  return mat4x4f(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    v.x, v.y, v.z, 1
  );

  /*
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [x, y, z, 1]
  */
}

/**
 * Construct a matrix representing a a scaling along x, y, z.
 * Note that to avoid scaling, must set each value to 1 (not 0).
 * @param {vec3f} v
 * @returns {mat4x4f}
 */
fn scaleMatrix(v: vec3f) -> mat4x4f {
  // Column-wise
  // See glMatrix mat4.
  return mat4x4f(
    v.x, 0, 0, 0,
    0, v.y, 0, 0,
    0, 0, v.z, 0,
    0, 0, 0, 1
  );

  /*
  [x, 0, 0, 0],
  [0, y, 0, 0],
  [0, 0, z, 0],
  [0, 0, 0, 1]
  */
}

/**
 * Construct a matrix representing rotation around the z axis.
 * @param {f32} angle
 */
fn rotationZMatrix(angle: f32) -> mat4x4f {
  let c = cos(angle);
  let s = sin(angle);

  // Column-wise
  // See glMatrix mat4.
  return mat4x4f(
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  );

  /*
  [c, s, 0, 0],
  [-s, c, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1]
  */
}

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
  let model = instances[instanceIndex];

  // Construct the model matrix.
  // Add in translate to center to 0,0 if elevations do not match.
  // e.g., bottom elevation -1e05, top elevation 200.
  let top = model.elev.x;
  let bottom = model.elev.y;
  var z = 0.0;
  var scaleZ = 1.0;
  if ( top != bottom ) {
    z = ((0.5 * top) + (0.5 * bottom));
    scaleZ = top - bottom;
  }
  let tMat = translationMatrix(vec3f(model.pos, z));
  let sMat = scaleMatrix(vec3f(model.len, 1.0, scaleZ));
  let rMat = rotationZMatrix(model.rot);
  let modelMat = tMat * rMat * sMat;

  let cameraPos = camera.lookAtM * modelMat * vec4f(in.pos, 1.0);
  out.pos = camera.offsetM * camera.perspectiveM * cameraPos;

  // Transform normals to view space.
  // Need to avoid scaling.
  // TODO: Also use offsetM?
  out.norm = normalize((camera.lookAtM * tMat * rMat * vec4f(in.norm, 0)).xyz);

  // Pass through the uvs.
  out.uv0 = in.uv0;

  return out;
}

// ----- Fragment shader ----- //

// Some hardcoded lighting
const lightDir = normalize(vec3f(0.25, 0.5, 1.0));
const lightColor = vec3f(1, 1, 1);
const ambientColor = vec3f(0.03, 0.03, 0.03);
const baseColor = vec4f(0.0, 0.0, 1.0, 1.0);

@fragment fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  return baseColor;
  // let N = normalize(in.norm); // Unneeded as norm is already normalized.

  // Extremely simple directional lighting model to give the model some shape.
  /*
  let NDotL = max(dot(in.norm, lightDir), 0.0);
  let surfaceColor = (baseColor.rgb * ambientColor) + (baseColor.rgb * NDotL);

  return vec4(surfaceColor, baseColor.a);
  */
}