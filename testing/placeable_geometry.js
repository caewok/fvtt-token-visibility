Draw = CONFIG.GeometryLib.Draw
Draw.clearDrawings()

drawFn = (placeable, color) => {
  const fill = color
  fillAlpha = 0.5
  const geometry = placeable.tokenvisibility.geometry;
  geometry.aabb.draw2d({ color });
  geometry.top.draw2d({ color, fill, fillAlpha })
}
color = Draw.COLORS.red
canvas.tokens.placeables.forEach(token => drawFn(token, color))

color = Draw.COLORS.orange
canvas.tiles.placeables.forEach(tile => drawFn(tile, color))

color = Draw.COLORS.blue
canvas.walls.placeables.forEach(wall => drawFn(wall, color))

color = Draw.COLORS.green
canvas.regions.placeables.forEach(region => drawFn(region, color))

canvas.regions.placeables.forEach((region, color) => {
  region.shapes.forEach(shape => drawFn(shape, color))
})

canvas.tokens.placeables.forEach(token => {
  const geometry = token.tokenvisibility.geometry;
  geometry.modelMatrix.print()
})


canvas.tiles.placeables.forEach(tile => {
  const geometry = tile.tokenvisibility.geometry;
  geometry.modelMatrix.print()
})


canvas.walls.placeables.forEach(wall => {
  const geometry = wall.tokenvisibility.geometry;
  geometry.modelMatrix.print()
})


canvas.regions.placeables.forEach(region => {
  region.shapes.forEach(shape => {
    const geometry = shape.tokenvisibility.geometry;
    geometry.modelMatrix.print()
  })
})

canvas.tokens.placeables.forEach(token => {
  const geometry = token.tokenvisibility.geometry;
  geometry.top.draw2d({ color: Draw.COLORS.red, fill: Draw.COLORS.red, fillAlpha: 0.5  })
})


canvas.tiles.placeables.forEach(tile => {
  const geometry = tile.tokenvisibility.geometry;
  geometry.top.draw2d({ color: Draw.COLORS.orange })
})


canvas.walls.placeables.forEach(wall => {
  const geometry = wall.tokenvisibility.geometry;
  geometry.top.draw2d({ color: Draw.COLORS.blue })
})


canvas.regions.placeables.forEach(region => {
  region.shapes.forEach(shape => {
    const geometry = shape.tokenvisibility.geometry;
    geometry.top.draw2d({ color: Draw.COLORS.green })
  })
})