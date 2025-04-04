#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

#define USE_NORMALS   ${debugViewNormals}

#if (USE_NORMALS == 1)
in vec2 vNorm
#endif

uniform vec4 uColor;

out vec4 fragColor;

// Some hardcoded lighting
const vec3 lightDir = normalize(vec3(0.25, 0.5, 1.0));
const vec3 lightColor = vec3(1, 1, 1);
const vec3 ambientColor = vec3(0.1, 0.1, 0.1);

void main() {
  fragColor = uColor;

  // Extremely simple directional lighting model to give the model some shape.
  #if (USE_NORMALS == 1)
    vec3 N = normalize(in.norm);
    float NDotL = max(dot(N, lightDir), 0.0);
    vec3 surfaceColor = (uColor.rgb * ambientColor) + (uColor.rgb * NDotL);
    fragColor = vec4(surfaceColor, uColor.a);
  #endif
}

