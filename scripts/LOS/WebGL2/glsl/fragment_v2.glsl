#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

#if ${debugViewNormals}
  layout (std140) uniform Material {
    vec4 uColor;
  };

  in vec3 vNormal;

  // Some hardcoded lighting
  const vec3 lightDir = normalize(vec3(0.25, 0.5, 1.0));
  const vec3 lightColor = vec3(1.0, 1.0, 1.0);
  const vec3 ambientColor = vec3(0.2, 0.2, 0.2);
#endif

#if ${hasTexture}
  in vec2 vTexCoord;
  uniform sampler2D uTexture;
  uniform float uAlphaThreshold; // Mark tile pixels less than this alpha as clear.
#endif

out vec4 fragColor;

void main() {
  vec4 color = vec4(1.0);

  #if ${hasTexture}
    vec4 texColor = texture(uTexture, vTexCoord);
    // Use discard so we don't have to deal with transparency for the textures.
    if ( texColor.a < uAlphaThreshold ) { discard; }
    color = texColor;
  #endif

  // Extremely simple directional lighting model to give the model some shape.
  #if ${debugViewNormals}
    #if ${!hasTexture}
      color = uColor;
    #endif

    vec3 N = normalize(vNormal);
    float NDotL = max(dot(N, lightDir), 0.0);
    vec3 surfaceColor = (color.rgb * ambientColor) + (color.rgb * NDotL);
    fragColor = vec4(surfaceColor, color.a);
  #else
    fragColor = vec4(1.0); // Output solid white; relies on color mask in the renderer.
  #endif

  #if ${hasTexture}
    fragColor.a = color.a; // Use the tile alpha channel to capture transparent portions.
  #endif
}

