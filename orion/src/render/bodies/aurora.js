import * as THREE from 'three';

// Aurora (spec §09 Earth): emissive curtain volume in the auroral ovals around the geomagnetic poles.
// The ovals are fixed in magnetic-local-time coordinates (relative to the Sun), not to the rotating Earth: centred
// ~4 deg toward midnight from the dipole pole, ~14 deg colatitude at noon and ~22 deg at midnight for Kp 3, widening
// and moving equatorward with Kp. Inside the oval: three folded arcs of 557.7 nm green emission with a sharp lower
// border near 100 km, vertical ray striation, red 630 nm tops above ~200 km and a faint pink N2 lower fringe in
// strong storms, plus a diffuse glow. Raymarched in a shell 85-400 km, restricted analytically to the double cone
// around the magnetic axis, stopping at the ground sphere, so it is depth-correct with the planet. Animated in real
// time (not sim time). Brightness is matched to the city-light scale of the night side (both far above physical
// radiance relative to sunlight; auto exposure brings them up together).

export const GEOMAG_NORTH = { lat: 80.7, lon: -72.7 };   // IGRF-13 dipole, epoch ~2025
const DEG = Math.PI / 180;

/** Body-fixed unit vector of the north geomagnetic pole (+z north, +x prime meridian). */
export function geomagPole(out = [0, 0, 0]) {
  const la = GEOMAG_NORTH.lat * DEG, lo = GEOMAG_NORTH.lon * DEG;
  out[0] = Math.cos(la) * Math.cos(lo); out[1] = Math.cos(la) * Math.sin(lo); out[2] = Math.sin(la);
  return out;
}

/** Oval parameters (radians) for a Kp index 0-9: centre colatitude, noon-midnight half-difference, band half-width, arc width. */
export function ovalParams(kp) {
  const k = Math.min(9, Math.max(0, kp));
  return { th0: (17 + 1.6 * (k - 3)) * DEG, dth: 4 * DEG, width: (2.0 + 0.25 * k) * DEG, arcW: 0.2 * DEG };
}
/** Geomagnetic latitude (deg) of the oval centre at magnetic midnight. */
export const midnightLatitude = (kp) => { const o = ovalParams(kp); return 90 - (o.th0 + o.dth) / DEG; };

const R_LO = 85, R_HI = 400;

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

const NOISE = /* glsl */ `
float hashU(float i, float seed) {
  uint x = uint(int(i)) * 747796405u + uint(int(seed)) * 2891336453u;
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return float(x) / 4294967295.0;
}
// Periodic 1-D value noise: x in cells, period P cells.
float pn(float x, float P, float seed) {
  float i = floor(x), f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(hashU(mod(i, P), seed), hashU(mod(i + 1.0, P), seed), f);
}`;

// Curtain map, rebuilt every frame (it animates): the oval's horizontal structure over (magnetic local time u,
// normalised band coordinate v = xb / 1.8). Doing this once per texel instead of once per raymarch sample is what
// keeps the volume affordable. R: (arcs + diffuse) * activity, G: ray-weighted striation, B: lower-border height
// offset, A: arcs * activity (for the N2 fringe).
const MAP_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MAP_FRAG = /* glsl */ `
#include <common>
uniform float uTime;
uniform vec4 uOval;
varying vec2 vUv;
${NOISE}
void main() {
  float u = vUv.x, xb = (vUv.y * 2.0 - 1.0) * 1.8;
  float ph = 2.0 * PI * u, cphi = cos(ph - PI);      // u = 0.5 is magnetic noon
  float bw = uOval.z * (1.0 + 0.5 * max(-cphi, 0.0));
  float dc = xb * bw, t = uTime;
  float act = (0.25 + 0.75 * smoothstep(-0.4, 0.9, -cphi)) * (0.35 + 0.9 * pn(u * 24.0 + t * 0.004, 24.0, 3.0));
  // Folds: integer-frequency sines (periodic in u, smooth, no lattice kinks) from oval-scale bends down to ~50 km
  // curls; each arc adds one sine of its own.
  float F = 0.34 * sin(3.0 * ph + t * 0.0021) + 0.22 * sin(7.0 * ph + 2.1 - t * 0.0033)
          + 0.12 * sin(17.0 * ph + 0.7 + t * 0.006) + 0.06 * sin(41.0 * ph + 3.3 - t * 0.011)
          + 0.025 * sin(97.0 * ph + 1.3 + t * 0.03);
  float lum = pn(u * 90.0 + t * 0.05, 90.0, 41.0);
  float arcs = 0.0, rayv = 0.0;
  for (int k = 0; k < 3; k++) {
    float kf = float(k);
    float off = (kf - 1.0) * 0.6 * bw;
    float fold = (F * (1.0 - 0.2 * kf) + 0.15 * sin(5.0 * ph + 2.3 * kf + t * 0.004 * (1.0 + kf))) * bw;
    float dx = (dc - off - fold) / uOval.w;
    float a = exp(-dx * dx);
    float ray = pn(u * 3000.0 + t * 0.8 * (kf - 1.0), 3000.0, 31.0 + kf);
    float w = a * (0.3 + 0.7 * ray * ray) * (0.2 + lum * lum * 1.3) * (k == 1 ? 1.0 : 0.6);
    arcs += w; rayv += w * ray;
  }
  float diffuse = exp(-xb * xb * 1.5) * 0.08;
  float rr = arcs > 1e-4 ? rayv / arcs : 0.0;
  float hb = pn(u * 120.0, 120.0, 7.0);
  gl_FragColor = vec4((arcs + diffuse) * act, rr, hb, arcs * act);
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform mat3 uRot;
uniform vec3 uScale, uCamObj, uSunS, uMag, uE1, uE2;
uniform float uFadeA, uAurI, uPink, uUOff;
uniform vec4 uAnim;           // x: days since J2000 (cloud drift, same as surface.js cloudDensity)
uniform sampler2D tClouds;
uniform vec4 uAurR, uOval;   // (Rb, Rlo, Rhi, cos cone) ; (th0, dth, width, arcW)
uniform int uASteps;
uniform sampler2D tAurMap;
varying vec3 vWorld;

// Cloud density at unit sphere direction d: the same map, drift and sharpening as surface.js cloudDensity (without the
// close-range fbm); a fixed mip blur stands in for the screen-space gradients the raymarch pass doesn't have.
float cloudAt(vec3 d) {
  float lat = asin(clamp(d.z, -1.0, 1.0));
  float drift = uAnim.x * 0.1 + 0.04 * sin(uAnim.x * 0.5236 + 2.0 * lat) * cos(3.0 * lat);
  vec2 uv = vec2(atan(d.y, d.x) / (2.0 * PI) + 0.5 + uUOff - drift, lat / PI + 0.5);
  return smoothstep(0.22, 0.92, textureLod(tClouds, uv, 2.0).r);
}

vec3 emission(vec3 p, float r) {
  float h = r - uAurR.x;
  if (h < 88.0 || h > 400.0) return vec3(0.0);
  vec3 n = p / r;
  float zm = dot(n, uMag);
  float hemi = zm >= 0.0 ? 1.0 : -1.0;
  float colat = acos(clamp(abs(zm), 0.0, 1.0));
  float phi = atan(dot(n, uE2) * hemi, dot(n, uE1));   // magnetic local time angle, 0 = noon
  float cphi = cos(phi);
  float th0 = uOval.x - uOval.y * cphi;
  float bw = uOval.z * (1.0 + 0.5 * max(-cphi, 0.0));
  float xb = (colat - th0) / bw;
  if (abs(xb) > 1.8) return vec3(0.0);
  vec4 m = texture2D(tAurMap, vec2(phi / (2.0 * PI) + 0.5, xb / 3.6 + 0.5));
  float hb = 100.0 + 10.0 * (m.b - 0.5);
  float g = smoothstep(hb - 4.0, hb + 2.0, h) * exp(-max(h - hb, 0.0) / (25.0 + 40.0 * m.g));
  float red = smoothstep(150.0, 230.0, h) * exp(-max(h - 230.0, 0.0) / 90.0);
  float pz = (h - hb - 1.0) / 3.5, pk = exp(-pz * pz);
  vec3 em = m.r * (vec3(0.10, 1.0, 0.24) * g + vec3(1.0, 0.03, 0.12) * red * 0.16)
          + m.a * pk * uPink * vec3(0.6, 0.05, 0.45);
  float mus = dot(n, uSunS);
  return em * mix(0.05, 1.0, 1.0 - smoothstep(-0.15, 0.1, mus));
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 kk = vec3(1.0, 1.0, uScale.x / uScale.z);
  vec3 o = uCamObj * kk;
  vec3 d = normalize((transpose(uRot) * normalize(vWorld)) * kk);
  float Rb = uAurR.x, Rh = uAurR.z;
  float ro = length(o);
  float b = dot(o, d);
  vec3 pc = o - d * b;
  float q2 = dot(pc, pc);
  float disc = Rh * Rh - q2;
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float ta = max(-b - sq, 0.0), tb = -b + sq;
  if (tb <= 0.0) discard;
  float discG = Rb * Rb - q2;
  if (discG > 0.0 && b < 0.0) tb = min(tb, max((ro - Rb) * (ro + Rb), 0.0) / (-b + sqrt(discG)));
  // double cone around the magnetic axis: (m.p)^2 >= c^2 |p|^2
  float c2 = uAurR.w * uAurR.w;
  float md = dot(uMag, d), mo = dot(uMag, o);
  float A = md * md - c2, Bh = mo * md - c2 * b, C = mo * mo - c2 * dot(o, o);
  if (abs(A) < 1e-7) A = 1e-7;
  float D = Bh * Bh - A * C;
  vec2 s0 = vec2(ta, tb), s1 = vec2(1.0, 0.0);
  if (D < 0.0) { if (A < 0.0) discard; }
  else {
    float sD = sqrt(D);
    float r1 = (-Bh - sD) / A, r2 = (-Bh + sD) / A;
    if (r1 > r2) { float tmp = r1; r1 = r2; r2 = tmp; }
    if (A < 0.0) s0 = vec2(max(ta, r1), min(tb, r2));
    else { s0 = vec2(ta, min(tb, r1)); s1 = vec2(max(ta, r2), tb); }
  }
  float l0 = max(s0.y - s0.x, 0.0), l1 = max(s1.y - s1.x, 0.0);
  if (l0 + l1 <= 0.0) discard;
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  int n = int(clamp((l0 + l1) / 6.0, 12.0, float(uASteps)));
  float dt = (l0 + l1) / float(n);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 128; i++) {
    if (i >= n) break;
    float x = (float(i) + jit) * dt;
    float t = x < l0 ? s0.x + x : s1.x + (x - l0);
    vec3 p = o + d * t;
    acc += emission(p, length(p));
  }
  // Seen from below the cloud deck (~Rb + 8 km), the aurora is occluded by cloud cover along the view ray at cloud
  // height; slant rays cross a longer path of cloud, so optical depth grows as 1 / cos(zenith) (capped).
  float Rc = Rb + 8.0;
  if (ro < Rc) {
    vec3 hp = o + d * (-b + sqrt(max(Rc * Rc - q2, 0.0)));
    float cz = abs(dot(hp / Rc, d));
    acc *= exp(-3.2 * cloudAt(hp / Rc) * min(1.0 / max(cz, 0.08), 5.0));
  }
  gl_FragColor = vec4(acc * dt * uAurI * uFadeA, 0.0);
}`;

// Inside the shell (ground and low orbit) the volume covers the whole screen, so it is marched at half resolution
// into its own target from a screen quad and added back by COMP_FRAG. Inside, the mesh is drawn without depth test
// anyway (nothing in the system layer lies between the camera and the aurora shell from there), so this is the same
// image, bilinearly upsampled; the vertex shader rebuilds the camera-relative view ray the mesh path gets from vWorld.
const HALF_VERT = /* glsl */ `
uniform mat4 uInvProj;
uniform mat3 uCamRot;
varying vec3 vWorld;
void main() {
  vec4 v = uInvProj * vec4(position.xy, -1.0, 1.0);   // near plane: the far plane is at ~infinity
  vWorld = uCamRot * (v.xyz / v.w);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const HALF_FRAG = FRAG.replace('#include <logdepthbuf_pars_fragment>', '').replace('#include <logdepthbuf_fragment>', '');
const COMP_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMP_FRAG = /* glsl */ `
uniform sampler2D tHalf;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tHalf, vUv).rgb, 0.0); }`;

/** Builds the aurora mesh for a body (Earth). U: the body's shared uniforms. */
export function createAurora(app, U, geo, rec) {
  const m = geomagPole();
  const A = {
    uRot: U.uRot, uScale: U.uScale, uCamObj: U.uCamObj, uTime: app.uniforms.uTime, tClouds: U.tClouds, uAnim: U.uAnim, uUOff: U.uUOff,
    uSunS: { value: new THREE.Vector3(1, 0, 0) }, uMag: { value: new THREE.Vector3(m[0], m[1], m[2]) },
    uE1: { value: new THREE.Vector3(1, 0, 0) }, uE2: { value: new THREE.Vector3(0, 1, 0) },
    uFadeA: { value: 0 }, uAurI: { value: 2.5e-4 }, uPink: { value: 0 },
    uAurR: { value: new THREE.Vector4(rec.req, rec.req + R_LO, rec.req + R_HI, 0.8) },
    uOval: { value: new THREE.Vector4() }, uASteps: { value: 64 }, tAurMap: { value: null },
  };
  // Curtain map (see MAP_FRAG): u wraps, v clamps; rebuilt each visible frame.
  const mapMat = new THREE.ShaderMaterial({
    vertexShader: MAP_VERT, fragmentShader: MAP_FRAG, uniforms: { uTime: A.uTime, uOval: A.uOval },
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const mapScene = new THREE.Scene(), mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mapMat); quad.frustumCulled = false; mapScene.add(quad);
  let mapRT = null;
  const renderMap = (w, h) => {
    const r = app.renderer;
    if (!mapRT || mapRT.width !== w || mapRT.height !== h) {
      mapRT?.dispose();
      mapRT = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
      });
      A.tAurMap.value = mapRT.texture;
    }
    const prev = r.getRenderTarget();
    r.setRenderTarget(mapRT); r.render(mapScene, mapCam); r.setRenderTarget(prev);
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: A,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const s = (1 + R_HI / rec.req) * 1.02;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(rec.req * s, rec.req * s, rec.rpol * s); mesh.frustumCulled = false; mesh.renderOrder = 22;
  const shellR = rec.req * s;
  // Half-resolution path (see HALF_VERT), used while the camera is inside the shell.
  const halfU = { ...A, uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() } };
  const halfMat = new THREE.ShaderMaterial({ vertexShader: HALF_VERT, fragmentShader: HALF_FRAG, uniforms: halfU,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const halfScene = new THREE.Scene();
  const halfQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), halfMat); halfQuad.frustumCulled = false; halfScene.add(halfQuad);
  let halfRT = null, halfPending = false;
  const compMat = new THREE.ShaderMaterial({
    vertexShader: COMP_VERT, fragmentShader: COMP_FRAG, uniforms: { tHalf: { value: null } },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const comp = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat);
  comp.frustumCulled = false; comp.renderOrder = 22; comp.visible = false;
  // Runs from the render graph's pre-passes, after every update and before the system layer is drawn.
  app.graph?.prePasses?.push((r) => {
    comp.visible = halfPending;
    if (!halfPending) return;
    halfPending = false;
    const w = Math.max(1, Math.ceil((app.graph.size?.w || 2) / 2)), h = Math.max(1, Math.ceil((app.graph.size?.h || 2) / 2));
    if (!halfRT || halfRT.width !== w || halfRT.height !== h) {
      halfRT?.dispose();
      halfRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      compMat.uniforms.tHalf.value = halfRT.texture;
    }
    const cam = app.cameras.system;
    cam.updateMatrixWorld();
    halfU.uInvProj.value.copy(cam.projectionMatrixInverse);
    halfU.uCamRot.value.setFromMatrix4(cam.matrixWorld);
    const prev = r.getRenderTarget();
    r.setRenderTarget(halfRT); r.render(halfScene, mapCam); r.setRenderTarget(prev);
  });
  let inside = false, kpSet = null;
  const kpOf = () => kpSet ?? app.settings?.kp ?? 3;
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const k = rec.req / rec.rpol;
  const api = {
    mesh, comp,
    setKp(v) { kpSet = v; },
    get kp() { return kpOf(); },
    update(f, camR, steps) {
      const kp = kpOf();
      const fade = U.uFade.value * smooth(60, 250, rec.px) * (kp > 0 ? 1 : 0);
      A.uFadeA.value = fade;
      mesh.visible = fade > 0.001;
      if (!mesh.visible) return;
      const useHalf = !!app.graph?.prePasses && camR < shellR * 1.003;
      const o = ovalParams(kp);
      A.uOval.value.set(o.th0, o.dth, o.width, o.arcW);
      A.uAurR.value.w = Math.cos(o.th0 + o.dth + o.width * 1.5 * 1.8 + 0.02);
      A.uAurI.value = 2.5e-4 * (0.25 + 0.25 * kp);
      A.uPink.value = smooth(4.5, 7, kp);
      A.uASteps.value = steps;
      renderMap(steps >= 40 ? 4096 : 2048, steps >= 40 ? 192 : 128);
      // Sun in sphere space and the magnetic noon/dusk axes.
      const su = U.uSunObj.value, S = A.uSunS.value.set(su.x, su.y, su.z * k).normalize();
      const M = A.uMag.value, sm = S.dot(M);
      const e1 = A.uE1.value.set(S.x - M.x * sm, S.y - M.y * sm, S.z - M.z * sm);
      if (e1.lengthSq() < 1e-8) e1.set(1, 0, 0); e1.normalize();
      A.uE2.value.crossVectors(M, e1);
      const now = camR < shellR * 1.003;
      if (now !== inside) { inside = now; mat.side = inside ? THREE.BackSide : THREE.FrontSide; mat.depthTest = !inside; }
      if (useHalf) { mesh.visible = false; halfPending = true; }
    },
  };
  app.shared.aurora = api;
  return api;
}
