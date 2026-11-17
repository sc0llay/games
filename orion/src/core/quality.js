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
    this.frameMs = 16.6;   // smoothed frame interval (informational)
    this.workMs = 0;       // smoothed CPU/GPU work per frame (drives the governor)
    this.floorTime = 0;
    this.lowPower = false;
    this.#gov = newGovernor();
    this.#initTimer(gl);
  }
  #gov; #gl = null; #ext = null; #pending = []; #active = null; gpuMs = null;
  #initTimer(gl) {
    try {
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (ext && typeof gl.createQuery === 'function') { this.#gl = gl; this.#ext = ext; }
    } catch { /* CPU-only fallback */ }
  }
  get gpuTiming() { return !!this.#ext; }
  get settings() { return TIERS[this.tier]; }
  get budgetMs() { return this.lowPower ? 33.3 : 16.6; }
  setTier(t, manual = true) {
    if (!TIERS[t] || t === this.tier) return;
    this.tier = t; this.scale = this.settings.renderScale[1]; this.#gov = newGovernor(this.#gov.valid);
    if (manual) { this.auto = false; try { localStorage.setItem('orion.tier', t); } catch {} }
    this.dispatchEvent(new CustomEvent('tier', { detail: t }));
  }
  // Bracket the frame's GPU work with a timer query (when the extension exists). Results arrive a few frames later.
  begin() {
    if (!this.#ext || this.#active || this.#pending.length > 4) return;
    try { const q = this.#gl.createQuery(); this.#gl.beginQuery(this.#ext.TIME_ELAPSED_EXT, q); this.#active = q; } catch { this.#ext = null; }
  }
  end() {
    if (!this.#active) return;
    try { this.#gl.endQuery(this.#ext.TIME_ELAPSED_EXT); this.#pending.push(this.#active); } catch { this.#ext = null; }
    this.#active = null;
  }
  #poll() {
    const gl = this.#gl;
    while (this.#pending.length) {
      const q = this.#pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.#ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      gl.deleteQuery(q); this.#pending.shift();
      if (!disjoint) { const ms = ns / 1e6; this.gpuMs = this.gpuMs == null ? ms : this.gpuMs + (ms - this.gpuMs) * 0.3; }
    }
  }
  // Dynamic resolution: called once per frame after render with the frame interval and the CPU work time of the frame.
  // GPU time (if measurable) and CPU time overlap in a pipelined renderer, so the larger of the two is the cost.
  update(dtMs, cpuMs = 0) {
    this.frameMs += (Math.min(dtMs, 100) - this.frameMs) * 0.05;
    if (this.#ext) { try { this.#poll(); } catch { this.#ext = null; } }
    const work = Math.max(cpuMs, this.#ext && this.gpuMs != null ? this.gpuMs : 0);
    const [lo, hi] = this.settings.renderScale;
    const r = governorStep(this.#gov, { dtMs, workMs: work, budgetMs: this.budgetMs, scale: this.scale, lo, hi });
    this.scale = r.scale; this.workMs = this.#gov.lastAvg ?? this.workMs;
    if (this.auto && r.overloadedAtFloor) {
      this.floorTime += r.windowMs;
      if (this.floorTime > 5000) { this.floorTime = 0; const i = ORDER.indexOf(this.tier); if (i > 0) this.setTier(ORDER[i - 1], false); }
    } else if (r.windowMs) this.floorTime = 0;
  }
}

export const SCALE_STEP = 0.05, GRACE_MS = 2000, WINDOW_MS = 500, HITCH_MS = 100;
export const UP_BELOW = 0.6, DOWN_ABOVE = 0.9;
export const quantise = (s) => Math.round(s / SCALE_STEP) * SCALE_STEP;
export function newGovernor(valid = 0) { return { valid, sum: 0, n: 0, win: 0, okWindows: 0, lastAvg: null }; }
// Pure governor step. Accumulates work samples over ~0.5 s windows; at each window boundary returns a (possibly) new
// quantised scale. Step up needs two consecutive calm windows, step down is immediate. Hitches and the first 2 s are ignored.
export function governorStep(g, { dtMs, workMs, budgetMs, scale, lo, hi }) {
  const out = { scale, windowMs: 0, overloadedAtFloor: false };
  if (!(dtMs > 0) || dtMs > HITCH_MS) return out;
  g.valid += dtMs;
  if (g.valid < GRACE_MS) return out;
  g.sum += workMs; g.n++; g.win += dtMs;
  if (g.win < WINDOW_MS) return out;
  const avg = g.sum / g.n; g.lastAvg = avg; out.windowMs = g.win;
  g.sum = 0; g.n = 0; g.win = 0;
  const atFloor = scale <= lo + 1e-6;
  if (avg > budgetMs * DOWN_ABOVE) {
    g.okWindows = 0;
    if (atFloor) out.overloadedAtFloor = true;
    else out.scale = Math.max(lo, quantise(scale - SCALE_STEP));
  } else if (avg < budgetMs * UP_BELOW && scale < hi - 1e-6) {
    if (++g.okWindows >= 2) { g.okWindows = 0; out.scale = Math.min(hi, quantise(scale + SCALE_STEP)); }
  } else g.okWindows = 0;
  return out;
}
