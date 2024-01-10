Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d;
Matrix = CONFIG.GeometryLib.Matrix;

// Create a wall model that we can scale, rotate, translate for given walls.
// Wall is 1 unit square.
// Wall is double-sided so it works with culling.
// One sided version also possible
// Vertices face +z direction but typically rotated by default to a vertical orientation.
class WallGeometry extends PIXI.Geometry {
  constructor() {
    super();
    this.addVertices();
    this.addColors(); // For debugging.
    this.addIndices();
  }

  /**
   * Add 3d vertices.
   * Facing +z direction
   */
  addVertices() {
    const aVertices = [
      // Top, looking down
      -0.50,  0.50, 0.0,  // TL
       0.50,  0.50, 0.0,  // TR
       0.50, -0.50, 0.0,  // BR
      -0.50, -0.50, 0.0,  // BL
    ];

    this.addAttribute("aVertex", aVertices, 3);
  }

  addColors() {
    // Color each vertex.
    // Ignore alpha; let the shader set it.
    const aColors = [
      // Top: Shades of orange
      1.0, 0.00, 0.0,
      1.0, 0.25, 0.0,
      1.0, 0.75, 0.0,
      1.0, 1.00, 0.0,
    ];
    this.addAttribute("aColor", aColors, 3);
  }

  /**
   * Indices to draw two triangles per face.
   * Top, bottom, sides 0 through 3.
   */
  addIndices() {
    /*
     TL: 0
     TR: 1
     BR: 2
     BL: 3

      TL --- TR
      |      |
      |      |
      BL --- BR
    */
    const indices = [
      // Top
      0, 1, 2, // TL - TR - BR
      0, 2, 3, // TL - BR - BL

      // Bottom
      0, 3, 2,
      0, 2, 1,
    ];
    this.addIndex(indices);
  }
}

// Simpler directional wall case.
// Faces the +z direction but typically rotated by default to a vertical orientation.
class DirectionalWallGeometry extends PIXI.Geometry {
  constructor() {
    super();
    this.addVertices();
    this.addColors(); // For debugging.
    this.addIndices();
  }

  /**
   * Add 3d vertices.
   * Facing +z direction
   */
  addVertices() {
    const aVertices = [
      // Top, looking down
      -0.50,  0.50, 0.0,  // TL
       0.50,  0.50, 0.0,  // TR
       0.50, -0.50, 0.0,  // BR
      -0.50, -0.50, 0.0,  // BL
    ];

    this.addAttribute("aVertex", aVertices, 3);
  }

  addColors() {
    // Color each vertex.
    // Ignore alpha; let the shader set it.
    const aColors = [
      // Top: Shades of orange
      1.0, 0.00, 0.0,
      1.0, 0.25, 0.0,
      1.0, 0.75, 0.0,
      1.0, 1.00, 0.0,
    ];
    this.addAttribute("aColor", aColors, 3);
  }

  /**
   * Indices to draw two triangles per face.
   * Top, bottom, sides 0 through 3.
   */
  addIndices() {
    /*
     TL: 0
     TR: 1
     BR: 2
     BL: 3

      TL --- TR
      |      |
      |      |
      BL --- BR
    */
    const indices = [
      // Top
      0, 1, 2, // TL - TR - BR
      0, 2, 3, // TL - BR - BL
    ];
    this.addIndex(indices);
  }
}

class TileGeometry extends WallGeometry {
  constructor() {
    super();
    this.addUVs();
  }

  addUVs() {
    const aUVs = [
      // Top, looking down
      0, 0, // TL
      1, 0, // TR
      1, 1, // BR
      0, 1, // BL
    ];

    this.addAttribute("aTextureCoord", aUVs, 2);
  }

}

class TileShader extends UnitPlaceableShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec2 aTextureCoord;

out vec2 vTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uModelWorldMatrix;
uniform vec3 uOffset;

void main() {
  vTextureCoord = aTextureCoord;
  vec4 worldPosition = uModelWorldMatrix * vec4(aVertex, 1.0);
  vec4 cameraPosition = worldPosition; // For now
  gl_Position = uPerspectiveMatrix * cameraPosition;
  // gl_Position = vec4(projectionMatrix * translationMatrix * vec3(vertexPosition.xy / vertexPosition.z, 1.0), 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec2 vTextureCoord;
out vec4 fragColor;
uniform sampler2D uTileTexture;

void main() {
  vec4 texPixel = texture(uTileTexture, vTextureCoord);
  fragColor = texPixel;
}`;

  static create(tile, defaultUniforms = {}) {
    defaultUniforms.uTileTexture = tile.texture.baseTexture;
    const res = super.create(defaultUniforms);
    res.calculatePerspectiveMatrix();
    res.calculateModelWorldMatrix();
    return res;
  }
}


