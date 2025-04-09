#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;
precision ${PIXI.settings.PRECISION_VERTEX} usampler2D;

// Or PIXI.settings.PRECISION_FRAGMENT, which may be lower.

#if ${debugViewNormals}
in vec3 vNorm;
#endif

uniform vec4 uColor;
uniform sampler2D uTileTexture;

in vec2 uv0;

out vec4 fragColor;

// Mark tile pixels less than this alpha as clear.
const float alphaValue = 0.75;

// Some hardcoded lighting
const vec3 lightDir = normalize(vec3(0.25, 0.5, 1.0));
const vec3 lightColor = vec3(1.0, 1.0, 1.0);
const vec3 ambientColor = vec3(0.3, 0.3, 0.3);

void main() {
  vec4 texColor = texture(uTileTexture, uv0);
  // fragColor = texColor;
  // fragColor = uColor;
  // fragColor.b = 1.0;
  // return;

  // Use discard so we don't have to deal with transparency for the textures.
  if ( texColor.a < alphaValue ) { discard; }

  // Extremely simple directional lighting model to give the model some shape.

  #if ${debugViewNormals}
    vec3 N = normalize(vNorm);
    float NDotL = max(dot(N, lightDir), 0.0);
    vec3 surfaceColor = (texColor.rgb * ambientColor) + (texColor.rgb * NDotL);
    fragColor = vec4(surfaceColor, texColor.a);
  #else
    fragColor = uColor;
    // fragColor.a = step(alphaValue, texColor.a);
    fragColor.a = texColor.a;
  #endif
}

