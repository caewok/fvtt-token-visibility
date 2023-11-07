Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d;
Matrix = CONFIG.GeometryLib.Matrix;

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
    // https://learnopengl.com/Getting-started/Coordinate-Systems
    // +Y goes up; -z goes back

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
      0.0, 1.00, 1.0,
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
      0, 1, 2, // TL - TR - BR
      0, 2, 3, // TL - BR - BL

      // Bottom
      4, 7, 6, // TL - BL - BR
      4, 6, 5, // TL - BR - TR

      // Sides (from top)
      0, 3, 7, // TL (top) - BL (top) - BL (bottom)
      0, 7, 4, // TL (top) - BL (bottom) - TL (bottom)

      1, 0, 4, // TR (top) - TL (top) - TL (bottom)
      1, 4, 5, // TR (top) - TL (bottom) - TR (bottom)

      2, 1, 5, // BR (top) - TR (top) - TR (bottom)
      2, 5, 6, // BR (top) - TR (bottom) - BR (bottom)

      3, 2, 6, // BL (top) - BR (top) - BR (bottom)
      3, 6, 7, // BL (top) - BR (bottom) - BL (bottom)


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
uniform mat4 uModelWorldMatrix;
uniform vec3 uOffset;

void main() {
  vColor = vec4(aColor, 1.0);

//   mat4 trMat;
//   trMat[0][0] = 1.0;
//   trMat[1][1] = 1.0;
//   trMat[2][2] = 1.0;
//   trMat[3][3] = 1.0;
//   trMat[3][0] = 0.5;
//   trMat[3][2] = 1.0;
//   mat4 trMat = mat4(
//     1.0, 0.0, 0.0, 0.5,
//     0.0, 1.0, 1.0, 0.0,
//     0.0, 0.0, 1.0, -2.0,
//     0.0, 0.0, 0.0, 1.0
//   );

  // vec4 worldPosition = vec4(aVertex, 1.0) + vec4(uOffset, 0.0);

  // worldPosition = uModelWorldMatrix * worldPosition;

  vec4 worldPosition = uModelWorldMatrix * vec4(aVertex, 1.0);
  // vec4 worldPosition = trMat * vec4(aVertex, 1.0);

  vec4 cameraPosition = worldPosition; // For now
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

  /** @type {Point3d} */
  #translation = new Point3d();

  /** @type {Point3d} */
  #rotation = new Point3d();

  /** @type {Point3d} */
  #scale = new Point3d(1, 1, 1);

  // Store each piece of the world matrix for varying terms. All start as identity.
  /** @type {Matrix} */
  #rotationMatrix = Matrix.rotationXYZ(0, 0, 0);

  /** @type {Matrix} */
  #scaleMatrix = Matrix.scale(1, 1, 1);

  /** @type {Matrix} */
  #translationMatrix = Matrix.translation(0, 0, 0);

  /**
   * Uniforms added to the shader.
   * TODO: Replace offset with translation matrix.
   * {number[3]} uOffset    Offset the shape in the x, y, and z directions.
   * {number[16]} uPerspectiveMatrix    Matrix to set the perspective.
   */
  static defaultUniforms = {
    uPerspectiveMatrix: Matrix.identity(4, 4).toGLSLArray(),
    uModelWorldMatrix: Matrix.identity(4, 4).toGLSLArray(),
    uOffset: [0, 0, 0]
  };

  static create(defaultUniforms = {}) {
    const res = super.create(defaultUniforms);
    res.calculatePerspectiveMatrix();
    res.calculateModelWorldMatrix();
    return res;
  }

  set offset(value) {
    if ( Object.hasOwn(value, "x") ) this.uniforms.uOffset[0] = value.x;
    if ( Object.hasOwn(value, "y") ) this.uniforms.uOffset[1] = value.y;
    if ( Object.hasOwn(value, "z") ) this.uniforms.uOffset[2] = value.z;
  }

  get scale() { return this.#scale; }

  get scaleMatrix() { return this.#scaleMatrix; }

  set scale(scalePoint) {
    this.#scale.copyFrom(scalePoint);
    this.#scaleMatrix = Matrix.scale(this.#scale.x, this.#scale.y, this.#scale.z);
    this.calculateModelWorldMatrix();
  }

  get rotation() { return this.#rotation; }

  get rotationMatrix() { return this.#rotationMatrix; }

  set rotation(rotationPoint) {
    this.#rotation.copyFrom(rotationPoint);
    this.#rotationMatrix = Matrix.rotationXYZ(this.#rotation.x, this.#rotation.y, this.#rotation.z);
    this.calculateModelWorldMatrix();
  }

  get translation() { return this.#translation; }

  get translationMatrix() { return this.#translationMatrix; }

  set translation(translationPoint) {
    this.#translation.copyFrom(translationPoint);
    this.#translationMatrix = Matrix.translation(this.#translation.x, this.#translation.y, this.#translation.z);
    this.calculateModelWorldMatrix();
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

  get worldMatrix() { return this.uniforms.uModelWorldMatrix; }

  calculatePerspectiveMatrix() {
    const fovy = this.#fieldOfView;
    const aspect = this.#aspectRatio;
    const zNear = this.#zNear;
    const zFar = this.#zFar;
    this.uniforms.uPerspectiveMatrix = Matrix.perspectiveDegrees(fovy, aspect, zNear, zFar).toGLSLArray();
  }

  calculateModelWorldMatrix() {
    const fullMat = Matrix.empty(4, 4);
    // Do rotation first, assuming the models are centered at 0,0,0.
    // Then scale, and finally translate.
    this.#rotationMatrix.multiply4x4(this.#scaleMatrix, fullMat);
    fullMat.multiply4x4(this.#translationMatrix, fullMat);
    this.uniforms.uModelWorldMatrix = fullMat.toGLSLArray();
  }
}

// See https://austinmorlan.com/posts/opengl_matrices/

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Rotate around an axis
async function rotate(axis = "x") {
  for ( let i = 0; i < 360; i += 1 ) {
    const change = Math.toRadians(1);
    const rot = shader.rotation;
    const changePt = new Point3d(rot.x, rot.y, rot.z);
    changePt[axis] += change;
    shader.rotation = changePt;
    await sleep(50)
  }
}


geom = new UnitCubeGeometry();
shader = UnitCubeShader.create();
mesh = new PIXI.Mesh(geom, shader);
canvas.stage.addChild(mesh);

// Activate culling to not draw opposite faces.
mesh.state.culling = true
mesh.state.clockwiseFrontFace = true



shader.translation = new Point3d(0, 0, -2)
shader.rotation = new Point3d(Math.toRadians(30), 0, 0);
shader.aspectRatio = window.outerWidth / window.outerHeight

await rotate("y")


shader.translation = new Point3d(.5, 0, 1)
shader.rotation = new Point3d(0, 0, Math.toRadians(45))






shader.rotation = new Point3d(0, 0, Math.toRadians(45))
shader.rotation = new Point3d(Math.toRadians(30), 0, Math.toRadians(45))



// For perspective, shift from z = 0 to z = -2 (center of the zNear, zFar)
shader.offset = { z: -2 }
shader.fieldOfView = 45

canvas.stage.addChild(mesh);


// Move it around
shader.offset = {x: .2, y: -.2} // Note how negative y shifts down.
shader.offset = {x: -.8, y: -.8}

canvas.stage.removeChild(mesh);






