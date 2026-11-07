// Orbit lines (spec §04): 1 px, [O III] teal, 35 % opacity, fading with distance from the camera.
// Paths are stored as Float64 (relative to the parent) and re-based on the camera on the CPU every frame in float64,
// with local Catmull-Rom subdivision near the camera, so there is no jitter at 1.05 R from Earth.
import * as THREE from 'three';
import { orbitPoints } from 'orion/render/small/kepler.js';

const TEAL = [0.028, 0.672, 0.546]; // #2fd6c3 in linear sRGB
const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uD0, uFloor;
varying float vFade;
void main() {
  float d = length(position);
  vFade = max(uFloor, 1.0 / (1.0 + d / uD0));
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uAlpha, uExpInv, uWeight;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  // Additive, display-referred (compensated for the auto exposure), alpha 0 so it never drives exposure or hides stars.
  gl_FragColor = vec4(uColor * (uAlpha * vFade * uWeight * uExpInv), 0.0);
}`;

const KMAX = 24;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function createOrbits(app) {
  const eph = app.shared.ephemeris;
  const group = new THREE.Group(); group.name = 'orbit-lines'; app.layers.system.add(group);
  const lines = new Map();
  const parentPos = new Float64Array(3), bodyPos = new Float64Array(3);
  let lastBuildReal = 0;

  const makeMaterial = () => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    uniforms: { uColor: { value: new THREE.Vector3(...TEAL) }, uAlpha: { value: 0.35 * 0.5 }, uExpInv: { value: 1 }, uWeight: { value: 1 }, uD0: { value: 6e8 }, uFloor: { value: 0.12 } },
  });

  function addLine(key, spec) {
    const n = spec.n, cap = n * 4 + 2048;
    const geom = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array(cap * 3), 3); attr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', attr); geom.setDrawRange(0, 0);
    const line = new THREE.Line(geom, makeMaterial());
    line.frustumCulled = false; line.visible = false; line.renderOrder = 8;
    group.add(line);
    const L = { key, ...spec, geom, attr, line, cap, path: null, rel: new Float64Array(n * 3), jdBuilt: -1e12, dead: false, count: 0 };
    lines.set(key, L); return L;
  }

  const periodOf = (b) => b?.periodDays ?? b?.period ?? 365.25;
  function rebuild(L, jd) {
    try {
      L.path = L.pathFn(jd);
      L.jdBuilt = jd; L.dead = !L.path || L.path.length < 9;
      if (!L.dead) { let m = 0; for (let i = 0; i < L.path.length; i += 3) m = Math.max(m, Math.hypot(L.path[i], L.path[i + 1], L.path[i + 2])); L.radius = m; }
    } catch (err) { L.dead = true; console.warn('[orbits] path failed for', L.key, err?.message); }
  }

  // Planets and dwarf planets orbit the Sun.
  for (const b of eph.BODIES) {
    if (b.parent === 'sun' && (b.type === 'planet' || b.type === 'dwarf')) {
      addLine(b.id, { id: b.id, parent: 'sun', n: 1024, refresh: Math.max(2, periodOf(b) * 0.02), pathFn: (jd) => eph.orbitPath(b.id, jd, 1024), kind: 'planet' });
    }
  }

  function ensureMoon(m) {
    if (lines.has(m.id)) return lines.get(m.id);
    const b = eph.getBody?.(m.id);
    if (!b) return null;
    return addLine(m.id, { id: m.id, parent: m.parent, n: 256, refresh: Math.max(0.05, periodOf(b) * 0.03), pathFn: (jd) => eph.orbitPath(m.id, jd, 256), kind: 'moon' });
  }

  /** Orbit from Keplerian elements (comets, asteroids); drawn only while that object is focused. */
  function addElementsLine(id, el) {
    return addLine('el:' + id, { id, parent: 'sun', n: 768, refresh: 1e12, pathFn: () => orbitPoints(el, 768, 500), kind: 'focus-only' });
  }

  const tmpRegistry = [];
  function visibleSet(frame) {
    const focus = frame.focus, set = new Set();
    if (focus) {
      const host = focus.type === 'moon' ? focus.parent : focus.id;
      tmpRegistry.length = 0;
      for (const e of app.registry.children(host)) if (e.type === 'moon') tmpRegistry.push(e);
      if (focus.type === 'planet' || focus.type === 'moon' || focus.type === 'dwarf') for (const m of tmpRegistry) { const L = ensureMoon(m); if (L) set.add(L.key); }
      if (lines.has('el:' + focus.id)) set.add('el:' + focus.id);
    }
    return set;
  }

  function update(frame) {
    group.visible = app.settings.orbits !== false;
    if (!group.visible) return;
    const jd = frame.jd, cam = frame.camPos, nowReal = performance.now();
    const focusId = frame.focus?.id;
    const extra = visibleSet(frame);
    const weight = frame.levels[3];
    const expInv = 1 / Math.max(frame.exposure?.sys ?? 1, 1e-6);
    const d0 = Math.max(6e8, 0.4 * frame.dSun / 1000);
    // Close to a planet, other bodies' orbit lines only clutter the view: planet lines fade when the nearest body is < 12 % of the
    // camera's solar distance away, moon lines fade when the camera is within ~3 orbit radii of the parent. The focused body's own line stays.
    const nearD = frame.nearest?.distance ?? Infinity;
    const planetW = ss(0.02, 0.12, nearD / Math.max(frame.dSun, 1));
    const allowRebuild = nowReal - lastBuildReal > 400;
    let rebuilt = false;

    for (const L of lines.values()) {
      const show = L.kind === 'planet' || extra.has(L.key);
      if (!show || weight <= 0.001) { L.line.visible = false; continue; }
      if (!L.path || (allowRebuild && !rebuilt && Math.abs(jd - L.jdBuilt) > L.refresh)) { rebuild(L, jd); rebuilt = true; }
      if (L.dead) { L.line.visible = false; continue; }
      if (L.parent === 'sun') { parentPos[0] = parentPos[1] = parentPos[2] = 0; } else eph.heliocentric(L.parent, jd, parentPos);
      const ox = (parentPos[0] - cam[0]) / 1000, oy = (parentPos[1] - cam[1]) / 1000, oz = (parentPos[2] - cam[2]) / 1000;
      const hl = L.id === focusId;
      let fade = 1;
      if (!hl) {
        if (L.kind === 'moon') fade = ss(1.0, 3.0, Math.hypot(ox, oy, oz) * 1000 / Math.max(L.radius || 1, 1));
        else if (L.kind === 'planet') fade = planetW;
      }
      if (fade < 0.004) { L.line.visible = false; continue; }
      const n = L.path.length / 3, rel = L.rel.length === n * 3 ? L.rel : (L.rel = new Float64Array(n * 3)), p = L.path;
      for (let i = 0; i < n; i++) { rel[i * 3] = p[i * 3] / 1000 + ox; rel[i * 3 + 1] = p[i * 3 + 1] / 1000 + oy; rel[i * 3 + 2] = p[i * 3 + 2] / 1000 + oz; }
      // Emit with adaptive Catmull-Rom subdivision so the polyline hugs the true ellipse near the camera.
      const out = L.attr.array, cap = L.cap;
      let c = 0;
      for (let i = 0; i < n; i++) {
        const i0 = (i - 1 + n) % n, i1 = i, i2 = (i + 1) % n, i3 = (i + 2) % n;
        const ax = rel[i1 * 3], ay = rel[i1 * 3 + 1], az = rel[i1 * 3 + 2], bx = rel[i2 * 3], by = rel[i2 * 3 + 1], bz = rel[i2 * 3 + 2];
        const len = Math.hypot(bx - ax, by - ay, bz - az), dm = Math.hypot((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
        let k = Math.min(KMAX, Math.max(1, Math.ceil(len / (0.012 * Math.max(dm, len * 0.05, 1)))));
        if (c + k + 2 > cap) k = 1;
        out[c * 3] = ax; out[c * 3 + 1] = ay; out[c * 3 + 2] = az; c++;
        for (let s = 1; s < k; s++) {
          const t = s / k, t2 = t * t, t3 = t2 * t;
          for (let d = 0; d < 3; d++) {
            const P0 = rel[i0 * 3 + d], P1 = rel[i1 * 3 + d], P2 = rel[i2 * 3 + d], P3 = rel[i3 * 3 + d];
            out[c * 3 + d] = 0.5 * (2 * P1 + (-P0 + P2) * t + (2 * P0 - 5 * P1 + 4 * P2 - P3) * t2 + (-P0 + 3 * P1 - 3 * P2 + P3) * t3);
          }
          c++;
        }
      }
      out[c * 3] = rel[0]; out[c * 3 + 1] = rel[1]; out[c * 3 + 2] = rel[2]; c++; // close the loop
      L.attr.needsUpdate = true; L.attr.addUpdateRange?.(0, c * 3);
      L.geom.setDrawRange(0, c);
      const u = L.line.material.uniforms;
      u.uAlpha.value = hl ? 0.8 : L.kind === 'moon' ? 0.3 : 0.175;
      u.uWeight.value = weight * fade; u.uExpInv.value = expInv; u.uD0.value = d0;
      u.uFloor.value = hl ? 0.5 : 0.12;
      L.line.visible = true;
    }
    if (rebuilt) lastBuildReal = nowReal;
  }
  return { update, lines, addElementsLine, group };
}
