import * as THREE from 'three';
import { PC } from 'orion/core/units.js';
import { radecToWorld } from 'orion/core/frames.js';
import { VOL_GLSL, EXT_GLSL } from 'orion/galaxy/volume.js';

// External galaxies (Andromeda, Triangulum, the Messier / Caldwell galaxies): one photographic quad per catalogue galaxy,
// drawn live in the sky layer. The photograph (tools/fetch_galaxies.py, data/galaxies) is the view from Earth, so the
// quad is fixed in space, perpendicular to the Sun's line of sight with celestial north up: correct from anywhere near
// the Milky Way, and a flat disc when flown around. Galaxies without a usable photograph get a procedural elliptical
// glow. Surface brightness is in sky units and distance-independent while resolved; below uMinPx the quad keeps a
// minimum size with its energy conserved. Milky Way dust on the line of sight dims and reddens them (segTau).

const FAR = 2e6;            // pc; farther quads are drawn scaled down at this distance (sky camera far plane is 1e7 pc)
const MIN_DIST_PC = 1e5;    // the Magellanic Clouds are part of the galaxy model
const SAME_AS = { c61: 'antennae-galaxies' };   // NGC 4039 is in the Antennae photograph

const VERT = /* glsl */ `
${VOL_GLSL}
${EXT_GLSL}
uniform vec3 uC, uU, uV, uCamG, uGalG, uDust;
uniform float uR, uPxPerRad, uMinPx, uGain;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  float d = length(uC);
  float pxR = uR / max(d, 1e-3) * uPxPerRad;
  float scale = max(1.0, uMinPx / max(pxR, 1e-6));
  float inten = uGain / (scale * scale) * smoothstep(0.02 * uR, 0.2 * uR, d);
  if (inten < 1e-5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 w = (uC + (uU * position.x + uV * position.y) * scale) * min(1.0, ${FAR.toFixed(1)} / d);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
  vUv = position.xy;
  vTint = exp(-segTau(uCamG, uGalG) * uDust) * inten;
}`;

const FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform float uHas, uSb, uGamma;
uniform vec2 uShape;   // procedural glow: axis ratio, position angle (rad)
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec3 c;
  if (uHas > 0.5) {
    c = pow(texture2D(tMap, vUv * 0.5 + 0.5).rgb, vec3(uGamma));
  } else {
    float ca = cos(uShape.y), sa = sin(uShape.y);
    vec2 p = vec2(ca * vUv.x + sa * vUv.y, (-sa * vUv.x + ca * vUv.y) / uShape.x);
    float r = length(p);
    c = vec3(1.0, 0.86, 0.68) * 0.7 * exp(-pow(r / 0.12, 0.6)) * smoothstep(1.0, 0.55, r);
  }
  gl_FragColor = vec4(c * uSb * vTint, 1.0);
}`;

export class ExternalGalaxies {
  // deep: deep-sky catalogue; galOf(worldMetres) -> galaxy-frame pc; shared: GalaxyObjects.shared (volume / dust uniforms)
  constructor(app, shared, deep, galOf) {
    this.group = new THREE.Group();
    this.group.renderOrder = 3;
    this.ids = new Set(Object.keys(SAME_AS));
    this.items = [];
    this.tune = { sb: 0.5, gamma: 2.6 };
    this.u = { uCamG: { value: new THREE.Vector3() }, uPxPerRad: { value: 1000 }, uGain: { value: 1 }, uMinPx: { value: 1.5 },
      uSb: { value: this.tune.sb }, uGamma: { value: this.tune.gamma } };
    const base = { tVol: shared.tVol, tPlane: shared.tPlane, tPlaneIn: shared.tPlaneIn, uPin: shared.uPin, uCloudP: shared.uCloudP,
      uCloudA: shared.uCloudA, uCloudOn: shared.uCloudOn, uDust: shared.uDust, ...this.u };
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    for (const d of deep) {
      if (d.type !== 'galaxy' || !(d.distPc > MIN_DIST_PC) || SAME_AS[d.id]) continue;
      const world = radecToWorld(d.ra, d.dec, d.distPc * PC);
      // celestial north / east tangents at the galaxy as seen from the Sun (finite differences on the sphere)
      const dir = unit(world);
      const north = unit(tangent(sub(radecToWorld(d.ra, Math.min(d.dec + 0.05, 89.99), d.distPc * PC), world), dir));
      const east = cross(north, dir);   // dir × east = north on the sky seen from inside; east is to the left
      const rnd = hash(d.id);
      const R = Math.max(d.sizePc || 1e4, 500) / 2;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { ...base, uC: { value: new THREE.Vector3() }, uU: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3() },
          uGalG: { value: new THREE.Vector3(...galOf(world)) }, uR: { value: R }, tMap: { value: null }, uHas: { value: 0 },
          uShape: { value: new THREE.Vector2(0.55 + 0.45 * rnd(), Math.PI * rnd()) } },
        transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = 3;
      this.group.add(mesh);
      this.ids.add(d.id);
      const it = { id: d.id, world, north, east, R, mat };
      this.setHalf(it, R);
      this.items.push(it);
    }
    this.ready = this.load(app);
  }
  setHalf(it, half) {
    it.mat.uniforms.uU.value.set(-it.east[0] * half, -it.east[1] * half, -it.east[2] * half);   // image right = west
    it.mat.uniforms.uV.value.set(it.north[0] * half, it.north[1] * half, it.north[2] * half);
  }
  async load(app) {
    const man = await app.assets.json('data/galaxies/manifest.json').catch(() => null);
    if (!man) return;
    await Promise.all(this.items.map(async (it) => {
      const m = man.galaxies[it.id];
      if (!m) return;
      const buf = await app.assets.buffer(m.file);
      if (!buf) return;
      const bmp = await createImageBitmap(new Blob([buf]), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const t = new THREE.Texture(bmp);
      t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.anisotropy = 4; t.needsUpdate = true;
      it.mat.uniforms.tMap.value = t; it.mat.uniforms.uHas.value = 1;
      this.setHalf(it, it.R / m.fill);   // the catalogue radius spans `fill` of the tile's half-width
    }));
  }
  update(frame, camG, gain) {
    const c = frame.camPos;
    for (const it of this.items) it.mat.uniforms.uC.value.set((it.world[0] - c[0]) / PC, (it.world[1] - c[1]) / PC, (it.world[2] - c[2]) / PC);
    this.u.uCamG.value.set(camG[0], camG[1], camG[2]);
    this.u.uPxPerRad.value = frame.viewport.h / (2 * Math.tan(frame.fovY * Math.PI / 360));
    this.u.uGain.value = gain; this.u.uSb.value = this.tune.sb; this.u.uGamma.value = this.tune.gamma;
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const tangent = (v, n) => { const k = v[0] * n[0] + v[1] * n[1] + v[2] * n[2]; return [v[0] - k * n[0], v[1] - k * n[1], v[2] - k * n[2]]; };
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
