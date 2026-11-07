// Orion Spur galaxy model (spec §07 / §11). Pure analytic density functions in the galaxy frame:
// parsecs, origin at the Galactic Centre, +X Sun→GC (l = 0), +Y l = 90°, +Z north galactic pole,
// Sun at (−8180, 0, 20.8). No imports: workers receive a verbatim copy of everything between the
// BEGIN/END markers (tests/galaxy.test.js checks the copies stay identical), so volume, particles and
// the sky cubemap always agree.
//
// Structure. The thin components (old thin disc, young stars, HII gas, dust) are SEPARABLE: a mid-plane value
// that depends on (x, y) only — `plane()` — times an analytic vertical profile sech²((z − warp)/h(R)). The
// renderer bakes `plane()` into a high-resolution 2D map and evaluates the vertical profiles analytically, so
// dust lanes and star-forming knots stay sharp both face-on and edge-on. The thick/round components (thick disc,
// boxy bulge, bar, stellar halo, nuclear disc) are `spheroid()`, baked into a coarse 3D texture. Nearby dark
// clouds (`CLOUDS`) are analytic Gaussian ellipsoids evaluated directly.
//
// Units: densities are relative to the thin disk's mid-plane luminosity density at the Sun (= 1).
// Dust is returned directly as an extinction coefficient in 1/pc (visual band).
// ---- BEGIN MODEL ----
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const R0 = 8180;
export const Z_SUN = 20.8;

export const P = {
  thinR: 2400, thinZ: 300, thinArm: 0.9,  // thin disk scale length / height, arm modulation of the old disc
  thickR: 2000, thickZ: 900, thickFrac: 0.12,
  fadeA: 15000, fadeB: 20000,              // stellar disk fade-out radii
  holeR: 3600, holeDepth: 0.85,             // thin disk is depleted inside the bar
  youngR: 3400, youngZ: 110, youngK: 5.5, armBase: 0.08,
  hiiZ: 70, hiiK: 9,
  dustR: 4500, dustZ: 110, dustK: 2.4e-3, dustBase: 0.16,
  pitch: 12 * DEG,
  armSigma0: 220, armSigmaR: 0.0045,       // arm FWHM ≈ 0.6 kpc
  dustOff: 230, dustSigma: 100,             // dust lane sits on the inner (concave) edge
  barAngle: 27 * DEG, barHalf: 5000,
  bulgeRho: 110, barRho: 165, nucRho: 500,
  haloRho: 1.2e-3,
  warpR: 9500, warpA: 1.0e-5,              // outer-disc warp: z_w = A (R − R_w)² sin θ  (up toward l = 90°)
  bubbleR: 110,                            // Local Bubble: dust-poor cavity around the Sun
};

// Four log-spiral arms anchored to Reid et al. 2019 (radius R at galactocentric azimuth β, measured from the
// Sun→GC direction toward increasing longitude, i.e. clockwise seen from the NGP). Pitch 12°.
// w weights the gas / young population; wOld the old stars (two dominant stellar arms, four gaseous ones).
export const ARMS = [
  { id: 'scutum-centaurus', name: 'Scutum–Centaurus', R: 5000, beta: 27, w: 1.0, wOld: 1.0, rIn: 3800 },
  { id: 'sagittarius-carina', name: 'Sagittarius–Carina', R: 6040, beta: 25, w: 0.9, wOld: 0.35, rIn: 3400 },
  { id: 'perseus', name: 'Perseus', R: 8870, beta: 40, w: 1.0, wOld: 1.0, rIn: 5000 },
  { id: 'norma-outer', name: 'Norma–Outer', R: 3900, beta: 18, w: 0.8, wOld: 0.35, rIn: 2800 },
];
export const K_PITCH = Math.tan(P.pitch);
export const COS_PITCH = Math.cos(P.pitch);
const S_PITCH = Math.sin(P.pitch);
for (const a of ARMS) { a.th0 = Math.PI - a.beta * DEG; a.lnR0 = Math.log(a.R); }

// Orion Spur: a ~3 kpc straight segment at pitch 10° through the Sun, running from Carina (−s) to Cygnus (+s).
export const SPUR = { pitch: 10 * DEG, w: 0.55, sigma: 180, laneOff: 260, laneSigma: 80, s0: -1200, s1: 1800 };
SPUR.ts = Math.sin(SPUR.pitch); SPUR.tc = Math.cos(SPUR.pitch);

// Sun-centred (l, b, d) → galaxy frame.
export function lbToGalaxy(l, b, d, out = [0, 0, 0]) {
  const lo = l * DEG, la = b * DEG, c = Math.cos(la);
  out[0] = -R0 + d * c * Math.cos(lo); out[1] = d * c * Math.sin(lo); out[2] = Z_SUN + d * Math.sin(la);
  return out;
}
export const MCS = [
  { id: 'lmc', name: 'Large Magellanic Cloud', l: 280.47, b: -32.89, d: 50000, pos: null, a: 2600, b2: 1900, rot: 0.35, rho: 0.9 },
  { id: 'smc', name: 'Small Magellanic Cloud', l: 302.8, b: -44.3, d: 62000, pos: null, a: 1500, b2: 900, rot: -0.5, rho: 0.7 },
];
for (const m of MCS) m.pos = lbToGalaxy(m.l, m.b, m.d);

// Nearby dark clouds that shape the naked-eye Milky Way (Great Rift, Coalsack, Ophiuchus, Taurus…).
// l, b (deg), d (pc), 1σ half-widths along longitude / latitude / line of sight (pc), column A_V through the centre.
// Positions from Dame et al. 2001 (CO survey) and Lallement et al. 2019 / Zucker et al. 2020 (3D dust distances).
export const CLOUDS = [
  { name: 'Aquila Rift', l: 30, b: 5.5, d: 250, sl: 26, sb: 12, sd: 30, av: 3.6 },
  { name: 'Aquila Rift (south)', l: 18, b: 3, d: 300, sl: 20, sb: 9, sd: 30, av: 2.2 },
  { name: 'Serpens–Ophiuchus', l: 10, b: 8, d: 200, sl: 18, sb: 10, sd: 20, av: 1.6 },
  { name: 'Cygnus Rift', l: 78, b: 1.5, d: 750, sl: 80, sb: 22, sd: 110, av: 2.6 },
  { name: 'Northern Coalsack', l: 62, b: 2.5, d: 520, sl: 30, sb: 13, sd: 45, av: 2.2 },
  { name: 'Vulpecula Rift', l: 45, b: 2, d: 400, sl: 25, sb: 10, sd: 35, av: 1.6 },
  { name: 'Rho Ophiuchi', l: 353, b: 17, d: 140, sl: 6, sb: 5, sd: 6, av: 4.5 },
  { name: 'Pipe Nebula', l: 0.5, b: 5, d: 140, sl: 6, sb: 1.8, sd: 5, av: 3.5 },
  { name: 'Lupus', l: 339, b: 15, d: 155, sl: 8, sb: 5, sd: 7, av: 1.6 },
  { name: 'Coalsack', l: 301, b: -0.8, d: 185, sl: 6, sb: 4.5, sd: 6, av: 2.4 },
  { name: 'Chamaeleon', l: 300, b: -16, d: 185, sl: 4.5, sb: 3.5, sd: 5, av: 2.2 },
  { name: 'Corona Australis', l: 0, b: -18, d: 150, sl: 3.5, sb: 1.5, sd: 3, av: 2.5 },
  { name: 'Taurus', l: 172, b: -15, d: 140, sl: 10, sb: 6, sd: 8, av: 2.0 },
  { name: 'Perseus', l: 159, b: -20, d: 290, sl: 11, sb: 5, sd: 10, av: 1.8 },
  { name: 'Orion A/B', l: 210, b: -18, d: 410, sl: 24, sb: 12, sd: 16, av: 1.6 },
  { name: 'Cepheus Flare', l: 110, b: 15, d: 340, sl: 30, sb: 15, sd: 20, av: 1.0 },
];
for (const c of CLOUDS) {
  c.pos = lbToGalaxy(c.l, c.b, c.d);
  const lo = c.l * DEG, la = c.b * DEG;
  // local basis: e_l (increasing l), e_b (increasing b), e_r (away from the Sun); rows scaled by 1/σ.
  const el = [-Math.sin(lo), Math.cos(lo), 0];
  const eb = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const er = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  c.A = [el[0] / c.sl, el[1] / c.sl, el[2] / c.sl, eb[0] / c.sb, eb[1] / c.sb, eb[2] / c.sb, er[0] / c.sd, er[1] / c.sd, er[2] / c.sd];
  c.k = c.av / 1.086 / (c.sd * Math.sqrt(TAU));   // peak extinction coefficient (1/pc): column τ = k σ_d √(2π)
  c.reach = 3.2 * Math.max(c.sl, c.sb, c.sd);
}

// ---- noise ---------------------------------------------------------------------------------------------
function hash3(ix, iy, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function noise3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iy, iz, seed), b = hash3(ix + 1, iy, iz, seed), c = hash3(ix, iy + 1, iz, seed), d = hash3(ix + 1, iy + 1, iz, seed);
  const e = hash3(ix, iy, iz + 1, seed), f = hash3(ix + 1, iy, iz + 1, seed), g = hash3(ix, iy + 1, iz + 1, seed), h = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x0 = a + (b - a) * fx, x1 = c + (d - c) * fx, x2 = e + (f - e) * fx, x3 = g + (h - g) * fx;
  const y0 = x0 + (x1 - x0) * fy, y1 = x2 + (x3 - x2) * fy;
  return y0 + (y1 - y0) * fz;
}
// 2D value noise, 0..1.
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash3(ix, iy, 0, seed), b = hash3(ix + 1, iy, 0, seed), c = hash3(ix, iy + 1, 0, seed), d = hash3(ix + 1, iy + 1, 0, seed);
  const x0 = a + (b - a) * fx, x1 = c + (d - c) * fx;
  return x0 + (x1 - x0) * fy;
}
// 0..1, mean 0.5.
export function fbm3(x, y, z, oct, seed = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z, seed + i * 31); n += a; a *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; }
  return s / n;
}
export function fbm2(x, y, oct, seed = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x, y, seed + i * 31); n += a; a *= 0.5; const t = x; x = x * 1.62 - y * 1.18 + 7.3; y = t * 1.18 + y * 1.62 + 3.1; }
  return s / n;
}
const ridge = (n) => 1 - Math.abs(2 * n - 1);
export function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const sech2 = (x) => { const c = Math.cosh(x); return 1 / (c * c); };

// ---- vertical structure (mirrored in GLSL: volume.js VERT_GLSL) ------------------------------------------
// Scale-height factor for the young/gas/dust layers: thin in the central molecular zone, flaring outside the Sun.
export function zfac(R) { return (0.35 + 0.65 * sm((R - 100) / 900)) * (1 + 0.8 * sm((R - 9000) / 9000)); }
// Height of the warped mid-plane (pc).
export function warpZ(x, y) {
  const R = Math.sqrt(x * x + y * y) + 1e-3, e = Math.max(R - P.warpR, 0);
  return P.warpA * e * e * (y / R);
}

// ---- arms ----------------------------------------------------------------------------------------------
export function armSigma(R) { return P.armSigma0 + P.armSigmaR * R; }
export function armEnvelope(R, a) { return sm((R - a.rIn) / 1500) * (1 - sm((R - 12500) / 5000)); }
// Azimuth of arm `a` at radius R.
export const armAzimuth = (a, R) => a.th0 + (Math.log(R) - a.lnR0) / K_PITCH;
// Crest position in the galaxy plane for arm index i at radius R.
export function armCrest(i, R, out = [0, 0]) {
  const t = armAzimuth(ARMS[i], R);
  out[0] = R * Math.cos(t); out[1] = R * Math.sin(t); return out;
}

const _pl = { thin: 0, young: 0, hii: 0, dust: 0, arm: 0, lane: 0, spur: 0 };

/**
 * Mid-plane (z = warp) values of the separable thin components at (x, y), allocation-free.
 *  thin – old thin-disc luminosity density; young – blue population; hii – nebular emission; dust – extinction 1/pc;
 *  arm – 0..~1.2 arm weighting; lane – dust-lane weighting; spur – Orion Spur weighting.
 * Density-wave ordering across each arm (inner → outer): dust lane, HII knots, young stars spreading downstream.
 */
export function plane(x, y, o = _pl) {
  const R2 = x * x + y * y, R = Math.sqrt(R2) + 1e-3;
  const th = Math.atan2(y, x), lnR = Math.log(R);
  const fade = R < P.fadeA ? 1 : R > P.fadeB ? 0 : 1 - sm((R - P.fadeA) / (P.fadeB - P.fadeA));
  const hole = 1 - P.holeDepth * Math.exp(-R2 / (P.holeR * P.holeR));
  const sg = armSigma(R);

  let armOld = 0, young = 0, hiiA = 0, lane = 0, feather = 0, armW = 0;
  for (let k = 0; k < 4; k++) {
    const a = ARMS[k];
    const env = armEnvelope(R, a) * a.w;
    if (env < 1e-3) continue;
    let dth = th - (a.th0 + (lnR - a.lnR0) / K_PITCH);
    dth -= TAU * Math.round(dth / TAU);
    const d = R * dth * S_PITCH;                // perpendicular distance to the crest, + = inner (concave) side
    if (d < -4.5 * sg || d > P.dustOff + 2800) continue;
    const s = R * Math.exp(K_PITCH * dth) / S_PITCH + k * 7919;   // along-arm coordinate (pc): arc length to the crest point at this azimuth
    const eo = d / (1.35 * sg);
    const wOld = Math.exp(-0.5 * eo * eo);
    armOld += env * wOld * a.wOld / a.w;
    // young stars: sharp inner edge at the lane, spreading downstream (outer side)
    const sy = d > 0 ? 0.55 * sg : 1.1 * sg, ey = d / sy;
    const yp = Math.exp(-0.5 * ey * ey);
    armW += env * yp;
    if (yp > 2e-3) {
      const c1 = fbm2(s / 900, d / 450, 3, 11 + k);       // star-forming complexes
      const c2 = fbm2(s / 260, d / 200, 2, 13 + k);        // knots inside them
      const kn = sm((c1 - 0.36) / 0.32);
      young += env * yp * (0.1 + 2.0 * kn * (0.25 + 2.0 * c2 * c2));
    }
    // HII regions: sparse bright knots just downstream of the lane
    const dh = (d - 70) / 85, hp = Math.exp(-0.5 * dh * dh);
    if (hp > 2e-3) {
      const h = noise2(s / 150, d / 110, 17 + k), h2 = noise2(s / 700, 0.5 + d / 900, 19 + k);
      const hk = sm((h - 0.52) / 0.3);
      hiiA += env * hp * hk * hk * (0.3 + 1.4 * h2);
    }
    // dust lane: narrow, filamentary, varying width
    const wl = P.dustSigma * (0.75 + 0.6 * noise2(s / 1400, 0.3, 23 + k));
    const dl = (d - P.dustOff) / wl, lp = Math.exp(-0.5 * dl * dl);
    if (lp > 2e-3) {
      const fn = fbm2(s / 420, d / 110, 3, 29 + k);
      lane += env * lp * (0.25 + 1.7 * sm((fn - 0.32) / 0.36));
    }
    // a weaker, broader lane threading the crest itself
    const dc = (d + 40) / 140, cp = Math.exp(-0.5 * dc * dc);
    if (cp > 2e-3) lane += 0.35 * env * cp * sm((fbm2(s / 320, d / 120, 2, 37 + k) - 0.42) / 0.25);
    // feathers / spurs: thin dust filaments leaving the lane at a steep angle across the inner inter-arm region
    if (d > P.dustOff - 60) {
      const u = s + 2.4 * d;
      const fr = ridge(noise2(u / 1100, d / 2600, 31 + k)), f4 = fr * fr * fr * fr;
      const fm = sm((noise2(s / 1600, 0.5, 33 + k) - 0.45) / 0.3);
      feather += env * fm * f4 * f4 * Math.exp(-(d - P.dustOff) / 900) * sm((d - P.dustOff + 60) / 160);
    }
  }
  // Orion Spur
  const rx = x + R0, tpar = rx * SPUR.ts + y * SPUR.tc, tper = rx * SPUR.tc - y * SPUR.ts;
  const sp = sm((tpar - SPUR.s0 + 500) / 500) * (1 - sm((tpar - SPUR.s1) / 500)) * SPUR.w;
  let spur = 0;
  if (sp > 1e-3 && Math.abs(tper) < 1800) {
    const e = tper / SPUR.sigma;
    spur = sp * Math.exp(-0.5 * e * e);
    const c1 = fbm2(tpar / 500, tper / 200, 3, 53);
    young += spur * (0.25 + 1.4 * sm((c1 - 0.38) / 0.3));
    armOld += 0.6 * spur; armW += spur;
    const dl = (tper - SPUR.laneOff) / SPUR.laneSigma;
    // weak and patchy: the dense local clouds (Aquila Rift, Ophiuchus, Lupus, Coalsack …) are modelled explicitly
    lane += 0.3 * sp * Math.exp(-0.5 * dl * dl) * 1.6 * sm((fbm2(tpar / 300, tper / 60, 2, 59) - 0.3) / 0.4);
    const dh = (tper - 20) / 140, h = noise2(tpar / 130, tper / 90, 61);
    const hk = sm((h - 0.5) / 0.3);
    hiiA += sp * Math.exp(-0.5 * dh * dh) * hk * hk;
  }
  if (armOld > 1.2) armOld = 1.2;

  // flocculent structure over the whole disc
  const fl = fbm2(x / 800 + 0.37, y / 800, 4, 41);
  const fr = ridge(fbm2(x / 420, y / 420, 3, 43)), fr2 = fr * fr;

  // ---- bar frame: u along the bar (near end positive, toward the Sun side), v perpendicular.
  const cb = Math.cos(Math.PI - P.barAngle), sb = Math.sin(Math.PI - P.barAngle);
  const u = x * cb + y * sb, v = -x * sb + y * cb, au = Math.abs(u);

  // ---- old thin disc
  const thin = Math.exp(-(R - R0) / P.thinR) * fade * hole * (1 - 0.45 * P.thinArm + 1.2 * P.thinArm * armOld) * (0.85 + 0.3 * fl);   // inter-arm ≈ 0.6, crest ≈ 1.9

  // ---- young population + HII (none inside ~2.5 kpc except the central molecular zone)
  const youngProf = Math.exp(-(R - R0) / P.youngR) * fade * sm((R - 2600) / 1600);
  // central molecular zone: an elongated ring of dense gas, r ≈ 60–250 pc, star-forming (Sgr B2, Sgr C, Arches)
  const rc = Math.sqrt((u / 1.0) * (u / 1.0) + (v / 0.55) * (v / 0.55));
  const cmzN = 0.65 * noise2(x / 45, y / 45, 71) + 0.35 * noise2(x / 18, y / 18, 73);
  const cmz = Math.exp(-0.5 * ((rc - 120) / 40) * ((rc - 120) / 40)) * (0.05 + 1.6 * sm((cmzN - 0.42) / 0.3));
  const youngC = 2.5 * Math.exp(-(rc / 160) * (rc / 160)) + 0.8 * cmz;
  const young2 = P.youngK * (youngProf * (P.armBase * (0.3 + 1.4 * fl) + young) + youngC);
  const hii = P.hiiK * (youngProf * hiiA * (0.6 + 0.8 * fl) + 1.2 * cmz * sm((cmzN - 0.55) / 0.25));

  // ---- dust: arm lanes + feathers + bar lanes + flocculent filaments, central molecular zone, Local Bubble
  const dustRad = Math.exp(-(R - R0) / P.dustR) * (1 - Math.exp(-R2 / (2200 * 2200))) * fade;
  const vl = -(u > 0 ? 1 : -1) * (170 + 0.13 * au);
  const bl = (v - vl) / (110 + 30 * noise2(u / 400, 0.7, 47));
  const barLane = Math.exp(-0.5 * bl * bl) * sm(au / 600) * (1 - sm((au - 3800) / 1400)) * (0.4 + 1.2 * fbm2(u / 250, v / 60, 2, 49));
  const sx = x + R0, sy = y, rb2 = (sx * sx + sy * sy) / (P.bubbleR * P.bubbleR);
  const bubble = 1 - 0.92 * Math.exp(-rb2 * rb2);
  const dust = (P.dustK * (dustRad * (P.dustBase * (0.25 + 1.5 * fl) + 0.2 * fr2 * fr2 + 5.5 * lane + 1.1 * feather)
    + 4.0 * barLane * Math.exp(-R / 3000)) + 0.25 * cmz) * bubble;

  o.thin = thin; o.young = young2; o.hii = hii; o.dust = dust;
  o.arm = Math.min(armW, 1.25); o.lane = lane; o.spur = spur;
  return o;
}

const _sp = { thick: 0, bulge: 0, bar: 0, halo: 0, nuc: 0 };
// Thick / round components (no fine structure): thick disc, boxy-peanut bulge with X-shape, long bar, halo, nuclear disc.
export function spheroid(x, y, z, o = _sp) {
  const R2 = x * x + y * y, R = Math.sqrt(R2) + 1e-3;
  const fade = R < P.fadeA ? 1 : R > P.fadeB ? 0 : 1 - sm((R - P.fadeA) / (P.fadeB - P.fadeA));
  const cb = Math.cos(Math.PI - P.barAngle), sb = Math.sin(Math.PI - P.barAngle);
  const u = x * cb + y * sb, v = -x * sb + y * cb, az = Math.abs(z), au = Math.abs(u);
  o.thick = P.thickFrac * Math.exp(-(R - R0) / P.thickR) * sech2(z / P.thickZ) * fade * (1 - 0.85 * Math.exp(-R2 / (3200 * 3200)));
  // boxy / peanut bulge, semi-axes 1 : 0.4 : 0.3 (× 1800 pc)
  const c = 2.6;
  const rb = Math.pow(Math.pow(au / 1800, c) + Math.pow(Math.abs(v) / 720, c) + Math.pow(az / 540, c), 1 / c);
  let bulge = P.bulgeRho * Math.exp(-Math.pow(rb / 0.22, 0.8)) * (1 - sm((rb - 0.85) / 0.35));
  const xs = Math.exp(-Math.pow((az - 0.42 * au) / 200, 2)) * sm(au / 300) * (1 - sm((au - 1500) / 700));
  o.bulge = bulge * (1 + 0.9 * xs);
  // long bar: half-length 5 kpc, width ≈ 0.4 of the half-length, thin vertically, thicker toward the centre
  const taper = 1 - sm((au / P.barHalf - 0.78) / 0.22);
  const sv = 800 + 140 * Math.exp(-au / 1500);
  const hz = 140 + 210 * Math.exp(-au / 1300);
  o.bar = taper > 0 ? P.barRho * (0.5 + 0.5 * Math.exp(-au / 1600)) * taper * Math.exp(-0.5 * (v / sv) * (v / sv)) * Math.exp(-az / hz) : 0;
  // stellar halo (flattened power law) and the nuclear stellar disk
  const rs = Math.sqrt(R2 + (z / 0.7) * (z / 0.7));
  o.halo = rs < 45000 ? P.haloRho * Math.pow(Math.max(rs, 900) / R0, -3.5) : 0;
  const rn = Math.sqrt(R2 + (z * 2.5) * (z * 2.5));
  o.nuc = P.nucRho * Math.exp(-rn / 230);
  return o;
}

// Extinction (1/pc) of the nearby dark clouds at a galaxy-frame point (smooth Gaussian ellipsoids).
export function cloudDust(x, y, z) {
  let s = 0;
  for (const c of CLOUDS) {
    const dx = x - c.pos[0], dy = y - c.pos[1], dz = z - c.pos[2];
    if (dx * dx + dy * dy + dz * dz > c.reach * c.reach) continue;
    const A = c.A;
    const q0 = A[0] * dx + A[1] * dy + A[2] * dz, q1 = A[3] * dx + A[4] * dy + A[5] * dz, q2 = A[6] * dx + A[7] * dy + A[8] * dz;
    s += c.k * Math.exp(-0.5 * (q0 * q0 + q1 * q1 + q2 * q2));
  }
  return s;
}

const _s = { thin: 0, thick: 0, bulge: 0, bar: 0, halo: 0, nuc: 0, young: 0, hii: 0, dust: 0, arm: 0, lane: 0, spur: 0, stars: 0 };

/**
 * Evaluate every component at a galaxy-frame point (pc). Writes into `o` (allocation-free).
 * Fields (all relative to the Sun's mid-plane thin-disk luminosity density = 1):
 *  thin, thick, bulge, bar, halo, nuc – old populations; young – blue arm population; hii – nebular emission measure;
 *  dust – extinction coefficient 1/pc; arm – 0..~1 arm weighting; stars – total stellar density.
 */
export function sample(x, y, z, o = _s) {
  const pl = plane(x, y, _pl);
  const R = Math.sqrt(x * x + y * y) + 1e-3, f = zfac(R), zr = z - warpZ(x, y);
  const sp = spheroid(x, y, z, _sp);
  o.thin = pl.thin * sech2(zr / P.thinZ);
  o.young = pl.young * sech2(zr / (P.youngZ * f));
  o.hii = pl.hii * sech2(zr / (P.hiiZ * f));
  o.dust = pl.dust * sech2(zr / (P.dustZ * f)) + cloudDust(x, y, z);
  o.thick = sp.thick; o.bulge = sp.bulge; o.bar = sp.bar; o.halo = sp.halo; o.nuc = sp.nuc;
  o.arm = pl.arm; o.lane = pl.lane; o.spur = pl.spur;
  o.stars = o.thin + o.thick + o.bulge + o.bar + o.halo + o.nuc + o.young;
  return o;
}

// Public API: density at a galaxy-frame point, Magellanic Clouds included.
export function density(x, y, z) {
  const s = sample(x, y, z, _s);
  let mc = 0;
  for (const m of MCS) mc += mcDensity(m, x, y, z);
  return { stars: s.stars + mc, dust: s.dust, young: s.young + 0.5 * mc };
}

// Irregular, bar-offset blob for a Magellanic Cloud (relative density; the LMC bar is offset from its disc centre).
export function mcDensity(m, x, y, z) {
  const dx = x - m.pos[0], dy = y - m.pos[1], dz = z - m.pos[2];
  const r2 = dx * dx + dy * dy + dz * dz;
  if (r2 > 25 * m.a * m.a) return 0;
  const c = Math.cos(m.rot), s = Math.sin(m.rot);
  const px = (dx * c + dy * s) / m.a, py = (-dx * s + dy * c) / m.b2, pz = dz / (0.6 * m.b2);
  const disc = Math.exp(-Math.sqrt(px * px + py * py + pz * pz) * 2.2);
  const bx = (px - 0.25) / 0.5, by = py / 0.2, bz = pz / 0.4;
  const bar = 0.8 * Math.exp(-(bx * bx + by * by + bz * bz));
  const lump = fbm3(dx / 500, dy / 500, dz / 500, 3, 77);
  return m.rho * (disc + bar) * (0.55 + 0.9 * lump);
}

// Distance (pc) from a galaxy-frame point to the nearest arm crest (in-plane distance combined with |z|).
export function nearestArmCrest(x, y, z) {
  const R = Math.sqrt(x * x + y * y) + 1e-3, th = Math.atan2(y, x), lnR = Math.log(R);
  let best = 1e9;
  for (let k = 0; k < 4; k++) {
    const a = ARMS[k];
    let dth = th - (a.th0 + (lnR - a.lnR0) / K_PITCH);
    dth -= TAU * Math.round(dth / TAU);
    const d = Math.abs(R * dth * S_PITCH);
    if (d < best) best = d;
  }
  const rx = x + R0, tper = Math.abs(rx * SPUR.tc - y * SPUR.ts);
  if (tper < best) best = tper;
  return Math.sqrt(best * best + z * z);
}

// ---- spectral/emission constants shared by volume + particles --------------------------------------------
// Linear sRGB colour hints per population (normalised so the largest channel is 1).
export const COLORS = {
  thin: [1.0, 0.86, 0.66],
  thick: [1.0, 0.80, 0.56],
  bulge: [1.0, 0.70, 0.38],
  bar: [1.0, 0.72, 0.41],
  halo: [0.96, 0.80, 0.60],
  nuc: [1.0, 0.68, 0.36],
  young: [0.42, 0.60, 1.0],
  hii: [1.0, 0.16, 0.30],
};
// Fraction of each population's light carried by resolved star particles (the rest is the smooth volume).
export const PHI = { thin: 0.3, thick: 0.25, bulge: 0.25, bar: 0.3, halo: 0.3, nuc: 0.0, young: 0.35 };
export const PHI_SPHEROID = 0.26;   // single factor applied to the baked spheroid colour (thick+bulge+bar+halo)
// Visual-extinction ratio per colour channel (A_R : A_G : A_B ≈ 0.75 : 1 : 1.33).
export const DUST_RGB = [0.75, 1.0, 1.33];

// Spheroid emission for the 3D texture: rgb = thick+bulge+bar+halo colour-weighted (full light), returns nuclear disc.
export function spheroidEmission(x, y, z, out) {
  const s = spheroid(x, y, z, _sp), C = COLORS;
  for (let i = 0; i < 3; i++) out[i] = s.thick * C.thick[i] + s.bulge * C.bulge[i] + s.bar * C.bar[i] + s.halo * C.halo[i];
  return s.nuc;
}

// Spheroid texture parameterisation (cylindrically warped): radial power warp, asinh-compressed z.
export const VOL = { RMAX: 20500, ZMAX: 4000, ZA: 3.2, RPOW: 0.7 };
// Plane map: linear in x, y over ±RMAX.
export const PLANE = { RMAX: 20500 };
// texture coordinate (0..1) → galaxy-frame position
export function volumeToGalaxy(u, v, w, out) {
  let qx = u * 2 - 1, qy = v * 2 - 1;
  const r = Math.sqrt(qx * qx + qy * qy);
  if (r > 1e-6) { const rr = Math.pow(r, 1 / VOL.RPOW) / r; qx *= rr; qy *= rr; }
  out[0] = qx * VOL.RMAX; out[1] = qy * VOL.RMAX;
  out[2] = VOL.ZMAX * Math.sinh((w * 2 - 1) * VOL.ZA) / Math.sinh(VOL.ZA);
  return out;
}
// ---- END MODEL ----
