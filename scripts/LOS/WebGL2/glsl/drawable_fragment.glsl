#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 vNormal;
in vec2 vTexCoord;

#if ${maxConstrainingWalls}
// Pragma needed b/c GLSL does not allow uClipPlanes[0]. "Error: Array size must be greater than zero."
flat in int vNumClipPlanes;
flat in vec4 vClipPlanes[${maxConstrainingWalls}]; // Max intersecting walls.
flat in vec2 vTokenCenter; // Token center in 2d canvas space.

in vec3 vWorldPosition; // Fragment location in Foundry canvas coordinates.
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

/**
 * Standard 2d orientation (cross product sign)
 * What is the orientation of c with regard to segment a|b?
 * Positive if ccw, 0 if collinear, negative if cw.
 */
float orient2d(vec2 a, vec2 b, vec2 c) {
  return (a.y - c.y) * (b.x - c.x) - (a.x - c.x) * (b.y - c.y);
}

/**
 * Test if a 2d segment a|b intersects 2d segment c|d
 */
bool lineSegmentsIntersect(vec2 a, vec2 b, vec2 c, vec2 d) {
  return
    ((orient2d(a, b, c) * orient2d(a, b, d)) <= 0.0) &&
    ((orient2d(c, d, a) * orient2d(c, d, b)) <= 0.0);
}


/**
 * Select a texture for a given texture index.
 */
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
  bool blocked = false;

  #if ${maxConstrainingWalls}
    // Test if the 2d ray from token center to fragment hits any wall.
    vec2 rayStart = vTokenCenter;
    vec2 rayEnd = vWorldPosition.xy;
    for ( int i = 0; i < vNumClipPlanes; i++ ) {
      vec2 wallStart = vClipPlanes[i].xy;
      vec2 wallEnd = vClipPlanes[i].zw;
      if ( lineSegmentsIntersect(rayStart, rayEnd, wallStart, wallEnd) ) blocked = true; // Fragment cannot see token center.
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

  #if ${maxConstrainingWalls}
    if ( blocked ) { fragColor.a = 0.0; }
  #endif

}
