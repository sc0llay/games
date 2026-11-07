import * as THREE from 'three';

// Jupiter / Saturn aurora: a cheap cousin of aurora.js. One additive emissive shell ~1% above the cloud tops (about
// 700 km at Jupiter, 600 km at Saturn), with the emission painted analytically by magnetic colatitude: a thin main oval
// (patchy, slowly drifting in longitude, dawn-side brighter), a fainter diffuse polar cap inside it and a soft outer halo.
// Violet-pink (H2 Lyman/Werner bands leak into the near-UV and blue, H-alpha pink), very faint: it only reads against the
// night side or in close views (the dayside fraction is cut to 15%). No raymarch, no extra targets, one fragment shader
// whose cost is a handful of sin/exp. The oval widths widen to ~1 px at a distance (energy preserved) so it never aliases.
// Magnetic axes in the body-fixed frame: Jupiter's dipole is tilted 9.4 deg toward System III longitude 202 deg (so the
// northern oval wobbles in latitude as the planet turns); Saturn's is aligned to within a degree (offset 0.8 deg).

const DEG = Math.PI / 180;
const CFG = {
  jupiter: { tilt: 9.4, lon: 202, c0: 16, w: 1.3, tint: [0.50, 0.22, 1.0], gain: 0.0045 },
  saturn: { tilt: 0.8, lon: 0, c0: 14, w: 1.1, tint: [0.75, 0.28, 0.95], gain: 0.003 },
};
export const hasGiantAurora = (id) => !!CFG[id];

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunObj, uMag, uTint, uCamObj, uScale;
uniform float uTime, uFade, uI, uC0, uW;
varying vec3 vDir;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vDir);
  float zm = dot(n, uMag);
  float colat = acos(clamp(abs(zm), 0.0, 1.0));
  // longitude about the magnetic axis (any fixed reference is fine: the pattern is procedural)
  vec3 e1 = normalize(cross(uMag, vec3(0.0, 1.0, 0.31)));
  vec3 e2 = cross(uMag, e1);
  float phi = atan(dot(n, e2), dot(n, e1)) * (zm >= 0.0 ? 1.0 : -1.0);
  // pixel footprint in colatitude (radians): widen thin features to ~1.2 px, keeping their integrated energy
  float fw = max(fwidth(colat), 1e-5) * 1.2;
  float w = max(uW, fw), kE = uW / w;
  float x = (colat - uC0) / w;
  float t = uTime * 0.02;
  float pat = 0.45 + 0.30 * sin(2.0 * phi + 1.3 + t) + 0.18 * sin(5.0 * phi - 0.7 - 1.7 * t) + 0.07 * sin(11.0 * phi + 2.0 + 3.1 * t);
  float dawn = 0.7 + 0.3 * cos(phi - 0.6);                       // brighter on the dawn side of the oval
  float main = exp(-x * x) * pat * dawn * kE;
  float cap = (1.0 - smoothstep(uC0 * 0.85, uC0 * 1.0, colat)) * 0.08 * (0.6 + 0.4 * colat / uC0);   // phi-free and smooth: no pinwheel or rings at the pole
  float halo = exp(-max(colat - uC0, 0.0) / (uW * 2.5)) * 0.07 * smoothstep(uC0 * 0.8, uC0 * 1.0, colat) * kE;
  float em = main + cap + halo;
  float night = 1.0 - smoothstep(-0.06, 0.3, dot(n, uSunObj));
  // limb brightening of a thin emitting layer: the slant path grows as 1 / cos(view angle)
  vec3 v = normalize(uCamObj - n * uScale);
  float mu = max(dot(n, v), 0.0);
  float slant = 1.0 / max(mu, 0.25);
  gl_FragColor = vec4(uTint * (em * uI * uFade * mix(0.15, 1.0, night) * slant), 0.0);
}`;

/** Builds the aurora shell for gas giant `rec` (jupiter | saturn). U: the body's shared uniforms. Returns { mesh, update }. */
export function createGiantAurora(app, U, geo, rec) {
  const c = CFG[rec.id];
  const mag = new THREE.Vector3(Math.sin(c.tilt * DEG) * Math.cos(c.lon * DEG), Math.sin(c.tilt * DEG) * Math.sin(c.lon * DEG), Math.cos(c.tilt * DEG));
  const uniforms = {
    uSunObj: U.uSunObj, uCamObj: U.uCamObj, uScale: U.uScale, uTime: app.uniforms.uTime,
    uMag: { value: mag }, uTint: { value: new THREE.Vector3(...c.tint) }, uFade: { value: 0 }, uI: { value: c.gain },
    uC0: { value: c.c0 * DEG }, uW: { value: c.w * DEG },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const s = 1.01;
  mesh.scale.set(rec.req * s, rec.req * s, rec.rpol * s); mesh.frustumCulled = false; mesh.renderOrder = 22; mesh.visible = false;
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return {
    mesh,
    update() {
      const fade = U.uFade.value * smooth(40, 120, rec.px);   // too small to resolve an oval below ~40 px
      uniforms.uFade.value = fade;
      mesh.visible = fade > 0.001;
      if (!mesh.visible) return;
      mesh.position.copy(rec.surface.position); mesh.quaternion.copy(rec.q);
    },
  };
}
