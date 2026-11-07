// Star colour (spec §08): B–V → effective temperature (Ballesteros 2012) → linear sRGB by integrating the
// Planck spectrum against CIE 1931 2° colour-matching functions (Wyman, Sloan & Shirley 2013 multi-lobe fit),
// D65 white point. Pure maths, no three.js, so it runs under the jsc test harness.
//
// Colours are returned at unit luminance (Y = 1): the star's brightness is carried separately by its flux.

export const T_MIN = 1000, T_MAX = 40000;

// Ballesteros 2012: T = 4600 (1/(0.92 (B−V) + 1.7) + 1/(0.92 (B−V) + 0.62)).
export function bvToTeff(bv) {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

const lobe = (l, mu, s1, s2) => { const t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
export function cmf(l) { // nm → [x̄, ȳ, z̄]
  return [
    1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
    0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
    1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
  ];
}

const HC_K = 1.438776877e7; // h c / k_B in nm·K
export function planckXYZ(T) {
  let X = 0, Y = 0, Z = 0;
  for (let l = 360; l <= 830; l += 5) {
    const b = 1 / (Math.pow(l, 5) * (Math.exp(HC_K / (l * T)) - 1));
    const [x, y, z] = cmf(l);
    X += b * x; Y += b * y; Z += b * z;
  }
  return [X, Y, Z];
}

// XYZ → linear sRGB (D65), normalised to Y = 1; out-of-gamut channels clipped then renormalised.
export function xyzToLinearRGB(X, Y, Z, out = [0, 0, 0]) {
  let r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  let g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  let b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  r = Math.max(r, 0); g = Math.max(g, 0); b = Math.max(b, 0);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b || 1;
  out[0] = r / lum; out[1] = g / lum; out[2] = b / lum;
  return out;
}

export function teffToRGB(T, out = [0, 0, 0]) {
  const [X, Y, Z] = planckXYZ(Math.min(Math.max(T, T_MIN), T_MAX));
  return xyzToLinearRGB(X, Y, Z, out);
}
export const bvToRGB = (bv, out) => teffToRGB(bvToTeff(bv), out);

// 1D LUT sampled uniformly in log T between T_MIN and T_MAX. Float32 RGBA, `size` texels.
export function buildColourLUT(size = 1024) {
  const data = new Float32Array(size * 4), rgb = [0, 0, 0];
  const l0 = Math.log(T_MIN), l1 = Math.log(T_MAX);
  for (let i = 0; i < size; i++) {
    teffToRGB(Math.exp(l0 + (l1 - l0) * (i / (size - 1))), rgb);
    data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 1;
  }
  return data;
}

// Stellar radius (solar radii) from absolute magnitude and temperature (Stefan–Boltzmann).
export function starRadiusSolar(absMag, T) {
  const L = Math.pow(10, -0.4 * (absMag - 4.74));
  return Math.min(3000, Math.max(0.005, Math.sqrt(L) * Math.pow(5772 / Math.max(T, 1500), 2)));
}
