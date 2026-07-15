/**
 * A robust helper class to compile and manage WebGL2 shader programs.
 */
export class GLProgram {
    /**
     * Compiles and links a WebGL2 program from raw GLSL strings.
     * @param {WebGL2RenderingContext} gl 
     * @param {string} vertexSource 
     * @param {string} fragmentSource 
     */
    constructor(gl, vertexSource, fragmentSource) {
        this.gl = gl;
        this.program = gl.createProgram();

        const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);

        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(this.program);
            throw new Error(`Fatal: Program link failed.\n${info}`);
        }

        // Clean up shaders after linking, they are no longer needed
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        // Cache all uniform locations for fast runtime access
        this.uniforms = {};
        const uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformInfo = gl.getActiveUniform(this.program, i);
            // WebGL might return names like "uArray[0]", we strip the "[0]" for cleaner property access
            const uniformName = uniformInfo.name.replace(/\[0\]$/, '');
            this.uniforms[uniformName] = gl.getUniformLocation(this.program, uniformInfo.name);
        }
    }

    /**
     * Checks gl.COMPILE_STATUS and throws gl.getShaderInfoLog if compilation fails.
     */
    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            const typeStr = type === gl.VERTEX_SHADER ? "VERTEX" : "FRAGMENT";
            throw new Error(`Fatal: ${typeStr} Shader compilation failed.\n${info}`);
        }
        return shader;
    }

    /**
     * Sets this program as the active executable.
     */
    bind() {
        this.gl.useProgram(this.program);
    }

    /**
     * Type-safe uniform setter pipeline to abstract raw WebGL calls.
     * Prevents silent failures by logging warnings if uniforms are missing.
     * 
     * @param {string} name - The uniform variable name in the shader.
     * @param {string} type - Uniform type ('1i', '1f', '2fv', '3fv', 'mat4').
     * @param {any} value - The value to upload to the GPU.
     */
    setUniform(name, type, value) {
        const location = this.uniforms[name];
        
        // Log warning if uniform name doesn't exist to prevent silent debugging failures
        // We do not crash the application here, allowing development to continue
        if (location === undefined) {
            console.warn(`Warning: Uniform '${name}' not found in program.`);
            return;
        }

        const gl = this.gl;
        switch (type) {
            case '1i':
                gl.uniform1i(location, value);
                break;
            case '1f':
                gl.uniform1f(location, value);
                break;
            case '2fv':
                gl.uniform2fv(location, value);
                break;
            case '3fv':
                gl.uniform3fv(location, value);
                break;
            case 'mat4':
                // For matrices, transpose is usually false in WebGL
                gl.uniformMatrix4fv(location, false, value);
                break;
            default:
                console.warn(`Warning: Uniform type '${type}' is not implemented.`);
        }
    }
}
