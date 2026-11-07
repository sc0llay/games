// Seeded, deterministic sampling of procedural stars (resolved star "groups"), HII regions and a fallback globular
// halo from the analytic galaxy model. Self-contained (no imports). The model block is a verbatim copy of model.js.
// ---- BEGIN MODEL ----
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const R0 = 8180;
const Z_SUN = 20.8;

const P = {
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
const ARMS = [
  { id: 'scutum-centaurus', name: 'Scutum–Centaurus', R: 5000, beta: 27, w: 1.0, wOld: 1.0, rIn: 3800 },
  { id: 'sagittarius-carina', name: 'Sagittarius–Carina', R: 6040, beta: 25, w: 0.9, wOld: 0.35, rIn: 3400 },
  { id: 'perseus', name: 'Perseus', R: 8870, beta: 40, w: 1.0, wOld: 1.0, rIn: 5000 },
  { id: 'norma-outer', name: 'Norma–Outer', R: 3900, beta: 18, w: 0.8, wOld: 0.35, rIn: 2800 },
];
const K_PITCH = Math.tan(P.pitch);
const COS_PITCH = Math.cos(P.pitch);
const S_PITCH = Math.sin(P.pitch);
for (const a of ARMS) { a.th0 = Math.PI - a.beta * DEG; a.lnR0 = Math.log(a.R); }

// Orion Spur: a ~3 kpc straight segment at pitch 10° through the Sun, running from Carina (−s) to Cygnus (+s).
const SPUR = { pitch: 10 * DEG, w: 0.55, sigma: 180, laneOff: 260, laneSigma: 80, s0: -1200, s1: 1800 };
SPUR.ts = Math.sin(SPUR.pitch); SPUR.tc = Math.cos(SPUR.pitch);

// Sun-centred (l, b, d) → galaxy frame.
function lbToGalaxy(l, b, d, out = [0, 0, 0]) {
  const lo = l * DEG, la = b * DEG, c = Math.cos(la);
  out[0] = -R0 + d * c * Math.cos(lo); out[1] = d * c * Math.sin(lo); out[2] = Z_SUN + d * Math.sin(la);
  return out;
}
const MCS = [
  { id: 'lmc', name: 'Large Magellanic Cloud', l: 280.47, b: -32.89, d: 50000, pos: null, a: 2600, b2: 1900, rot: 0.35, rho: 0.9 },
  { id: 'smc', name: 'Small Magellanic Cloud', l: 302.8, b: -44.3, d: 62000, pos: null, a: 1500, b2: 900, rot: -0.5, rho: 0.7 },
];
for (const m of MCS) m.pos = lbToGalaxy(m.l, m.b, m.d);

// Nearby dark clouds that shape the naked-eye Milky Way (Great Rift, Coalsack, Ophiuchus, Taurus…).
// l, b (deg), d (pc), 1σ half-widths along longitude / latitude / line of sight (pc), column A_V through the centre.
// Positions from Dame et al. 2001 (CO survey) and Lallement et al. 2019 / Zucker et al. 2020 (3D dust distances).
const CLOUDS = [
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
function noise3(x, y, z, seed = 0) {
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
function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash3(ix, iy, 0, seed), b = hash3(ix + 1, iy, 0, seed), c = hash3(ix, iy + 1, 0, seed), d = hash3(ix + 1, iy + 1, 0, seed);
  const x0 = a + (b - a) * fx, x1 = c + (d - c) * fx;
  return x0 + (x1 - x0) * fy;
}
// 0..1, mean 0.5.
function fbm3(x, y, z, oct, seed = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z, seed + i * 31); n += a; a *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; }
  return s / n;
}
function fbm2(x, y, oct, seed = 0) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x, y, seed + i * 31); n += a; a *= 0.5; const t = x; x = x * 1.62 - y * 1.18 + 7.3; y = t * 1.18 + y * 1.62 + 3.1; }
  return s / n;
}
const ridge = (n) => 1 - Math.abs(2 * n - 1);
function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const sech2 = (x) => { const c = Math.cosh(x); return 1 / (c * c); };

// ---- vertical structure (mirrored in GLSL: volume.js VERT_GLSL) ------------------------------------------
// Scale-height factor for the young/gas/dust layers: thin in the central molecular zone, flaring outside the Sun.
function zfac(R) { return (0.35 + 0.65 * sm((R - 100) / 900)) * (1 + 0.8 * sm((R - 9000) / 9000)); }
// Height of the warped mid-plane (pc).
function warpZ(x, y) {
  const R = Math.sqrt(x * x + y * y) + 1e-3, e = Math.max(R - P.warpR, 0);
  return P.warpA * e * e * (y / R);
}

// ---- arms ----------------------------------------------------------------------------------------------
function armSigma(R) { return P.armSigma0 + P.armSigmaR * R; }
function armEnvelope(R, a) { return sm((R - a.rIn) / 1500) * (1 - sm((R - 12500) / 5000)); }
// Azimuth of arm `a` at radius R.
const armAzimuth = (a, R) => a.th0 + (Math.log(R) - a.lnR0) / K_PITCH;
// Crest position in the galaxy plane for arm index i at radius R.
function armCrest(i, R, out = [0, 0]) {
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
function plane(x, y, o = _pl) {
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
function spheroid(x, y, z, o = _sp) {
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
function cloudDust(x, y, z) {
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
function sample(x, y, z, o = _s) {
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
function density(x, y, z) {
  const s = sample(x, y, z, _s);
  let mc = 0;
  for (const m of MCS) mc += mcDensity(m, x, y, z);
  return { stars: s.stars + mc, dust: s.dust, young: s.young + 0.5 * mc };
}

// Irregular, bar-offset blob for a Magellanic Cloud (relative density; the LMC bar is offset from its disc centre).
function mcDensity(m, x, y, z) {
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
function nearestArmCrest(x, y, z) {
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
const COLORS = {
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
const PHI = { thin: 0.3, thick: 0.25, bulge: 0.25, bar: 0.3, halo: 0.3, nuc: 0.0, young: 0.35 };
const PHI_SPHEROID = 0.26;   // single factor applied to the baked spheroid colour (thick+bulge+bar+halo)
// Visual-extinction ratio per colour channel (A_R : A_G : A_B ≈ 0.75 : 1 : 1.33).
const DUST_RGB = [0.75, 1.0, 1.33];

// Spheroid emission for the 3D texture: rgb = thick+bulge+bar+halo colour-weighted (full light), returns nuclear disc.
function spheroidEmission(x, y, z, out) {
  const s = spheroid(x, y, z, _sp), C = COLORS;
  for (let i = 0; i < 3; i++) out[i] = s.thick * C.thick[i] + s.bulge * C.bulge[i] + s.bar * C.bar[i] + s.halo * C.halo[i];
  return s.nuc;
}

// Spheroid texture parameterisation (cylindrically warped): radial power warp, asinh-compressed z.
const VOL = { RMAX: 20500, ZMAX: 4000, ZA: 3.2, RPOW: 0.7 };
// Plane map: linear in x, y over ±RMAX.
const PLANE = { RMAX: 20500 };
// texture coordinate (0..1) → galaxy-frame position
function volumeToGalaxy(u, v, w, out) {
  let qx = u * 2 - 1, qy = v * 2 - 1;
  const r = Math.sqrt(qx * qx + qy * qy);
  if (r > 1e-6) { const rr = Math.pow(r, 1 / VOL.RPOW) / r; qx *= rr; qy *= rr; }
  out[0] = qx * VOL.RMAX; out[1] = qy * VOL.RMAX;
  out[2] = VOL.ZMAX * Math.sinh((w * 2 - 1) * VOL.ZA) / Math.sinh(VOL.ZA);
  return out;
}
// ---- END MODEL ----

// Planckian locus (Kim et al. 2002) → linear sRGB, normalised to max channel 1.
function tempToRGB(T, out, o) {
  T = Math.min(25000, Math.max(1700, T));
  const x = T < 4000 ? -0.2661239e9 / (T * T * T) - 0.2343589e6 / (T * T) + 0.8776956e3 / T + 0.179910
    : -3.0258469e9 / (T * T * T) + 2.1070379e6 / (T * T) + 0.2226347e3 / T + 0.240390;
  const y = T < 2222 ? -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683
    : T < 4000 ? -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867
      : 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
  const X = x / y, Z = (1 - x - y) / y;
  let r = 3.2406 * X - 1.5372 - 0.4986 * Z, g = -0.9689 * X + 1.8758 + 0.0415 * Z, b = 0.0557 * X - 0.2040 + 1.0570 * Z;
  r = Math.max(r, 0.0); g = Math.max(g, 0.0); b = Math.max(b, 0.0);
  const m = Math.max(r, g, b) || 1;
  out[o] = r / m; out[o + 1] = g / m; out[o + 2] = b / m;
}

const sech = (x) => { const c = Math.cosh(x); return 1 / (c * c); };
const atanh = (x) => 0.5 * Math.log((1 + x) / (1 - x));

// Each component: propose(rng, p) → writes p[0..2], returns proposal density q (per pc³); rho(s) → target density.
const comps = {
  thin: { frac: 0.36, phi: PHI.thin, temp: (r) => 4200 + 2300 * r * r, lam: 'old', lmax: 300,
    propose(r, p) { const h = P.thinR, R = -h * Math.log((1 - r()) * (1 - r())), ph = r() * TAU, z = P.thinZ * atanh(2 * r() - 1);
      p[0] = R * Math.cos(ph); p[1] = R * Math.sin(ph); p[2] = z; return Math.exp(-R / h) / (TAU * h * h) * sech(z / P.thinZ) / (2 * P.thinZ); },
    rho: (s) => s.thin },
  thick: { frac: 0.05, phi: PHI.thick, temp: (r) => 4300 + 1200 * r, lam: 'old', lmax: 200,
    propose(r, p) { const h = P.thickR, R = -h * Math.log((1 - r()) * (1 - r())), ph = r() * TAU, z = P.thickZ * atanh(2 * r() - 1);
      p[0] = R * Math.cos(ph); p[1] = R * Math.sin(ph); p[2] = z; return Math.exp(-R / h) / (TAU * h * h) * sech(z / P.thickZ) / (2 * P.thickZ); },
    rho: (s) => s.thick },
  young: { frac: 0.24, phi: PHI.young, temp: null, lam: 'young', lmax: 0,
    propose(r, p) { const h = P.youngR, R = -h * Math.log((1 - r()) * (1 - r())), ph = r() * TAU, z = P.youngZ * atanh(2 * r() - 1);
      p[0] = R * Math.cos(ph); p[1] = R * Math.sin(ph); p[2] = z; return Math.exp(-R / h) / (TAU * h * h) * sech(z / P.youngZ) / (2 * P.youngZ); },
    rho: (s) => s.young },
  bulge: { frac: 0.14, phi: PHI.bulge, temp: (r) => 3500 + 1000 * r, lam: 'old', lmax: 400,
    propose(r, p) { return barProposal(r, p, 600, 330, 230); },
    rho: (s) => s.bulge },
  bar: { frac: 0.14, phi: PHI.bar, temp: (r) => 3600 + 1000 * r, lam: 'old', lmax: 400,
    propose(r, p) { // uniform along the bar, Laplace across and vertically
      const u = (r() * 2 - 1) * 5200, bv = 900, bz = 260;
      const v = (r() < 0.5 ? -1 : 1) * bv * -Math.log(1 - r()), z = (r() < 0.5 ? -1 : 1) * bz * -Math.log(1 - r());
      const c = Math.cos(Math.PI - P.barAngle), s = Math.sin(Math.PI - P.barAngle);
      p[0] = u * c - v * s; p[1] = u * s + v * c; p[2] = z;
      return (1 / 10400) * Math.exp(-Math.abs(v) / bv) / (2 * bv) * Math.exp(-Math.abs(z) / bz) / (2 * bz); },
    rho: (s) => s.bar },
  halo: { frac: 0.02, phi: PHI.halo, temp: (r) => 4800 + 1400 * r, lam: 'old', lmax: 100,
    propose(r, p) { const a = 0.5, lo = Math.pow(900, -a), hi = Math.pow(45000, -a), rr = Math.pow(r() * (hi - lo) + lo, -1 / a);
      const ct = r() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = r() * TAU;
      p[0] = rr * st * Math.cos(ph); p[1] = rr * st * Math.sin(ph); p[2] = 0.7 * rr * ct;
      const pr = a * Math.pow(rr, -a - 1) / (lo - hi); // pdf of r
      return pr / (4 * Math.PI * rr * rr) / 0.7; },
    rho: (s) => s.halo },
};
// Laplace proposal in the bar frame.
function barProposal(r, p, bu, bv, bz) {
  const u = (r() < 0.5 ? -1 : 1) * bu * -Math.log(1 - r()), v = (r() < 0.5 ? -1 : 1) * bv * -Math.log(1 - r()), z = (r() < 0.5 ? -1 : 1) * bz * -Math.log(1 - r());
  const c = Math.cos(Math.PI - P.barAngle), s = Math.sin(Math.PI - P.barAngle);
  p[0] = u * c - v * s; p[1] = u * s + v * c; p[2] = z;
  return Math.exp(-Math.abs(u) / bu - Math.abs(v) / bv - Math.abs(z) / bz) / (8 * bu * bv * bz);
}
// Magellanic Clouds: isotropic Gaussian proposal.
function mcCompFor(m) {
  return { frac: m.id === 'lmc' ? 0.03 : 0.012, phi: 0.25, mc: m, temp: null, lam: 'young', lmax: 0, young: true,
    propose(r, p) {
      const g = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
      const sx = m.a * 0.9, sy = m.a * 0.9, sz = m.b2 * 0.6;
      const dx = g() * sx, dy = g() * sy, dz = g() * sz;
      p[0] = m.pos[0] + dx; p[1] = m.pos[1] + dy; p[2] = m.pos[2] + dz;
      return Math.exp(-0.5 * (dx * dx / (sx * sx) + dy * dy / (sy * sy) + dz * dz / (sz * sz))) / (Math.pow(TAU, 1.5) * sx * sy * sz); },
    rho: null };
}

function lightWeight(r, comp, rgb, o) {
  // Returns relative luminosity λ; writes the colour.
  if (comp.lam === 'young') {
    const a = Math.pow(1.8, 2.15), b = Math.pow(60, 2.15);
    const m = Math.pow(r() * (b - a) + a, 1 / 2.15);   // light-weighted IMF (dN/dm ∝ m^-2.35, L ∝ m^3.5)
    const T = Math.min(30000, 5800 * Math.pow(m, 0.55));
    tempToRGB(T, rgb, o);
    return m;   // bounded weights (33x range) so no handful of O stars dominates the component
  }
  tempToRGB(comp.temp(r()), rgb, o);
  const al = 0.8, lm = comp.lmax; // power-law luminosity function of giants, p(λ) ∝ λ^-1.8
  return Math.pow(1 - r() * (1 - Math.pow(lm, -al)), -1 / al);
}

// Streams the stars in interleaved rounds so the sky fills in progressively instead of after the whole rejection-sampling
// pass (≈15 s at the high tier). Each round is an independent sample of every population carrying the same fraction of
// its light, so any prefix of rounds is already an unbiased (sparser) galaxy. The first round is small so stars show
// within a second. ROUNDS holds the cumulative fractions.
const ROUNDS = [1 / 32, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1];
function generate(msg, post) {
  const { n, seed, part, parts, nHii, nGlob } = msg;
  const rng = mulberry32(seed * 7919 + part * 104729 + 17);
  if (nHii || nGlob) {
    const out = {}, tr = [];
    if (nHii) { out.hii = hiiRegions(nHii, rng); tr.push(out.hii.buffer); }
    if (nGlob) { out.glob = globulars(nGlob, rng); tr.push(out.glob.buffer); }
    post(out, tr);
  }
  const s = {}; const p = [0, 0, 0];
  const list = [];
  for (const k of ['thin', 'thick', 'young', 'bulge', 'bar', 'halo']) list.push([k, comps[k]]);
  for (const m of MCS) list.push([m.id, mcCompFor(m)]);
  // Pilot per population: Λ = ∫ρ dV = E_q[ρ/q], and the rejection ceiling M = max ρ/q.
  const pops = [];
  for (const [name, c] of list) {
    const count = Math.round(n * c.frac);
    if (!count) continue;
    const dens = c.mc ? (x, y, z) => mcDensity(c.mc, x, y, z) : (x, y, z) => c.rho(sample(x, y, z, s));
    const pilotN = 12000, prng = mulberry32(seed + 99991 + name.length * 31);
    let sum = 0, mx = 0;
    for (let i = 0; i < pilotN; i++) { const q = c.propose(prng, p); const w = q > 0 ? dens(p[0], p[1], p[2]) / q : 0; sum += w; if (w > mx) mx = w; }
    const Lam = sum / pilotN; mx *= c.lam === 'young' ? 2.5 : 1.3;   // the young population is knotty: leave headroom
    if (!(Lam > 0)) continue;
    pops.push({ c, count, dens, Lam, mx });
  }
  const rgb = [0, 0, 0];
  for (let round = 0; round < ROUNDS.length; round++) {
    const f0 = round ? ROUNDS[round - 1] : 0, f1 = ROUNDS[round];
    const pos = [], col = [], lum = [];
    for (const { c, count, dens, Lam, mx } of pops) {
      const want = Math.round(count * f1) - Math.round(count * f0);
      let got = 0, tries = 0, sumLam = 0;
      const lamTmp = [];
      while (got < want && tries < want * 400) {
        tries++;
        const q = c.propose(rng, p); if (!(q > 0)) continue;
        const w = dens(p[0], p[1], p[2]) / q;
        if (rng() * mx > w) continue;
        const lam = lightWeight(rng, c, rgb, 0);
        pos.push(p[0], p[1], p[2]); col.push(rgb[0], rgb[1], rgb[2]);
        lamTmp.push(lam); sumLam += lam; got++;
      }
      // Each particle carries an equal share of this round's slice of the population's light, weighted by λ.
      const share = (c.phi * Lam * (c.mc ? 0.25 : 1)) / parts * (f1 - f0);
      for (let i = 0; i < got; i++) lum.push(share * lamTmp[i] / sumLam);
    }
    const nS = lum.length;
    const posA = new Float32Array(pos), lumA = new Float32Array(lum), colA = new Uint8Array(nS * 4);
    for (let i = 0; i < nS; i++) {
      colA[i * 4] = Math.round(col[i * 3] * 255); colA[i * 4 + 1] = Math.round(col[i * 3 + 1] * 255); colA[i * 4 + 2] = Math.round(col[i * 3 + 2] * 255);
      colA[i * 4 + 3] = (rng() * 255) | 0;
    }
    post({ n: nS, pos: posA, col: colA, lum: lumA, last: round === ROUNDS.length - 1 }, [posA.buffer, lumA.buffer, colA.buffer]);
  }
}

// HII regions drawn from the model's own HII map (so billboards sit on the volume's pink knots), in complexes of 1–4.
// None within 1.2 kpc of the Sun: the catalogue nebulae (M42, Lagoon, …) represent that neighbourhood.
// 6 floats each: x, y, z, size(pc), brightness, seed.
function hiiRegions(count, rng) {
  const out = new Float32Array(count * 6); let n = 0;
  const g = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TAU * rng());
  const size = () => 6 * Math.pow(1 - rng() * (1 - Math.pow(12, -1.4)), -1 / 1.4);   // 6–72 pc, steep power law
  const pl = {};
  const propose = (o) => { const R = -3600 * Math.log((1 - rng()) * (1 - rng())), th = rng() * TAU; o[0] = R * Math.cos(th); o[1] = R * Math.sin(th); return R; };
  const q = [0, 0];
  let mx = 0;
  for (let i = 0; i < 20000; i++) { propose(q); const h = plane(q[0], q[1], pl).hii; if (h > mx) mx = h; }
  mx *= 0.6;   // brightest knots saturate acceptance: more regions in the strongest complexes
  let tries = 0;
  while (n < count && tries++ < count * 3000) {
    const R = propose(q);
    if (R > 17000) continue;
    const h = plane(q[0], q[1], pl).hii;
    if (rng() * mx > h) continue;
    if (Math.hypot(q[0] + R0, q[1]) < 1200) continue;
    const f = zfac(R), zw = warpZ(q[0], q[1]);
    const members = 1 + ((rng() * rng() * 4) | 0);
    for (let m = 0; m < members && n < count; m++) {
      const sz = size(), o = n * 6;
      out[o] = q[0] + 45 * g(); out[o + 1] = q[1] + 45 * g(); out[o + 2] = zw + P.hiiZ * f * 0.6 * g(); out[o + 3] = sz;
      out[o + 4] = Math.min(1, 0.25 + 0.75 * Math.min(1, h / mx) * rng());
      out[o + 5] = rng(); n++;
    }
  }
  return out.subarray(0, n * 6).slice();
}

// Procedural globular-cluster halo (fallback when data/globulars.json is missing): x, y, z, rh(pc), mag, seed.
function globulars(count, rng) {
  const out = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const a = 0.5, lo = Math.pow(1200, -a), hi = Math.pow(40000, -a), r = Math.pow(rng() * (hi - lo) + lo, -1 / a);
    const ct = rng() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = rng() * TAU, o = i * 6;
    out[o] = r * st * Math.cos(ph); out[o + 1] = r * st * Math.sin(ph); out[o + 2] = r * ct * 0.9;
    out[o + 3] = 3 + 7 * rng(); out[o + 4] = 7 + 6 * rng(); out[o + 5] = rng();
  }
  return out;
}

self.onmessage = (ev) => {
  generate(ev.data, (out, tr) => self.postMessage({ id: ev.data.id, ...out }, tr));
};
