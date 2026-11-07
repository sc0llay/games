import * as THREE from 'three';
import { PC, DEG, smoothstep } from 'orion/core/units.js';
import { radecToWorld, galToWorld, galaxyToWorldMatrix, GAL_TO_ECL } from 'orion/core/frames.js';
import { density, sample, ARMS, MCS, SPUR, R0, Z_SUN, nearestArmCrest, armAzimuth, DUST_RGB } from 'orion/galaxy/model.js';
import { GalaxyVolume } from 'orion/galaxy/volume.js';
import { GalaxyObjects } from 'orion/galaxy/particles.js';
import { SkyCube } from 'orion/galaxy/skycube.js';
import { Nebulae } from 'orion/galaxy/nebulae.js';

// Galaxy module (spec §07, §11): analytic Milky Way model, raymarched volume, procedural stars, HII regions,
// globular clusters, sky cubemap for views from inside, registry entries and the opening view above the NGP.

const LY_PER_PC = 3.261563777;

export async function install(app) {
  const vol = new GalaxyVolume(app);
  const objs = new GalaxyObjects(app, vol);
  const shared = (app.shared.galaxy = { density, volume: vol, objects: objs, ready: null,
    // live tuning handles (see also volume.tune and objects.shared uniforms)
    tune: { outsideStarFrac: 0.3, outsideMaxHalf: 12, adapt: true, adaptPow: 1.0, nebulaGain: 1 } });
  const adaptation = makeAdaptation(shared);
  shared.adaptation = adaptation;
  Object.defineProperty(shared, 'cube', { get: () => cube, enumerable: false });

  // ---- data ----------------------------------------------------------------------------------------------------
  const [deep0, glob] = await Promise.all([app.assets.json('data/deepsky.json').catch(() => null), app.assets.json('data/globulars.json').catch(() => null)]);
  // Place objects whose member stars come from the star catalogue at those stars' distances, so label, sprite, nebula
  // and stars coincide (the Pleiades' bright members sit at Hipparcos parallaxes, centroid 119 pc; deepsky.json: 136 pc).
  const deep = deep0 && deep0.map((d) => (DIST_OVERRIDE[d.id] ? { ...d, catalogueDistPc: d.distPc, distPc: DIST_OVERRIDE[d.id] } : d));
  registerEntries(app, deep || [], glob || []);

  // ---- rendering objects ---------------------------------------------------------------------------------------
  const live = objs.layer('live');
  // Procedural nebulae (drawn live in every view; their catalogue sprites are suppressed).
  const ECL_TO_GAL_ = [GAL_TO_ECL[0], GAL_TO_ECL[3], GAL_TO_ECL[6], GAL_TO_ECL[1], GAL_TO_ECL[4], GAL_TO_ECL[7], GAL_TO_ECL[2], GAL_TO_ECL[5], GAL_TO_ECL[8]];
  const nebulae = new Nebulae(objs.shared, deep || [], (d) => radecToWorld(d.ra, d.dec, d.distPc * PC), (w) => {
    const x = w[0] / PC, y = w[1] / PC, z = w[2] / PC, m = ECL_TO_GAL_;
    return [-R0 + m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, Z_SUN + m[6] * x + m[7] * y + m[8] * z];
  });
  shared.nebulae = nebulae;
  const catalogue = buildCatalogue(deep || [], glob || [], nebulae.ids);
  objs.setCatalogue(catalogue);
  app.layers.sky.add(live.group, live.world, nebulae.mesh);
  let cube = null;
  const cam = { g: new Float64Array(3) };
  const state = { wv: 1, cubeW: 0, started: false, gainOut: 1, wantCube: false };

  function build(settings) {
    vol.bake(settings);
    shared.ready = Promise.all([vol.done, objs.generate(settings, !!glob?.length)]);
    cube = new SkyCube(app, vol, objs, settings.skyFace);
  }
  const first = app.quality.settings;
  build(first);
  let booted = false; shared.ready.then(() => { booted = true; });
  // Tier changes (dynamic quality) never tear anything down: the new bake / stars / cube are built beside the live ones and
  // swapped in once complete, and only after the camera has rested ~1 s (a rebuild mid-zoom blanked stars + cube for seconds).
  let currentSettings = first, pending = null, building = false, nextCube = null, stillT = 0;
  const prev = { pos: new Float64Array(3), q: [0, 0, 0, 1] };
  app.quality.addEventListener('tier', () => { pending = app.quality.settings; });
  const same = (x, y) => `${x}` === `${y}`;
  function dropCube(c) { c.dispose(); objs.layers = objs.layers.filter((l) => l !== c.layer); }
  function rebuild(s) {
    const o = currentSettings;
    building = true;
    const jobs = [];
    if (!same(s.volumeTex, o.volumeTex)) { vol.bake(s); jobs.push(vol.done); }
    if (s.proceduralStars !== o.proceduralStars) jobs.push(objs.generate(s, !!glob?.length, true));
    Promise.all(jobs).then(() => {
      currentSettings = s; if (pending === s) pending = null;
      if (s.skyFace !== o.skyFace) {
        // a displayed cube is replaced by a fully captured one; an unused cube (camera far from the Sun) is just re-created
        if (cube.ready && state.wantCube) nextCube = new SkyCube(app, vol, objs, s.skyFace);
        else { dropCube(cube); cube = new SkyCube(app, vol, objs, s.skyFace); }
      }
      building = false;
    });
  }

  // ---- per frame -----------------------------------------------------------------------------------------------
  app.onFrame((frame) => {
    vol.setCamera(frame, cam);
    const L = frame.levels;
    // Camera rest detector for the deferred tier rebuild.
    const q = frame.camQuat, dq = Math.abs(q.x * prev.q[0] + q.y * prev.q[1] + q.z * prev.q[2] + q.w * prev.q[3]);
    const dp = Math.hypot(frame.camPos[0] - prev.pos[0], frame.camPos[1] - prev.pos[1], frame.camPos[2] - prev.pos[2]);
    stillT = app.camera.transition || dp > 1e-5 * Math.max(app.camera.dist, 1) || dq < 1 - 1e-9 ? 0 : stillT + frame.realDt;
    prev.pos.set(frame.camPos); prev.q[0] = q.x; prev.q[1] = q.y; prev.q[2] = q.z; prev.q[3] = q.w;
    if (pending && !building && stillT > 1 && vol.full && booted) rebuild(pending);
    if (nextCube?.ready) { nextCube.readyAt = -1e9; dropCube(cube); cube = nextCube; nextCube = null; }   // ramp = 1: no re-fade
    const p = vol.params(cam.g);
    const dSunPc = frame.dSun / PC;
    // The local hole only stands in for the catalogue stars as seen from near the Sun; from L1 distances it would show as
    // a dark disc around the Sun's position, so it closes by ~2 kpc out.
    vol.shared.uHole.value = 0.85 * (1 - smoothstep(600, 2000, dSunPc));
    vol.shared.uSunG.value.set(-R0, 0, Z_SUN);
    // Local adaptation: inside the bulge the whole sky is tens of times brighter than at the Sun. A coarse CPU estimate of
    // the mean sky radiance (re-evaluated when the camera has moved) scales the galaxy light like an eye adapting.
    const adapt = adaptation.update(cam.g, frame.realDt);
    const outGain = 1 + (vol.tune.outsideGain - 1) * p.outside;
    const gainOut = outGain * adapt;
    state.gainOut = gainOut;
    // Fewer, smaller resolved stars from outside the disc (their light returns to the smooth volume).
    vol.shared.uFrac.value = 1 - (1 - shared.tune.outsideStarFrac) * p.outside;
    objs.shared.uMaxHalf.value = 96 - (96 - shared.tune.outsideMaxHalf) * p.outside;
    // Same edge-on lane contrast the volume march applies (uLane): resolved stars and nebula billboards sit behind the same
    // dust, so without this the lane is dark in the smooth light but stars shine straight through it from outside the disc.
    const lane = 1 + vol.tune.lane * p.outside;
    objs.shared.uDust.value.set(DUST_RGB[0] * lane, DUST_RGB[1] * lane, DUST_RGB[2] * lane);
    vol.shared.uCloudOn.value = 1 - smoothstep(1500, 3000, dSunPc);

    // Start / refresh the inside-view cubemap whenever the camera is (or is about to be) near the Sun.
    const wantCube = (state.wantCube = dSunPc < 600 && vol.ready && vol.full);
    if (wantCube && !cube.capturing && cube.needsCapture(cam.g, nearestArmCrest(cam.g[0], cam.g[1], cam.g[2]))) cube.start(frame, cam.g, gainOut);
    const cubeW = cube.ready ? (1 - Math.max(L[0], L[1])) * cube.ramp(frame.time) : 0;
    state.cubeW = cubeW; state.wv = 1 - cubeW;

    live.placeLive(frame);
    live.setProjection(frame.fovY, frame.viewport.w, frame.viewport.h);
    live.u.uCamG.value.set(cam.g[0], cam.g[1], cam.g[2]);
    live.u.uVis.value = 1 - cubeW; live.u.uGainOut.value = outGain * Math.sqrt(adapt);   // point sources stay visible against a bright sky
    live.fillCatalogue(frame.camPos, null);
    live.world.visible = true;
    cube.setDisplay(frame, cubeW);
    nebulae.update(frame, cam.g, outGain * Math.sqrt(adapt) * shared.tune.nebulaGain);
  }, 0);

  app.graph.prePasses.push((renderer, frame) => {
    if (vol.ready && state.wv > 0.002) {
      vol.render(renderer, frame, cam, state.gainOut, frame.tierSettings.volumeSteps);
    }
    if (cube.capturing) cube.step(renderer, frame);
    else if (nextCube) {   // the replacement cube captures only while the live one is idle
      if (!nextCube.capturing && !nextCube.ready) nextCube.start(frame, cam.g, state.gainOut);
      nextCube.step(renderer, frame);
    }
  });
  app.graph.postSky.push((renderer, frame, skyRT) => {
    if (vol.ready && state.wv > 0.002) vol.composite(renderer, skyRT, state.wv);
  });

  setupOpeningView(app);
}

// -------------------------------------------------------------------------------------------------------------------
// Mean sky radiance at a galaxy-frame point: 14 directions, log-spaced steps out to 30 kpc, dust included.
function skyRadiance(g) {
  const s = {}; let sum = 0;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) dirs.push([a / Math.sqrt(3), b / Math.sqrt(3), c / Math.sqrt(3)]);
  for (const d of dirs) {
    let t = 0, tau = 0, L = 0;
    for (let k = 0; k < 28; k++) {
      const t1 = 3 * Math.pow(1.42, k + 1), dt = t1 - t, tm = t + 0.5 * dt; t = t1;
      sample(g[0] + d[0] * tm, g[1] + d[1] * tm, g[2] + d[2] * tm, s);
      const em = s.thin + s.thick + s.bulge + s.bar + s.halo + s.nuc + s.young;
      const x = s.dust * dt;
      L += em * Math.exp(-tau) * dt * (x > 1e-3 ? (1 - Math.exp(-x)) / x : 1);
      tau += x;
    }
    sum += L;
  }
  return sum / dirs.length;
}
// Gain for a sky x times brighter than at the Sun. Climbing 300–1000 pc out of the dusty mid-plane unveils the face-on
// disc (x ≈ 9), and full 1/x adaptation there read as a dark patch between the spur and galaxy views; the bulge (x ≈ 40–90)
// is where adaptation matters. So: gentle (x^-0.3) up to a knee at 12, steep above it, with the slope set so the
// galactic-centre view (x ≈ 59) keeps the gain it had under 1/x.
const ADAPT_KNEE = 12, ADAPT_LO = 0.3, ADAPT_HI = (Math.log(59) - ADAPT_LO * Math.log(ADAPT_KNEE)) / Math.log(59 / ADAPT_KNEE);
function adaptCurve(x) {
  if (x <= 1) return 1;
  const lx = Math.log(x), lk = Math.log(ADAPT_KNEE);
  return Math.exp(-(lx <= lk ? ADAPT_LO * lx : ADAPT_LO * lk + ADAPT_HI * (lx - lk)));
}
function makeAdaptation(shared) {
  const ref = skyRadiance([-R0, 0, Z_SUN]);
  const last = new Float64Array([NaN, NaN, NaN]);
  let value = 1, target = 1;
  const clampV = (v) => Math.min(1, Math.max(0.003, v));
  return {
    get value() { return value; },
    reset() { last.fill(NaN); },
    // The target is re-measured every 0.5 % of the galactocentric radius (0.24 ms) and the applied value eases toward it in log space
    // (tau 0.35 s): a hard step in the gain (0.99 -> 0.44 -> 0.10 -> 0.51 over a 1 kpc -> 250 pc zoom) read as black flashes.
    update(g, dt = 0) {
      if (!shared.tune.adapt) return (target = value = 1);
      const moved = Math.hypot(g[0] - last[0], g[1] - last[1], g[2] - last[2]);
      const r = Math.hypot(g[0], g[1], g[2]);
      const first = last[0] !== last[0];
      if (first || !(moved < 0.005 * Math.max(r, 30))) {
        last.set(g);
        target = clampV(Math.pow(adaptCurve(Math.max(skyRadiance(g), 1e-9) / ref), shared.tune.adaptPow));
        if (first) value = target;
      }
      if (value !== target) {
        const k = 1 - Math.exp(-Math.min(dt, 0.1) / 0.35);
        value = clampV(Math.exp(Math.log(value) + (Math.log(target) - Math.log(value)) * k));
        if (Math.abs(Math.log(target / value)) < 1e-3) value = target;
      }
      return value;
    },
  };
}

// -------------------------------------------------------------------------------------------------------------------
// Opening view: from above the north galactic pole with the Galactic Centre toward the top of the screen.
function setupOpeningView(app) {
  const ngp = new THREE.Vector3(GAL_TO_ECL[2], GAL_TO_ECL[5], GAL_TO_ECL[8]);
  const gc = new THREE.Vector3(GAL_TO_ECL[0], GAL_TO_ECL[3], GAL_TO_ECL[6]);
  const az = Math.atan2(ngp.y, ngp.x), el = Math.asin(ngp.z);
  // camera basis for offset direction = NGP with the ecliptic pole as up hint: z' = ngp, x' = up x z', y' = z' x x'
  const x = new THREE.Vector3(0, 0, 1).cross(ngp).normalize(), y = ngp.clone().cross(x);
  const roll = Math.atan2(-gc.dot(x), gc.dot(y));
  let rolled = false;
  app.camera.addEventListener('focus', (ev) => {
    const c = app.camera, e = ev.detail;
    if (e?.id === 'milky-way') {
      if (c.upMode !== 'ecliptic') return;
      if (c.transition) { c.transition.az1 = az; c.transition.el1 = el; } else { c.az = az; c.el = el; }
      c.roll = roll; rolled = true;
    } else if (rolled) { c.roll = 0; rolled = false; }
  });
}

// -------------------------------------------------------------------------------------------------------------------
function buildCatalogue(deep, glob, skip = new Set()) {
  const items = [], seen = new Set();
  for (const g of glob) {
    seen.add(g.id);
    const worldM = radecToWorld(g.ra, g.dec, g.distPc * PC);
    const mag = g.mag ?? 30;   // a few IR-only clusters (GLIMPSE02) have no optical magnitude
    items.push({ worldM, mag, distPc: g.distPc, radiusPc: g.rhPc * 3, type: 'globular' });
  }
  for (const d of deep) {
    if (d.type === 'globular' && dupGlobular(d, seen)) continue;
    if (skip.has(d.id) && !d.type.includes('cluster')) continue;   // nebulae drawn by Nebulae; clusters keep their sprite
    items.push({ worldM: radecToWorld(d.ra, d.dec, d.distPc * PC), mag: d.mag ?? 12, distPc: d.distPc, radiusPc: Math.max((d.sizePc || 1) / 2, 0.05), type: d.type });
  }
  return items;
}
const keyOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function dupGlobular(d, seen) {
  for (const a of [d.id, d.name, ...(d.aliases || [])]) if (seen.has(keyOf(a))) return true;
  return false;
}

// -------------------------------------------------------------------------------------------------------------------
const DIST_OVERRIDE = { pleiades: 119 };
const VIEW_PC = { pleiades: 20 };
// Default camera directions (galaxy frame, from the object toward the camera), converted to the ecliptic world frame.
function galDir(lDeg, bDeg) {
  const l = lDeg * DEG, b = bDeg * DEG, g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)], m = GAL_TO_ECL;
  return [m[0] * g[0] + m[1] * g[1] + m[2] * g[2], m[3] * g[0] + m[4] * g[1] + m[5] * g[2], m[6] * g[0] + m[7] * g[1] + m[8] * g[2]];
}
function registerEntries(app, deep, glob) {
  const reg = app.registry;
  // galaxy-frame -> world metres with a per-jd cached matrix (positions are queried every frame by labels and search).
  const mat = new Float64Array(16); let matJd = NaN;
  const g2w = (gx, gy, gz, jd, out) => {
    if (!(Math.abs(jd - matJd) < 30)) { galaxyToWorldMatrix(jd, mat); matJd = jd; }
    out[0] = (mat[0] * gx + mat[4] * gy + mat[8] * gz + mat[12]) * PC;
    out[1] = (mat[1] * gx + mat[5] * gy + mat[9] * gz + mat[13]) * PC;
    out[2] = (mat[2] * gx + mat[6] * gy + mat[10] * gz + mat[14]) * PC;
    return out;
  };
  const gal = (id, name, gx, gy, gz, extra) => reg.add({ id, name, position: (jd, out) => g2w(gx, gy, gz, jd, out), ...extra });

  gal('milky-way', 'Milky Way', 0, 0, 0, {
    aliases: ['Galaxy', 'The Galaxy', 'Our Galaxy'], type: 'galaxy', parent: null, level: 0, priority: 100, radius: 0,
    viewDistance: 60e3 * PC, minDistance: 1e3 * PC,
    info: { description: 'A barred spiral galaxy of a few hundred billion stars. The Sun sits about 8.2 kpc from the centre, in a minor arm segment, and circles it once every 220 million years.', kind: 'Barred spiral galaxy', diameterKpc: 30 },
  });
  const sp = SPUR;
  gal('orion-spur', 'Orion Spur', -R0 + 600 * sp.ts, 600 * sp.tc, Z_SUN, {
    aliases: ['Orion Arm', 'Local Arm', 'Orion-Cygnus Arm'], type: 'region', parent: 'milky-way', level: 1, priority: 70, radius: 0,
    viewDistance: 3e3 * PC, minDistance: 30 * PC, viewDir: galDir(215, 40),   // from outside the Sun's orbit, looking in over the spur
    info: { description: 'A minor spiral arm segment about 3 kpc long between the Sagittarius and Perseus arms. The Sun lies near its inner edge.', kind: 'Spiral arm segment', lengthKpc: 3 },
  });
  gal('galactic-centre', 'Galactic Centre', 0, 0, 0, {
    aliases: ['GC', 'Galactic Center'], type: 'marker', parent: 'milky-way', level: 0, priority: 80, radius: 0,
    viewDistance: 600 * PC, minDistance: 0.5 * PC, viewDir: galDir(200, 30),   // ~30° above the plane, bar seen obliquely
    info: { description: 'The dynamical centre of the Milky Way: a dense nuclear star cluster around a four-million-solar-mass black hole, hidden from optical view by dust.', kind: 'Galactic nucleus', distanceLy: 8180 * LY_PER_PC },
  });
  gal('sgr-a-star', 'Sagittarius A*', 0, 0, 0, {
    aliases: ['Sgr A*', 'Sagittarius A Star', 'Milky Way black hole'], type: 'marker', parent: 'galactic-centre', level: 0, priority: 60, radius: 0,
    viewDistance: 3 * PC, minDistance: 0.05 * PC,
    info: { description: 'The supermassive black hole at the Galactic Centre, about 4.3 million solar masses. Stars such as S2 orbit it in under 16 years.', kind: 'Supermassive black hole', distanceLy: 8180 * LY_PER_PC },
  });
  const armInfo = {
    'scutum-centaurus': 'A major arm that begins at the near end of the bar and winds around the whole disk. Seen toward Scutum and Crux-Centaurus.',
    'sagittarius-carina': 'The inner neighbour of the Sun’s arm segment, rich in star-forming regions such as the Lagoon and Carina nebulae.',
    perseus: 'A major arm outside the Sun’s orbit, seen toward Perseus and Cassiopeia, with the double cluster.',
    'norma-outer': 'The Norma arm near the bar, continuing as the Outer arm far out in the disk.',
  };
  for (const a of ARMS) {
    const th = armAzimuth(a, a.R);
    gal(a.id, `${a.name} Arm`, a.R * Math.cos(th), a.R * Math.sin(th), 0, {
      aliases: [a.name, a.id.replace(/-/g, ' ')], type: 'region', parent: 'milky-way', level: 1, priority: 50, radius: 0,
      viewDistance: 6e3 * PC, minDistance: 100 * PC, info: { description: armInfo[a.id], kind: 'Spiral arm', pitchDeg: 12 },
    });
  }
  const mcInfo = {
    lmc: ['A satellite galaxy about 160,000 light-years away, forming stars rapidly in the Tarantula Nebula.', 'Dwarf irregular galaxy'],
    smc: ['A smaller satellite galaxy about 200,000 light-years away, distorted by its tidal interaction with the LMC.', 'Dwarf irregular galaxy'],
  };
  for (const m of MCS) {
    gal(m.id, m.name, m.pos[0], m.pos[1], m.pos[2], {
      aliases: m.id === 'lmc' ? ['LMC'] : ['SMC'], type: 'galaxy', parent: 'milky-way', level: 0, priority: 45, radius: 0,
      viewDistance: m.a * 6 * PC, minDistance: m.a * 0.4 * PC,
      info: { description: mcInfo[m.id][0], kind: mcInfo[m.id][1], distanceLy: m.d * LY_PER_PC, magnitude: m.id === 'lmc' ? 0.9 : 2.7 },
    });
  }

  // Globular clusters (Harris 2010) and deep-sky objects: fixed on the celestial sphere.
  const deepDup = new Map();
  for (const d of deep) if (d.type === 'globular') for (const a of [d.id, d.name, ...(d.aliases || [])]) deepDup.set(keyOf(a), d);
  const seen = new Set();
  for (const g of glob) {
    const dup = deepDup.get(g.id) || [g.name].map((n) => deepDup.get(keyOf(n)))[0];
    const world = radecToWorld(g.ra, g.dec, g.distPc * PC);
    seen.add(g.id);
    reg.add({
      id: g.id, name: dup?.name || g.name, aliases: [...new Set([g.name, ...(dup?.aliases || []), ...(dup ? [dup.name] : [])])].filter((x) => x !== (dup?.name || g.name)),
      type: 'globular', parent: 'milky-way', level: 0, priority: 28, radius: 0,
      position: (jd, out) => { out.set(world); return out; },
      viewDistance: Math.max(g.rhPc * 40, 60) * PC, minDistance: Math.max(g.rhPc, 1) * PC,
      apparentMag: (camPos) => g.mag + 5 * Math.log10(Math.max(Math.hypot(camPos[0] - world[0], camPos[1] - world[1], camPos[2] - world[2]) / PC, 0.01) / g.distPc),
      info: { description: dup?.desc || `Globular cluster, ${Math.round(g.distPc * LY_PER_PC).toLocaleString('en-GB')} light-years away, half-light radius ${g.rhPc.toFixed(1)} pc.`, kind: 'Globular cluster', magnitude: g.mag, distanceLy: g.distPc * LY_PER_PC },
    });
  }
  for (const d of deep) {
    if (d.type === 'globular' && dupGlobular(d, seen)) continue;
    if (reg.has(d.id)) continue;
    const world = radecToWorld(d.ra, d.dec, d.distPc * PC);
    const galaxy = d.type === 'galaxy', size = Math.max(d.sizePc || 1, 0.5);
    reg.add({
      id: d.id, name: d.name, aliases: d.aliases || [], type: ({ planetary: 'nebula', snr: 'nebula' })[d.type] || d.type,
      parent: galaxy ? null : d.type === 'globular' ? 'milky-way' : 'orion-spur', level: galaxy ? 0 : d.distPc > 3000 ? 1 : 2,
      priority: 30, radius: 0, position: (jd, out) => { out.set(world); return out; },
      viewDistance: (VIEW_PC[d.id] ?? Math.max(size * 2.5, 1)) * PC, minDistance: Math.max(size * 0.3, 0.1) * PC,
      apparentMag: (camPos) => (d.mag ?? 12) + 5 * Math.log10(Math.max(Math.hypot(camPos[0] - world[0], camPos[1] - world[1], camPos[2] - world[2]) / PC, 0.01) / d.distPc),
      info: { description: d.desc || '', kind: d.type, magnitude: d.mag, distanceLy: d.distPc * LY_PER_PC, sizeLy: size * LY_PER_PC },
    });
  }
}
