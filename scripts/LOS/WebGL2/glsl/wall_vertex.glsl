#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

#define USE_NORMALS   ${debugViewNormals}

in vec3 aPos;
#if (USE_NORMALS == 1)
in vec3 aNorm;
#endif
in mat4 aiModel;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

#if (USE_NORMALS == 1)
out vec3 vNorm;
#endif

void main() {
  vec4 cameraPos = uLookAtMatrix * aiModel * vec4(aPos, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPos;

  // instance: gl_InstanceID

  #if (USE_NORMALS == 1)
  vNorm = normalize((uLookAtMatrix * model * vec4(aNorm, 0.0)).xyz);
  #endif
}

