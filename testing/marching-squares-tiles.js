Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
Plane = CONFIG.GeometryLib.threeD.Plane
ClipperPaths = CONFIG.GeometryLib.ClipperPaths
QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn
QBenchmarkLoopFnWithSleep = CONFIG.GeometryLib.bench.QBenchmarkLoopFnWithSleep
extractPixels = CONFIG.GeometryLib.utils.extractPixels
GEOMETRY_ID = "_atvPlaceableGeometry";
MatrixFlat = CONFIG.GeometryLib.MatrixFlat
MatrixFloat32 = CONFIG.GeometryLib.MatrixFloat32
Area3dPopout = api.Area3dPopout
Area3dPopoutCanvas = api.Area3dPopoutCanvas
Settings = api.Settings
MarchingSquares = api.MarchingSquares

function summarizePixelData(pixels, alphaThreshold = 255 * 0.75) {
  if ( Object.hasOwn(pixels, "pixels") ) pixels = pixels.pixels;
  const acc = Array(12).fill(0);
  const max = Array(4).fill(0);
  const min = Array(4).fill(0)
  const threshold = Array(4).fill(0);
  pixels.forEach((px, idx) => {
    acc[idx % 4] += px;
    acc[idx % 4 + 4] += Boolean(px);
    acc[idx % 4 + 8] += !px;
    max[idx % 4] = Math.max(px, max[idx % 4])
    min[idx % 4] = Math.min(px, min[idx % 4])
    threshold[idx % 4] += Boolean(px >= alphaThreshold)
   });
  let redBlocked = 0;
  const terrainThreshold = 255 * 0.75;
  for ( let i = 0, iMax = pixels.length; i < iMax; i += 4 ) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    redBlocked += Boolean(r) * Boolean(b || (g > terrainThreshold))
  }

  console.table([
    { label: "sum", r: acc[0], g: acc[1], b: acc[2], a: acc[3] },
    { label: "count", r: acc[4], g: acc[5], b: acc[6], a: acc[7] },
    { label: "zeroes", r: acc[8], g: acc[9], b: acc[10], a: acc[11] },
    { label: "min", r: min[0], g: min[1], b: min[2], a: min[3] },
    { label: "max", r: max[0], g: max[1], b: max[2], a: max[3] },
    { label: "redBlocked", r: redBlocked, g: redBlocked, b: redBlocked, a: redBlocked},
    { label: "threshold", r: threshold[0], g: threshold[1], b: threshold[2], a: threshold[3] },
  ])
}

function summarizeSinglePixelData(pixels, alphaThreshold = 255 * 0.75) {
  if ( Object.hasOwn(pixels, "pixels") ) pixels = pixels.pixels;
  let sum = 0;
  let count = 0;
  let zeroes = 0;
  let threshold = 0;
  let max = 0;
  let min = 0;
  pixels.forEach((px, idx) => {
    sum += px;
    count += Boolean(px);
    zeroes += !px;
    threshold += Boolean(px > alphaThreshold)
    max = Math.max(px, max)
    min = Math.min(px, min)
  });

  console.table([
    { sum, count, zeroes, threshold, max, min }
  ])
}

tile = canvas.tiles.placeables[0]

// Copy alpha channel only to a buffer.
// Set views into the buffer to represent each row


// EVPixelCache only caches the alpha channel
pixels = tile.evPixelCache.pixels
summarizeSinglePixelData(pixels)


// Test drawing each pixel
threshold = 255 * 0.75
width = tile.evPixelCache.width
height = tile.evPixelCache.height
for ( let x = 0; x < width; x += 4 ) {
  for ( let y = 0; y < height; y += 4 ) {
    const i = y * width + x;
    if ( pixels[i] > threshold ) Draw.point({ x, y }, { radius: 1 })
  }
}

// Convert to isolines
// Buffer all 4 sides with zeroes.
rowViews = new Array(height + 2);
rowViews[0] = new Array(width + 2).fill(0)
rowViews[height + 2 - 1] = new Array(width + 2).fill(0)
for ( let r = 1, start = 0, rMax = height + 1; r < rMax; r += 1, start += width ) {
  rowViews[r] = [0, ...pixels.slice(start, start + width), 0];
}
lines = api.MarchingSquares.isoLines(rowViews, 255 * 0.75)

// Or Use isobands, which seem to work better for this purpose
rowViews = new Array(height);
for ( let r = 0, start = 0, rMax = height; r < rMax; r += 1, start += width ) {
  rowViews[r] = [...pixels.slice(start, start + width)];
}
lines = api.MarchingSquares.isoBands(rowViews, threshold, 256 - threshold)

// Create polygons
nPolys = lines.length;
polys = new Array(nPolys);
for ( let i = 0; i < nPolys; i += 1 ) {
  polys[i] = new PIXI.Polygon(lines[i].flatMap(pt => pt))
}
polys.forEach(poly => Draw.shape(poly, { color: Draw.COLORS.blue }))


// Create polygons scaled between 0 and 1, based on width and height.
invWidth = 1 / width;
invHeight = 1 / height;
nPolys = lines.length;
polys = new Array(nPolys);
for ( let i = 0; i < nPolys; i += 1 ) {
  polys[i] = new PIXI.Polygon(lines[i].flatMap(pt => [pt[0] * invWidth, pt[1] * invHeight]))
}

// Draw each
polys.forEach(poly => {
  Draw.shape(poly.scale(width, height))
})

// Add to Clipper
// Polys from MarchingSquares are CW if hole; reverse
polys.forEach(poly => poly.reverseOrientation())
cp = ClipperPaths.fromPolygons(polys, { scalingFactor: 100 })
cleanedPolys = cp.clean().toPolygons()

// Draw non-holes for testing
cleanedPolys.forEach(poly => {
  if ( poly.isHole ) return;
  Draw.shape(poly, { color: Draw.COLORS.blue })
})

cleanedPolys.map(poly => poly.area)

// Drop polys with very small areas
cleanedPolys = cleanedPolys.filter(poly => poly.area > 10);
cleanedPolys.forEach(poly => Draw.shape(poly, { color: Draw.COLORS.blue }))

// Earcut the polys
polys.forEach(poly => poly.reverseOrientation())
cp = ClipperPaths.fromPolygons(polys, { scalingFactor: 100 })
cpCleaned = cp.clean().trimByArea(25);
polys = cpCleaned.toPolygons()

polys.forEach(poly => {
  const color = (poly.isHole ?? !poly.isClockwise) ? Draw.COLORS.red : Draw.COLORS.blue;
  Draw.shape(poly, { color })
})


// Testing
polys = tile.tokenvisibility.alphaThresholdPolygon.toPolygons()
polys.forEach(poly => Draw.shape(poly, { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.25 }))

tris = tile.tokenvisibility.alphaThresholdTriangles
tris.forEach(tri => Draw.shape(tri.toPolygon(), { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.25 }))
