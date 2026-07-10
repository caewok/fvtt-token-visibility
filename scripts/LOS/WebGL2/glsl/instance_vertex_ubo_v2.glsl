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

#if ${isInstanced}
  layout(location = 5) in mat4 aModel; // Takes up four consecutive locations
#else
  uniform mat4 aModel;
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
    vWorldPosition = worldPosition.xyz;
  #endif
}
