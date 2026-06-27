#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 vNormal;
in vec2 vTexCoord;


// Clipping planes used by constrain target.
in vec3 vWorldPosition;

uniform int uNumClipPlanes;
uniform vec4 uClipPlanes[${maxConstrainingWalls}]; // Max intersecting walls.

// Used by textures
uniform sampler2D uTexture;
uniform float uAlphaThreshold; // Mark tile pixels less than this alpha as clear.

// Color used by debug view.
layout (std140) uniform Material {
  vec4 uColor;
};

// Some hardcoded lighting used by debug view
const vec3 lightDir = normalize(vec3(0.25, 0.5, 1.0));
const vec3 lightColor = vec3(1.0, 1.0, 1.0);
const vec3 ambientColor = vec3(0.2, 0.2, 0.2);

out vec4 fragColor;

void main() {
  #if ${constrainTarget}
    for ( int i = 0; i < uNumClipPlanes; i++ ) {
      float dist = dot(uClipPlanes[i].xyz, vWorldPosition) + uClipPlanes[i].w;

      // If distance is greater than 0, the pixel is "behind" the wall.
      if ( dist > 0.0 ) { discard; }
    }
  #endif

  vec4 color = vec4(1.0);

  #if ${hasTexture}
    vec4 texColor = texture(uTexture, vTexCoord);

    // Use discard so we don't have to deal with transparency for the textures.
    if ( texColor.a < uAlphaThreshold ) { discard; }
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

