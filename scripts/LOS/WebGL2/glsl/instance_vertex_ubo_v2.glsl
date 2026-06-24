#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

layout(location = 0) in vec3 aPosition;

layout (std140) uniform Camera {
  mat4 uPerspectiveMatrix; // Projection.
  mat4 uLookAtMatrix;      // View.
};

#if ${isInstanced}
  layout(location = 1) in mat4 aModel; // Takes up four consecutive locations

#else
  uniform mat4 aModel;

  // Tiles are not instanced
  #if ${hasTexture}
    layout(location = 1) in vec2 aTexCoord; // aUV
    out vec2 vTexCoord;
  #endif

#endif

#if ${debugViewNormals}
  in vec3 aNormal;
  out vec3 vNormal;
#endif



void main() {
  vec4 cameraPos = uLookAtMatrix * aModel * vec4(aPosition, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPos;

  // instance: gl_InstanceID

  #if ${debugViewNormals}
    vNormal = normalize((uLookAtMatrix * aModel * vec4(aNormal, 0.0)).xyz);
  #endif

  #if ${hasTexture}
    vTexCoord = aTexCoord;
  #endif

}

