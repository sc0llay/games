// Comets (Halley, Hale–Bopp, 67P): Keplerian orbits from JPL SBDB elements, nucleus mesh/point, coma, blue ion tail pointing
// anti-sunward, and a curved yellow-white dust tail whose shape comes from integrating radiation-pressure acceleration along
// the comet's actual past orbit (particles share the nucleus' velocity at emission, so the tail curves along the orbit).
import * as THREE from 'three';
import { AU } from 'orion/core/units.js';
import { makeElements, elementsToPos } from 'orion/render/small/kepler.js';
import { rockGeometry, rockMaterial } from 'orion/render/small/rock.js';

export const COMET_DEFS = [
  { id: 'halley', name: 'Halley', aliases: ['1P/Halley', "Halley's Comet", 'Comet Halley'], radius: 5.5e3, scale: 1.0, axes: [8, 4, 4], albedo: 0.04,
    el: makeElements({ a: 17.92863504856923, e: 0.9679359956953211, iDeg: 162.1905300439129, omDeg: 59.09894720612437, wDeg: 112.2414314637764, tp: 2446469.973616146677 }),
    description: ['Short-period comet, 75–79 yr orbit, retrograde and steeply inclined.', 'Last perihelion 9 Feb 1986 at 0.59 AU; next in July 2061.', 'Nucleus about 15 × 8 × 8 km, among the darkest surfaces known.'], periodDays: 27728 },
  { id: 'hale-bopp', name: 'Hale–Bopp', aliases: ['C/1995 O1', 'Hale-Bopp', 'Comet Hale-Bopp'], radius: 3.0e4, scale: 2.6, axes: [30, 28, 26], albedo: 0.04,
    el: makeElements({ a: 177.4333839117583, e: 0.9949810027633206, iDeg: 89.28759424740302, omDeg: 282.7334213961641, wDeg: 130.4146670659176, tp: 2450537.134907143944 }),
    description: ['One of the brightest comets of the 20th century, visible to the naked eye for 18 months.', 'Perihelion 1 Apr 1997 at 0.91 AU; period about 2,400 yr, nearly polar orbit.', 'Nucleus roughly 60 km across with a huge, dusty coma.'], periodDays: 863279 },
  { id: '67p', name: '67P/Churyumov–Gerasimenko', aliases: ['67P', 'Churyumov-Gerasimenko', 'Rosetta comet', 'Chury'], radius: 1.65e3, scale: 0.35, axes: [2.6, 1.7, 1.2], albedo: 0.06, pinch: 0.28,
    el: makeElements({ a: 3.462249490129549, e: 0.6409081308996354, iDeg: 7.040294937543767, omDeg: 50.13557377155012, wDeg: 12.79824970228189, tp: 2457247.588657812098 }),
    description: ['Jupiter-family comet, 6.4 yr orbit; target of ESA’s Rosetta and the Philae lander.', 'Bi-lobed nucleus about 4.1 × 3.3 × 1.8 km; perihelion 1.24 AU.', 'Perihelion Aug 2015, Nov 2021, Apr 2028.'], periodDays: 2353.08 },
];

const ADD = { transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };

const COMMON_V = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uPxPerKm, uTime, uExpInv, uAct, uMaxPx;
varying float vA; varying vec3 vC;
float hh(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
`;
const SPRITE_F = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying float vA; varying vec3 vC;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float k = exp(-d * d * 3.6) * (1.0 - smoothstep(0.85, 1.0, d));
  gl_FragColor = vec4(vC * (k * vA), 0.0);
}`;

const COMA_V = COMMON_V + /* glsl */ `
uniform float uSizeKm; uniform vec3 uColor; uniform float uIntensity;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = uSizeKm * uPxPerKm / max(-mv.z, 1e-3);
  float cap = min(px, uMaxPx);
  gl_PointSize = max(cap, 2.0);
  vA = uIntensity * uExpInv * (cap / max(px, 1e-3)) ;   // keep total flux when the sprite is clamped
  vC = uColor;
  #include <logdepthbuf_vertex>
}`;

const ION_V = COMMON_V + /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uAnti, uP1, uP2; uniform float uLen;
void main() {
  float u = fract(aSeed.x + uTime * 0.012);                   // slow streaming away from the nucleus
  float s = pow(u, 1.25), dist = s * uLen;
  float wd = (0.008 + 0.03 * s) * uLen;
  vec2 g = (aSeed.yz - 0.5) * 2.0; g *= abs(g);
  vec3 off = wd * (g.x * uP1 + g.y * uP2);
  off += uLen * 0.012 * s * sin(s * 18.0 + aSeed.w * 6.28 + uTime * 0.5) * uP1;   // kinks
  vec3 p = uAnti * dist + off;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sizeKm = 2.5e4 + 0.035 * dist;
  float px = sizeKm * uPxPerKm / max(-mv.z, 1e-3), cap = min(px, uMaxPx);
  gl_PointSize = max(cap, 1.5);
  vA = 0.0147 * uAct * uExpInv * pow(1.0 - s, 1.5) * (cap / max(px, 1e-3)) * (cap < 1.5 * 1.0 ? 1.0 : 1.0) * (0.4 + 0.6 * smoothstep(0.0, 0.08, s));
  vC = vec3(0.30, 0.55, 1.0);
  #include <logdepthbuf_vertex>
}`;

const DUST_V = COMMON_V + /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uDust[16];            // radiation-pressure displacement (km, β = 1) at ages tau_j = tauMax · j / 15
void main() {
  float u = aSeed.x;
  float f = clamp(u, 0.0, 0.9999) * 15.0;
  int j = int(floor(f));
  vec3 d = mix(uDust[j], uDust[j + 1], f - float(j));
  float beta = 0.10 + 0.90 * pow(aSeed.y, 1.7);
  vec3 sp = (vec3(aSeed.z, aSeed.w, hh(aSeed.x * 91.7 + aSeed.y * 13.1)) - 0.5) * 2.0;
  vec3 p = d * beta + sp * (1.5e4 + 0.05 * length(d) * beta);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sizeKm = 4e4 + 0.07 * length(p);
  float px = sizeKm * uPxPerKm / max(-mv.z, 1e-3), cap = min(px, uMaxPx);
  gl_PointSize = max(cap, 1.5);
  vA = 0.0175 * uAct * uExpInv * pow(1.0 - u, 1.1) * (0.35 + 0.65 * beta) * (cap / max(px, 1e-3));
  vC = vec3(1.0, 0.78, 0.42);
  #include <logdepthbuf_vertex>
}`;

function seedGeom(n, seed) {
  let s = seed;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const a = new Float32Array(n * 4), g = new THREE.BufferGeometry();
  for (let i = 0; i < n * 4; i++) a[i] = r();
  g.setAttribute('aSeed', new THREE.BufferAttribute(a, 4)); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  return g;
}

const MU_SUN = 1.32712440018e20; // m^3/s^2

export function createComets(app, orbits) {
  const comets = [];
  for (const def of COMET_DEFS) {
    const group = new THREE.Group(); group.name = 'comet-' + def.id; group.visible = false;
    const baseU = () => ({ uPxPerKm: { value: 1 }, uTime: { value: 0 }, uExpInv: { value: 1 }, uAct: { value: 0 }, uMaxPx: { value: 160 } });
    const coma = new THREE.Points(seedGeom(1, 3), new THREE.ShaderMaterial({ vertexShader: COMA_V, fragmentShader: SPRITE_F, ...ADD,
      uniforms: { ...baseU(), uSizeKm: { value: 1e5 }, uColor: { value: new THREE.Vector3(0.62, 0.95, 0.80) }, uIntensity: { value: 0.3 }, uMaxPx: { value: 380 } } }));
    const nucPt = new THREE.Points(seedGeom(1, 5), new THREE.ShaderMaterial({ vertexShader: COMA_V, fragmentShader: SPRITE_F, ...ADD,
      uniforms: { ...baseU(), uSizeKm: { value: 1 }, uColor: { value: new THREE.Vector3(1, 0.95, 0.85) }, uIntensity: { value: 0.35 } } }));
    const ion = new THREE.Points(seedGeom(12000, 17), new THREE.ShaderMaterial({ vertexShader: ION_V, fragmentShader: SPRITE_F, ...ADD,
      uniforms: { ...baseU(), uAnti: { value: new THREE.Vector3(1, 0, 0) }, uP1: { value: new THREE.Vector3(0, 1, 0) }, uP2: { value: new THREE.Vector3(0, 0, 1) }, uLen: { value: 1e7 } } }));
    const dust = new THREE.Points(seedGeom(14000, 29), new THREE.ShaderMaterial({ vertexShader: DUST_V, fragmentShader: SPRITE_F, ...ADD,
      uniforms: { ...baseU(), uDust: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) } } }));
    const rockMat = rockMaterial({ albedo: [def.albedo, def.albedo * 0.95, def.albedo * 0.9], bump: 2.5 / def.radius * 1000 / 1000 * 1, seed: def.radius % 7 });
    rockMat.uniforms.uBump.value = 3 / (def.radius / 1000);
    const rock = new THREE.Mesh(rockGeometry({ axes: def.axes, seed: def.radius % 11, subdiv: 5, rough: 0.12, pinch: def.pinch || 0, craters: 5 }), rockMat);
    for (const o of [coma, nucPt, ion, dust, rock]) { o.frustumCulled = false; group.add(o); }
    coma.renderOrder = ion.renderOrder = dust.renderOrder = nucPt.renderOrder = 7;
    app.layers.system.add(group);
    const c = { def, group, coma, nucPt, ion, dust, rock, rockMat, pos: new Float64Array(3), tmp: new Float64Array(3) };
    comets.push(c);
    c.positionFn = (jd, out) => elementsToPos(def.el, jd, out);
    if (orbits) orbits.addElementsLine(def.id, def.el);
  }

  const anti = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  const TAU_MAX_D = 45, STEPS = 45, tmp = new Float64Array(3);
  const acc = new Float64Array(STEPS + 1), cum = new Float64Array((STEPS + 1) * 3);

  function update(frame) {
    const pxPerKm = frame.viewport.h / (2 * Math.tan((frame.fovY * Math.PI) / 360));
    const expInv = 1 / Math.max(frame.exposure?.sys ?? 1, 1e-6);
    for (const c of comets) {
      c.positionFn(frame.jd, c.pos);
      const rM = Math.hypot(c.pos[0], c.pos[1], c.pos[2]), rAU = rM / AU;
      const dx = c.pos[0] - frame.camPos[0], dy = c.pos[1] - frame.camPos[1], dz = c.pos[2] - frame.camPos[2];
      const distKm = Math.hypot(dx, dy, dz) / 1000;
      const near = distKm < 4e9 * Math.max(1, c.def.scale);
      c.group.visible = near && frame.levels[3] > 0.01;
      if (!c.group.visible) continue;
      app.toSystem(c.pos, c.group.position);
      const A = Math.min(1, Math.max(0, (5 - rAU) / 4.2)) ** 1.6 * 1.0;       // activity: switches on inside ~5 AU
      const act = A * c.def.scale, active = A > 0.01;
      const sc = Math.sqrt(c.def.scale);
      const U = (o) => o.material.uniforms;
      for (const o of [c.coma, c.nucPt, c.ion, c.dust]) { const u = U(o); u.uPxPerKm.value = pxPerKm; u.uTime.value = frame.time; u.uExpInv.value = expInv; }
      // nucleus: rock mesh once resolved, glint point otherwise
      const angPx = (c.def.radius / 1000 / Math.max(distKm, 1e-3)) * pxPerKm;
      c.rock.visible = angPx > 0.8;
      c.nucPt.visible = angPx < 4;
      if (c.rock.visible) {
        c.rockMat.uniforms.uSunDir.value.set(-c.pos[0], -c.pos[1], -c.pos[2]).normalize();
        c.rockMat.uniforms.uSunE.value = (AU / Math.max(rM, 1e9)) ** 2;
        c.rock.rotation.set(0.4, (frame.jd * 24 / 12.4) * Math.PI * 2, 0.2);
      }
      U(c.nucPt).uSizeKm.value = 1; U(c.nucPt).uIntensity.value = 0.25 * Math.min(1, 1.5 / Math.max(rAU, 0.3)) ;
      c.coma.visible = c.ion.visible = c.dust.visible = active;
      if (!active) continue;
      U(c.coma).uSizeKm.value = (4e4 + 2e5 * A * sc) * 2; U(c.coma).uIntensity.value = 0.13 * A * Math.min(1.6, sc);
      anti.set(c.pos[0], c.pos[1], c.pos[2]).normalize();                   // anti-sunward = away from the Sun along r̂
      p1.crossVectors(anti, up); if (p1.lengthSq() < 1e-6) p1.set(1, 0, 0); p1.normalize(); p2.crossVectors(anti, p1).normalize();
      const iu = U(c.ion); iu.uAnti.value.copy(anti); iu.uP1.value.copy(p1); iu.uP2.value.copy(p2);
      iu.uLen.value = 8e7 * A * sc * (0.5 + 0.5 / Math.max(rAU, 0.5) ** 0.3); iu.uAct.value = act * 1.3;
      // Dust: Δ(τ) = ∫ u · a(t − u) du with a = β μ / r² r̂ (β = 1); sampled at 16 ages.
      const dt = (TAU_MAX_D * 86400) / STEPS;
      for (let k = 0; k <= STEPS; k++) {
        c.positionFn(frame.jd - (k * TAU_MAX_D) / STEPS, tmp);
        const r = Math.hypot(tmp[0], tmp[1], tmp[2]), g = MU_SUN / (r * r);
        const ux = k * dt; // seconds before now
        acc[k] = ux;
        cum[k * 3] = (tmp[0] / r) * g; cum[k * 3 + 1] = (tmp[1] / r) * g; cum[k * 3 + 2] = (tmp[2] / r) * g;
      }
      // integrate (trapezoid) u·a(u) → store displacement at every 3rd step into uDust
      let sx = 0, sy = 0, sz = 0;
      const du = U(c.dust).uDust.value;
      du[0].set(0, 0, 0);
      for (let k = 1; k <= STEPS; k++) {
        const w0 = acc[k - 1], w1 = acc[k];
        sx += 0.5 * dt * (w0 * cum[(k - 1) * 3] + w1 * cum[k * 3]);
        sy += 0.5 * dt * (w0 * cum[(k - 1) * 3 + 1] + w1 * cum[k * 3 + 1]);
        sz += 0.5 * dt * (w0 * cum[(k - 1) * 3 + 2] + w1 * cum[k * 3 + 2]);
        if (k % 3 === 0) du[k / 3].set(sx / 1000, sy / 1000, sz / 1000);
      }
      U(c.dust).uAct.value = act * 1.4;
    }
  }
  return { update, comets };
}
