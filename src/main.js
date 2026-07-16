import './style.css';
import { FluidSolver } from './fluidSolver.js';

// 1. Canvas & Engine Initialization
const canvas = document.getElementById('sim-canvas');
const uiPanel = document.getElementById('ui-panel');

let solver;
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

try {
    solver = new FluidSolver(canvas);
} catch (e) {
    console.error("FluidSolver initialization failed", e);
    document.body.innerHTML = '<h1 style="color:white;text-align:center;margin-top:20%">WebGL2 Not Supported</h1>';
}

// 2. State Management & Configuration
const config = {
    iterations: 35,
    dyeDissipation: 0.95,
    velocityDissipation: 0.2,
    confinement: 30.0,
    splatRadius: 0.001
};

const pointer = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    isDown: false,
    color: [1.0, 1.0, 1.0],
    moving: false
};

// 3. UI Wiring
function setupUI() {
    const bindSlider = (id, configKey, valDisplayId, precision) => {
        const slider = document.getElementById(id);
        const display = document.getElementById(valDisplayId);
        slider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            config[configKey] = val;
            display.textContent = val.toFixed(precision);
        });
    };

    bindSlider('dyeDissipation', 'dyeDissipation', 'val-dye', 2);
    bindSlider('velDissipation', 'velocityDissipation', 'val-vel', 2);
    bindSlider('confinement', 'confinement', 'val-conf', 1);
    bindSlider('splatRadius', 'splatRadius', 'val-rad', 4);

    document.getElementById('clear-btn').addEventListener('click', () => {
        if (solver) {
            solver.executeClear(solver.renderTargets.dye, 0.0);
            solver.executeClear(solver.renderTargets.velocity, 0.0);
        }
    });
}
setupUI();

// 4. Color Logic
function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) r = g = b = l; 
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return [r, g, b];
}

function updatePointerColor(time) {
    const hue = (time / 10000) % 1.0;
    pointer.color = hslToRgb(hue, 1.0, 0.5);
}

// 5. Pointer Events
function updatePointer(e) {
    const nx = e.clientX / canvas.width;
    const ny = 1.0 - (e.clientY / canvas.height);
    
    if (pointer.isDown) {
        pointer.dx = nx - pointer.x;
        pointer.dy = ny - pointer.y;
        pointer.moving = true;
    }
    
    pointer.x = nx;
    pointer.y = ny;
}

window.addEventListener('pointerdown', (e) => {
    // IGNORE clicks on the UI panel
    if (e.composedPath().includes(uiPanel)) return;

    pointer.isDown = true;
    pointer.moving = false;
    pointer.dx = 0;
    pointer.dy = 0;
    
    pointer.x = e.clientX / canvas.width;
    pointer.y = 1.0 - (e.clientY / canvas.height);
});

window.addEventListener('pointermove', (e) => {
    if (pointer.isDown) updatePointer(e);
});

const endPointer = () => {
    pointer.isDown = false;
    pointer.moving = false;
};

window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
window.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) endPointer();
});

// 6. The Render Loop
let lastTime = performance.now();
const momentum = new Float32Array(3);

function loop(currentTime) {
    let dt = (currentTime - lastTime) / 1000.0;
    lastTime = currentTime;
    
    if (dt > 0.016) dt = 0.016;

    updatePointerColor(currentTime);

    if (solver) {
        if (pointer.isDown && pointer.moving) {
            const force = 1500.0; 
            
            solver.executeSplat(
                solver.renderTargets.dye, 
                [pointer.x, pointer.y], 
                pointer.color, 
                config.splatRadius
            );
            
            momentum[0] = pointer.dx * force;
            momentum[1] = pointer.dy * force;
            momentum[2] = 0.0;
            
            solver.executeSplat(
                solver.renderTargets.velocity,
                [pointer.x, pointer.y],
                momentum,
                config.splatRadius
            );
        }

        solver.step(dt, config);
    }

    pointer.dx = 0;
    pointer.dy = 0;
    pointer.moving = false;

    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);