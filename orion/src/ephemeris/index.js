// Ephemeris module: positions, orientations and registry entries for the Sun, planets, moons and dwarf
// planets. Public API (also app.shared.ephemeris) is documented in CONTRACT.md §Ephemeris API.
import { AU } from 'orion/core/units.js';
import { BODIES, getBody } from 'orion/ephemeris/bodies.js';
import { keplerPosition, isApproximate } from 'orion/ephemeris/kepler.js';
import { moonGeocentric } from 'orion/ephemeris/moon.js';
import { galileanRelative, GALILEAN } from 'orion/ephemeris/galilean.js';
import { moonRelative, MOON_IDS, dwarfHeliocentric, DWARF_IDS } from 'orion/ephemeris/moons.js';
import { bodyQuaternion, setRelativeProvider, subSolarFrom, poleVector } from 'orion/ephemeris/rotation.js';

export { BODIES, getBody, isApproximate, bodyQuaternion, poleVector };

const EARTH_MOON_MASS_RATIO = 81.30057; // Earth = EMB - Moon_geocentric / (1 + ratio)
const PLANETS = new Set(['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
const GM = { sun: 1.32712440018e20, earth: 3.986004418e14, mars: 4.282837e13, jupiter: 1.26686534e17, saturn: 3.7931207e16, uranus: 5.793951e15, neptune: 6.836529e15, pluto: 8.696e11 };

// Memo: one Float64Array per body, valid for the jd it was computed at.
const cache = new Map();
const tmpA = new Float64Array(3), tmpB = new Float64Array(3);

function slot(id) {
  let c = cache.get(id);
  if (!c) { c = { jd: NaN, v: new Float64Array(3) }; cache.set(id, c); }
  return c;
}

// Internal: cached position array (do not mutate) of body `id` at jd.
function get(id, jd) {
  const c = slot(id);
  if (c.jd === jd) return c.v;
  const v = c.v;
  if (id === 'sun') { v[0] = v[1] = v[2] = 0; }
  else if (PLANETS.has(id)) keplerPosition(id, jd, v);
  else if (id === 'moon-geo') moonGeocentric(jd, v);
  else if (id === 'earth') {
    keplerPosition('emb', jd, v);
    const g = get('moon-geo', jd), k = 1 / (1 + EARTH_MOON_MASS_RATIO);
    v[0] -= g[0] * k; v[1] -= g[1] * k; v[2] -= g[2] * k;
  } else if (id === 'moon') {
    const e = get('earth', jd), g = get('moon-geo', jd);
    v[0] = e[0] + g[0]; v[1] = e[1] + g[1]; v[2] = e[2] + g[2];
  } else if (DWARF_IDS.includes(id)) dwarfHeliocentric(id, jd, v);
  else {
    const b = getBody(id);
    if (!b) { v[0] = v[1] = v[2] = 0; c.jd = jd; return v; }
    const gi = GALILEAN.indexOf(id);
    if (gi >= 0) galileanRelative(gi, jd, tmpA);
    else if (MOON_IDS.includes(id)) moonRelative(id, jd, tmpA);
    else { tmpA[0] = tmpA[1] = tmpA[2] = 0; }
    const p = get(b.parent, jd);
    v[0] = p[0] + tmpA[0]; v[1] = p[1] + tmpA[1]; v[2] = p[2] + tmpA[2];
  }
  c.jd = jd;
  return v;
}

/** Heliocentric ecliptic J2000 position in metres (moons include their planet's position). */
export function heliocentric(id, jd, out = new Float64Array(3)) {
  const v = get(id, jd);
  out[0] = v[0]; out[1] = v[1]; out[2] = v[2];
  return out;
}

setRelativeProvider((id, jd, out) => {
  const b = getBody(id), p = get(b.parent, jd), v = get(id, jd);
  out[0] = v[0] - p[0]; out[1] = v[1] - p[1]; out[2] = v[2] - p[2];
  return out;
});

/** Sub-solar planetocentric latitude and east longitude, degrees. */
export function subSolarPoint(id, jd) {
  return subSolarFrom(id, jd, get(id, jd));
}

/**
 * One orbit of `id` relative to its parent as an n-point closed polyline (Float64Array(n*3), metres),
 * the osculating ellipse at jd rebuilt from the position and velocity (central difference).
 */
export function orbitPath(id, jd, n = 256) {
  const out = new Float64Array(n * 3), b = getBody(id);
  if (!b || !b.parent) return out;
  const parent = b.parent, mu = (GM[parent] ?? GM.sun) + (parent === 'earth' ? 4.9048695e12 : 0);
  const dt = Math.max(Math.abs(b.periodDays) / 4000, 1e-4);
  const rel = (t, o) => { const a = get(id, t), p = get(parent, t); o[0] = a[0] - p[0]; o[1] = a[1] - p[1]; o[2] = a[2] - p[2]; };
  const r = new Float64Array(3), r1 = new Float64Array(3), r2 = new Float64Array(3);
  rel(jd, r); rel(jd - dt, r1); rel(jd + dt, r2);
  const s = 2 * dt * 86400, vx = (r2[0] - r1[0]) / s, vy = (r2[1] - r1[1]) / s, vz = (r2[2] - r1[2]) / s;
  const rn = Math.hypot(r[0], r[1], r[2]), v2 = vx * vx + vy * vy + vz * vz, rv = r[0] * vx + r[1] * vy + r[2] * vz;
  // eccentricity vector, specific angular momentum
  const ex = ((v2 - mu / rn) * r[0] - rv * vx) / mu, ey = ((v2 - mu / rn) * r[1] - rv * vy) / mu, ez = ((v2 - mu / rn) * r[2] - rv * vz) / mu;
  const e = Math.min(Math.hypot(ex, ey, ez), 0.99), a = 1 / (2 / rn - v2 / mu);
  const hx = r[1] * vz - r[2] * vy, hy = r[2] * vx - r[0] * vz, hz = r[0] * vy - r[1] * vx, hn = Math.hypot(hx, hy, hz);
  let px, py, pz;
  if (Math.hypot(ex, ey, ez) > 1e-9) { const en = Math.hypot(ex, ey, ez); px = ex / en; py = ey / en; pz = ez / en; }
  else { px = r[0] / rn; py = r[1] / rn; pz = r[2] / rn; }
  const hux = hx / hn, huy = hy / hn, huz = hz / hn;
  const qx = huy * pz - huz * py, qy = huz * px - hux * pz, qz = hux * py - huy * px;
  const bsemi = a * Math.sqrt(1 - e * e);
  for (let i = 0; i < n; i++) {
    const E = (i / n) * 2 * Math.PI, X = a * (Math.cos(E) - e), Y = bsemi * Math.sin(E);
    out[i * 3] = X * px + Y * qx; out[i * 3 + 1] = X * py + Y * qy; out[i * 3 + 2] = X * pz + Y * qz;
  }
  return out;
}

const ALIASES = { sun: ['Sol'], earth: ['Terra'], moon: ['Luna', 'The Moon'], jupiter: ['Jove'], saturn: ['Kronos'], uranus: ['Ouranos'], neptune: [], pluto: ['134340 Pluto'], ceres: ['1 Ceres'], vesta: ['4 Vesta'], eris: ['Xena'], mars: ['Ares'], venus: ['Aphrodite'], mercury: [], titan: [], io: ['Jupiter I'], europa: ['Jupiter II'], ganymede: ['Jupiter III'], callisto: ['Jupiter IV'] };
const KIND = { sun: 'G2V star', planet: 'Planet', moon: 'Moon', dwarf: 'Dwarf planet' };

export async function install(app) {
  const reg = app.registry;
  reg.add({
    id: 'solar-system', name: 'Solar System', aliases: ['Sol system', 'Sol'], type: 'region', parent: 'orion-spur', level: 3, priority: 70,
    radius: 0, viewDistance: 60 * AU,
    position: (jd, out) => { out[0] = out[1] = out[2] = 0; return out; },
    info: { description: 'The Sun, eight planets, five named dwarf planets and hundreds of moons.\nIt formed 4.6 billion years ago in the Orion Spur of the Milky Way.\nThe heliosphere reaches about 120 AU; the Oort cloud, far beyond.', kind: 'Planetary system' },
  });
  for (const b of BODIES) {
    const isMoon = b.type === 'moon';
    reg.add({
      id: b.id, name: b.name, aliases: ALIASES[b.id] || [], type: b.type, parent: b.type === 'sun' ? 'solar-system' : b.parent,
      level: b.type === 'planet' || isMoon ? 4 : 3,
      priority: b.type === 'sun' ? 90 : b.type === 'planet' ? 80 : b.type === 'dwarf' ? 65 : 60,
      radius: b.radius, solid: true, equatorialRadius: b.equatorialRadius, polarRadius: b.polarRadius, viewDistance: b.equatorialRadius * (b.id === 'saturn' ? 9 : 4),
      position: (jd, out) => {
        const v = get(b.id, jd);
        out[0] = v[0]; out[1] = v[1]; out[2] = v[2];
        return out;
      },
      info: { description: b.description, periodDays: Math.abs(b.periodDays), dayHours: b.dayHours, tilt: b.tilt, kind: KIND[b.type] + (isMoon ? ` of ${getBody(b.parent).name}` : '') },
    });
  }
  app.shared.ephemeris = { BODIES, getBody, heliocentric, bodyQuaternion, orbitPath, subSolarPoint, isApproximate, poleVector };
}
