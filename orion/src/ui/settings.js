import { el, icon, iconButton } from 'orion/ui/dom.js';

const KEY = 'orion.ui';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} };

export function seg(name, options, get, set) {
  const wrap = el('div', { class: 'os-seg', role: 'radiogroup', 'aria-label': name });
  const btns = options.map(([v, label]) => el('button', { type: 'button', class: 'os-btn', role: 'radio', 'aria-checked': 'false', onclick: () => { set(v); sync(); } }, label));
  const sync = () => options.forEach(([v], i) => btns[i].setAttribute('aria-checked', String(get() === v)));
  wrap.append(...btns); sync();
  return { node: wrap, sync };
}
export function toggle(label, get, set) {
  const id = `os-sw-${label.replace(/\W+/g, '').toLowerCase()}`;
  const sw = el('button', { type: 'button', class: 'os-sw', role: 'switch', id, 'aria-checked': String(!!get()) });
  const sync = () => sw.setAttribute('aria-checked', String(!!get()));
  sw.addEventListener('click', () => { set(!get()); sync(); });
  return { row: el('div', { class: 'os-set' }, el('label', { for: id }, label), sw), sync };
}

export function initSettings(ctx) {
  const { app } = ctx, S = app.settings, X = app.graph.exposure, Q = app.quality;
  const saved = load();
  const persist = () => save({ kp: S.kp, labelScale: S.labelScale, highContrast: S.highContrast, orbits: S.orbits, constellations: S.constellations, labels: S.labels,
    rm: ctx.state.rmUser, expMode: X.mode, manualEV: X.manualEV, tonemap: X.tonemap, lowPower: Q.lowPower });
  const emit = (key, value) => { persist(); app.events.dispatchEvent(new CustomEvent('settings', { detail: { key, value } })); };

  const applyHC = () => ctx.root.classList.toggle('os-hc', !!S.highContrast);
  const applyScale = () => ctx.root.style.setProperty('--os-s', String(S.labelScale));
  const applyRM = (v) => { S.reducedMotion = v; app.camera.reducedMotion = v; ctx.root.classList.toggle('os-rm', v); };
  // Restore saved values.
  if (saved.labelScale) S.labelScale = Math.min(2, Math.max(1, saved.labelScale));
  if (Number.isFinite(saved.kp)) S.kp = Math.min(9, Math.max(0, saved.kp));
  for (const k of ['highContrast', 'orbits', 'constellations', 'labels']) if (typeof saved[k] === 'boolean') S[k] = saved[k];
  if (typeof saved.rm === 'boolean') { ctx.state.rmUser = saved.rm; applyRM(saved.rm); } else applyRM(S.reducedMotion);
  if (['auto', 'eye', 'manual'].includes(saved.expMode)) X.mode = saved.expMode;
  if (Number.isFinite(saved.manualEV)) X.manualEV = saved.manualEV;
  if (['agx', 'neutral'].includes(saved.tonemap)) X.tonemap = saved.tonemap;
  if (typeof saved.lowPower === 'boolean') Q.lowPower = saved.lowPower;
  applyHC(); applyScale();

  const syncs = [];
  const add = (c) => { syncs.push(c.sync); return c.row || c.node; };
  const tier = seg('Quality tier', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], () => Q.tier, (v) => { Q.setTier(v); emit('tier', v); });
  const tierNote = el('small', { class: 'os-dim' }, Q.auto ? 'Auto: lowers itself if frames run slow.' : 'Set manually.');
  Q.addEventListener('tier', () => { tier.sync(); tierNote.textContent = Q.auto ? 'Auto: lowers itself if frames run slow.' : 'Set manually.'; });
  const expo = seg('Exposure mode', [['auto', 'Auto'], ['eye', 'Eye'], ['manual', 'Manual EV']], () => X.mode, (v) => { X.mode = v; evRow.hidden = v !== 'manual'; emit('exposure', v); });
  const ev = el('input', { type: 'range', min: '-6', max: '16', step: '0.25', value: String(X.manualEV), 'aria-label': 'Manual exposure value', 'aria-valuetext': `EV ${X.manualEV}` });
  const evOut = el('output', { class: 'os-mono' }, `EV ${(+X.manualEV).toFixed(1)}`);
  ev.addEventListener('input', () => { X.manualEV = +ev.value; evOut.textContent = `EV ${(+ev.value).toFixed(1)}`; ev.setAttribute('aria-valuetext', evOut.textContent); emit('manualEV', X.manualEV); });
  const evRow = el('div', { class: 'os-set', hidden: X.mode !== 'manual' }, el('span', { class: 'l' }, 'Exposure'), ev, evOut);
  const tone = seg('Tonemap', [['agx', 'AgX'], ['neutral', 'Neutral']], () => X.tonemap, (v) => { X.tonemap = v; emit('tonemap', v); });
  const lp = toggle('Low power (30 fps)', () => Q.lowPower, (v) => { Q.lowPower = v; emit('lowPower', v); });
  const orb = toggle('Orbits', () => S.orbits, (v) => { S.orbits = v; emit('orbits', v); });
  const lab = toggle('Labels', () => S.labels, (v) => { S.labels = v; emit('labels', v); });
  const con = toggle('Constellations', () => S.constellations, (v) => { S.constellations = v; emit('constellations', v); });
  const ls = el('input', { type: 'range', min: '100', max: '200', step: '5', value: String(Math.round(S.labelScale * 100)), 'aria-label': 'Label size percent' });
  const lsOut = el('output', { class: 'os-mono' }, `${Math.round(S.labelScale * 100)}%`);
  ls.addEventListener('input', () => { S.labelScale = +ls.value / 100; lsOut.textContent = `${ls.value}%`; applyScale(); emit('labelScale', S.labelScale); });
  const hc = toggle('High-contrast labels', () => S.highContrast, (v) => { S.highContrast = v; applyHC(); emit('highContrast', v); });
  const rm = toggle('Reduced motion', () => S.reducedMotion, (v) => { ctx.state.rmUser = v; applyRM(v); emit('reducedMotion', v); });

  // Aurora activity (Kp 0–9): stored in app.settings.kp and pushed to the aurora module whenever it exists.
  if (!Number.isFinite(S.kp)) S.kp = 3;
  const pushKp = () => { try { app.shared.aurora?.setKp?.(S.kp); } catch {} };
  const kpIn = el('input', { type: 'range', id: 'os-kp', min: '0', max: '9', step: '1', value: String(S.kp), 'aria-label': 'Aurora activity, Kp index 0 to 9' });
  const kpOut = el('output', { class: 'os-mono' }, `Kp ${S.kp}`);
  kpIn.addEventListener('input', () => { S.kp = +kpIn.value; kpOut.textContent = `Kp ${S.kp}`; kpIn.setAttribute('aria-valuetext', `Kp ${S.kp}`); pushKp(); emit('kp', S.kp); });
  pushKp(); app.events.addEventListener('ready', pushKp); setTimeout(pushKp, 3000); // the aurora module may install later
  syncs.push(() => { kpIn.value = String(S.kp); kpOut.textContent = `Kp ${S.kp}`; });

  const close = iconButton('close', 'Close settings', () => ctx.dialogs.close());
  const root = el('section', { class: 'os-dialog os-glass', role: 'dialog', 'aria-label': 'Settings', hidden: true },
    el('h2', null, el('span', { class: 'os-grow' }, 'Settings'), close),
    el('h3', null, 'Rendering'),
    el('div', { class: 'os-set' }, el('span', { class: 'l' }, 'Quality'), add(tier)), tierNote,
    el('div', { class: 'os-set' }, el('span', { class: 'l' }, 'Exposure'), add(expo)), evRow,
    el('div', { class: 'os-set' }, el('span', { class: 'l' }, 'Tonemap'), add(tone)),
    add(lp),
    el('h3', null, 'Scene'), add(orb), add(lab), add(con),
    el('div', { class: 'os-set' }, el('label', { for: 'os-kp' }, 'Aurora activity'), kpIn, kpOut),
    el('h3', null, 'Accessibility'),
    el('div', { class: 'os-set' }, el('label', { for: 'os-ls' }, 'Label size'), (ls.id = 'os-ls', ls), lsOut),
    add(hc), add(rm));
  return { root, sync() { syncs.forEach((s) => s()); evRow.hidden = X.mode !== 'manual'; } };
}

// ---- attributions + about ------------------------------------------------------------------
const FILES_FALLBACK = ['ephemeris.json', 'stars.json', 'galaxy.json', 'bodies.json', 'small.json', 'ui.json'];
const THREE = { what: 'three.js r170', source: 'mrdoob/three.js', licence: 'MIT', url: 'https://threejs.org' };
const KEYS = [
  ['/ or ⌘K', 'Search'], ['Esc / ⌫', 'Back up a level'], ['Space', 'Pause / play'], ['[  ]', 'Slower / faster'], ['N', 'Jump to now'],
  ['F', 'Fly mode (WASD, R/C, Shift)'], ['Arrows', 'Rotate'], ['+ −', 'Zoom'], ['Q E', 'Roll'], ['Tab / Enter', 'Cycle labels / go'],
  ['T', 'Tours'], ['M', 'Measure'], ['P', 'Photo mode'], ['H', 'Hide interface'],
];
export function initAbout(ctx) {
  const { app } = ctx;
  const list = el('ul', { class: 'os-attr', 'aria-live': 'polite' }, el('li', null, 'Loading…'));
  let loaded = false;
  async function load() {
    if (loaded) return; loaded = true;
    let files = null;
    try { files = await app.assets.json('data/attributions/index.json'); } catch {}
    if (!Array.isArray(files)) files = FILES_FALLBACK;
    const rows = [];
    for (const f of files) {
      try { const j = await app.assets.json(`data/attributions/${f}`); if (Array.isArray(j)) rows.push(...j); } catch {}
    }
    if (!rows.some((r) => /three\.js/i.test(r.what))) rows.push(THREE);
    list.textContent = '';
    for (const r of rows) {
      const li = el('li', null, el('b', null, r.what), el('small', null, `${r.source || ''}${r.licence ? ` · ${r.licence}` : ''}`));
      if (/^https?:\/\//.test(r.url || '')) li.append(el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.url.replace(/^https?:\/\//, '')));
      list.append(li);
    }
  }
  const close = iconButton('close', 'Close', () => ctx.dialogs.close());
  const keys = el('dl', { class: 'os-keys' }); for (const [k, v] of KEYS) keys.append(el('dt', null, k), el('dd', null, v));
  const root = el('section', { class: 'os-dialog os-glass', role: 'dialog', 'aria-label': 'About and attributions', hidden: true },
    el('h2', null, el('span', { class: 'os-grow' }, 'Orion Spur'), close),
    el('p', { class: 'os-dim', style: 'margin:0 0 4px' }, 'The Milky Way and the Solar System, simulated live. Planet positions use approximate analytic ephemerides; the galaxy exterior is a reconstruction, not a photograph.'),
    el('h3', null, 'Keyboard'), keys,
    el('h3', null, 'Attributions'), list);
  return { root, onOpen: load };
}
