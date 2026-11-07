// Kirkwood-gap overlay: the real semi-major-axis histogram of the loaded asteroid catalogue (H < 15, ~76k objects) painted
// as a faint density disc in the ecliptic plane under the belt points. The gaps are only ~0.02-0.05 AU wide (a fraction of a
// pixel at belt-wide views, and 76k additive points saturate anyway), so a continuous 1-D density map, mip-filtered, makes
// them legible at every zoom: dark slits where the 3:1 (2.50 AU), 5:2 (2.82), 7:3 (2.95) and 2:1 (3.27) resonances have
// swept the belt clear. Nothing is removed or invented: brightness is the catalogue's own local density relative to its
// smooth (+-0.12 AU) average, stretched so a 70% deficit reads as nearly black. `enabled` toggles it (default on).
import * as THREE from 'three';
import { AU } from 'orion/core/units.js';

const AU_KM = AU / 1000;
const A0 = 1.8, A1 = 3.6, NB = 2048;            // histogram range (AU) and bins (0.00088 AU each)

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vXY;
void main() {
  vXY = position.xy;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D tHist;
uniform float uW, uExpInv;
varying vec2 vXY;
void main() {
  #include <logdepthbuf_fragment>
  float a = length(vXY) / ${AU_KM.toFixed(3)};
  float u = (a - ${A0.toFixed(2)}) / ${(A1 - A0).toFixed(2)};
  vec2 h = texture2D(tHist, vec2(u, 0.5)).rg;        // r: density / peak, g: density relative to the local average (0..1, 0.5 = average)
  // honest density with the deficit stretched: rel 1 = belt-average, <0.3 = a gap
  float rel = h.g * 2.0;
  float lit = smoothstep(0.12, 0.85, rel);
  float v = h.r * lit;
  gl_FragColor = vec4(vec3(0.34, 0.29, 0.22) * (v * uW * uExpInv), 0.0);
}`;

export function createKirkwood(app, belt, count) {
  const raw = new Float32Array(NB);
  for (let k = 0; k < count; k++) {
    const a = belt[k * 7], b = Math.floor(((a - A0) / (A1 - A0)) * NB);
    if (b >= 0 && b < NB) raw[b] += 1;
  }
  const blur = (src, sigmaBins) => {          // separable gaussian on a 1-D array (edges clamp)
    const R = Math.ceil(sigmaBins * 3), w = []; let s = 0;
    for (let i = -R; i <= R; i++) { const g = Math.exp(-0.5 * (i / sigmaBins) ** 2); w.push(g); s += g; }
    const out = new Float32Array(NB);
    for (let i = 0; i < NB; i++) { let acc = 0; for (let j = -R; j <= R; j++) acc += w[j + R] * src[Math.min(NB - 1, Math.max(0, i + j))]; out[i] = acc / s; }
    return out;
  };
  const fine = blur(raw, 1.5), broad = blur(raw, 0.12 / ((A1 - A0) / NB));   // ~0.0013 AU smoothing vs ~0.12 AU average
  let peak = 1; for (let i = 0; i < NB; i++) peak = Math.max(peak, broad[i]);
  const px = new Uint8Array(NB * 4);
  for (let i = 0; i < NB; i++) {
    const rel = fine[i] / Math.max(broad[i], 3);   // floor so empty outskirts don't flicker
    const edge = Math.min(1, broad[i] / (0.06 * peak));   // no overlay where the belt itself has ended
    px[i * 4] = Math.round(255 * Math.min(1, broad[i] / peak) * Math.min(1, edge));
    px[i * 4 + 1] = Math.round(255 * Math.min(1, rel * 0.5));
    px[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(px, NB, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: { tHist: { value: tex }, uW: { value: 0 }, uExpInv: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(A0 * AU_KM, A1 * AU_KM, 384, 1), mat);
  mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.visible = false; mesh.name = 'kirkwood-density';
  app.layers.system.add(mesh);
  const zero = new Float64Array(3);
  const api = {
    mesh, enabled: true, hist: { raw, fine, broad },
    update(frame, weight, expInv) {
      const cam = frame.camPos, zAU = Math.abs(cam[2]) / AU;
      // fade out when the camera is inside the belt plane (it would just haze the view) and with the level crossfade
      const t = Math.min(1, Math.max(0, (zAU - 0.08) / 0.5)), w = weight * t * t * (3 - 2 * t) * (api.enabled ? 1 : 0);
      mesh.visible = w > 0.003;
      if (!mesh.visible) return;
      app.toSystem(zero, mesh.position);
      mat.uniforms.uW.value = w * 0.12; mat.uniforms.uExpInv.value = expInv;
    },
  };
  return api;
}
