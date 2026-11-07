// Planetary ring radial profiles (pure data; textures are created lazily so jsc tests can import this).
//
//   getRingProfile(id) → { texture, tauTexture, innerKm, outerKm, ... } | null     (saturn, jupiter, uranus, neptune)
//
//   texture     THREE.DataTexture 4096×1 RGBA8, linear: rgb = particle albedo tint, a = 1 − exp(−τ) (normal-incidence opacity)
//   tauTexture  THREE.DataTexture 4096×1 RGBA16F: r = τ (normal optical depth), g = forward-scatter fraction (dust → 1),
//               b = arc mask (Neptune's Adams ring), a = 1
// u = (r − innerKm) / (outerKm − innerKm). Both textures carry hand-built mip chains (transmittance-averaged).
//
// Saturn: breakpoints below approximate Cassini RSS/UVIS/VIMS stellar-occultation optical depths (Colwell et al. 2009,
// Hedman et al. 2013, Tiscareno et al. 2013); fine ringlet structure is deterministic multi-scale noise on top.
// Jupiter's (τ ≈ 1e-7–1e-5) and Neptune's (τ ≈ 1e-4–1e-2) optical depths are physical: they are visible only where the
// shader's strong forward-scattering lobe applies (looking back toward the Sun through the ring from the planet's far side).
// Because Jupiter's τ underflows half floats, tauTexture stores τ × tauScale (1e4 for Jupiter, 1 otherwise).
import * as THREE from 'three';

export const N = 4096;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---- deterministic noise -----------------------------------------------------------------------------------------
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function vnoise(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u); }
function fbm(x, seed) { return 0.5 * vnoise(x / 3 + seed) + 0.3 * vnoise(x / 1.1 + seed * 2.3) + 0.2 * vnoise(x / 0.37 + seed * 4.1); }

const piecewise = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1); return lerp(pts[i - 1][1], pts[i][1], t); }
  return pts[pts.length - 1][1];
};
const piecewiseV = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1); return pts[i - 1][1].map((v, k) => lerp(v, pts[i][1][k], t)); }
  return pts[pts.length - 1][1];
};

// ---- ring definitions (radii in km from the planet's centre) ----------------------------------------------------------
// tau: [r, τ] breakpoints (linear); gaps: multiply by (1 − depth) inside a ±w/2 window; ringlets: gaussian-ish τ bumps (w = FWHM-ish).
const SATURN = {
  innerKm: 66900, outerKm: 140600, planetAlbedo: 0.38,
  tau: [
    // D ring (faint dust) and the D68 / D72 ringlets are added below
    [66900, 0.0015], [67500, 0.003], [74400, 0.004], [74480, 0.004],
    // C ring: τ ≈ 0.05–0.2 with plateaus
    [74490, 0.04], [75500, 0.07], [77000, 0.10], [78500, 0.07], [80000, 0.09], [80900, 0.16], [82000, 0.21], [83000, 0.21], [83500, 0.12],
    [84500, 0.10], [86000, 0.13], [87000, 0.10], [88000, 0.09], [89000, 0.12], [90000, 0.14], [91000, 0.12], [91950, 0.10],
    // B ring: sharp inner edge at 91,983 km, τ 1–5 (occultations saturate near 5)
    [91985, 0.35], [92400, 0.5], [93500, 0.8], [94500, 0.65], [95500, 1.0], [96500, 1.2], [97500, 1.5], [98300, 1.3], [99000, 1.8],
    [100000, 2.4], [101500, 1.9], [103000, 2.6], [104000, 3.2], [105000, 2.2], [106000, 1.8], [107000, 2.6], [108000, 3.6],
    [109500, 4.2], [110500, 3.1], [111500, 4.4], [112500, 4.8], [113500, 3.8], [114500, 5.0], [115500, 3.5], [116500, 2.8],
    [117000, 2.4], [117480, 2.6], [117507, 2.6],
    // Cassini Division: τ ≈ 0.05–0.15
    [117530, 0.08], [118000, 0.10], [119000, 0.09], [120000, 0.08], [120500, 0.12], [121000, 0.14], [121500, 0.13], [122100, 0.15], [122165, 0.15],
    // A ring: τ ≈ 0.4–0.85, sharp outer edge at 136,775 km
    [122175, 0.45], [123000, 0.50], [124000, 0.52], [125000, 0.55], [126000, 0.60], [127000, 0.70], [128000, 0.78], [129000, 0.80],
    [130000, 0.85], [131000, 0.80], [132000, 0.70], [133000, 0.62], [134000, 0.58], [135000, 0.55], [136000, 0.50], [136765, 0.50], [136790, 0.0003],
    [139500, 0.0003], [140600, 0.0003],
  ],
  gaps: [
    { c: 77870, w: 90, d: 0.7 },    // Colombo gap
    { c: 87491, w: 270, d: 0.85 },  // Maxwell gap
    { c: 88700, w: 40, d: 0.5 },    // Bond gap
    { c: 90210, w: 30, d: 0.6 },    // Dawes gap
    { c: 117848, w: 25, d: 0.3 },
    { c: 118234, w: 15, d: 0.8 },   // Herschel gap
    { c: 118630, w: 30, d: 0.7 },   // Russell gap
    { c: 118969, w: 20, d: 0.7 },   // Jeffreys gap
    { c: 119405, w: 15, d: 0.8 },   // Kuiper gap
    { c: 119967, w: 238, d: 0.75 }, // Laplace gap
    { c: 120243, w: 12, d: 0.7 },   // Bessel gap
    { c: 120312, w: 12, d: 0.7 },   // Barnard gap
    { c: 133589, w: 325, d: 0.96 }, // Encke gap
    { c: 136505, w: 35, d: 0.93 },  // Keeler gap
    { c: 125500, w: 120, d: 0.25 }, // Janus/Epimetheus 2:1 resonance
  ],
  ringlets: [
    { c: 67628, w: 40, tau: 0.015 }, { c: 72000, w: 250, tau: 0.02 }, { c: 73200, w: 400, tau: 0.012 },
    { c: 77870, w: 25, tau: 0.25 },   // Titan ringlet
    { c: 87491, w: 60, tau: 0.5 },    // Maxwell ringlet
    { c: 117848, w: 30, tau: 0.8 },   // Huygens ringlet
    { c: 133423, w: 12, tau: 0.12 }, { c: 133745, w: 12, tau: 0.1 }, // Encke ringlets
    { c: 140180, w: 26, tau: 0.55 },  // F ring core
    { c: 140180, w: 320, tau: 0.045 },// F ring strands
    { c: 140000, w: 700, tau: 0.004 },
  ],
  colour: [ // [r, linear albedo tint]
    [66900, [0.36, 0.33, 0.30]], [74400, [0.40, 0.36, 0.31]], [74500, [0.38, 0.34, 0.29]], [91900, [0.40, 0.35, 0.30]], [91990, [0.82, 0.68, 0.50]],
    [98000, [0.88, 0.74, 0.55]], [104000, [0.94, 0.80, 0.60]], [112000, [0.92, 0.79, 0.61]], [117500, [0.88, 0.77, 0.62]], [117530, [0.46, 0.43, 0.39]],
    [122150, [0.48, 0.44, 0.40]], [122180, [0.70, 0.65, 0.57]], [130000, [0.74, 0.69, 0.60]], [136770, [0.72, 0.68, 0.61]], [136800, [0.84, 0.82, 0.78]],
    [140600, [0.84, 0.82, 0.78]],
  ],
  fwd: [[66900, 0.55], [74480, 0.5], [74500, 0.3], [91950, 0.25], [91990, 0.1], [117500, 0.09], [117530, 0.35], [122150, 0.30], [122180, 0.18], [136770, 0.2], [136800, 0.6], [140600, 0.6]],
  // fine-structure amplitude (log-τ) by radius
  detail: [[66900, 0.25], [91900, 0.3], [91990, 0.5], [117500, 0.5], [117530, 0.3], [122180, 0.15], [136770, 0.12], [140600, 0.2]],
};

const JUPITER = { // physical: halo τ ~ 1e-6–3e-6, main ring ~ 1e-5 (upper end of Showalter et al. 2008 / Ockert-Bell 1999), Amalthea gossamer ~ 2e-7, Thebe ~ 5e-8; micron dust, all forward-scattering
  innerKm: 90000, outerKm: 226000, planetAlbedo: 0.5, tauScale: 1e4,
  tau: [[90000, 0], [92000, 1e-6], [100000, 2e-6], [110000, 3e-6], [122400, 4e-6], [122500, 9e-6], [128900, 1.1e-5], [129000, 6e-7], [129100, 2e-7],
    [129200, 2.5e-7], [182000, 2e-7], [182100, 7e-8], [226000, 4e-8]],
  gaps: [], ringlets: [],
  colour: [[90000, [0.30, 0.26, 0.22]], [226000, [0.34, 0.28, 0.22]]],
  fwd: [[90000, 1], [226000, 1]],
  detail: [[90000, 0.2], [226000, 0.2]],
};

const URANUS = {
  innerKm: 37000, outerKm: 51800, planetAlbedo: 0.5,
  tau: [[37000, 0.0006], [41800, 0.0006], [51800, 0.0006]],
  gaps: [],
  ringlets: [
    { c: 38500, w: 2500, tau: 0.0008 }, // ζ dust sheet
    { c: 41837, w: 2, tau: 0.3 }, { c: 42235, w: 2, tau: 0.5 }, { c: 42571, w: 2, tau: 0.3 }, // 6, 5, 4
    { c: 44718, w: 8, tau: 0.35 }, { c: 45661, w: 7, tau: 0.2 }, // α, β
    { c: 47176, w: 2, tau: 0.1 }, { c: 47627, w: 3, tau: 0.6 }, { c: 48300, w: 7, tau: 0.3 }, // η, γ, δ
    { c: 50024, w: 2, tau: 0.1 },       // λ
    { c: 51149, w: 45, tau: 1.8 },      // ε: widest, densest, brightest
  ],
  colour: [[37000, [0.05, 0.047, 0.044]], [51800, [0.065, 0.06, 0.055]]],
  fwd: [[37000, 0.7], [41700, 0.7], [41800, 0.15], [51300, 0.15], [51800, 0.4]],
  detail: [[37000, 0.3], [51800, 0.3]],
};

const NEPTUNE = { // Adams-ring arcs are masked by azimuth in the shader (b channel = 1 inside the Adams ring)
  innerKm: 40000, outerKm: 64000, planetAlbedo: 0.4, arcMaskRing: [62880, 62990],
  tau: [[40000, 0.0001], [64000, 0.0001]],
  gaps: [],
  ringlets: [
    { c: 41900, w: 2000, tau: 0.0006 },   // Galle
    { c: 53200, w: 113, tau: 0.012 },     // Le Verrier
    { c: 55200, w: 4000, tau: 0.002 },    // Lassell plateau
    { c: 57200, w: 100, tau: 0.01 },      // Arago
    { c: 62933, w: 35, tau: 0.012 },      // Adams (background; arcs ×~8 in shader)
  ],
  colour: [[40000, [0.07, 0.065, 0.06]], [64000, [0.08, 0.072, 0.065]]],
  fwd: [[40000, 0.7], [62900, 0.4], [64000, 0.5]],
  detail: [[40000, 0.2], [64000, 0.2]],
};

const DEFS = { saturn: SATURN, jupiter: JUPITER, uranus: URANUS, neptune: NEPTUNE };

// ---- baking ----------------------------------------------------------------------------------------------------------
function tauAtKm(def, r, noiseSeed) {
  let tau = piecewise(def.tau, r);
  for (const g of def.gaps) { const t = Math.abs(r - g.c) / (g.w / 2); if (t < 1) tau *= 1 - g.d * (t < 0.75 ? 1 : (1 - t) / 0.25); }
  for (const k of def.ringlets) { const t = (r - k.c) / (k.w / 2); if (Math.abs(t) < 3) tau += k.tau * Math.exp(-t * t * 1.2); }
  const amp = piecewise(def.detail, r);
  const n = fbm(r / 40, noiseSeed) * 2 - 1, n2 = fbm(r / 9, noiseSeed + 7) * 2 - 1;
  return Math.max(0, tau * Math.exp(amp * (0.8 * n + 0.5 * n2)));
}

/** Pure bake: returns raw arrays (Float32) so tests and CPU consumers need no three.js. */
export function bakeRing(id) {
  const def = DEFS[id]; if (!def) return null;
  const SUB = 4, span = def.outerKm - def.innerKm, seed = id.length * 1.7;
  const tau = new Float32Array(N), fwd = new Float32Array(N), arc = new Float32Array(N), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    let tr = 0, cm = [0, 0, 0], f = 0, rc = def.innerKm + ((i + 0.5) / N) * span;
    for (let s = 0; s < SUB; s++) {
      const r = def.innerKm + ((i + (s + 0.5) / SUB) / N) * span;
      tr += Math.exp(-tauAtKm(def, r, seed) * 1.0);
    }
    tau[i] = -Math.log(Math.max(tr / SUB, 1e-12));
    const c = piecewiseV(def.colour, rc);
    for (let k = 0; k < 3; k++) col[i * 3 + k] = c[k] * (0.94 + 0.12 * fbm(rc / 25, seed + 3));
    f = piecewise(def.fwd, rc); fwd[i] = clamp01(f);
    if (def.arcMaskRing) arc[i] = rc >= def.arcMaskRing[0] && rc <= def.arcMaskRing[1] ? 1 : 0;
    void cm;
  }
  return { id, innerKm: def.innerKm, outerKm: def.outerKm, tau, fwd, arc, col, planetAlbedo: def.planetAlbedo, tauScale: def.tauScale || 1 };
}

const f16 = (x) => (THREE.DataUtils ? THREE.DataUtils.toHalfFloat(Math.min(x, 60000)) : 0);

function buildMips(baked) {
  const scale = baked.tauScale;
  const rgba8 = [], f16s = [];
  let tau = Float64Array.from(baked.tau), fwd = Float64Array.from(baked.fwd), arc = Float64Array.from(baked.arc), col = Float64Array.from(baked.col);
  let w = N;
  for (let lvl = 0; w >= 1; lvl++) {
    const d8 = new Uint8Array(w * 4), d16 = new Uint16Array(w * 4);
    for (let i = 0; i < w; i++) {
      const op = 1 - Math.exp(-tau[i]);
      d8[i * 4] = Math.round(clamp01(col[i * 3]) * 255); d8[i * 4 + 1] = Math.round(clamp01(col[i * 3 + 1]) * 255);
      d8[i * 4 + 2] = Math.round(clamp01(col[i * 3 + 2]) * 255); d8[i * 4 + 3] = Math.round(clamp01(op) * 255);
      d16[i * 4] = f16(tau[i] * scale); d16[i * 4 + 1] = f16(fwd[i]); d16[i * 4 + 2] = f16(arc[i]); d16[i * 4 + 3] = f16(1);
    }
    rgba8.push({ data: d8, width: w, height: 1 }); f16s.push({ data: d16, width: w, height: 1 });
    if (w === 1) break;
    const h = w >> 1, t2 = new Float64Array(h), f2 = new Float64Array(h), a2 = new Float64Array(h), c2 = new Float64Array(h * 3);
    for (let i = 0; i < h; i++) {
      const e0 = Math.exp(-tau[2 * i]), e1 = Math.exp(-tau[2 * i + 1]); // average transmittance, not τ
      t2[i] = -Math.log(Math.max((e0 + e1) / 2, 1e-12));
      const o0 = 1 - e0 + 1e-6, o1 = 1 - e1 + 1e-6; // colour weighted by opacity
      for (let k = 0; k < 3; k++) c2[i * 3 + k] = (col[2 * i * 3 + k] * o0 + col[(2 * i + 1) * 3 + k] * o1) / (o0 + o1);
      f2[i] = (fwd[2 * i] * o0 + fwd[2 * i + 1] * o1) / (o0 + o1);
      a2[i] = Math.max(arc[2 * i], arc[2 * i + 1]);
    }
    tau = t2; fwd = f2; arc = a2; col = c2; w = h;
  }
  return { rgba8, f16s };
}

const cache = new Map();
export function getRingProfile(id) {
  if (cache.has(id)) return cache.get(id);
  const baked = bakeRing(id);
  if (!baked) { cache.set(id, null); return null; }
  const { rgba8, f16s } = buildMips(baked);
  const mk = (levels, type) => {
    const t = new THREE.DataTexture(levels[0].data, N, 1, THREE.RGBAFormat, type);
    t.mipmaps = levels; t.generateMipmaps = false;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    return t;
  };
  const profile = {
    id, innerKm: baked.innerKm, outerKm: baked.outerKm, planetAlbedo: baked.planetAlbedo, tauScale: baked.tauScale,
    texture: mk(rgba8, THREE.UnsignedByteType), tauTexture: mk(f16s, THREE.HalfFloatType),
    /** Normal optical depth at radius r (km) from the baked data (CPU). */
    tauAt(rKm) { const u = (rKm - baked.innerKm) / (baked.outerKm - baked.innerKm); if (u < 0 || u >= 1) return 0; return baked.tau[Math.min(N - 1, Math.floor(u * N))]; },
    /** Fraction of sunlight blocked at radius r for a sun elevation mu = |cos(zenith)|: for cloud-top ring shadows. */
    shadowAt(rKm, mu) { return 1 - Math.exp(-this.tauAt(rKm) / Math.max(mu, 0.02)); },
    baked,
  };
  cache.set(id, profile);
  return profile;
}
export const hasRings = (id) => id in DEFS;
