import { vdist } from 'orion/core/units.js';

// Every named, focusable, searchable object. See CONTRACT.md "Registry entry".
export class Registry extends EventTarget {
  constructor() { super(); this.map = new Map(); this._tmp = new Float64Array(3); }
  add(entry) {
    if (!entry.id || typeof entry.position !== 'function') throw new Error(`registry: bad entry ${entry.id}`);
    entry.radius ??= 0;
    entry.priority ??= 0;
    entry.aliases ??= [];
    entry.info ??= {};
    this.map.set(entry.id, entry);
    this.dispatchEvent(new CustomEvent('add', { detail: entry }));
    return entry;
  }
  addMany(entries) { for (const e of entries) this.add(e); }
  get(id) { return this.map.get(id); }
  has(id) { return this.map.has(id); }
  all() { return [...this.map.values()]; }
  byType(type) { return this.all().filter((e) => e.type === type); }
  children(id) { return this.all().filter((e) => e.parent === id); }
  // Ancestors from the root down, ending with the entry itself.
  path(id) {
    const out = []; let e = this.get(id);
    while (e) { out.unshift(e); e = e.parent ? this.get(e.parent) : null; }
    return out;
  }
  // Nearest entry surface to a world point; only entries with a physical radius or type 'star'.
  nearest(pos, jd, filter = null) {
    let best = null, bestD = Infinity;
    for (const e of this.map.values()) {
      if (filter && !filter(e)) continue;
      if (!(e.radius > 0) && e.type !== 'star') continue;
      const d = vdist(pos, e.position(jd, this._tmp)) - e.radius;
      // An entry that contains the camera (the galaxy, a region) is context, not the nearest surface;
      // a solid body's mean sphere can sit above its real (oblate) surface, so there it just clamps.
      if (d < 0) { if (!e.solid) continue; bestD = 0; best = e; break; }
      if (d < bestD) { bestD = d; best = e; }
    }
    return { entry: best, distance: bestD };
  }
}
