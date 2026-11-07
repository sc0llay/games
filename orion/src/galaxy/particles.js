import * as THREE from 'three';
import { MCS, DUST_RGB } from 'orion/galaxy/model.js';
import { VOL_GLSL, EXT_GLSL } from 'orion/galaxy/volume.js';

// Everything in the sky layer that is not the smooth volume: procedural star "groups" (point sprites with an
// energy-conserving PSF and per-star dust extinction), HII-region / nuclear-cluster / Magellanic-Cloud billboards,
// Sgr A* marker, catalogue sprites for globular clusters and deep-sky objects. A `Layer` is a self-contained set of
// objects with its own uniforms; the live sky and the cubemap capture each own one (sharing geometry).

const STAR_VERT = /* glsl */ `
${VOL_GLSL}
${EXT_GLSL}
attribute float aLum;
attribute vec4 aCol;
uniform vec3 uCamG, uSunG, uDust;
uniform float uKv, uSigma0, uOmega0, uVis, uHole, uGainOut, uNear0, uNear1, uLimit, uFrac, uMaxHalf;
varying vec3 vColor;
varying float vPeakC, vPeakH, vSigC, vSigH, vHalf;
void main() {
  // cheap rejections first: random subset (light conserved by the volume), behind / too near, then brightness
  // (an upper bound: extinction only dims), and only then the line-of-sight extinction integral.
  if (aCol.a >= uFrac) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(length(mv.xyz), 1e-6);
  float vis = uVis * step(mv.z, -1e-9) * smoothstep(uNear0, uNear1, d);
  vis *= 1.0 - uHole * (1.0 - smoothstep(500.0, 1000.0, length(position - uSunG)));
  vec2 t = mv.xy / -mv.z;
  float om = uOmega0 * pow(1.0 + dot(t, t), -1.5);
  float E = uKv * uGainOut * aLum / (d * d + 1e-4) / om;   // pixel-energy of this star
  float peak0 = E / (6.2831853 * uSigma0 * uSigma0);
  vis *= smoothstep(0.5 * uLimit, 1.6 * uLimit, peak0);
  if (vis < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float tau = segTau(uCamG, position);
  vec3 tr = exp(-tau * uDust);
  float tm = max(tr.r, max(tr.g, tr.b));
  vis *= smoothstep(0.5 * uLimit, 1.6 * uLimit, peak0 * tm);
  if (vis < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vColor = aCol.rgb * tr;
  float s = 1.0 + 0.5 * log2(max(peak0, 1.0)) * 0.30103;
  float sigC = uSigma0 * s, sigH = 7.0 * sigC;
  float peakC = E * 0.96 / (6.2831853 * sigC * sigC) * vis;
  float peakH = E * 0.04 / (6.2831853 * sigH * sigH) * vis;
  const float THR = 0.0015;
  float rc = sigC * sqrt(2.0 * max(log(max(peakC * tm, 1e-12) / THR), 0.0));
  float rh = sigH * sqrt(2.0 * max(log(max(peakH * tm, 1e-12) / THR), 0.0));
  float half_ = clamp(max(rc, rh) + 1.0, 1.0, uMaxHalf);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 2.0 * half_;
  vPeakC = peakC; vPeakH = peakH; vSigC = sigC; vSigH = min(sigH, half_ / 2.5); vHalf = half_;
  vPeakH *= sigH * sigH / (vSigH * vSigH);   // keep the halo energy when the sprite is capped
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vPeakC, vPeakH, vSigC, vSigH, vHalf;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * (2.0 * vHalf);
  float r2 = dot(p, p);
  float I = vPeakC * exp(-0.5 * r2 / (vSigC * vSigC)) + vPeakH * exp(-0.5 * r2 / (vSigH * vSigH));
  I *= 1.0 - smoothstep(0.75, 1.0, sqrt(r2) / vHalf);
  gl_FragColor = vec4(vColor * I, 1.0);
}`;

// type: 0 HII region, 1 nuclear star cluster, 2 Magellanic Cloud, 3 Sgr A* marker
const BILL_VERT = /* glsl */ `
${VOL_GLSL}
${EXT_GLSL}
attribute vec4 aData;   // xyz galaxy pc, size pc
attribute vec4 aMisc;   // brightness, seed, type, 0
uniform vec3 uCamG, uSunG, uDust;
uniform vec2 uRes;
uniform float uPxPerRad, uVis, uHole, uGainOut, uKv;
varying vec2 vP;
varying float vInt, vType, vSeed, vBright;
varying vec3 vTrans;
void main() {
  vec4 mv = modelViewMatrix * vec4(aData.xyz, 1.0);
  float d = max(length(mv.xyz), 1e-6);
  float type = aMisc.z;
  float vis = uVis * step(mv.z, -1e-9);
  float size = aData.w;
  float pxR = size / d * uPxPerRad;
  float scale = max(1.0, 1.8 / max(pxR, 1e-4));
  float inten = 1.0 / (scale * scale);
  vTrans = vec3(1.0);
  if (type < 0.5) {
    vis *= smoothstep(0.4 * size, 2.5 * size, d);
    vis *= 1.0 - uHole * (1.0 - smoothstep(500.0, 1100.0, length(aData.xyz - uSunG)));
    vTrans = exp(-segTau(uCamG, aData.xyz) * uDust);
  } else if (type < 1.5) {
    vTrans = exp(-segTau(uCamG, aData.xyz) * uDust);
    vis *= smoothstep(0.3, 2.0, d);
  } else if (type < 2.5) {
    vis *= smoothstep(0.3 * size, 2.0 * size, d);
  }
  if (vis < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vP = position.xy * 1.5;
  vInt = inten * vis * uGainOut; vType = type; vSeed = aMisc.y; vBright = aMisc.x;
  if (type > 2.5) {
    gl_Position = projectionMatrix * mv;
    gl_Position.xy += position.xy * 16.0 * 2.0 / uRes * gl_Position.w;
    vP = position.xy; vInt = vis * smoothstep(60.0, 400.0, d) * (1.0 - smoothstep(2500.0, 4000.0, d));   // galactic-centre views only
    return;
  }
  mv.xy += position.xy * size * scale * 1.5;
  gl_Position = projectionMatrix * mv;
}`;

const BILL_FRAG = /* glsl */ `
varying vec2 vP;
varying float vInt, vType, vSeed, vBright;
varying vec3 vTrans;
uniform float uHii, uNsc, uMc;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
void main() {
  float r2 = dot(vP, vP);
  vec3 c = vec3(0.0);
  if (vType < 0.5) {
    if (r2 > 2.25) discard;
    vec2 q = vP + vSeed * 37.0;
    float n = fbm(q * 2.2), n2 = fbm(q * 4.7 + 5.0);
    float shell = exp(-pow((sqrt(r2) - 0.45) * 2.3, 2.0)) * (0.55 + 0.9 * n);
    float body = exp(-r2 * 2.2) * (0.35 + 0.9 * n2);
    float core = exp(-r2 * 9.0) * (0.5 + 0.5 * n);
    vec3 Ha = vec3(1.0, 0.13, 0.24), OIII = vec3(0.04, 0.62, 0.55);
    c = (Ha * (0.6 * shell + 0.7 * body) + OIII * core * 0.7 + vec3(1.0, 0.75, 0.8) * exp(-r2 * 60.0) * 0.5) * (uHii * vBright);
    c *= vTrans;
  } else if (vType < 1.5) {
    c = vec3(1.0, 0.72, 0.42) * uNsc / pow(1.0 + r2 * 18.0, 1.3);
    c *= vTrans;
  } else if (vType < 2.5) {
    float n = fbm(vP * 3.0 + vSeed * 17.0);
    c = vec3(0.78, 0.86, 1.0) * uMc * exp(-r2 * 2.6) * (0.6 + 0.8 * n);
  } else {
    float r = length(vP);
    float ring = smoothstep(0.08, 0.0, abs(r - 0.7)) + 0.6 * smoothstep(0.1, 0.0, abs(r - 0.18));
    gl_FragColor = vec4(vec3(0.1, 0.9, 0.8) * ring * vInt * 0.5, 1.0); return;
  }
  gl_FragColor = vec4(c * vInt, 1.0);
}`;

const SPR_VERT = /* glsl */ `
attribute float aMag;     // apparent magnitude at the nominal distance aD0
attribute vec4 aInfo;     // d0 (pc), radius (pc), type, 0
attribute vec3 aTint;
uniform float uSigma0, uPxPerRad, uVis, uLimit, uSkyGain;
varying vec3 vColor;
varying float vPeak, vSig, vHalf;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(length(mv.xyz), 1e-6);
  float vis = uVis * step(mv.z, -1e-9);
  float m = max(aMag + 5.0 * log2(d / aInfo.x) * 0.30103, -16.0);
  float flux = exp2(-0.4 * m * 3.32192809);
  float E = 6.2831853 * 1.69 * flux * 5.0;       // same normalisation as catalogue stars (peak 3 at mag 0 for sigma 1.3)
  float extPx = aInfo.y / d * uPxPerRad * 0.6;
  float sig = max(uSigma0, extPx);
  float peak = E / (6.2831853 * sig * sig);
  vis *= smoothstep(0.5 * uLimit, 1.6 * uLimit, peak);
  if (vis < 1e-3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float half_ = clamp(sig * 3.2 + 1.0, 2.0, 96.0);
  sig = min(sig, half_ / 3.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 2.0 * half_;
  vColor = aTint; vPeak = peak * vis; vSig = sig; vHalf = half_;
}`;
const SPR_FRAG = /* glsl */ `
varying vec3 vColor; varying float vPeak, vSig, vHalf;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * (2.0 * vHalf);
  float r2 = dot(p, p);
  float I = vPeak * exp(-0.5 * r2 / (vSig * vSig));
  I *= 1.0 - smoothstep(0.7, 1.0, sqrt(r2) / vHalf);
  gl_FragColor = vec4(vColor * I, 1.0);
}`;

const TINT = {
  nebula: [1.0, 0.35, 0.5], planetary: [0.3, 0.95, 0.85], snr: [1.0, 0.45, 0.4], 'open-cluster': [0.65, 0.8, 1.0],
  globular: [1.0, 0.82, 0.55], galaxy: [1.0, 0.92, 0.8],
};

export class Layer {
  constructor(owner, kind, faceSize) {
    this.owner = owner; this.kind = kind; this.faceSize = faceSize;
    const S = owner.shared;
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false; this.group.matrixWorldAutoUpdate = false;
    this.world = new THREE.Group();
    this.u = {
      uCamG: { value: new THREE.Vector3() }, uOmega0: { value: 1e-6 }, uVis: { value: 1 }, uGainOut: { value: 1 },
      uPxPerRad: { value: 1000 }, uRes: { value: new THREE.Vector2(1, 1) },
    };
    const common = {
      tVol: S.tVol, tPlane: S.tPlane, tPlaneIn: S.tPlaneIn, uPin: S.uPin, uCloudP: S.uCloudP, uCloudA: S.uCloudA, uCloudOn: S.uCloudOn, uFrac: S.uFrac, uMaxHalf: S.uMaxHalf,
      uKv: S.uKv, uSunG: S.uSunG, uHole: S.uHole, uDust: S.uDust, uSigma0: S.uSigma0, uLimit: S.uLimit,
      uNear0: S.uNear0, uNear1: S.uNear1, ...this.u,
    };
    const mk = (vertexShader, fragmentShader, extra = {}) => new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms: { ...common, ...extra }, transparent: true, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.starMat = mk(STAR_VERT, STAR_FRAG);
    this.billMat = mk(BILL_VERT, BILL_FRAG, { uHii: S.uHii, uNsc: S.uNsc, uMc: S.uMc });
    this.sprMat = mk(SPR_VERT, SPR_FRAG);
    this.starObjs = [];
    this.bill = null; this.spr = null; this.glob = null;
    for (const g of owner.starGeos) this.addStars(g);
    if (owner.billGeo) this.addBillboards(owner.billGeo);
    if (owner.globGeo) this.addGlobFallback(owner.globGeo);
    if (owner.cat) this.addCatalogue();
  }
  addStars(geo) {
    const p = new THREE.Points(geo, this.starMat);
    p.frustumCulled = false; p.renderOrder = 5; this.group.add(p); this.starObjs.push(p);
  }
  addBillboards(geo) {
    this.bill = new THREE.Mesh(geo, this.billMat); this.bill.frustumCulled = false; this.bill.renderOrder = 4; this.group.add(this.bill);
  }
  addGlobFallback(geo) {
    this.glob = new THREE.Points(geo, this.sprMat); this.glob.frustumCulled = false; this.glob.renderOrder = 6; this.group.add(this.glob);
  }
  addCatalogue() {
    const c = this.owner.cat;
    this.posAttr = new THREE.BufferAttribute(new Float32Array(c.n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aMag', c.mag); geo.setAttribute('aInfo', c.info); geo.setAttribute('aTint', c.tint);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.spr = new THREE.Points(geo, this.sprMat); this.spr.frustumCulled = false; this.spr.renderOrder = 6; this.world.add(this.spr);
  }
  // Live layer: place the rotated galaxy group relative to the camera (all Float64 on the CPU).
  placeLive(frame) {
    const m = frame.galaxyMatrix.elements, cp = frame.camPos, PCm = 3.0856775814913673e16;
    const e = this.group.matrix.elements;
    for (let i = 0; i < 11; i++) e[i] = m[i];
    e[3] = e[7] = e[11] = 0; e[15] = 1;
    e[12] = m[12] - cp[0] / PCm; e[13] = m[13] - cp[1] / PCm; e[14] = m[14] - cp[2] / PCm;
    this.group.matrixWorld.copy(this.group.matrix);
  }
  // Cube layer: galaxy axes, camera-relative.
  placeCube(camG) {
    const e = this.group.matrix.elements;
    e.fill(0); e[0] = e[5] = e[10] = e[15] = 1;
    e[12] = -camG[0]; e[13] = -camG[1]; e[14] = -camG[2];
    this.group.matrixWorld.copy(this.group.matrix);
  }
  // Fill catalogue sprite positions. rot: null (world axes) or the 3x3 row-major R^T (galaxy axes).
  fillCatalogue(camWorldM, rotRT) {
    const c = this.owner.cat; if (!c) return;
    const a = this.posAttr.array, w = c.worldM, PCm = 3.0856775814913673e16;
    for (let i = 0; i < c.n; i++) {
      const x = (w[i * 3] - camWorldM[0]) / PCm, y = (w[i * 3 + 1] - camWorldM[1]) / PCm, z = (w[i * 3 + 2] - camWorldM[2]) / PCm;
      if (rotRT) {
        a[i * 3] = rotRT[0] * x + rotRT[1] * y + rotRT[2] * z;
        a[i * 3 + 1] = rotRT[3] * x + rotRT[4] * y + rotRT[5] * z;
        a[i * 3 + 2] = rotRT[6] * x + rotRT[7] * y + rotRT[8] * z;
      } else { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; }
    }
    this.posAttr.needsUpdate = true;
  }
  setProjection(fovYDeg, w, h) {
    const t = Math.tan(fovYDeg * Math.PI / 360);
    this.u.uOmega0.value = Math.pow(2 * t / h, 2);
    this.u.uPxPerRad.value = h / (2 * t);
    this.u.uRes.value.set(w, h);
  }
  setCubeProjection(F) {
    this.u.uOmega0.value = Math.pow(2 / F, 2); this.u.uPxPerRad.value = F / 2; this.u.uRes.value.set(F, F);
  }
  dispose() { this.starMat.dispose(); this.billMat.dispose(); this.sprMat.dispose(); }
}

export class GalaxyObjects {
  constructor(app, vol) {
    this.app = app; this.vol = vol;
    const S = vol.shared;
    this.shared = {
      tVol: S.tVol, tPlane: S.tPlane, tPlaneIn: S.tPlaneIn, uPin: S.uPin, uCloudP: S.uCloudP, uCloudA: S.uCloudA, uCloudOn: S.uCloudOn, uFrac: S.uFrac,
      uKv: S.uKv, uSunG: S.uSunG, uHole: S.uHole, uDust: { value: new THREE.Vector3(...DUST_RGB) }, uMaxHalf: { value: 96 },
      uSigma0: { value: 0.75 }, uLimit: { value: 1.2e-3 }, uNear0: { value: 5 }, uNear1: { value: 50 },
      uHii: { value: 0.18 }, uNsc: { value: 6.0 }, uMc: { value: 0.05 },
    };
    this.starGeos = []; this.layers = []; this.billGeo = null; this.globGeo = null; this.cat = null;
    this.starCount = 0; this.workers = [];
  }
  layer(kind, F) { const l = new Layer(this, kind, F); this.layers.push(l); return l; }

  // ---- procedural stars + billboards (workers) -------------------------------------------------------------------
  // swap = re-generate for a new tier while the old stars keep drawing: the new geometries are collected off-screen and
  // exchanged for the old ones in one go once every worker has finished (HII/globular data do not depend on the tier).
  generate(settings, hasGlobData, swap = false) {
    const total = settings.proceduralStars;
    const parts = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 2));
    let done = 0;
    const fresh = []; let freshN = 0;
    return new Promise((resolve) => {
      for (let i = 0; i < parts; i++) {
        const w = new Worker(this.app.assets.workerURL('src/galaxy/particles.worker.js'));
        this.workers.push(w);
        w.onmessage = (ev) => {
          const r = ev.data;
          if (r.n) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
            g.setAttribute('aLum', new THREE.BufferAttribute(r.lum, 1));
            g.setAttribute('aCol', new THREE.BufferAttribute(r.col, 4, true));
            g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
            if (swap) { fresh.push(g); freshN += r.n; }
            else { this.starGeos.push(g); this.starCount += r.n; for (const l of this.layers) l.addStars(g); }
          }
          if (!swap && r.hii) this.#buildBillboards(r.hii);
          if (!swap && r.glob && !hasGlobData) this.#buildGlobFallback(r.glob);
          if (!r.last) return;   // stars stream in rounds (see particles.worker.js)
          w.terminate();
          if (++done === parts) { if (swap) this.#swapStars(fresh, freshN); resolve(); }
        };
        w.postMessage({ id: i, n: Math.round(total / parts), seed: 1, part: i, parts, nHii: i === 0 ? 2000 : 0, nGlob: i === 0 ? 150 : 0 });
      }
    });
  }
  #swapStars(fresh, n) {
    for (const l of this.layers) { for (const p of l.starObjs) l.group.remove(p); l.starObjs.length = 0; for (const g of fresh) l.addStars(g); }
    for (const g of this.starGeos) g.dispose();
    this.starGeos = fresh; this.starCount = n;
  }
  #buildBillboards(hii) {
    const n = hii.length / 6;
    const extra = 2 + MCS.length; // nuclear cluster, Sgr A*, MCs
    const data = new Float32Array((n + extra) * 4), misc = new Float32Array((n + extra) * 4);
    for (let i = 0; i < n; i++) {
      data.set([hii[i * 6], hii[i * 6 + 1], hii[i * 6 + 2], hii[i * 6 + 3]], i * 4);
      misc.set([hii[i * 6 + 4], hii[i * 6 + 5], 0, 0], i * 4);
    }
    let k = n;
    data.set([0, 0, 0, 14], k * 4); misc.set([1, 0, 1, 0], k * 4); k++;            // nuclear star cluster glow (core ≈ 4 pc)
    data.set([0, 0, 0, 1], k * 4); misc.set([1, 0, 3, 0], k * 4); k++;             // Sgr A* marker
    for (const m of MCS) { data.set([m.pos[0], m.pos[1], m.pos[2], m.a * 1.2], k * 4); misc.set([1, m.id === 'lmc' ? 0.3 : 0.7, 2, 0], k * 4); k++; }
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position);
    g.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    g.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 4));
    g.instanceCount = n + extra; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.billGeo = g;
    for (const l of this.layers) l.addBillboards(g);
  }
  #buildGlobFallback(glob) {
    const n = glob.length / 6;
    const pos = new Float32Array(n * 3), mag = new Float32Array(n), info = new Float32Array(n * 4), tint = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([glob[i * 6], glob[i * 6 + 1], glob[i * 6 + 2]], i * 3);
      mag[i] = -8 + 2 * glob[i * 6 + 5]; info.set([10, glob[i * 6 + 3], 0, 0], i * 4); tint.set([1.0, 0.82, 0.55], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4)); g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.globGeo = g;
    for (const l of this.layers) l.addGlobFallback(g);
  }

  // ---- catalogue sprites (globulars + deep-sky), world frame -------------------------------------------------------
  // items: [{ worldM: Float64Array(3), mag, distPc, radiusPc, type }]
  setCatalogue(items) {
    const n = items.length;
    const worldM = new Float64Array(n * 3), mag = new Float32Array(n), info = new Float32Array(n * 4), tint = new Float32Array(n * 3);
    items.forEach((it, i) => {
      worldM.set(it.worldM, i * 3); mag[i] = it.mag; info.set([Math.max(it.distPc, 1), Math.max(it.radiusPc, 0.01), 0, 0], i * 4);
      tint.set(TINT[it.type] || TINT.galaxy, i * 3);
    });
    this.cat = { n, worldM, mag: new THREE.BufferAttribute(mag, 1), info: new THREE.BufferAttribute(info, 4), tint: new THREE.BufferAttribute(tint, 3) };
    for (const l of this.layers) l.addCatalogue();
  }
}
