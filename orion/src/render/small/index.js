// render/small: planetary rings, orbit lines, asteroid belt, Trojans, Kuiper belt, Oort shell, comets, minor bodies.
import { getRingProfile } from 'orion/render/small/ringProfile.js';
import { createRings } from 'orion/render/small/rings.js';
import { createOrbits } from 'orion/render/small/orbits.js';
import { createBelts } from 'orion/render/small/belts.js';
import { createComets } from 'orion/render/small/comets.js';
import { createMinor, ASTEROID_DEFS } from 'orion/render/small/minor.js';
import { elementsToPos } from 'orion/render/small/kepler.js';

const AU = 1.495978707e11;

function tryDo(app, name, fn) {
  try { return fn(); } catch (err) { console.error(`[render/small] ${name} failed`, err); (app.moduleErrors ??= []).push({ spec: 'render/small:' + name, err }); return null; }
}

function addRegion(app, { id, name, aliases = [], offsetAU, viewAU, level, desc, kind, priority = 35 }) {
  const dir = offsetAU;
  app.registry.add({
    id, name, aliases, type: 'region', parent: 'solar-system', level, priority, radius: 0,
    viewDistance: viewAU * AU, minDistance: viewAU * AU * 0.02,
    position: (jd, out) => { out[0] = dir[0] * AU; out[1] = dir[1] * AU; out[2] = dir[2] * AU; return out; },
    info: { description: desc, kind },
  });
}

export async function install(app) {
  getRingProfile.getRingProfile = getRingProfile;
  app.shared.ringProfile = getRingProfile;

  const rings = tryDo(app, 'rings', () => createRings(app));
  const orbits = tryDo(app, 'orbits', () => createOrbits(app));
  let belts = null;
  try { belts = await createBelts(app); } catch (err) { console.error('[render/small] belts failed', err); (app.moduleErrors ??= []).push({ spec: 'render/small:belts', err }); }
  const comets = tryDo(app, 'comets', () => createComets(app, orbits));
  const minor = tryDo(app, 'minor', () => createMinor(app));

  // Registry: comets
  if (comets) {
    for (const c of comets.comets) {
      const d = c.def;
      app.registry.add({
        id: d.id, name: d.name, aliases: d.aliases, type: 'comet', parent: 'sun', level: 3, priority: 55, radius: d.radius,
        viewDistance: Math.max(d.radius * 40, 3e7 * d.scale), minDistance: d.radius * 3,
        position: c.positionFn,
        info: { description: d.description, periodDays: d.periodDays, kind: 'Comet' },
      });
    }
  }
  // Registry: named asteroids
  for (const d of ASTEROID_DEFS) {
    app.registry.add({
      id: d.id, name: d.name, aliases: d.aliases, type: 'asteroid', parent: 'sun', level: 3, priority: 50, radius: d.radius,
      viewDistance: d.radius * 12, minDistance: d.radius * 1.5,
      position: (jd, out) => elementsToPos(d.el, jd, out),
      info: { description: d.description, periodDays: 365.25636 * d.el.a ** 1.5, kind: 'Near-Earth asteroid' },
    });
  }
  // Registry: regions (radius 0 so nearest-body and level logic are unaffected)
  addRegion(app, { id: 'asteroid-belt', name: 'Asteroid belt', aliases: ['Main belt', 'Main asteroid belt'], offsetAU: [0, 2.8, 0.05], viewAU: 9, level: 3, kind: 'Region',
    desc: ['Millions of rocky bodies between Mars and Jupiter, mostly 2.1 to 3.3 AU from the Sun.', 'Kirkwood gaps mark orbits in resonance with Jupiter, where asteroids are flung out.', 'All of it together weighs under 1% of the Moon.'] });
  addRegion(app, { id: 'jupiter-trojans', name: 'Jupiter Trojans', aliases: ['Trojans', 'Trojan asteroids'], offsetAU: [0, -5.2, 0], viewAU: 14, level: 3, priority: 30, kind: 'Region',
    desc: ['Swarms of asteroids sharing Jupiter’s orbit, 60 degrees ahead (L4) and behind (L5).', 'Likely over a million bodies larger than 1 km, captured early in the Solar System.', 'NASA’s Lucy mission is visiting several of them.'] });
  addRegion(app, { id: 'kuiper-belt', name: 'Kuiper belt', aliases: ['Edgeworth-Kuiper belt', 'Trans-Neptunian region'], offsetAU: [-40, 0, 0], viewAU: 110, level: 3, kind: 'Region',
    desc: ['A broad disc of icy bodies from Neptune’s orbit (30 AU) out to about 50 AU.', 'Home to Pluto, Haumea and Makemake, and the source of many short-period comets.', 'New Horizons flew through it in 2015 and 2019.'] });
  addRegion(app, { id: 'oort-cloud', name: 'Oort cloud', aliases: ['Oort shell'], offsetAU: [0, 0, 20000], viewAU: 80000, level: 2, priority: 38, kind: 'Region',
    desc: ['A hypothesised spherical shell of icy bodies from roughly 2,000 to 100,000 AU.', 'Believed to be the source of long-period comets such as Hale–Bopp.', 'Never observed directly; its outer edge is about a quarter of the way to Alpha Centauri.'] });

  const parts = [rings, orbits, belts, comets, minor].filter(Boolean);
  app.small = { rings, orbits, belts, comets, minor };
  app.onFrame((frame) => {
    for (const p of parts) {
      try { p.update(frame); } catch (err) { if (!p._warned) { p._warned = true; console.error('[render/small] update failed', err); } }
    }
  }, 20);
}
