Draw = CONFIG.GeometryLib.Draw;
Point3d = CONFIG.GeometryLib.threeD.Point3d;
Matrix = CONFIG.GeometryLib.Matrix;

let RADIANS_90 = Math.toRadians(90);
let UP_VECTOR = new Point3d(0, 0, -1);

class AbstractEVShader extends PIXI.Shader {
  constructor(program, uniforms) {
    super(program, foundry.utils.deepClone(uniforms));

    /**
     * The initial default values of shader uniforms
     * @type {object}
     */
    this._defaults = uniforms;
  }

  /* -------------------------------------------- */

  /**
   * The raw vertex shader used by this class.
   * A subclass of AbstractBaseShader must implement the vertexShader static field.
   * @type {string}
   */
  static vertexShader = "";

  /**
   * The raw fragment shader used by this class.
   * A subclass of AbstractBaseShader must implement the fragmentShader static field.
   * @type {string}
   */
  static fragmentShader = "";

  /**
   * The default uniform values for the shader.
   * A subclass of AbstractBaseShader must implement the defaultUniforms static field.
   * @type {object}
   */
  static defaultUniforms = {};

  /* -------------------------------------------- */

  /**
   * A factory method for creating the shader using its defined default values
   * @param {object} defaultUniforms
   * @returns {AbstractBaseShader}
   */
  static create(defaultUniforms) {
    const program = PIXI.Program.from(this.vertexShader, this.fragmentShader);
    const uniforms = mergeObject(this.defaultUniforms, defaultUniforms, {inplace: false, insertKeys: true});
    return new this(program, uniforms);
  }

  /* -------------------------------------------- */

  /**
   * Reset the shader uniforms back to their provided default values
   * @private
   */
  reset() {
    for (let [k, v] of Object.entries(this._defaults)) {
      this.uniforms[k] = v;
    }
  }
}

let ROTATION_MATRICES = {
  x: "_rotationXMatrix",
  y: "_rotationYMatrix",
  z: "_rotationZMatrix"
};

// Display walls from point of view of the viewer looking at a target.
class PlaceableUnitVertices {
  /** @type {PlaceableObject} */
  object;

  /** @param {Matrix 4x4} */
  modelMatrix = Matrix.identity(4, 4); // Model to World

  /** @param {Matrix 4x4} */
  _translationMatrix = Matrix.translation(0, 0, 0);

  /** @param {Matrix 4x4} */
  _scaleMatrix = Matrix.scale(1, 1, 1);

  /** @param {Matrix 4x4} */
  _rotationXMatrix = Matrix.rotationX(0);

  /** @param {Matrix 4x4} */
  _rotationYMatrix = Matrix.rotationY(0);

  /** @param {Matrix 4x4} */
  _rotationZMatrix = Matrix.rotationZ(0);

  _rotationOrder = ["z", "y", "x"];

  constructor(object) {
    this.object = object;
    this.updateModelMatrix();
  }

  /**
   * Construct a 4x4 scale, rotate, transform matrix based on the wall.
   */
  updateModelMatrix() {
    // Combine the matrices.
    const newMat = Matrix.identity(4, 4);
    const rot0 = ROTATION_MATRICES[this._rotationOrder[0]];
    const rot1 = ROTATION_MATRICES[this._rotationOrder[1]];
    const rot2 = ROTATION_MATRICES[this._rotationOrder[2]];

    rot0.multiply4x4(this._scaleMatrix, newMat);
    newMat.multiply4x4(rot1, newMat);
    newMat.multiply4x4(rot2, newMat);
    newMat.mutiply4x4(this._translationMatrix, newMat);
    this.modelMatrix = newMat;
  }

  static verticesToGLSLArray(vertices) {
    const arr = [];
    vertices.forEach(pt => arr.push(pt.x, pt.y, pt.z));
    return arr;
  }

  /**
   * Get the set of vertices in world space.
   * @returns {Point3d[4]}
   */
  transformedVertices() {
    const modelM = this.modelMatrix;
    return this.constructor.vertices.map(pt => modelM.multiplyPoint3d(pt));
  }
}

class WallPlaceableUnitVertices {
  /** @type {number[12]} */
  static indices = [
    // Top
    0, 1, 2, // TL - TR - BR
    0, 2, 3, // TL - BR - BL

    // Bottom
    0, 3, 2,
    0, 2, 1,
  ];

  static colors = [
    // Top: Shades of green
    0.0, 1.00, 0.0,
    0.0, 1.00, 0.25,
    0.0, 1.00, 0.75,
    0.0, 1.00, 1.0,
  ];

  // TODO: Add indices getter; use directional indices if wall is one-way for the viewer type.
  static directionalIndices = [
    // Top
    0, 1, 2, // TL - TR - BR
    0, 2, 3, // TL - BR - BL
  ];

  static verticesToGLSLArray(vertices) {
    const arr = [];
    vertices.forEach(pt => arr.push(pt.x, pt.y, pt.z));
    return arr;
  }

  constructor(wall) {
    this.object = wall;
  }

  transformedVertices() {
    const { A, B } = Point3d.fromWall(this.object, { finite: true});
    return [
      A.top,
      B.top,
      B.bottom,
      A.bottom
    ];
  }
}

class TilePlaceableUnitVertices extends WallPlaceableUnitVertices {
  static uvs = [
    // Top, looking down
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1, // BL
  ];

  transformedVertices() {
    const pts = Point3d.fromTile(this.object);
    return [
      pts.tl,
      pts.tr,
      pts.br,
      pts.bl
    ];
  }
}





class TokenPlaceableUnitVertices extends PlaceableUnitVertices {

  /** @type {Point3d[4]} */
  static vertices = [
    // Top, looking down
    new Point3d(-0.50,  0.50, 0.50), // TL
    new Point3d( 0.50,  0.50, 0.50), // TR
    new Point3d( 0.50, -0.50, 0.50), // BR
    new Point3d(-0.50, -0.50, 0.50), // BL

    // Bottom, looking up
    new Point3d(-0.50,  0.50, -0.50), // TL
    new Point3d( 0.50,  0.50, -0.50), // TR
    new Point3d( 0.50, -0.50, -0.50), // BR
    new Point3d(-0.50, -0.50, -0.50), // BL
  ];

  static colors = [
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

  /** @type {number[12]} */
  static indices = [
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

  /**
   * Construct a 4x4 scale, rotate, transform matrix based on the token.
   */
  updateModelMatrix() {
    const tokenBounds = this.object.bounds;

    // Get the exact token center.
    const center = tokenBounds.center;
    const height = token.topZ - token.bottomZ; // TODO: Handle prone tokens.
    const midpoint = new Point3d(center.x, center.y, token.bottomZ + (height * 0.5));

    // Translate to the token midpoint.
    this._translationMarix = Matrix.translation(midpoint.x, midpoint.y, midpoint.z);

    // Scale based on bounds width, height and token height.
    this._scaleMatrix = Matrix.scale(tokenBounds.width, tokenBounds.height, height);

    // No rotation required.
    // Combine the matrices.
    super.updateModelMatrix();
  }
}


class PlaceablesGeometry extends PIXI.Geometry {
  /** @type {PlaceableUnitVertices} */
  #placeableVertices;

  constructor(vertices) {
    super();
    this.#placeableVertices = vertices;
    this.initializeVertices();
  }

  initializeVertices() {
    const aVertices = [];
    const aColors = []; // For debugging
    const indices = [];

    // Offset the indices of each object so the indices point to the correct vertices.
    let offset = 0;
    for ( const v of this.#placeableVertices ) {
      const cl = v.constructor;
      const vertices = cl.verticesToGLSLArray(v.transformedVertices());
      aVertices.push(...vertices);
      aColors.push(...cl.colors);
      indices.push(...cl.indices.map(i => i + offset));
      offset += vertices.length;
    }

    this.addAttribute("aVertex", aVertices, 3);
    this.addAttribute("aColor", aColors, 3);
    this.addIndex(indices);
  }
}

class PlaceablesShader extends AbstractEVShader {

  static vertexShader =
  // eslint-disable-next-line indent
`#version 300 es
precision ${PIXI.settings.PRECISION_VERTEX} float;

in vec3 aVertex;
in vec3 aColor;
in vec4 aTestVertex;

out vec4 vColor;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

uniform mat4 uPerspectiveMatrix;
uniform mat4 uCameraMatrix;
uniform vec3 uOffset;

void main() {
  vColor = vec4(aColor, 1.0);

  vec4 worldPosition = vec4(aVertex, 1.0);

  vec4 cameraPosition = uCameraMatrix * worldPosition;
  gl_Position = uPerspectiveMatrix * cameraPosition;

  gl_Position = vec4(aTestVertex.x, aTestVertex.y, -aTestVertex.z, aTestVertex.w);
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
  #viewerPosition = new Point3d();

  /** @type {Point3d} */
  #targetPosition = new Point3d();

  /**
   * Uniforms added to the shader.
   * TODO: Replace offset with translation matrix.
   * {number[3]} uOffset    Offset the shape in the x, y, and z directions.
   * {number[16]} uPerspectiveMatrix    Matrix to set the perspective.
   */
  static defaultUniforms = {
    uPerspectiveMatrix: Matrix.identity(4, 4).toGLSLArray(),
    uCameraMatrix: Matrix.identity(4, 4).toGLSLArray()
  };

  static create(viewerPosition, targetPosition, defaultUniforms = {}) {
    const res = super.create(defaultUniforms);
    res.calculatePerspectiveMatrix();
    res.viewerPosition = viewerPosition;
    res.targetPosition = targetPosition;
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

    // For debugging
    this.perspectiveM = Matrix.perspectiveDegrees(fovy, aspect, zNear, zFar);
    this.uniforms.uPerspectiveMatrix = this.perspectiveM.toGLSLArray();
  }

  calculateCameraMatrix() {
    const res = Matrix.lookAt(this.#viewerPosition, this.#targetPosition);
    this.lookAtM = res; // For debugging
    this.uniforms.uCameraMatrix = res.Minv.toGLSLArray();
  }
}

// Get viewer and target locations
viewer = _token
let [target] = game.user.targets;

// Pull walls from the scene for testing
wallVertices = canvas.walls.placeables.map(w => new WallPlaceableUnitVertices(w))
shader = PlaceablesShader.create(Point3d.fromTokenCenter(viewer), Point3d.fromTokenCenter(target));

// Testing: set up test vertices.
testVertices = WallPlaceableUnitVertices.verticesToGLSLArray(perspectivePts)


geom = new PlaceablesGeometry([wallVertices[0]]);
geom.addAttribute("aTestVertex", testVertices, 3);



mesh = new PIXI.Mesh(geom, shader);
canvas.stage.addChild(mesh)
canvas.stage.removeChild(mesh)

Vs = wallVertices[0].transformedVertices()

wV0 = wallVertices[0]

scaled = Array(4)
rotated = Array(4)
translated = Array(4)
for ( let i = 0; i < 4; i += 1 ) {
  scaled[i] = wV0._scaleMatrix.multiplyPoint3d(WallPlaceableUnitVertices.vertices[i])
  rotated[i] = wV0._rotationMatrix.multiplyPoint3d(scaled[i])
  translated[i] = wV0._translationMatrix.multiplyPoint3d(rotated[i])
}



tilePts = canvas.tiles.placeables.map(tile => Point3d.fromTile(tile));
tilePts.forEach(pts => Object.values(pts).forEach(pt => Draw.point(pt)))
tilePts.forEach(pts => Draw.connectPoints(Object.values(pts)))

pts = tilePts[0]

// Test the camera matrix
wV0 = wallVertices[0].transformedVertices()
Draw.connectPoints(wV0)
cameraPts = wV0.map(pt => shader.lookAtM.Minv.multiplyPoint3d(pt))
perspectivePts = cameraPts.map(pt => shader.perspectiveM.multiplyPoint3d(pt))

// versus the straight divide that is done in PlanePoints3d
cameraPts.map(pt => new PIXI.Point(pt.x / -pt.z, pt.y / -pt.z))

// Using 4-D
cameraPts4 = wV0.map(pt => shader.lookAtM.Minv.multiply(Matrix.fromPoint3d(pt).transpose()))

cameraPts4.map(pt => shader.perspectiveM.multiply(pt));