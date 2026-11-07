// Search index + fuzzy scoring. Pure, allocation-light: a linear scan over 5k–20k names takes ~1–3 ms.
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^\p{L}\p{N}\s+.'-]/gu, ' ').replace(/\s+/g, ' ').trim();

function within1(a, b) { // Levenshtein distance ≤ 1
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0; while (i < la && i < lb && a[i] === b[i]) i++;
  if (i === la && i === lb) return true;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
function wordPrefix(s, q) {
  let i = s.indexOf(q);
  while (i > 0) { const c = s[i - 1]; if (c === ' ' || c === '-') return i; i = s.indexOf(q, i + 1); }
  return -1;
}
function subsequence(s, q) { // → span of the match, or -1
  let j = 0, first = -1, last = -1;
  for (let i = 0; i < s.length && j < q.length; i++) if (s[i] === q[j]) { if (first < 0) first = i; last = i; j++; }
  return j === q.length ? last - first + 1 - q.length : -1;
}
export function scoreKey(q, s) {
  if (!q || !s) return 0;
  if (s === q) return 1000;
  if (s.startsWith(q)) return 900 - Math.min(s.length - q.length, 80) * 0.5;
  const w = wordPrefix(s, q); if (w > 0) return 800 - w * 0.2;
  const i = s.indexOf(q); if (i >= 0) return 700 - i * 0.5;
  if (q.length >= 4 && within1(q, s.slice(0, q.length))) return 560;
  if (q.length >= 3) { const g = subsequence(s, q); if (g >= 0 && g <= q.length * 2) return 400 - g * 6; }
  return 0;
}
// Multi-word queries: every token must match somewhere in the key.
function scoreQuery(tokens, q, s) {
  if (tokens.length === 1) return scoreKey(q, s);
  const whole = scoreKey(q, s); if (whole >= 700) return whole;
  let sum = 0;
  for (const t of tokens) { const k = scoreKey(t, s); if (!k) return 0; sum += k; }
  return (sum / tokens.length) * 0.9;
}

const PENALTY = { name: 0, alias: 15, id: 30 };
// Everyday names the catalogues don't carry (id → aliases). Merged with each entry's own aliases.
export const COMMON_ALIASES = {
  sirius: ['Dog Star'], polaris: ['North Star', 'Pole Star', 'Pole Star'], earth: ['Terra', 'Home', 'Blue Marble'], sun: ['Sol', 'Our Star'],
  'milky-way': ['Galaxy', 'Our Galaxy'], 'orion-spur': ['Local Arm', 'Orion Arm'], 'galactic-centre': ['Galactic Center', 'Galactic Core'],
  'sgr-a-star': ['Sagittarius A*', 'Sgr A*', 'Black Hole'], moon: ['Luna', 'Selene'], mars: ['Red Planet'], jupiter: ['Jove'], venus: ['Morning Star', 'Evening Star'],
  'solar-system': ['Sol System'], betelgeuse: ['Betelgeuze'], 'alpha-centauri-a': ['Rigil Kentaurus', 'Toliman', 'Closest Star'], 'proxima-centauri': ['Closest Star'],
};
export function buildIndex(entries) {
  const out = [];
  for (const e of entries) {
    if (!e || !e.name) continue;
    const keys = [{ s: norm(e.name), p: PENALTY.name }];
    for (const a of [...(e.aliases || []), ...(COMMON_ALIASES[e.id] || [])]) { const s = norm(a); if (s) keys.push({ s, p: PENALTY.alias }); }
    if (e.id) { const s = norm(String(e.id).replace(/-/g, ' ')); if (s && s !== keys[0].s) keys.push({ s, p: PENALTY.id }); }
    out.push({ e, keys, pri: e.priority || 0 });
  }
  return out;
}
export function search(index, query, limit = 40) {
  const q = norm(query); if (!q) return [];
  const tokens = q.split(' ');
  const hits = [];
  for (let n = 0; n < index.length; n++) {
    const it = index[n]; let best = 0;
    for (let k = 0; k < it.keys.length; k++) {
      const sc = scoreQuery(tokens, q, it.keys[k].s); if (sc <= 0) continue;
      const v = sc - it.keys[k].p; if (v > best) best = v;
    }
    if (best > 0) hits.push({ e: it.e, score: best, pri: it.pri });
  }
  hits.sort((a, b) => b.score - a.score || b.pri - a.pri || a.e.name.length - b.e.name.length);
  return hits.length > limit ? hits.slice(0, limit) : hits;
}
