Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d;
Matrix = CONFIG.GeometryLib.Matrix;

// Create a token model that we can scale, rotate, translate for given tokens.
// For now, this is a square token model.
// Token is a 1 unit cube.
class UnitCubeGeometry extends PIXI.Geometry {
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

class UnitPlaceableShader extends AbstractEVShader {
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
shader = UnitPlaceableShader.create();
mesh = new PIXI.Mesh(geom, shader);
canvas.stage.addChild(mesh);

// Activate culling to not draw opposite faces.
mesh.state.culling = true
mesh.state.clockwiseFrontFace = true



shader.translation = new Point3d(0, 0, -2)
shader.rotation = new Point3d(Math.toRadians(30), 0, 0);
shader.aspectRatio = window.outerWidth / window.outerHeight

await rotate("y")
canvas.stage.removeChild(mesh);

// Wall
geom = new WallGeometry();
shader = UnitPlaceableShader.create();
mesh = new PIXI.Mesh(geom, shader);
canvas.stage.addChild(mesh);

// Directional Wall
geom = new DirectionalWallGeometry();
shader = UnitPlaceableShader.create();
mesh = new PIXI.Mesh(geom, shader);
canvas.stage.addChild(mesh);

// Tile
tile = canvas.tiles.controlled[0]

geom = new TileGeometry();
shader = TileShader.create(tile);
mesh = new PIXI.Mesh(geom, shader);
canvas.stage.addChild(mesh);


let SPEED_FACTOR = 1
function rotateTicker(delta) {
  const axis = "x";
  const change = Math.toRadians(delta * SPEED_FACTOR);
  const rot = shader.rotation;
  const changePt = new Point3d(rot.x, rot.y, rot.z);
  changePt[axis] += change;
  shader.rotation = changePt;
}

canvas.app.ticker.add(rotateTicker)


// Instancing.
// https://pixijs.com/examples/mesh-and-shaders/instanced-geometry
geometry = new PIXI.Geometry()
    .addAttribute('aVertexPosition', [-100, -50, 100, -50, 0, 100]);

shader = PIXI.Shader.from(`

    precision mediump float;
    attribute vec2 aVertexPosition;

    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;

    void main() {
        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    }`,

`precision mediump float;

    void main() {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }

`);

triangle = new PIXI.Mesh(geometry, shader);

triangle.position.set(400, 300);

canvas.stage.addChild(triangle);

fn = function(delta) { triangle.rotation += 0.01; }
canvas.app.ticker.add(fn);





geometry = new PIXI.Geometry()
    .addAttribute('aVPos', [-100, 0, 100, 0, 0, -150]);

geometry.instanced = true;
geometry.instanceCount = 5;

positionSize = 2;
colorSize = 3;
buffer = new PIXI.Buffer(new Float32Array(geometry.instanceCount * (positionSize + colorSize)));

geometry.addAttribute(
    'aIPos',
    buffer,
    positionSize,
    false,
    PIXI.TYPES.FLOAT,
    4 * (positionSize + colorSize),
    0,
    true
);
geometry.addAttribute(
    'aICol',
    buffer,
    colorSize,
    false,
    PIXI.TYPES.FLOAT,
    4 * (positionSize + colorSize),
    4 * positionSize,
    true
);

for (let i = 0; i < geometry.instanceCount; i++)
{
    const instanceOffset = i * (positionSize + colorSize);

    buffer.data[instanceOffset + 0] = i * 80;
    buffer.data[instanceOffset + 2] = Math.random();
    buffer.data[instanceOffset + 3] = Math.random();
    buffer.data[instanceOffset + 4] = Math.random();
}

shader = PIXI.Shader.from(`
    precision mediump float;
    attribute vec2 aVPos;
    attribute vec2 aIPos;
    attribute vec3 aICol;

    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;

    varying vec3 vCol;

    void main() {
        vCol = aICol;

        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVPos + aIPos, 1.0)).xy, 0.0, 1.0);
    }`,

`precision mediump float;

    varying vec3 vCol;

    void main() {
        gl_FragColor = vec4(vCol, 1.0);
    }

`);

triangles = new PIXI.Mesh(geometry, shader);

triangles.position.set(400, 300);

canvas.stage.addChild(triangles);
canvas.stage.removeChild(triangles);


fn = function(delta) { triangles.rotation += 0.01; }
canvas.app.ticker.add(fn);
canvas.app.ticker.remove(fn);



// Options for displaying walls/tokens/tiles in front of a target:

- Planes (walls, tiles) cannot be simultaneously in front and behind of a token. So we can
  draw a red token target first, and then draw all shapes in front if needed.
- This assumption might fail for transparent tiles. To draw the full tile requires depth checking.


Option: Store full geometry, rotate camera.
No instancing:
- Walls: 4 vertices per wall, 3 coordinates = 12 times number walls.
- Tokens: 8 vertices per token, 3 coordinates = 24 times number tokens
- Tiles: 4 vertices per wall, 3 coordinates = 12 + 1 texture times number tiles
- JS: Precalculate each vertex location.
  --> This will cause the geometry to be updated with token movement, which is less than ideal.
  --> But if not precalculated, would require a matrix for each, at which point we are back to instancing.


Instancing:
- Walls: 4 vertices, 3 coordinates = 12.
  - ModelToWorld mat4 per wall (so, 4 vec4s). Equivalent to 16?
- Tokens: 8 vertices, 3 coordinates = 24
  - ModelToWorld mat4 per token. So 16.
- Tiles: same as walls, plus texture.

Instancing with coordinates instead of matrices
- Walls: 4 vertices, 3 coordinates = 12.
  - Each wall: center x, center y, center z, 1/2 length, 1/2 height. So 5 per wall. (no depth)

- Tokens: 8 vertices, 3 coordinates = 24
  - Each token: center x, center y, center z, 1/2 width, 1/2 height, 1/2 depth. So 6 per token

- Tiles: Same as walls + texture

- Would require calculating the matrix for each vertex.
- Would have to do this anyway in JS, but would not be repeated for each wall vertex, etc. if
- just changing token space or camera point.

--> Points to likely better to only construct the shader for pieces we need.
--> Or hybrid approach where tokens constructed differently than walls, etc.

1. Instanced, multiple shaders

Shader for tokens
Shader(s) for tiles
Shader for walls

2. Not instanced, single shader


3. Precalculate vs matrices.

Could precalculate in JS.
- JS: filter shapes to only those within viewing triangle.
- JS: Use modelToWorld matrix to go from unit geometry to specific geometry.
- WebGL: Take vertices of each object, along with color.
Tokens: 8 vertices





