import * as THREE from 'three';
import { el } from 'orion/ui/dom.js';
import { PC, LY, smoothstep as sm, formatDistance } from 'orion/core/units.js';

const MAX = 120, GRID = 24;

// Apparent magnitude at the camera: entry.apparentMag(), else absolute magnitude, else catalogue magnitude.
function estMag(e, d, f) {
  if (typeof e.apparentMag === 'function') { try { const m = e.apparentMag(f.camPos, f.jd); if (Number.isFinite(m)) return m; } catch {} }
  const i = e.info || {};
  if (Number.isFinite(i.absmag)) return i.absmag + 5 * Math.log10(Math.max(d / PC, 1e-12) / 10);
  if (Number.isFinite(i.magnitude)) {
    if (Number.isFinite(i.distanceLy) && i.distanceLy > 0) return i.magnitude + 5 * Math.log10(Math.max(d / (i.distanceLy * LY), 1e-9));
    return i.magnitude;
  }
  return null;
}

// Crowding 0–1 from the biggest solid disc on screen (px): once a planet or moon fills the view, the backdrop labels
// (stars, deep-sky) are mostly noise, so only the brightest few survive.
export const crowding = (maxDisc) => sm(40, 200, maxDisc);

// Label opacity target (0–1) for an entry, before the 40 px disc fade-out. `crowd` (0–1) thins backdrop labels.
export function labelAlpha(e, d, disc, f, settings, crowd = 0) {
  const lv = f.levels;
  switch (e.type) {
    case 'sun': case 'planet': case 'dwarf': return Math.max(1 - sm(2e14, 3e14, d), sm(1, 3, disc));
    case 'moon': return Math.max(1 - sm(2e10, 4e10, d), sm(1, 3, disc));
    case 'asteroid': case 'comet': return Math.max(1 - sm(5e11, 1.5e12, d), sm(2, 6, disc));
    case 'star': {
      const m = estMag(e, d, f);
      if (m == null) return 1 - sm(5 * PC, 15 * PC, d);
      const lim = 3.2 + 2.5 * Math.log10(50 / Math.max(f.fovY, 0.5)) - 2.4 * crowd; // 3.2 → 0.8 with a planet filling the view
      return 1 - sm(lim - 0.5, lim + 0.5, m);
    }
    case 'nebula': case 'open-cluster': case 'planetary': case 'snr': {
      const m = estMag(e, d, f);
      const magOk = m == null ? 1 : 1 - sm(8.5, 10.5, m);
      return Math.max(sm(6, 14, disc), (1 - sm(2e3 * PC, 5e3 * PC, d)) * magOk * (1 - crowd));
    }
    case 'galaxy': return sm(2e3 * PC, 1e4 * PC, d) * (1 - sm(1e6 * PC, 3e6 * PC, d)) * (1 - crowd);
    // ~150 globulars would carpet the face-on overview; label them from inside the halo only.
    case 'globular': return (1 - sm(4e3 * PC, 1e4 * PC, d)) * (1 - crowd);
    case 'constellation': return settings.constellations && lv[2] > 0.3 ? 1 : 0;
    case 'region': case 'marker': {
      const vd = e.viewDistance || (e.radius > 0 ? e.radius * 2.5 : PC);
      return sm(0.01 * vd, 0.05 * vd, d) * (1 - sm(30 * vd, 80 * vd, d));
    }
    default: return disc >= 2 ? 1 : 0;
  }
}

export function initLabels(ctx) {
  const { app } = ctx;
  const layer = el('div', { class: 'os-labels', role: 'group', 'aria-label': 'Objects in view' });
  const free = [], active = new Map(); // id → node
  for (let i = 0; i < MAX; i++) {
    const b = el('button', { type: 'button', class: 'os-label', tabindex: '-1', 'aria-hidden': 'true' }, el('span', { class: 'tx' }));
    b._tx = b.firstChild;
    b.addEventListener('click', () => ctx.pickEntry(b._entry));
    b.addEventListener('focus', () => { if (b._entry) b.setAttribute('aria-label', `${b._entry.name}, ${formatDistance(b._d || 0)} away`); });
    layer.append(b); free.push(b);
  }

  let cands = [], dirty = true, rebuildT = 0;
  const rebuild = () => {
    dirty = false;
    cands = app.registry.all().filter((e) => e.name).map((e) => ({ e, x: 0, y: 0, z: 0, d: 0, disc: 0, a: 0, vis: false, pick: false, score: 0 }));
  };
  app.registry.addEventListener('add', () => { dirty = true; clearTimeout(rebuildT); rebuildT = setTimeout(rebuild, 200); });

  const pos = new Float64Array(3);
  const R = new THREE.Vector3(), U = new THREE.Vector3(), F = new THREE.Vector3();
  const grid = new Set();
  let lastLayout = 0, lastOrder = 0, placed = [], maxDisc = 0; // maxDisc: biggest solid disc last pass (px), drives crowding
  // Screen rects of the opaque UI panels; labels underneath them are dropped.
  let panels = [], lastPanels = 0;
  const underPanel = (x, y) => panels.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);

  function layout(f, now) {
    if (now - lastLayout < 33) return;
    lastLayout = now;
    if (dirty) rebuild();
    const { cssW: W, cssH: H } = f.viewport, q = f.camQuat, cam = f.camPos;
    R.set(1, 0, 0).applyQuaternion(q); U.set(0, 1, 0).applyQuaternion(q); F.set(0, 0, -1).applyQuaternion(q);
    const tanY = Math.tan((f.fovY * Math.PI) / 360), tanX = (tanY * W) / H;
    const scale = app.settings.labelScale || 1;
    const vis = [], discs = [];
    const focus = f.focus;
    const crowd = crowding(maxDisc); let md = 0;
    if (now - lastPanels > 250) {
      lastPanels = now;
      panels = [...document.querySelectorAll('#ui .os-glass')].filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect());
    }
    for (let n = 0; n < cands.length; n++) {
      const c = cands[n], e = c.e;
      c.vis = false; c.pick = false;
      e.position(f.jd, pos);
      const dx = pos[0] - cam[0], dy = pos[1] - cam[1], dz = pos[2] - cam[2];
      const z = dx * F.x + dy * F.y + dz * F.z;
      if (z <= 0) continue;
      const nx = (dx * R.x + dy * R.y + dz * R.z) / (z * tanX), ny = (dx * U.x + dy * U.y + dz * U.z) / (z * tanY);
      if (nx < -1.05 || nx > 1.05 || ny < -1.05 || ny > 1.05) continue;
      c.x = (nx * 0.5 + 0.5) * W; c.y = (-ny * 0.5 + 0.5) * H; c.z = z;
      c.d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      c.disc = e.radius > 0 ? (e.radius * H) / (z * tanY) : 0;
      if (c.disc > 6 && e.radius < 1e10) { discs.push(c); if (e.type !== 'star' && c.disc > md) md = c.disc; } // solid bodies only, not regions
      let a = e === focus ? 1 : labelAlpha(e, c.d, c.disc, f, app.settings, crowd);
      if (c.disc > 40) a *= 1 - sm(40, 80, c.disc);
      c.a = a;
      c.pick = (a >= 0.25 || c.disc >= 3) && c.x >= 0 && c.x <= W && c.y >= 0 && c.y <= H;
      c.vis = a > 0.05 && !underPanel(c.x, c.y) && c.x > -40 && c.x < W + 40 && c.y > -10 && c.y < H + 10;
      if (c.vis) { c.score = (e === focus ? 1e9 : 0) + (e.priority || 0) * 1e6 - Math.log10(c.d + 1) * 1e3; vis.push(c); }
    }
    maxDisc = md;
    // Hide labels for things behind a visible disc (a star label must not sit on Earth's face).
    if (discs.length) {
      for (let n = vis.length - 1; n >= 0; n--) {
        const c = vis[n];
        for (const b of discs) {
          if (b === c || c.d <= b.d) continue;
          const dx = c.x - b.x, dy = c.y - b.y, r = b.disc / 2;
          if (dx * dx + dy * dy < r * r) { vis.splice(n, 1); c.vis = false; c.pick = false; break; }
        }
      }
    }
    vis.sort((a, b) => b.score - a.score);
    grid.clear(); placed = [];
    for (let n = 0; n < vis.length && placed.length < MAX; n++) {
      const c = vis[n], isF = c.e === focus;
      const ox = (c.disc > 4 ? Math.min(c.disc * 0.5, 40) : 0) + 4;
      const w = (c.e.name.length * 6.6 + 24) * scale, h = 22 * scale;
      const x0 = c.x + ox, y0 = c.y - h / 2;
      const gx0 = Math.floor(x0 / GRID), gx1 = Math.floor((x0 + w) / GRID), gy0 = Math.floor(y0 / GRID), gy1 = Math.floor((y0 + h) / GRID);
      // Backdrop labels must sit wholly on screen: a label chopped by the viewport edge ("hal") reads as a glitch.
      let hit = !isF && (x0 < 6 || x0 + w > W - 6 || y0 < 4 || y0 + h > H - 4);
      if (!hit) hit = !isF && panels.some((r) => x0 < r.right && x0 + w > r.left && y0 < r.bottom && y0 + h > r.top);
      if (!isF && !hit) for (let gx = gx0; gx <= gx1 && !hit; gx++) for (let gy = gy0; gy <= gy1; gy++) if (grid.has((gx + 20) * 4096 + gy + 20)) { hit = true; break; }
      if (hit) continue;
      for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) grid.add((gx + 20) * 4096 + gy + 20);
      c.ox = ox; placed.push(c);
    }
    if (app.settings.labels === false) { render([], now); return; }
    render(placed, now);
  }

  function render(list, now) {
    for (const n of active.values()) n._seen = false;
    for (const c of list) {
      const id = c.e.id;
      let node = active.get(id);
      if (!node) {
        node = free.pop();
        if (!node) { // steal a fading node
          for (const [k, v] of active) if (!v._seen) { node = v; active.delete(k); break; }
          if (!node) continue;
        }
        node._entry = c.e; node._tx.textContent = c.e.name; node._fade = 0;
        node.removeAttribute('aria-label');
        active.set(id, node);
      }
      node._seen = true; node._d = c.d; node._unseen = 0;
      node.classList.add('on');
      const tgt = Math.max(0.01, c.a).toFixed(2);
      if (node._op !== tgt) { node.style.opacity = tgt; node._op = tgt; }
      node.style.transform = `translate(${Math.round(c.x + c.ox)}px,${Math.round(c.y)}px) translateY(-50%)`;
      const isF = c.e === app.camera.focus;
      if (node._f !== isF) { node.classList.toggle('is-focus', isF); node._f = isF; }
      const tab = c.a > 0.5 ? '0' : '-1';
      if (node._tab !== tab) { node.tabIndex = +tab; if (tab === '0') node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', 'true'); node._tab = tab; }
    }
    for (const [k, node] of active) {
      if (node._seen) continue;
      if (!node._unseen) { node._unseen = now; node.style.opacity = '0'; node._op = '0'; node.tabIndex = -1; node._tab = '-1'; node.setAttribute('aria-hidden', 'true'); }
      else if (now - node._unseen > 350 && document.activeElement !== node) {
        node.classList.remove('on'); node._entry = null; node._unseen = 0; node._f = false; node.classList.remove('is-focus');
        active.delete(k); free.push(node);
      }
    }
    // Tab order = nearest first. Only reshuffle when focus is not inside the layer.
    if (now - lastOrder > 600 && !layer.contains(document.activeElement)) {
      lastOrder = now;
      const nodes = [...active.values()].filter((n) => n._seen).sort((a, b) => a._d - b._d);
      let same = true; const kids = layer.children;
      for (let i = 0; i < nodes.length; i++) if (kids[kids.length - nodes.length + i] !== nodes[i]) { same = false; break; }
      if (!same) layer.append(...nodes);
    }
  }

  return {
    layer, layout,
    // Nearest label/projected entry to a CSS-px point (hit radius ≥ 16 px, larger for big discs).
    pickAt(x, y) {
      let best = null, bs = Infinity;
      for (const c of cands) {
        if (!c.pick) continue;
        const dist = Math.hypot(c.x - x, c.y - y), r = Math.max(16, c.disc / 2 + 6);
        if (dist > r) continue;
        const s = dist - c.disc / 2 - (c.e.priority || 0) * 0.05;
        if (s < bs) { bs = s; best = c.e; }
      }
      return best;
    },
    // Names of the nearest labelled objects in view (for the accessible description).
    nearestNames(n = 6, skip = null) { return placed.filter((c) => c.e !== skip).sort((a, b) => a.d - b.d).slice(0, n).map((c) => c.e.name); },
    get count() { return placed.length; },
    get poolSize() { return layer.children.length; },
  };
}
