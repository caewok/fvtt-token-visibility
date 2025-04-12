#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aPos;
#if ${debugViewNormals}
in vec3 aNorm;
#endif
in mat4 model;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

#if ${debugViewNormals}
out vec3 vNorm;
#endif

void main() {
  vec4 cameraPos = uLookAtMatrix * model * vec4(aPos, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPos;

  // instance: gl_InstanceID

  #if ${debugViewNormals}
  vNorm = normalize((uLookAtMatrix * model * vec4(aNorm, 0.0)).xyz);
  #endif
}

