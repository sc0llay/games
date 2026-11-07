import { DEG, PC, YEAR } from 'orion/core/units.js';
import { J2000 } from 'orion/core/time.js';

// World frame: heliocentric ecliptic J2000, metres, +z = ecliptic north, +x = vernal equinox.
// Matrices are row-major 3×3 Float64 arrays: out = M · v.

export const OBLIQUITY_J2000 = 23.4392911 * DEG;

const ce = Math.cos(OBLIQUITY_J2000), se = Math.sin(OBLIQUITY_J2000);
export const EQ_TO_ECL = [1, 0, 0, 0, ce, se, 0, -se, ce];
export const ECL_TO_EQ = [1, 0, 0, 0, ce, -se, 0, se, ce];

// ICRS → galactic (Hipparcos, ESA 1997 vol. 1 §1.5.3). NGP at RA 192.859°, Dec +27.128°.
export const EQ_TO_GAL = [
  -0.0548755604, -0.8734370902, -0.4838350155,
  0.4941094279, -0.4448296300, 0.7469822445,
  -0.8676661490, -0.1980763734, 0.4559837762,
];
export const GAL_TO_EQ = transpose(EQ_TO_GAL);
export const GAL_TO_ECL = mul(EQ_TO_ECL, GAL_TO_EQ);
export const ECL_TO_GAL = transpose(GAL_TO_ECL);

export function transpose(m) { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }
export function mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
export function apply(m, v, out = new Float64Array(3)) {
  const x = v[0], y = v[1], z = v[2];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}
const sph = (lonDeg, latDeg, r, out) => {
  const lo = lonDeg * DEG, la = latDeg * DEG, c = Math.cos(la);
  out[0] = r * c * Math.cos(lo); out[1] = r * c * Math.sin(lo); out[2] = r * Math.sin(la); return out;
};
const tmp = new Float64Array(3);
export const radecToWorld = (raDeg, decDeg, dist, out = new Float64Array(3)) => apply(EQ_TO_ECL, sph(raDeg, decDeg, dist, tmp), out);
export const galToWorld = (lDeg, bDeg, dist, out = new Float64Array(3)) => apply(GAL_TO_ECL, sph(lDeg, bDeg, dist, tmp), out);
export function worldToGal(v) { // → { l, b } degrees
  const g = apply(ECL_TO_GAL, v);
  const r = Math.hypot(g[0], g[1], g[2]) || 1;
  return { l: ((Math.atan2(g[1], g[0]) / DEG) + 360) % 360, b: Math.asin(g[2] / r) / DEG };
}

// Galaxy frame (parsecs): origin at the Galactic Centre, +X from the Sun toward the GC (l = 0°),
// +Y toward l = 90° (direction of rotation at the Sun), +Z toward the north galactic pole.
export const R0_PC = 8180;    // GRAVITY 2019
export const Z_SUN_PC = 20.8; // Bennett & Bovy 2019
export const SUN_GALAXY_PC = [-R0_PC, 0, Z_SUN_PC];
export const OMEGA_P = 28 / 3.0856775814913673e16; // pattern speed, rad/s (28 km/s/kpc)

// Disk pattern angle about +Z; clockwise seen from the NGP, so negative for t > J2000.
export const galaxyAngle = (jd) => -OMEGA_P * (jd - J2000) * 86400;

// The galaxy rotates rigidly about an axis through the Sun parallel to +Z. Following the GC
// with the camera then shows the disk turning about its own centre with the Sun carried along.
// Returns a column-major 4×4 (THREE.Matrix4.fromArray order) mapping galaxy pc → world pc.
export function galaxyToWorldMatrix(jd, out = new Float64Array(16)) {
  const t = galaxyAngle(jd), c = Math.cos(t), s = Math.sin(t);
  const Rz = [c, -s, 0, s, c, 0, 0, 0, 1];
  const M = mul(GAL_TO_ECL, Rz);
  const S = apply(M, SUN_GALAXY_PC);
  out[0] = M[0]; out[1] = M[3]; out[2] = M[6]; out[3] = 0;
  out[4] = M[1]; out[5] = M[4]; out[6] = M[7]; out[7] = 0;
  out[8] = M[2]; out[9] = M[5]; out[10] = M[8]; out[11] = 0;
  out[12] = -S[0]; out[13] = -S[1]; out[14] = -S[2]; out[15] = 1;
  return out;
}
// Galaxy-frame pc point → world metres.
export function galaxyToWorld(g, jd, out = new Float64Array(3)) {
  const m = galaxyToWorldMatrix(jd, _m);
  const x = g[0], y = g[1], z = g[2];
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * PC;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * PC;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * PC;
  return out;
}
const _m = new Float64Array(16);
export const GALACTIC_YEAR = (2 * Math.PI) / OMEGA_P / YEAR; // ≈ 219 Myr
