// Pure Keplerian helpers (no three.js) for small bodies: CPU twin of the asteroid vertex shader.
import { AU, DEG } from 'orion/core/units.js';

export const GAUSS_K = 0.01720209895; // rad/day for a = 1 AU, solar mass only

// Solve M = E - e sin E (elliptic). Robust to e → 0.999 (Newton with a safe start, then bisection guard).
export function solveKepler(M, e) {
  const TAU = Math.PI * 2;
  M = M - TAU * Math.floor((M + Math.PI) / TAU); // → [-π, π)
  let E = e < 0.8 ? M + e * Math.sin(M) : (M < 0 ? -Math.PI : Math.PI) * 0.9 + M * 0.1;
  for (let k = 0; k < 40; k++) {
    const f = E - e * Math.sin(E) - M, d = 1 - e * Math.cos(E);
    let dE = -f / d;
    if (Math.abs(dE) > 1) dE = Math.sign(dE); // damp wild steps at high e
    E += dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  return E;
}

/** el = { a (AU), e, i, om (Ω), w (ω), M0 (rad), epoch (JD) }; returns heliocentric ecliptic J2000 metres. */
export function elementsToPos(el, jd, out = new Float64Array(3)) {
  const n = GAUSS_K / (el.a * Math.sqrt(el.a));
  const E = solveKepler(el.M0 + n * (jd - el.epoch), el.e);
  const xv = el.a * (Math.cos(E) - el.e), yv = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  return rotate(el, xv, yv, out);
}

function rotate(el, xv, yv, out) {
  const co = Math.cos(el.om), so = Math.sin(el.om), cw = Math.cos(el.w), sw = Math.sin(el.w), ci = Math.cos(el.i), si = Math.sin(el.i);
  out[0] = (xv * (cw * co - sw * ci * so) - yv * (sw * co + cw * ci * so)) * AU;
  out[1] = (xv * (cw * so + sw * ci * co) - yv * (sw * so - cw * ci * co)) * AU;
  out[2] = (xv * sw * si + yv * cw * si) * AU;
  return out;
}

/** Build elements from JPL SBDB-style degrees. If tp (perihelion JD) is given the epoch is tp and M0 = 0. */
export function makeElements({ a, e, iDeg, omDeg, wDeg, maDeg = 0, epoch, tp }) {
  return { a, e, i: iDeg * DEG, om: omDeg * DEG, w: wDeg * DEG, M0: tp !== undefined ? 0 : maDeg * DEG, epoch: tp !== undefined ? tp : epoch };
}

/** One orbit as a closed polyline (metres, heliocentric), uniform in eccentric anomaly; far end clamped to maxAU. */
export function orbitPoints(el, n = 512, maxAU = 600) {
  const out = new Float64Array(n * 3), b = el.a * Math.sqrt(1 - el.e * el.e);
  for (let k = 0; k < n; k++) {
    const E = (k / n) * Math.PI * 2;
    const xv = el.a * (Math.cos(E) - el.e), yv = b * Math.sin(E);
    const r = Math.hypot(xv, yv), s = r > maxAU ? maxAU / r : 1;
    rotate(el, xv * s, yv * s, out.subarray(k * 3, k * 3 + 3));
  }
  return out;
}
