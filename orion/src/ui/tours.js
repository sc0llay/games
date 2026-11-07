import { el, iconButton } from 'orion/ui/dom.js';
import { AU, PC, KPC, DEG } from 'orion/core/units.js';
import { jdFromDate, RATES } from 'orion/core/time.js';
import { GAL_TO_ECL, apply } from 'orion/core/frames.js';
import { dirToAzEl } from 'orion/ui/format.js';

// Tour keyframes (spec §03). Distances in metres, angles in radians (camera az/el of the orbit camera).
//   target: id or [ids…] (first that exists; a step with no existing target is skipped)
//   dist | dr (× radius) · fly (s) · hold (s) · caption · up: 'galactic'|'ecliptic'
//   time: ISO UTC · rate: index into RATES · paused
//   view: { side:'sun'|'night', elev (deg), rot (deg) } | { toward:'<id>' } | { lat, lon, body } | { lookGal:[x,y,z] } | { lookAt:'<id>' }
//   az / el: explicit radians
export const TOURS = [
  {
    id: 'powers-of-ten', title: 'Powers of Ten', blurb: 'From 60 kpc above the galaxy to the night side of Earth.', approx: 90,
    steps: [
      { target: 'milky-way', dist: 60 * KPC, el: 1.45, up: 'galactic', fly: 3, hold: 6, caption: 'Sixty kiloparsecs above the north galactic pole: a barred spiral of a few hundred billion stars.' },
      { target: 'orion-spur', dist: 3 * KPC, el: 0.9, fly: 8, hold: 4, caption: 'The Orion Spur, a minor arm segment about 8 kpc from the centre. Home.' },
      { target: ['pleiades', 'm45'], dist: 20 * PC, el: 0.6, fly: 7, hold: 4, caption: 'The Pleiades, a young open cluster 136 pc away.' },
      { target: 'sirius', dist: 6e12, el: 0.4, fly: 7, hold: 4, caption: 'Sirius, 8.6 light-years away: the brightest star in our sky.' },
      { target: ['heliosphere', 'solar-system'], dist: 300 * AU, el: 0.5, fly: 7, hold: 4, caption: 'Inside the heliosphere, the bubble the solar wind blows around the Sun.' },
      { target: 'saturn', dist: 3.4e8, view: { side: 'sun', elev: 18, rot: 40 }, fly: 8, hold: 6, caption: 'Saturn’s rings, casting their shadow across the cloud tops.' },
      { target: 'earth', dist: 1.7e7, view: { side: 'night', elev: 12 }, fly: 8, hold: 10, caption: 'Earth’s night side: city lights, and the Milky Way band behind the limb.' },
    ],
  },
  {
    id: 'grand-tour', title: 'Grand Tour of the Planets', blurb: 'The Sun and each planet in order, about 70 seconds.', approx: 70,
    steps: [
      { target: 'sun', dr: 3, el: 0.2, fly: 3, hold: 3, caption: 'The Sun holds 99.86% of the Solar System’s mass.' },
      { target: 'mercury', dr: 6, view: { side: 'sun', elev: 15, rot: 30 }, fly: 4, hold: 3, caption: 'Mercury: a year of 88 days, no atmosphere to speak of.' },
      { target: 'venus', dr: 4, view: { side: 'sun', elev: 10, rot: 30 }, fly: 4, hold: 3, caption: 'Venus: a runaway greenhouse, hotter than Mercury.' },
      { target: 'earth', dr: 4, view: { side: 'sun', elev: 15, rot: 30 }, fly: 4, hold: 3, caption: 'Earth: the only world known to host life.' },
      { target: 'mars', dr: 5, view: { side: 'sun', elev: 15, rot: 30 }, fly: 4, hold: 3, caption: 'Mars: iron-rich dust and the tallest volcano known.' },
      { target: 'jupiter', dr: 4, view: { side: 'sun', elev: 8, rot: 30 }, fly: 5, hold: 4, caption: 'Jupiter: more massive than all other planets combined.' },
      { target: 'saturn', dr: 4, view: { side: 'sun', elev: 18, rot: 35 }, fly: 5, hold: 4, caption: 'Saturn: rings of ice a few metres thick and 280,000 km wide.' },
      { target: 'uranus', dr: 5, view: { side: 'sun', elev: 20, rot: 30 }, fly: 5, hold: 3, caption: 'Uranus: tipped on its side, 98 degrees from upright.' },
      { target: 'neptune', dr: 5, view: { side: 'sun', elev: 15, rot: 30 }, fly: 5, hold: 3, caption: 'Neptune: the windiest world, four and a half billion kilometres out.' },
      { target: 'solar-system', dist: 80 * AU, el: 0.9, fly: 7, hold: 4, caption: 'The whole family, seen from above the ecliptic.' },
    ],
  },
  {
    id: 'milky-way-band', title: 'Where the Milky Way band comes from', blurb: 'Why the sky has a glowing stripe: we live inside a disc.', approx: 60,
    steps: [
      { target: 'milky-way', dist: 40 * KPC, el: 1.45, up: 'galactic', fly: 3, hold: 5, caption: 'From outside, the galaxy is a thin disc of stars, gas and dust.' },
      { target: 'milky-way', dist: 40 * KPC, el: 0.03, fly: 6, hold: 5, caption: 'Edge on, it is only about a kiloparsec thick and a hundred times wider.' },
      { target: ['orion-spur', 'solar-system'], dist: 2 * KPC, el: 0.03, fly: 7, hold: 4, caption: 'We sit inside that disc, about 8 kpc from the centre.' },
      { target: 'sun', dist: 1.2e11, view: { lookGal: [1, 0, 0] }, fly: 8, hold: 7, caption: 'Look toward the galactic centre along the disc: billions of stars and dust lanes pile up into the band.' },
      { target: 'sun', dist: 1.2e11, view: { lookGal: [-1, 0, 0] }, fly: 5, hold: 5, caption: 'Look the other way, toward the rim: thinner, but still a band.' },
      { target: 'sun', dist: 1.2e11, view: { lookGal: [0, 0, 1] }, fly: 5, hold: 6, caption: 'Look out of the plane, toward the north galactic pole: far fewer stars, a dark sky.' },
    ],
  },
  {
    id: 'eclipse-2026', title: 'Eclipse of 12 Aug 2026', blurb: 'The Moon’s shadow crosses Greenland, Iceland and Spain.', approx: 40,
    steps: [
      { target: 'earth', time: '2026-08-12T17:45:00Z', rate: 0, paused: false, dist: 1.6e7, view: { lat: 58, lon: -45, body: 'earth' }, fly: 4, hold: 11, caption: '12 August 2026, 17:45 UTC. The Moon’s shadow falls on Greenland, Iceland and the north Atlantic.' },
      { target: 'earth', time: '2026-08-12T18:24:00Z', rate: 1, dist: 1.1e7, view: { lat: 41, lon: -3, body: 'earth' }, fly: 6, hold: 14, caption: 'Over Spain at one minute per second. Totality lasts about a minute and three quarters.' },
      { target: 'earth', time: '2026-08-12T19:15:00Z', rate: 1, dist: 4e7, view: { toward: 'moon' }, fly: 6, hold: 8, caption: 'The shadow leaves Earth at sunset. Press N to return to the present.' },
    ],
  },
];

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function initTours(ctx) {
  const { app } = ctx, T = app.time, C = app.camera;
  let run = null; // { cancelled, wake }
  const tmp = new Float64Array(3), tmp2 = new Float64Array(3);
  const pick = (t) => { for (const id of [].concat(t)) { const e = app.registry.get(id); if (e) return e; } return null; };

  // Orbit-camera az/el for a view spec, or {} to leave az/el as they are.
  function resolveView(step, entry, jd) {
    const v = step.view; const out = {};
    if (Number.isFinite(step.az)) out.az = step.az;
    if (Number.isFinite(step.el)) out.el = step.el;
    if (!v) return out;
    let dir = null;
    entry.position(jd, tmp);
    if (v.side) {
      const l = Math.hypot(tmp[0], tmp[1]) || 1, e = (v.elev || 0) * DEG, s = v.side === 'night' ? 1 : -1;
      let x = (s * tmp[0]) / l, y = (s * tmp[1]) / l; const r = (v.rot || 0) * DEG;
      [x, y] = [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
      dir = [x * Math.cos(e), y * Math.cos(e), Math.sin(e)];
    } else if (v.toward) {
      const o = app.registry.get(v.toward);
      if (o) { o.position(jd, tmp2); dir = unit([tmp2[0] - tmp[0], tmp2[1] - tmp[1], tmp2[2] - tmp[2]]); }
    } else if (v.lat != null) {
      const q = app.shared.ephemeris?.bodyQuaternion?.(v.body || entry.id, jd);
      if (q) {
        const la = v.lat * DEG, lo = v.lon * DEG, p = new app.THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)).applyQuaternion(q);
        dir = [p.x, p.y, p.z];
      }
    } else if (v.lookGal) dir = unit(apply(GAL_TO_ECL, v.lookGal).map((x) => -x));
    else if (v.lookAt) {
      const o = app.registry.get(v.lookAt);
      if (o) { o.position(jd, tmp2); dir = unit([tmp[0] - tmp2[0], tmp[1] - tmp2[1], tmp[2] - tmp2[2]]); }
    }
    if (dir) { const up = C.up; Object.assign(out, dirToAzEl([up.x, up.y, up.z], dir)); }
    return out;
  }

  // ---- caption bar ----
  const capText = el('p', { role: 'status' });
  const bar = el('i');
  const skip = el('button', { type: 'button', class: 'os-btn', onclick: () => stop() }, 'Skip (Esc)');
  const title = el('span');
  const caption = el('div', { class: 'os-caption os-glass', hidden: true }, capText, el('div', { class: 'bar' }, bar), el('div', { class: 't' }, title, skip));

  const sleep = (s, r) => new Promise((res) => { const t = setTimeout(res, s * 1000); r.wake = () => { clearTimeout(t); res(); }; });

  async function start(tour) {
    if (typeof tour === 'string') tour = TOURS.find((t) => t.id === tour);
    if (!tour) return false;
    stop(true);
    const r = run = { cancelled: false, wake: null, tour };
    ctx.measure?.stop(); ctx.photo?.exit(); ctx.dialogs.close();
    const upBefore = C.upMode, timeTouched = tour.steps.some((x) => x.time || Number.isFinite(x.rate) || typeof x.paused === 'boolean');
    r.upBefore = upBefore; r.timeTouched = timeTouched;
    caption.hidden = false; title.textContent = tour.title; capText.textContent = '';
    ctx.state.tour = tour.id; ctx.root.classList.add('os-touring');
    const steps = tour.steps.filter((s) => pick(s.target));
    let n = 0;
    for (const step of steps) {
      if (r.cancelled) break;
      const entry = pick(step.target);
      if (step.time) T.setJd(jdFromDate(new Date(step.time)));
      if (Number.isFinite(step.rate)) { T.direction = 1; T.setRate(step.rate, true); }
      if (typeof step.paused === 'boolean' && T.paused !== step.paused) T.togglePause();
      if (step.up && C.upMode !== step.up) C.setUpMode(step.up);
      const jd = T.jd, dist = step.dist ?? (step.dr ? entry.radius * step.dr : undefined);
      const v = resolveView(step, entry, jd);
      if (v.az !== undefined) v.az = C.az + wrapPi(v.az - C.az);
      capText.textContent = step.caption || ''; bar.style.width = `${(n / steps.length) * 100}%`; n++;
      if (step.caption) ctx.announce(step.caption);
      if (app.settings.reducedMotion) {
        C.focusOn(entry, dist);
        if (v.az !== undefined) C.az = v.az; if (v.el !== undefined) C.el = v.el;
        await sleep(Math.max(step.hold, 3), r);
      } else {
        const fly = C.goTo(entry, { distance: dist, az: v.az, el: v.el, duration: step.fly });
        await Promise.race([fly, sleep((step.fly || 4) + 3, r)]);
        if (r.cancelled) break;
        await sleep(step.hold ?? 3, r);
      }
    }
    if (run === r) finish(r, true);
    return true;
  }
  // Leave the app sane whether the tour ends or is skipped: up-vector back, and a tour that drove the clock stops at real time
  // (running, forward) so the sky is not left racing at 1 h/s; the date it jumped to is kept ("N" returns to the present).
  function settle(r) {
    run = null; caption.hidden = true; ctx.state.tour = null; bar.style.width = '0'; ctx.root.classList.remove('os-touring');
    if (C.upMode !== r.upBefore) C.setUpMode(r.upBefore);
    if (r.timeTouched) {
      T.direction = 1; T.setRate(0, true);
      if (T.paused) T.togglePause();
      if (Math.abs(T.jd - jdFromDate(new Date())) > 1) ctx.toast('Tour left the clock on another date. Press N to return to the present.', { ms: 6000 });
    }
  }
  function finish(r, completed) {
    settle(r);
    if (completed) ctx.toast(`Tour finished: ${r.tour.title}`, { ms: 3000 });
  }
  function stop(silent) {
    if (!run) return;
    const r = run; r.cancelled = true; r.wake?.();
    settle(r);
    if (!silent) ctx.announce('Tour skipped');
  }

  // ---- menu dialog ----
  const menu = el('section', { class: 'os-dialog os-glass', role: 'dialog', 'aria-label': 'Tours', hidden: true },
    el('h2', null, el('span', { class: 'os-grow' }, 'Tours'), iconButton('close', 'Close tours', () => ctx.dialogs.close())),
    ...TOURS.map((t) => el('button', { type: 'button', class: 'os-btn os-tour', onclick: () => { ctx.dialogs.close(); start(t); } }, el('b', null, t.title), el('span', null, `${t.blurb} (about ${t.approx} s)`))),
    el('p', { class: 'os-dim', style: 'font-size:12px;margin:8px 0 0' }, 'Skip any tour at any moment with Esc, a click, or any key.'));

  return { menu, caption, start, stop, TOURS, get active() { return !!run; }, resolveView };
}
