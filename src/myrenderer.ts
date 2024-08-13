import vertShaderCode from './shaders/basic.vert.wgsl';
import fragShaderCode from './shaders/basic.frag.wgsl';

export default class MyRenderer {
    private canvas: HTMLCanvasElement;
    private device: GPUDevice;
    private entry: GPU;
    private adapter: GPUAdapter;
    private context: GPUCanvasContext;
    private depthTexture: GPUTexture;
    private depthTextureView: GPUTextureView;
    private colorTexture: GPUTexture;
    private colorTextureView: GPUTextureView;
    private queue: GPUQueue;

    private contextConfig: GPUCanvasConfiguration;

    private readonly DEPTH_TEXTURE_DESC: GPUTextureDescriptor;
    pipeline: GPURenderPipeline;
    positionBuffer: GPUBuffer;
    colorBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.DEPTH_TEXTURE_DESC = {
            size: [this.canvas.width, this.canvas.height, 1],
            dimension: '2d',
            format: 'depth24plus-stencil8',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
        };
    }

    public async initializeAPI(): Promise<boolean> {
        try {
            this.entry = navigator.gpu;

            if (!this.entry) {
                return false;
            }

            this.adapter = await this.entry.requestAdapter();
            this.device = await this.adapter.requestDevice();
            this.queue = this.device.queue;
        } catch (e) {
            console.error(e);
            return false;
        }
        return true;
    }

    public async init() {
        const positions = new Float32Array([
            1.0, -1.0, 0.0, -1.0, -1.0, 0.0, 0.0, 1.0, 0.0
        ]);

        // 🎨 Color Vertex Buffer Data
        const colors = new Float32Array([
            1.0,
            0.0,
            0.0, // 🔴
            0.0,
            1.0,
            0.0, // 🟢
            0.0,
            0.0,
            1.0 // 🔵
        ]);

        // 📇 Index Buffer Data
        const indices = new Uint16Array([0, 1, 2]);
        if (await this.initializeAPI()) {
            this.resizeBackings();
            await this.createResources(positions, colors, indices);
            this.render();
        } else {
            throw new Error('WebGPU not supported on your browser.');
        }

        this.colorTexture = this.context.getCurrentTexture();
        this.colorTextureView = this.colorTexture.createView();

        // 📈 Position Vertex Buffer Data

        this.render();
    }
    resizeBackings() {
        this.contextConfig = {
            device: this.device,
            format: 'bgra8unorm',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
            alphaMode: 'opaque'
        };
        if (!this.context) {
            this.context = this.canvas.getContext('webgpu');
            this.context.configure(this.contextConfig);
        }

        this.depthTexture = this.device.createTexture(this.DEPTH_TEXTURE_DESC);
        this.depthTextureView = this.depthTexture.createView();
    }

    async createResources(
        position: Float32Array,
        color: Float32Array,
        indices: Uint16Array
    ) {
        this.positionBuffer = this.createBuffer(
            position,
            GPUBufferUsage.VERTEX
        );
        this.colorBuffer = this.createBuffer(color, GPUBufferUsage.VERTEX);
        this.indexBuffer = this.createBuffer(indices, GPUBufferUsage.INDEX);
        let vertModule: GPUShaderModule = this.device.createShaderModule({
            code: vertShaderCode
        });

        let fragModule: GPUShaderModule = this.device.createShaderModule({
            code: fragShaderCode
        });

        // 🦄 Uniform Data
        const pipelineLayoutDesc = { bindGroupLayouts: [] };
        const layout = this.device.createPipelineLayout(pipelineLayoutDesc);

        // ✋ Declare pipeline handle
        let pipeline: GPURenderPipeline = null;

        // ⚗️ Graphics Pipeline

        // 🔣 Input Assembly
        const positionAttribDesc: GPUVertexAttribute = {
            shaderLocation: 0, // @location(0)
            offset: 0,
            format: 'float32x3'
        };
        const colorAttribDesc: GPUVertexAttribute = {
            shaderLocation: 1, // @location(1)
            offset: 0,
            format: 'float32x3'
        };
        const positionBufferDesc: GPUVertexBufferLayout = {
            attributes: [positionAttribDesc],
            arrayStride: 4 * 3, // sizeof(float) * 3
            stepMode: 'vertex'
        };
        const colorBufferDesc: GPUVertexBufferLayout = {
            attributes: [colorAttribDesc],
            arrayStride: 4 * 3, // sizeof(float) * 3
            stepMode: 'vertex'
        };

        // 🌑 Depth
        const depthStencil: GPUDepthStencilState = {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus-stencil8'
        };
        // 🎭 Shader Stages
        const vertex: GPUVertexState = {
            module: vertModule,
            entryPoint: 'main',
            buffers: [positionBufferDesc, colorBufferDesc]
        };

        // 🌀 Color/Blend State
        const colorState: GPUColorTargetState = {
            format: 'bgra8unorm',
            writeMask: GPUColorWrite.ALL
        };

        const fragment: GPUFragmentState = {
            module: fragModule,
            entryPoint: 'main',
            targets: [colorState]
        };

        // 🟨 Rasterization
        const primitive: GPUPrimitiveState = {
            frontFace: 'cw',
            cullMode: 'none',
            topology: 'triangle-list'
        };

        const pipelineDesc: GPURenderPipelineDescriptor = {
            layout,
            vertex,
            fragment,
            primitive,
            depthStencil
        };

        this.pipeline = this.device.createRenderPipeline(pipelineDesc);
    }

    render = () => {
        this.colorTexture = this.context.getCurrentTexture();
        this.colorTextureView = this.colorTexture.createView();
        this.encodeCommands(
            this.positionBuffer,
            this.colorBuffer,
            this.indexBuffer,
            this.pipeline
        );
        requestAnimationFrame(this.render);
    };

    encodeCommands(
        positionBuffer: GPUBuffer,
        colorBuffer: GPUBuffer,
        indexBuffer: GPUBuffer,
        pipeline: GPURenderPipeline
    ) {
        let commandEncoder: GPUCommandEncoder = null;
        let passEncoder: GPURenderPassEncoder = null;

        let colorAttachment: GPURenderPassColorAttachment = {
            view: this.colorTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        };

        const depthAttachment: GPURenderPassDepthStencilAttachment = {
            view: this.depthTextureView,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            stencilClearValue: 0,
            stencilLoadOp: 'clear',
            stencilStoreOp: 'store'
        };

        const renderPassDesc: GPURenderPassDescriptor = {
            colorAttachments: [colorAttachment],
            depthStencilAttachment: depthAttachment
        };

        commandEncoder = this.device.createCommandEncoder();

        // 🖌️ Encode drawing commands
        passEncoder = commandEncoder.beginRenderPass(renderPassDesc);
        passEncoder.setPipeline(pipeline);
        passEncoder.setViewport(
            0,
            0,
            this.canvas.width,
            this.canvas.height,
            0,
            1
        );
        passEncoder.setScissorRect(0, 0, this.canvas.width, this.canvas.height);
        passEncoder.setVertexBuffer(0, positionBuffer);
        passEncoder.setVertexBuffer(1, colorBuffer);
        passEncoder.setIndexBuffer(indexBuffer, 'uint16');
        passEncoder.drawIndexed(3);
        passEncoder.end();

        this.queue.submit([commandEncoder.finish()]);
    }
    private createBuffer(arr: Float32Array | Uint16Array, usage: number) {
        let desc = {
            size: (arr.byteLength + 3) & ~3,
            usage,
            mappedAtCreation: true
        };

        let buffer = this.device.createBuffer(desc);
        const writeArray =
            arr instanceof Uint16Array
                ? new Uint16Array(buffer.getMappedRange())
                : new Float32Array(buffer.getMappedRange());
        writeArray.set(arr);
        buffer.unmap();
        return buffer;
    }
}
