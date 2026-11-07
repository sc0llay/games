// Pure maths for the bodies renderer (no three.js, testable under jsc).

export const AU_KM = 149597870.7;
export const SUN_RADIUS_KM = 695700;
const DEG = Math.PI / 180;

// Solar cycle: minimum between cycles 24 and 25 was December 2019; mean period 11 years.
export const CYCLE_MIN_JD = 2458832;
export const CYCLE_DAYS = 4018;
export function solarCyclePhase(jd) {
  const x = (jd - CYCLE_MIN_JD) / CYCLE_DAYS;
  return x - Math.floor(x);
}
// Relative sunspot activity 0..1 (rises fast, decays slowly — Waldmeier-ish skew).
export function solarActivity(phase) {
  const p = Math.min(1, Math.max(0, phase));
  const rise = 0.38; // maximum ~4 years in
  const x = p < rise ? Math.sin((p / rise) * Math.PI * 0.5) : Math.cos(((p - rise) / (1 - rise)) * Math.PI * 0.5);
  return Math.pow(Math.max(0, x), 1.6);
}
function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const MAX_SPOTS = 24;
// Fills out (Float32Array MAX_SPOTS*4): lat, lon (rad, body-fixed frame), angular radius (rad), strength 0..1.
// Spots live in time slots (one slot per group, 18–40 d lifetimes); latitude follows Spörer's law with the
// cycle phase, longitude drifts with the differential rotation relative to the body-fixed (Carrington) frame.
export function sunspotGroups(jd, out) {
  const phase = solarCyclePhase(jd), act = solarActivity(phase);
  const cycle = Math.floor((jd - CYCLE_MIN_JD) / CYCLE_DAYS);
  const baseLat = 30 - 24 * phase; // degrees at the cycle's centre of activity
  let n = 0;
  for (let i = 0; i < MAX_SPOTS; i++) {
    const life = 18 + hash(i, 7, cycle) * 22;
    const off = hash(i, 11, cycle) * life;
    const k = Math.floor((jd + off) / life);
    const age = (jd + off) / life - k; // 0..1 within the slot
    const prob = Math.min(1, act * 1.15 + 0.03);
    const alive = hash(i, k, cycle + 31) < prob;
    const o = i * 4;
    if (!alive) { out[o + 3] = 0; continue; }
    const north = hash(i, k, 3) < 0.5 ? 1 : -1;
    const lat = north * Math.max(3, baseLat + (hash(i, k, 5) - 0.5) * 12) * DEG;
    const s = Math.sin(lat);
    const omega = 14.713 - 2.396 * s * s - 1.787 * s * s * s * s; // deg/day, sidereal
    const lon0 = hash(i, k, 9) * 2 * Math.PI;
    const dt = age * life;
    const lon = lon0 + (omega - 360 / 25.38) * dt * DEG;
    const size = (0.012 + 0.03 * hash(i, k, 13) * hash(i, k, 17)) * (0.5 + act);
    const grow = Math.min(1, age * 6) * Math.min(1, (1 - age) * 4); // appear and fade smoothly
    out[o] = lat; out[o + 1] = lon; out[o + 2] = size; out[o + 3] = grow;
    n++;
  }
  return n;
}

// Fraction of the Sun's disc (angular radius rs) covered by an occluder disc (ro) at centre separation d (all radians).
export function discOverlap(rs, ro, d) {
  if (d >= rs + ro) return 0;
  if (d <= Math.abs(ro - rs)) return ro >= rs ? 1 : (ro * ro) / (rs * rs);
  const a = rs * rs, b = ro * ro;
  const x = (d * d + a - b) / (2 * d);
  const y = Math.sqrt(Math.max(a - x * x, 0));
  const A = a * Math.acos(Math.min(1, Math.max(-1, x / rs))) + b * Math.acos(Math.min(1, Math.max(-1, (d - x) / ro))) - d * y;
  return A / (Math.PI * a);
}

// Sun-light factor at point p (km, relative to the Sun's centre direction frame) behind a sphere occluder.
// sunPos / occPos are positions relative to p (km). Returns 1 (lit) .. 0 (umbra).
export function sphereEclipse(sunPos, sunR, occPos, occR) {
  const ds = Math.hypot(sunPos[0], sunPos[1], sunPos[2]), dO = Math.hypot(occPos[0], occPos[1], occPos[2]);
  if (dO >= ds) return 1; // occluder is beyond the Sun
  const rs = Math.asin(Math.min(1, sunR / ds)), ro = Math.asin(Math.min(1, occR / dO));
  const c = (sunPos[0] * occPos[0] + sunPos[1] * occPos[1] + sunPos[2] * occPos[2]) / (ds * dO);
  const sep = Math.acos(Math.min(1, Math.max(-1, c)));
  return 1 - discOverlap(rs, ro, sep);
}

// Lambert sphere phase function, alpha = phase angle (rad). 1 at full, 0 at new.
export function lambertPhase(alpha) {
  return (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
}
// Relative flux (Sun at 1 AU = 1) of a planet seen by an observer: geometric albedo p, radius R, observer distance
// delta, Sun distance rSun (all km), phase angle alpha.
export function reflectedFlux(p, R, delta, rSun, alpha) {
  const e = AU_KM / rSun;
  return e * e * p * lambertPhase(alpha) * (R / delta) * (R / delta);
}
export const apparentMagnitude = (flux) => -26.74 - 2.5 * Math.log10(Math.max(flux, 1e-30));
// Display-referred peak for a point of magnitude m, in sky units (mag 0 ≈ 3), capped for the HDR chain.
export const starPeak = (mag) => Math.min(300, 3 * Math.pow(10, -0.4 * mag));

// Choose up to n shadow casters for a body. cands: [{ id, pos (Float64Array world m), radiusKm }].
// bodyPos world metres; sun at origin. Writes occluder centres (km, relative to the body) into out (Float64Array n*4: xyz, radius).
export function pickOccluders(bodyId, bodyPos, bodyRadiusKm, cands, out, n = 4) {
  const sunDist = Math.hypot(bodyPos[0], bodyPos[1], bodyPos[2]);
  if (sunDist === 0) { out.fill(0); return 0; }
  const sx = -bodyPos[0] / sunDist, sy = -bodyPos[1] / sunDist, sz = -bodyPos[2] / sunDist; // body → Sun
  const sunTan = SUN_RADIUS_KM * 1e3 / sunDist;
  const hits = [];
  for (const c of cands) {
    if (c.id === bodyId) continue;
    const cx = c.pos[0] - bodyPos[0], cy = c.pos[1] - bodyPos[1], cz = c.pos[2] - bodyPos[2]; // m
    const along = cx * sx + cy * sy + cz * sz;
    if (along <= 0) continue;
    const px = cx - sx * along, py = cy - sy * along, pz = cz - sz * along;
    const perp = Math.hypot(px, py, pz) / 1e3, alongKm = along / 1e3;
    const reach = c.radiusKm + bodyRadiusKm + alongKm * sunTan + 50;
    if (perp < reach) hits.push({ c, cx, cy, cz, score: perp / reach });
  }
  hits.sort((a, b) => a.score - b.score);
  out.fill(0);
  const m = Math.min(n, hits.length);
  for (let i = 0; i < m; i++) { const h = hits[i]; out[i * 4] = h.cx / 1e3; out[i * 4 + 1] = h.cy / 1e3; out[i * 4 + 2] = h.cz / 1e3; out[i * 4 + 3] = h.c.radiusKm; }
  return m;
}

// Pixel diameter of a sphere of radius R at distance d for a vertical fov (rad) and viewport height (px).
export const pixelDiameter = (R, d, fovY, hPx) => (2 * R / Math.max(d, 1e-9)) / (2 * Math.tan(fovY / 2)) * hPx;
