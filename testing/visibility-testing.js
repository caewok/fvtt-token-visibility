Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw
Sphere = CONFIG.GeometryLib.threeD.Sphere
MatrixFlat = CONFIG.GeometryLib.MatrixFlat

api = game.modules.get("tokenvisibility").api
BitSet = api.BitSet
PercentVisibleCalculatorPoints = api.calcs.points.prototype.constructor
TokenLightMeter = api.TokenLightMeter

target = canvas.tokens.placeables.find(t => t.name === "Randal")
viewer = canvas.tokens.placeables.find(t => t.name === "Zanna")


