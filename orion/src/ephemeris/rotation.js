// Body orientation: IAU WGCCRE 2015 pole (RA/Dec of the north pole) and prime-meridian angle W(d).
// bodyQuaternion maps body-fixed axes (+z north pole, +x prime meridian) into the world frame
// (heliocentric ecliptic J2000). Bodies without an IAU model fall back to synchronous rotation
// (+x toward the parent, +z orbit normal) or, for the small dwarf planets, a simple linear spin.
import * as THREE from 'three';
import { DEG } from 'orion/core/units.js';
import { getBody } from 'orion/ephemeris/bodies.js';

const EPS = 23.4392911 * DEG; // mean obliquity at J2000
const sinE = Math.sin(EPS), cosE = Math.cos(EPS);
const sin = (x) => Math.sin(x * DEG), cos = (x) => Math.cos(x * DEG);

// Each model writes [ra, dec, W] in degrees for d days and T Julian centuries from J2000 (TDB).
const MODELS = {
  sun: (d, T, o) => { o[0] = 286.13; o[1] = 63.87; o[2] = 84.176 + 14.1844 * d; },
  mercury: (d, T, o) => {
    const M1 = 174.7910857 + 4.092335 * d, M2 = 349.5821714 + 8.184670 * d, M3 = 164.3732571 + 12.277005 * d, M4 = 339.1643429 + 16.369340 * d, M5 = 153.9554286 + 20.461675 * d;
    o[0] = 281.0103 - 0.0328 * T; o[1] = 61.4155 - 0.0049 * T;
    o[2] = 329.5988 + 6.1385108 * d + 0.01067257 * sin(M1) - 0.00112309 * sin(M2) - 0.0001104 * sin(M3) - 0.00002539 * sin(M4) - 0.00000571 * sin(M5);
  },
  venus: (d, T, o) => { o[0] = 272.76; o[1] = 67.16; o[2] = 160.2 - 1.4813688 * d; },
  earth: (d, T, o) => { o[0] = -0.641 * T; o[1] = 90 - 0.557 * T; o[2] = 190.147 + 360.9856235 * d; },
  mars: (d, T, o) => {
    const a = 0.5042615 * T;
    o[0] = 317.269202 - 0.10927547 * T + 0.000068 * sin(198.991226 + 19139.4819985 * T) + 0.000238 * sin(226.292679 + 38280.8511281 * T) + 0.000052 * sin(249.663391 + 57420.7251593 * T) + 0.000009 * sin(266.18351 + 76560.636795 * T) + 0.419057 * sin(79.398797 + a);
    o[1] = 54.432516 - 0.05827105 * T + 0.000051 * cos(122.433576 + 19139.9407476 * T) + 0.000141 * cos(43.058401 + 38280.8753272 * T) + 0.000031 * cos(57.663379 + 57420.7517205 * T) + 0.000005 * cos(79.476401 + 76560.6495004 * T) + 1.591274 * cos(166.325722 + a);
    o[2] = 176.049863 + 350.891982443297 * d + 0.000145 * sin(129.071773 + 19140.0328244 * T) + 0.000157 * sin(36.352167 + 38281.0473591 * T) + 0.00004 * sin(56.668646 + 57420.929536 * T) + 0.000001 * sin(67.364003 + 76560.2552215 * T) + 0.000001 * sin(104.79268 + 95700.4387578 * T) + 0.584542 * sin(95.391654 + a);
  },
  jupiter: (d, T, o) => {
    const Ja = 99.360714 + 4850.4046 * T, Jb = 175.895369 + 1191.9605 * T, Jc = 300.323162 + 262.5475 * T, Jd = 114.012305 + 6070.2476 * T, Je = 49.511251 + 64.3 * T;
    o[0] = 268.056595 - 0.006499 * T + 0.000117 * sin(Ja) + 0.000938 * sin(Jb) + 0.001432 * sin(Jc) + 0.00003 * sin(Jd) + 0.00215 * sin(Je);
    o[1] = 64.495303 + 0.002413 * T + 0.00005 * cos(Ja) + 0.000404 * cos(Jb) + 0.000617 * cos(Jc) - 0.000013 * cos(Jd) + 0.000926 * cos(Je);
    o[2] = 284.95 + 870.536 * d; // System III
  },
  saturn: (d, T, o) => { o[0] = 40.589 - 0.036 * T; o[1] = 83.537 - 0.004 * T; o[2] = 38.9 + 810.7939024 * d; },
  uranus: (d, T, o) => { o[0] = 257.311; o[1] = -15.175; o[2] = 203.81 - 501.1600928 * d; },
  neptune: (d, T, o) => {
    const N = 357.85 + 52.316 * T;
    o[0] = 299.36 + 0.7 * sin(N); o[1] = 43.46 - 0.51 * cos(N); o[2] = 249.978 + 541.1397757 * d - 0.48 * sin(N);
  },
  moon: (d, T, o) => {
    const E1 = 125.045 - 0.0529921 * d, E2 = 250.089 - 0.1059842 * d, E3 = 260.008 + 13.0120009 * d, E4 = 176.625 + 13.3407154 * d, E5 = 357.529 + 0.9856003 * d,
      E6 = 311.589 + 26.4057084 * d, E7 = 134.963 + 13.064993 * d, E8 = 276.617 + 0.3287146 * d, E9 = 34.226 + 1.7484877 * d, E10 = 15.134 - 0.1589763 * d,
      E11 = 119.743 + 0.0036096 * d, E12 = 239.961 + 0.1643573 * d, E13 = 25.053 + 12.9590088 * d;
    o[0] = 269.9949 + 0.0031 * T - 3.8787 * sin(E1) - 0.1204 * sin(E2) + 0.07 * sin(E3) - 0.0172 * sin(E4) + 0.0072 * sin(E6) - 0.0052 * sin(E10) + 0.0043 * sin(E13);
    o[1] = 66.5392 + 0.013 * T + 1.5419 * cos(E1) + 0.0239 * cos(E2) - 0.0278 * cos(E3) + 0.0068 * cos(E4) - 0.0029 * cos(E6) + 0.0009 * cos(E7) + 0.0008 * cos(E10) - 0.0009 * cos(E13);
    o[2] = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.561 * sin(E1) + 0.1208 * sin(E2) - 0.0642 * sin(E3) + 0.0158 * sin(E4) + 0.0252 * sin(E5) - 0.0066 * sin(E6) - 0.0047 * sin(E7) - 0.0046 * sin(E8) + 0.0028 * sin(E9) + 0.0052 * sin(E10) + 0.004 * sin(E11) + 0.0019 * sin(E12) - 0.0044 * sin(E13);
  },
  io: (d, T, o) => {
    const J3 = 283.9 + 4850.7 * T, J4 = 355.8 + 1191.3 * T;
    o[0] = 268.05 - 0.009 * T + 0.094 * sin(J3) + 0.024 * sin(J4); o[1] = 64.5 + 0.003 * T + 0.04 * cos(J3) + 0.011 * cos(J4);
    o[2] = 200.39 + 203.4889538 * d - 0.085 * sin(J3) - 0.022 * sin(J4);
  },
  europa: (d, T, o) => {
    const J4 = 355.8 + 1191.3 * T, J5 = 119.9 + 262.1 * T, J6 = 229.8 + 64.3 * T, J7 = 352.25 + 2382.6 * T;
    o[0] = 268.08 - 0.009 * T + 1.086 * sin(J4) + 0.06 * sin(J5) + 0.015 * sin(J6) + 0.009 * sin(J7);
    o[1] = 64.51 + 0.003 * T + 0.468 * cos(J4) + 0.026 * cos(J5) + 0.007 * cos(J6) + 0.002 * cos(J7);
    o[2] = 36.022 + 101.3747235 * d - 0.98 * sin(J4) - 0.054 * sin(J5) - 0.014 * sin(J6) - 0.008 * sin(J7);
  },
  ganymede: (d, T, o) => {
    const J4 = 355.8 + 1191.3 * T, J5 = 119.9 + 262.1 * T, J6 = 229.8 + 64.3 * T;
    o[0] = 268.2 - 0.009 * T - 0.037 * sin(J4) + 0.431 * sin(J5) + 0.091 * sin(J6); o[1] = 64.57 + 0.003 * T - 0.016 * cos(J4) + 0.186 * cos(J5) + 0.039 * cos(J6);
    o[2] = 44.064 + 50.3176081 * d + 0.033 * sin(J4) - 0.389 * sin(J5) - 0.082 * sin(J6);
  },
  callisto: (d, T, o) => {
    const J5 = 119.9 + 262.1 * T, J6 = 229.8 + 64.3 * T, J8 = 113.35 + 6070.0 * T;
    o[0] = 268.72 - 0.009 * T - 0.068 * sin(J5) + 0.59 * sin(J6) + 0.01 * sin(J8); o[1] = 64.83 + 0.003 * T - 0.029 * cos(J5) + 0.254 * cos(J6) - 0.004 * cos(J8);
    o[2] = 259.51 + 21.5710715 * d + 0.061 * sin(J5) - 0.533 * sin(J6) - 0.009 * sin(J8);
  },
  titan: (d, T, o) => { o[0] = 39.4827; o[1] = 83.4279; o[2] = 186.5855 + 22.5769768 * d; },
  triton: (d, T, o) => {
    const N = 354.867 + 52.316 * T;
    o[0] = 299.36 - 32.35 * sin(N) - 6.28 * sin(2 * N) - 2.08 * sin(3 * N) - 0.74 * sin(4 * N) - 0.28 * sin(5 * N) - 0.11 * sin(6 * N) - 0.07 * sin(7 * N) - 0.02 * sin(8 * N) - 0.01 * sin(9 * N);
    o[1] = 41.17 + 22.55 * cos(N) + 2.1 * cos(2 * N) + 0.55 * cos(3 * N) + 0.16 * cos(4 * N) + 0.05 * cos(5 * N) + 0.02 * cos(6 * N) + 0.01 * cos(7 * N);
    o[2] = 296.53 - 61.2572637 * d + 22.25 * sin(N) + 6.73 * sin(2 * N) + 2.05 * sin(3 * N) + 0.74 * sin(4 * N) + 0.28 * sin(5 * N) + 0.11 * sin(6 * N) + 0.05 * sin(7 * N) + 0.02 * sin(8 * N) + 0.01 * sin(9 * N);
  },
  pluto: (d, T, o) => { o[0] = 132.993; o[1] = -6.163; o[2] = 302.695 + 56.3625225 * d; },
  charon: (d, T, o) => { o[0] = 132.993; o[1] = -6.163; o[2] = 122.695 + 56.3625225 * d; },
  ceres: (d, T, o) => { o[0] = 291.418; o[1] = 66.764; o[2] = 170.65 + 952.1532 * d; },
  vesta: (d, T, o) => { o[0] = 309.031; o[1] = 42.235; o[2] = 285.39 + 1617.3329428 * d; },
};

const scratch = [0, 0, 0];
// Pole RA/Dec and W in degrees for bodies with an IAU model; returns false for others.
export function poleW(id, jd, out = scratch) {
  const m = MODELS[id];
  if (!m) return false;
  m((jd - 2451545.0), (jd - 2451545.0) / 36525, out);
  return true;
}
export const hasIauModel = (id) => id in MODELS;

// Provider of the position of body `id` relative to its parent (world metres) — injected by index.js,
// used by the synchronous-rotation fallback for moons without an IAU model.
let relProvider = null;
export function setRelativeProvider(fn) { relProvider = fn; }

// Equatorial (ICRF) unit vector -> ecliptic J2000.
const eqToEcl = (x, y, z, o) => { o[0] = x; o[1] = y * cosE + z * sinE; o[2] = -y * sinE + z * cosE; };

const M = new Float64Array(9); // columns: body x, y, z axes in world
const colTmp = new Float64Array(3);
// Fill M (row-major 3x3, columns are body axes) from IAU pole/W.
function matrixFromPole(ra, dec, w) {
  // R = Rz(ra + 90) * Rx(90 - dec) * Rz(W), then equatorial -> ecliptic.
  const a = (ra + 90) * DEG, t = (90 - dec) * DEG, W = w * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(t), st = Math.sin(t), cw = Math.cos(W), sw = Math.sin(W);
  const cols = [
    [ca * cw - sa * ct * sw, sa * cw + ca * ct * sw, st * sw],
    [-ca * sw - sa * ct * cw, -sa * sw + ca * ct * cw, st * cw],
    [sa * st, -ca * st, ct],
  ];
  for (let c = 0; c < 3; c++) {
    eqToEcl(cols[c][0], cols[c][1], cols[c][2], colTmp);
    M[c] = colTmp[0]; M[3 + c] = colTmp[1]; M[6 + c] = colTmp[2];
  }
}

function setQuatFromM(q) {
  const m00 = M[0], m01 = M[1], m02 = M[2], m10 = M[3], m11 = M[4], m12 = M[5], m20 = M[6], m21 = M[7], m22 = M[8];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  q.set(x, y, z, w);
  return q;
}

const pw = [0, 0, 0], r0 = new Float64Array(3), r1 = new Float64Array(3);
// Fill the module matrix M for any body; returns false if the body has no orientation at all.
function fillMatrix(id, jd) {
  if (poleW(id, jd, pw)) { matrixFromPole(pw[0], pw[1], pw[2]); return true; }
  const b = getBody(id);
  if (!b) return false;
  if (b.type === 'moon' && relProvider) {
    // Synchronous rotation: +x points at the parent, +z along the orbital angular momentum.
    relProvider(id, jd, r0); relProvider(id, jd + 0.01, r1);
    const vx = r1[0] - r0[0], vy = r1[1] - r0[1], vz = r1[2] - r0[2];
    let nx = r0[1] * vz - r0[2] * vy, ny = r0[2] * vx - r0[0] * vz, nz = r0[0] * vy - r0[1] * vx;
    const ln = Math.hypot(nx, ny, nz) || 1; nx /= ln; ny /= ln; nz /= ln;
    const lr = Math.hypot(r0[0], r0[1], r0[2]) || 1;
    const xx = -r0[0] / lr, xy = -r0[1] / lr, xz = -r0[2] / lr;
    const yx = ny * xz - nz * xy, yy = nz * xx - nx * xz, yz = nx * xy - ny * xx;
    M[0] = xx; M[3] = xy; M[6] = xz; M[1] = yx; M[4] = yy; M[7] = yz; M[2] = nx; M[5] = ny; M[8] = nz;
    return true;
  }
  // Generic spinner: pole = ecliptic north, linear spin from the catalogued day length.
  const W = b.dayHours ? (jd - 2451545.0) * 24 / b.dayHours * 360 : 0;
  matrixFromPole(270, 90 - 23.4392911, W); // ecliptic pole expressed in ICRF
  return true;
}

export function bodyQuaternion(id, jd, out = new THREE.Quaternion()) {
  if (!fillMatrix(id, jd)) return out.set(0, 0, 0, 1);
  return setQuatFromM(out);
}

// World-frame unit vector of the body's north pole at jd.
export function poleVector(id, jd, out = new Float64Array(3)) {
  if (!fillMatrix(id, jd)) { out[0] = 0; out[1] = 0; out[2] = 1; return out; }
  out[0] = M[2]; out[1] = M[5]; out[2] = M[8];
  return out;
}

// Fixed J2000 orbital reference frame of a parent body: x = ascending node of its equator on the
// ICRF equator, z = north pole. Writes the three axes (world ecliptic components) into out[0..8]
// as rows x, y, z.
export function equatorFrame(id, out = new Float64Array(9)) {
  poleW(id, 2451545.0, pw);
  const a = (pw[0] + 90) * DEG, d = pw[1] * DEG;
  const nodeEq = [Math.cos(a), Math.sin(a), 0];
  const poleEq = [Math.cos(pw[0] * DEG) * Math.cos(d), Math.sin(pw[0] * DEG) * Math.cos(d), Math.sin(d)];
  const yEq = [poleEq[1] * nodeEq[2] - poleEq[2] * nodeEq[1], poleEq[2] * nodeEq[0] - poleEq[0] * nodeEq[2], poleEq[0] * nodeEq[1] - poleEq[1] * nodeEq[0]];
  eqToEcl(nodeEq[0], nodeEq[1], nodeEq[2], colTmp); out[0] = colTmp[0]; out[1] = colTmp[1]; out[2] = colTmp[2];
  eqToEcl(yEq[0], yEq[1], yEq[2], colTmp); out[3] = colTmp[0]; out[4] = colTmp[1]; out[5] = colTmp[2];
  eqToEcl(poleEq[0], poleEq[1], poleEq[2], colTmp); out[6] = colTmp[0]; out[7] = colTmp[1]; out[8] = colTmp[2];
  return out;
}

const sunDir = new Float64Array(3);
// Sub-solar planetocentric latitude / east longitude (degrees) given the body's heliocentric position.
export function subSolarFrom(id, jd, helio) {
  if (!fillMatrix(id, jd)) return { lat: 0, lon: 0 };
  const r = Math.hypot(helio[0], helio[1], helio[2]) || 1;
  sunDir[0] = -helio[0] / r; sunDir[1] = -helio[1] / r; sunDir[2] = -helio[2] / r;
  // body-fixed = M^T * world
  const bx = M[0] * sunDir[0] + M[3] * sunDir[1] + M[6] * sunDir[2];
  const by = M[1] * sunDir[0] + M[4] * sunDir[1] + M[7] * sunDir[2];
  const bz = M[2] * sunDir[0] + M[5] * sunDir[1] + M[8] * sunDir[2];
  return { lat: Math.asin(Math.max(-1, Math.min(1, bz))) / DEG, lon: Math.atan2(by, bx) / DEG };
}
