/**
 * Eulerian Fluid Solver using raw WebGL2.
 * Core orchestration class managing contexts, render targets, and compute passes.
 */
import { GLProgram } from './glProgram.js';
import { 
    baseVertexShader, 
    splatFragmentShader, 
    advectionFragmentShader,
    divergenceFragmentShader,
    jacobiFragmentShader,
    gradientSubtractFragmentShader
} from './shaders.js';

export class FluidSolver {
    /**
     * Initializes the WebGL2 context, framebuffers, geometry, and shaders.
     * @param {HTMLCanvasElement} canvas - The target HTML5 canvas element.
     */
    constructor(canvas) {
        this.canvas = canvas;
        
        // 1. Initialize WebGL2 context
        this.gl = this.canvas.getContext('webgl2', {
            alpha: false, // Opaque canvas is generally faster
            depth: false, // Fluid simulation is 2D, no depth buffer needed
            stencil: false, // No stencil buffer needed
            antialias: false, // We don't need MSAA for the simulation buffers
            premultipliedAlpha: false
        });

        if (!this.gl) {
            console.error("Fatal: WebGL2 is not supported by your browser.");
            throw new Error("WebGL2 not supported.");
        }

        // 2. Explicitly query and enable EXT_color_buffer_float
        this.extColorBufferFloat = this.gl.getExtension('EXT_color_buffer_float');
        if (!this.extColorBufferFloat) {
            console.error("Fatal: EXT_color_buffer_float extension is not supported.");
            throw new Error("EXT_color_buffer_float not supported.");
        }

        this.extFloatLinear = this.gl.getExtension('OES_texture_float_linear');

        this.renderTargets = {};

        // 3. Allocate all required textures and FBOs
        this.initRenderTargets();

        // 4. Initialize Base Geometry (VAO)
        this.initBaseGeometry();

        // 5. Compile Shader Programs
        this.initPrograms();
    }

    createRenderTarget(width, height, internalFormat, format, type, filter, wrap) {
        const gl = this.gl;

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`Fatal: Framebuffer is not complete. Status: ${status}`);
        }

        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { texture, fbo, width, height };
    }

    createPingPongBuffer(width, height, internalFormat, format, type, filter, wrap) {
        const readTarget = this.createRenderTarget(width, height, internalFormat, format, type, filter, wrap);
        const writeTarget = this.createRenderTarget(width, height, internalFormat, format, type, filter, wrap);

        const pingPong = {
            read: readTarget,
            write: writeTarget,
            swap: () => {
                const temp = pingPong.read;
                pingPong.read = pingPong.write;
                pingPong.write = temp;
            }
        };

        return pingPong;
    }

    initRenderTargets() {
        const gl = this.gl;

        this.renderTargets.velocity = this.createPingPongBuffer(
            256, 256, 
            gl.RG16F, gl.RG, gl.HALF_FLOAT, 
            gl.LINEAR, gl.CLAMP_TO_EDGE
        );

        this.renderTargets.dye = this.createPingPongBuffer(
            1024, 1024, 
            gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, 
            gl.LINEAR, gl.CLAMP_TO_EDGE
        );

        this.renderTargets.pressure = this.createPingPongBuffer(
            256, 256, 
            gl.R16F, gl.RED, gl.HALF_FLOAT, 
            gl.NEAREST, gl.CLAMP_TO_EDGE
        );

        this.renderTargets.divergence = this.createRenderTarget(
            256, 256, 
            gl.R16F, gl.RED, gl.HALF_FLOAT, 
            gl.NEAREST, gl.CLAMP_TO_EDGE
        );
    }

    initBaseGeometry() {
        const gl = this.gl;
        const vertices = new Float32Array([
            -1.0, -1.0,
             3.0, -1.0,
            -1.0,  3.0
        ]);

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    initPrograms() {
        this.programs = {
            splat: new GLProgram(this.gl, baseVertexShader, splatFragmentShader),
            advection: new GLProgram(this.gl, baseVertexShader, advectionFragmentShader),
            divergence: new GLProgram(this.gl, baseVertexShader, divergenceFragmentShader),
            jacobi: new GLProgram(this.gl, baseVertexShader, jacobiFragmentShader),
            gradientSubtract: new GLProgram(this.gl, baseVertexShader, gradientSubtractFragmentShader)
        };
    }

    /**
     * Clears a render target buffer to prevent NaN drift.
     */
    executeClear(target, value) {
        const gl = this.gl;
        
        gl.clearColor(value, value, value, 1.0);
        
        if ('read' in target && 'write' in target) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.read.fbo);
            gl.clear(gl.COLOR_BUFFER_BIT);
            
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.write.fbo);
            gl.clear(gl.COLOR_BUFFER_BIT);
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Executes a Splat operation, injecting color or velocity into a target.
     * Implements dynamic aspect ratio to ensure splats are physically circular.
     */
    executeSplat(target, point, color, radius) {
        const gl = this.gl;
        const prog = this.programs.splat;
        
        prog.bind();
        
        // Bind target to texture unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, target.read.texture);
        prog.setUniform('uTarget', '1i', 0);
        
        // Upload Splat properties
        prog.setUniform('uPoint', '2fv', point);
        prog.setUniform('uColor', '3fv', color);
        prog.setUniform('uRadius', '1f', radius);
        
        // Dynamically calculate canvas aspect ratio to prevent distortion
        const aspectRatio = this.canvas.width / this.canvas.height;
        prog.setUniform('uAspectRatio', '1f', aspectRatio);
        
        // Render into target.write FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.write.fbo);
        gl.viewport(0, 0, target.write.width, target.write.height);
        
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        
        // Swap ping-pong buffer so the written data becomes the readable data for next pass
        target.swap();
    }

    /**
     * Executes the Advection compute pass.
     * Avoids texture binding collisions by strictly assigning units.
     */
    executeAdvection(velocityTarget, sourceTarget, dt, dissipation) {
        const gl = this.gl;
        const prog = this.programs.advection;
        
        prog.bind();
        
        // 1. Explicitly bind Velocity to Texture Unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocityTarget.read.texture);
        prog.setUniform('uVelocity', '1i', 0);
        
        // 2. Explicitly bind Source to Texture Unit 1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, sourceTarget.read.texture);
        prog.setUniform('uSource', '1i', 1);
        
        // 3. Pass numeric uniforms
        const texelSize = [1.0 / sourceTarget.read.width, 1.0 / sourceTarget.read.height];
        prog.setUniform('uTexelSize', '2fv', texelSize);
        prog.setUniform('dt', '1f', dt);
        prog.setUniform('uDissipation', '1f', dissipation);
        
        // Render into sourceTarget.write FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, sourceTarget.write.fbo);
        gl.viewport(0, 0, sourceTarget.write.width, sourceTarget.write.height);
        
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        
        // Swap read/write
        sourceTarget.swap();
    }

    /**
     * Calculates the divergence of the velocity field.
     */
    executeDivergence(velocityTarget, divergenceTarget) {
        const gl = this.gl;
        const prog = this.programs.divergence;
        
        prog.bind();
        
        // Bind velocity to Texture Unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocityTarget.read.texture);
        prog.setUniform('uVelocity', '1i', 0);
        
        // Render to divergence single target
        gl.bindFramebuffer(gl.FRAMEBUFFER, divergenceTarget.fbo);
        gl.viewport(0, 0, divergenceTarget.width, divergenceTarget.height);
        
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    }

    /**
     * Solves the Poisson equation for pressure iteratively using Jacobi iteration.
     */
    executePressure(divergenceTarget, pressureTarget, iterations) {
        const gl = this.gl;
        const prog = this.programs.jacobi;
        
        prog.bind();
        
        // Alpha = -(dx)^2 = -1.0
        // Beta = 4.0
        prog.setUniform('uAlpha', '1f', -1.0);
        prog.setUniform('uBeta', '1f', 4.0);
        
        // Divergence is constant across all iterations, bind it to Unit 1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, divergenceTarget.texture);
        prog.setUniform('uDivergence', '1i', 1);
        
        gl.bindVertexArray(this.vao);
        
        gl.activeTexture(gl.TEXTURE0);
        prog.setUniform('uPressure', '1i', 0);
        gl.viewport(0, 0, pressureTarget.write.width, pressureTarget.write.height);
        
        // CPU iterative loop
        for (let i = 0; i < iterations; i++) {
            // Bind current pressure guess to Unit 0
            gl.bindTexture(gl.TEXTURE_2D, pressureTarget.read.texture);
            
            // Render to pressure write FBO
            gl.bindFramebuffer(gl.FRAMEBUFFER, pressureTarget.write.fbo);
            
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            
            // Swap read/write
            pressureTarget.swap();
        }
        
        gl.bindVertexArray(null);
    }

    /**
     * Subtracts the pressure gradient from the velocity field, projecting it to be divergence-free.
     */
    executeGradientSubtraction(velocityTarget, pressureTarget) {
        const gl = this.gl;
        const prog = this.programs.gradientSubtract;
        
        prog.bind();
        
        // Binds velocity to Unit 0
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocityTarget.read.texture);
        prog.setUniform('uVelocity', '1i', 0);
        
        // Bind pressure to Unit 1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, pressureTarget.read.texture);
        prog.setUniform('uPressure', '1i', 1);
        
        // Render into velocityTarget.write FBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, velocityTarget.write.fbo);
        gl.viewport(0, 0, velocityTarget.write.width, velocityTarget.write.height);
        
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        
        // Swap read/write
        velocityTarget.swap();
    }

    /**
     * GPU Memory Leak Prevention
     * Thoroughly disposes of all allocated textures, framebuffers, VAOs, and shader programs.
     * This ensures the application does not consume infinite GPU memory if re-instantiated.
     */
    dispose() {
        const gl = this.gl;
        
        // 1. Dispose Render Targets
        for (const key in this.renderTargets) {
            const target = this.renderTargets[key];
            if ('read' in target && 'write' in target) {
                // Ping-Pong buffer has two sets of textures and FBOs
                gl.deleteTexture(target.read.texture);
                gl.deleteFramebuffer(target.read.fbo);
                gl.deleteTexture(target.write.texture);
                gl.deleteFramebuffer(target.write.fbo);
            } else {
                // Single target
                gl.deleteTexture(target.texture);
                gl.deleteFramebuffer(target.fbo);
            }
        }
        
        // 2. Dispose Base Geometry (VAO and VBO)
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.vbo) gl.deleteBuffer(this.vbo);
        
        // 3. Dispose Shader Programs
        for (const key in this.programs) {
            gl.deleteProgram(this.programs[key].program);
        }
        
        console.log("FluidSolver resources completely disposed to prevent GPU memory leaks.");
    }
}
