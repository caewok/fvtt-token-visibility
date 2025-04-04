#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

#define USE_NORMALS   ${debugViewNormals}

in vec3 aPos;
#if (USE_NORMALS == 1)
in vec3 aNorm;
#endif

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

#if (USE_NORMALS == 1)
out vec3 vNorm;
#endif

flat out int faceID;

void main() {
  vec4 cameraPos = uLookAtMatrix * vec4(aPos, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPos;

  // instance: gl_InstanceID
  faceID = gl_VertexID;

  #if (USE_NORMALS == 1)
  vNorm = normalize((uLookAtMatrix * vec4(aNorm, 0.0)).xyz);
  #endif
}

