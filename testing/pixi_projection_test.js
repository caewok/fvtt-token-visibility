// Testing PIXI Projection
// https://pixijs.io/examples-v4/#/plugin-projection/quad-homo.js
Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d;
api = game.modules.get("tokenvisibility").api;
Area3dLOS = api.Area3dLOS;
PixelCache = api.PixelCache

let [viewer] = canvas.tokens.controlled;
let [target] = game.user.targets;

calc = new Area3dLOS(viewer, target)
calc.percentVisible()
let [tile] = calc.blockingObjects.tiles

Sprite2d = api.PIXI.projection.Sprite2d
Sprite2d = PIXI.projection.Sprite2d

containerSprite = new Sprite2d(tile.texture);
containerSprite.anchor.set(0.5)
canvas.stage.addChild(containerSprite)

w = canvas.app.screen.width / 2;
h = canvas.app.screen.height / 2;

function createSquare(x, y) {
    var square = new PIXI.Sprite(PIXI.Texture.WHITE);
    square.tint = 0xff0000;
    square.factor = 1;
    square.anchor.set(0.5);
    square.position.set(x, y);
    return square;
}

squares = [
    createSquare(w - 150, h - 150),
    createSquare(w + 150, h - 150),
    createSquare(w + 150, h + 150),
    createSquare(w - 150, h + 150)
];

quad = squares.map(function(s) { return s.position; });


quad = [
  new PIXI.Point(0, 0),
  new PIXI.Point(containerSprite.width, 0),
  new PIXI.Point(containerSprite.width, containerSprite.height),
  new PIXI.Point(0, containerSprite.height),
]


quad[0].x += 400
quad[1].x -= 400

containerSprite.proj.mapSprite(containerSprite, quad)

let [tilePts] = calc.blockingObjectsPoints.tiles
containerSprite.proj.mapSprite(containerSprite, tilePts.tPoints)

perspectivePoints = tilePts.perspectiveTransform();
containerSprite.proj.mapSprite(containerSprite, perspectivePoints); // Works!

// Now, can we do that with a mesh?
stateOrig = {
  vertices: [
    0, 0, // TL
    tile.texture.width, 0, // TR
    tile.texture.width, tile.texture.height, // BR
    0, tile.texture.height  // BL
  ],

  uvs: [
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1  // BL
  ],

  indices: [
    0, 1, 2, // TL, TR, BR
    0, 2, 3  // TL, BR, BL
  ]
}

containerMesh = new PIXI.SimpleMesh(tile.texture, stateOrig.vertices, stateOrig.uvs, stateOrig.indices)
canvas.stage.addChild(containerMesh)
canvas.stage.removeChild(containerMesh)


stateOrig2d = {
  vertices: [
    0, 0, 200, // TL
    tile.texture.width, 0, 200, // TR
    tile.texture.width, tile.texture.height, 200, // BR
    0, tile.texture.height, 200  // BL
  ],

  uvs: [
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1  // BL
  ],

  indices: [
    0, 1, 2, // TL, TR, BR
    0, 2, 3  // TL, BR, BL
  ]
}



SimpleMesh2d = api.PIXI.projection.SimpleMesh2d
containerMesh2d = new SimpleMesh2d(tile.texture, stateOrig2d.vertices, stateOrig2d.uvs, new Uint16Array(stateOrig2d.indices))
canvas.stage.addChild(containerMesh2d)
canvas.stage.removeChild(containerMesh2d)

stateFlat = {
  vertices: [
    tilePts.tPoints[0].x, tilePts.tPoints[0].y, // TL
    tilePts.tPoints[1].x, tilePts.tPoints[1].y, // TR
    tilePts.tPoints[2].x, tilePts.tPoints[2].y, // BR
    tilePts.tPoints[3].x, tilePts.tPoints[3].y  // BL
  ],

  uvs: [
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1  // BL
  ],

  indices: [
    0, 1, 2, // TL, TR, BR
    0, 2, 3  // TL, BR, BL
  ]
}


containerMesh = new PIXI.SimpleMesh(tile.texture, stateFlat.vertices, stateFlat.uvs, stateFlat.indices)
canvas.stage.addChild(containerMesh)
canvas.stage.removeChild(containerMesh)

SimpleMesh2d = api.PIXI.projection.SimpleMesh2d
containerMesh2d = new SimpleMesh2d(tile.texture, stateFlat.vertices, stateFlat.uvs, new Uint16Array(stateFlat.indices))
canvas.stage.addChild(containerMesh2d)

stateProj = {
  vertices: [
    perspectivePoints[0].x, perspectivePoints[0].y, // TL
    perspectivePoints[1].x, perspectivePoints[1].y, // TR
    perspectivePoints[2].x, perspectivePoints[2].y, // BR
    perspectivePoints[3].x, perspectivePoints[3].y  // BL
  ],

  uvs: [
    0, 0, // TL
    1, 0, // TR
    1, 1, // BR
    0, 1  // BL
  ],

  indices: [
    0, 1, 2, // TL, TR, BR
    0, 2, 3  // TL, BR, BL
  ]
}

SimpleMesh2d = api.PIXI.projection.SimpleMesh2d
containerMesh2d = new SimpleMesh2d(tile.texture, stateProj.vertices, stateProj.uvs, new Uint16Array(stateProj.indices))
canvas.stage.addChild(containerMesh2d)
