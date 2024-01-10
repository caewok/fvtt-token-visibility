Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d;
Matrix = CONFIG.GeometryLib.Matrix;

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
//   addVertices() {
//     const aVertices = [
//       // Top, looking down
//       -0.50,  0.50, 0.0,  // TL
//        0.50,  0.50, 0.0,  // TR
//        0.50, -0.50, 0.0,  // BR
//       -0.50, -0.50, 0.0,  // BL
//     ];
//
//     this.addAttribute("aVertex", aVertices, 3);
//   }

  addVertices() {
    const aVertices = [
      // Top, looking down
      -0.50,  -0.50, 0.0,  // TL
       0.50,  -0.50, 0.0,  // TR
       0.50,  0.50, 0.0,  // BR
      -0.50,  0.50, 0.0,  // BL
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
      0, 3, 2, // TL - BL - BR
      0, 2, 1, // TL - BR - TR
    ];
    this.addIndex(indices);
  }
}

let ROTATION_MATRICES = {
  x: "_rotationXMatrix",
  y: "_rotationYMatrix",
  z: "_rotationZMatrix"
};

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

uniform mat4 uOffsetMatrix;
uniform mat4 uPerspectiveMatrix;
uniform mat4 uModelWorldMatrix;
uniform mat4 uCameraMatrix;
uniform vec3 uOffset;

void main() {
  vColor = vec4(aColor, 1.0);

  vec4 modelPosition = vec4(aVertex, 1.0);
  vec4 worldPosition = uModelWorldMatrix * modelPosition;

  // vec4 worldPosition = vec4(aVertex, 1.0);
  // vec4 worldPosition = trMat * vec4(aVertex, 1.0);

  vec4 cameraPosition = uCameraMatrix * worldPosition; // For now
  cameraPosition = uOffsetMatrix * cameraPosition;

  gl_Position = uPerspectiveMatrix * cameraPosition;

  // gl_Position = worldPosition;
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

    /** @param {Matrix 4x4} */
  _rotationXMatrix = Matrix.rotationX(0);

  /** @param {Matrix 4x4} */
  _rotationYMatrix = Matrix.rotationY(0);

  /** @param {Matrix 4x4} */
  _rotationZMatrix = Matrix.rotationZ(0);

  rotationOrder = ["x", "y", "z"];


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
    uCameraMatrix: Matrix.identity(4, 4).toGLSLArray(),
    uOffsetMatrix: Matrix.identity(4, 4).toGLSLArray(),
    uOffset: [0, 0, 0]
  };


  #offsetMatrix;

  get offsetMatrix() { return this.#offsetMatrix; }

  set offsetMatrix(value) {
    this.#offsetMatrix = value;
    this.uniforms.uOffsetMatrix = value.toGLSLArray();
  }

  /** @type {Point3d} */
  #viewerPosition = new Point3d();

  /** @type {Point3d} */
  #targetPosition = new Point3d();

  static create(viewerPosition, targetPosition, defaultUniforms = {}) {
    const res = super.create(defaultUniforms);
    res.viewerPosition = viewerPosition;
    res.targetPosition = targetPosition;

    res.calculatePerspectiveMatrix();
    //res.calculateModelWorldMatrix();
    return res;
  }

  set viewerPosition(value) {
    this.#targetPosition.copyPartial(value);
    this.calculateCameraMatrix();
  }

  set targetPosition(value) {
    this.#targetPosition.copyPartial(value);
    this.calculateCameraMatrix();
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

  set rotation(rotationPoint) {
    this.#rotation.copyFrom(rotationPoint);
    this._rotationXMatrix = Matrix.rotationX(this.#rotation.x);
    this._rotationYMatrix = Matrix.rotationY(this.#rotation.y);
    this._rotationZMatrix = Matrix.rotationZ(this.#rotation.z);
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

  calculatePerspectiveMatrix() {
    const fovy = this.#fieldOfView;
    const aspect = this.#aspectRatio;
    const zNear = this.#zNear;
    const zFar = this.#zFar;
    this.perspectiveMatrix = Matrix.perspectiveDegrees(fovy, aspect, zNear, zFar);
    this.uniforms.uPerspectiveMatrix = this.perspectiveMatrix.toGLSLArray();
  }

  calculateModelWorldMatrix() {
    // Do rotation first, assuming the models are centered at 0,0,0.
    // Then scale, and finally translate.
    const newMat = Matrix.empty(4, 4);
    const rot0 = this[ROTATION_MATRICES[this.rotationOrder[0]]];
    const rot1 = this[ROTATION_MATRICES[this.rotationOrder[1]]];
    const rot2 = this[ROTATION_MATRICES[this.rotationOrder[2]]];

    this.#scaleMatrix.multiply4x4(rot0, newMat);
    newMat.multiply4x4(rot1, newMat);
    newMat.multiply4x4(rot2, newMat);
    newMat.multiply4x4(this.#translationMatrix, newMat);
    this.modelWorldMatrix = newMat;
    this.uniforms.uModelWorldMatrix = this.modelWorldMatrix.toGLSLArray();
  }

  calculateCameraMatrix() {
    const res = Matrix.lookAt(this.#viewerPosition, this.#targetPosition);
    this.lookAtM = res; // For debugging
    this.uniforms.uCameraMatrix = res.Minv.toGLSLArray();
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

viewer = _token
let [target] = game.user.targets;

viewerPt = Point3d.fromTokenCenter(viewer);
targetPt = Point3d.fromTokenCenter(target);


geom = new WallGeometry();
shader = UnitPlaceableShader.create(viewerPt, targetPt);
mesh = new PIXI.Mesh(geom, shader);
canvas.stage.addChild(mesh);
canvas.stage.removeChild(mesh);

// translation matrix
offsetMatrix = Matrix.translation(0, 0, -2)
shader.uniforms.uOffsetMatrix = offsetMatrix.toGLSLArray();

// Identity matrix for world and camera for testing
shader.uniforms.uCameraMatrix = Matrix.identity(4, 4).toGLSLArray();
shader.uniforms.uModelWorldMatrix = Matrix.identity(4, 4).toGLSLArray();

// Calculate a proper model-world matrix
shader.translation = new Point3d();
shader.rotation = new Point3d();
shader.scale = new Point3d(1, 1, 1);

wall = canvas.walls.placeables[0]
let { A, B } = Point3d.fromWall(wall, { finite: true });
midpoint = Point3d.midPoint(A.top, B.bottom);
shader.translation = midpoint;

width = PIXI.Point.distanceBetween(A.top, B.top);
height = A.top.z - A.bottom.z;
shader.scale = new Point3d(width, height, 1);

angle = Math.acos(Math.abs(A.top.x - B.top.x) / width);
if ( A.top.y < B.top.y ) angle *= -1;
shader.rotationOrder = ["x", "y", "z"]
shader.rotation = new Point3d(-RADIANS_90, 0, -angle);


// Invert the world matrix for testing
worldMatrix = Matrix.fromFlatArray(shader.worldMatrix, 4, 4);
shader.uniforms.uModelWorldMatrix = worldMatrix.toGLSLArray();
shader.uniforms.uCameraMatrix = worldMatrix.invert().toGLSLArray();


// Activate culling to not draw opposite faces.
mesh.state.culling = true
mesh.state.clockwiseFrontFace = true


offsetMatrix = Matrix.rotationX(Math.toRadians(30))
  .multiply(Matrix.translation(0, 0, -2))
shader.uniforms.uOffsetMatrix = offsetMatrix.toGLSLArray()

shader.translation = new Point3d(0, 0, -2)
shader.rotation = new Point3d(Math.toRadians(30), 0, 0);
shader.aspectRatio = window.outerWidth / window.outerHeight

await rotate("y")
canvas.stage.removeChild(mesh);


// Check the world matrix against wall position
worldMatrix = Matrix.fromFlatArray(shader.worldMatrix, 4, 4);
buffer = geom.getBuffer("aVertex").data
vertices = [];
for ( let i = 0; i < buffer.length; i += 3 ) {
  vertices.push(new Point3d(buffer[i], buffer[i+1], buffer[i+2]))
}
vertices.map(pt => worldMatrix.multiplyPoint3d(pt))
actualPts = Point3d.fromWall(wall, { finite: true })
tmp = [actualPts.A.top, actualPts.B.top, actualPts.B.bottom, actualPts.A.bottom]



scaledPts = vertices.map(pt => shader.scaleMatrix.multiplyPoint3d(pt))
rot0Pts = scaledPts.map(pt => shader._rotationXMatrix.multiplyPoint3d(pt))
rot1Pts = rot0Pts.map(pt => shader._rotationYMatrix.multiplyPoint3d(pt))
rot2Pts = rot1Pts.map(pt => shader._rotationZMatrix.multiplyPoint3d(pt))
trPts = rot2Pts.map(pt => shader.translationMatrix.multiplyPoint3d(pt))

// Camera matrix
cameraPts = trPts.map(pt => shader.lookAtM.Minv.multiplyPoint3d(pt))

// Perspective matrix
perspectivePts = cameraPts.map(pt => shader.perspectiveMatrix.multiplyPoint3d(pt))


targetMat = glMatrix.mat4.create()
eye = glMatrix.vec3.fromValues(viewerPt.x, viewerPt.y, viewerPt.z)
center = glMatrix.vec3.fromValues(targetPt.x, targetPt.y, targetPt.z)
up = glMatrix.vec3.fromValues(0, 0, 1)
glMatrix.mat4.targetTo(targetMat, eye, center, up)

lookAtMat = glMatrix.mat4.create()
glMatrix.mat4.lookAt(lookAtMat, eye, center, up)




