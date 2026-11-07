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

async function boot() {
  const canvas = document.getElementById('scene');
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
boot();
