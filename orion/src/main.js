import { createApp } from 'orion/core/app.js';

// Feature modules, installed in order. Each exports `async function install(app)`.
// A module that fails to load is logged and skipped so the rest of the scene still runs.
const MODULES = [
  'orion/ephemeris/index.js',
  'orion/stars/index.js',
  'orion/galaxy/index.js',
  'orion/render/bodies/index.js',
  'orion/render/small/index.js',
  'orion/ui/index.js',
];

// A message on the poster instead of a silent, permanent title card.
function fatal(title, detail) {
  let poster = document.getElementById('poster');
  if (!poster) { poster = document.createElement('div'); poster.id = 'poster'; document.body.append(poster); }
  poster.classList.remove('gone');
  poster.setAttribute('role', 'alert'); poster.removeAttribute('aria-hidden');
  poster.innerHTML = '<div class="fatal"><b></b><p></p></div>';
  poster.querySelector('b').textContent = title;
  poster.querySelector('p').textContent = detail;
}

// WebGL2 with renderable float/half-float targets is required by the HDR pipeline.
function checkGPU() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return 'This browser or device does not support WebGL 2, which Orion Spur needs. Try a current Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.';
  const ok = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (!ok) return 'This GPU cannot render to floating-point targets (EXT_color_buffer_float), which Orion Spur needs for its HDR rendering.';
  return null;
}

// Mobile browsers drop the GL context under memory pressure. Rebuilding every GPU resource in place is not supported, so
// offer a reload rather than leaving a frozen canvas.
function watchContext(canvas) {
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.error('[orion] WebGL context lost');
    fatal('Graphics reset', 'The browser reset the graphics context, often because the device ran low on memory. Tap or click to reload.');
    const poster = document.getElementById('poster');
    poster.style.cursor = 'pointer';
    poster.addEventListener('click', () => location.reload(), { once: true });
  }, false);
}

async function boot() {
  const canvas = document.getElementById('scene');
  const gpuProblem = checkGPU();
  if (gpuProblem) { fatal('Cannot start', gpuProblem); return; }
  watchContext(canvas);
  const app = createApp(canvas);
  globalThis.orion = app; // debugging handle
  for (const spec of MODULES) {
    try {
      const mod = await import(spec);
      // A module whose install never settles must not stall the rest of boot.
      await Promise.race([mod.install(app), new Promise((_, rej) => setTimeout(() => rej(new Error('install timed out')), 15000))]);
    } catch (err) {
      console.error(`[orion] ${spec} failed`, err);
      (app.moduleErrors ??= []).push({ spec, err }); // the UI installs last and replays these
      app.events.dispatchEvent(new CustomEvent('module-error', { detail: { spec, err } }));
    }
  }
  // Opening view: above the north galactic pole looking down at the disk, unless a hash says otherwise.
  if (!app.camera.focus) {
    const start = app.registry.get('milky-way') || app.registry.get('sun');
    if (start) app.camera.focusOn(start);
  }
  app.events.dispatchEvent(new Event('ready'));
  app.start();
  // Compile everything once before revealing the scene.
  try { await app.renderer.compileAsync(app.layers.system, app.cameras.system); await app.renderer.compileAsync(app.layers.sky, app.cameras.sky); } catch {}
  const poster = document.getElementById('poster');
  if (poster) { poster.classList.add('gone'); setTimeout(() => poster.remove(), 1200); }
}
boot().catch((err) => {
  console.error('[orion] boot failed', err);
  fatal('Cannot start', `Something went wrong while starting: ${err?.message || err}. Reloading may help.`);
});
