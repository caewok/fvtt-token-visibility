// Create a token model that we can scale, rotate, translate for given tokens.
// For now, this is a square token model.
// Token is a 1 unit cube.
class UnitCubeGeometry extends PIXI.Geometry  {
  constructor() {
    super();
    this.addVertices();
    this.addColors(); // For debugging.
    this.addIndices();
  }

  /**
   * Add 3d vertices for a generic token cube.
   */
  addVertices() {
    // 8 distinct points on a cube
    const aVertices = [
      // Top, looking down
      -0.50,  0.50, 0.50,  // TL
       0.50,  0.50, 0.50,  // TR
       0.50, -0.50, 0.50,  // BR
      -0.50, -0.50, 0.50,  // BL

      // Bottom, looking down
      -0.50,  0.50, -0.50,  // TL
       0.50,  0.50, -0.50,  // TR
       0.50, -0.50, -0.50,  // BR
      -0.50, -0.50, -0.50,  // BL
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

      // Bottom: Shades of blue
      0.0, 0.00, 1.0,
      0.0, 0.25, 1.0,
      0.0, 0.75, 1.0,
      0.0, 1.00, 1.0
    ];
    this.addAttribute("aColor", aColors, 3);
  }

  /**
   * Indices to draw two triangles per face.
   * Top, bottom, sides 0 through 3.
   */
  addIndices() {
    /*
     TL: 0, 4
     TR: 1, 5
     BR: 2, 6,
     BL: 3, 7

      TL --- TR
      |      |
      |      |
      BL --- BR
    */
    const indices = [
      // Top
      0, 1, 2,
      0, 2, 3,

      // Bottom
//       4, 5, 6,
//       4, 6, 7,

      // Sides (from top)
      // TR - TL
      1, 0, 4,
      1, 4, 5,

      // BR - TR
//       2, 1, 5,
//       2, 5, 6,

      // BL - BR
//       3, 2, 6,
//       3, 6, 7,

      // TL - BL
//       0, 3, 7,
//       0, 7, 4
    ];
    this.addIndex(indices);
  }
}

class UnitCubeShader extends AbstractEVShader {
  /**
   * Vertex shader constructs a quad and calculates the canvas coordinate and texture coordinate varyings.
   * @type {string}
   */
  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec3 aColor;

out vec4 vColor;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

uniform mat4 uPerspectiveMatrix;
uniform vec3 uOffset;

void main() {
  vColor = vec4(aColor, 1.0);
  vec4 cameraPosition = vec4(aVertex, 1.0) + vec4(uOffset.x, uOffset.y, uOffset.z, 0.0);
  gl_Position = uPerspectiveMatrix * cameraPosition;

  // gl_Position = vec4(projectionMatrix * translationMatrix * vec3(vertexPosition.xy / vertexPosition.z, 1.0), 1.0);
}`;

  static fragmentShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_FRAGMENT} float;
precision ${PIXI.settings.PRECISION_FRAGMENT} usampler2D;

in vec4 vColor;
out vec4 fragColor;

void main() {
  fragColor = vColor;
}`;

  /** @type {number} Degrees */
  #fieldOfView = 90.0;

  /** @type {number} */
  #aspectRatio = 1.0;

  /** @type {number} */
  #zNear = 1.0;

  /** @type {number} */
  #zFar = 3.0;

  /**
   * Uniforms added to the shader.
   * TODO: Replace offset with translation matrix.
   * {number[3]} uOffset    Offset the shape in the x, y, and z directions.
   * {number[16]} uPerspectiveMatrix    Matrix to set the perspective.
   */
  static defaultUniforms = {
    uOffset: [0, 0, 0],
    uPerspectiveMatrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]
  };

  static create(defaultUniforms = {}) {
    const res = super.create(defaultUniforms);
    res.calculatePerspectiveMatrix();
    return res;
  }

  set offset(value) {
    if ( Object.hasOwn(value, "x") ) this.uniforms.uOffset[0] = value.x;
    if ( Object.hasOwn(value, "y") ) this.uniforms.uOffset[1] = value.y;
    if ( Object.hasOwn(value, "z") ) this.uniforms.uOffset[2] = value.z;
  }

  set fieldOfView(value) {
    value = Math.normalizeDegrees(value);
    this.#fieldOfView = value;
    this.calculatePerspectiveMatrix();
  }

  set aspectRatio(value) {
    if ( value <= 0 ) {
      console.error("Aspect ratio must be greater than 0.");
      return;
    }
    this.#aspectRatio = value;
    this.calculatePerspectiveMatrix();
  }
  set zNear(value) {
    if ( value <= 0 ) {
      console.error("zNear must be greater than 0.");
      return;
    }
    this.#zNear = value;
    this.calculatePerspectiveMatrix();
  }

  set zFar(value) {
    if ( value <= 0 ) {
      console.error("zFar must be greater than 0.");
      return;
    }
    this.#zFar = value;
    this.calculatePerspectiveMatrix();
  }

  get perspectiveMatrix() { return this.uniforms.uPerspectiveMatrix; }

  calculatePerspectiveMatrix(fovy, aspect, zNear, zFar) {
    fovy ??= this.#fieldOfView;
    aspect ??= this.#aspectRatio;
    zNear ??= this.#zNear;
    zFar ??= this.#zFar;
    this.uniforms.uPerspectiveMatrix = Matrix.perspective(fovy, aspect, zNear, zFar)
      .transpose()
      .toFlatArray();
  }
}

geom = new UnitCubeGeometry();
shader = UnitCubeShader.create();
mesh = new PIXI.Mesh(geom, shader);

// For perspective, shift from z = 0 to z = -2 (center of the zNear, zFar)
shader.offset = { z: -2 }
shader.fieldOfView = 45

canvas.stage.addChild(mesh);

// Activate culling to not draw opposite faces.
mesh.state.culling = true
mesh.state.clockwiseFrontFace = true

// Move it around
shader.offset = {x: .2, y: -.2} // Note how negative y shifts down.
shader.offset = {x: -.8, y: -2}

canvas.stage.removeChild(mesh);

