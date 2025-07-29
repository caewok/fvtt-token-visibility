Draw = CONFIG.GeometryLib.Draw
Draw.clearDrawings()

drawFn = (placeable, color) => {
  const fill = color
  fillAlpha = 0.5
  const geometry = placeable.tokenvisibility.geometry;
  geometry.aabb.draw2d({ color });
  geometry.top.draw2d({ color, fill, fillAlpha })
  // geometry.modelMatrix?.print()
  // geometry.sides.forEach(side => side.draw2d({ color, fill, fillAlpha }))
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




