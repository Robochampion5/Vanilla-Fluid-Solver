# WebGL2 Eulerian Fluid Solver

![WebGL2](https://img.shields.io/badge/WebGL2-990000?style=for-the-badge&logo=webgl&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)

## Abstract

This project is a high-performance, real-time 2D fluid simulation built entirely from scratch. By applying the Eulerian approach to the Navier-Stokes equations, the solver operates on a fixed grid, modeling the flow of physical quantities (velocity, pressure, and dye) through space over time. Written in pure Vanilla JavaScript and raw WebGL2, the engine achieves profound computational efficiency by offloading the entire mathematical pipeline—from kinematic advection to the Poisson pressure solver—directly to the GPU fragment shaders.

## Key Features

- **The Data Layer:** Custom double-buffered (ping-pong) Framebuffer Object (FBO) architecture utilizing 16-bit floating-point textures (`gl.RG16F`, `gl.RGBA16F`, `gl.R16F`) mapped strictly to the WebGL2 specification to simulate grid states.
- **Kinematics:** Implements Semi-Lagrangian advection for both velocity and dye fields, integrating true exponential decay against the delta-time step for absolute framerate independence.
- **Incompressibility Pipeline:** Utilizes a high-frequency CPU loop to execute a parallel Jacobi relaxation solver (Poisson equation) for the pressure field. Calculates divergence and gradient subtractions strictly using hardware-accelerated `textureOffset` fetches, bypassing CPU-bound UV arithmetic.
- **Boundary Enforcements:** Fragment-level evaluation of Pure Neumann boundaries for pressure (zero gradient at walls) and No-Slip boundaries for velocity to prevent `NaN` explosions and pressure drift.
- **Turbulence Restoration:** Computes the 2D curl of the velocity field and injects an orthogonal vorticity confinement force to preserve the small, chaotic turbulent eddies that are typically lost to bilinear interpolation.
- **UI & Interaction:** Features a custom CSS Glassmorphism control panel to tweak parameters (Viscosity, Dissipation, Confinement, Brush Size) in real-time. Employs the modern Pointer Events API with momentum injection and bulletproof cancellation logic to prevent velocity teleportation bugs.

## The Math

The engine solves the incompressible Navier-Stokes equations for fluid flow through operator splitting, isolating each physical phenomenon into discrete shader passes:

1. **Advect:** The velocity field moves itself (self-advection) and transports the dye payload along its vectors using Semi-Lagrangian backward integration.
2. **Apply Forces:** External momentum is injected via pointer interactions, and a vorticity confinement force is applied to amplify sub-grid rotational energy (turbulence).
3. **Calculate Divergence:** The system measures the volumetric "error" (how much fluid is compressing or expanding at any given pixel).
4. **Solve Pressure:** A Jacobi iteration loop solves the Poisson equation, deducing the exact pressure field required to push the fluid outward and counteract the divergence.
5. **Subtract Gradient:** The pressure gradient is subtracted from the velocity field, yielding a perfectly mass-conserving, divergence-free flow.

## Installation & Usage

Ensure you have [Node.js](https://nodejs.org/) installed, then follow these steps to run the simulation locally:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/webgl2-fluid-solver.git
   cd webgl2-fluid-solver
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. **Experience the simulation:** Open your browser and navigate to the local host address provided by Vite (typically `http://localhost:5173/`).

## Project Structure

```text
webgl2-fluid-solver/
├── index.html       # Entry point, Canvas & Glassmorphism UI layout
├── src/
│   ├── main.js        # DOM orchestration, pointer events, rendering loop
│   ├── fluidSolver.js # Core WebGL2 engine, ping-pong FBOs, pipeline execution
│   ├── shaders.js     # Raw WebGL2 GLSL shaders (#version 300 es)
│   ├── glProgram.js   # Type-safe shader compilation and uniform pipeline
│   └── style.css      # Modern styling and UI layout
├── package.json     # Project configuration and Vite scripts
```

## License

This project is licensed under the MIT License.
