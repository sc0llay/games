// GLSL for the catalogue-star layer (spec §08). Sky layer units are parsecs; the camera sits at the origin.

// Energy-conserving point-spread function. A magnitude-0 star has a PSF peak of 3 sky units (CONTRACT); the
// integrated energy of a star is 6π σ0² · flux (σ0 = uSigma0 px). Bright stars widen the Gaussian core (s ≥ 1) and
// lower its peak by 1/s² so the integral is preserved; 4 % of the energy goes into a wide faint halo (7× core σ).
export const STAR_VERT = /* glsl */ `
attribute float aAbsMag;
attribute float aBV;
attribute float aShell;
uniform sampler2D tLut;
uniform float uSigma0, uGain, uLevel, uSunFade, uShellFade, uNearIdx, uNearFade, uLimit;
varying vec3 vColor;
varying float vPeakC, vPeakH, vSigC, vSigH, vHalf;

const float LOG10 = 0.30102999566;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(length(mv.xyz), 1e-9);
  float vis = uLevel * step(mv.z, -1e-9);
  if (gl_VertexID == 0) vis *= uSunFade;                       // the Sun is the bodies module's job up close
  if (float(gl_VertexID) == uNearIdx) vis *= 1.0 - uNearFade;  // handed over to the lit disc
  vis *= mix(1.0, uShellFade, aShell);                          // far stars projected onto the 500 pc shell

  // m = M + 5 log10(d / 10 pc); flux = 10^(-0.4 m)
  float m = max(aAbsMag + 5.0 * log2(d / 10.0) * LOG10, -18.0);
  float flux = exp2(-0.4 * m * 3.32192809);
  float peak0 = 3.0 * flux;
  vis *= smoothstep(0.5 * uLimit, 1.6 * uLimit, peak0 * uGain); // fade stars below the exposure's limiting magnitude

  float s = 1.0 + 0.55 * log2(max(peak0, 1.0)) * LOG10;
  float sigC = uSigma0 * s, sigH = 7.0 * sigC;
  float peakC = peak0 * 0.96 / (s * s) * vis;
  float peakH = peak0 * 0.04 / (s * s * 49.0) * vis;
  const float THR = 0.0015;
  float rc = sigC * sqrt(2.0 * max(log(max(peakC * uGain, 1e-12) / THR), 0.0));
  float rh = sigH * sqrt(2.0 * max(log(max(peakH * uGain, 1e-12) / THR), 0.0));
  float half_ = clamp(max(rc, rh) + 1.0, 1.0, 96.0);            // sprite is never smaller than 2 px

  if (vis < 1e-4) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 2.0 * half_;

  // B-V -> Teff (Ballesteros 2012) -> LUT of Planck x CIE 1931 (log-spaced 1000..40000 K), unit luminance
  float T = 4600.0 * (1.0 / (0.92 * aBV + 1.7) + 1.0 / (0.92 * aBV + 0.62));
  float u = clamp((log(T) - 6.907755) / (10.596635 - 6.907755), 0.0, 1.0);
  vColor = texture2D(tLut, vec2(u, 0.5)).rgb;
  vPeakC = peakC; vPeakH = peakH; vSigC = sigC; vSigH = sigH; vHalf = half_;
}`;

export const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vPeakC, vPeakH, vSigC, vSigH, vHalf;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * (2.0 * vHalf);
  float r2 = dot(p, p);
  float I = vPeakC * exp(-0.5 * r2 / (vSigC * vSigC)) + vPeakH * exp(-0.5 * r2 / (vSigH * vSigH));
  I *= 1.0 - smoothstep(0.75, 1.0, sqrt(r2) / vHalf);
  gl_FragColor = vec4(vColor * I, 1.0);
}`;

// Lit limb-darkened emissive disc for a catalogue star the camera has approached. Camera-facing quad, radius in pc.
export const DISC_VERT = /* glsl */ `
uniform float uRadius;
varying vec2 vP;
void main() {
  vP = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uRadius;
  gl_Position = projectionMatrix * mv;
}`;

export const DISC_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uBright, uEdge, uAlpha;
varying vec2 vP;
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float mu = sqrt(max(1.0 - r * r, 0.0));
  vec3 u = vec3(0.50, 0.60, 0.75);                 // limb darkening, stronger in the blue so the limb reddens
  vec3 limb = (1.0 - u * (1.0 - mu)) / (1.0 - u / 3.0);
  float edge = 1.0 - smoothstep(1.0 - uEdge, 1.0, r);
  gl_FragColor = vec4(uColor * limb * uBright * uAlpha * edge, 1.0);
}`;
