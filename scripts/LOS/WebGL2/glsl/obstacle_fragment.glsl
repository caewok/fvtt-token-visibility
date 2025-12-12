#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

#if ${debugViewNormals}
  in vec3 vNorm;
#endif

#if ${isTile}
  uniform sampler2D uTileTexture;
  in vec2 uv0;

  const float alphaValue = 0.75; // Mark tile pixels less than this alpha as clear.
#endif

uniform vec4 uColor;

out vec4 fragColor;

// Some hardcoded lighting
const vec3 lightDir = normalize(vec3(0.25, 0.5, 1.0));
const vec3 lightColor = vec3(1.0, 1.0, 1.0);
const vec3 ambientColor = vec3(0.1, 0.1, 0.1);

void main() {
  vec4 color = uColor;

  #if ${isTile}
    vec4 texColor = texture(uTileTexture, uv0);
    // Use discard so we don't have to deal with transparency for the textures.
    if ( texColor.a < alphaValue ) { discard; }
    color = texColor;
  #endif

  // Extremely simple directional lighting model to give the model some shape.
  #if ${debugViewNormals}
    vec3 N = normalize(vNorm);
    float NDotL = max(dot(N, lightDir), 0.0);
    vec3 surfaceColor = (color.rgb * ambientColor) + (color.rgb * NDotL);
    fragColor = vec4(surfaceColor, color.a);
  #else
    fragColor = uColor;
  #endif

  #if ${isTile}
    fragColor.a = color.a;
  #endif
}

