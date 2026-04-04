#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aPos;

// in mat4 aModel;

layout (std140) uniform Camera {
  mat4 uPerspectiveMatrix;
  mat4 uLookAtMatrix;
};

#if ${debugViewNormals}
  in vec3 aNorm;
  out vec3 vNorm;
#endif

void main() {
  vec4 cameraPos = uLookAtMatrix * vec4(aPos, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPos;

  // instance: gl_InstanceID

  #if ${debugViewNormals}
    vNorm = normalize((uLookAtMatrix * vec4(aNorm, 0.0)).xyz);
  #endif
}

