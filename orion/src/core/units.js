// SI internally. Distances are metres, times are seconds, angles radians unless a name says otherwise.

export const C = 299792458;              // m/s
export const AU = 1.495978707e11;        // m (IAU 2012)
export const LY = 9.4607304725808e15;    // m (Julian year)
export const PC = 3.0856775814913673e16; // m
export const KPC = PC * 1e3;
export const KM = 1e3;
export const DAY = 86400;
export const YEAR = 365.25 * DAY;
export const MYR = 1e6 * YEAR;
export const DEG = Math.PI / 180;
export const R_SUN = 6.957e8;            // m
export const L_SUN = 3.828e26;           // W

// Render-layer unit scales: the system layer is in kilometres, the sky layer in parsecs.
export const SYSTEM_UNIT = KM;
export const SKY_UNIT = PC;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Trapezoid weight on a log10 axis: 0 below a, ramps to 1 at b, holds to c, ramps to 0 at d.
export function band(log10x, a, b, c, d) {
  if (log10x <= a || log10x >= d) return 0;
  if (log10x < b) return smoothstep(a, b, log10x);
  if (log10x > c) return 1 - smoothstep(c, d, log10x);
  return 1;
}

const fmt = (v, digits = 3) => {
  const a = Math.abs(v);
  if (a >= 1e5 || (a > 0 && a < 1e-2)) return v.toExponential(2).replace('e+', '×10^').replace('e-', '×10^-');
  return v.toLocaleString('en-GB', { maximumSignificantDigits: digits });
};

// Human distance with automatic units: km → AU → ly → kpc.
export function formatDistance(m, digits = 3) {
  const a = Math.abs(m);
  if (a < 1e6) return `${fmt(m / 1e3, digits)} km`;
  if (a < 1e9) return `${fmt(m / 1e6, digits)} Mm`;
  if (a < 0.01 * AU) return `${fmt(m / 1e9, digits)} Gm`;
  if (a < 0.05 * LY) return `${fmt(m / AU, digits)} AU`;
  if (a < 1000 * PC) return `${fmt(m / LY, digits)} ly`;
  return `${fmt(m / KPC, digits)} kpc`;
}

export function formatDuration(s) {
  const a = Math.abs(s);
  if (a < 60) return `${fmt(s, 3)} s`;
  if (a < 3600) return `${fmt(s / 60, 3)} min`;
  if (a < DAY) return `${fmt(s / 3600, 3)} h`;
  if (a < YEAR) return `${fmt(s / DAY, 3)} days`;
  if (a < 1e6 * YEAR) return `${fmt(s / YEAR, 3)} yr`;
  return `${fmt(s / MYR, 3)} Myr`;
}

// Float64 vector helpers on plain arrays / Float64Array(3).
export const v3 = (x = 0, y = 0, z = 0) => { const v = new Float64Array(3); v[0] = x; v[1] = y; v[2] = z; return v; };
export const vsub = (a, b, out = v3()) => { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; };
export const vadd = (a, b, out = v3()) => { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; };
export const vscale = (a, s, out = v3()) => { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; };
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const vcopy = (a, out = v3()) => { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; };
