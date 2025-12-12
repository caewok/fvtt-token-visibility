#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aPos;
in mat4 aModel;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

#if ${debugViewNormals}
  in vec3 aNorm;
  out vec3 vNorm;
#endif

#if ${isTile}
  in vec2 aUV;
  out vec2 uv0;
#endif

void main() {
  vec4 cameraPos = uLookAtMatrix * aModel * vec4(aPos, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPos;

  // instance: gl_InstanceID

  #if ${debugViewNormals}
    vNorm = normalize((uLookAtMatrix * aModel * vec4(aNorm, 0.0)).xyz);
  #endif

  #if ${isTile}
    uv0 = aUV;
  #endif
}

