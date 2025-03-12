// Test rendering to a popout application canvas.

Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
WallTriangles = api.triangles.WallTriangles
Plane = CONFIG.GeometryLib.threeD.Plane
ClipperPaths = CONFIG.GeometryLib.ClipperPaths
let { PolygonVerticalTriangles, Square2dTriangles, SquareVerticalTriangles, Triangle } = api.triangles
QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn
QBenchmarkLoopFnWithSleep = CONFIG.GeometryLib.bench.QBenchmarkLoopFnWithSleep
extractPixels = CONFIG.GeometryLib.utils.extractPixels
GEOMETRY_ID = "_atvPlaceableGeometry";
MatrixFlat = CONFIG.GeometryLib.MatrixFlat
Area3dPopout = api.Area3dPopout
Area3dPopoutCanvas = api.Area3dPopoutCanvas
WebGPUDevice = api.webgpu.WebGPUDevice


viewer = _token
target = game.user.targets.first()

losCalc = viewer.vision.tokenvisibility.losCalc
losCalc.target = target
vp = losCalc.viewpoints[0]

// Doesn't work
popout = new Area3dPopoutV2()
await popout.render({ title: "Render Test" })
canvas = document.getElementById(`${popout.id}_canvas`);

// Works
popout = new Area3dPopoutBasic({ title: "Render Test" });
await popout._render(true)

canvas = document.getElementById(`${popout.id}_canvas`);
webGPUContext = canvas.getContext("webgpu") // Can only get one or the other.
webGLContext = canvas.getContext("webgl")

// Works, sort of
popout = new Area3dPopout({ title: "Render Test" });
await popout.render(true)
elem = popout.element["0"]
elem.querySelector("canvas").getContext("webgl")
elem.querySelector("canvas").getContext("webgpu")

canvas = document.getElementById(`${popout.id}_canvas`);
webGPUContext = canvas.getContext("webgpu") // Won't work with PIXI.
webGLContext = canvas.getContext("webgl")

webGL2Context =

elem = popout.element["0"]
elem.querySelector("canvas")


// Get the context for a new popout canvas.
popout = new Area3dPopoutCanvas()
await popout.render();




// Test from https://webgpufundamentals.org/webgpu/lessons/webgpu-fundamentals.html
// Get a WebGPU context from the canvas and configure it
device = await WebGPUDevice.getDevice()
presentationFormat = navigator.gpu.getPreferredCanvasFormat();
popout.context.configure({
  device,
  format: presentationFormat,
});

module = device.createShaderModule({
  label: 'our hardcoded red triangle shaders',
  code: `
    @vertex fn vs(
      @builtin(vertex_index) vertexIndex : u32
    ) -> @builtin(position) vec4f {
      let pos = array(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
      );

      return vec4f(pos[vertexIndex], 0.0, 1.0);
    }

    @fragment fn fs() -> @location(0) vec4f {
      return vec4f(1.0, 0.0, 0.0, 1.0);
    }
  `,
});

pipeline = device.createRenderPipeline({
  label: 'our hardcoded red triangle pipeline',
  layout: 'auto',
  vertex: {
    entryPoint: 'vs',
    module,
  },
  fragment: {
    entryPoint: 'fs',
    module,
    targets: [{ format: presentationFormat }],
  },
});

renderPassDescriptor = {
  label: 'our basic canvas renderPass',
  colorAttachments: [
    {
      // view: <- to be filled out when we render
      clearValue: [0.3, 0.3, 0.3, 1],
      loadOp: 'clear',
      storeOp: 'store',
    },
  ],
};

function render() {
  // Get the current texture from the canvas context and
  // set it as the texture to render to.
  renderPassDescriptor.colorAttachments[0].view =
      popout.context.getCurrentTexture().createView();

  // make a command encoder to start encoding commands
  const encoder = device.createCommandEncoder({ label: 'our encoder' });

  // make a render pass encoder to encode render specific commands
  const pass = encoder.beginRenderPass(renderPassDescriptor);
  pass.setPipeline(pipeline);
  pass.draw(3);  // call our vertex shader 3 times
  pass.end();

  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);
}

render();



