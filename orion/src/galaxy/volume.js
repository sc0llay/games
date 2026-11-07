import * as THREE from 'three';
import { VOL, PLANE, P, COLORS as C, PHI, PHI_SPHEROID, DUST_RGB, CLOUDS } from 'orion/galaxy/model.js';

// Galaxy volume (spec §07/§11). The analytic model is baked in workers into two textures:
//  * tPlane – 2D RGBA16F map of the mid-plane values of the thin, separable components (old thin disc, young stars,
//    HII gas, dust extinction 1/pc), linear over ±PLANE.RMAX (≈ 20 pc/texel at 2048²);
//  * tVol   – coarse 3D RGBA16F texture of the round components (rgb = thick disc + bulge + bar + halo colour, a = nuclear
//    disc) on a cylindrically warped grid.
// The raymarch takes adaptive steps (short near the mid-plane and the bulge, growing with distance) and integrates the
// sech² vertical profiles of the thin components ANALYTICALLY inside each step, so face-on and edge-on views keep sharp
// dust lanes and star-forming knots with ~30–100 steps. The nearby dark clouds (Great Rift, Coalsack …) are analytic
// Gaussian ellipsoids whose line integrals are closed-form (erf). Stars and billboards use the same functions (segTau)
// to extinguish their light along their own line of sight.

// Radiance scale: sky unit = UKV * (model density-units * pc). Fixed so the l=90 band reads about 0.07.
export const UKV = 2.5e-5;
export const MAX_CLOUDS = 16;
const f3 = (v) => `vec3(${v.map((x) => x.toFixed(4)).join(', ')})`;

export const VOL_GLSL = /* glsl */ `
precision highp sampler3D;
uniform sampler3D tVol;
uniform sampler2D tPlane, tPlaneIn;
uniform float uPin;   // half-size (pc) of the high-resolution central inset of the plane map; 0 until baked
uniform vec4 uCloudP[${MAX_CLOUDS}];
uniform mat3 uCloudA[${MAX_CLOUDS}];
uniform float uCloudOn;
const float RMAX = ${VOL.RMAX.toFixed(1)}, ZMAX = ${VOL.ZMAX.toFixed(1)}, ZA = ${VOL.ZA.toFixed(2)}, RPOW = ${VOL.RPOW.toFixed(2)};
const float SINH_ZA = ${Math.sinh(VOL.ZA).toFixed(5)}, PRMAX = ${PLANE.RMAX.toFixed(1)};
const float THINZ = ${P.thinZ.toFixed(1)}, YOUNGZ = ${P.youngZ.toFixed(1)}, HIIZ = ${P.hiiZ.toFixed(1)}, DUSTZ = ${P.dustZ.toFixed(1)};
const float WARPR = ${P.warpR.toFixed(1)}, WARPA = ${P.warpA.toExponential(4)};
const int NCLOUD = ${Math.min(CLOUDS.length, MAX_CLOUDS)};
// galaxy-frame pc -> spheroid texture coordinate (inverse of volumeToGalaxy)
vec3 volCoord(vec3 g) {
  float r = length(g.xy) / RMAX;
  vec2 q = r > 1e-6 ? g.xy / RMAX * (pow(r, RPOW) / r) : vec2(0.0);
  float a = g.z / ZMAX * SINH_ZA;
  float w = log(a + sqrt(a * a + 1.0)) / ZA;
  return vec3(q * 0.5 + 0.5, clamp(w * 0.5 + 0.5, 0.0, 1.0));
}
vec4 volFetch(vec3 g) { return texture(tVol, volCoord(g)); }
vec4 planeFetch(vec2 xy) {
  vec4 a = texture(tPlane, xy / (2.0 * PRMAX) + 0.5);
  float m = max(abs(xy.x), abs(xy.y));
  if (m < uPin) a = mix(a, texture(tPlaneIn, xy / (2.0 * uPin) + 0.5), smoothstep(uPin, 0.85 * uPin, m));   // CMZ detail
  return a;
}
// scale-height factor of the young / gas / dust layers and the warped mid-plane (mirrors model.js zfac / warpZ)
float zfacG(float R) { return (0.35 + 0.65 * smoothstep(100.0, 1000.0, R)) * (1.0 + 0.8 * smoothstep(9000.0, 18000.0, R)); }
float warpG(vec2 xy) { float R = length(xy) + 1e-3, e = max(R - WARPR, 0.0); return WARPA * e * e * xy.y / R; }
// mean of sech²(z/h) over the straight segment z0 -> z1
float vavg(float z0, float z1, float h) {
  float dz = z1 - z0;
  if (abs(dz) < 0.05 * h) { float c = 1.0 / cosh(clamp(0.5 * (z0 + z1) / h, -40.0, 40.0)); return c * c; }
  return h * (tanh(z1 / h) - tanh(z0 / h)) / dz;
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float erfA(float x) { float s = sign(x), x2 = x * x; return s * sqrt(1.0 - exp(-x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2))); }
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Optical depth (V) of dark cloud i along a -> a + d (closed-form Gaussian line integral, textured by noise around the
// point of closest approach). tc returns the segment parameter of that point.
float cloudSeg(int i, vec3 a, vec3 d, out float tc) {
  vec4 c = uCloudP[i]; mat3 A = uCloudA[i];
  vec3 qa = A * (a - c.xyz), qd = A * d;
  float al = dot(qd, qd), be = dot(qd, qa), ga = dot(qa, qa);
  tc = -be / max(al, 1e-20);
  float m = ga - be * tc;
  if (m > 24.0 || al < 1e-20) return 0.0;
  float k = sqrt(0.5 * al);
  float I = exp(-0.5 * m) * 0.8862269 / k * (erfA(k * (1.0 - tc)) - erfA(-k * tc));
  vec3 q = qa + qd * clamp(tc, 0.0, 1.0) + float(i) * 7.31;
  float n = vn3(q * 2.2) * 0.65 + vn3(q * 5.3 + 3.7) * 0.35;
  return c.w * length(d) * I * (0.15 + 1.7 * n * n * 1.6);
}
`;

// Extinction along a segment a -> b (galaxy pc). Returns optical depth (V).
export const EXT_GLSL = /* glsl */ `
float segTau(vec3 a, vec3 b) {
  const float ZC = 900.0;
  vec3 d = b - a;
  float tau = 0.0;
  if (uCloudOn > 0.01) { float tc; for (int i = 0; i < NCLOUD; i++) tau += cloudSeg(i, a, d, tc); tau *= uCloudOn; }
  float s0 = 0.0, s1 = 1.0;
  if (abs(d.z) < 1e-4) { if (abs(a.z) > ZC) return tau; }
  else {
    float t0 = (-ZC - a.z) / d.z, t1 = (ZC - a.z) / d.z;
    s0 = max(s0, min(t0, t1)); s1 = min(s1, max(t0, t1));
    if (s1 <= s0) return tau;
  }
  float L = length(d) * (s1 - s0) / 6.0;
  for (int i = 0; i < 6; i++) {
    vec3 pa = a + d * mix(s0, s1, float(i) / 6.0), pb = a + d * mix(s0, s1, float(i + 1) / 6.0), pm = 0.5 * (pa + pb);
    float zw = warpG(pm.xy), h = DUSTZ * zfacG(length(pm.xy));
    tau += planeFetch(pm.xy).a * vavg(pa.z - zw, pb.z - zw, h) * L;
  }
  return tau;
}
`;

const MARCH_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MARCH_FRAG = /* glsl */ `
${VOL_GLSL}
uniform vec3 uCam, uSunG, uDust, uBulge;
uniform mat3 uM;
uniform vec2 uTan;
uniform float uKv, uSteps, uHole, uClipZ, uGain, uScat, uFrame, uKnee, uFrac, uGrow, uMinStep, uLin, uLane;
varying vec2 vUv;
const vec3 C_THIN = ${f3(C.thin)}, C_YOUNG = ${f3(C.young)}, C_HII = ${f3(C.hii)}, C_NUC = ${f3(C.nuc)};
float hg(float c, float g) { float k = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (12.566 * pow(k, 1.5)); }
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 d = normalize(uM * vec3(ndc * uTan, -1.0));
  vec3 o = uCam;
  const float R2 = RMAX * RMAX;
  float a = dot(d.xy, d.xy), b = dot(o.xy, d.xy), c = dot(o.xy, o.xy) - R2;
  float tc0 = -1e9, tc1 = 1e9;
  if (a > 1e-10) {
    float disc = b * b - a * c;
    if (disc <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    float sq = sqrt(disc); tc0 = (-b - sq) / a; tc1 = (-b + sq) / a;
  } else if (c > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float tz0 = -1e9, tz1 = 1e9;
  if (abs(d.z) < 1e-6) { if (abs(o.z) > uClipZ) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } }
  else { float t1 = (-uClipZ - o.z) / d.z, t2 = (uClipZ - o.z) / d.z; tz0 = min(t1, t2); tz1 = max(t1, t2); }
  float t0 = max(0.0, max(tc0, tz0)), t1 = min(tc1, tz1);
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // nearby dark clouds: closed-form optical depth per cloud, applied as a screen where the ray passes the cloud
  float cT[NCLOUD], cTau[NCLOUD];
  bool anyCloud = false;
  for (int i = 0; i < NCLOUD; i++) {
    cTau[i] = 0.0; cT[i] = 1e30;
    if (uCloudOn > 0.01) {
      float tc; float tau = cloudSeg(i, o + d * t0, d * (t1 - t0), tc) * uCloudOn;
      if (tau > 1e-3) { cTau[i] = tau; cT[i] = t0 + (t1 - t0) * clamp(tc, 0.0, 1.0); anyCloud = true; }
    }
  }

  float jit = ign(gl_FragCoord.xy + fract(uFrame * 0.61803) * 64.0);
  float N = uSteps;
  float lenXY = (t1 - t0) * length(d.xy);
  float dxy = max(length(d.xy), 1e-4), dz = max(abs(d.z), 1e-5);
  float stepXY = max(uMinStep, uLin * lenXY / N);   // inside the disc: geometric steps from the camera (uLin -> 0)
  vec3 T = vec3(1.0), col = vec3(0.0);
  float t = t0;
  for (int i = 0; i < 256; i++) {
    float fi = float(i);
    if (fi >= N || t >= t1) break;
    vec3 p = o + d * t;
    // adaptive step: resolve the thin layers vertically, the bulge radially, and the plane map in-plane
    float zr = p.z - warpG(p.xy);
    float dt = (0.35 * abs(zr) + 30.0) / dz;
    dt = min(dt, 0.25 * length(p) + 25.0);
    dt = min(dt, (stepXY + uGrow * (t - t0)) / dxy);
    if (fi >= N - 1.0) dt = t1 - t;
    dt = min(dt, t1 - t);
    float ta = t, tb = t + dt, tm = t + dt * (0.25 + 0.5 * jit);
    vec3 pa = p, pb = o + d * tb, pm = o + d * tm;
    t = tb;
    vec4 pl = planeFetch(pm.xy);
    float R = length(pm.xy), f = zfacG(R), zw = warpG(pm.xy);
    float za = pa.z - zw, zb = pb.z - zw;
    vec4 sp = volFetch(pm);
    float hole = 1.0 - uHole * (1.0 - smoothstep(500.0, 1100.0, length(pm - uSunG)));
    vec3 j = (pl.r * vavg(za, zb, THINZ) * (1.0 - ${PHI.thin.toFixed(3)} * uFrac) * C_THIN
            + pl.g * vavg(za, zb, YOUNGZ * f) * (1.0 - ${PHI.young.toFixed(3)} * uFrac) * C_YOUNG
            + sp.rgb * (1.0 - ${PHI_SPHEROID.toFixed(3)} * uFrac)) * hole
            + pl.b * vavg(za, zb, HIIZ * f) * C_HII + sp.a * C_NUC;
    j *= uKv;
    float dust = pl.a * vavg(za, zb, DUSTZ * f);
    vec3 ext = dust * uDust * uLane;   // uLane > 1 only from outside the disc (edge-on lane contrast)
    // single scattering: ambient starlight from the surrounding disc + forward-peaked light from the bulge
    float rg = length(pm);
    float ph = hg(dot(pm / max(rg, 1.0), -d), 0.6);
    vec3 bl = uBulge * ph / (rg * rg + 9.0e6);
    vec3 src = j + dust * uScat * (vec3(0.75, 0.95, 1.3) * (0.45 * j + uKv * 6.0 * bl));
    vec3 x = ext * dt;
    vec3 eff = dt * mix((1.0 - exp(-x)) / max(x, vec3(1e-8)), 1.0 - 0.5 * x, step(x, vec3(0.02)));
    col += T * src * eff;
    T *= exp(-x);
    if (anyCloud) for (int k = 0; k < NCLOUD; k++) if (cT[k] >= ta && cT[k] < tb) T *= exp(-cTau[k] * uDust);
    if (max(T.r, max(T.g, T.b)) < 0.003) break;
  }
  col *= uGain;
  col /= 1.0 + uKnee * max(col.r, max(col.g, col.b));
  gl_FragColor = vec4(col, 1.0);
}`;

// Temporal accumulation: blends the newest (jittered) march into the history while the view is still.
const ACCUM_FRAG = /* glsl */ `
uniform sampler2D tNew, tOld; uniform float uAlpha;
varying vec2 vUv;
void main() { gl_FragColor = vec4(mix(texture2D(tOld, vUv).rgb, texture2D(tNew, vUv).rgb, uAlpha), 1.0); }`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.4
    + 0.15 * (texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb
            + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb);
  gl_FragColor = vec4(c * uWeight, 1.0);
}`;

const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.,1.); }';

// Cloud uniforms (shared by every material that calls segTau / cloudSeg).
function cloudUniforms() {
  const P4 = [], A3 = [];
  for (let i = 0; i < MAX_CLOUDS; i++) {
    const c = CLOUDS[i];
    if (!c) { P4.push(new THREE.Vector4(0, 0, 1e9, 0)); A3.push(new THREE.Matrix3()); continue; }
    P4.push(new THREE.Vector4(c.pos[0], c.pos[1], c.pos[2], c.k));
    A3.push(new THREE.Matrix3().set(...c.A));
  }
  return { uCloudP: { value: P4 }, uCloudA: { value: A3 } };
}

export function makeMarchMaterial(shared) {
  return new THREE.ShaderMaterial({
    vertexShader: MARCH_VERT, fragmentShader: MARCH_FRAG,
    uniforms: {
      tVol: shared.tVol, tPlane: shared.tPlane, tPlaneIn: shared.tPlaneIn, uPin: shared.uPin, uCloudP: shared.uCloudP, uCloudA: shared.uCloudA, uCloudOn: shared.uCloudOn,
      uKv: shared.uKv, uSunG: shared.uSunG, uHole: shared.uHole, uFrac: shared.uFrac, uDust: { value: new THREE.Vector3(...DUST_RGB) },
      uBulge: { value: new THREE.Vector3(1.0, 0.72, 0.4).multiplyScalar(2.2e9) },
      uCam: { value: new THREE.Vector3() }, uM: { value: new THREE.Matrix3() }, uTan: { value: new THREE.Vector2(1, 1) },
      uSteps: { value: 64 }, uClipZ: { value: 2200 }, uC: { value: 0 }, uGain: { value: 1 }, uKnee: { value: 0 }, uScat: { value: 0.35 * 300 * 0.5 }, uFrame: { value: 0 },
      uGrow: { value: 0 }, uMinStep: { value: 20 }, uLin: { value: 1 }, uLane: { value: 1 },
    },
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}

// Step-control parameters for a camera position (galaxy pc).
export function marchParams(camG) {
  const dR = Math.max(0, Math.hypot(camG[0], camG[1]) - VOL.RMAX), dZ = Math.max(0, Math.abs(camG[2]) - VOL.ZMAX);
  const dB = Math.hypot(dR, dZ);
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const inside = 1 - sstep(0, 3000, Math.max(0, Math.abs(camG[2]) - 1500) + dR);
  return { dB, clipZ: dB > 0 ? 2600 : VOL.ZMAX, outside: sstep(500, 12000, dB), grow: 0.14 * inside, lin: 1 - 0.95 * inside, minStep: 6 + 34 * (1 - inside) };
}

export class GalaxyVolume {
  constructor(app) {
    this.app = app;
    this.tune = { outsideGain: 6, lane: 1.5, knee: 0.12, scat: 0.35 * 150, accumulate: true, gain: 1 };
    this.shared = {
      tVol: { value: null }, tPlane: { value: null }, tPlaneIn: { value: null }, uPin: { value: 0 }, uKv: { value: UKV }, uSunG: { value: new THREE.Vector3(-8180, 0, 20.8) },
      uHole: { value: 0 }, uFrac: { value: 1 }, uCloudOn: { value: 0 }, ...cloudUniforms(),
    };
    this.ready = false; this.full = false;
    this.workers = [];
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false; this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.march = makeMarchMaterial(this.shared);
    this.accum = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: ACCUM_FRAG, uniforms: { tNew: { value: null }, tOld: { value: null }, uAlpha: { value: 1 } }, depthTest: false, depthWrite: false });
    this.comp = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
      blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
    });
    this.rt = null; this.hist = [null, null]; this.histIdx = 0; this.still = 0; this.viewKey = '';
    this._m4 = new THREE.Matrix4();
    this._e = new Array(9).fill(0);
  }

  // ---- bake ----------------------------------------------------------------------------------------------------
  // Plane map: N² texels over ±PLANE.RMAX; spheroid: [nxy/2, nxy/2, nz/2] warped cylinder. A coarse pass of each comes
  // first so the galaxy appears within a few hundred ms; the full-resolution pass replaces it.
  bake(settings) {
    const [nxy, nz] = settings.volumeTex;
    const nPlane = Math.min(4096, nxy * 4), sxy = Math.max(64, nxy >> 1), sz = Math.max(24, nz >> 1);
    const nW = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 2));
    for (let i = 0; i < nW; i++) this.workers.push(new Worker(this.app.assets.workerURL('src/galaxy/volume.worker.js')));
    this.done = new Promise((resolve) => { this._resolve = resolve; });
    this.bakeInfo = { plane: nPlane, sph: [sxy, sxy, sz] };
    // Generic slab job: rows [0, rows) split over the workers.
    const run = (msg, rows, rowLen, chunk, workers) => new Promise((resolve) => {
      const data = new Uint16Array(rows * rowLen * 4);
      let next = 0, pending = 0;
      const dispatch = (w) => {
        const r0 = next, r1 = Math.min(rows, next + chunk); next = r1; pending++;
        w.onmessage = (ev) => {
          data.set(ev.data.out, ev.data.r0 * rowLen * 4); pending--;
          if (next < rows) dispatch(w); else if (pending === 0) resolve(data);
        };
        w.postMessage({ ...msg, r0, r1 });
      };
      for (const w of workers.slice(0, Math.max(1, Math.min(workers.length, Math.ceil(rows / chunk))))) if (next < rows) dispatch(w);
    });
    const planeTex = (data, n) => {
      const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
      t.onUpdate = () => { t.image.data = null; t.onUpdate = null; };
      return t;
    };
    const sphTex = (data, nx, ny, nz2) => {
      const t = new THREE.Data3DTexture(data, nx, ny, nz2);
      t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType; t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
      t.onUpdate = () => { t.image.data = null; t.onUpdate = null; };
      return t;
    };
    const swap = (key, tex) => { const old = this.shared[key].value; this.shared[key].value = tex; old?.dispose(); };
    // A re-bake for a new tier never shows the coarse pass again (that would downgrade a finished galaxy): the old textures
    // stay bound until all three new ones exist, then swap in the same tick.
    const keep = this.full;
    (async () => {
      const t0 = performance.now();
      if (!keep) {
        // coarse
        const cp = 384, cs = [48, 48, 16];
        const [pc, sc] = await Promise.all([
          run({ kind: 'plane', n: cp }, cp, cp, cp >> 1, this.workers.slice(0, 2)),
          run({ kind: 'sph', nx: cs[0], ny: cs[1], nz: cs[2] }, cs[2], cs[0] * cs[1], cs[2], this.workers.slice(2, 3).length ? this.workers.slice(2, 3) : this.workers.slice(0, 1)),
        ]);
        swap('tPlane', planeTex(pc, cp)); swap('tVol', sphTex(sc, ...cs));
        this.ready = true; this.dirty = true;
        this.bakeInfo.coarseMs = performance.now() - t0;
      }
      // full
      const pf = await run({ kind: 'plane', n: nPlane }, nPlane, nPlane, 32, this.workers);
      const sf = await run({ kind: 'sph', nx: sxy, ny: sxy, nz: sz }, sz, sxy * sxy, 2, this.workers);
      if (!keep) { swap('tPlane', planeTex(pf, nPlane)); swap('tVol', sphTex(sf, sxy, sxy, sz)); }
      // central inset (±PIN pc at ~2.5 pc/texel) so the CMZ clouds stay smooth from the Galactic-Centre views
      const PIN = 640, nIn = 512;
      const pin = await run({ kind: 'plane', n: nIn, ext: PIN }, nIn, nIn, 32, this.workers);
      if (keep) { swap('tPlane', planeTex(pf, nPlane)); swap('tVol', sphTex(sf, sxy, sxy, sz)); }
      swap('tPlaneIn', planeTex(pin, nIn)); this.shared.uPin.value = PIN;
      this.full = true; this.dirty = true;
      this.bakeInfo.fullMs = performance.now() - t0;
      for (const w of this.workers) w.terminate();
      this.workers = [];
      this._resolve();
    })().catch((e) => console.error('[galaxy] volume bake failed', e));
  }

  // Per-frame camera context in galaxy axes (Float64 math on the CPU).
  setCamera(frame, cam) { // cam: { g: [x,y,z] }
    const m = frame.galaxyMatrix.elements;
    const px = frame.camPos[0] / PCm - m[12], py = frame.camPos[1] / PCm - m[13], pz = frame.camPos[2] / PCm - m[14];
    cam.g[0] = m[0] * px + m[1] * py + m[2] * pz;
    cam.g[1] = m[4] * px + m[5] * py + m[6] * pz;
    cam.g[2] = m[8] * px + m[9] * py + m[10] * pz;
    return cam;
  }

  ensureRT(w, h) {
    // Dynamic resolution nudges w/h every frame; the march is uv-based, so a target within ~20 % is reused (re-allocating
    // would drop the accumulated history and churn GPU memory while the camera moves).
    if (this.rt && Math.abs(this.rt.width / w - 1) < 0.2 && Math.abs(this.rt.height / h - 1) < 0.2) return;
    for (const r of [this.rt, ...this.hist]) r?.dispose();
    const mk = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.rt = mk(); this.hist = [mk(), mk()]; this.still = 0;
  }

  params(camG) { return marchParams(camG); }

  // Configure a march material for a camera (shared by the live view and the cube capture).
  configure(u, camG, steps, gain, frameNo) {   // gain: total light scale (outside boost × adaptation)
    const p = marchParams(camG);
    u.uSteps.value = steps; u.uClipZ.value = p.clipZ; u.uGrow.value = p.grow; u.uMinStep.value = p.minStep; u.uLin.value = p.lin;
    u.uGain.value = gain * this.tune.gain; u.uKnee.value = this.tune.knee * p.outside; u.uLane.value = 1 + this.tune.lane * p.outside;
    u.uScat.value = this.tune.scat; u.uFrame.value = frameNo;
    u.uCam.value.set(camG[0], camG[1], camG[2]);
  }

  // Render the live raymarch at reduced resolution (prePass). While the view is unchanged the jittered result is
  // accumulated over up to 16 frames; after that the march is skipped entirely and the history is reused.
  render(renderer, frame, cam, gainOut, steps) {
    const { w, h } = frame.viewport, s = frame.tierSettings.volumeRes;
    this.ensureRT(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
    const u = this.march.uniforms;
    this.setView(u, frame, cam);
    const key = viewKey(cam.g, this._e, frame, gainOut, this.shared, this.tune, steps);
    if (key !== this.viewKey || this.dirty || !this.tune.accumulate) { this.viewKey = key; this.still = 0; this.dirty = false; }
    if (this.still >= 16) return;              // converged: reuse history
    this.configure(u, cam.g, steps, gainOut, this.still === 0 ? 0 : (frame.time * 60) % 997);
    const prev = renderer.getRenderTarget();
    this.quad.material = this.march;
    renderer.setRenderTarget(this.rt); renderer.render(this.quadScene, this.quadCam);
    const src = this.hist[this.histIdx], dst = this.hist[1 - this.histIdx];
    this.accum.uniforms.tNew.value = this.rt.texture; this.accum.uniforms.tOld.value = src.texture;
    this.accum.uniforms.uAlpha.value = 1 / (this.still + 1);
    this.quad.material = this.accum;
    renderer.setRenderTarget(dst); renderer.render(this.quadScene, this.quadCam);
    this.histIdx = 1 - this.histIdx; this.still++;
    renderer.setRenderTarget(prev);
  }
  // uM maps camera-space rays to galaxy axes: R^T * camera rotation.
  setView(u, frame, cam) {
    const m = frame.galaxyMatrix.elements;
    this._m4.makeRotationFromQuaternion(frame.camQuat);
    const c = this._m4.elements, e = this._e;
    for (let col = 0; col < 3; col++) {
      const vx = c[col * 4], vy = c[col * 4 + 1], vz = c[col * 4 + 2];
      e[col * 3] = m[0] * vx + m[1] * vy + m[2] * vz;
      e[col * 3 + 1] = m[4] * vx + m[5] * vy + m[6] * vz;
      e[col * 3 + 2] = m[8] * vx + m[9] * vy + m[10] * vz;
    }
    u.uM.value.fromArray(e);
    const t = Math.tan(frame.fovY * Math.PI / 360);
    u.uTan.value.set(t * frame.viewport.w / frame.viewport.h, t);
  }
  composite(renderer, target, weight) {
    if (!this.rt || weight <= 0.002) return;
    const tex = this.hist[this.histIdx].texture;
    this.comp.uniforms.tSrc.value = tex;
    this.comp.uniforms.uTexel.value.set(1 / this.rt.width, 1 / this.rt.height);
    this.comp.uniforms.uWeight.value = weight;
    this.quad.material = this.comp;
    renderer.setRenderTarget(target); renderer.render(this.quadScene, this.quadCam);
  }
}
const PCm = 3.0856775814913673e16;

// A string key of everything that changes the march image (rounded so float noise does not reset accumulation).
function viewKey(g, e, frame, gainOut, S, tune, steps) {
  const r = (x, k) => Math.round(x * k);
  return [r(g[0], 100), r(g[1], 100), r(g[2], 100), ...e.map((x) => r(x, 1e6)), r(frame.fovY, 1e4), frame.viewport.w, frame.viewport.h,
    r(gainOut, 1e4), r(S.uHole.value, 1e4), r(S.uFrac.value, 1e4), r(S.uCloudOn.value, 1e4), r(tune.knee, 1e4), r(tune.scat, 1e3), r(tune.gain, 1e4), r(tune.lane, 1e3), steps].join(',');
}
