import { el, icon } from 'orion/ui/dom.js';
import { buildIndex, search } from 'orion/ui/fuzzy.js';
import { formatDistance } from 'orion/core/units.js';
import { LEVEL_NAMES, levelOf, typeLabel } from 'orion/ui/format.js';

export function initSearch(ctx) {
  const { app } = ctx;
  const input = el('input', {
    type: 'text', class: 'os-search-input', placeholder: 'Search objects', role: 'combobox', 'aria-label': 'Search objects',
    'aria-expanded': 'false', 'aria-controls': 'os-results', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', enterkeyhint: 'go',
  });
  const list = el('div', { id: 'os-results', class: 'os-results os-glass', role: 'listbox', 'aria-label': 'Search results', hidden: true });
  const box = el('div', { class: 'os-search-box os-glass' }, icon('search'), input, el('span', { class: 'os-kbd', 'aria-hidden': 'true' }, '/'));
  const root = el('div', { class: 'os-search os-chrome' }, box, list);

  let index = [], dirty = true, timer = 0, flat = [], active = 0;
  const rebuild = () => { dirty = false; index = buildIndex(app.registry.all()); };
  app.registry.addEventListener('add', () => { dirty = true; clearTimeout(timer); timer = setTimeout(() => { rebuild(); if (isOpen()) refresh(); }, 200); });
  const isOpen = () => !list.hidden;
  const tmp = new Float64Array(3);
  const camDist = (e) => {
    const c = app.frame?.camPos || app.camera.pos; e.position(app.time.jd, tmp);
    return Math.hypot(tmp[0] - c[0], tmp[1] - c[1], tmp[2] - c[2]);
  };

  function suggestions() {
    return app.registry.all().filter((e) => e.name && (e.priority || 0) >= 60).sort((a, b) => (b.priority || 0) - (a.priority || 0)).slice(0, 10).map((e) => ({ e }));
  }
  function refresh() {
    if (dirty) rebuild();
    const q = input.value.trim();
    let hits = q ? search(index, q, 40) : suggestions();
    // Keyboard order must equal the visual order, which is grouped by scale level (best hit first within a group).
    const byLevel = new Map();
    for (const h of hits) { const lv = levelOf(h.e); if (!byLevel.has(lv)) byLevel.set(lv, []); byLevel.get(lv).push(h); }
    hits = [...byLevel.values()].flat();
    flat = hits.map((h) => h.e);
    list.textContent = '';
    if (!flat.length) { list.append(el('div', { class: 'os-empty', role: 'option', 'aria-disabled': 'true' }, `No match for “${q}”`)); open(); setActive(-1); return; }
    const groups = new Map();
    hits.forEach((h, i) => { const lv = levelOf(h.e); if (!groups.has(lv)) groups.set(lv, []); groups.get(lv).push(i); });
    for (const [lv, ids] of groups) {
      list.append(el('div', { class: 'os-grp', role: 'presentation' }, q ? `L${lv} · ${LEVEL_NAMES[lv] || ''}` : 'Suggestions'));
      for (const i of ids) {
        const e = flat[i];
        const row = el('div', { class: 'os-res', role: 'option', id: `os-res-${i}`, 'aria-selected': 'false' },
          el('span', { class: 'n' }, e.name), el('span', { class: 't' }, typeLabel(e.type)), el('span', { class: 'd' }, formatDistance(camDist(e))));
        row.addEventListener('mousedown', (ev) => ev.preventDefault());
        row.addEventListener('click', () => go(e));
        row.addEventListener('mousemove', () => { if (active !== i) setActive(i, false); });
        list.append(row);
      }
    }
    open(); setActive(0);
  }
  function open() { list.hidden = false; input.setAttribute('aria-expanded', 'true'); ctx.state.searchOpen = true; }
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); ctx.state.searchOpen = false; }
  function setActive(i, scroll = true) {
    active = i;
    for (const r of list.querySelectorAll('.os-res')) r.setAttribute('aria-selected', 'false');
    const row = i >= 0 ? list.querySelector(`#os-res-${i}`) : null;
    if (row) { row.setAttribute('aria-selected', 'true'); input.setAttribute('aria-activedescendant', row.id); if (scroll) row.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
  function go(e) {
    close(); input.value = ''; input.blur();
    app.canvas.focus({ preventScroll: true });
    ctx.announce(`Going to ${e.name}`);
    app.camera.goTo(e);
  }
  input.addEventListener('input', refresh);
  input.addEventListener('focus', () => { input.select(); refresh(); });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 120));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (flat.length) setActive((active + 1) % flat.length); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (flat.length) setActive((active - 1 + flat.length) % flat.length); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (flat[active]) go(flat[active]); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); input.value = ''; input.blur(); app.canvas.focus({ preventScroll: true }); }
  });

  return { root, input, focus() { input.focus(); input.select(); }, close, isOpen, query(q) { input.value = q; refresh(); return flat.slice(); }, get size() { return index.length; } };
}
