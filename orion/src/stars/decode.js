// hyg.bin decoder (CONTRACT "Shared data files"): 16-byte header { uint32 count, uint32 version, float32 rangePc,
// uint32 reserved } then 8 bytes/star { int16 x, y, z (ecliptic J2000, ±rangePc), uint8 absMag, uint8 bv }.
// Pure (no three.js) so it can be unit-tested under jsc.

export function decodeHyg(buffer) {
  const dv = new DataView(buffer);
  const count = dv.getUint32(0, true), version = dv.getUint32(4, true), rangePc = dv.getFloat32(8, true);
  if (version !== 1) throw new Error(`hyg.bin: unsupported version ${version}`);
  if (buffer.byteLength < 16 + count * 8) throw new Error('hyg.bin: truncated');
  const k = rangePc / 32767;
  const pos = new Float64Array(count * 3);   // parsecs, heliocentric ecliptic J2000
  const absMag = new Float32Array(count);
  const bv = new Float32Array(count);
  let o = 16;
  for (let i = 0; i < count; i++, o += 8) {
    pos[i * 3] = dv.getInt16(o, true) * k;
    pos[i * 3 + 1] = dv.getInt16(o + 2, true) * k;
    pos[i * 3 + 2] = dv.getInt16(o + 4, true) * k;
    absMag[i] = dv.getUint8(o + 6) / 10 - 10;
    bv[i] = dv.getUint8(o + 7) / 100 - 0.5;
  }
  return { count, rangePc, pos, absMag, bv };
}

// Apparent magnitude of star i seen from a camera at (cx, cy, cz) parsecs.
export function apparentMag(cat, i, cx, cy, cz) {
  const dx = cat.pos[i * 3] - cx, dy = cat.pos[i * 3 + 1] - cy, dz = cat.pos[i * 3 + 2] - cz;
  const d = Math.max(Math.hypot(dx, dy, dz), 1e-9);
  return cat.absMag[i] + 5 * Math.log10(d / 10);
}

// Short generated description for a named star (used for registry info).
const CLASS_WORD = { O: 'hot blue', B: 'blue-white', A: 'white', F: 'yellow-white', G: 'yellow', K: 'orange', M: 'red', W: 'Wolf-Rayet', C: 'carbon', S: 'cool S-type', D: 'white dwarf' };
export function describeStar(s, conName, distLy) {
  const sp = (s.spect || '').trim();
  const letter = sp[0] || '';
  let kind = 'star';
  const rest = sp.replace(/^[OBAFGKMWCSD][0-9.]*/, '').replace(/^[:\s]+/, '');
  const lum = /^(0|Ia|Ib|I(?![IV]))/.test(rest) ? 'supergiant' : /^II(?!I)/.test(rest) ? 'bright giant' : /^III/.test(rest) ? 'giant' : /^IV/.test(rest) ? 'subgiant' : /^V/.test(rest) ? 'main-sequence star' : '';
  if (letter === 'D') kind = 'white dwarf';
  else if (lum) kind = lum;
  const word = CLASS_WORD[letter] || '';
  const L = Math.pow(10, -0.4 * (s.absmag - 4.74));
  const lumTxt = L >= 10 ? `${Math.round(L).toLocaleString('en-GB')} times` : L >= 0.1 ? `${L.toFixed(1)} times` : `${L.toPrecision(2)} times`;
  const dTxt = distLy < 100 ? distLy.toFixed(1) : Math.round(distLy).toLocaleString('en-GB');
  const art = /^[aeiou]/i.test(word || kind) ? 'An' : 'A';
  return `${art} ${word ? word + ' ' : ''}${kind}${conName ? ' in ' + conName : ''}, ${dTxt} light-years from the Sun, shining at ${lumTxt} the Sun's luminosity. Apparent magnitude ${s.mag.toFixed(2)}${sp ? `, spectral type ${sp}` : ''}.`;
}
