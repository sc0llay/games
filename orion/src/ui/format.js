// Pure formatting / maths helpers for the UI (unit-tested headless).
import { jdFromDate, dateFromJd, J2000 } from 'orion/core/time.js';
import { AU, LY, PC, KPC } from 'orion/core/units.js';

export const LEVEL_NAMES = ['Galaxy', 'Spiral arm', 'Neighbourhood', 'Solar system', 'Planet'];
export const dominantLevel = (lv) => { let b = 0; if (lv) for (let i = 1; i < lv.length; i++) if (lv[i] > lv[b]) b = i; return b; };
export const typeLabel = (t) => { const s = String(t || 'object').replace(/-/g, ' '); return s[0].toUpperCase() + s.slice(1); };
const LEVEL_BY_TYPE = { sun: 3, planet: 3, moon: 4, dwarf: 3, asteroid: 3, comet: 3, star: 2, nebula: 1, 'open-cluster': 1, globular: 0, galaxy: 0, planetary: 1, snr: 1, region: 0, constellation: 2, marker: 3 };
export const levelOf = (e) => (Number.isInteger(e.level) ? e.level : LEVEL_BY_TYPE[e.type] ?? 2);

// UTC date text for a TT Julian Date. Falls back to a year count beyond what Date can hold.
export function fmtUtc(jd) {
  const d = dateFromJd(jd);
  if (!Number.isFinite(d.getTime())) {
    const y = 2000 + (jd - J2000) / 365.25;
    return `year ${Math.abs(y) >= 1e6 ? (y / 1e6).toFixed(2) + ' Myr' : y.toFixed(0)}`;
  }
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}
// "2026-08-12 17:45[:00]" (also ISO with T/Z, optional signed 4–6 digit year) → TT Julian Date or null.
export function parseUtc(text) {
  const m = /^\s*([+-]?\d{4,6})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(?:Z|UTC)?\s*$/i.exec(text || '');
  if (!m) return null;
  const d = new Date(0);
  d.setUTCFullYear(+m[1], +m[2] - 1, +m[3]);
  d.setUTCHours(+(m[4] || 0), +(m[5] || 0), +(m[6] || 0), 0);
  return Number.isFinite(d.getTime()) ? jdFromDate(d) : null;
}

const SCALE_UNITS = [
  { n: 'm', f: 1, min: 1 }, { n: 'km', f: 1e3, min: 1 }, { n: 'Mm', f: 1e6, min: 1 }, { n: 'Gm', f: 1e9, min: 1 },
  { n: 'AU', f: AU, min: 0.1 }, { n: 'ly', f: LY, min: 0.1 }, { n: 'pc', f: PC, min: 1 }, { n: 'kpc', f: KPC, min: 1 },
];
// Scale bar: a round length close to `targetPx` pixels wide. → { label, px }
export function niceScale(metresPerPx, targetPx = 100) {
  const L = metresPerPx * targetPx;
  let u = SCALE_UNITS[0];
  for (const c of SCALE_UNITS) if (L >= c.f * c.min) u = c;
  const n = L / u.f, p = Math.pow(10, Math.floor(Math.log10(n))), m = n / p;
  const nice = Number(((m >= 5 ? 5 : m >= 2 ? 2 : 1) * p).toPrecision(3));
  return { label: `${nice.toLocaleString('en-GB', { maximumFractionDigits: 3 })} ${u.n}`, px: (nice * u.f) / metresPerPx };
}

// 36 × 24 mm full frame: vertical field of view for a focal length.
export const focalToFov = (mm) => (2 * Math.atan(12 / mm) * 180) / Math.PI;
export const fovToFocal = (deg) => 12 / Math.tan((deg * Math.PI) / 360);

// Orbit-camera az/el (as core/camera.js defines them for a given up axis) for a unit offset direction.
export function dirToAzEl(up, dir) {
  let x = [1, 0, 0];
  if (Math.abs(up[0]) > 0.9) x = [0, 1, 0];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nz = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const y = nz(cr(up, x)); x = nz(cr(y, up));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const d = nz(dir);
  return { el: Math.asin(Math.max(-1, Math.min(1, dot(d, up)))), az: Math.atan2(dot(d, y), dot(d, x)) };
}

export const fmtLatLon = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
export function fmtDay(h) {
  const a = Math.abs(h), s = a >= 48 ? `${(a / 24).toFixed(2)} days` : `${a.toFixed(2)} h`;
  return h < 0 ? `${s} (retrograde)` : s;
}
