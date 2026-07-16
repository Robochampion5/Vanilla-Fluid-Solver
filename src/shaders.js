/**
 * Raw GLSL string variables for the Eulerian Fluid Solver.
 * All shaders strictly adhere to WebGL2 standards (#version 300 es).
 */

// Mathematically optimal base geometry shader.
// Uses a single full-screen triangle to avoid the diagonal seam of a quad.
export const baseVertexShader = `#version 300 es
precision highp float;

// Bound to attribute location 0 in our VAO setup
layout(location = 0) in vec2 aPosition;

out vec2 vUv;

void main() {
    // Map position from NDC [-1, 1] to UV [0, 1]
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// Splat Shader: Injects color (dye) or momentum (velocity) into a target buffer.
export const splatFragmentShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTarget;
uniform vec2 uPoint;      // Normalized coordinates [0, 1] of the splat
uniform vec3 uColor;      // Color or velocity vector to add
uniform float uRadius;    // Radius of the splat
uniform float uAspectRatio; // Canvas aspect ratio (width / height) to prevent distortion

void main() {
    // Calculate distance vector from current fragment to the splat point
    vec2 p = vUv - uPoint;
    
    // Scale horizontal distance by aspect ratio to prevent distortion (make splats circular)
    p.x *= uAspectRatio;
    
    // Gaussian falloff
    // exp(-d^2 / r) creates a smooth bell-shaped curve
    float splat = exp(-dot(p, p) / uRadius);
    
    // Sample the existing target data
    vec4 base = texture(uTarget, vUv);
    
    // Add the new splat on top of the existing base
    fragColor = base + vec4(uColor * splat, 0.0);
}
`;

// Advection Shader: Moves quantities (like dye or velocity) along the velocity field.
export const advectionFragmentShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVelocity;   // The velocity field moving the fluid
uniform sampler2D uSource;     // The quantity being advected (velocity or dye)
uniform vec2 uTexelSize;       // 1.0 / resolution (to convert velocity into UV space properly if needed)
uniform float dt;              // Time step
uniform float uDissipation;    // Dissipation rate per second

void main() {
    // 1. Fetch velocity at the current fragment
    vec2 velocity = texture(uVelocity, vUv).xy;
    
    // 2. Calculate the back-traced coordinate
    // We step backwards in time to find where the fluid came from.
    // uTexelSize ensures the velocity correctly maps to UV-space coordinates.
    vec2 coord = vUv - dt * velocity * uTexelSize;
    
    // 3. Sample the source field at the back-traced coordinate
    // Hardware bilinear filtering will smoothly interpolate between texels here.
    vec4 result = texture(uSource, coord);
    
    // 4. Apply dissipation
    // True exponential decay integrated against the time step for framerate independence.
    fragColor = result * exp(-uDissipation * dt);
}
`;

// Divergence Shader: Calculates the divergence of the velocity field.
export const divergenceFragmentShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVelocity;
uniform vec2 uResolution;

void main() {
    // Central differences using WebGL2 textureOffset
    float L = textureOffset(uVelocity, vUv, ivec2(-1, 0)).x;
    float R = textureOffset(uVelocity, vUv, ivec2(1, 0)).x;
    float B = textureOffset(uVelocity, vUv, ivec2(0, -1)).y;
    float T = textureOffset(uVelocity, vUv, ivec2(0, 1)).y;
    
    // Math: 1/2 (ux+1 - ux-1 + vy+1 - vy-1)
    float div = 0.5 * (R - L + T - B);
    
    fragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

// Jacobi Shader: Solves the Poisson equation for pressure.
export const jacobiFragmentShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform float uAlpha;
uniform float uBeta;
uniform vec2 uResolution;

void main() {
    // Left, Right, Bottom, Top pressure samples
    // WebGL2 textureOffset allows us to sample neighbors efficiently without needing texelSize uniforms!
    float L = textureOffset(uPressure, vUv, ivec2(-1, 0)).x;
    float R = textureOffset(uPressure, vUv, ivec2(1, 0)).x;
    float B = textureOffset(uPressure, vUv, ivec2(0, -1)).x;
    float T = textureOffset(uPressure, vUv, ivec2(0, 1)).x;
    
    if (gl_FragCoord.x < 1.5) { fragColor = vec4(R, 0.0, 0.0, 1.0); return; }
    if (gl_FragCoord.x > uResolution.x - 1.5) { fragColor = vec4(L, 0.0, 0.0, 1.0); return; }
    if (gl_FragCoord.y < 1.5) { fragColor = vec4(T, 0.0, 0.0, 1.0); return; }
    if (gl_FragCoord.y > uResolution.y - 1.5) { fragColor = vec4(B, 0.0, 0.0, 1.0); return; }

    // Center divergence
    float d = texture(uDivergence, vUv).x;
    
    // Pressure relaxation: p = (pL + pR + pB + pT + alpha * d) / beta
    float p = (L + R + B + T + uAlpha * d) / uBeta;
    
    fragColor = vec4(p, 0.0, 0.0, 1.0);
}
`;

// Gradient Subtract Shader: Projects the velocity field to be divergence-free.
export const gradientSubtractFragmentShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uResolution;

void main() {
    // Sample pressure gradients using WebGL2 textureOffset
    float L = textureOffset(uPressure, vUv, ivec2(-1, 0)).x;
    float R = textureOffset(uPressure, vUv, ivec2(1, 0)).x;
    float B = textureOffset(uPressure, vUv, ivec2(0, -1)).x;
    float T = textureOffset(uPressure, vUv, ivec2(0, 1)).x;
    
    // Fetch current velocity
    vec2 velocity = texture(uVelocity, vUv).xy;
    
    // Subtract the pressure gradient to make the velocity divergence-free
    velocity.xy -= vec2(R - L, T - B) * 0.5;
    
    if (gl_FragCoord.x < 1.5 || gl_FragCoord.x > uResolution.x - 1.5 || 
        gl_FragCoord.y < 1.5 || gl_FragCoord.y > uResolution.y - 1.5) {
        velocity.xy = vec2(0.0);
    }
    
    fragColor = vec4(velocity, 0.0, 1.0);
}
`;

// Curl Shader: Calculates the 2D curl of the velocity field.
export const curlFragmentShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVelocity;

void main() {
    float L = textureOffset(uVelocity, vUv, ivec2(-1, 0)).y;
    float R = textureOffset(uVelocity, vUv, ivec2(1, 0)).y;
    float B = textureOffset(uVelocity, vUv, ivec2(0, -1)).x;
    float T = textureOffset(uVelocity, vUv, ivec2(0, 1)).x;
    
    float curl = 0.5 * (R - L - T + B);
    
    fragColor = vec4(curl, 0.0, 0.0, 1.0);
}
`;

// Vorticity Shader: Injects rotational force based on curl to preserve turbulence.
export const vorticityFragmentShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uConfinement;
uniform float dt;
uniform vec2 uResolution;

void main() {
    float L = textureOffset(uCurl, vUv, ivec2(-1, 0)).x;
    float R = textureOffset(uCurl, vUv, ivec2(1, 0)).x;
    float B = textureOffset(uCurl, vUv, ivec2(0, -1)).x;
    float T = textureOffset(uCurl, vUv, ivec2(0, 1)).x;
    float C = texture(uCurl, vUv).x;
    
    vec2 force = vec2(abs(T) - abs(B), abs(L) - abs(R));
    force = normalize(force + vec2(1e-5));
    
    vec2 velocity = texture(uVelocity, vUv).xy;
    velocity += force * uConfinement * C * dt;
    
    if (gl_FragCoord.x < 1.5 || gl_FragCoord.x > uResolution.x - 1.5 || 
        gl_FragCoord.y < 1.5 || gl_FragCoord.y > uResolution.y - 1.5) {
        velocity.xy = vec2(0.0);
    }
    
    fragColor = vec4(velocity, 0.0, 1.0);
}
`;

// Display Shader: Renders the fluid simulation to the screen.
export const displayFragmentShader = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTexture;

void main() {
    vec4 color = texture(uTexture, vUv);
    fragColor = vec4(color.rgb, 1.0);
}
`;
