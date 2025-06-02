#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aPos;
in vec2 aUV;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uLookAtMatrix;

#if ${debugViewNormals}
  in vec3 aNorm;
  out vec3 vNorm;
#endif

out vec2 uv0;

void main() {
  vec4 cameraPos = uLookAtMatrix * vec4(aPos, 1.0);
  gl_Position = uPerspectiveMatrix * cameraPos;

  uv0 = aUV;

  // instance: gl_InstanceID

  #if ${debugViewNormals}
    vNorm = normalize((uLookAtMatrix * vec4(aNorm, 0.0)).xyz);
  #endif
}

