import { CSS } from 'orion/ui/style.js';
import { el, icon, iconButton } from 'orion/ui/dom.js';
import { initBreadcrumb, initInfo, initCorner, initTimeline } from 'orion/ui/hud.js';
import { initSearch } from 'orion/ui/search.js';
import { initLabels } from 'orion/ui/labels.js';
import { initSettings, initAbout } from 'orion/ui/settings.js';
import { initTours } from 'orion/ui/tours.js';
import { initMeasure, initPhoto, initBookmarks, initAnnouncer, initToasts } from 'orion/ui/tools.js';

// Text-entry targets swallow shortcuts; sliders, switches and checkboxes must not (a focused scrubber would otherwise kill Esc, N, Space…).
export const editable = (t) => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
  || (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(t.type || 'text')));

export async function install(app) {
  const host = document.getElementById('ui');
  if (!host) throw new Error('ui: #ui root missing');
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = el('div', { class: 'os-root', lang: 'en' });
  host.append(root);

  const ctx = { app, root, state: { searchOpen: false, tour: null, measure: false, photo: false, hidden: false, rmUser: undefined }, lastUi: performance.now() };
  const { root: toastRoot, toast } = initToasts();
  ctx.toast = toast;
  ctx.announce = (t) => ann.say(t);

  // Dialog manager: one open at a time, focus moves in and back to the trigger.
  const dialogs = ctx.dialogs = (() => {
    let cur = null, trigger = null;
    return {
      open(d, from, onOpen) {
        if (cur === d) return this.close();
        this.close(); cur = d; trigger = from || document.activeElement; d.hidden = false; onOpen?.();
        const f = d.querySelector('button, input, [href]'); f?.focus({ preventScroll: true });
        ctx.state.dialog = d;
      },
      close() { if (!cur) return; cur.hidden = true; cur = null; ctx.state.dialog = null; trigger?.focus?.({ preventScroll: true }); trigger = null; },
      get current() { return cur; },
    };
  })();

  // Core pieces.
  const labels = initLabels(ctx);
  const search = initSearch(ctx);
  const bc = initBreadcrumb(ctx), info = initInfo(ctx), corner = initCorner(ctx), tl = initTimeline(ctx);
  const settings = initSettings(ctx), about = initAbout(ctx);
  const tours = ctx.tours = initTours(ctx);
  const measure = ctx.measure = initMeasure(ctx);
  const photo = ctx.photo = initPhoto(ctx);
  const ann = ctx.ann = initAnnouncer(ctx, labels);
  const bookmarks = initBookmarks(ctx);

  // Pick: label click / canvas click → measure, skip tour, or go.
  ctx.pickEntry = (e) => {
    if (!e) return;
    if (tours.active) { tours.stop(); return; }
    if (measure.active) { measure.add(e); return; }
    app.camera.goTo(e);
  };
  let swallowUntil = 0;
  app.canvas.addEventListener('pointerdown', () => { if (tours.active) { tours.stop(); swallowUntil = performance.now() + 700; } }, true);
  app.events.addEventListener('pick', (ev) => {
    if (performance.now() < swallowUntil || photo.active) return;
    const { x, y } = ev.detail; const e = labels.pickAt(x, y);
    if (e) ctx.pickEntry(e); else if (measure.active) toast('Nothing there to measure', { ms: 1800 });
  });

  // Toolbar.
  const flyB = iconButton('fly', 'Fly mode (F)', () => app.camera.setMode(app.camera.mode === 'fly' ? 'orbit' : 'fly'), { 'aria-pressed': 'false' });
  app.camera.addEventListener('mode', () => flyB.setAttribute('aria-pressed', String(app.camera.mode === 'fly')));
  const toursB = iconButton('tours', 'Tours (T)', () => dialogs.open(tours.menu, toursB));
  const measureB = iconButton('measure', 'Measure distance (M)', () => measure.toggle(), { 'aria-pressed': 'false' });
  const photoB = iconButton('photo', 'Photo mode (P)', () => photo.toggle());
  const setB = iconButton('settings', 'Settings', () => dialogs.open(settings.root, setB, () => settings.sync()));
  const aboutB = iconButton('info', 'About, keys and attributions', () => dialogs.open(about.root, aboutB, about.onOpen));
  const hideB = iconButton('hide', 'Hide interface (H)', () => hide());
  const tools = el('div', { class: 'os-tools os-glass os-chrome', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' }, flyB, toursB, measureB, photoB, setB, aboutB, hideB);
  function hide(force) {
    const h = force ?? !ctx.state.hidden; ctx.state.hidden = h; root.classList.toggle('os-hidden', h);
    if (h) toast('Interface hidden. Press H to show it.', { ms: 2500 });
  }

  const top = el('div', { class: 'os-top' }, bc.root, search.root);
  root.append(top, tools, labels.layer, info.root, corner.root, tl.root, tours.caption, tours.menu, settings.root, about.root,
    measure.svg, measure.banner, photo.panel, ann.region, toastRoot);

  // Keyboard (capture phase so Esc can pre-empt core's "back").
  addEventListener('keydown', (e) => {
    ctx.lastUi = performance.now();
    const t = e.target, ed = editable(t);
    if (e.key === 'Escape') {
      if (ed) return;
      const h = tours.active ? () => tours.stop() : dialogs.current ? () => dialogs.close() : photo.active ? () => photo.exit() : measure.active ? () => measure.stop() : ctx.state.hidden ? () => hide(false) : null;
      if (h) { e.preventDefault(); e.stopImmediatePropagation(); h(); }
      return;
    }
    if (tours.active && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) tours.stop();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); search.focus(); return; }
    if (ed || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const onBtn = t?.tagName === 'BUTTON' && !t.classList.contains('os-label');
    if (k === '/') { e.preventDefault(); search.focus(); }
    else if (e.key === ' ') { if (onBtn || t?.getAttribute?.('role') === 'radio') return; e.preventDefault(); app.time.togglePause(); }
    else if (e.key === '[') app.time.slower();
    else if (e.key === ']') app.time.faster(tl.galOK());
    else if (k === 'n') app.time.now();
    else if (k === 'h') hide();
    else if (k === 'm') measure.toggle();
    else if (k === 'p') photo.toggle();
    else if (k === 't') dialogs.open(tours.menu, toursB);
  }, true);
  // A mouse/touch click on a button must not leave it focused: Space/N/H shortcuts (and Space-to-pause) would then act on that button.
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('button'); if (!b || e.detail === 0 || b.classList.contains('os-label')) return;
    setTimeout(() => { if (document.activeElement === b && !dialogs.current && !b.closest('[role=dialog]')) b.blur(); }, 0);
  });
  const touch = () => { ctx.lastUi = performance.now(); };
  root.addEventListener('pointermove', touch); root.addEventListener('pointerdown', touch); root.addEventListener('focusin', touch);
  addEventListener('pointerdown', (e) => { // click outside a dialog closes it
    const d = dialogs.current; if (d && !d.contains(e.target) && !tools.contains(e.target)) dialogs.close();
  }, true);

  // Errors.
  const showErr = (d) => toast(`Module failed: ${String(d.spec || '').replace(/^orion\//, '')}${d.err?.message ? ` (${d.err.message})` : ''}`, { kind: 'err', ms: 10000 });
  for (const d of app.moduleErrors || []) showErr(d);
  app.events.addEventListener('module-error', (ev) => showErr(ev.detail));

  // Per-frame work.
  let idle = false, lastBc = 0;
  app.onFrame((f) => {
    const now = performance.now();
    labels.layout(f, now);
    measure.update();
    bc.update(f); info.update(f, now); corner.update(f, now); tl.update(f, now); ann.update(now);
    const busy = ctx.state.searchOpen || dialogs.current || ctx.state.photo || ctx.state.measure;
    const nowIdle = !busy && now - Math.max(app.camera.lastInput, ctx.lastUi) > 4000;
    if (nowIdle !== idle) { idle = nowIdle; root.classList.toggle('os-idle', idle); }
  }, 100);

  app.ui = { root, search, labels, tours, measure, photo, bookmarks, settings, toast, dialogs, hide, startTour: (id) => tours.start(id), stopTour: () => tours.stop(), describe: () => ann.describe() };
}
