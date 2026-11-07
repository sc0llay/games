import * as THREE from 'three';
import { createAurora } from 'orion/render/bodies/aurora.js';

// Planetary atmospheres, Hillaire 2020 ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique").
//
// Per atmosphere, two LUTs are rendered to texture when the atmosphere first becomes visible (and again when the
// quality tier changes):
//   transmittance LUT (256x64, Bruneton (r, mu) parameterisation) storing OPTICAL DEPTH to the top of the atmosphere
//     (half floats hold optical depth without underflow at grazing angles; T = exp(-od) at lookup);
//   multiple-scattering LUT (32x32, (mu_s, h)) storing Hillaire's Psi_ms = L2 / (1 - f_ms) for unit illuminance.
// Rendering ray-marches each pixel of the shell with those LUTs (sun transmittance and all higher scattering orders
// come from texture lookups, so 16-40 view steps suffice). The same code path serves the view from space (limb,
// aerial perspective over the surface, terminator) and the view from inside (sky, sunsets, Earth's shadow), so the
// space-to-ground transition is continuous by construction. Hillaire's sky-view LUT and froxel aerial-perspective
// volume are resolution-decoupling optimisations; per-pixel marching fits the frame budget here and avoids a seam
// between LUT and march, so they are not used.
//
// Two passes per atmosphere (WebGL has no dual-source blending):
//   pass A multiplies what is already drawn (surface, clouds, the Sun's disc) by the chromatic view transmittance and
//     writes coverage alpha 1 - T (hides the sky layer),
//   pass B adds in-scattered radiance.
// Units: kilometres, camera-relative object frame; light 1.0 = white Lambertian at 1 AU, so irradiance E = pi * uIrr.
//
// Parameters: coefficients per METRE at the bottom of the atmosphere (converted to per km for the GPU), heights km.
//   top: thickness above the body's visible surface (for Venus/Titan/giants that surface is the cloud/haze deck);
//   HR/HM Rayleigh/Mie scale heights; bR Rayleigh scattering; bMs/bMa Mie scattering/absorption; bO absorber with a
//   tent profile oz = [centre, half-width] (Earth's ozone); bD + detach = [centre, width]: Gaussian detached haze layer;
//   g: Mie asymmetry per channel (Mars dust is more forward-scattering in blue -> blue sunsets); albedo: ground/deck
//   albedo for the multiple-scattering LUT; tint: surface shader tints sunlight with the transmittance LUT.
const k3 = (v) => [v, v, v];
export const ATMOS = {
  earth:   { top: 100, HR: 8, HM: 1.2, bR: [5.802e-6, 13.558e-6, 33.1e-6], bMs: k3(3.996e-6), bMa: k3(0.444e-6), bO: [0.650e-6, 1.881e-6, 0.085e-6], oz: [25, 15], g: k3(0.8), albedo: k3(0.3), tint: true, aurora: true },
  mars:    { top: 80, HR: 11.1, HM: 11.1, bR: [0.16e-6, 0.37e-6, 0.9e-6], bMs: [3.1e-5, 2.6e-5, 1.9e-5], bMa: [0.15e-5, 0.6e-5, 1.3e-5], g: [0.62, 0.68, 0.8], albedo: [0.32, 0.17, 0.08], tint: true },
  venus:   { top: 90, HR: 15.9, HM: 5, bR: [0.78e-6, 1.82e-6, 4.4e-6], bMs: [1.2e-4, 1.15e-4, 1.0e-4], bMa: [0, 0.06e-4, 0.18e-4], g: k3(0.7), albedo: [0.9, 0.8, 0.6] },
  titan:   { top: 600, HR: 40, HM: 65, bR: [0.25e-5, 0.6e-5, 1.4e-5], bMs: [1.0e-4, 0.62e-4, 0.26e-4], bMa: [0.1e-4, 0.32e-4, 0.9e-4], bD: [0.8e-7, 1.6e-7, 3.4e-7], detach: [450, 30], g: k3(0.65), albedo: [0.25, 0.15, 0.06] },
  jupiter: { top: 220, HR: 27, HM: 35, bR: [0.15e-6, 0.35e-6, 0.8e-6], bMs: [0.4e-6, 0.38e-6, 0.32e-6], bMa: [0.05e-6, 0.1e-6, 0.2e-6], g: k3(0.6), albedo: [0.6, 0.5, 0.4] },
  saturn:  { top: 420, HR: 60, HM: 60, bR: [0.1e-6, 0.22e-6, 0.5e-6], bMs: [0.5e-6, 0.47e-6, 0.4e-6], bMa: [0.03e-6, 0.07e-6, 0.15e-6], g: k3(0.6), albedo: [0.6, 0.5, 0.35] },
  uranus:  { top: 200, HR: 28, HM: 28, bR: [0.2e-6, 0.45e-6, 1.0e-6], bMs: k3(0.3e-6), bMa: [1.0e-6, 0.15e-6, 0], g: k3(0.5), albedo: [0.4, 0.6, 0.65] },
  neptune: { top: 150, HR: 20, HM: 20, bR: [0.2e-6, 0.5e-6, 1.25e-6], bMs: k3(0.3e-6), bMa: [1.5e-6, 0.25e-6, 0], g: k3(0.5), albedo: [0.2, 0.35, 0.6] },
  pluto:   { top: 300, HR: 50, HM: 50, bR: k3(0), bMs: [0.8e-7, 1.6e-7, 3.2e-7], bMa: k3(0), g: k3(0.6), albedo: [0.6, 0.5, 0.4] },
};

// Tier-dependent costs. LUT sizes are the spec's (256x64, 32x32) from medium up.
export const ATMOS_TIERS = {
  low:    { steps: 16, lutT: [128, 32], lutM: 16, auroraSteps: 24 },
  medium: { steps: 24, lutT: [256, 64], lutM: 32, auroraSteps: 32 },
  high:   { steps: 32, lutT: [256, 64], lutM: 32, auroraSteps: 40 },
  ultra:  { steps: 40, lutT: [256, 64], lutM: 32, auroraSteps: 64 },
};

/** Optical depth (per channel) of a vertical column from the bottom to the top — CPU reference (tests, docs). */
export function verticalOpticalDepth(p, n = 4000) {
  const od = [0, 0, 0], dt = p.top / n;
  for (let i = 0; i < n; i++) {
    const h = (i + 0.5) * dt;
    const e = mediumExtinction(p, h);
    for (let c = 0; c < 3; c++) od[c] += e[c] * 1e3 * dt;
  }
  return od;
}
/** Extinction per metre at altitude h (km) — mirrors atmMedium() in the shaders. */
export function mediumExtinction(p, h) {
  h = Math.max(h, 0);
  const dR = Math.exp(-h / p.HR), dM = Math.exp(-h / p.HM);
  const dO = p.oz ? Math.max(0, 1 - Math.abs(h - p.oz[0]) / p.oz[1]) : 0;
  const dD = p.detach ? Math.exp(-(((h - p.detach[0]) / p.detach[1]) ** 2)) : 0;
  const bO = p.bO || [0, 0, 0], bD = p.bD || [0, 0, 0];
  return [0, 1, 2].map((c) => p.bR[c] * dR + (p.bMs[c] + p.bMa[c]) * dM + bO[c] * dO + bD[c] * dD);
}

let _black = null;
const black = () => {
  if (!_black) { _black = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); _black.needsUpdate = true; }
  return _black;
};

/** Atmosphere uniforms, merged into the body's shared uniform object (surface/cloud shaders use the LUT too). */
export function atmosphereUniforms(p) {
  const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const km = (a) => new THREE.Vector3(a[0] * 1e3, a[1] * 1e3, a[2] * 1e3);
  return {
    tAtmT: { value: black() }, tAtmMS: { value: black() },
    uAtmR: { value: new THREE.Vector4(1, 1 + p.top, 0.005, 0) },   // Rb, Rt (km), sun half-angle (+refraction), -
    uAtmTS: { value: new THREE.Vector4(256, 64, 32, 32) },         // LUT sizes
    uBR: { value: km(p.bR) }, uBMs: { value: km(p.bMs) }, uBMa: { value: km(p.bMa) },
    uBO: { value: km(p.bO || [0, 0, 0]) }, uBD: { value: km(p.bD || [0, 0, 0]) },
    uProf: { value: new THREE.Vector4(p.HR, p.HM, p.oz ? p.oz[0] : 0, p.oz ? p.oz[1] : 0) },
    uDet: { value: new THREE.Vector4(p.detach ? p.detach[0] : 0, p.detach ? p.detach[1] : 0, 0, 0) },
    uGM: { value: v(p.g) }, uAlb: { value: v(p.albedo) }, uSteps: { value: 32 },
  };
}

// ---- shared GLSL ---------------------------------------------------------------------------------------------------
const TRANS_UV = /* glsl */ `
vec2 atmTransUv(float r, float mu) {
  float Rb = uAtmR.x, Rt = uAtmR.y;
  r = clamp(r, Rb, Rt);
  float H = sqrt(max((Rt - Rb) * (Rt + Rb), 1e-6));
  float rho = sqrt(max((r - Rb) * (r + Rb), 0.0));
  float disc = r * r * (mu * mu - 1.0) + Rt * Rt;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dmin = Rt - r, dmax = rho + H;
  vec2 x = clamp(vec2((d - dmin) / max(dmax - dmin, 1e-6), rho / H), 0.0, 1.0);
  return (x * (uAtmTS.xy - 1.0) + 0.5) / uAtmTS.xy;
}
`;

/** Sunlight transmittance at the surface (shared with surface.js / cloud shader): mu0 = cos(sun zenith). */
export const SUN_TRANSMIT_GLSL = /* glsl */ `
uniform sampler2D tAtmT;
uniform vec4 uAtmR, uAtmTS;
${TRANS_UV}
vec3 sunTransmit(float mu0) {
  return exp(-texture2D(tAtmT, atmTransUv(uAtmR.x + 0.02, clamp(mu0, -1.0, 1.0))).rgb);
}
`;

const COMMON = /* glsl */ `
uniform vec4 uAtmR, uAtmTS, uProf, uDet;
uniform vec3 uBR, uBMs, uBMa, uBO, uBD, uGM, uAlb;
uniform sampler2D tAtmT;
${TRANS_UV}
void atmMedium(float h, out vec3 sR, out vec3 sM, out vec3 ext) {
  h = max(h, 0.0);
  float dR = exp(-h / uProf.x), dM = exp(-h / uProf.y);
  float dO = uProf.w > 0.0 ? max(0.0, 1.0 - abs(h - uProf.z) / uProf.w) : 0.0;
  float dD = uDet.y > 0.0 ? exp(-pow((h - uDet.x) / uDet.y, 2.0)) : 0.0;
  sR = uBR * dR;
  sM = uBMs * dM + uBD * dD;
  ext = sR + sM + uBMa * dM + uBO * dO;
}
vec3 atmOD(float r, float mu) { return texture2D(tAtmT, atmTransUv(r, mu)).rgb; }
// Fraction of the Sun's disc above the planet's horizon seen from radius r (uAtmR.z = half-angle in mu units).
float atmSunVis(float r, float mus) {
  float sh = min(uAtmR.x / r, 1.0);
  float muh = -sqrt(max(1.0 - sh * sh, 0.0));
  return smoothstep(-uAtmR.z, uAtmR.z, mus - muh);
}
// Sample placement on [0,1] with zero spacing at a (the ray's lowest, densest point).
float atmWarp(float u, float a) {
  if (u < a) { float x = 1.0 - u / a; return a * (1.0 - x * x); }
  float x = (u - a) / max(1.0 - a, 1e-6); return a + (1.0 - a) * x * x;
}
`;

const LUT_VERT = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const LUT_T_FRAG = /* glsl */ `
#include <common>
${COMMON}
void main() {
  vec2 x = (gl_FragCoord.xy - 0.5) / (uAtmTS.xy - 1.0);
  float Rb = uAtmR.x, Rt = uAtmR.y;
  float H = sqrt((Rt - Rb) * (Rt + Rb));
  float rho = H * x.y;
  float r = sqrt(rho * rho + Rb * Rb);
  float dmin = Rt - r, dmax = rho + H;
  float d = dmin + x.x * (dmax - dmin);
  float mu = d <= 0.0 ? 1.0 : clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  float a = clamp(-r * mu / max(d, 1e-6), 0.0, 1.0);
  vec3 od = vec3(0.0);
  float fp = 0.0;
  const int N = 80;
  for (int i = 0; i < N; i++) {
    float f1 = atmWarp(float(i + 1) / float(N), a), fs = atmWarp((float(i) + 0.5) / float(N), a);
    float t = fs * d, dt = (f1 - fp) * d; fp = f1;
    float rr = sqrt(max(r * r + t * t + 2.0 * r * mu * t, 0.0));
    vec3 sR, sM, e; atmMedium(rr - Rb, sR, sM, e);
    od += e * dt;
  }
  gl_FragColor = vec4(od, 1.0);
}`;

const LUT_MS_FRAG = /* glsl */ `
#include <common>
${COMMON}
void main() {
  vec2 x = (gl_FragCoord.xy - 0.5) / (uAtmTS.zw - 1.0);
  float mus = x.x * 2.0 - 1.0;
  float Rb = uAtmR.x, Rt = uAtmR.y;
  float r = Rb + clamp(x.y, 0.002, 0.998) * (Rt - Rb);
  vec3 P = vec3(0.0, 0.0, r);
  vec3 S = vec3(sqrt(max(1.0 - mus * mus, 0.0)), 0.0, mus);
  vec3 Lsum = vec3(0.0), Fsum = vec3(0.0);
  for (int i = 0; i < 8; i++) for (int j = 0; j < 8; j++) {
    float th = 2.0 * PI * (float(i) + 0.5) / 8.0;
    float ph = acos(1.0 - 2.0 * (float(j) + 0.5) / 8.0);
    vec3 D = vec3(cos(th) * sin(ph), sin(th) * sin(ph), cos(ph));
    float b = dot(P, D);
    float tTop = -b + sqrt(max(b * b - (r - Rt) * (r + Rt), 0.0));
    float cg = (r - Rb) * (r + Rb), dg = b * b - cg;
    bool hitG = dg >= 0.0 && b < 0.0;
    float tMax = hitG ? cg / (-b + sqrt(dg)) : tTop;
    float dt = tMax / 20.0;
    vec3 L = vec3(0.0), F = vec3(0.0), thr = vec3(1.0);
    for (int k = 0; k < 20; k++) {
      vec3 Q = P + D * ((float(k) + 0.5) * dt);
      float rq = length(Q);
      vec3 sR, sM, e; atmMedium(rq - Rb, sR, sM, e);
      float mq = dot(Q, S) / rq;
      vec3 Ts = exp(-atmOD(rq, mq)) * atmSunVis(rq, mq);
      vec3 sc = sR + sM;
      vec3 Tst = exp(-e * dt);
      vec3 integ = thr * (1.0 - Tst) / max(e, vec3(1e-9));
      L += sc * Ts * (0.25 / PI) * integ;
      F += sc * integ;
      thr *= Tst;
    }
    if (hitG) {
      vec3 G = normalize(P + D * tMax);
      float mg = dot(G, S);
      L += thr * exp(-atmOD(Rb, mg)) * max(mg, 0.0) * uAlb / PI;
    }
    Lsum += L; Fsum += F;
  }
  vec3 psi = (Lsum / 64.0) / max(1.0 - Fsum / 64.0, vec3(0.02));
  gl_FragColor = vec4(psi, 1.0);
}`;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

// Pass A (TRANS_PASS) and pass B share the ray setup.
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${COMMON}
uniform mat3 uRot;
uniform vec3 uScale, uSunObj, uCamObj;
uniform float uSunDist, uSunR, uIrr, uFade;
uniform vec4 uOcc[4];
uniform int uSteps;
uniform sampler2D tAtmMS;
varying vec3 vWorld;

vec2 atmMsUv(float r, float mus) {
  vec2 x = clamp(vec2(mus * 0.5 + 0.5, (r - uAtmR.x) / (uAtmR.y - uAtmR.x)), 0.0, 1.0);
  return (x * (uAtmTS.zw - 1.0) + 0.5) / uAtmTS.zw;
}
// Fraction of the Sun's flux (angular radius rs, limb-darkened I = 1 - 0.6(1 - mu)) hidden by an occluder (ro) at
// separation d. Integrated over 8 annuli: each annulus loses the arc fraction of it inside the occluder disc.
float atmDiscOv(float rs, float ro, float d) {
  if (d >= rs + ro) return 0.0;
  float occ = 0.0, tot = 0.0;
  for (int i = 0; i < 8; i++) {
    float x = (float(i) + 0.5) / 8.0, r = x * rs;
    float w = (0.4 + 0.6 * sqrt(1.0 - x * x)) * x;
    float f = ro >= d + r ? 1.0 : (r >= d + ro || d >= r + ro) ? 0.0
            : acos(clamp((d * d + r * r - ro * ro) / (2.0 * d * r), -1.0, 1.0)) / PI;
    occ += w * f; tot += w;
  }
  return occ / tot;
}
// Fraction of the Sun visible from P (object frame, km) past every occluder (Moon's shadow in eclipses).
float atmEclipse(vec3 P) {
  vec3 sv = uSunObj * uSunDist - P;
  float ds = length(sv); sv /= ds;
  float rs = asin(min(uSunR / ds, 1.0));
  float vis = 1.0;
  for (int i = 0; i < 4; i++) {
    vec4 o = uOcc[i];
    if (o.w <= 0.0) continue;
    vec3 ov = o.xyz - P;
    float dO = length(ov);
    if (dO >= ds) continue;
    ov /= dO;
    float ro = asin(min(o.w / dO, 1.0));
    float sep = atan(length(cross(sv, ov)), dot(sv, ov));
    vis *= 1.0 - atmDiscOv(rs, ro, sep);
  }
  return vis;
}
vec3 atmPhaseM(float c) {
  vec3 g = uGM, g2 = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, vec3(1.5)));
}

void main() {
  #include <logdepthbuf_fragment>
  float Rb = uAtmR.x, Rt = uAtmR.y;
  // Sphere space: the ellipsoid scaled to a sphere of the equatorial radius (km).
  vec3 kk = vec3(1.0, 1.0, uScale.x / uScale.z);
  vec3 o = uCamObj * kk;
  vec3 d = normalize((transpose(uRot) * normalize(vWorld)) * kk);
  float ro = length(o);
  if (ro < Rb - 0.002) discard;
  float b = dot(o, d);
  vec3 pc = o - d * b;
  float q2 = dot(pc, pc);
  float discT = Rt * Rt - q2;
  if (discT <= 0.0) discard;
  float sq = sqrt(discT);
  float t0 = max(-b - sq, 0.0), t1 = -b + sq;
  if (t1 <= 0.0) discard;
  bool ground = false;
  float discG = Rb * Rb - q2;
  if (discG > 0.0 && b < 0.0) {
    float tg = max((ro - Rb) * (ro + Rb), 0.0) / (-b + sqrt(discG));
    if (tg < t1) { t1 = tg; ground = true; }
  }
  if (t1 <= t0) discard;

#ifdef TRANS_PASS
  vec3 ps = o + d * t0;
  float r0 = max(length(ps), Rb);
  float mu0 = dot(ps, d) / r0;
  vec3 od;
  if (!ground) od = atmOD(r0, mu0);
  else {
    vec3 pg = o + d * t1;
    od = max(atmOD(Rb, -dot(pg, d) / length(pg)) - atmOD(r0, -mu0), 0.0);
  }
  vec3 Tr = mix(vec3(1.0), exp(-od), uFade);
  gl_FragColor = vec4(Tr, 1.0 - dot(Tr, vec3(0.2126, 0.7152, 0.0722)));
#else
  vec3 s = normalize(uSunObj * kk);
  float L = t1 - t0;
  float a = clamp((-b - t0) / L, 0.0, 1.0);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float mu = dot(d, s);
  float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  vec3 phM = atmPhaseM(mu);
  bool ecl = uOcc[0].w > 0.0;
  vec3 acc = vec3(0.0), thr = vec3(1.0);
  float N = float(uSteps), fp = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= uSteps) break;
    float f1 = atmWarp(float(i + 1) / N, a);
    float fs = atmWarp((float(i) + 0.5 + (jit - 0.5) * 0.6) / N, a);
    float dt = (f1 - fp) * L; fp = f1;
    vec3 p = o + d * (t0 + fs * L);
    float r = length(p);
    vec3 sR, sM, e; atmMedium(r - Rb, sR, sM, e);
    float mus = dot(p, s) / r;
    vec3 Ts = exp(-atmOD(r, mus)) * atmSunVis(r, mus);
    vec3 psi = texture2D(tAtmMS, atmMsUv(r, mus)).rgb;
    float ev = ecl ? atmEclipse(p / kk) : 1.0;
    vec3 S = (Ts * (sR * phR + sM * phM) + psi * (sR + sM)) * ev;
    vec3 x = e * dt, Tst = exp(-x);
    vec3 w = mix(dt * (1.0 - 0.5 * x), (1.0 - Tst) / max(e, vec3(1e-30)), step(vec3(1e-3), x));
    acc += thr * S * w;
    thr *= Tst;
  }
  vec3 col = acc * (PI * uIrr * uFade);
  // Coverage for the sky-layer composite: a bright sky veils the stars behind it (contrast threshold ~1e-2 of the
  // daylight sky, so they come out through nautical twilight).
  gl_FragColor = vec4(col, 1.0 - exp(-dot(col, vec3(0.2126, 0.7152, 0.0722)) / 2e-3));
#endif
}`;

function shellMaterial(U, trans) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: U, defines: trans ? { TRANS_PASS: 1 } : {},
    transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  });
  if (trans) {   // dst *= T; alpha = 1 - T(1 - a)
    m.blendSrc = THREE.ZeroFactor; m.blendDst = THREE.SrcColorFactor;
    m.blendSrcAlpha = THREE.OneMinusDstAlphaFactor; m.blendDstAlpha = THREE.OneFactor;
  } else {       // dst += inscatter; alpha = union of coverages
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.OneMinusDstAlphaFactor; m.blendDstAlpha = THREE.OneFactor;
  }
  return m;
}

const lutRT = (w, h) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
});

/** Owns every atmosphere (and Earth's aurora): meshes, LUT baking, per-frame inside/outside switching. */
export class AtmosphereSystem {
  constructor(app, scene, shellGeo) {
    this.app = app; this.scene = scene; this.geo = shellGeo; this.list = [];
    this.qScene = new THREE.Scene(); this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
    app.quality?.addEventListener?.('tier', () => { for (const e of this.list) e.dirty = true; });
  }

  /** Builds the atmosphere for a body record (rec.U must already hold atmosphereUniforms). Sets rec.atm (a Group). */
  add(rec) {
    const p = ATMOS[rec.atmKey], U = rec.U;
    U.uAtmR.value.set(rec.req, rec.req + p.top, 0.005, 0);
    const lu = (frag) => new THREE.ShaderMaterial({
      vertexShader: LUT_VERT, fragmentShader: frag, uniforms: U, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const group = new THREE.Group();
    const s = (1 + p.top / rec.req) * 1.02;
    const matA = shellMaterial(U, true), matB = shellMaterial(U, false);
    const meshA = new THREE.Mesh(this.geo, matA), meshB = new THREE.Mesh(this.geo, matB);
    for (const [m, o] of [[meshA, 20], [meshB, 21]]) {
      m.scale.set(rec.req * s, rec.req * s, rec.rpol * s); m.frustumCulled = false; m.renderOrder = o; group.add(m);
    }
    const e = { rec, p, U, matA, matB, lutT: lu(LUT_T_FRAG), lutM: lu(LUT_MS_FRAG), rtT: null, rtM: null, dirty: true, shellR: rec.req * s, inside: false, aurora: null };
    if (p.aurora) { e.aurora = createAurora(this.app, U, this.geo, rec); group.add(e.aurora.mesh, e.aurora.comp); }
    this.scene.add(group);
    rec.atm = group; rec.atmSys = e;
    this.list.push(e);
    return group;
  }

  #bake(e, tier) {
    const t = ATMOS_TIERS[tier] || ATMOS_TIERS.high, r = this.app.renderer;
    if (!e.rtT || e.rtT.width !== t.lutT[0] || e.rtT.height !== t.lutT[1]) { e.rtT?.dispose(); e.rtT = lutRT(t.lutT[0], t.lutT[1]); }
    if (!e.rtM || e.rtM.width !== t.lutM) { e.rtM?.dispose(); e.rtM = lutRT(t.lutM, t.lutM); }
    e.U.uAtmTS.value.set(t.lutT[0], t.lutT[1], t.lutM, t.lutM);
    const prev = r.getRenderTarget();
    r.setRenderTarget(e.rtT); this.quad.material = e.lutT; r.render(this.qScene, this.qCam);
    e.U.tAtmT.value = e.rtT.texture;
    r.setRenderTarget(e.rtM); this.quad.material = e.lutM; r.render(this.qScene, this.qCam);
    e.U.tAtmMS.value = e.rtM.texture;
    r.setRenderTarget(prev);
    e.dirty = false;
  }

  /** Per frame, for a visible body (after index.js has set the body's uniforms). */
  update(rec, f) {
    const e = rec.atmSys; if (!e) return;
    const t = ATMOS_TIERS[f.tier] || ATMOS_TIERS.high;
    if (e.dirty) this.#bake(e, f.tier);
    const U = e.U;
    U.uSteps.value = t.steps;
    U.uAtmR.value.z = U.uSunR.value / U.uSunDist.value + 0.002;
    const c = U.uCamObj.value, k = rec.req / rec.rpol;
    const camR = Math.hypot(c.x, c.y, c.z * k);
    // Outside the shell mesh the front faces cover the atmosphere and are depth-tested (moons/rings in front occlude
    // it). Inside, the back faces lie behind the ground, so they are drawn without depth test; the shader finds the
    // ground analytically. Both modes run the same shader, so the switch is invisible.
    const inside = camR < e.shellR * 1.003;
    if (inside !== e.inside) {
      e.inside = inside;
      for (const m of [e.matA, e.matB]) { m.side = inside ? THREE.BackSide : THREE.FrontSide; m.depthTest = !inside; }
    }
    e.aurora?.update(f, camR, t.auroraSteps);
  }
}
