#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 vNormal;
in vec2 vTexCoord;


// Clipping planes used by constrain target.
in vec3 vWorldPosition;

#if ${maxConstrainingWalls}
// Pragma needed b/c GLSL does not allow uClipPlanes[0]. "Error: Array size must be greater than zero."
uniform int uNumClipPlanes;
uniform vec4 uClipPlanes[${maxConstrainingWalls}]; // Max intersecting walls.
#endif

// Used by textures
uniform sampler2D uTextures[16];
flat in int vTextureIndex;
flat in float vAlphaThreshold;

// Color used by debug view.
layout (std140) uniform Material {
  vec4 uColor;
};

// Some hardcoded lighting used by debug view
const vec3 lightDir = normalize(vec3(0.25, 0.5, 1.0));
const vec3 lightColor = vec3(1.0, 1.0, 1.0);
const vec3 ambientColor = vec3(0.2, 0.2, 0.2);

out vec4 fragColor;


vec4 texturePicker(int idx) {
  switch ( idx ) {
    case 0: return texture(uTextures[0], vTexCoord);
    case 1: return texture(uTextures[1], vTexCoord);
    case 2: return texture(uTextures[2], vTexCoord);
    case 3: return texture(uTextures[3], vTexCoord);
    case 4: return texture(uTextures[4], vTexCoord);
    case 5: return texture(uTextures[5], vTexCoord);
    case 6: return texture(uTextures[6], vTexCoord);
    case 7: return texture(uTextures[7], vTexCoord);
    case 8: return texture(uTextures[8], vTexCoord);
    case 9: return texture(uTextures[9], vTexCoord);
    case 10: return texture(uTextures[10], vTexCoord);
    case 11: return texture(uTextures[11], vTexCoord);
    case 12: return texture(uTextures[12], vTexCoord);
    case 13: return texture(uTextures[13], vTexCoord);
    case 14: return texture(uTextures[14], vTexCoord);
    case 15: return texture(uTextures[15], vTexCoord);
  }
  return vec4(0.0);
}

void main() {
  #if ${maxConstrainingWalls}
    for ( int i = 0; i < uNumClipPlanes; i++ ) {
      float dist = dot(uClipPlanes[i].xyz, vWorldPosition) + uClipPlanes[i].w;

      // If distance is greater than 0, the pixel is "behind" the wall.
      if ( dist > 0.0 ) { discard; }
    }
  #endif

  vec4 color = vec4(1.0);

  #if ${hasTexture}
    vec4 texColor = texturePicker(vTextureIndex);

    // Use discard so we don't have to deal with transparency for the textures.
    if ( texColor.a < vAlphaThreshold ) { discard; }
    color = texColor;
  #endif

  // Extremely simple directional lighting model to give the model some shape.
  #if ${debugViewNormals}
    // Either use the texture color defined above or if no texture, use the material color.
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
    // Use the texture alpha channel to capture semi-transparent portions.
    fragColor.a = color.a;
  #endif
}
