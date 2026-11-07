import { el, iconButton } from 'orion/ui/dom.js';
import { formatDistance, formatDuration, C } from 'orion/core/units.js';
import { dominantLevel, LEVEL_NAMES, typeLabel, focalToFov, fovToFocal } from 'orion/ui/format.js';

// ---- measure -------------------------------------------------------------------------------
export function initMeasure(ctx) {
  const { app } = ctx;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'os-measure-svg'); svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(NS, 'line'), c1 = document.createElementNS(NS, 'circle'), c2 = document.createElementNS(NS, 'circle');
  for (const c of [c1, c2]) c.setAttribute('r', '7');
  svg.append(line, c1, c2); svg.style.display = 'none';
  const msg = el('span', { role: 'status' });
  const banner = el('div', { class: 'os-measure os-glass os-chrome', hidden: true }, msg, iconButton('close', 'Exit measure tool (Esc)', () => stop()));
  let on = false, a = null, b = null;
  const pa = new Float64Array(3), pb = new Float64Array(3), sa = { x: 0, y: 0, depth: 0 }, sb = { x: 0, y: 0, depth: 0 };
  const text = () => {
    if (!a) return 'Measure: pick the first object (click a label or body).';
    if (!b) return `Measure: ${a.name} selected. Pick the second object.`;
    a.position(app.time.jd, pa); b.position(app.time.jd, pb);
    const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    return `${a.name} to ${b.name}: ${formatDistance(d)} straight line · light takes ${formatDuration(d / C)}`;
  };
  function refresh() { const t = text(); if (msg.textContent !== t) { msg.textContent = t; } }
  function start() { on = true; a = b = null; banner.hidden = false; svg.style.display = ''; ctx.state.measure = true; refresh(); ctx.announce(msg.textContent); }
  function stop() { if (!on) return; on = false; a = b = null; banner.hidden = true; svg.style.display = 'none'; ctx.state.measure = false; }
  function add(e) {
    if (!e) return;
    if (b || !a) { a = e; b = null; } else if (e !== a) b = e; else return;
    refresh(); ctx.announce(msg.textContent);
  }
  function update() {
    if (!on) return;
    refresh();
    if (!a) return;
    const draw = (e, w, s, c) => { e.position(app.time.jd, w); const p = app.project(w, s); if (!p) { c.style.display = 'none'; return null; } c.style.display = ''; c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); return p; };
    const p1 = draw(a, pa, sa, c1), p2 = b ? draw(b, pb, sb, c2) : (c2.style.display = 'none', null);
    if (p1 && p2) { line.style.display = ''; line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y); line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y); } else line.style.display = 'none';
  }
  return { svg, banner, start, stop, add, update, toggle() { on ? stop() : start(); }, get active() { return on; }, get pair() { return [a, b]; } };
}

// ---- photo mode ----------------------------------------------------------------------------
export function initPhoto(ctx) {
  const { app } = ctx, T = app.time;
  let on = false, prev = null;
  const f0 = 50;
  const out = el('output', { class: 'os-mono' }, `${f0} mm`);
  const slider = el('input', { type: 'range', min: '0', max: '1000', step: '1', 'aria-label': 'Focal length, 14 to 1200 millimetres' });
  const toV = (mm) => Math.round((Math.log(mm / 14) / Math.log(1200 / 14)) * 1000), toMM = (v) => 14 * Math.pow(1200 / 14, v / 1000);
  const apply = () => { const mm = toMM(+slider.value); app.camera.fovY = focalToFov(mm); const t = `${Math.round(mm)} mm`; out.textContent = t; slider.setAttribute('aria-valuetext', `${t} on 36 by 24 millimetre full frame`); };
  slider.addEventListener('input', apply);
  const shot = el('button', { type: 'button', class: 'os-btn on', onclick: capture }, 'Capture PNG');
  const panel = el('div', { class: 'os-photo-panel os-glass', role: 'group', 'aria-label': 'Photo mode', hidden: true },
    el('span', null, 'Focal length'), slider, out, shot, el('button', { type: 'button', class: 'os-btn', onclick: () => exit() }, 'Exit'));
  async function capture() {
    try {
      const blob = await app.capture();
      if (!blob) throw new Error('capture returned nothing');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `orion-spur-${app.camera.focus?.id || 'view'}-${stamp}.png` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      ctx.toast('Saved PNG', { ms: 2500 });
    } catch (err) { ctx.toast(`Capture failed: ${err.message}`, { kind: 'err' }); }
  }
  function enter() {
    if (on) return; ctx.tours?.stop(); ctx.measure?.stop(); ctx.dialogs.close();
    on = true; ctx.state.photo = true;
    prev = { fov: app.camera.fovY, paused: T.paused };
    if (!T.paused) T.togglePause();
    slider.value = String(Math.min(1000, Math.max(0, toV(fovToFocal(app.camera.fovY)))));
    ctx.root.classList.add('os-photo'); panel.hidden = false; apply();
    slider.focus({ preventScroll: true }); ctx.announce('Photo mode. Time paused. Use the focal length slider, then capture.');
  }
  function exit() {
    if (!on) return; on = false; ctx.state.photo = false;
    ctx.root.classList.remove('os-photo'); panel.hidden = true;
    app.camera.fovY = prev.fov; if (!prev.paused && T.paused) T.togglePause();
    app.canvas.focus({ preventScroll: true });
  }
  return { panel, enter, exit, capture, toggle() { on ? exit() : enter(); }, get active() { return on; } };
}

// ---- bookmarks (URL hash) ------------------------------------------------------------------
export function initBookmarks(ctx) {
  const { app } = ctx;
  let lastSet = null, retry = 0, ready = false;
  const initial = (() => { try { return decodeURIComponent(location.hash.slice(1)).toLowerCase(); } catch { return ''; } })();
  const hashId = () => { try { return decodeURIComponent(location.hash.slice(1)).toLowerCase(); } catch { return ''; } };
  function go(id, tries = 0, start = app.camera.focus?.id, opts = {}) {
    clearTimeout(retry);
    if (!id) return;
    const e = app.registry.get(id);
    if (e) { if (app.camera.focus?.id !== id || app.camera.transition) app.camera.goTo(e, opts); return; }
    if (tries < 30 && app.camera.focus?.id === start) retry = setTimeout(() => go(id, tries + 1, start, opts), 300); // registry may still be filling
  }
  function write(e) {
    if (!ready || !e || lastSet === e.id) return; lastSet = e.id;
    const h = e.id === 'milky-way' ? '' : `#${encodeURIComponent(e.id)}`;
    try { history.replaceState(null, '', location.pathname + location.search + h); } catch {}
  }
  app.camera.addEventListener('focus', (ev) => { write(ev.detail); });
  addEventListener('hashchange', () => { const id = hashId(); if (id && id !== lastSet) go(id); });
  app.events.addEventListener('ready', () => { ready = true; const id = initial || hashId(); if (id) go(id, 0, app.camera.focus?.id, { duration: 0.05 }); else write(app.camera.focus); });
  return { go };
}

// ---- accessible description (aria-live) ----------------------------------------------------
export function initAnnouncer(ctx, labels) {
  const { app } = ctx;
  const region = el('div', { class: 'os-sr', role: 'region', 'aria-label': 'Accessible description', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const msg = el('div'); region.append(msg);
  let lastInput = 0, announcedInput = 0;
  function describe() {
    const f = app.camera.focus; if (!f) return '';
    const d = app.camera.mode === 'fly' ? app.camera.nearest.distance : app.camera.dist;
    const lv = dominantLevel(app.frame?.levels);
    const near = labels.nearestNames(6, f);
    return `${f.name}, ${typeLabel(f.type).toLowerCase()}. Camera ${formatDistance(d)} from it, at ${LEVEL_NAMES[lv].toLowerCase()} scale.${near.length ? ` In view: ${near.join(', ')}.` : ' No other labelled objects in view.'}`;
  }
  const say = (t) => { if (t) msg.textContent = t; };
  app.camera.addEventListener('arrived', () => setTimeout(() => say(describe()), 300));
  app.camera.addEventListener('mode', () => say(`${app.camera.mode === 'fly' ? 'Fly' : 'Orbit'} mode`));
  return {
    region, say, describe,
    update(now) { // announce once the camera has been still for 1.2 s after user input
      const li = app.camera.lastInput;
      if (li !== lastInput) { lastInput = li; }
      if (lastInput !== announcedInput && now - lastInput > 1200 && !app.camera.transition) { announcedInput = lastInput; say(describe()); }
    },
  };
}

// ---- toasts --------------------------------------------------------------------------------
export function initToasts() {
  const root = el('div', { class: 'os-toasts' });
  function toast(text, { kind = 'info', ms = 6000 } = {}) {
    const t = el('div', { class: `os-toast os-glass ${kind === 'err' ? 'err' : ''}`, role: kind === 'err' ? 'alert' : 'status' }, el('span', null, text),
      iconButton('close', 'Dismiss', () => t.remove()));
    root.append(t); while (root.children.length > 4) root.firstChild.remove();
    if (ms) setTimeout(() => t.remove(), ms);
    return t;
  }
  return { root, toast };
}
