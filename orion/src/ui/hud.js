import { el, icon, iconButton } from 'orion/ui/dom.js';
import { formatDistance, formatDuration, vlen, DAY } from 'orion/core/units.js';
import { RATES } from 'orion/core/time.js';
import { LEVEL_NAMES, dominantLevel, typeLabel, fmtUtc, parseUtc, niceScale, fmtLatLon, fmtDay } from 'orion/ui/format.js';

// ---- breadcrumb ----------------------------------------------------------------------------
export function initBreadcrumb(ctx) {
  const { app } = ctx;
  const ol = el('ol'); const lvl = el('span', { class: 'os-lvl', 'aria-label': 'Current scale level' });
  const root = el('nav', { class: 'os-bc os-glass os-chrome', 'aria-label': 'Breadcrumb' }, ol, lvl);
  let key = '';
  function update(f) {
    const foc = app.camera.focus; if (!foc) return;
    const dom = dominantLevel(f.levels);
    const k = `${foc.id}|${dom}|${app.registry.map.size}`;
    if (k === key) return; key = k;
    ol.textContent = '';
    const path = app.registry.path(foc.id);
    path.forEach((e, i) => {
      const last = i === path.length - 1;
      ol.append(el('li', null, last ? el('span', { class: 'cur', 'aria-current': 'page' }, e.name)
        : el('button', { type: 'button', class: 'os-btn', onclick: () => app.camera.goTo(e) }, e.name)));
    });
    lvl.textContent = `L${dom} · ${LEVEL_NAMES[dom]}`;
    fit();
  }
  // Long trails keep their END visible (the current object); the clipped start fades out instead of being sliced mid-letter.
  function fit() {
    ol.scrollLeft = ol.scrollWidth;
    root.classList.toggle('clip', ol.scrollWidth > ol.clientWidth + 1);
  }
  addEventListener('resize', fit);
  ol.addEventListener('scroll', () => root.classList.toggle('clip', ol.scrollLeft > 1));
  return { root, update, fit };
}

// ---- info panel ----------------------------------------------------------------------------
export function initInfo(ctx) {
  const { app } = ctx;
  const title = el('h2'); const chip = el('span', { class: 'os-chip' });
  const toggle = el('button', { type: 'button', class: 'os-btn os-ib', 'aria-label': 'Collapse info panel', 'aria-expanded': 'true' }, icon('chev'));
  toggle.firstChild.classList.add('tg');
  const header = el('header', null, title, chip, toggle);
  const body = el('div', { class: 'body' });
  const root = el('section', { class: 'os-info os-glass os-chrome', 'aria-label': 'Object information', hidden: true }, header, body);
  const phone = matchMedia('(max-width: 699px)');
  const setCollapsed = (c) => { root.classList.toggle('collapsed', c); toggle.setAttribute('aria-expanded', String(!c)); toggle.setAttribute('aria-label', c ? 'Expand info panel' : 'Collapse info panel'); };
  toggle.addEventListener('click', () => setCollapsed(!root.classList.contains('collapsed')));
  title.addEventListener('click', () => { if (phone.matches) toggle.click(); });
  setCollapsed(phone.matches);

  let cur = null, cells = {}, gotoRows = [], sig = '', lastLive = 0, lastGoto = 0;
  const tmp = new Float64Array(3), tmp2 = new Float64Array(3);
  const row = (k, v) => { const dd = el('dd', null, v); return [el('dt', null, k), dd, dd]; };

  function build(e) {
    cur = e; cells = {}; gotoRows = [];
    title.textContent = e.name; chip.textContent = typeLabel(e.type);
    body.textContent = '';
    const dl = el('dl'); const add = (key, label, v) => { const [dt, dd, c] = row(label, v); dl.append(dt, dd); if (key) cells[key] = { dt, dd }; };
    const i = e.info || {};
    add('cam', 'Distance', '–');
    if (e.radius > 0) add('alt', 'Altitude', '–');
    add('sun', 'From Sun', '–');
    if (e.radius > 0) add(null, 'Radius', formatDistance(e.radius));
    if (i.periodDays) add(null, 'Period', formatDuration(i.periodDays * DAY));
    if (Number.isFinite(i.dayHours) && i.dayHours) add(null, 'Day length', fmtDay(i.dayHours));
    if (Number.isFinite(i.tilt)) add(null, 'Axial tilt', `${i.tilt}°`);
    if (i.spectralType) add(null, 'Spectral type', i.spectralType);
    if (Number.isFinite(i.magnitude)) add(null, 'Magnitude', String(i.magnitude));
    if (Number.isFinite(i.distanceLy) && !['planet', 'moon', 'sun', 'dwarf'].includes(e.type)) add(null, 'Catalogue dist.', formatDistance(i.distanceLy * 9.4607304725808e15));
    if (['planet', 'moon', 'dwarf'].includes(e.type)) add('ssp', 'Sub-solar point', '–');
    body.append(dl);
    if (i.description) {
      const d = el('p', { class: 'os-desc' }, String(i.description));
      const more = el('button', { type: 'button', class: 'os-link', 'aria-expanded': 'false' }, 'More');
      more.addEventListener('click', () => { const o = d.classList.toggle('open'); more.textContent = o ? 'Less' : 'More'; more.setAttribute('aria-expanded', String(o)); });
      body.append(d, more);
      requestAnimationFrame(() => { if (d.scrollHeight <= d.clientHeight + 1 && !d.classList.contains('open')) more.hidden = true; });
    }
    const kids = app.registry.children(e.id).filter((c) => c.name).sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name));
    if (kids.length) {
      const wrap = el('div', { class: 'os-goto' }, el('h3', null, `Go to · ${kids.length}`));
      const LIMIT = 24; let all = false;
      const draw = () => {
        wrap.querySelectorAll('.os-btn,.os-link').forEach((n) => n.remove()); gotoRows = [];
        for (const k of kids.slice(0, all ? 200 : LIMIT)) {
          const d = el('span', { class: 'd' }, '');
          wrap.append(el('button', { type: 'button', class: 'os-btn', onclick: () => app.camera.goTo(k) }, el('span', null, k.name), d));
          gotoRows.push({ k, d });
        }
        if (kids.length > LIMIT && !all) wrap.append(el('button', { type: 'button', class: 'os-link', onclick: () => { all = true; draw(); refreshGoto(); } }, `Show ${Math.min(kids.length, 200) - LIMIT} more`));
        refreshGoto();
      };
      draw(); body.append(wrap);
    }
  }
  function refreshGoto() {
    if (!cur) return;
    cur.position(app.time.jd, tmp);
    for (const r of gotoRows) { r.k.position(app.time.jd, tmp2); r.d.textContent = formatDistance(Math.hypot(tmp2[0] - tmp[0], tmp2[1] - tmp[1], tmp2[2] - tmp[2])); }
  }
  function live(f) {
    const e = cur; if (!e) return;
    e.position(f.jd, tmp);
    const c = f.camPos, d = Math.hypot(tmp[0] - c[0], tmp[1] - c[1], tmp[2] - c[2]);
    cells.cam.dd.textContent = formatDistance(d);
    if (cells.alt) cells.alt.dd.textContent = formatDistance(Math.max(0, d - (app.camera.surfaceRadius?.(e) ?? e.radius)));
    cells.sun.dd.textContent = formatDistance(vlen(tmp));
    if (cells.ssp) {
      const fn = app.shared.ephemeris?.subSolarPoint; let t = null;
      if (fn) { try { const p = fn(e.id, f.jd); if (p && Number.isFinite(p.lat)) t = fmtLatLon(p.lat, p.lon); } catch {} }
      cells.ssp.dd.textContent = t || '–'; cells.ssp.dt.hidden = cells.ssp.dd.hidden = !t;
    }
  }
  function update(f, now) {
    const e = app.camera.focus;
    if (!e) { root.hidden = true; return; }
    root.hidden = false;
    const s = `${e.id}|${app.registry.map.size}`;
    if (s !== sig) { sig = s; build(e); live(f); }
    if (now - lastLive > 250) { lastLive = now; live(f); }
    if (now - lastGoto > 2000) { lastGoto = now; refreshGoto(); }
  }
  return { root, update, setCollapsed };
}

// ---- scale bar + orientation ---------------------------------------------------------------
export function initCorner(ctx) {
  const { app } = ctx;
  const bar = el('i'); const txt = el('span');
  const scale = el('div', { class: 'os-scale os-glass', role: 'img', 'aria-label': 'Scale bar' }, txt, bar);
  const orient = el('button', { type: 'button', class: 'os-btn os-glass', 'aria-label': 'Orientation: ecliptic up. Toggle galactic.', title: 'Orientation reference (ecliptic / galactic)' }, 'Ecliptic');
  const root = el('div', { class: 'os-corner os-chrome' }, orient, scale);
  const sync = () => { const g = app.camera.upMode === 'galactic'; orient.textContent = g ? 'Galactic' : 'Ecliptic'; orient.setAttribute('aria-label', `Orientation: ${g ? 'galactic' : 'ecliptic'} up. Toggle ${g ? 'ecliptic' : 'galactic'}.`); };
  orient.addEventListener('click', () => app.camera.setUpMode(app.camera.upMode === 'galactic' ? 'ecliptic' : 'galactic'));
  app.camera.addEventListener('upmode', sync);
  let last = 0;
  function update(f, now) {
    if (now - last < 120) return; last = now;
    const D = app.camera.mode === 'fly' ? Math.max(app.camera.nearest.distance, 1) : Math.max(app.camera.dist, 1);
    const mpp = (2 * D * Math.tan((f.fovY * Math.PI) / 360)) / f.viewport.cssH;
    const s = niceScale(mpp, 100);
    txt.textContent = s.label; bar.style.width = `${Math.max(8, s.px).toFixed(0)}px`;
    scale.setAttribute('aria-label', `Scale bar: ${s.label}`);
  }
  return { root, update, sync };
}

// ---- timeline ------------------------------------------------------------------------------
export function initTimeline(ctx) {
  const { app } = ctx, T = app.time;
  const galOK = () => dominantLevel(app.frame?.levels) <= 1;
  const date = el('input', { type: 'text', class: 'os-date', 'aria-label': 'UTC date and time, YYYY-MM-DD HH:MM:SS. Press Enter to jump.', spellcheck: 'false', autocomplete: 'off', size: '21' });
  const badge = el('span', { class: 'os-badge', role: 'status', hidden: true }, 'Approximate positions');
  const scrub = el('input', { type: 'range', class: 'os-scrub', min: '-1000', max: '1000', step: '1', value: '0', 'aria-label': 'Scrub time. Right goes forward, left goes back; it springs back to the centre.', 'aria-valuetext': 'paused at centre' });
  const nowB = el('button', { type: 'button', class: 'os-btn', title: 'Jump to the present (N)', onclick: () => T.now() }, 'Now');
  const pauseB = el('button', { type: 'button', class: 'os-btn os-ib', title: 'Pause / play (Space)', 'aria-label': 'Pause', onclick: () => T.togglePause() }, icon('pause'));
  const revB = el('button', { type: 'button', class: 'os-btn os-ib', title: 'Reverse time direction', 'aria-label': 'Reverse time', 'aria-pressed': 'false', onclick: () => { T.direction = -T.direction; T.setRate(T.rateIndex, galOK()); } }, icon('rev'));
  const slowB = iconButton('slower', 'Slower ([)', () => T.slower());
  const fastB = iconButton('faster', 'Faster (])', () => T.faster(galOK()));
  const chips = RATES.map((r, i) => el('button', { type: 'button', class: 'os-btn', 'aria-pressed': 'false', onclick: () => T.setRate(i, true) }, r.label));
  const rateOne = el('button', { type: 'button', class: 'os-btn os-rate-one', title: 'Cycle time rate', onclick: () => { const max = galOK() ? RATES.length - 1 : RATES.findIndex((r) => r.galactic) - 1; T.setRate(T.rateIndex >= max ? 0 : T.rateIndex + 1, galOK()); } }, '');
  const rates = el('div', { class: 'os-rates', role: 'group', 'aria-label': 'Time rate' }, chips);
  const root = el('div', { class: 'os-bottom os-chrome' }, el('div', { class: 'os-tl os-glass', role: 'group', 'aria-label': 'Time controls' },
    el('div', { class: 'r' }, date, badge, scrub, nowB),
    el('div', { class: 'r' }, pauseB, revB, slowB, rates, rateOne, fastB)));

  // Publish the bar's real height so the info sheet and tour caption always stack above it, whatever wraps.
  if (typeof ResizeObserver === 'function') {
    const bar = root.firstChild; let lastH = 0;
    new ResizeObserver(() => { const h = Math.ceil(bar.getBoundingClientRect().height); if (h && h !== lastH) { lastH = h; ctx.root.style.setProperty('--os-bar', `${h}px`); } }).observe(bar);
  }
  const sync = () => {
    const ok = galOK();
    chips.forEach((c, i) => { const on = i === T.rateIndex; c.setAttribute('aria-pressed', String(on)); c.classList.toggle('on', on); c.disabled = !!RATES[i].galactic && !ok && !on; });
    const r = RATES[T.rateIndex];
    rateOne.textContent = `${T.direction < 0 ? '−' : ''}${r.label}`;
    pauseB.firstChild.replaceWith(icon(T.paused ? 'play' : 'pause'));
    pauseB.setAttribute('aria-label', T.paused ? 'Play' : 'Pause'); pauseB.classList.toggle('on', T.paused);
    revB.setAttribute('aria-pressed', String(T.direction < 0));
    badge.hidden = !T.approximate;
  };
  T.addEventListener('change', sync);
  app.events.addEventListener('level', () => { // galactic rates only make sense at L0/L1
    if (!galOK() && RATES[T.rateIndex].galactic) T.setRate(RATES.findIndex((r) => r.galactic) - 1, false); else sync();
  });

  const commit = () => {
    const jd = parseUtc(date.value);
    if (jd == null) { date.setAttribute('aria-invalid', 'true'); ctx.toast('Use YYYY-MM-DD HH:MM[:SS] (UTC)', { kind: 'err', ms: 3500 }); return; }
    date.removeAttribute('aria-invalid'); T.setJd(jd); date.blur();
  };
  date.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.stopPropagation(); date.blur(); } });
  date.addEventListener('change', commit);

  // Spring-loaded scrubber: displacement sets a rate (10^(4.5|v|) × 0.05 days per real second).
  let v = 0, releaseT = 0;
  const reset = () => { v = 0; scrub.value = '0'; scrub.setAttribute('aria-valuetext', 'paused at centre'); };
  scrub.addEventListener('input', () => { v = +scrub.value / 1000; clearTimeout(releaseT); const d = Math.sign(v) * 0.05 * Math.pow(10, 4.5 * Math.abs(v)); scrub.setAttribute('aria-valuetext', v ? `${d.toFixed(2)} days per second` : 'centre'); });
  for (const t of ['pointerup', 'pointercancel', 'blur']) scrub.addEventListener(t, reset);
  scrub.addEventListener('pointerup', () => scrub.blur()); // hand keyboard focus back so shortcuts keep working
  scrub.addEventListener('keyup', () => { clearTimeout(releaseT); releaseT = setTimeout(reset, 500); });

  let lastText = 0;
  function update(f, now) {
    if (v) { app.time.setJd(app.time.jd + (Math.sign(v) * 0.05 * Math.pow(10, 4.5 * Math.abs(v)) * f.realDt)); }
    if (now - lastText > 90) {
      lastText = now;
      if (document.activeElement !== date) { const s = fmtUtc(f.jd); if (date.value !== s) date.value = s; date.removeAttribute('aria-invalid'); }
      if (badge.hidden === app.time.approximate) badge.hidden = !app.time.approximate;
    }
  }
  sync();
  return { root, update, sync, galOK };
}
