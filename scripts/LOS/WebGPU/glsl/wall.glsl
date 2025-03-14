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

struct InstanceData {
  pos: vec2f,
  elev: vec2f,
  rot: f32,
  len: f32,
}

@group(1) @binding(0) var<storage, read> instances: array<InstanceData>;

/**
 * Rotation matrix for a given angle rotating around Z axis.
 * @param {f32} angle    Angle in radians
 * @returns {mat4x4f}
 */
fn rotationZMatrix(angle: f32) -> mat4x4f {
  let c = cos(angle);
  let s = sin(angle);
  return mat4x4(
    // Note: column-wise
    c, -s, 0.0, 0.0,
    s, c, 0.0, 0.0,
    0.0, 0.0, 1.0, 1.0,
    0.0, 0.0, 0.0, 1.0
  );

  /*
  [c, s, 0, 0],
  [-s, c, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1]
  */
}

/**
 * Scale matrix for a given set of values.
 * @param {vec3f} size
 * @returns {mat4x4f}
 */
fn scaleMatrix(size: vec3f) -> mat4x4f {
  return mat4x4(
    // Note: column-wise
    size.x, 0.0, 0.0, 0.0,
    0.0, size.y, 0.0, 0.0,
    0.0, 0.0, size.z, 0.0,
    0.0, 0.0, 0.0, 1.0
  );

  /*
  [x, 0, 0, 0],
  [0, y, 0, 0],
  [0, 0, z, 0],
  [0, 0, 0, 1]
  */
}

/**
 * Translation matrix for given x, y, z movement.
 * @param {f32} x
 * @param {f32} y
 * @param {f32} z
 * @returns {mat4x4f}
 */
fn translationMatrix(pos: vec3f) -> mat4x4f {
  return mat4x4(
    1.0, 0.0, 0.0, pos.x,
    0.0, 1.0, 0.0, pos.y,
    0.0, 0.0, 1.0, pos.z,
    0.0, 0.0, 0.0, 1.0
  );

  /*
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [x, y, z, 1]
  */
}

// ----- Vertex shader ----- //
@vertex
fn vertexMain(in: VertexIn) -> VertexOut {
  var out: VertexOut;
  let instanceIndex = in.instanceIndex;
  let model = instances[instanceIndex];

  // Construct the model matrix.
  // Add in a translate to move back to 0,0 if the elevations do not match.
  // E.g., top = 20, bottom = -1e06. Wall is 20 + 1e06 = 1000020 high.
  //   Before translation, it is at 1000020 * 0.5 = 500010 top / -500010 bottom.
  //   Move 500010 - 20 down (-(topHeight - top) == top - topHeight.
  //  topHeight = (top - bottom) * 0.5;
  //  z = top !== bottom ? (top - topHeight) : 0;
  let top = model.elev.x;
  let bottom = model.elev.y;
  var z = 0.0;
  var scaleZ = 1.0;
  if ( top != bottom ) {
    z = ((0.5 * top) + (0.5 * bottom));
    scaleZ = top - bottom;
  }
  let tMat = translationMatrix(vec3f(model.pos, 0.0, z));
  let sMat = scaleMatrix(vec3f(model.len, 1.0, scaleZ));
  let rMat = rotationZMatrix(model.rot);
  let modelMat = tMat * rMat * sMat;

  // out.pos = camera.projection * camera.view * modelMat * in.pos;
  // out.pos = camera.projection * camera.view * in.pos; // Debug the model matrix.
  out.norm = normalize((camera.view * modelMat * vec4f(in.norm, 0)).xyz);
  out.uv0 = in.uv0;

  out.pos = in.pos; // Debug.

  return out;
}

// ----- Fragment shader ----- //
// Some hardcoded lighting for use with debugging.
const lightDir = normalize(vec3f(0.25, 0.5, 1.0));
const lightColor = vec3f(1.0, 1.0, 1.0);
const ambientColor = vec3f(0.03, 0.03, 0.03);
const baseColor = vec4f(0.0, 0.0, 1.0, 1.0);

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
  return baseColor;

  let N = normalize(in.norm);

  // An extremely simple directional lighting model, to give the obstacles some shape.
  let L = lightDir;
  let NDotL = max(dot(N, L), 0.0);
  let surfaceColor = (baseColor.rgb * ambientColor) + (baseColor.rgb * NDotL);

  return vec4(surfaceColor, baseColor.a);
}
