import * as THREE from 'three';
import { NOISE } from 'orion/render/bodies/glsl.js';
import { MAX_SPOTS } from 'orion/render/bodies/math.js';

// The Sun: photosphere sphere (granulation, supergranulation, sunspots, limb darkening) and a camera-facing
// billboard for the chromosphere rim, prominences and the K-corona. Radiance convention: disc mean = 4.6e4.

const SUN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const SUN_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
uniform vec3 uCamObj;
uniform float uRadius, uTime, uFade;
uniform vec4 uSpots[${MAX_SPOTS}];
varying vec3 vDir;
void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  vec3 V = normalize(uCamObj - dir * uRadius);
  float mu = clamp(dot(dir, V), 0.0, 1.0);
  const vec3 LD = vec3(0.52, 0.62, 0.73);
  vec3 limb = 1.0 - LD * (1.0 - mu);
  vec3 norm = 1.0 / (1.0 - LD / 3.0);
  vec3 col = vec3(1.0, 0.955, 0.885) * limb * norm * 4.6e4 / 0.956;

  // convection: granules (~1 Mm) and supergranules (~30 Mm), faded when below a pixel
  vec3 pg = dir * 700.0, ps = dir * 23.0;
  float fg = 1.0 - smoothstep(0.25, 0.9, length(fwidth(pg)));
  float fs = 1.0 - smoothstep(0.25, 0.9, length(fwidth(ps)));
  if (fg > 0.0) {
    vec2 w = worley(pg, uTime * 0.6);
    float lane = smoothstep(0.0, 0.2, w.y - w.x);
    col *= mix(1.0, mix(0.72, 1.07, lane), fg);
  }
  if (fs > 0.0) {
    vec2 w = worley(ps, uTime * 0.05 + 3.0);
    col *= mix(1.0, 0.94 + 0.12 * smoothstep(0.0, 0.3, w.y - w.x), fs);
  }
  // sunspots: umbra, fibrilled penumbra
  float spot = 1.0;
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    vec4 s = uSpots[i];
    if (s.w <= 0.0) continue;
    vec3 sd = vec3(cos(s.x) * cos(s.y), cos(s.x) * sin(s.y), sin(s.x));
    float ang = atan(length(cross(dir, sd)), dot(dir, sd));
    float rr = ang / s.z;
    if (rr > 1.0) continue;
    float fib = 0.5 + 0.5 * vnoise(vec3(atan(dot(cross(sd, dir), vec3(0.0, 0.0, 1.0)), dot(dir - sd * dot(dir, sd), vec3(1.0, 0.0, 0.0))) * 6.0, rr * 4.0, float(i)));
    float pen = mix(0.62, 0.86, fib);
    float v = rr < 0.42 ? mix(0.22, pen, smoothstep(0.3, 0.42, rr)) : pen;
    v = mix(1.0, v, smoothstep(1.0, 0.85, rr) * s.w);
    spot = min(spot, v);
  }
  col *= spot;
  gl_FragColor = vec4(col * uFade, uFade);
}`;

const COR_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const COR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
uniform float uSizeRs, uAct, uFade, uDays;
uniform vec2 uAxis;
varying vec2 vP;
float h1(float n) { return fract(sin(n * 127.1 + 17.3) * 43758.5453); }
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vP) * uSizeRs;
  if (r < 1.0) discard;
  float th = atan(vP.y, vP.x);
  vec2 u2 = vP / max(length(vP), 1e-5);
  float sinPhi = dot(u2, uAxis);
  float eq = pow(max(1.0 - sinPhi * sinPhi, 0.0), 1.5);
  // Baumbach (1937) K-corona: 4e-6 of the mean disc brightness at 1 solar radius
  float B = 1e-6 * (0.0532 * pow(r, -2.5) + 1.425 * pow(r, -7.0) + 2.565 * pow(r, -17.0));
  float shape = mix(0.35 + 1.9 * eq, 1.0, uAct);
  float n = vnoise(vec3(cos(th) * 5.0, sin(th) * 5.0, 3.1));
  float ray = mix(1.0, 0.3 + 1.7 * n * n, smoothstep(1.2, 3.0, r));
  float rad = mix(1.0, pow(r, 0.9 * eq + 0.0), 1.0 - uAct * 0.5);
  vec3 col = vec3(1.0, 0.96, 0.9) * 4.6e4 * B * shape * ray * rad;
  col *= smoothstep(1.0, 0.82, r / uSizeRs);
  // chromosphere rim (hydrogen-alpha red)
  col += vec3(1.0, 0.24, 0.18) * 180.0 * exp(-(r - 1.0) / 0.0045) * (0.7 + 0.5 * vnoise(vec3(th * 40.0, uDays * 0.1, 0.0)));
  // prominences
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float life = 12.0 + 20.0 * h1(fi + 4.0);
    float slot = floor((uDays + h1(fi) * life) / life);
    float age = fract((uDays + h1(fi) * life) / life);
    float pth = 6.2831853 * h1(slot * 7.0 + fi * 13.0);
    float act = h1(slot * 3.0 + fi + 100.0) < (0.45 + 0.5 * uAct) ? 1.0 : 0.0;
    float wd = 0.03 + 0.06 * h1(slot + fi * 5.0);
    float ht = 0.04 + 0.12 * h1(slot * 2.0 + fi * 9.0);
    float dth = mod(th - pth + 3.14159265, 6.2831853) - 3.14159265;
    float x = dth / wd;
    if (abs(x) < 1.0) {
      float arch = ht * sqrt(max(1.0 - x * x, 0.0));
      float d = abs(r - 1.0 - arch);
      float thick = 0.006 + 0.01 * ht;
      float k = exp(-pow(d / thick, 2.0)) * sin(3.14159265 * age) * act;
      col += vec3(1.0, 0.3, 0.24) * 320.0 * k;
    }
  }
  gl_FragColor = vec4(col * uFade, 0.0);
}`;

export function createSun(geometry) {
  const uniforms = {
    uCamObj: { value: new THREE.Vector3() }, uRadius: { value: 695700 }, uTime: { value: 0 }, uFade: { value: 1 },
    uSpots: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4()) },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, uniforms, blending: THREE.NoBlending });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const cu = { uSizeRs: { value: 14 }, uAct: { value: 0.5 }, uFade: { value: 1 }, uDays: { value: 0 }, uAxis: { value: new THREE.Vector2(0, 1) } };
  const cmat = new THREE.ShaderMaterial({
    vertexShader: COR_VERT, fragmentShader: COR_FRAG, uniforms: cu, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cmat);
  corona.frustumCulled = false; corona.renderOrder = 5;
  return { mesh, corona, uniforms, coronaUniforms: cu };
}

// ---- system-scale glow ----------------------------------------------------------------------------------------
// When the Sun is a few pixels across, its true radiance (4.6e4 per pixel) times a planet-metered exposure makes the
// compositor's threshold-free bloom spread a 100 px white disc over the inner planets. index.js caps the disc's
// radiance there and draws this instead: a tight core plus a faint halo and four diffraction spikes, fixed in pixels
// and in displayed brightness (the colour is pre-divided by the system exposure).
const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uPx;
void main() {
  gl_PointSize = uPx;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const GLOW_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uPx, uGain, uCore;
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = (gl_PointCoord - 0.5) * uPx;          // pixels from the centre
  float r = length(p);
  float core = exp(-0.5 * r * r / (uCore * uCore)) * 6.0;
  float halo = 0.06 / pow(1.0 + r * r / 9.0, 1.2);
  float spk = exp(-abs(p.x) / 0.7) + exp(-abs(p.y) / 0.7);
  spk *= 0.05 * exp(-r / (uPx * 0.16));
  float edge = 1.0 - smoothstep(0.35, 0.5, r / uPx);
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * (core + halo + spk) * edge * uGain, 0.0);
}`;

export function createSunGlow() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e20);
  const uniforms = { uPx: { value: 72 }, uGain: { value: 0 }, uCore: { value: 1.2 } };
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));
  pts.frustumCulled = false; pts.renderOrder = 31;
  return { points: pts, uniforms };
}
