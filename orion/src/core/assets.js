// Asset access that works the same in dev (fetch from disk) and in the single-file build
// (base64 blobs embedded by tools/build.py into window.__ORION_ASSETS__).
const embedded = () => globalThis.__ORION_ASSETS__ || null;

const b64ToBytes = (b64) => {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const assets = {
  // path is relative to the project root, e.g. 'data/hyg.bin'. Resolves null if missing.
  async buffer(path) {
    const e = embedded();
    if (e) {
      const v = e[path];
      if (!v) return null;
      if (!v.startsWith('gz:')) return b64ToBytes(v).buffer;
      const stream = new Blob([b64ToBytes(v.slice(3))]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    }
    try { const r = await fetch(path); return r.ok ? await r.arrayBuffer() : null; } catch { return null; }
  },
  async text(path) {
    const b = await this.buffer(path);
    return b ? new TextDecoder().decode(b) : null;
  },
  async json(path) { const t = await this.text(path); return t ? JSON.parse(t) : null; },
  // Workers must be self-contained (no imports). Returns a URL usable with new Worker(url).
  workerURL(path) {
    const e = embedded();
    if (!e) return path;
    if (!e[path]) throw new Error(`asset missing: ${path}`);
    return URL.createObjectURL(new Blob([b64ToBytes(e[path])], { type: 'text/javascript' }));
  },
};
