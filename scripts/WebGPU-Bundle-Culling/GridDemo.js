/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// From https://github.com/toji/webgpu-bundle-culling/blob/main/index.html

import { vec3, vec4, mat4, quat } from 'https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/esm/index.js';
import { wgsl } from 'https://cdn.jsdelivr.net/npm/wgsl-preprocessor@1.0/wgsl-preprocessor.js';
import { QueryArgs } from './query-args.js';
import { TinyWebGpuDemo } from './TinyWebGPUDemo.js'
import { AttribLocation, Geometry } from './Geometry.js'
import { TimestampHelper } from './TimestampHelper.js'
import { BoxGeometryDesc, WallGeometryDesc } from './shapes.js'


const tempMat = mat4.create();
const tempQuat = quat.create();

const MAX_INSTANCES_PER_DRAWABLE = QueryArgs.getInt("instancesPerDrawable", navigator.userAgentData?.mobile ? 500 : 1000);
const INSTANCE_ELEMENT_LENGTH = 16;

const SPLIT_INDIRECT_ARGS_BUFFER = QueryArgs.getBool("splitIndirectArgsBuffer", true);

const GEOMETRY_SHADER = (geometry, culled = false) => {
  const layout = geometry.layout;

  return wgsl`
    struct VertexIn {
      @builtin(instance_index) instanceIndex : u32,
      @location(${AttribLocation.position}) pos: vec4f,
      @location(${AttribLocation.normal}) norm: vec3f,
      @location(${AttribLocation.texcoord0}) uv0: vec2f,
    }

    struct VertexOut {
      @builtin(position) pos: vec4f,
      @location(0) norm: vec3f,
      @location(1) uv0: vec2f,
    }

    ${TinyWebGpuDemo.CAMERA_UNIFORM_STRUCT}
    @group(0) @binding(0) var<uniform> camera: CameraUniforms;

    struct Material {
      color: vec4f,
    }
    @group(1) @binding(0) var<uniform> material: Material;

    @group(2) @binding(0) var<storage, read> instances: array<mat4x4f>;

    struct CulledInstances {
      indirectIndex: u32,
      instances: array<u32>,
    }
    @group(2) @binding(1) var<storage, read> culled: CulledInstances;

    @vertex
    fn vertexMain(in: VertexIn) -> VertexOut {
      var out: VertexOut;
    #if ${culled}
      let instanceIndex = culled.instances[in.instanceIndex];
    #else
      let instanceIndex = in.instanceIndex;
    #endif
      let model = instances[instanceIndex];
      out.pos = camera.projection * camera.view * model * in.pos;
      out.norm = normalize((camera.view * model * vec4f(in.norm, 0)).xyz);
      out.uv0 = in.uv0;
      return out;
    }

    // Some hardcoded lighting
    const lightDir = vec3f(0.25, 0.5, 1.0);
    const lightColor = vec3f(1, 1, 1);
    const ambientColor = vec3f(0.03, 0.03, 0.03);

    @fragment
    fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
      let baseColor = material.color;
      let N = normalize(in.norm);

      // An extremely simple directional lighting model, just to give our model some shape.
      let L = normalize(lightDir);
      let NDotL = max(dot(N, L), 0.0);
      let surfaceColor = (baseColor.rgb * ambientColor) + (baseColor.rgb * NDotL);

      return vec4(surfaceColor, baseColor.a);
    }
  `;
}

const CULLING_WORKGROUP_SIZE = 64;
const CULLING_SHADER = `
  // TODO: This shader makes assumptions that the radius of every piece
  // of geometry, pre-transform is initially 0.5 and is centered on the
  // origin. Obviously that wouldn't hold true for a more generic scene,
  // so you'd have to pass in size and center information about the
  // geometry being culled.
  ${TinyWebGpuDemo.CAMERA_UNIFORM_STRUCT}
  @group(0) @binding(0) var<uniform> camera: CameraUniforms;

  @group(1) @binding(0) var<storage, read> instances: array<mat4x4f>;

  struct CulledInstances {
    indirectIndex: u32,
    instances: array<u32>,
  }
  @group(1) @binding(1) var<storage, read_write> culled: CulledInstances;

  struct IndirectArgs {
    drawCount: u32,
    instanceCount: atomic<u32>,
    reserved0: u32,
    reserved1: u32,
    reserved2: u32,
  }
  @group(1) @binding(2) var<storage, read_write> indirectArgs: array<IndirectArgs>;

  fn isVisible(instanceIndex: u32) -> bool {
    let model = instances[instanceIndex];
    let pos = model * vec4(0, 0, 0, 1);
    let radius = 1.0; // Just fudging it. None of the meshes should be bigger than this.

    for (var i = 0; i < 6; i++) {
      if (dot(camera.frustum[i], pos) < -radius) {
        return false;
      }
    }
    return true;
  }

  @compute @workgroup_size(${CULLING_WORKGROUP_SIZE})
  fn computeMain(@builtin(global_invocation_id) gloablId: vec3u) {
    let instanceIndex = gloablId.x;
    if (instanceIndex >= ${MAX_INSTANCES_PER_DRAWABLE}) {
      return;
    }

    if (!isVisible(instanceIndex)) { return; }

    let culledIndex = atomicAdd(&indirectArgs[culled.indirectIndex].instanceCount, 1u);
    culled.instances[culledIndex] = instanceIndex;
  }
`;

const RenderModes = {
  naive: 0,
  instanced: 1,
  culled: 2,
  renderBundleNaive: 3,
  renderBundleInstanced: 4,
  renderBundleCulled: 5,
};

export class GridDemo extends TinyWebGpuDemo {
  vertexBuffer = null;
  indexBuffer = null;
  instanceArray = null;
  geometries = [];
  materials = new Map();
  drawables = [];
  pipeline = null;
  culledPipeline = null;
  cullInstancesPipeline = null;
  renderBundles = new Map();

  zFar = 512;

  totalInstances = 0;

  options = {
    animateScene: false,
    showOverhead: QueryArgs.getBool("showOverhead", true),
    showPerspective: QueryArgs.getBool("showPerspective", true),
    renderMode: RenderModes.renderBundleCulled,
    drawableVariants: 0,
    instancesPerDrawable: MAX_INSTANCES_PER_DRAWABLE,
  };

  async onInit(device) {
    this.camera.distance = 3;
    this.timestampHelper = new TimestampHelper(device);

    if (this.timestampHelper.timestampsSupported) {
      // This just makes sure that Tweakpane can see the keys before the first timestamp reading.
      this.timestampHelper.averages.compute = 0;
      this.timestampHelper.averages.render = 0;
      this.timestampHelper.averages.TOTAL = 0;

      this.statsFolder.addBinding(this.timestampHelper.averages, 'TOTAL', {
        label: 'Frame GPU ms',
        readonly: true,
        view: 'graph',
      });
      this.statsFolder.addBinding(this.timestampHelper.averages, 'compute', {
        label: '- Compute ms',
        readonly: true,
      });
      this.statsFolder.addBinding(this.timestampHelper.averages, 'render', {
        label: '- Render ms',
        readonly: true,
      });
    }

    this.materialBindGroupLayout = this.device.createBindGroupLayout({
      layout: 'Material',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {}
      }]
    });

    const instanceBindGroupLayout = this.device.createBindGroupLayout({
      layout: 'Instance',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' }
      }, {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' }
      }]
    });

    const culledInstanceBindGroupLayout = this.device.createBindGroupLayout({
      layout: 'Culled Instance',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' }
      }, {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' }
      }, {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' }
      }]
    });

    // Colors of obstacles
    this.materials.set("target", this.createMaterialBindGroup(1, 0, 0, 1, "Target")); // Red target token.
    this.materials.set("obstacle", this.createMaterialBindGroup(0, 0, 1, 1, "Obstacle")); // Blue generic obstacle.

    // Geometry for tokens, walls
    this.geometries = Geometry.CreateBatch(device, [
      new BoxGeometryDesc({ label: "Token" }),
      new WallGeometryDesc({ label: "Wall" }),
    ]);

    const maxDrawableVariants = this.geometries.length * this.materials.size;
    this.options.drawableVariants = Math.min(QueryArgs.getInt("drawableVariants", maxDrawableVariants), maxDrawableVariants);
    this.totalInstances = this.options.instancesPerDrawable * this.options.drawableVariants;

    const module = device.createShaderModule({
      label: 'Geometry',
      code: GEOMETRY_SHADER(this.geometries[0]),
    });


    this.overheadFrameUniformBuffer = this.device.createBuffer({
      size: this.frameUniformBuffer.size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    device.createRenderPipelineAsync({
      label: 'Geometry',
      layout: device.createPipelineLayout({ bindGroupLayouts: [
        this.frameBindGroupLayout,
        this.materialBindGroupLayout,
        instanceBindGroupLayout,
      ]}),
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: this.geometries[0].layout.buffers,
      },
      primitive: {
        topology: this.geometries[0].layout.topology,
        stripIndexFormat: this.geometries[0].layout.stripIndexFormat,
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{
          format: this.colorFormat,
        }],
      },
      depthStencil: {
        format: this.depthFormat,
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
      },
      multisample: {
        count: this.sampleCount ?? 1
      }
    }).then((pipeline) => {
      this.pipeline = pipeline;
    });

    const culledModule = device.createShaderModule({
      label: 'Culled Geometry',
      code: GEOMETRY_SHADER(this.geometries[0], true),
    });

    device.createRenderPipelineAsync({
      label: 'Culled Geometry',
      layout: device.createPipelineLayout({ bindGroupLayouts: [
        this.frameBindGroupLayout,
        this.materialBindGroupLayout,
        instanceBindGroupLayout,
      ]}),
      vertex: {
        module: culledModule,
        entryPoint: 'vertexMain',
        buffers: this.geometries[0].layout.buffers,
      },
      primitive: {
        topology: this.geometries[0].layout.topology,
        stripIndexFormat: this.geometries[0].layout.stripIndexFormat,
      },
      fragment: {
        module: culledModule,
        entryPoint: 'fragmentMain',
        targets: [{
          format: this.colorFormat,
        }],
      },
      depthStencil: {
        format: this.depthFormat,
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
      },
      multisample: {
        count: this.sampleCount ?? 1
      }
    }).then((pipeline) => {
      this.culledPipeline = pipeline;
    });

    const cullInstanceModule = this.device.createShaderModule({
      label: 'Cull Instances',
      code: CULLING_SHADER,
    });

    device.createComputePipelineAsync({
      label: 'Cull Instances',
      layout: device.createPipelineLayout({ bindGroupLayouts: [
        this.frameBindGroupLayout,
        culledInstanceBindGroupLayout,
      ]}),
      compute: {
        module: cullInstanceModule,
        entryPoint: 'computeMain',
      }
    }).then((pipeline) => {
      this.cullInstancesPipeline = pipeline;
    });



    // Update the frame uniforms
    this.updateOverheadView();

    this.overheadFrameBindGroup = this.device.createBindGroup({
      label: `Overhead Frame BindGroup`,
      layout: this.frameBindGroupLayout,
      entries: [{
        binding: 0, // Camera uniforms
        resource: { buffer: this.overheadFrameUniformBuffer },
      }],
    });

    // Build a bunch of instances with every geometry and material combination
    /*
    function createInstanceData() {
      const scale = Math.random() + 0.5;
      const axis = vec3.fromValues(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1);
      vec3.normalize(axis, axis);

      return {
        pos: vec3.fromValues(
          (Math.random() * 2 - 1) * 100,
          (Math.random() * 2 - 1) * 100,
          (Math.random() * 2 - 1) * 100),
        scale: vec3.fromValues(scale, scale, scale),
        axis: axis,
        rotationSpeed: Math.random() * 2 - 1,
      };
    }
    */

    this.instanceArray = new Float32Array(MAX_INSTANCES_PER_DRAWABLE * INSTANCE_ELEMENT_LENGTH);

    let indirectBuffer;
    let indirectBufferOffset = 0;
    let indirectArgs;

    if (!SPLIT_INDIRECT_ARGS_BUFFER) {
      indirectBuffer = this.device.createBuffer({
        label: 'Instance indirect',
        size: 20 * this.materials.size * this.geometries.length,
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      indirectArgs = new Uint32Array(indirectBuffer.getMappedRange());
    }

    const combinations = [
      // ["target", "Token"],
      ["obstacle", "Token"],
      ["obstacle", "Wall"],
    ];

    for ( const [materialLabel, geometryLabel] of combinations ) {
      const geometry = this.geometries.find(geom => geom.label === geometryLabel);
      const material = this.materials.get(materialLabel);

      let instances;
      switch ( geometryLabel ) {
        case "Token": instances = this.createTokenInstances(); break;
        case "Wall": instances = this.createWallInstances(); break;
      }

      // TODO: Delete or change to sort around the camera position.
      // Sort the instances so the closest ones to the center are drawn
      // first to improve overdraw
      instances.sort((a, b) => vec3.length(a.pos) - vec3.length(b.pos));

      const instanceBuffer = this.device.createBuffer({
        label: 'Instance',
        size: this.instanceArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });

      const indirectOffset = indirectBufferOffset;
      if (SPLIT_INDIRECT_ARGS_BUFFER) {
        indirectBuffer = this.device.createBuffer({
          label: 'Instance indirect',
          size: 20,
          usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          mappedAtCreation: true,
        });
        const indirectArgs = new Uint32Array(indirectBuffer.getMappedRange());
        indirectArgs[0] = geometry.drawCount;
        indirectArgs[1] = MAX_INSTANCES_PER_DRAWABLE;
        if (geometry.indexBinding) {
          indirectArgs[2] = geometry.indexBinding.firstIndex;
        }
        indirectBuffer.unmap();
      } else {
        const index = (indirectOffset / 20) * 5;
        indirectArgs[index] = geometry.drawCount;
        indirectArgs[index+1] = MAX_INSTANCES_PER_DRAWABLE;
        if (geometry.indexBinding) {
          indirectArgs[index+2] = geometry.indexBinding.firstIndex;
        }
        indirectBufferOffset += 20;
      }

      const culledInstanceBuffer = this.device.createBuffer({
        label: 'Culled Instance',
        size: (MAX_INSTANCES_PER_DRAWABLE * Uint32Array.BYTES_PER_ELEMENT) + 4,
        usage: GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
      });
      const culledInstanceArray = new Uint32Array(culledInstanceBuffer.getMappedRange(0, 4));
      culledInstanceArray[0] = indirectOffset / 20;
      culledInstanceBuffer.unmap();

      const instanceBindGroup = this.device.createBindGroup({
        label: 'Instance',
        layout: instanceBindGroupLayout,
        entries: [{
          binding: 0,
          resource: { buffer: instanceBuffer }
        }, {
          binding: 1,
          resource: { buffer: culledInstanceBuffer }
        }],
      });

      const culledInstanceBindGroup = this.device.createBindGroup({
        label: 'Culled Instance',
        layout: culledInstanceBindGroupLayout,
        entries: [{
          binding: 0,
          resource: { buffer: instanceBuffer }
        }, {
          binding: 1,
          resource: { buffer: culledInstanceBuffer }
        }, {
          binding: 2,
          resource: { buffer: indirectBuffer }
        }],
      });

      this.drawables.push({
        material,
        geometry,
        instances,
        instanceCount: instances.length,
        instanceBuffer,
        indirectBuffer,
        indirectOffset,
        instanceBindGroup,
        culledInstanceBindGroup,
      });
    }

    if (!SPLIT_INDIRECT_ARGS_BUFFER) {
      indirectBuffer.unmap();
    }

    this.updateInstanceBuffer(performance.now());

    const updateInstanceCount = () => {
      // Clear the render bundle cache any time the instance count changes.
      this.renderBundles.clear();
      this.totalInstances = this.options.instancesPerDrawable * this.options.drawableVariants;
    }

    const perfPane = this.pane.addFolder({
      title: 'Performance Scaling',
      expanded: false,
    });
    perfPane.addBinding(this, 'resolutionScale', { min: 0.25, max: 1.0, step: 0.25 })
      .on('change', _ev => {
        this.updateProjection(this.canvas.width, this.canvas.height);
      });
    perfPane.addBinding(this.options, 'drawableVariants', {
      min: 1,
      max: maxDrawableVariants,
      step: 1 }).on('change', updateInstanceCount);
    perfPane.addBinding(this.options, 'instancesPerDrawable', {
      min: 10,
      max: MAX_INSTANCES_PER_DRAWABLE,
      step: 10 }).on('change', updateInstanceCount);
    perfPane.addBinding(this, 'totalInstances', { readonly: true });

    this.pane.addBinding(this.options, 'renderMode', { options: RenderModes });
    this.pane.addBinding(this.options, 'animateScene');
    this.pane.addBinding(this.options, 'showOverhead')
      .on('change', _ev => {
        this.updateProjection(this.canvas.width, this.canvas.height);
      });

    this.pane.addButton({
      title: 'ViewSource',
    }).on('click', () => { window.open('https://github.com/toji/webgpu-bundle-culling'); });
  }

  createMaterialBindGroup(r, g, b, name) {
    const materialBuffer = this.device.createBuffer({
      label: `Material ${name} (${r}, ${g}, ${b})`,
      size: Float32Array.BYTES_PER_ELEMENT * 4,
      usage: GPUBufferUsage.UNIFORM,
      mappedAtCreation: true,
    });
    const materialArray = new Float32Array(materialBuffer.getMappedRange());
    materialArray[0] = r;
    materialArray[1] = g;
    materialArray[2] = b;
    materialArray[3] = 1;
    materialBuffer.unmap();

    return this.device.createBindGroup({
      label: `Material ${name} (${r}, ${g}, ${b})`,
      layout: this.materialBindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: materialBuffer }
      }],
    });
  }

  createWallInstances() {
    // TODO: Version that handles other wall types, e.g. terrain (region) walls.
    return canvas.walls.placeables.map(wall => this.constructor.wallInstance(wall));
  }

  createTokenInstances() {
    // TODO: Version that excludes viewer, sets target.
    return canvas.tokens.placeables.map(token => this.constructor.tokenInstance(token));
  }

  static wallInstance(wall) { return this.edgeInstance(wall.edge); }

  static edgeInstance(edge) {
    // Move edge from its center point.
    const ctr = this.edgeCenter(edge);

    // Add in a translate to move back to 0,0 if the elevations do not match.
    // E.g., top = 20, bottom = -1e06. Wall is 20 + 1e06 = 1000020 high.
    //   Before translation, it is at 1000020 * 0.5 = 500010 top / -500010 bottom.
    //   Move 500010 - 20 down (-(topHeight - top) == top - topHeight.
    // E.g., top = 1e06, bottom = -20. Wall is 20 + 1e06 = 1000020 high.
    //   Before translation, it is at 1000020 * 0.5 = 500010 top / -500010 bottom.
    //   Move 500010 - 1e06 down (move up).
    const { top, bottom } = this.edgeElevation(edge);
    const topHeight = (top - bottom) * 0.5;
    const z = top !== bottom ? (top - topHeight) : 0;
    const pos = vec3.fromValues(ctr.x, ctr.y, z);

    // Scale wall by its length from its center points.
    const scale = vec3.fromValues(this.edgeLength(edge), 1, (top - bottom) || 1);

    // Rotate along the z axis to match the wall direction.
    const q = quat.create()
    quat.setAxisAngle(q, vec3.fromValues(0, 0, 1), this.edgeAngle(edge));
    return { pos, scale, q };
  }

  static edgeElevation(edge) {
    let { top, bottom } = edge.elevationLibGeometry.a;
    top ??= 1e05;
    bottom ??= -1e05;
    top = CONFIG.GeometryLib.utils.gridUnitsToPixels(top);
    bottom = CONFIG.GeometryLib.utils.gridUnitsToPixels(bottom);
    return { top, bottom };
  }

  static edgeCenter(edge) {
    const ctr = new PIXI.Point();
    return edge.a.add(edge.b, ctr).multiplyScalar(0.5, ctr);
  }

  static edgeLength(edge) { return PIXI.Point.distanceBetween(edge.a, edge.b); }

  static edgeAngle(edge) {
    const delta = edge.b.subtract(edge.a, PIXI.Point._tmp3);
    return Math.atan2(delta.y, delta.x);
  }

  static tokenInstance(token) {
    const Point3d = CONFIG.GeometryLib.threeD.Point3d;
    const size = canvas.dimensions.size;
    const pos = vec3.fromValues(...Point3d.fromTokenCenter(token));
    const scale = vec3.fromValues(token.document.w * size, token.document.h * size, token.topZ - token.bottomZ);
    const q = quat.create()
    return { pos, scale, q };
  }


  updateProjection(width, height) {
    if (this.options.showOverhead && this.options.showPerspective) {
      if (this.canvas.height > this.canvas.width) {
        super.updateProjection(width, height * 0.5);
      } else {
        super.updateProjection(width * 0.5, height);
      }
    } else {
      super.updateProjection(width, height);
    }

    this.updateOverheadView();
  }

  updateOverheadView() {
    if (!this.device) { return; }

    const frameArrayBuffer = this.frameArrayBuffer;

    const viewMat = new Float32Array(frameArrayBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16);
    mat4.identity(viewMat);
    mat4.translate(viewMat, viewMat, [0, 0, -200]);
    mat4.rotateX(viewMat, viewMat, Math.PI * 0.5);

    this.device.queue.writeBuffer(this.overheadFrameUniformBuffer, 0, frameArrayBuffer);
  }

  updateInstanceBuffer(timestamp, animating = false) {
    for (const drawable of this.drawables) {
      // TODO: Only update on placeable change.
      let instances;
      switch ( drawable.geometry.label ) {
        case "Token": instances = this.createTokenInstances(); break;
        case "Wall": instances = this.createWallInstances(); break;
      }

      for ( let i = 0, n = instances.length; i < n; i += 1 ) {
        const instance = drawable.instances[i];
        mat4.fromRotationTranslationScale(tempMat, instance.q, instance.pos, instance.scale);
        const arrayOffset = i * INSTANCE_ELEMENT_LENGTH;
        this.instanceArray.set(tempMat, arrayOffset);
      }

      /*
      // When animating don't animate EVERY instance. Eats up too much JS time, especially on mobile.
      // Because the scene is sorted to draw the nearest geometry first, it will look like most of the
      // scene is animating from the users POV.
      const instanceCount = animating ? Math.floor(drawable.instanceCount / 4) : drawable.instanceCount;
      for (let i = 0; i < instanceCount; ++i) {
        const instance = drawable.instances[i];
        quat.setAxisAngle(tempQuat, instance.axis, timestamp * instance.rotationSpeed * 0.001);
        mat4.fromRotationTranslationScale(tempMat, tempQuat, instance.pos, instance.scale);

        const arrayOffset = i * INSTANCE_ELEMENT_LENGTH;
        this.instanceArray.set(tempMat, arrayOffset);
      }
      */

      this.device.queue.writeBuffer(
        drawable.instanceBuffer, 0, this.instanceArray, 0,
        instances.length * INSTANCE_ELEMENT_LENGTH
      );
    }
  }

  cullInstances(commandEncoder) {
    commandEncoder.pushDebugGroup('Reset indirect instance counts');
    // Clear the instance count of the indirect buffer for each drawable
    for (const drawable of this.drawables) {
      commandEncoder.clearBuffer(drawable.indirectBuffer, drawable.indirectOffset + 4, 4);
    }
    commandEncoder.popDebugGroup();

    commandEncoder.pushDebugGroup('Frustum Culling Pass');

    // Run a compute shader to find all the visible geometry for each drawable
    const computePass = commandEncoder.beginComputePass({
      timestampWrites: this.timestampHelper.timestampWrites('compute'),
    });
    computePass.setBindGroup(0, this.frameBindGroup);
    computePass.setPipeline(this.cullInstancesPipeline);
    for (const drawable of this.drawables) {
      computePass.setBindGroup(1, drawable.culledInstanceBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(this.options.instancesPerDrawable / CULLING_WORKGROUP_SIZE));
    }
    computePass.end();

    commandEncoder.popDebugGroup();
  }

  drawScene(renderEncoder, mode, pipeline, frameBindGroup) {
    renderEncoder.pushDebugGroup(`Draw Scene ${this.options.renderMode % 3 == RenderModes.culled ? '(Indirect)' : '(Direct)'}`);

    renderEncoder.setBindGroup(0, frameBindGroup);
    renderEncoder.setPipeline(pipeline);

    let drawableCount = 0;
    for (const drawable of this.drawables) {
      if (drawableCount >= this.options.drawableVariants) { break; }
      drawableCount++;

      renderEncoder.setBindGroup(1, drawable.material);
      renderEncoder.setBindGroup(2, drawable.instanceBindGroup);
      drawable.geometry.setBuffers(renderEncoder);

      switch (this.options.renderMode % 3) {
        case RenderModes.naive:
          for (let i = 0; i < this.options.instancesPerDrawable; ++i) {
            drawable.geometry.draw(renderEncoder, 1, i);
          }
          break;

        case RenderModes.instanced:
          drawable.geometry.draw(renderEncoder, this.options.instancesPerDrawable);
          break;

        case RenderModes.culled:
          if(drawable.geometry.indexBinding) {
            renderEncoder.drawIndexedIndirect(drawable.indirectBuffer, drawable.indirectOffset);
          } else {
            renderEncoder.drawIndirect(drawable.indirectBuffer, drawable.indirectOffset);
          }
          break;
      }
    }

    renderEncoder.popDebugGroup();
  }

  getRenderBundle(mode, pipeline, overhead = false) {
    const key = mode + (overhead ? 3 : 0);
    let renderBundle = this.renderBundles.get(key);

    // If the render bundle doesn't exist yet, create it the first time
    // the bundle is requested.
    if (!renderBundle) {
      const encoder = this.device.createRenderBundleEncoder({
        colorFormats: [ this.colorFormat ],
        depthStencilFormat: this.depthFormat,
        sampleCount: this.sampleCount
      });

      // Call the exact same function as the non-bundled draw
      this.drawScene(encoder, mode, pipeline, overhead ? this.overheadFrameBindGroup : this.frameBindGroup);

      renderBundle = encoder.finish();

      // Cache the render bundle for the given rendering mode.
      this.renderBundles.set(key, renderBundle);
    }
    return renderBundle;
  }

  onFrame(device, context, timestamp) {
    const commandEncoder = device.createCommandEncoder();

    if (this.options.animateScene) {
      this.updateInstanceBuffer(timestamp, true);
    }

    const culled = this.options.renderMode == RenderModes.culled ||
                   this.options.renderMode == RenderModes.renderBundleCulled;

    if (culled && this.cullInstancesPipeline) {
      this.cullInstances(commandEncoder);
    }

    // FIXME: This shouldn't have to be a separate render pass, but separating the passes avoids a bug in Chrome
    // on Windows. The bug has been resolved in Chrome 121, so it can be removed eventually.
    // See https://crbug.com/1478906
    const needsPassSplit = this.options.showOverhead && this.options.showPerspective && culled && navigator.platform === 'Win32';

    const renderPassDesc = {
      colorAttachments: [{
        view: this.colorAttachment.view,
        resolveTarget: needsPassSplit ? undefined : this.context.getCurrentTexture().createView(),
        clearValue: this.clearColor,
        loadOp: 'clear',
        storeOp: needsPassSplit ? 'store' : 'discard',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: needsPassSplit ? 'store' : 'discard',
      },
      timestampWrites: this.timestampHelper.timestampWrites('render')
    };

    commandEncoder.pushDebugGroup('Outside Render Pass');
    let renderPass = commandEncoder.beginRenderPass(renderPassDesc);

    if (this.options.showOverhead && this.options.showPerspective) {
      if (this.canvas.height > this.canvas.width) {
        renderPass.setViewport(0, 0, this.canvas.width, this.canvas.height * 0.5, 0, 1);
      } else {
        renderPass.setViewport(0, 0, this.canvas.width * 0.5, this.canvas.height, 0, 1);
      }
    }

    const pipeline = culled ? this.culledPipeline : this.pipeline;
    if (pipeline) {
      renderPass.pushDebugGroup('Inside Render Pass');

      if (this.options.showPerspective) {
        switch (this.options.renderMode) {
          case RenderModes.naive:
          case RenderModes.instanced:
          case RenderModes.culled:
            this.drawScene(renderPass, this.options.renderMode, pipeline, this.frameBindGroup);
            break;
          case RenderModes.renderBundleNaive:
          case RenderModes.renderBundleInstanced:
          case RenderModes.renderBundleCulled:
            renderPass.pushDebugGroup('Executing Bundles');
            renderPass.executeBundles([this.getRenderBundle(this.options.renderMode, pipeline)]);
            renderPass.popDebugGroup();
            break;
        }
      }

      renderPass.popDebugGroup();

      if (this.options.showOverhead) {
        if (needsPassSplit) {
          renderPass.end();

          renderPassDesc.colorAttachments[0] = {
            view: this.colorAttachment.view,
            resolveTarget: this.context.getCurrentTexture().createView(),
            loadOp: 'load',
            storeOp: 'discard',
          };
          renderPassDesc.depthStencilAttachment.depthLoadOp = 'load';
          renderPassDesc.depthStencilAttachment.depthStoreOp = 'discard';
          renderPassDesc.timestampWrites = this.timestampHelper.timestampWrites('overhead-render');

          renderPass = commandEncoder.beginRenderPass(renderPassDesc);
        }

        if (this.options.showPerspective) {
          if (this.canvas.height > this.canvas.width) {
            renderPass.setViewport(0, this.canvas.height * 0.5, this.canvas.width, this.canvas.height * 0.5, 0, 1);
          } else {
            renderPass.setViewport(this.canvas.width * 0.5, 0, this.canvas.width * 0.5, this.canvas.height, 0, 1);
          }
        }

        switch (this.options.renderMode) {
          case RenderModes.naive:
          case RenderModes.instanced:
          case RenderModes.culled:
            this.drawScene(renderPass, this.options.renderMode, pipeline, this.overheadFrameBindGroup);
            break;
          case RenderModes.renderBundleNaive:
          case RenderModes.renderBundleInstanced:
          case RenderModes.renderBundleCulled:
            renderPass.executeBundles([this.getRenderBundle(this.options.renderMode, pipeline, true)]);
            break;
        }
      }
    }

    renderPass.end();

    commandEncoder.popDebugGroup();

    this.timestampHelper.resolve(commandEncoder);

    device.queue.submit([commandEncoder.finish()]);

    this.timestampHelper.read();
  }
}

// const demo = new GridDemo();


/*
Adapted from https://github.com/toji/webgpu-bundle-culling

MIT License

Copyright (c) 2023 Brandon Jones

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/