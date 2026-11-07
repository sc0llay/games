import * as THREE from 'three';
import { AU, PC, KPC, SYSTEM_UNIT, SKY_UNIT, band, v3, vlen } from 'orion/core/units.js';
import { SimTime } from 'orion/core/time.js';
import { galaxyToWorldMatrix } from 'orion/core/frames.js';
import { Registry } from 'orion/core/registry.js';
import { CameraController } from 'orion/core/camera.js';
import { Quality } from 'orion/core/quality.js';
import { RenderGraph } from 'orion/core/graph.js';
import { assets } from 'orion/core/assets.js';

// The shared application object handed to every feature module's install(app). See CONTRACT.md.
export function createApp(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const app = {
    THREE, canvas, renderer, assets,
    events: new EventTarget(),
    registry: new Registry(),
    time: new SimTime(),
    settings: {
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      labelScale: 1, highContrast: false, photoSky: false, orbits: true, constellations: false, labels: true,
    },
    layers: { sky: new THREE.Scene(), system: new THREE.Scene() },
    cameras: {
      // Both cameras sit at the origin; layers are camera-relative. Sky in pc, system in km.
      sky: new THREE.PerspectiveCamera(50, 1, 1e-7, 1e7),
      system: new THREE.PerspectiveCamera(50, 1, 1e-3, 1e14),
    },
    uniforms: {
      uTime: { value: 0 },                       // real seconds since start
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSunDirSys: { value: new THREE.Vector3() }, // unit vector camera → Sun (system layer)
    },
    frame: null,
    shared: {}, // cross-module handles, e.g. shared.galaxy, shared.stars
    _frameFns: [],
    onFrame(fn, order = 0) { this._frameFns.push({ fn, order }); this._frameFns.sort((a, b) => a.order - b.order); },
    // Float64 world metres → camera-relative render units, written into a THREE.Vector3.
    toSystem(world, out) { const c = this.frame.camPos; return out.set((world[0] - c[0]) / SYSTEM_UNIT, (world[1] - c[1]) / SYSTEM_UNIT, (world[2] - c[2]) / SYSTEM_UNIT); },
    toSky(world, out) { const c = this.frame.camPos; return out.set((world[0] - c[0]) / SKY_UNIT, (world[1] - c[1]) / SKY_UNIT, (world[2] - c[2]) / SKY_UNIT); },
    // Project a world point to CSS pixels. Returns null when behind the camera.
    project(world, out = { x: 0, y: 0, depth: 0 }) {
      const v = _pv.set(world[0] - this.frame.camPos[0], world[1] - this.frame.camPos[1], world[2] - this.frame.camPos[2]);
      const d = v.length();
      v.divideScalar(d).applyMatrix4(this.cameras.system.matrixWorldInverse);
      if (v.z >= 0) return null;
      v.applyMatrix4(this.cameras.system.projectionMatrix);
      out.x = (v.x * 0.5 + 0.5) * this.frame.viewport.cssW; out.y = (-v.y * 0.5 + 0.5) * this.frame.viewport.cssH; out.depth = d;
      return out;
    },
  };
  const _pv = new THREE.Vector3();
  app.quality = new Quality(renderer);
  app.camera = new CameraController(app);
  app.graph = new RenderGraph(app);
  app.capture = () => app.graph.capture();

  const galM = new THREE.Matrix4(), galArr = new Float64Array(16);
  const sunRel = v3();
  let last = performance.now(), t0 = last, hidden = false, lastRender = 0;
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; last = performance.now(); });

  function frameLoop(now) {
    requestAnimationFrame(frameLoop);
    if (hidden) return;
    if (app.quality.lowPower && now - lastRender < 32) return;
    lastRender = now;
    const realDt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF timestamps can run behind performance.now()
    app.quality.update(now - last);
    last = now;

    const levelsBefore = app.frame?.levels;
    app.time.tick(realDt);
    app.camera.update(realDt);
    const jd = app.time.jd;
    const camPos = app.camera.pos;

    // Viewport and resolution scaling.
    const cssW = canvas.clientWidth || innerWidth, cssH = canvas.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2) * app.quality.scale;
    const w = Math.max(1, Math.min(4096, Math.round(cssW * dpr))), h = Math.max(1, Math.min(4096, Math.round(cssH * dpr)));
    if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
    app.graph.resize(w, h, app.quality.settings.msaa);
    app.uniforms.uResolution.value.set(w, h);

    for (const cam of [app.cameras.sky, app.cameras.system]) {
      cam.position.set(0, 0, 0);
      cam.quaternion.copy(app.camera.quat);
      cam.fov = app.camera.fovY; cam.aspect = w / h;
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    }

    // Camera scale context for level crossfades (spec §02).
    sunRel[0] = -camPos[0]; sunRel[1] = -camPos[1]; sunRel[2] = -camPos[2];
    const dSun = vlen(sunRel);
    app.uniforms.uSunDirSys.value.set(sunRel[0], sunRel[1], sunRel[2]).divideScalar(dSun || 1);
    const ls = Math.log10(Math.max(dSun, 1));
    const near = app.camera.nearest;
    const nearR = near.entry?.radius > 0 && near.entry.type !== 'sun' ? near.entry.radius : 0;
    const altRadii = nearR ? (near.distance + nearR) / nearR : Infinity;
    const levels = [
      band(ls, Math.log10(1 * KPC) - 0.4, Math.log10(1 * KPC), 23, 24),                  // L0 galaxy
      band(ls, Math.log10(50 * PC) - 0.4, Math.log10(50 * PC), Math.log10(5 * KPC), Math.log10(5 * KPC) + 0.4), // L1 arm
      band(ls, Math.log10(1000 * AU) - 0.4, Math.log10(1000 * AU), Math.log10(100 * PC), Math.log10(100 * PC) + 0.4), // L2 neighbourhood
      band(ls, -1, 0, Math.log10(1000 * AU), Math.log10(1000 * AU) + 0.4),             // L3 solar system
      nearR ? band(Math.log10(altRadii), -1, -0.5, 2, 2.4) : 0,                          // L4 planet
    ];
    galaxyToWorldMatrix(jd, galArr); galM.fromArray(galArr);

    app.uniforms.uTime.value = (now - t0) / 1000;
    app.frame = {
      jd, realDt, time: (now - t0) / 1000,
      simDt: app.time.paused ? 0 : app.time.rate * realDt,
      camPos, camQuat: app.camera.quat, fovY: app.camera.fovY,
      dSun, levels, focus: app.camera.focus, nearest: near,
      galaxyMatrix: galM,                     // galaxy-frame pc → world pc (THREE.Matrix4)
      viewport: { w, h, cssW, cssH, dpr },
      tier: app.quality.tier, tierSettings: app.quality.settings,
      exposure: app.graph.exposure,
    };
    for (const { fn } of app._frameFns) {
      try { fn(app.frame); } catch (err) { console.error(err); }
    }
    app.graph.render(app.frame);
    app.events.dispatchEvent(new CustomEvent('frame', { detail: app.frame }));
    if (levelsBefore && dominant(levelsBefore) !== dominant(levels)) app.events.dispatchEvent(new CustomEvent('level', { detail: dominant(levels) }));
  }
  app.start = () => requestAnimationFrame(frameLoop);
  return app;
}
export const dominant = (levels) => levels.reduce((bi, w, i) => (w > levels[bi] ? i : bi), 0);
