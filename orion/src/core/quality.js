// Performance tiers (spec §13). Tier is guessed from the adapter, then nudged by live frame time.
export const TIERS = {
  low:    { renderScale: [0.6, 0.8],  proceduralStars: 250_000,   volumeSteps: 32,  volumeRes: 0.25, volumeTex: [256, 32], skyFace: 512,  maxTexture: 2048, asteroids: 10_000, msaa: 0 },
  medium: { renderScale: [0.75, 1.0], proceduralStars: 600_000,   volumeSteps: 48,  volumeRes: 0.5,  volumeTex: [384, 48], skyFace: 1024, maxTexture: 4096, asteroids: 25_000, msaa: 4 },
  high:   { renderScale: [0.85, 1.0], proceduralStars: 1_200_000, volumeSteps: 96,  volumeRes: 0.5,  volumeTex: [512, 64], skyFace: 2048, maxTexture: 8192, asteroids: 80_000, msaa: 4 },
  ultra:  { renderScale: [1.0, 1.5],  proceduralStars: 2_000_000, volumeSteps: 128, volumeRes: 1.0,  volumeTex: [768, 96], skyFace: 2048, maxTexture: 8192, asteroids: 80_000, msaa: 4 },
};
const ORDER = ['low', 'medium', 'high', 'ultra'];

export class Quality extends EventTarget {
  constructor(renderer) {
    super();
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    const mobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900);
    let tier = 'high';
    if (mobile) tier = 'low';
    else if (/Intel|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(this.gpu)) tier = 'medium';
    else if (/RTX (30[89]0|40[789]0|50\d0)|RX 7[89]00|M[1-4] (Max|Ultra)/i.test(this.gpu)) tier = 'ultra';
    const saved = (() => { try { return localStorage.getItem('orion.tier'); } catch { return null; } })();
    this.auto = !saved;
    this.tier = saved && TIERS[saved] ? saved : tier;
    this.scale = this.settings.renderScale[1];
    this.frameMs = 16.6;
    this.floorTime = 0;
    this.lowPower = false;
  }
  get settings() { return TIERS[this.tier]; }
  get budgetMs() { return this.lowPower ? 33.3 : 16.6; }
  setTier(t, manual = true) {
    if (!TIERS[t] || t === this.tier) return;
    this.tier = t; this.scale = this.settings.renderScale[1];
    if (manual) { this.auto = false; try { localStorage.setItem('orion.tier', t); } catch {} }
    this.dispatchEvent(new CustomEvent('tier', { detail: t }));
  }
  // Dynamic resolution: called once per frame with the real frame time.
  update(dtMs) {
    this.frameMs += (dtMs - this.frameMs) * 0.05;
    const [lo, hi] = this.settings.renderScale;
    if (this.frameMs > this.budgetMs * 1.08) this.scale = Math.max(lo, this.scale - 0.01);
    else if (this.frameMs < this.budgetMs * 0.8) this.scale = Math.min(hi, this.scale + 0.005);
    if (this.auto && this.scale <= lo + 1e-6 && this.frameMs > this.budgetMs * 1.08) {
      this.floorTime += dtMs;
      if (this.floorTime > 5000) { this.floorTime = 0; const i = ORDER.indexOf(this.tier); if (i > 0) this.setTier(ORDER[i - 1], false); }
    } else this.floorTime = 0;
  }
}
