// Planetary rings: radial-profile ring shader (lit/unlit side, phase function, planet shadow, Saturnshine)
// and a camera-centred instanced ice-chunk field near Saturn's ring plane.
import * as THREE from 'three';
import { AU } from 'orion/core/units.js';
import { getRingProfile, hasRings } from 'orion/render/small/ringProfile.js';

const GLSL_COMMON = /* glsl */ `
float h11(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
vec3 h13(float n) { return vec3(h11(n), h11(n + 17.1), h11(n + 53.7)); }
// Analytic shadow of an oblate planet (radius Re, flattening factor flat = Rp/Re) at ring-frame point P, sun direction L.
float planetShadow(vec3 P, vec3 L, float Re, float flt, float tanSun) {
  vec3 p = vec3(P.xy, P.z / flt);
  vec3 l = normalize(vec3(L.xy, L.z / flt));
  float s = -dot(p, l);
  if (s <= 0.0) return 1.0;
  float d = length(p + s * l);
  float w = tanSun * s + 1.0;
  return smoothstep(Re - w, Re + w, d);
}
`;

const RING_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const RING_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uProfile, uTauTex;
uniform float uInner, uOuter, uPlanetR, uFlat, uSunE, uTanSun, uTauScale, uPlanetAlbedo, uArcPhase, uSpike;
uniform vec3 uSunL, uCamLocal, uHole;
uniform int uKind;
varying vec3 vLocal;
${GLSL_COMMON}
float vn(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h11(i), h11(i + 1.0), f); }
float hg(float g, float c) { float g2 = g * g; return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-3), 1.5); }
float win(float a, float b, float x) { return smoothstep(a - 1.5, a, x) * (1.0 - smoothstep(b, b + 1.5, x)); }

void main() {
  #include <logdepthbuf_fragment>
  vec3 P = vLocal;
  float r = length(P.xy);
  float u = (r - uInner) / (uOuter - uInner);
  if (u < 0.0 || u > 1.0) discard;
  vec4 prof = texture2D(uProfile, vec2(u, 0.5));
  vec4 tt = texture2D(uTauTex, vec2(u, 0.5));
  float tau = tt.r / uTauScale, fwd = tt.g;
  vec3 albedo = prof.rgb;

  // Sub-texel ringlet structure, faded out by the pixel footprint (km per pixel) to avoid shimmer.
  float fp = max(fwidth(r), 1e-4);
  float n = 0.0;
  float w1 = 1.0 - smoothstep(0.2 * 1.6, 0.8 * 1.6, fp), w2 = 1.0 - smoothstep(0.2 * 5.0, 0.8 * 5.0, fp), w3 = 1.0 - smoothstep(0.2 * 16.0, 0.8 * 16.0, fp);
  n += w1 * (vn(r / 1.6 + 11.0) - 0.5) * 0.8 + w2 * (vn(r / 5.0 + 3.0) - 0.5) * 1.1 + w3 * (vn(r / 16.0 + 7.0) - 0.5) * 1.2;
  tau *= exp(1.4 * n * smoothstep(0.015, 0.5, tau));
  // Neptune's Adams-ring arcs: azimuthal mask, co-rotating with the ring.
  if (uKind == 3 && tt.b > 0.5) {
    float a = mod(degrees(atan(P.y, P.x) - uArcPhase), 360.0);
    float arc = max(max(win(0.0, 3.0, a), win(7.0, 10.0, a)), max(win(13.0, 21.0, a), win(24.0, 46.0, a)));
    tau *= mix(0.12, 9.0, arc);
  }

  vec3 V = normalize(uCamLocal - P), L = normalize(uSunL);
  float mu = max(abs(V.z), 0.015), mu0 = max(abs(L.z), 0.015);
  bool sameSide = V.z * L.z > 0.0;
  float cosA = clamp(dot(V, L), -1.0, 1.0);
  float alpha = acos(cosA), cosT = -cosA;
  // Phase: backscatter lobe for dense/icy particles, forward lobe for dust, plus an opposition surge.
  // Dust (fwd → 1) scatters mostly forward: two Henyey-Greenstein lobes plus a diffraction spike that only exists for optically thin
  // material and only within a few degrees of looking straight back at the Sun (alpha → 180°). Jupiter's rings live on this lobe.
  float spike = uSpike * exp(-8.0 * tau) * exp(-(3.14159265 - alpha) / 0.1);
  float dustPh = 0.5 * hg(0.60, cosT) + 0.5 * hg(0.92, cosT) + spike;
  float phase = (1.0 - fwd) * hg(-0.30, cosT) * (1.0 + 0.7 * exp(-alpha / 0.05)) + fwd * dustPh;

  float shadow = planetShadow(P, L, uPlanetR, uFlat, uTanSun);
  float trans = 1.0 - exp(-tau / mu);          // fraction of the background hidden
  float R;
  if (sameSide) {
    R = 0.55 * (mu0 / (mu + mu0)) * (1.0 - exp(-tau * (1.0 / mu + 1.0 / mu0))) * phase;
  } else { // unlit face: diffuse transmission. Peaks near τ ≈ μ, so the B ring is dark while C, A and the Cassini Division glow.
    float T = abs(mu0 - mu) < 2e-3 ? (tau / mu0) * exp(-tau / mu0) : (mu0 / (mu0 - mu)) * (exp(-tau / mu0) - exp(-tau / mu));
    R = 0.55 * T * phase + 0.012 * trans * exp(-0.25 * tau / mu0);
  }
  // Saturnshine: light reflected by the planet's lit hemisphere (strongest on the sunward half, absent in the night half).
  vec3 Ph = vec3(normalize(P.xy), 0.0);
  float shine = 0.5 * uPlanetAlbedo * pow(uPlanetR / max(r, uPlanetR), 2.0) * 0.5 * (1.0 + dot(L, Ph)) * trans;
  vec3 rad = albedo * (R * shadow + shine) * uSunE;

  // Under the ice-chunk field the flat sheet is dimmed (the chunks carry the detail) but kept as the fine-particle background.
  float k = mix(0.5, 1.0, smoothstep(uHole.z * 0.55, uHole.z, length(P.xy - uHole.xy)));
  if (uHole.z <= 0.0) k = 1.0;
  gl_FragColor = vec4(rad * k, trans * k);   // premultiplied: rgb = scattered radiance, a = coverage
}`;

const CHUNK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec2 uCamXY, uCamFract; uniform float uS, uThick, uInner, uOuter;
uniform sampler2D uTauTex, uProfile;
varying vec3 vWorld, vCenter, vLoc, vCol;
${GLSL_COMMON}
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0 + i.z * 113.0;
  return mix(mix(mix(h11(n), h11(n + 1.0), f.x), mix(h11(n + 57.0), h11(n + 58.0), f.x), f.y),
             mix(mix(h11(n + 113.0), h11(n + 114.0), f.x), mix(h11(n + 170.0), h11(n + 171.0), f.x), f.y), f.z);
}
void main() {
  float id = float(gl_InstanceID);
  vec3 h = h13(id), h2 = h13(id + 4093.0);
  vec2 rel = (fract(h.xy - uCamFract) - 0.5) * uS;
  float edge = 1.0 - smoothstep(0.36, 0.5, max(abs(rel.x), abs(rel.y)) / uS);
  vec2 wxy = uCamXY + rel;
  float rr = length(wxy);
  float u = (rr - uInner) / (uOuter - uInner);
  vec4 tt = texture2D(uTauTex, vec2(clamp(u, 0.0, 1.0), 0.5));
  float op = 1.0 - exp(-tt.r);
  float show = step(h2.z, min(1.0, op * 1.25)) * step(0.0, u) * step(u, 1.0);
  float rad = uS * 0.0022 * (0.35 + 1.7 * pow(h2.x, 3.0)) * edge;
  vec3 axis = normalize(h * 2.0 - 1.0 + vec3(0.001));
  float ang = h2.y * 6.2831853;
  vec3 d = normalize(position);
  float nn = 0.72 + 0.55 * vn3(d * 2.3 + h2 * 20.0);
  vec3 q = d * nn * (0.62 + 0.38 * vec3(h2.y, h.x, h2.z));
  q = q * cos(ang) + cross(axis, q) * sin(ang) + axis * dot(axis, q) * (1.0 - cos(ang)); // Rodrigues
  float zc = (h.z - 0.5) * 2.0 * uThick;
  vec3 local = vec3(rel, zc) + q * rad;
  vec4 wp = modelMatrix * vec4(local, 1.0);
  vWorld = wp.xyz; vCenter = (modelMatrix * vec4(rel, zc, 1.0)).xyz;
  vLoc = vec3(wxy, zc);
  vCol = texture2D(uProfile, vec2(clamp(u, 0.0, 1.0), 0.5)).rgb * (0.8 + 0.4 * h2.x);
  gl_Position = projectionMatrix * viewMatrix * wp;
  if (show < 0.5 || rad <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}`;

const CHUNK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunW, uSunL; uniform float uSunE, uPlanetR, uFlat, uTanSun;
varying vec3 vWorld, vCenter, vLoc, vCol;
${GLSL_COMMON}
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(N, vWorld - vCenter) < 0.0) N = -N;
  float s = planetShadow(vLoc, uSunL, uPlanetR, uFlat, uTanSun);
  float lit = max(dot(N, uSunW), 0.0) * s;
  vec3 c = vCol * (0.92 * lit + 0.10) * uSunE;
  gl_FragColor = vec4(c, 1.0);
}`;

// Peak of the diffraction spike (relative to isotropic) for each planet's dust: Jupiter's micron dust makes it visible at all.
const SPIKE = { saturn: 40, jupiter: 12000, uranus: 300, neptune: 300 };
const KIND = { saturn: 0, jupiter: 1, uranus: 2, neptune: 3 };

function annulus(inner, outer, segA = 256, segR = 6) {
  const pos = new Float32Array((segA + 1) * (segR + 1) * 3), idx = [];
  for (let j = 0; j <= segR; j++) for (let i = 0; i <= segA; i++) {
    const r = inner + (outer - inner) * (j / segR), a = (i / segA) * Math.PI * 2, o = (j * (segA + 1) + i) * 3;
    pos[o] = r * Math.cos(a); pos[o + 1] = r * Math.sin(a); pos[o + 2] = 0;
  }
  for (let j = 0; j < segR; j++) for (let i = 0; i < segA; i++) {
    const a = j * (segA + 1) + i, b = a + 1, c = a + segA + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}

export function createRings(app) {
  const eph = app.shared.ephemeris;
  const entries = [];
  const premult = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };

  for (const body of eph.BODIES) {
    if (!hasRings(body.id)) continue;
    const prof = getRingProfile(body.id);
    const Re = (body.equatorialRadius ?? body.radius) / 1000, Rp = (body.polarRadius ?? body.radius) / 1000;
    const mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG, side: THREE.DoubleSide, ...premult,
      uniforms: {
        uProfile: { value: prof.texture }, uTauTex: { value: prof.tauTexture }, uInner: { value: prof.innerKm }, uOuter: { value: prof.outerKm },
        uPlanetR: { value: Re }, uFlat: { value: Rp / Re }, uSunE: { value: 1 }, uTauScale: { value: prof.tauScale }, uTanSun: { value: 5e-4 },
        uPlanetAlbedo: { value: prof.planetAlbedo }, uArcPhase: { value: 0 }, uSpike: { value: SPIKE[body.id] ?? 100 }, uSunL: { value: new THREE.Vector3(1, 0, 0) },
        uCamLocal: { value: new THREE.Vector3() }, uHole: { value: new THREE.Vector3() }, uKind: { value: KIND[body.id] },
      },
    });
    const mesh = new THREE.Mesh(annulus(prof.innerKm, prof.outerKm), mat);
    // Order 25: after the atmosphere shell (20), which writes no depth and would paint over the near ring.
    mesh.frustumCulled = false; mesh.renderOrder = 25; mesh.matrixAutoUpdate = true; mesh.name = `rings-${body.id}`;
    app.layers.system.add(mesh);
    const e = { id: body.id, body, prof, mesh, mat, Re, Rp, chunks: null };
    if (body.id === 'saturn') e.chunks = makeChunks(app, e);
    entries.push(e);
  }

  const world = new Float64Array(3), q = new THREE.Quaternion(), qInv = new THREE.Quaternion(), tmp = new THREE.Vector3(), cam = new THREE.Vector3(), sun = new THREE.Vector3();
  function update(frame) {
    for (const e of entries) {
      eph.heliocentric(e.id, frame.jd, world);
      const dx = world[0] - frame.camPos[0], dy = world[1] - frame.camPos[1], dz = world[2] - frame.camPos[2];
      const distKm = Math.hypot(dx, dy, dz) / 1000;
      const vis = distKm < e.prof.outerKm * 6000;
      e.mesh.visible = vis;
      if (!vis) { if (e.chunks) e.chunks.mesh.visible = false; continue; }
      app.toSystem(world, e.mesh.position);
      eph.bodyQuaternion(e.id, frame.jd, q); e.mesh.quaternion.copy(q); qInv.copy(q).invert();
      const u = e.mat.uniforms;
      const sd = Math.hypot(world[0], world[1], world[2]);
      sun.set(-world[0] / sd, -world[1] / sd, -world[2] / sd);
      u.uSunE.value = (AU / sd) ** 2;
      u.uTanSun.value = 6.957e8 / sd;
      u.uSunL.value.copy(sun).applyQuaternion(qInv);
      cam.set(-dx / 1000, -dy / 1000, -dz / 1000).applyQuaternion(qInv); // camera in the ring frame, km (float64 until upload)
      u.uCamLocal.value.copy(cam);
      if (e.id === 'neptune') u.uArcPhase.value = ((820.1 * (frame.jd - 2451545) * Math.PI / 180) % (Math.PI * 2));
      u.uHole.value.set(0, 0, 0);
      if (e.chunks) e.chunks.update(frame, cam, q, sun, u, sd, e);
    }
  }
  return { update, entries };
}

function makeChunks(app, ring) {
  const COUNT = 12000;
  const base = new THREE.IcosahedronGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index; g.setAttribute('position', base.attributes.position); g.instanceCount = COUNT;
  const mat = new THREE.ShaderMaterial({
    vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG,
    uniforms: {
      uCamXY: { value: new THREE.Vector2() }, uCamFract: { value: new THREE.Vector2() }, uS: { value: 1 }, uThick: { value: 0.005 },
      uInner: { value: ring.prof.innerKm }, uOuter: { value: ring.prof.outerKm }, uTauTex: { value: ring.prof.tauTexture }, uProfile: { value: ring.prof.texture },
      uSunW: { value: new THREE.Vector3() }, uSunL: { value: new THREE.Vector3() }, uSunE: { value: 1 }, uPlanetR: { value: ring.Re }, uFlat: { value: ring.Rp / ring.Re }, uTanSun: { value: 5e-4 },
    },
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'saturn-ice-chunks';
  app.layers.system.add(mesh);
  const off = new THREE.Vector3();
  return {
    mesh,
    update(frame, camLocal, q, sunW, ringU, sunDist) {
      const alt = Math.abs(camLocal.z), rc = Math.hypot(camLocal.x, camLocal.y);
      const active = alt < 2000 && rc > ring.prof.innerKm - 500 && rc < ring.prof.outerKm + 500;
      mesh.visible = active;
      if (!active) return;
      // Cell size steps in powers of two with altitude so the field is stable between steps.
      const S = 0.5 * 2 ** Math.round(Math.log2(Math.min(6, Math.max(0.5, alt * 3)) / 0.5));
      const u = mat.uniforms;
      u.uS.value = S; u.uThick.value = Math.max(0.004, S * 0.002);
      u.uCamXY.value.set(camLocal.x, camLocal.y);
      const fx = camLocal.x / S, fy = camLocal.y / S; // float64 → fractional part only goes to the GPU
      u.uCamFract.value.set(fx - Math.floor(fx), fy - Math.floor(fy));
      u.uSunW.value.copy(sunW); u.uSunL.value.copy(ringU.uSunL.value); u.uSunE.value = ringU.uSunE.value; u.uTanSun.value = ringU.uTanSun.value;
      // The mesh origin is the point of the ring plane straight below (or above) the camera.
      off.set(0, 0, -camLocal.z).applyQuaternion(q);
      mesh.position.copy(off); mesh.quaternion.copy(q);
      ringU.uHole.value.set(camLocal.x, camLocal.y, alt < 4 ? S * 0.5 : 0);
    },
  };
}
