#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord; // aUV
layout(location = 3) in int aTextureIndex;
layout(location = 4) in float aAlphaThreshold;

layout (std140) uniform Camera {
  mat4 uPerspectiveMatrix; // Projection.
  mat4 uLookAtMatrix;      // View.
};

layout(location = 5) in mat4 aModel; // Takes up four consecutive locations

#if ${maxConstrainingWalls}
// Note: Currently using 9 slots before this (0–4 + 4 slots for location 5).
// aNumClipPlanes uses 1 slot.
// aClipPlanes is 1 slot per array element. Keep maxConstrainingWalls <= 6 to
// stay within 16-attirbute limit across nearly all devices. (MAX_VERTEX_ATTRIBS)
// Instanced clipping plane attributes
layout(location = 9) in int aNumClipPlanes;

// Unroll the array, to avoid error: 'in' : cannot declare arrays of this qualifier
layout(location = 10) in vec4 aClipPlanes_0;
layout(location = 11) in vec4 aClipPlanes_1;
layout(location = 12) in vec4 aClipPlanes_2;
layout(location = 13) in vec4 aClipPlanes_3;
layout(location = 14) in vec4 aClipPlanes_4;

// For fragment shader.
flat out int vNumClipPlanes;
flat out vec4 vClipPlanes[${maxConstrainingWalls}];
#endif

out vec3 vNormal;
out vec2 vTexCoord;
out vec3 vWorldPosition;
flat out int vTextureIndex;
flat out float vAlphaThreshold;

void main() {
  vec4 worldPosition = aModel * vec4(aPosition, 1.0);
  vec4 cameraPosition = uLookAtMatrix * worldPosition;
  gl_Position = uPerspectiveMatrix * cameraPosition;

  // instance: gl_InstanceID

  #if ${debugViewNormals}
    vNormal = normalize((uLookAtMatrix * aModel * vec4(aNormal, 0.0)).xyz);
  #endif

  #if ${hasTexture}
    vTexCoord = aTexCoord;
    vTextureIndex = aTextureIndex;
    vAlphaThreshold = aAlphaThreshold;
  #endif

  #if ${maxConstrainingWalls}
    // Pack the unrolled attributes into the output array.
    vClipPlanes[0] = aClipPlanes_0;
    vClipPlanes[1] = aClipPlanes_1;
    vClipPlanes[2] = aClipPlanes_2;
    vClipPlanes[3] = aClipPlanes_3;
    vClipPlanes[4] = aClipPlanes_4;

    vWorldPosition = worldPosition.xyz;

    // Instance clipping data, passed to fragment shader.
    vNumClipPlanes = aNumClipPlanes;

  #endif
}
