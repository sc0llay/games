import * as THREE from 'three';
import { clamp, smoothstep } from 'orion/core/units.js';

// Render graph (spec §10): sky layer and system layer render into separate HDR targets,
// are composited with independent exposures, then bloom → tonemap → dither → swapchain.

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const fsMaterial = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
  vertexShader: FS_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra,
});

const LUM_FRAG = /* glsl */ `
uniform sampler2D tSys; uniform vec2 uTexel; uniform float uFloor;
varying vec2 vUv;
void main() {
  // 4×4 taps per output texel: log luminance weighted by coverage.
  float sumLog = 0.0, sumA = 0.0;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    vec2 o = (vec2(float(x), float(y)) - 1.5) * uTexel;
    vec4 c = texture2D(tSys, vUv + o);
    float a = clamp(c.a, 0.0, 1.0);
    float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(a, 1e-4);
    // Floor at ~10% of a lit surface at this distance from the Sun, so night sides and shadows can't blow out the lit side.
    sumLog += a * log(max(l, uFloor)); sumA += a;
  }
  gl_FragColor = vec4(sumLog / 16.0, sumA / 16.0, 0.0, 1.0);
}`;

const COMPOSE_FRAG = /* glsl */ `
uniform sampler2D tSys, tSky; uniform float uSysExp, uSkyExp;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(tSys, vUv);
  vec3 k = texture2D(tSky, vUv).rgb;
  gl_FragColor = vec4(s.rgb * uSysExp + (1.0 - clamp(s.a, 0.0, 1.0)) * k * uSkyExp, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  // 13-tap (Jimenez 2014) downsample, energy preserving.
  vec3 a = texture2D(tSrc, vUv + uTexel * vec2(-2, 2)).rgb, b = texture2D(tSrc, vUv + uTexel * vec2(0, 2)).rgb, c = texture2D(tSrc, vUv + uTexel * vec2(2, 2)).rgb;
  vec3 d = texture2D(tSrc, vUv + uTexel * vec2(-2, 0)).rgb, e = texture2D(tSrc, vUv).rgb, f = texture2D(tSrc, vUv + uTexel * vec2(2, 0)).rgb;
  vec3 g = texture2D(tSrc, vUv + uTexel * vec2(-2, -2)).rgb, h = texture2D(tSrc, vUv + uTexel * vec2(0, -2)).rgb, i = texture2D(tSrc, vUv + uTexel * vec2(2, -2)).rgb;
  vec3 j = texture2D(tSrc, vUv + uTexel * vec2(-1, 1)).rgb, k = texture2D(tSrc, vUv + uTexel * vec2(1, 1)).rgb;
  vec3 l = texture2D(tSrc, vUv + uTexel * vec2(-1, -1)).rgb, m = texture2D(tSrc, vUv + uTexel * vec2(1, -1)).rgb;
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(min(o, vec3(6.0e4)), 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 o = texture2D(tSrc, vUv + uTexel * vec2(-1, 1)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1, 1)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1, -1)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1, -1)).rgb
         + 2.0 * (texture2D(tSrc, vUv + uTexel * vec2(0, 1)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0, -1)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1, 0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1, 0)).rgb)
         + 4.0 * texture2D(tSrc, vUv).rgb;
  gl_FragColor = vec4(o / 16.0, 1.0);
}`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tHdr, tBloom; uniform float uBloom, uGrain, uTime, uScotopic; uniform int uTonemap;
varying vec2 vUv;
${THREE.ShaderChunk.tonemapping_pars_fragment}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture2D(tHdr, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
  // Eye mode: Purkinje shift — rods take over in the dark, desaturating toward blue.
  if (uScotopic > 0.0) {
    float rod = dot(c, vec3(0.04, 0.5, 0.46));
    c = mix(c, rod * vec3(0.75, 0.88, 1.15), uScotopic);
  }
  c = uTonemap == 1 ? NeutralToneMapping(c) : AgXToneMapping(c);
  vec2 px = gl_FragCoord.xy;
  float n = ign(px + fract(uTime * 7.31) * 113.0);
  c *= 1.0 + (n - 0.5) * uGrain;
  c = srgb(clamp(c, 0.0, 1.0));
  // Triangular-ish dither before 8-bit quantisation; space is mostly near-black gradients.
  float d = ign(px + 0.5) + ign(px.yx + 17.0) - 1.0;
  gl_FragColor = vec4(c + d / 255.0, 1.0);
}`;

export class RenderGraph {
  constructor(app) {
    this.app = app;
    const r = (this.renderer = app.renderer);
    r.autoClear = false;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.prePasses = [];   // fn(renderer, frame): render to private targets before the main layers
    this.postSky = [];     // fn(renderer, frame, skyTarget): draw after the sky layer (e.g. composited volume)
    this.exposure = { sys: 1, sky: 1, logSys: Math.log(180), mode: 'auto', manualEV: 6, tonemap: 'agx' };
    this.bloomStrength = 0.04;
    this.grain = 0.01;
    this._lumBuf = new Float32Array(64 * 64 * 4);
    this._lumFrame = 0;
    this.capturePending = null;
    this.#makeMaterials();
    this.size = { w: 0, h: 0 };
  }
  #makeMaterials() {
    this.lumMat = fsMaterial(LUM_FRAG, { tSys: { value: null }, uTexel: { value: new THREE.Vector2() }, uFloor: { value: 0.03 } });
    this.composeMat = fsMaterial(COMPOSE_FRAG, { tSys: { value: null }, tSky: { value: null }, uSysExp: { value: 1 }, uSkyExp: { value: 1 } });
    this.downMat = fsMaterial(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = fsMaterial(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.finalMat = fsMaterial(FINAL_FRAG, {
      tHdr: { value: null }, tBloom: { value: null }, uBloom: { value: 0.04 }, uGrain: { value: 0.01 }, uTime: { value: 0 },
      uScotopic: { value: 0 }, uTonemap: { value: 0 }, toneMappingExposure: { value: 1 },
    });
  }
  #rt(w, h, opts = {}) {
    return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...opts });
  }
  resize(w, h, msaa) {
    if (w === this.size.w && h === this.size.h && msaa === this.size.msaa) return;
    this.size = { w, h, msaa };
    for (const t of [this.sysRT, this.skyRT, this.hdrRT, ...(this.mips || [])]) t?.dispose();
    this.sysRT = this.#rt(w, h, { depthBuffer: true, samples: msaa });
    this.skyRT = this.#rt(w, h, { depthBuffer: true });
    this.hdrRT = this.#rt(w, h);
    this.lumRT ??= this.#rt(64, 64, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < 6; i++) { mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); this.mips.push(this.#rt(mw, mh)); }
  }
  #pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }
  render(frame) {
    const r = this.renderer, app = this.app;
    for (const fn of this.prePasses) fn(r, frame);

    r.setRenderTarget(this.skyRT); r.setClearColor(0x000000, 1); r.clear(true, true, false);
    r.render(app.layers.sky, app.cameras.sky);
    for (const fn of this.postSky) fn(r, frame, this.skyRT);

    r.setRenderTarget(this.sysRT); r.setClearColor(0x000000, 0); r.clear(true, true, false);
    r.render(app.layers.system, app.cameras.system);

    this.#exposure(frame);

    this.composeMat.uniforms.tSys.value = this.sysRT.texture;
    this.composeMat.uniforms.tSky.value = this.skyRT.texture;
    this.composeMat.uniforms.uSysExp.value = this.exposure.sys;
    this.composeMat.uniforms.uSkyExp.value = this.exposure.sky;
    this.#pass(this.composeMat, this.hdrRT);

    // Bloom: no threshold, 6-level chain.
    let src = this.hdrRT;
    for (const m of this.mips) {
      this.downMat.uniforms.tSrc.value = src.texture;
      this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.#pass(this.downMat, m); src = m;
    }
    for (let i = this.mips.length - 1; i > 0; i--) {
      this.upMat.uniforms.tSrc.value = this.mips[i].texture;
      this.upMat.uniforms.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
      this.#pass(this.upMat, this.mips[i - 1]);
    }

    const f = this.finalMat.uniforms;
    f.tHdr.value = this.hdrRT.texture; f.tBloom.value = this.mips[0].texture;
    f.uBloom.value = this.bloomStrength; f.uGrain.value = app.settings.reducedMotion ? 0 : this.grain;
    f.uTime.value = frame.time; f.uTonemap.value = this.exposure.tonemap === 'neutral' ? 1 : 0;
    f.uScotopic.value = this.exposure.mode === 'eye' ? clamp((Math.log2(this.exposure.sys) - 6) / 4, 0, 0.85) : 0;
    this.#pass(this.finalMat, null);

    if (this.capturePending) {
      const { resolve } = this.capturePending; this.capturePending = null;
      app.canvas.toBlob(resolve, 'image/png');
    }
  }
  // Resolves with a PNG of the next rendered frame.
  capture() { return new Promise((resolve) => { this.capturePending = { resolve }; }); }

  #exposure(frame) {
    const e = this.exposure;
    const SPACE_EXP = 180; // exposure for empty space: 0.18 / 1e-3
    if (e.mode === 'manual') { e.sys = Math.pow(2, e.manualEV); }
    else {
      // Async readback (one in flight) so metering never stalls the GPU pipeline.
      if (this._lumFrame++ % 6 === 0 && !this._lumPending) {
        this.lumMat.uniforms.tSys.value = this.sysRT.texture;
        this.lumMat.uniforms.uTexel.value.set(1 / 256, 1 / 256);
        const au = Math.max(frame.dSun / 1.495978707e11, 1e-3);
        this.lumMat.uniforms.uFloor.value = 0.03 / (au * au); // lit-surface brightness falls off as 1/r²
        this.#pass(this.lumMat, this.lumRT);
        this._lumPending = true;
        this.renderer.readRenderTargetPixelsAsync(this.lumRT, 0, 0, 64, 64, this._lumBuf).then(() => {
          let sl = 0, sa = 0;
          for (let i = 0; i < 64 * 64; i++) { sl += this._lumBuf[i * 4]; sa += this._lumBuf[i * 4 + 1]; }
          const cov = sa / 4096;
          const avg = sa > 1e-6 ? sl / sa : Math.log(1e-3);
          // Meter on covered pixels once anything substantial is in view; empty space only sets the level when nothing is.
          const w = smoothstep(0, 0.03, cov);
          this._targetLog = Math.log(0.18) - ((1 - w) * Math.log(1e-3) + w * avg);
        }).catch(() => {}).finally(() => { this._lumPending = false; });
      }
      const target = clamp(this._targetLog ?? Math.log(SPACE_EXP), Math.log(1e-5), Math.log(2000));
      const tau = target < e.logSys ? 1.5 : 3.0; // adapt to brighter scenes faster
      e.logSys += (target - e.logSys) * (1 - Math.exp(-frame.realDt / tau));
      if (!Number.isFinite(e.logSys)) e.logSys = Math.log(SPACE_EXP);
      e.sys = Math.exp(e.logSys);
    }
    e.sky = clamp(Math.sqrt(e.sys / SPACE_EXP), 0.03, 1);
  }
}
