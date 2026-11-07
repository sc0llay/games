// Asteroid belt, Jupiter Trojans, Kuiper belt (instanced points, Kepler solved in the vertex shader), close-up asteroid
// meshes, and the Oort-cloud shell (sky layer: it lies beyond the system camera's far plane).
import * as THREE from 'three';
import { AU, PC, DEG } from 'orion/core/units.js';
import { elementsToPos } from 'orion/render/small/kepler.js';
import { rockGeometry, rockMaterial } from 'orion/render/small/rock.js';
import { createKirkwood } from 'orion/render/small/kirkwood.js';

const AU_KM = AU / 1000;
// Display-referred sprite intensities (the shader divides by the auto exposure). Tuned by eye against the sky layer's star field.
const BELT_GAIN = 0.6, KUIPER_GAIN = 0.55, OORT_GAIN = 0.45;
const ADD = { transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };

const PT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aEl1;  // a (AU), e, i, Ω
attribute vec4 aEl2;  // ω, M0, H, unused
uniform vec3 uCam;    // camera heliocentric position, AU
uniform float uDtHi, uDtLo, uPx, uSize;
varying float vB;
const float TAU = 6.28318530718;
void main() {
  float a = aEl1.x, e = aEl1.y, inc = aEl1.z, om = aEl1.w, w = aEl2.x, M0 = aEl2.y, H = aEl2.z;
  float n = 0.01720209895 / (a * sqrt(a));                 // rad/day
  float M = M0 + mod(n * uDtHi, TAU) + n * uDtLo;          // time = hi + lo days since the data epoch (keeps float32 precision)
  M = mod(M, TAU);
  float E = M + e * sin(M);
  for (int k = 0; k < 4; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  float xv = a * (cos(E) - e), yv = a * sqrt(1.0 - e * e) * sin(E);
  float co = cos(om), so = sin(om), cw = cos(w), sw = sin(w), ci = cos(inc), si = sin(inc);
  vec3 p = vec3(xv * (cw * co - sw * ci * so) - yv * (sw * co + cw * ci * so),
                xv * (cw * so + sw * ci * co) - yv * (sw * so - cw * ci * co),
                xv * sw * si + yv * cw * si);
  vec3 rel = (p - uCam) * ${AU_KM.toFixed(3)};              // camera-relative, km
  gl_Position = projectionMatrix * viewMatrix * vec4(rel, 1.0);
  vB = 0.3 + 0.7 * clamp((16.0 - H) / 9.0, 0.0, 1.0);
  gl_PointSize = uPx * uSize * (0.75 + 0.5 * vB);
  #include <logdepthbuf_vertex>
}`;
const PT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uAlpha, uExpInv;
varying float vB;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float k = smoothstep(1.0, 0.25, d);
  gl_FragColor = vec4(uColor * (vB * k * uAlpha * uExpInv), 0.0);
}`;

// ---- procedural populations ------------------------------------------------------------------------------------------
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());
const rayleigh = (r, sigma) => sigma * Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9)));
const KIRKWOOD = [[2.50, 0.022], [2.82, 0.016], [2.95, 0.012], [3.27, 0.014], [2.065, 0.012], [2.71, 0.008]];
const inGap = (a) => KIRKWOOD.some(([c, w]) => Math.abs(a - c) < w);

/** Procedural main belt with Kirkwood gaps; Float32Array(count*7) sorted by H like data/asteroids.bin. */
export function genBelt(count, seed = 7) {
  const r = rng(seed), rows = [];
  while (rows.length < count) {
    // density: broad hump between 2.1 and 3.3 AU
    const a = 2.05 + 1.3 * (0.5 * r() + 0.5 * r()) ** 1.0 * 1.0 + (r() < 0.12 ? -0.1 + 0.2 * r() : 0);
    if (a < 2.0 || a > 3.35 || inGap(a)) continue;
    const e = Math.min(0.4, rayleigh(r, 0.075)), inc = Math.min(30, rayleigh(r, 6.5)) * DEG;
    if (a * (1 - e) < 1.3) continue;
    const H = 8 + Math.log10(1 + r() * (10 ** (0.62 * 7) - 1)) / 0.62;
    rows.push([a, e, inc, r() * 6.2832, r() * 6.2832, r() * 6.2832, H]);
  }
  rows.sort((x, y) => x[6] - y[6]);
  return Float32Array.from(rows.flat());
}
/** Jupiter Trojans around L4/L5: same period as Jupiter, mean longitude ±60° with libration. */
export function genTrojans(count, aJ, lambdaJ, seed = 11) {
  const r = rng(seed), rows = [];
  for (let k = 0; k < count; k++) {
    const lead = k % 2 === 0 ? 1 : -1;
    const a = aJ * (1 + 0.012 * gauss(r)), e = Math.min(0.15, rayleigh(r, 0.045)), inc = Math.min(40, rayleigh(r, 11)) * DEG;
    const lam = lambdaJ + lead * (60 + 13 * gauss(r)) * DEG, om = r() * 6.2832, w = r() * 6.2832;
    const M0 = lam - om - w; // λ = Ω + ω + M
    rows.push([a, e, inc, om, w, M0, 9.5 + Math.log10(1 + r() * (10 ** (0.55 * 5.5) - 1)) / 0.55]);
  }
  rows.sort((x, y) => x[6] - y[6]);
  return Float32Array.from(rows.flat());
}
/** Kuiper belt: cold/hot classical, plutinos (3:2 at 39.4 AU), scattered disc. */
export function genKuiper(count, seed = 23) {
  const r = rng(seed), rows = [];
  for (let k = 0; k < count; k++) {
    const u = r(); let a, e, inc;
    if (u < 0.45) { a = 42 + 5 * r() ** 0.9; e = rayleigh(r, 0.04); inc = rayleigh(r, 1.8); }            // cold classical
    else if (u < 0.65) { a = 39.5 + 8 * r(); e = rayleigh(r, 0.09); inc = rayleigh(r, 11); }             // hot classical
    else if (u < 0.85) { a = 39.4 + 0.25 * gauss(r); e = 0.12 + 0.12 * r(); inc = rayleigh(r, 9); }       // plutinos
    else { a = 47 + 40 * r() ** 1.6; e = 0.15 + 0.35 * r(); inc = rayleigh(r, 16); }                    // scattered
    e = Math.min(e, 0.6);
    rows.push([a, e, Math.min(inc, 45) * DEG, r() * 6.2832, r() * 6.2832, r() * 6.2832, 5 + 6 * r()]);
  }
  return Float32Array.from(rows.flat());
}

function pointsFrom(data, count, epoch, color, size) {
  // data: Float32Array rows of 7 [a,e,i,Ω,ω,M0,H]
  const geom = new THREE.BufferGeometry();
  const el1 = new Float32Array(count * 4), el2 = new Float32Array(count * 4);
  for (let k = 0; k < count; k++) {
    el1[k * 4] = data[k * 7]; el1[k * 4 + 1] = data[k * 7 + 1]; el1[k * 4 + 2] = data[k * 7 + 2]; el1[k * 4 + 3] = data[k * 7 + 3];
    el2[k * 4] = data[k * 7 + 4]; el2[k * 4 + 1] = data[k * 7 + 5]; el2[k * 4 + 2] = data[k * 7 + 6];
  }
  geom.setAttribute('aEl1', new THREE.BufferAttribute(el1, 4)); geom.setAttribute('aEl2', new THREE.BufferAttribute(el2, 4));
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // dummy, required for draw count
  geom.setDrawRange(0, count);
  const mat = new THREE.ShaderMaterial({
    vertexShader: PT_VERT, fragmentShader: PT_FRAG, ...ADD,
    uniforms: { uCam: { value: new THREE.Vector3() }, uDtHi: { value: 0 }, uDtLo: { value: 0 }, uPx: { value: 1 }, uSize: { value: size },
      uColor: { value: new THREE.Vector3(...color) }, uAlpha: { value: 1 }, uExpInv: { value: 1 } },
  });
  const pts = new THREE.Points(geom, mat);
  pts.frustumCulled = false; pts.renderOrder = 6;
  return { points: pts, mat, count, epoch, data };
}

const OORT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
uniform float uPx;
varying float vA;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPx * aSize;
  vA = aSize;
  #include <logdepthbuf_vertex>
}`;
const OORT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uWeight; varying float vA;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float k = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vec3(0.34, 0.5, 0.95) * (${OORT_GAIN.toFixed(3)} * k * uWeight * (0.6 + 0.2 * vA)), 1.0);
}`;

export async function createBelts(app) {
  const eph = app.shared.ephemeris;
  const out = { objects: [], dataSource: 'procedural', update() {}, oort: null };
  const tierCount = () => app.frame?.tierSettings?.asteroids ?? app.quality.settings.asteroids;

  // ---- belt data ---------------------------------------------------------------------------------------------------
  let belt = null, epoch = 2451545.0;
  try {
    const buf = await app.assets.buffer('data/asteroids.bin');
    if (buf && buf.byteLength > 16) {
      const dv = new DataView(buf); const count = dv.getUint32(0, true), ver = dv.getUint32(4, true);
      if (ver === 1 && count > 0 && buf.byteLength >= 16 + count * 28) {
        epoch = dv.getFloat64(8, true);
        const f = new Float32Array(count * 7); for (let i = 0; i < f.length; i++) f[i] = dv.getFloat32(16 + i * 4, true);
        belt = f; out.dataSource = 'asteroids.bin';
      }
    }
  } catch (err) { console.warn('[small] asteroids.bin unreadable, using procedural belt', err); }
  const maxTier = 50000;
  if (!belt) belt = genBelt(maxTier);
  const beltCount = belt.length / 7;
  out.beltCount = beltCount; out.epoch = epoch;

  const sets = [];
  const mainSet = pointsFrom(belt, beltCount, epoch, [1.0, 0.86, 0.66].map((x) => x * BELT_GAIN), 2.1);
  sets.push({ name: 'belt', ...mainSet, tiered: true });

  // Jupiter Trojans / Kuiper belt: procedural unless the data already holds them.
  let nTroj = 0; for (let k = 0; k < beltCount; k++) { const a = belt[k * 7]; if (a > 5.0 && a < 5.45) nTroj++; }
  const jup = eph.getBody?.('jupiter'); const pJ = jup?.periodDays ?? jup?.period ?? 4332.59;
  const aJ = Math.pow(pJ / 365.25636, 2 / 3);
  const jp = new Float64Array(3); eph.heliocentric('jupiter', epoch, jp);
  if (nTroj < 300) sets.push({ name: 'trojans', ...pointsFrom(genTrojans(4500, aJ, Math.atan2(jp[1], jp[0])), 4500, epoch, [0.95, 0.72, 0.55].map((x) => x * BELT_GAIN * 0.9), 1.9), tiered: false, scale: 0.4 });
  sets.push({ name: 'kuiper', ...pointsFrom(genKuiper(9000), 9000, 2451545.0, [0.7, 0.8, 1.0].map((x) => x * KUIPER_GAIN), 1.9), tiered: false, scale: 0.3 });
  for (const s of sets) app.layers.system.add(s.points);
  out.sets = sets;

  function applyTier() {
    const n = Math.min(beltCount, app.quality.settings.asteroids);
    mainSet.points.geometry.setDrawRange(0, n);
    for (const s of sets) if (s.scale) s.points.geometry.setDrawRange(0, Math.max(500, Math.floor(s.count * Math.min(1, app.quality.settings.asteroids / 50000 + 0.3))));
  }
  applyTier();
  app.quality.addEventListener('tier', applyTier);

  const kirk = out.dataSource === 'asteroids.bin' ? createKirkwood(app, belt, beltCount) : null;   // real histogram only (not the procedural fallback)
  out.kirkwood = kirk;

  // ---- close-up meshes ---------------------------------------------------------------------------------------------
  const MAXN = 12, NEAR_KM = 3e5, SCAN = 300;
  const geom = rockGeometry({ axes: [1, 0.85, 0.75], seed: 5, subdiv: 4, rough: 0.2, craters: 8 });
  const nearMat = rockMaterial({ albedo: [0.12, 0.11, 0.1], bump: 2.0 });
  const near = new THREE.InstancedMesh(geom, nearMat, MAXN);
  near.frustumCulled = false; near.count = 0; near.name = 'near-asteroids'; app.layers.system.add(near);
  const nearList = []; let scanPos = 0;
  const el = { a: 1, e: 0, i: 0, om: 0, w: 0, M0: 0, epoch }, pos = new Float64Array(3);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), tp = new THREE.Vector3(), axis = new THREE.Vector3();
  const fillEl = (k) => { el.a = belt[k * 7]; el.e = belt[k * 7 + 1]; el.i = belt[k * 7 + 2]; el.om = belt[k * 7 + 3]; el.w = belt[k * 7 + 4]; el.M0 = belt[k * 7 + 5]; };
  const diameterKm = (H) => (1329 / Math.sqrt(0.15)) * 10 ** (-H / 5);

  function updateNear(frame) {
    const cam = frame.camPos, rAU = Math.hypot(cam[0], cam[1], cam[2]) / AU;
    const inBelt = rAU > 1.6 && rAU < 4.2 && Math.abs(cam[2]) / AU < 0.8;
    if (inBelt) {
      for (let s = 0; s < SCAN; s++) {
        const k = scanPos; scanPos = (scanPos + 1) % beltCount;
        if (nearList.some((x) => x.k === k)) continue;
        fillEl(k); elementsToPos(el, frame.jd, pos);
        const d = Math.hypot(pos[0] - cam[0], pos[1] - cam[1], pos[2] - cam[2]) / 1000;
        if (d < NEAR_KM && nearList.length < MAXN) nearList.push({ k, d, seed: (k * 2654435761) % 1000 / 1000 });
      }
    }
    let n = 0;
    const sunDir = tp.set(-cam[0], -cam[1], -cam[2]).normalize();
    for (let i = nearList.length - 1; i >= 0; i--) {
      const o = nearList[i]; fillEl(o.k); elementsToPos(el, frame.jd, pos);
      const dx = (pos[0] - cam[0]) / 1000, dy = (pos[1] - cam[1]) / 1000, dz = (pos[2] - cam[2]) / 1000, d = Math.hypot(dx, dy, dz);
      if (d > NEAR_KM * 2) { nearList.splice(i, 1); continue; }
    }
    for (const o of nearList) {
      fillEl(o.k); elementsToPos(el, frame.jd, pos);
      const dx = (pos[0] - cam[0]) / 1000, dy = (pos[1] - cam[1]) / 1000, dz = (pos[2] - cam[2]) / 1000;
      const R = diameterKm(belt[o.k * 7 + 6]) / 2;
      axis.set(Math.sin(o.seed * 40), Math.cos(o.seed * 70), Math.sin(o.seed * 13) + 0.2).normalize();
      qq.setFromAxisAngle(axis, ((frame.jd * 24) / (4 + 8 * o.seed)) * Math.PI * 2);
      sc.set(R, R, R); m4.compose(tp.set(dx, dy, dz), qq, sc); near.setMatrixAt(n++, m4);
    }
    near.count = n; near.visible = n > 0; near.instanceMatrix.needsUpdate = true;
    nearMat.uniforms.uSunDir.value.set(-cam[0], -cam[1], -cam[2]).normalize();
    nearMat.uniforms.uSunE.value = (AU / Math.max(Math.hypot(cam[0], cam[1], cam[2]), 1e9)) ** 2;
    void sunDir;
  }

  // ---- Oort cloud shell (sky layer, parsecs) ------------------------------------------------------------------------
  {
    const N = 70000, pos3 = new Float32Array(N * 3), size = new Float32Array(N), r = rng(99);
    for (let k = 0; k < N; k++) {
      // Hills cloud (flattened, 2–20 kAU) + outer cloud (isotropic, a shell peaking near 50 kAU)
      const inner = r() < 0.3, z = inner ? (r() * 2 - 1) * 0.55 : r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      const R = (inner ? 2000 + 18000 * r() ** 1.3 : 20000 + 30000 * Math.abs(gauss(r)) * 0.8 + 20000 * r()) * AU / PC;
      pos3[k * 3] = R * s * Math.cos(a); pos3[k * 3 + 1] = R * s * Math.sin(a); pos3[k * 3 + 2] = R * z; size[k] = 1.1 + 1.6 * r() ** 3;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos3, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: OORT_VERT, fragmentShader: OORT_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uPx: { value: 1 }, uWeight: { value: 0 } } });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.visible = false; pts.name = 'oort-cloud';
    app.layers.sky.add(pts);
    out.oort = pts;
  }

  const sunWorld = new Float64Array(3);
  out.update = (frame) => {
    const t = frame.jd - epoch, hi = Math.floor(t), lo = t - hi;
    const cam = frame.camPos, px = frame.viewport.dpr;
    let w = frame.levels[3];
    // Dim belt points near a planet/moon so they cannot add light through a bright daytime sky or atmosphere.
    const nr = frame.nearest;
    if (nr && nr.entry && nr.entry.radius > 0 && nr.entry.id !== 'sun' && ['planet', 'moon', 'dwarf'].includes(nr.entry.type)) {
      const x = Math.min(1, Math.max(0, (nr.distance / nr.entry.radius - 1.3) / 5.0)); w *= x * x * (3 - 2 * x);
    }
    const expInv = 1 / Math.max(frame.exposure?.sys ?? 1, 1e-6);
    for (const s of sets) {
      const t2 = s.name === 'kuiper' ? frame.jd - 2451545.0 : t, h2 = Math.floor(t2), l2 = t2 - h2, u = s.mat.uniforms;
      u.uCam.value.set(cam[0] / AU, cam[1] / AU, cam[2] / AU); u.uDtHi.value = h2; u.uDtLo.value = l2; u.uPx.value = px;
      u.uAlpha.value = w; u.uExpInv.value = expInv; s.points.visible = w > 0.002;
    }
    void hi; void lo;
    kirk?.update(frame, w, expInv);
    updateNear(frame);
    // Oort shell: weight from the neighbourhood level, plus a faint presence while inside the solar system.
    const dAU = frame.dSun / AU;
    const ow = Math.max(frame.levels[2], 0.5 * frame.levels[3] * Math.min(1, Math.max(0, (dAU - 300) / 700)));
    out.oort.visible = ow > 0.003;
    if (out.oort.visible) {
      app.toSky(sunWorld, out.oort.position); out.oort.material.uniforms.uWeight.value = ow; out.oort.material.uniforms.uPx.value = px;
    }
  };
  return out;
}
