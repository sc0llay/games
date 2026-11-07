// Tiny DOM helpers and inline SVG icons (no network, no icon font).
export function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const P = {
  fly: '<path d="M3 11l18-8-8 18-2-8z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  tours: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>',
  measure: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  photo: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  hide: '<path d="M3 3l18 18M10.6 6.2A9 9 0 0 1 21 12a14 14 0 0 1-3 3.8M6.5 7.5A14 14 0 0 0 3 12s3.5 6 9 6c1.4 0 2.7-.4 3.8-.9"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  rev: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  slower: '<path d="M17 6l-6 6 6 6M11 6l-6 6 6 6"/>',
  faster: '<path d="M7 6l6 6-6 6M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
};
export function icon(name) {
  const s = document.createElement('span');
  s.className = 'os-ico'; s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return s;
}
export const iconButton = (name, label, onclick, extra = {}) =>
  el('button', { type: 'button', class: 'os-btn os-ib', title: label, 'aria-label': label, onclick, ...extra }, icon(name));
