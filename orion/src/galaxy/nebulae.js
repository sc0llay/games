import * as THREE from 'three';
import { VOL_GLSL, EXT_GLSL } from 'orion/galaxy/volume.js';

// Procedural deep-sky nebulae (spec §11): one camera-facing billboard per catalogue nebula, planetary nebula and
// supernova remnant (plus the Pleiades reflection nebulosity), drawn live in the sky layer with a morphology per class:
//  0 blister HII region (M42, Lagoon, Eagle, Carina …): Hα cloud with an OIII core, dark dust lanes / pillars
//  1 shell HII region (Rosette): Hα annulus around a cavity
//  2 planetary nebula (Ring, Helix, Dumbbell …): OIII interior, Hα/NII rim, Helix-style radial knots
//  3 supernova remnant (Crab): Hα filament network around a bluish synchrotron core
//  4 SNR / superbubble arcs (Veil, Barnard's Loop, Gum): thin filamentary arcs
//  5 blue reflection nebula (Pleiades): streaky blue wisps
// Colours: Hα (656 nm) red-pink, OIII (501 nm) teal. Surface brightness is in sky units (mag-0 star peak ≈ 3) and is
// distance-independent while resolved; below ~2 px the billboard keeps a minimum size with its energy conserved.
// Dust between the camera and the nebula dims and reddens it (segTau, same model as the stars).

const HERO = {
  'orion-nebula': { cls: 0, sb: 1.7, oiii: 0.45, dust: 0.45, elong: 1.15, ang: 20, core: 1.0, bay: 1 },
  'de-mairans-nebula': { cls: 0, sb: 0.8, oiii: 0.2, dust: 0.5, elong: 1.1, ang: 0 },
  'lagoon-nebula': { cls: 0, sb: 1.0, oiii: 0.18, dust: 0.65, elong: 1.9, ang: 75, core: 0.7 },
  'eagle-nebula': { cls: 0, sb: 0.55, oiii: 0.3, dust: 0.95, elong: 1.2, ang: 10, pillars: 1 },
  'carina-nebula': { cls: 0, sb: 1.5, oiii: 0.3, dust: 0.85, elong: 1.35, ang: 40, core: 0.8 },
  'omega-nebula': { cls: 0, sb: 1.2, oiii: 0.2, dust: 0.5, elong: 1.7, ang: 30 },
  'trifid-nebula': { cls: 0, sb: 0.6, oiii: 0.1, dust: 0.9, elong: 1.0, ang: 0, lanes3: 1 },
  'north-america-nebula': { cls: 0, sb: 0.22, oiii: 0.05, dust: 0.8, elong: 1.2, ang: 0 },
  'rosette-nebula': { cls: 1, sb: 0.35, oiii: 0.25, dust: 0.4, elong: 1.05, ang: 0, hole: 0.38 },
  'crab-nebula': { cls: 3, sb: 0.7, oiii: 0.0, dust: 0, elong: 1.4, ang: 35 },
  'ring-nebula': { cls: 2, sb: 2.0, oiii: 0.8, dust: 0, elong: 1.25, ang: 60, hole: 0.45 },
  'helix-nebula': { cls: 2, sb: 0.25, oiii: 0.55, dust: 0, elong: 1.1, ang: 30, hole: 0.4, knots: 1 },
  'dumbbell-nebula': { cls: 2, sb: 1.0, oiii: 0.7, dust: 0, elong: 1.35, ang: 30, hole: 0.0, bipolar: 1 },
  'veil-nebula': { cls: 4, sb: 0.12, oiii: 0.5, dust: 0, elong: 1.2, ang: 0 },
  'c33': { cls: 4, sb: 0.12, oiii: 0.5, dust: 0, elong: 1.0, ang: 80 },
  'c34': { cls: 4, sb: 0.12, oiii: 0.5, dust: 0, elong: 1.0, ang: 200 },
  'ic-443': { cls: 4, sb: 0.08, oiii: 0.2, dust: 0, elong: 1.1, ang: 0 },
  'barnards-loop': { cls: 4, sb: 0.018, oiii: 0.0, dust: 0, elong: 1.3, ang: 0, arc: 1 },
  'gum-nebula': { cls: 4, sb: 0.01, oiii: 0.0, dust: 0, elong: 1.0, ang: 0 },
  pleiades: { cls: 5, sb: 0.15, oiii: 0, dust: 0, elong: 1.3, ang: 20, radiusPc: 2.2 },   // distance: DIST_OVERRIDE in index.js
  'ngc-1499': { cls: 0, sb: 0.15, oiii: 0.0, dust: 0.4, elong: 3.0, ang: 10 },
  'ic-1805': { cls: 1, sb: 0.3, oiii: 0.15, dust: 0.5, elong: 1.1, ang: 0, hole: 0.3 },
  'ic-1848': { cls: 1, sb: 0.25, oiii: 0.15, dust: 0.5, elong: 1.4, ang: 0, hole: 0.25 },
  'ic-434': { cls: 0, sb: 0.2, oiii: 0.0, dust: 0.7, elong: 1.4, ang: 0 },
};
// Dark nebulae: represented by the extinction model (Coalsack) or by the dust inside their parent region.
const DARK = new Set(['coalsack', 'c99', 'horsehead-nebula']);
const TYPES = new Set(['nebula', 'planetary', 'snr']);

const VERT = /* glsl */ `
${VOL_GLSL}
${EXT_GLSL}
attribute vec3 aPos;     // camera-relative position (pc, world axes) – updated per frame
attribute vec3 aGal;     // galaxy-frame position (pc), for extinction
attribute vec4 aA;       // radius (pc), surface brightness, class, seed
attribute vec4 aB;       // oiii fraction, dust, elongation, angle (rad)
attribute vec4 aC;       // hole, flags (1 pillars, 2 three lanes, 4 knots, 8 bipolar, 16 arc, 32 dark bay + bar), core, 0
uniform vec3 uCamG, uDust;
uniform float uPxPerRad, uGain, uMinPx;
varying vec2 vP;
varying vec4 vA, vB, vC;
varying vec3 vTint;
varying float vI;
void main() {
  float d = length(aPos), R = aA.x;
  float pxR = R / max(d, 1e-6) * uPxPerRad;
  float scale = max(1.0, uMinPx / max(pxR, 1e-6));
  float inten = uGain / (scale * scale);
  // fade out when the camera is inside (the billboard would sweep past) and when hopelessly unresolved
  inten *= smoothstep(0.6 * R, 1.6 * R, d) * smoothstep(0.02, 0.15, pxR);
  if (inten < 1e-5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 dir = aPos / d;
  vec3 e1 = normalize(abs(dir.z) > 0.98 ? cross(dir, vec3(1.0, 0.0, 0.0)) : cross(dir, vec3(0.0, 0.0, 1.0)));
  vec3 e2 = cross(e1, dir);
  float ca = cos(aB.w), sa = sin(aB.w);
  vec2 c = position.xy * 1.35 * vec2(aB.z, 1.0);   // stretched along x by the elongation so the fragment's falloff fits
  vec2 cr = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
  vec3 w = aPos + (e1 * cr.x + e2 * cr.y) * R * scale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
  vec3 tr = exp(-segTau(uCamG, aGal) * uDust);
  vP = c; vA = aA; vB = aB; vC = aC; vTint = tr; vI = inten;
}`;

const FRAG = /* glsl */ `
varying vec2 vP;
varying vec4 vA, vB, vC;
varying vec3 vTint;
varying float vI;
float h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = mat2(1.6, -1.2, 1.2, 1.6) * p + 7.3; a *= 0.5; } return s / 0.97; }
float ridged(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * (1.0 - abs(2.0 * vn(p) - 1.0)); p = mat2(1.6, -1.2, 1.2, 1.6) * p + 3.1; a *= 0.5; } return s / 0.94; }
const vec3 HA = vec3(1.0, 0.16, 0.26), OIII = vec3(0.12, 0.85, 0.75), NII = vec3(1.0, 0.25, 0.18), BLUE = vec3(0.45, 0.62, 1.0);
bool flag(float f, float b) { return mod(floor(f / b), 2.0) > 0.5; }
void main() {
  float cls = vA.z, seed = vA.w * 97.0, oiii = vB.x, dust = vB.y, el = vB.z, hole = vC.x, fl = vC.y;
  vec2 p = vec2(vP.x / el, vP.y);
  float r = length(p);
  if (r > 1.35) discard;
  vec3 c = vec3(0.0);
  vec2 q = p * 2.2 + seed;
  if (cls < 0.5) {                                           // blister HII region
    float n = fbm(q), n2 = fbm(q * 2.3 + 4.1);
    float body = exp(-pow(r / (0.55 + 0.25 * n), 2.0) * 1.6);
    float wisps = smoothstep(0.35, 0.8, ridged(q * 1.3 + n)) * exp(-r * r * 1.4);
    float em = body * (0.35 + 0.9 * n2) + 0.55 * wisps;
    vec2 pc = p - vec2(0.06, 0.08);                          // ionising cluster sits off-centre (blister geometry)
    float core = exp(-dot(pc, pc) / max(0.012 * (vC.z + 0.2), 0.002));
    // brightness is mostly structure: ridged fronts brighten toward the cluster, smooth fill stays modest
    float fronts = smoothstep(0.5, 0.9, ridged(q * 2.4 + n * 1.5)) * exp(-dot(pc, pc) * 3.0);
    em = em * (1.0 - 0.2 * vC.z) + 0.9 * fronts * vC.z;
    vec3 col = HA * em + OIII * oiii * (exp(-dot(pc, pc) * 9.0) * (0.35 + 0.9 * n2) + 0.5 * core) + vec3(1.0, 0.92, 0.85) * core * 0.45 * vC.z;
    if (flag(fl, 32.0)) {                                    // M42: Orion Bar (bright ridge) + dark "fish mouth" bay
      float bar = exp(-pow((dot(pc, vec2(0.7, 0.71)) + 0.2 + 0.04 * n) / 0.035, 2.0)) * smoothstep(0.55, 0.1, abs(dot(pc, vec2(-0.71, 0.7))));
      col += (HA * 0.8 + OIII * 0.3) * bar * 1.4;
    }
    // dust: lanes, bays and pillars in absorption
    float dl = smoothstep(0.42, 0.68, fbm(q * 0.9 + 11.0)) * dust;
    if (flag(fl, 32.0)) {
      vec2 b = p - vec2(-0.12, 0.34);                      // bay: dark tongue reaching in toward the cluster from the NE
      float tongue = smoothstep(0.16, 0.04, abs(b.x + 0.25 * b.y) + 0.06 * fbm(q * 3.0)) * smoothstep(-0.25, 0.05, b.y) * smoothstep(0.55, 0.2, b.y);
      dl = max(dl, tongue * 0.9);
    }
    if (flag(fl, 1.0)) {                                     // three dark pillars rising from the lower edge, lit rims
      float pil = 0.0, rim = 0.0;
      for (int k = 0; k < 3; k++) {
        // tallest/widest on the left; tapered, gently bent columns with lumpy edges and rounded, lit heads
        float fk = float(k), x0 = -0.3 + 0.25 * fk + 0.03 * fk * fk, top = 0.32 - 0.24 * fk + 0.03 * fk * fk, w0 = 0.075 - 0.016 * fk;
        float h = clamp((top - p.y) / (top + 0.95), 0.0, 1.0);                 // 0 at the head, 1 at the base
        float xc = x0 + 0.16 * (top - p.y) + 0.05 * sin(p.y * 4.0 + fk * 2.0) * h + 0.05 * (fbm(vec2(p.y * 3.0, fk * 5.1) + seed) - 0.5);
        float w = w0 * (0.85 + 1.5 * h * h);
        float edge = 0.45 * w * (fbm(p * 18.0 + fk * 9.0 + seed) - 0.5) + 0.25 * w * (vn(p * 45.0 + fk) - 0.5);
        float dx = abs(p.x - xc) + edge;
        vec2 hd = vec2(p.x - (x0 + 0.01), (p.y - top + w0 * 0.6) * 1.15);    // rounded head
        float body = smoothstep(w, 0.6 * w, dx) * step(p.y, top - w0 * 0.6);
        float head = smoothstep(w0 * 1.05, w0 * 0.6, length(hd) + 0.3 * w0 * (fbm(p * 22.0 + fk) - 0.5));
        float m = max(body, head) * smoothstep(-1.1, -0.8, p.y);
        pil = max(pil, m);
        // photo-evaporating skin: bright rim on the side facing the cluster (up/right), strongest at the head
        float skin = smoothstep(0.0, 0.3, m) * smoothstep(0.85, 0.35, m);
        rim += skin * (0.35 + 0.65 * smoothstep(top - 0.35, top, p.y)) * (0.6 + 0.4 * sign(p.x - xc + 0.3 * w));
        // evaporating gas streamers off the head
        rim += 0.25 * exp(-length(hd - vec2(0.0, 0.08)) / (0.6 * w0)) * smoothstep(0.0, 0.2, hd.y);
      }
      dl = max(dl, pil * 0.96); col += (HA * 0.9 + OIII * 0.15) * rim * 0.7;
    }
    if (flag(fl, 2.0)) { float a = atan(p.y, p.x); float lane = smoothstep(0.12, 0.0, abs(fract(a / 2.0944 + 0.1) - 0.5) * r * 3.0 - 0.02); dl = max(dl, lane * step(0.05, r) * 0.95); }
    c = col * (1.0 - dl);
  } else if (cls < 1.5) {                                    // shell HII region
    float n = fbm(q), n2 = fbm(q * 2.7 + 2.0);
    float sh = smoothstep(hole * 0.7, hole + 0.15, r + 0.12 * n) * exp(-pow(max(r - 0.55, 0.0) * 2.4, 2.0));
    float em = sh * (0.3 + 1.0 * n2) * (1.0 - dust * smoothstep(0.45, 0.7, fbm(q * 1.4 + 9.0)));
    c = HA * em + OIII * oiii * sh * (1.0 - r) * 0.8;
  } else if (cls < 2.5) {                                    // planetary nebula
    float n = fbm(q * 1.5);
    float rr = r;
    if (flag(fl, 8.0)) rr = length(vec2(p.x * (0.6 + 0.9 * abs(p.y)), p.y * 0.85));   // bipolar "apple core"
    float rim = exp(-pow((rr - (hole + 0.35) * 0.8) / 0.18, 2.0)) * (0.6 + 0.6 * n);
    float inner = smoothstep(0.75, 0.05, rr) * (0.6 + 0.4 * n);
    c = OIII * oiii * inner * 0.9 + (HA * 0.6 + NII * 0.4) * rim * 1.1 + OIII * oiii * rim * 0.25;
    if (hole > 0.01) c *= mix(1.0, 0.25 + 0.75 * smoothstep(0.0, hole * 0.8, rr), 0.6);
    if (flag(fl, 4.0)) {                                     // cometary knots: bright head, faint tail pointing away from the star
      float a = atan(p.y, p.x), kk = 0.0;
      for (int row = 0; row < 3; row++) {
        float fr = float(row), NA = 46.0 + 18.0 * fr;
        float cell = floor((a + 3.14159) / 6.28318 * NA + 0.5 * fr), u = (a + 3.14159) / 6.28318 * NA + 0.5 * fr - cell - 0.5;
        float rnd = h2(vec2(cell, fr * 13.0 + seed)), rk = 0.34 + 0.07 * fr + 0.16 * h2(vec2(cell + 7.0, fr + seed));
        if (rnd < 0.4) continue;
        float dt = u * 6.28318 / NA * rr, dr = rr - rk, s0 = 0.009 + 0.007 * rnd;
        float head = exp(-(dt * dt + dr * dr) / (s0 * s0));
        float tl = max(dr, 0.0), tw = s0 * (0.7 + 5.0 * tl);
        float tail = exp(-dt * dt / (tw * tw)) * exp(-tl / (0.035 + 0.07 * rnd * rnd)) * step(0.0, dr) * 0.45;
        kk += head + tail;
      }
      c = c * (1.0 - 0.25 * min(kk, 1.0)) + (HA * 0.85 + NII * 0.3) * kk * smoothstep(0.28, 0.4, rr) * 1.3;
    }
    c += vec3(0.8, 0.85, 1.0) * exp(-r * r * 4000.0) * 3.0;   // central white dwarf
  } else if (cls < 3.5) {                                    // Crab-like remnant
    vec2 w = p + 0.22 * (vec2(fbm(q * 1.1), fbm(q * 1.1 + 5.2)) - 0.5);    // warped so the cage is irregular
    float rw = length(w), env = smoothstep(1.0, 0.55, rw);
    float fil = pow(ridged(w * 5.5 + seed), 5.0) * env;                    // thin filament network
    float syn = exp(-rw * rw * 4.0) * (0.75 + 0.25 * fbm(q * 3.0));     // synchrotron nebula, bluish-white
    c = (HA * 0.75 + vec3(1.0, 0.55, 0.18) * 0.55) * fil * 2.2 + vec3(0.62, 0.72, 1.0) * syn * 0.5;
  } else if (cls < 4.5) {                                    // filamentary arcs
    float a = atan(p.y, p.x);
    float ring = exp(-pow((r - 0.85 - 0.08 * fbm(vec2(a * 3.0, 0.0) + seed)) / 0.07, 2.0));
    float fil = smoothstep(0.6, 0.95, ridged(vec2(a * 6.0, r * 14.0) + seed));
    float gap = smoothstep(0.25, 0.6, fbm(vec2(a * 1.5, 1.0) + seed));
    if (flag(fl, 16.0)) gap *= smoothstep(-0.2, 0.4, -p.x);
    c = (HA * (1.0 - oiii) + OIII * oiii) * ring * (0.4 + 1.2 * fil) * gap;
  } else {                                                   // reflection nebula
    vec2 s = vec2(p.x * 0.4, p.y * 2.5) * 2.0 + seed;
    float w = fbm(s) * fbm(q * 1.7);
    c = BLUE * smoothstep(0.12, 0.55, w) * exp(-r * r * 1.3) * 1.6;
  }
  c *= smoothstep(1.32, 0.7, r);                              // soft edge well inside the quad
  gl_FragColor = vec4(c * vA.y * vI * vTint, 1.0);
}`;

const PCm = 3.0856775814913673e16;

export class Nebulae {
  // items: deep-sky catalogue entries; worldM(d) -> Float64 world position in metres; galOf(world) -> galaxy pc.
  constructor(shared, deep, worldOf, galOf) {
    const list = [];
    for (const d of deep) {
      if (DARK.has(d.id)) continue;
      const hero = HERO[d.id];
      if (!hero && !TYPES.has(d.type)) continue;
      if (d.distPc > 20000) continue;               // extragalactic (Tarantula): left to the LMC billboard
      list.push({ d, hero });
    }
    const n = list.length;
    this.n = n; this.ids = new Set(list.map((x) => x.d.id));
    this.worldM = new Float64Array(n * 3);
    this.radiusPc = new Float32Array(n);
    const pos = new Float32Array(n * 3), gal = new Float32Array(n * 3), A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 4);
    list.forEach(({ d, hero }, i) => {
      const w = worldOf(hero?.distPc ? { ...d, distPc: hero.distPc } : d); this.worldM.set(w, i * 3);
      const g = galOf(w); gal.set(g, i * 3);
      const rnd = hash(d.id);
      const p = hero || (d.type === 'planetary'
        ? { cls: 2, sb: 0.7, oiii: 0.6 + 0.3 * rnd(), dust: 0, elong: 1 + 0.4 * rnd(), ang: 360 * rnd(), hole: 0.2 + 0.3 * rnd() }
        : d.type === 'snr' ? { cls: 4, sb: 0.08, oiii: 0.3 * rnd(), dust: 0, elong: 1 + 0.3 * rnd(), ang: 360 * rnd() }
          : { cls: 0, sb: 0.25 + 0.4 * rnd(), oiii: 0.25 * rnd(), dust: 0.3 + 0.5 * rnd(), elong: 1 + 0.8 * rnd(), ang: 360 * rnd(), core: 0.3 * rnd() });
      const R = p.radiusPc || Math.max((d.sizePc || 1) / 2, 0.05);
      const flags = (p.pillars ? 1 : 0) + (p.lanes3 ? 2 : 0) + (p.knots ? 4 : 0) + (p.bipolar ? 8 : 0) + (p.arc ? 16 : 0) + (p.bay ? 32 : 0);
      this.radiusPc[i] = R;
      A.set([R, p.sb, p.cls, rnd()], i * 4);
      B.set([p.oiii, p.dust, p.elong, (p.ang || 0) * Math.PI / 180], i * 4);
      C.set([p.hole || 0, flags, p.core || 0, 0], i * 4);
    });
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index; geo.setAttribute('position', base.attributes.position);
    this.posAttr = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.posAttr);
    geo.setAttribute('aGal', new THREE.InstancedBufferAttribute(gal, 3));
    geo.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4));
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 4));
    geo.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 4));
    geo.instanceCount = n; geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    this.u = { uCamG: { value: new THREE.Vector3() }, uPxPerRad: { value: 1000 }, uGain: { value: 1 }, uMinPx: { value: 2.0 } };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { tVol: shared.tVol, tPlane: shared.tPlane, tPlaneIn: shared.tPlaneIn, uPin: shared.uPin, uCloudP: shared.uCloudP, uCloudA: shared.uCloudA, uCloudOn: shared.uCloudOn, uDust: shared.uDust, ...this.u },
      transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
  }
  update(frame, camG, gain) {
    const a = this.posAttr.array, w = this.worldM, c = frame.camPos;
    for (let i = 0; i < this.n; i++) {
      a[i * 3] = (w[i * 3] - c[0]) / PCm; a[i * 3 + 1] = (w[i * 3 + 1] - c[1]) / PCm; a[i * 3 + 2] = (w[i * 3 + 2] - c[2]) / PCm;
    }
    this.posAttr.needsUpdate = true;
    this.u.uCamG.value.set(camG[0], camG[1], camG[2]);
    this.u.uPxPerRad.value = frame.viewport.h / (2 * Math.tan(frame.fovY * Math.PI / 360));
    this.u.uGain.value = gain;
  }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
