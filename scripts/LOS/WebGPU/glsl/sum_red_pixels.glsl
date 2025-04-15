@group(0) @binding(0) var<storage, read_write> output: array<atomic<u32>, 2>;
@group(1) @binding(0) var tex: texture_storage_2d<${presentationFormat}, read>;

// Create zero-initialized workgroup shared data
const wgDim: vec2u = vec2u(${workgroupSize.x}, ${workgroupSize.y});
const wgSize: u32 = wgDim.x * wgDim.y;
var<workgroup> redData: array<u32, wgSize>;
var<workgroup> obstacleData: array<u32, wgSize>;

@compute @workgroup_size(${workgroupSize.x}, ${workgroupSize.y}, 1)
fn computeMain(
  @builtin(global_invocation_id) global_invocation_id: vec3u,
  @builtin(workgroup_id) workgroup_id: vec3u,
  @builtin(local_invocation_index) local_invocation_index: u32,
) {

  // Each thread reads its own data.
  let threadId: u32 = local_invocation_index;
  let size = textureDimensions(tex);
  let position = global_invocation_id.xy;
  if ( all(position < size) ) {
    let color = textureLoad(tex, position);
    if ( color.r > 0.0 ) { redData[threadId] = 1u; }
    if ( color.r > 0.0 && color.b > 0.0 ) { obstacleData[threadId] = 1u; }
  }

  // Sync all the threads.
  workgroupBarrier();

  // Do reduction in shared memory.
  for (var s: u32 = wgSize / 2; s > 0; s >>= 1 ) {
    if ( threadId < s ) {
      redData[threadId] += redData[threadId + s];
      obstacleData[threadId] += obstacleData[threadId + s];
    }
    workgroupBarrier();
  }

  // Add result from the workgroup to the output storage.
  // Only the first thread needs to do this in each workgroup.
  if ( threadId == 0 )  {
    atomicAdd(&output[0], redData[0]);
    atomicAdd(&output[1], obstacleData[0]);
  }
}