import * as THREE from 'three';
import { NOISE, HEIGHT_PACK } from 'orion/render/bodies/glsl.js';
import { SUN_TRANSMIT_GLSL } from 'orion/render/bodies/atmosphere.js';

// Surface, cloud-shell and gas-giant materials. All materials of one body share a single uniform object `U`
// (built in index.js), so one CPU update per frame drives the surface, the clouds and the atmosphere.
//   Object frame = body-fixed (+z north pole, +x prime meridian). Distances in km, camera-relative.

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uScale;
varying vec3 vDir, vPos;
void main() {
  vDir = position;
  vPos = position * uScale;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;

const HEAD = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
${HEIGHT_PACK}
uniform vec3 uScale, uSunObj, uCamObj;
uniform float uSunDist, uSunR, uIrr, uFade, uOccAtm, uDrift, uRelief, uExag, uDetail, uGasT, uHasRing, uSeed;
uniform int uGas;
uniform vec4 uOcc[4];
uniform vec4 uAnim;            // x: days since J2000
uniform vec2 uRingR, uTexel;
uniform sampler2D tColor, tData, tRing;
varying vec3 vDir, vPos;

vec2 dirToUv(vec3 d) { return vec2(atan(d.y, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.z, -1.0, 1.0)) / PI + 0.5); }

// Fraction of the Sun's flux (angular radius rs, limb-darkened I = 1 - 0.6(1 - mu)) hidden by an occluder (ro) at
// separation d. Integrated over 8 annuli: each annulus loses the arc fraction of it inside the occluder disc.
float discOv(float rs, float ro, float d) {
  if (d >= rs + ro) return 0.0;
  float occ = 0.0, tot = 0.0;
  for (int i = 0; i < 8; i++) {
    float x = (float(i) + 0.5) / 8.0, r = x * rs;
    float w = (0.4 + 0.6 * sqrt(1.0 - x * x)) * x;
    float f = ro >= d + r ? 1.0 : (r >= d + ro || d >= r + ro) ? 0.0
            : acos(clamp((d * d + r * r - ro * ro) / (2.0 * d * r), -1.0, 1.0)) / PI;
    occ += w * f; tot += w;
  }
  return occ / tot;
}
// Sunlight reaching point P (km, object frame) after every occluder; copper refracted light inside Earth's umbra.
vec3 eclipseVis(vec3 P) {
  vec3 sv = uSunObj * uSunDist - P;
  float ds = length(sv); sv /= ds;
  float rs = asin(min(uSunR / ds, 1.0));
  float vis = 1.0, cop = 0.0; vec3 tint = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 o = uOcc[i];
    if (o.w <= 0.0) continue;
    vec3 ov = o.xyz - P;
    float dO = length(ov);
    if (dO >= ds) continue;
    ov /= dO;
    float ro = asin(min(o.w / dO, 1.0));
    float sep = atan(length(cross(sv, ov)), dot(sv, ov));
    float cov = discOv(rs, ro, sep);
    vis *= 1.0 - cov;
    if (i == 0 && uOccAtm > 0.5 && cov > 0.0) {
      float x = clamp(sep / ro, 0.0, 1.0);
      float h = 8.0 + 55.0 * x * x;               // tangent altitude (km) of the ray that reaches this umbra depth
      vec3 tau = (vec3(5.8e-6, 13.56e-6, 33.1e-6) * exp(-h / 8.0) + 8.4e-6 * exp(-h / 1.2)) * 5.65e5
               + vec3(0.65e-6, 1.881e-6, 0.085e-6) * max(0.0, 1.0 - abs(h - 25.0) / 15.0) * 7.7e5;
      cop = cov; tint = exp(-tau) * 0.006;
    }
  }
  return vec3(vis) + (1.0 - vis) * cop * tint;
}
// Planetary ring shadow: transmittance along the ray to the Sun through the ring plane (object z = 0). The Sun is a disc,
// not a point: a ground point at distance t below the ring plane sees the ring's edges and gaps smeared by t * (Rsun/d)
// (the penumbra, ~tens of km at Saturn), widened to at least a pixel footprint of the shadow radius (fwidth) so the edge
// anti-aliases instead of stair-stepping where the 1-D profile texture is sampled once per pixel. 9-tap tent average of the
// ring opacity over that width; outside [inner, outer] the ring is simply absent (alpha 0), so the outer edge softens too.
float ringShadow(vec3 P) {
  if (uHasRing < 0.5) return 1.0;
  // snap the interpolated mesh position back onto the true (oblate) surface: facets sit up to ~30 km inside it, and the
  // 1/mu lever arm to the ring plane (~7x at Saturn's tilt) turned that into a pixel-period sawtooth along the shadow edge
  P = normalize(P / uScale) * uScale;
  float mu = uSunObj.z, am = max(abs(mu), 0.03);
  float t = -P.z / (abs(mu) < 1e-4 ? 1e-4 : mu);
  float r = length((P + uSunObj * max(t, 0.0)).xy);
  float fw = fwidth(r);                         // derivatives before any non-uniform return
  if (t <= 0.0 || abs(mu) < 1e-4) return 1.0;
  float w = max(t * (uSunR / uSunDist) / max(abs(mu), 0.1), 1.5 * fw);
  float span = uRingR.y - uRingR.x, a = 0.0;
  for (int k = -4; k <= 4; k++) {
    float u = (r + float(k) * 0.25 * w - uRingR.x) / span;
    a += (5.0 - abs(float(k))) * (u < 0.0 || u > 1.0 ? 0.0 : texture2D(tRing, vec2(u, 0.5)).a);
  }
  a = clamp(a / 25.0, 0.0, 0.999);
  return pow(1.0 - a, 1.0 / am);
}
#ifdef PHOTO
uniform sampler2D tNight, tClouds, tSpec, tNormal, tHeight;
uniform float uAlbScale, uUOff, uNormK;
uniform vec3 uTintA, uTintB, uFill;   // greyscale tint (dark, bright); fill colour for unimaged (zero) pixels
uniform vec2 uHTexel;
// Equirectangular lookup by direction with seam-free mip selection (gradients from whichever u parameterisation
// is continuous here). off shifts u (texture left-edge longitude / Jupiter GRS / Venus cloud drift).
vec4 sphTex(sampler2D t, vec3 d, float off) {
  vec2 uv = dirToUv(d);
  vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 a = dFdx(uv), b = dFdy(uv), c = dFdx(uvB), e = dFdy(uvB);
  bool useB = dot(a, a) + dot(b, b) > dot(c, c) + dot(e, e);
  return textureGrad(t, uv + vec2(off, 0.0), useB ? c : a, useB ? e : b);
}
vec3 photoAlb(vec4 tc) {
  #ifdef TINT
    float g = tc.r;
    vec3 a = g < 0.004 && uFill.r > 0.0 ? uFill : g * mix(uTintA, uTintB, clamp(g * 2.0, 0.0, 1.0));
  #else
    vec3 a = max(tc.r, max(tc.g, tc.b)) < 0.004 && uFill.r > 0.0 ? uFill : tc.rgb;
  #endif
  return a * uAlbScale;
}
#endif
`;

// Cloud map (data.a, baked with the zonal climate pattern) drifting over the surface, warped slowly and sharpened
// with finer fbm. Returns density 0..1.
const CLOUDS = /* glsl */ `
#ifdef PHOTO
// Photographic cloud map (Earth): drifts east of the ground (1.5 deg/h of sim time) with a bounded, latitude-dependent
// shear (a 12-day oscillation, so spiral smearing never accumulates at high time rates), sharpened, fbm break-up up close.
// u grows eastward and the lookup is at uv + off, so an eastward drift is a falling offset.
float cloudDensity(vec3 dir) {
  float lat = asin(clamp(dir.z, -1.0, 1.0));
  float drift = uAnim.x * 0.1 + 0.04 * sin(uAnim.x * 0.5236 + 2.0 * lat) * cos(3.0 * lat);
  float c = sphTex(tClouds, dir, uUOff - drift).r;
  float dens = smoothstep(0.22, 0.92, c);
  if (uDetail > 0.001) dens = clamp(dens * (1.0 + (fbm(dir * 900.0, 3) - 0.5) * 1.1 * uDetail), 0.0, 1.0);
  return dens;
}
#else
float cloudDensity(vec3 dir) {
  float c = cos(uDrift), s = sin(uDrift);
  vec3 d = vec3(c * dir.x - s * dir.y, s * dir.x + c * dir.y, dir.z);
  float tm = uAnim.x * 0.004;
  vec3 w = vec3(fbm(d * 6.0 + vec3(1.7, 0.0, tm), 3), fbm(d * 6.0 + vec3(8.3, tm, 0.0), 3), fbm(d * 6.0 + vec3(0.0, 4.1, tm), 3)) - 0.5;
  vec3 q = d * 12.0;
  float cov = textureLod(tData, dirToUv(d), 4.5).a;     // blurred regional coverage from the baked map
  float n = fbm(q + w * 3.2, 6);
  float thr = 0.7 - 0.28 * cov;
  float dens = smoothstep(thr - 0.06, thr + 0.16, n);
  return dens * (0.75 + 0.5 * fbm(d * 60.0, 2));
}
#endif
`;

// ---- GLSL for the textured (rock / Earth) surface -------------------------------------------------------------
const ROCK_MAIN = /* glsl */ `
void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  vec2 uv0 = dirToUv(dir);
  vec2 uvB = vec2(fract(uv0.x + 0.5) - 0.5, uv0.y);
  vec2 dx0 = dFdx(uv0), dy0 = dFdy(uv0), dx1 = dFdx(uvB), dy1 = dFdy(uvB);
  bool useB = dot(dx0, dx0) + dot(dy0, dy0) > dot(dx1, dx1) + dot(dy1, dy1);
  vec2 gx = useB ? dx1 : dx0, gy = useB ? dy1 : dy0;

  vec3 nE = normalize(vPos / (uScale * uScale));
  vec3 V = normalize(uCamObj - vPos);
  vec3 L = uSunObj;
#ifdef PHOTO
  vec2 uvP = uv0 + vec2(uUOff, 0.0);
  vec4 tc = textureGrad(tColor, uvP, gx, gy);
  vec3 alb = photoAlb(tc);
#else
  vec4 tc = textureGrad(tColor, uv0, gx, gy);
  vec4 td = textureGrad(tData, uv0, gx, gy);
  vec3 alb = tc.rgb;
  float h0 = unpackH(td.rg);
#endif

  // Relief: normal from the height field (x2 below 10,000 km altitude for Earth) plus close-range detail.
  float alt = length(uCamObj) - uScale.x;
  float exag = mix(uExag, 1.0, smoothstep(10000.0, 14000.0, alt));
  vec3 east = normalize(cross(vec3(0.0, 0.0, 1.0), nE) + vec3(1e-6, 0.0, 0.0));
  vec3 north = cross(nE, east);
#if defined(PHOTO_H)
  // measured relief (LOLA / MOLA), heights in km
  float dl = 6.2832 * uHTexel.x * 0.75;
  vec2 hoff = vec2(uUOff, 0.0);
  float h0 = textureGrad(tHeight, uvP, gx, gy).r;
  float hE = textureGrad(tHeight, dirToUv(normalize(dir + east * dl)) + hoff, gx, gy).r;
  float hN = textureGrad(tHeight, dirToUv(normalize(dir + north * dl)) + hoff, gx, gy).r;
  float k = exag / uScale.x / dl;
  vec3 n = nE - k * (hE - h0) * east - k * (hN - h0) * north;
#elif defined(PHOTO) && defined(EARTH)
  vec3 tn = textureGrad(tNormal, uvP, gx, gy).xyz * 2.0 - 1.0;
  vec3 n = nE + (east * tn.x + north * tn.y) * uNormK * exag;
#elif defined(PHOTO)
  vec3 n = nE;
#else
  float dl = 6.2832 * uTexel.x * 0.75;
  float hE = unpackH(textureGrad(tData, dirToUv(normalize(dir + east * dl)), gx, gy).rg);
  float hN = unpackH(textureGrad(tData, dirToUv(normalize(dir + north * dl)), gx, gy).rg);
  float k = uRelief * exag / uScale.x / dl;
  vec3 n = nE - k * (hE - h0) * east - k * (hN - h0) * north;
#endif
  if (uDetail > 0.001) {
    vec3 q = vPos * (1.0 / 0.35);
    float b0 = fbm(q, 3), bx = fbm(q + vec3(0.12, 0.0, 0.0), 3), by = fbm(q + vec3(0.0, 0.12, 0.0), 3), bz = fbm(q + vec3(0.0, 0.0, 0.12), 3);
    vec3 g = vec3(bx - b0, by - b0, bz - b0) / 0.12;
    g -= nE * dot(g, nE);
    n -= g * 0.045 * uDetail;
    alb *= 1.0 + (b0 - 0.5) * 0.35 * uDetail;
  }
  n = normalize(n);

  float NLg = dot(nE, L);
  float NL = max(dot(n, L), 0.0), NV = max(dot(n, V), 1e-3);
  float soft = smoothstep(-0.02, 0.12, NLg);
  vec3 eclV = eclipseVis(vPos);
  vec3 sun = vec3(uIrr) * eclV * ringShadow(vPos);
  #ifdef ATMO
    sun *= sunTransmit(NLg);
  #endif
  vec3 col;
  #ifdef EARTH
  #ifdef PHOTO
    float ocean = textureGrad(tSpec, uvP, gx, gy).r;
  #else
    float ocean = tc.a;
  #endif
    float cd = cloudDensity(dir);
    // cloud shadow: sample the cloud layer where the sun ray crosses it
    vec3 cdir = normalize(nE * uScale.x + L * (9.5 / max(NLg, 0.12)));
    float cs = cloudDensity(cdir);
    float shadow = 1.0 - 0.6 * cs * smoothstep(0.0, 0.1, NLg);
    col = sun * alb * NL * soft * shadow;
    // GGX sun glint: roughness 0.06 on water, 0.8 on land (scaled by pi: 1.0 = white Lambertian)
    float rough = mix(0.8, 0.06, ocean);
    vec3 Hh = normalize(L + V);
    float NH = max(dot(nE, Hh), 0.0), nl = max(NLg, 0.0), nv = max(dot(nE, V), 1e-3);
    float a2 = rough * rough, dd = NH * NH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float G = 1.0 / ((nl + sqrt(a2 + (1.0 - a2) * nl * nl)) * (nv + sqrt(a2 + (1.0 - a2) * nv * nv)));
    float F = mix(0.04, 0.02, ocean) + (1.0 - mix(0.04, 0.02, ocean)) * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
    float spec = D * G * F * PI * nl * mix(0.15, 1.0, ocean);
    col += sun * spec * (1.0 - 0.9 * cd) * soft * shadow;
    // twilight sky light and city lights
    col += vec3(uIrr) * eclV * alb * 0.03 * exp(10.0 * min(NLg, 0.0)) * vec3(0.55, 0.62, 0.9) * smoothstep(-0.45, 0.0, NLg);
    float night = 1.0 - smoothstep(-0.12, 0.05, NLg);
  #ifdef PHOTO
    vec3 lights = max(textureGrad(tNight, uvP, gx, gy).rgb - 0.012, 0.0);
    col += lights * vec3(1.0, 0.85, 0.65) * 0.004 * night * (1.0 - 0.92 * cd);
  #else
    col += vec3(1.0, 0.68, 0.32) * td.b * 0.0025 * night * (1.0 - 0.92 * cd);
  #endif
  #else
    // Lommel-Seeliger blended with Lambert, plus an opposition surge for airless rock.
    float cosA = clamp(dot(L, V), -1.0, 1.0);
    float tanHalf = tan(acos(cosA) * 0.5);
    float surge = 1.0 + 0.55 / (1.0 + tanHalf / 0.07);
    float ls = 2.0 * NL / (NL + NV);
    float refl = mix(NL, ls, 0.6) * surge;
    #ifdef ATMO
      refl = NL;
    #endif
    col = sun * alb * refl * soft;
    #ifdef ATMO
      col += vec3(uIrr) * alb * 0.02 * exp(10.0 * min(NLg, 0.0)) * vec3(0.8, 0.6, 0.5) * smoothstep(-0.4, 0.0, NLg);
    #endif
  #endif
  gl_FragColor = vec4(col * uFade, uFade);
}`;

// ---- GLSL for gas giants and cloud-deck bodies --------------------------------------------------------------------
const GAS_MAIN = /* glsl */ `
float zonal(float lat) {   // zonal wind in rad/day relative to the body-fixed frame
  if (uGas == 0) return 0.014 * cos(7.0 * lat) + 0.006 * cos(2.5 * lat);
  if (uGas == 1) return 0.030 * cos(3.0 * lat) - 0.004;
  if (uGas == 2) return 0.006 * cos(2.0 * lat);
  if (uGas == 3) return -0.012 - 0.010 * cos(2.0 * lat);
  if (uGas == 4) return -1.30;
  return 0.020 * cos(2.0 * lat);
}
vec3 gasCol(float lon, float lat) {
  float sl = sin(lon), cl = cos(lon);
  if (uGas == 0) {          // Jupiter
    vec3 p = vec3(cl, sl, 0.0) * 2.2 + vec3(0.0, 0.0, lat * 7.0);
    vec2 q = vec2(fbm(p * 1.3 + vec3(1.0, 2.0, 3.0), 4), fbm(p * 1.3 + vec3(7.0, 5.0, 9.0), 4)) - 0.5;
    float b = 0.55 * sin((lat + 0.06 * q.x) * 11.0 + 0.3) + 0.3 * sin((lat + 0.04 * q.y) * 23.0 + 1.0) + 0.15 * sin(lat * 37.0);
    float eq = exp(-pow(lat / 0.09, 2.0));
    float zone = smoothstep(-0.25, 0.25, b + 0.25 * q.y + 0.45 * eq);
    vec3 belt = vec3(0.34, 0.19, 0.11), zn = vec3(0.80, 0.68, 0.50);
    vec3 col = mix(belt, zn, zone);
    float n = fbm(p * vec3(1.0, 1.0, 3.0) * 1.7, 6);
    col *= 0.72 + 0.56 * n;
    float n2 = fbm(vec3(cl, sl, 0.0) * 16.0 + vec3(0.0, 0.0, lat * 70.0), 5);
    col = mix(col, col * vec3(1.15, 0.88, 0.75), (n2 - 0.5) * 0.9 * (1.0 - zone));
    col = mix(col, vec3(0.26, 0.30, 0.34), smoothstep(0.95, 1.3, abs(lat)) * 0.7);
    return col;
  }
  if (uGas == 1) {          // Saturn
    vec3 p = vec3(cl, sl, 0.0) * 1.6 + vec3(0.0, 0.0, lat * 5.0);
    vec2 q = vec2(fbm(p + vec3(3.0, 1.0, 2.0), 4), fbm(p + vec3(5.0, 8.0, 1.0), 4)) - 0.5;
    float b = 0.5 * sin((lat + 0.03 * q.x) * 9.0 + 0.5) + 0.3 * sin(lat * 19.0 + 2.0) + 0.2 * sin(lat * 31.0 + 1.0);
    vec3 col = mix(vec3(0.55, 0.40, 0.21), vec3(0.78, 0.64, 0.40), smoothstep(-0.7, 0.7, b));
    col *= 0.9 + 0.2 * fbm(p * vec3(1.0, 1.0, 3.0) * 2.0, 5);
    col = mix(col, vec3(0.36, 0.42, 0.40), smoothstep(1.1, 1.45, abs(lat)) * 0.6);
    return col;
  }
  if (uGas == 2) {          // Uranus
    vec3 p = vec3(cl, sl, 0.0) + vec3(0.0, 0.0, lat * 3.0);
    float b = 0.5 + 0.5 * sin(lat * 8.0 + 1.0);
    vec3 col = vec3(0.34, 0.68, 0.74) * (0.94 + 0.12 * b);
    col *= 0.97 + 0.06 * fbm(p * 2.0, 4);
    col = mix(col, vec3(0.52, 0.82, 0.85), smoothstep(0.7, 1.3, abs(lat)) * 0.5);
    float c = smoothstep(0.78, 0.9, fbm(vec3(cl, sl, 0.0) * 5.0 + vec3(0.0, 0.0, lat * 18.0), 4)) * smoothstep(0.7, 0.35, abs(lat + 0.5));
    return mix(col, vec3(0.85, 0.92, 0.93), c * 0.45);
  }
  if (uGas == 3) {          // Neptune
    vec3 p = vec3(cl, sl, 0.0) * 1.3 + vec3(0.0, 0.0, lat * 3.5);
    float b = 0.5 + 0.5 * sin(lat * 10.0 + 0.4) * 0.6 + 0.2 * sin(lat * 23.0);
    vec3 col = vec3(0.045, 0.12, 0.52) * (0.85 + 0.3 * b) * (0.9 + 0.2 * fbm(p * 2.0, 5));
    float st = fbm(vec3(cl, sl, 0.0) * 5.0 + vec3(0.0, 0.0, lat * 45.0) + vec3(2.0, 0.0, 0.0), 4);
    float cir = smoothstep(0.64, 0.8, st) * smoothstep(1.2, 0.5, abs(lat)) * (0.4 + 0.6 * smoothstep(0.2, 0.7, abs(lat)));
    return mix(col, vec3(0.75, 0.82, 0.98), cir * 0.55);
  }
  if (uGas == 4) {          // Venus: ultraviolet-streaked cloud deck
    vec3 p = vec3(cl, sl, 0.0) * 1.2 + vec3(0.0, 0.0, lat * 4.0);
    vec2 q = vec2(fbm(p + vec3(2.0, 0.0, 1.0), 4), fbm(p + vec3(6.0, 3.0, 0.0), 4)) - 0.5;
    float n = fbm(p * vec3(1.0, 1.0, 1.6) + vec3(q * 2.2, 0.0), 5);
    vec3 col = mix(vec3(0.62, 0.50, 0.28), vec3(0.88, 0.78, 0.52), smoothstep(0.3, 0.7, n));
    float chev = 0.5 + 0.5 * sin(lat * 6.0 + 2.0 * abs(sin(lon * 0.5)) - 1.0);
    col *= 0.93 + 0.1 * chev;
    return mix(col, vec3(0.92, 0.86, 0.66), smoothstep(1.1, 1.5, abs(lat)) * 0.5);
  }
  // Titan: smooth orange haze deck, brighter southern hemisphere
  vec3 p = vec3(cl, sl, 0.0) + vec3(0.0, 0.0, lat * 2.0);
  vec3 col = vec3(0.34, 0.19, 0.065) * (1.0 + 0.12 * sin(lat * 1.0 - 0.6));
  col *= 0.95 + 0.1 * fbm(p * 1.5, 4);
  return mix(col, vec3(0.22, 0.14, 0.07), smoothstep(1.0, 1.5, lat) * 0.5);
}

float wrapLon(float a) { return mod(a + PI, 2.0 * PI) - PI; }
float hexD(vec2 p) { return max(abs(p.x), max(abs(dot(p, vec2(0.5, 0.866025))), abs(dot(p, vec2(-0.5, 0.866025))))); }
vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  vec3 nE = normalize(vPos / (uScale * uScale));
  vec3 V = normalize(uCamObj - vPos);
  float lon = atan(dir.y, dir.x), lat = asin(clamp(dir.z, -1.0, 1.0));
  float tt = uAnim.x / uGasT;
  float pA = fract(tt), pB = fract(tt + 0.5);
  float wA = abs(1.0 - 2.0 * pA);
  float w = zonal(lat);
#ifdef PHOTO
  vec3 col = photoAlb(sphTex(tColor, dir, uUOff));
#else
  vec3 col = mix(gasCol(lon - w * uGasT * pB, lat), gasCol(lon - w * uGasT * pA, lat), wA);
#endif

#ifndef PHOTO
  if (uGas == 0) {   // Great Red Spot, 22 deg S
    float dl = wrapLon(lon - 0.55), dla = lat + 0.384;
    vec2 e = vec2(dl / 0.20, dla / 0.10);
    float d = length(e);
    if (d < 2.2) {
      float ang = (1.0 - clamp(d, 0.0, 1.0)) * 3.2 + uAnim.x * 0.15;
      vec2 r = rot2(e, ang);
      float n = fbm(vec3(r * 2.5, 1.3), 4);
      vec3 red = mix(vec3(0.55, 0.17, 0.09), vec3(0.82, 0.42, 0.28), n);
      float m = 1.0 - smoothstep(0.82, 1.02, d);
      float collar = smoothstep(1.0, 1.12, d) * (1.0 - smoothstep(1.2, 1.55, d));
      col = mix(col, vec3(0.88, 0.80, 0.68), collar * 0.45);
      col = mix(col, red, m * 0.92);
      col *= 1.0 - 0.25 * smoothstep(1.0, 1.4, d) * (1.0 - smoothstep(1.6, 2.2, d)) * step(0.0, -dla + 0.0);
    }
  }
#endif
  if (uGas == 1 && lat > 1.0) {   // north polar hexagon, 78 N
    vec2 p = (PI * 0.5 - lat) * vec2(cos(lon), sin(lon));
    float hd = hexD(p);
    float edge = exp(-pow((hd - 0.205) / 0.012, 2.0));
    col *= 1.0 - 0.38 * edge;
    col = mix(col, vec3(0.30, 0.42, 0.48), (1.0 - smoothstep(0.17, 0.21, hd)) * 0.55);
    col *= 1.0 - 0.5 * exp(-pow(hd / 0.025, 2.0));
  }
#ifndef PHOTO
  if (uGas == 3) {   // Great Dark Spot and companion cloud
    vec2 e = vec2(wrapLon(lon - 1.0) / 0.22, (lat + 0.38) / 0.11);
    float d = length(e);
    col = mix(col, vec3(0.008, 0.025, 0.2), (1.0 - smoothstep(0.8, 1.1, d)) * 0.9);
    vec2 f = vec2(wrapLon(lon - 1.35) / 0.28, (lat + 0.55) / 0.05);
    col = mix(col, vec3(0.85, 0.9, 1.0), (1.0 - smoothstep(0.5, 1.0, length(f))) * 0.55);
  }

#endif
  float NLg = dot(nE, uSunObj);
  float mu = max(dot(nE, V), 0.0);
  float diff = pow(max((NLg + 0.06) / 1.06, 0.0), 1.15);
  float limb = mix(0.62, 1.0, pow(mu, 0.35));
  vec3 sun = vec3(uIrr) * eclipseVis(vPos) * ringShadow(vPos);
  gl_FragColor = vec4(col * sun * diff * limb * uFade, uFade);
}`;

// ---- cloud shell -------------------------------------------------------------------------------------------------
const CLOUD_MAIN = /* glsl */ `
void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  float dens = cloudDensity(dir);
  vec3 L = uSunObj;
  vec3 tn = L - dir * dot(L, dir);
  tn = tn / max(length(tn), 1e-4);
  float d2 = cloudDensity(normalize(dir + tn * 0.0035));
  if (dens < 0.003) discard;
  float NLg = dot(dir, L);
  vec3 eclV = eclipseVis(dir * uScale.x * 1.0015);
  vec3 sun = vec3(uIrr) * eclV * sunTransmit(NLg);
  float shade = clamp(1.0 - (d2 - dens) * 2.2, 0.5, 1.12);
  float soft = smoothstep(-0.03, 0.14, NLg);
  vec3 col = sun * vec3(0.92) * max(NLg, 0.0) * soft * shade;
  col += vec3(uIrr) * eclV * 0.03 * exp(10.0 * min(NLg, 0.0)) * vec3(0.55, 0.62, 0.9) * smoothstep(-0.45, 0.0, NLg);
  float a = clamp(dens * 0.96, 0.0, 1.0) * uFade;
  gl_FragColor = vec4(col * a, a);
}`;

/** kind: 'rock' | 'earth' | 'gas'. atmo: the body has an atmosphere whose transmittance tints sunlight. */
/** photo: null for procedural maps, or { height, tint } when photographic maps are bound in U. */
export function createSurfaceMaterial(kind, U, atmo = false, photo = null) {
  const defines = {};
  if (photo) { defines.PHOTO = 1; if (photo.height) defines.PHOTO_H = 1; if (photo.tint) defines.TINT = 1; }
  if (kind === 'earth') { defines.EARTH = 1; defines.ATMO = 1; } else if (atmo) defines.ATMO = 1;
  const body = kind === 'gas' ? GAS_MAIN : ROCK_MAIN;
  const frag = HEAD + (defines.ATMO ? SUN_TRANSMIT_GLSL : '') + (kind === 'earth' ? CLOUDS : '') + body;
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag, uniforms: U, defines,
    blending: THREE.NoBlending, transparent: false, depthWrite: true, depthTest: true,
  });
}

export function createCloudMaterial(U, photo = false) {
  return new THREE.ShaderMaterial({
    defines: photo ? { PHOTO: 1 } : {},
    vertexShader: VERT, fragmentShader: HEAD + SUN_TRANSMIT_GLSL + CLOUDS + CLOUD_MAIN, uniforms: U,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---- photographic Phobos on render/small's rock mesh ------------------------------------------------------------
// render/small draws Phobos as an irregular mesh (x toward Mars = IAU longitude 0, z north) and writes uSunDir/uSunE
// into its material each frame. This material reuses those uniform objects and that vertex shader, and maps the
// Viking/MEX mosaic by planetocentric direction.
const PHOBOS_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir; uniform float uSunE, uAlbScale, uUOff;
uniform sampler2D tColor;
varying vec3 vObj, vN, vWorld;
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vObj);
  vec2 uv = vec2(atan(d.y, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.z, -1.0, 1.0)) / PI + 0.5);
  vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 a = dFdx(uv), b = dFdy(uv), c = dFdx(uvB), e = dFdy(uvB);
  bool useB = dot(a, a) + dot(b, b) > dot(c, c) + dot(e, e);
  float g = textureGrad(tColor, uv + vec2(uUOff, 0.0), useB ? c : a, useB ? e : b).r;
  vec3 alb = g * uAlbScale * vec3(1.0, 0.96, 0.9);
  vec3 N = normalize(vN), L = normalize(uSunDir), V = normalize(-vWorld);
  float mu0 = max(dot(N, L), 0.0), mu = max(dot(N, V), 0.02);
  float ls = 2.0 * mu0 / (mu0 + mu + 1e-4) * step(0.0001, mu0) * 0.5 + 0.5 * mu0;
  gl_FragColor = vec4(alb * ls * uSunE, 1.0);
}`;

export function createPhobosMaterial(base, tex, entry) {
  return new THREE.ShaderMaterial({
    vertexShader: base.vertexShader, fragmentShader: PHOBOS_FRAG,
    uniforms: {
      ...base.uniforms,
      tColor: { value: tex }, uAlbScale: { value: entry.scale ?? 1 }, uUOff: { value: -0.5 - (entry.lon0 ?? -180) / 360 },
    },
  });
}
