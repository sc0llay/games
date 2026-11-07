import * as THREE from 'three';
import { NOISE, HEIGHT_PACK, SPHERE_MATH } from 'orion/render/bodies/glsl.js';
import { decodeLandMask, LAND_W, LAND_H } from 'orion/render/bodies/landmask.js';

// Procedural equirectangular surface maps, rendered once on the GPU into render targets.
//   colour: sRGB8 albedo (rgb) + a = style-specific (Earth: ocean mask)
//   data:   r,g = 16-bit packed height, b = style-specific (Earth: city lights), a = style-specific (Earth: clouds)
// Real coarse data is embedded where it matters (Earth land/ocean from Natural Earth, Moon maria positions).

const FRAG_HEAD = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tLand;
uniform int uPass;
uniform vec3 uColA, uColB;
uniform vec3 uParams; // x crater density, y patchiness, z seed
${SPHERE_MATH}
${NOISE}
${HEIGHT_PACK}

float gbox(vec2 ll, vec4 b, float soft) {
  return smoothstep(b.x - soft, b.x + soft, ll.x) * (1.0 - smoothstep(b.y - soft, b.y + soft, ll.x))
       * smoothstep(b.z - soft, b.z + soft, ll.y) * (1.0 - smoothstep(b.w - soft, b.w + soft, ll.y));
}
// Elliptical distance (1 at the rim) from a feature at (lat0, lon0) with angular semi-axes (ra along lon, rb along lat), degrees.
float gell(vec2 ll, vec4 e) {
  float dl = mod(ll.x - e.y + 180.0, 360.0) - 180.0;
  float dx = dl * cos(radians(e.x)), dy = ll.y - e.x;
  return length(vec2(dx / e.z, dy / e.w));
}
// Cratered terrain: x = signed height (bowl negative, rim positive), y = bright ejecta.
vec2 craterLayer(vec3 p, float seed, float dens) {
  vec3 ip = floor(p); float h = 0.0, ej = 0.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 g = ip + vec3(float(i), float(j), float(k));
    vec3 r = hash33(g + seed);
    if (r.z > dens) continue;
    vec3 c = g + 0.15 + 0.7 * fract(r * vec3(7.31, 13.17, 5.71));
    float rad = mix(0.16, 0.5, r.x * r.x);
    float x = length(p - c) / rad;
    if (x > 2.6) continue;
    float bowl = x < 1.0 ? -(1.0 - x * x) : 0.0;
    float rim = exp(-pow((x - 1.0) * 4.5, 2.0)) * 0.35;
    float ejc = x > 1.0 ? exp(-(x - 1.0) * 2.2) : 0.0;
    float fresh = fract(r.y * 11.3);
    h += (bowl + rim) * rad * 2.0;
    ej += ejc * fresh * fresh * 0.7 + (x < 1.0 ? 0.25 * fresh : 0.0);
  }
  return vec2(h, ej);
}
vec2 craterField(vec3 d, float dens, float scale) {
  vec2 c = vec2(0.0);
  c += craterLayer(d * 5.0 * scale, 1.0, dens) * 0.9;
  c += craterLayer(d * 12.0 * scale, 2.0, dens) * 0.6;
  c += craterLayer(d * 29.0 * scale, 3.0, dens) * 0.4;
  c += craterLayer(d * 70.0 * scale, 4.0, dens) * 0.25;
  c += craterLayer(d * 170.0 * scale, 5.0, dens) * 0.15;
  return c;
}
// Sparse dark discs with bright halos (Io paterae etc.): x = core, y = halo.
vec2 patera(vec3 p, float seed, float dens) {
  vec3 ip = floor(p); float core = 0.0, halo = 0.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 g = ip + vec3(float(i), float(j), float(k));
    vec3 r = hash33(g + seed);
    if (r.z > dens) continue;
    vec3 c = g + 0.2 + 0.6 * fract(r * vec3(7.31, 13.17, 5.71));
    float x = length(p - c) / mix(0.07, 0.2, r.x);
    core = max(core, 1.0 - smoothstep(0.7, 1.0, x));
    halo = max(halo, (1.0 - smoothstep(1.0, 2.8, x)) * (1.0 - core));
  }
  return vec2(core, halo);
}
vec2 ray2(vec2 ll, vec2 c, float seed) { // bright ray system around a young crater: x = brightness
  float dl = mod(ll.x - c.y + 180.0, 360.0) - 180.0;
  vec2 q = vec2(dl * cos(radians(c.x)), ll.y - c.x);
  float r = length(q), th = atan(q.y, q.x);
  float rays = smoothstep(0.5, 0.9, vnoise(vec3(cos(th) * 7.0, sin(th) * 7.0, seed)));
  return vec2(exp(-r / 22.0) * (0.35 + rays) * smoothstep(1.2, 3.0, r) + exp(-r * r / 3.0) * 1.2, 0.0);
}
`;

const FRAG_MAIN = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat);
void main() {
  float lon = (vUv.x - 0.5) * 2.0 * PI, lat = (vUv.y - 0.5) * PI;
  vec3 d = lonLatToDir(lon, lat);
  vec4 col, dat;
  surf(d, vec2(degrees(lon), degrees(lat)), col, dat);
  gl_FragColor = uPass == 0 ? col : dat;
}
`;

const STYLES = {};

STYLES.earth = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float la = ll.y, alat = abs(la);
  vec2 muv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 off = (vec2(fbm(d * 45.0 + 3.1, 4), fbm(d * 45.0 + 9.7, 4)) - 0.5) * vec2(2.4 / 720.0, 2.4 / 360.0);
  float lm = texture2D(tLand, muv + off).r;
  float coastN = fbm(d * 160.0, 3);
  float landF = smoothstep(0.38, 0.62, lm + (coastN - 0.5) * 0.35);
  float shelf = smoothstep(0.02, 0.4, textureLod(tLand, muv, 2.2).r);

  // ---- relief (sea level 0.25; 0.25..1.0 spans 0..8.8 km) ----
  float rel = fbm(d * 7.0 + 11.0, 5), rid = ridged(d * 16.0 + 3.0, 5);
  float mount = 0.0;
  mount += gbox(ll, vec4(72.0, 102.0, 27.0, 40.0), 4.0) * (0.35 + 0.65 * rid) * 0.9;       // Himalaya / Tibet
  mount += gbox(ll, vec4(75.0, 100.0, 29.0, 36.0), 3.0) * 0.35;                           // plateau
  float andC = -78.0 + 0.5 * clamp(-la, 0.0, 22.0) - 0.2 * max(-22.0 - la, 0.0);
  mount += exp(-pow((ll.x - andC) / 3.2, 2.0)) * gbox(vec2(0.0, la), vec4(-1.0, 1.0, -55.0, 10.0), 3.0) * (0.4 + 0.6 * rid) * 0.85; // Andes
  float rocC = -112.0 - 0.45 * (la - 45.0);
  mount += exp(-pow((ll.x - rocC) / 5.0, 2.0)) * gbox(vec2(0.0, la), vec4(-1.0, 1.0, 32.0, 62.0), 3.0) * (0.3 + 0.7 * rid) * 0.6; // Rockies
  mount += exp(-pow(length(vec2((ll.x - 10.0) * 0.7, la - 46.5)) / 4.0, 2.0)) * (0.3 + 0.7 * rid) * 0.6; // Alps
  mount += exp(-pow(length(vec2(ll.x - 45.0, (la - 42.0) * 1.2)) / 4.0, 2.0)) * (0.3 + 0.7 * rid) * 0.5; // Caucasus
  mount += exp(-pow((ll.x - 60.0) / 2.0, 2.0)) * gbox(vec2(0.0, la), vec4(-1.0, 1.0, 50.0, 68.0), 2.0) * rid * 0.3; // Urals
  mount += exp(-pow(length(vec2(ll.x - 38.0, la - 3.0) / vec2(4.0, 12.0)), 2.0)) * (0.3 + 0.7 * rid) * 0.4; // East Africa
  mount += exp(-pow(length(vec2(ll.x - 3.0, la - 33.0) / vec2(8.0, 2.0)), 2.0)) * rid * 0.35;            // Atlas
  mount += gbox(ll, vec4(5.0, 18.0, 59.0, 68.0), 3.0) * rid * 0.35;                                      // Scandes
  float greenl = gbox(ll, vec4(-73.0, -12.0, 60.0, 84.0), 4.0) * smoothstep(0.35, 0.5, fbm(d * 3.0 + 1.0, 3) + 0.2 * (la - 60.0) / 24.0) ;
  float ant = smoothstep(-64.0, -78.0, la);
  float ice = clamp(greenl * smoothstep(0.0, 1.0, 1.0) + ant, 0.0, 1.0);
  float hl = 0.27 + 0.045 * rel + 0.075 * max(rel - 0.45, 0.0) + 0.5 * mount + 0.35 * ice;
  float hOcean = 0.25 - 0.18 * (1.0 - shelf) - 0.04 * fbm(d * 9.0, 3);
  float h = mix(hOcean, hl, landF);

  // ---- biomes ----
  float moist = fbm(d * 2.5 + vec3(4.0, 1.0, 8.0), 4);
  float zon = 0.5 + 0.35 * exp(-pow(alat / 12.0, 2.0)) - 0.35 * exp(-pow((alat - 27.0) / 8.0, 2.0)) + 0.12 * exp(-pow((alat - 52.0) / 11.0, 2.0));
  float wet = clamp(zon + (moist - 0.5) * 1.0, 0.0, 1.0);
  float desert = 0.0;
  desert = max(desert, gbox(ll, vec4(-17.0, 36.0, 15.0, 31.0), 4.0));         // Sahara
  desert = max(desert, gbox(ll, vec4(36.0, 58.0, 16.0, 31.0), 3.0));          // Arabia
  desert = max(desert, gbox(ll, vec4(112.0, 146.0, -33.0, -19.0), 5.0) * 0.9); // Australia
  desert = max(desert, gbox(ll, vec4(12.0, 25.0, -30.0, -18.0), 3.0) * 0.8);  // Namib / Kalahari
  desert = max(desert, gbox(ll, vec4(78.0, 118.0, 37.0, 46.0), 4.0) * 0.85);  // Taklamakan / Gobi
  desert = max(desert, gbox(ll, vec4(-117.0, -103.0, 29.0, 38.0), 3.0) * 0.7); // SW USA
  desert = max(desert, gbox(ll, vec4(-72.0, -67.0, -29.0, -17.0), 2.0) * 0.9); // Atacama
  desert = max(desert, gbox(ll, vec4(-72.0, -64.0, -50.0, -39.0), 3.0) * 0.5); // Patagonia
  desert = max(desert, gbox(ll, vec4(50.0, 72.0, 25.0, 36.0), 3.0) * 0.8);    // Iran / Thar
  desert = max(desert, gbox(ll, vec4(40.0, 51.0, 2.0, 11.0), 2.0) * 0.6);     // Horn of Africa
  desert *= 0.75 + 0.25 * smoothstep(0.3, 0.7, fbm(d * 8.0, 3));
  float rain = 0.0;
  rain = max(rain, gbox(ll, vec4(-76.0, -50.0, -13.0, 4.0), 4.0));            // Amazon
  rain = max(rain, gbox(ll, vec4(10.0, 29.0, -6.0, 4.0), 3.0));               // Congo
  rain = max(rain, gbox(ll, vec4(95.0, 142.0, -9.0, 9.0), 3.0));              // Indonesia / New Guinea
  rain = max(rain, gbox(ll, vec4(96.0, 108.0, 10.0, 24.0), 3.0) * 0.8);       // Indochina
  rain = max(rain, gbox(ll, vec4(-86.0, -76.0, 6.0, 18.0), 3.0) * 0.8);       // Central America
  wet = clamp(max(wet * (1.0 - desert), rain * 0.95), 0.0, 1.0);
  vec3 cDesert = mix(vec3(0.43, 0.30, 0.16), vec3(0.52, 0.36, 0.20), fbm(d * 14.0, 3));
  vec3 cSav = vec3(0.26, 0.20, 0.08), cGrass = vec3(0.12, 0.16, 0.05), cForest = vec3(0.035, 0.085, 0.03), cJung = vec3(0.018, 0.055, 0.02);
  vec3 land = mix(cDesert, cSav, smoothstep(0.12, 0.3, wet));
  land = mix(land, cGrass, smoothstep(0.3, 0.5, wet));
  land = mix(land, cForest, smoothstep(0.5, 0.72, wet));
  land = mix(land, cJung, smoothstep(0.85, 1.0, wet));
  land *= 0.85 + 0.3 * fbm(d * 30.0, 3);
  land = mix(land, vec3(0.045, 0.075, 0.05), smoothstep(46.0, 56.0, alat) * 0.8);       // boreal
  land = mix(land, vec3(0.20, 0.19, 0.15), smoothstep(60.0, 68.0, alat + (moist - 0.5) * 8.0)); // tundra
  float snowline = mix(0.62, 0.30, clamp(alat / 70.0, 0.0, 1.0));
  float snow = smoothstep(snowline, snowline + 0.1, hl) * 0.9;
  float polar = smoothstep(68.0, 76.0, alat + (moist - 0.5) * 10.0);
  land = mix(land, vec3(0.82, 0.84, 0.88), clamp(max(max(snow, ice), polar), 0.0, 1.0));

  vec3 deep = vec3(0.0025, 0.012, 0.045), shal = vec3(0.012, 0.085, 0.13);
  vec3 ocean = mix(deep, shal, shelf * 0.8 + 0.1 * fbm(d * 20.0, 3));
  float seaIce = smoothstep(66.0, 74.0, alat + (fbm(d * 6.0, 4) - 0.5) * 12.0) * (1.0 - landF);
  ocean = mix(ocean, vec3(0.75, 0.80, 0.85), seaIce);
  vec3 albedo = mix(ocean, land, landF);
  col = vec4(albedo, (1.0 - landF) * (1.0 - seaIce));

  // ---- city lights ----
  float pop = 0.0;
  pop += gbox(ll, vec4(-92.0, -70.0, 30.0, 45.0), 4.0);
  pop += gbox(ll, vec4(-124.0, -117.0, 32.0, 38.0), 3.0) * 0.8;
  pop += gbox(ll, vec4(-100.0, -90.0, 29.0, 42.0), 5.0) * 0.35;
  pop += gbox(ll, vec4(-6.0, 30.0, 41.0, 57.0), 3.0);
  pop += gbox(ll, vec4(30.0, 45.0, 50.0, 57.0), 3.0) * 0.5;
  pop += gbox(ll, vec4(72.0, 90.0, 8.0, 31.0), 3.0) * 0.9;
  pop += gbox(ll, vec4(104.0, 123.0, 22.0, 41.0), 3.0);
  pop += gbox(ll, vec4(127.0, 142.0, 33.0, 40.0), 2.0);
  pop += gbox(ll, vec4(98.0, 110.0, 10.0, 22.0), 3.0) * 0.5;
  pop += gbox(ll, vec4(105.0, 115.0, -8.5, -5.5), 2.0) * 0.9;
  pop += gbox(ll, vec4(-50.0, -40.0, -26.0, -18.0), 3.0) * 0.7;
  pop += gbox(ll, vec4(-100.0, -96.0, 18.0, 21.0), 2.0) * 0.7;
  pop += gbox(ll, vec4(28.0, 35.0, 28.0, 33.0), 2.0) * 0.6;
  pop += gbox(ll, vec4(2.0, 8.0, 5.0, 8.0), 2.0) * 0.6;
  pop += gbox(ll, vec4(-60.0, -56.0, -36.0, -33.0), 2.0) * 0.6;
  pop += gbox(ll, vec4(44.0, 56.0, 24.0, 38.0), 3.0) * 0.4;
  pop += gbox(ll, vec4(145.0, 153.0, -38.0, -27.0), 2.0) * 0.4;
  pop += gbox(ll, vec4(26.0, 33.0, -27.0, -24.0), 2.0) * 0.4;
  pop = clamp(pop, 0.0, 1.3);
  float cn = fbm(d * 110.0 + 2.0, 3), cn2 = fbm(d * 420.0, 2);
  float lights = pop * smoothstep(0.50, 0.68, cn) * (0.45 + 0.55 * smoothstep(0.35, 0.8, cn2));
  lights += 0.05 * smoothstep(0.62, 0.8, fbm(d * 60.0 + 7.0, 3)) * smoothstep(60.0, 40.0, alat);
  lights *= landF * (1.0 - ice) * (1.0 - desert * 0.9 * (1.0 - pop));

  // ---- clouds ----
  float z = 0.38 + 0.38 * exp(-pow((la - 5.0) / 8.0, 2.0)) - 0.24 * exp(-pow((alat - 25.0) / 9.0, 2.0)) + 0.28 * exp(-pow((alat - 56.0) / 13.0, 2.0)) + 0.1 * smoothstep(75.0, 90.0, alat);
  vec3 q = d * 3.2;
  vec3 w = vec3(fbm(q + 1.7, 4), fbm(q + 8.3, 4), fbm(q + 4.1, 4)) - 0.5;
  float cl = fbm(q * 1.3 + w * 1.6, 6);
  float thr = 1.0 - z;
  float cov = smoothstep(thr - 0.1, thr + 0.12, cl);
  cov *= 0.65 + 0.7 * fbm(d * 40.0, 3);
  cov *= 1.0 - 0.45 * desert * landF;
  float cloud = clamp(cov, 0.0, 1.0);
  dat = vec4(packH(h), clamp(lights, 0.0, 1.0), cloud);
}`;

const MOON_MARIA = `
const vec4 MARIA[24] = vec4[24](
  vec4(33.0, -16.0, 17.0, 13.0), vec4(28.0, 18.0, 10.0, 10.0), vec4(8.5, 31.0, 13.0, 9.0), vec4(17.0, 59.0, 7.0, 5.5),
  vec4(-7.8, 51.0, 10.0, 7.0), vec4(-15.0, 35.0, 5.0, 5.0), vec4(-21.0, -16.0, 11.0, 8.0), vec4(-24.0, -39.0, 6.0, 6.0),
  vec4(-10.0, -23.0, 6.0, 5.0), vec4(13.0, 3.0, 4.0, 4.0), vec4(57.0, -5.0, 30.0, 4.5), vec4(20.0, -52.0, 18.0, 15.0),
  vec4(8.0, -60.0, 12.0, 10.0), vec4(-7.0, -31.0, 7.0, 6.0), vec4(-19.0, -93.0, 5.0, 5.0), vec4(27.0, 148.0, 4.0, 4.0),
  vec4(1.0, 87.0, 4.0, 3.0), vec4(13.0, 86.0, 3.0, 2.5), vec4(57.0, 81.0, 3.5, 3.0), vec4(33.0, 5.0, 4.0, 4.0),
  vec4(-45.0, -165.0, 7.0, 5.0), vec4(-60.0, 160.0, 5.0, 5.0), vec4(40.0, 22.0, 5.0, 3.0), vec4(-30.0, 5.0, 4.0, 2.0));
`;

STYLES.moon = MOON_MARIA + /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float n = fbm(d * 9.0, 4), n2 = fbm(d * 3.0 + 5.0, 4);
  float mare = 0.0;
  for (int i = 0; i < 24; i++) {
    float e = gell(ll, MARIA[i]);
    mare = max(mare, 1.0 - smoothstep(0.7, 1.0 + 0.45 * (n - 0.5), e + 0.12 * (fbm(d * 30.0, 3) - 0.5)));
  }
  mare *= 0.65 + 0.35 * smoothstep(0.2, 0.7, n2);
  vec2 cr = craterField(d, 0.5, 1.0);
  float fl = 1.0 - 0.75 * mare;
  float hgt = 0.5 + 0.08 * (n2 - 0.5) - 0.045 * mare + 0.07 * cr.x * fl;
  vec3 hi = mix(vec3(0.215, 0.205, 0.19), vec3(0.17, 0.165, 0.155), n);
  vec3 ma = mix(vec3(0.062, 0.062, 0.066), vec3(0.085, 0.08, 0.075), fbm(d * 14.0, 3));
  vec3 a = mix(hi, ma, mare);
  float bright = cr.y * (1.0 - 0.6 * mare);
  vec2 rr = ray2(ll, vec2(-43.4, -11.4), 3.0) + ray2(ll, vec2(9.6, -20.1), 5.0) * 0.6 + ray2(ll, vec2(8.1, -38.0), 7.0) * 0.4 + ray2(ll, vec2(23.7, -47.4), 9.0) * 0.6 + ray2(ll, vec2(36.0, 103.0), 11.0) * 0.5;
  bright += rr.x * 0.55;
  a *= 1.0 + 0.9 * bright;
  a *= 0.9 + 0.2 * fbm(d * 60.0, 3);
  col = vec4(a, 0.0);
  dat = vec4(packH(hgt), 0.0, 0.0);
}`;

STYLES.mercury = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float n = fbm(d * 3.0 + 2.0, 5), n2 = fbm(d * 11.0, 4);
  vec2 cr = craterField(d, 0.62, 1.15);
  float smoothP = smoothstep(0.55, 0.7, n);
  float hgt = 0.5 + 0.05 * (n - 0.5) + 0.075 * cr.x * (1.0 - 0.55 * smoothP);
  vec3 a = mix(vec3(0.082, 0.077, 0.072), vec3(0.150, 0.133, 0.115), n2);
  a = mix(a, vec3(0.115, 0.108, 0.105), smoothP);
  a *= 1.0 + 1.1 * cr.y;
  a *= 0.88 + 0.24 * fbm(d * 70.0, 3);
  col = vec4(a, 0.0);
  dat = vec4(packH(hgt), 0.0, 0.0);
}`;

STYLES.mars = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float la = ll.y, alat = abs(la);
  float n = fbm(d * 4.0, 5), n2 = fbm(d * 18.0 + 3.0, 4), n3 = fbm(d * 2.0 + 9.0, 3);
  vec2 cr = craterField(d, 0.4, 1.0) * smoothstep(20.0, -35.0, la + (n - 0.5) * 30.0) ;   // old southern highlands
  vec2 cr2 = craterField(d + 7.0, 0.18, 0.7);
  // dark albedo features (Syrtis Major, Acidalia, Sinus Meridiani, Cimmerium, Sirenum, Solis Lacus, Utopia)
  float dark = 0.0;
  dark = max(dark, 1.0 - smoothstep(0.7, 1.1, gell(ll, vec4(9.0, 68.0, 14.0, 10.0))));
  dark = max(dark, 1.0 - smoothstep(0.7, 1.1, gell(ll, vec4(45.0, -30.0, 20.0, 12.0))));
  dark = max(dark, 1.0 - smoothstep(0.7, 1.1, gell(ll, vec4(0.0, -2.0, 16.0, 5.0))));
  dark = max(dark, 1.0 - smoothstep(0.7, 1.1, gell(ll, vec4(-5.0, -22.0, 10.0, 5.0))));
  dark = max(dark, 1.0 - smoothstep(0.7, 1.1, gell(ll, vec4(-25.0, 145.0, 22.0, 8.0))));
  dark = max(dark, 1.0 - smoothstep(0.7, 1.1, gell(ll, vec4(-35.0, -150.0, 25.0, 8.0))));
  dark = max(dark, 1.0 - smoothstep(0.7, 1.1, gell(ll, vec4(-26.0, -90.0, 8.0, 6.0))));
  dark = max(dark, 1.0 - smoothstep(0.7, 1.1, gell(ll, vec4(45.0, 110.0, 16.0, 12.0))) );
  dark = clamp(dark * (0.6 + 0.6 * n2) , 0.0, 1.0);
  float bright = 0.0;
  bright = max(bright, 1.0 - smoothstep(0.6, 1.2, gell(ll, vec4(15.0, -110.0, 28.0, 18.0))));   // Tharsis dust
  bright = max(bright, 1.0 - smoothstep(0.6, 1.2, gell(ll, vec4(20.0, 20.0, 22.0, 10.0))));     // Arabia
  bright = max(bright, 1.0 - smoothstep(0.6, 1.0, gell(ll, vec4(-42.0, 70.0, 12.0, 10.0))));    // Hellas
  vec3 rust = mix(vec3(0.40, 0.19, 0.085), vec3(0.50, 0.27, 0.12), n);
  vec3 a = mix(rust, vec3(0.115, 0.075, 0.06), dark * 0.85);
  a = mix(a, vec3(0.58, 0.36, 0.20), bright * 0.55);
  a *= 0.85 + 0.3 * n2;
  a *= 1.0 + 0.5 * (cr.y + cr2.y);
  // heights (km relative to datum; 0.3 = datum, span 32 km)
  float h = 0.30 + 0.06 * (n3 - 0.5) + 0.05 * (n - 0.5) - 0.06 * smoothstep(10.0, 50.0, la + (n - 0.5) * 20.0) * 0.5;   // northern lowlands
  h += 0.9 * exp(-pow(gell(ll, vec4(18.4, -133.8, 4.0, 4.0)), 2.0) * 1.4);                        // Olympus Mons
  h += 0.45 * exp(-pow(gell(ll, vec4(1.0, -112.0, 5.0, 5.0)), 2.0) * 1.2) + 0.3 * exp(-pow(gell(ll, vec4(-9.0, -121.0, 4.0, 4.0)), 2.0));   // Tharsis volcanoes
  h += 0.18 * exp(-pow(gell(ll, vec4(10.0, -105.0, 28.0, 20.0)), 2.0));                           // Tharsis bulge
  h -= 0.25 * exp(-pow(gell(ll, vec4(-42.0, 70.0, 11.0, 9.0)), 2.0));                             // Hellas
  float vm = exp(-pow((la + 8.0 - 0.0 * ll.x) / 2.2, 2.0)) * smoothstep(-95.0, -85.0, ll.x) * (1.0 - smoothstep(-55.0, -45.0, ll.x));
  h -= 0.18 * vm * (0.6 + 0.4 * ridged(d * 30.0, 3));                                              // Valles Marineris
  a = mix(a, a * 0.55, vm * 0.5);
  h += 0.05 * (cr.x + cr2.x);
  float capN = smoothstep(80.0, 84.0, la + (n - 0.5) * 5.0), capS = smoothstep(-86.0, -83.0, -la + (n - 0.5) * 3.0 - 0.0) * step(la, 0.0);
  a = mix(a, vec3(0.80, 0.80, 0.82), max(capN, capS * 0.9));
  col = vec4(a, 0.0);
  dat = vec4(packH(h), 0.0, 0.0);
}`;

STYLES.io = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float n = fbm(d * 5.0, 5), n2 = fbm(d * 3.0 + 4.0, 4), n3 = fbm(d * 22.0, 3);
  vec3 a = mix(vec3(0.58, 0.47, 0.12), vec3(0.82, 0.76, 0.38), n);
  a = mix(a, vec3(0.62, 0.30, 0.11), smoothstep(0.52, 0.66, n2) * 0.8);        // red-orange sulphur allotropes
  a = mix(a, vec3(0.90, 0.88, 0.80), smoothstep(0.62, 0.75, fbm(d * 7.0 + 13.0, 4)) * 0.6); // SO2 frost
  vec2 p1 = patera(d * 6.0, 1.0, 0.22), p2 = patera(d * 14.0, 2.0, 0.12);
  a = mix(a, vec3(0.45, 0.20, 0.07), (p1.y + p2.y) * 0.6);
  a = mix(a, vec3(0.025, 0.022, 0.02), max(p1.x, p2.x));
  a *= 0.9 + 0.2 * n3;
  float h = 0.5 + 0.1 * (n - 0.5) + 0.12 * ridged(d * 10.0, 4) * smoothstep(0.55, 0.7, n2) - 0.1 * max(p1.x, p2.x);
  col = vec4(a, 0.0);
  dat = vec4(packH(h), 0.0, 0.0);
}`;

STYLES.europa = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float n = fbm(d * 4.0, 5), n2 = fbm(d * 9.0 + 3.0, 4);
  vec3 q = d * 3.0;
  vec3 w = vec3(fbm(q + 1.0, 4), fbm(q + 7.0, 4), fbm(q + 3.0, 4)) - 0.5;
  float l1 = 1.0 - abs(2.0 * fbm(q * 1.4 + w * 1.2, 5) - 1.0);
  float l2 = 1.0 - abs(2.0 * fbm(q * 3.0 + w * 2.0 + 5.0, 5) - 1.0);
  float lines = smoothstep(0.93, 0.99, l1) + 0.7 * smoothstep(0.945, 0.99, l2);
  float chaos = smoothstep(0.58, 0.72, n2);
  vec3 a = mix(vec3(0.66, 0.64, 0.58), vec3(0.78, 0.77, 0.74), n);
  a = mix(a, vec3(0.46, 0.33, 0.24), chaos * 0.75);
  a = mix(a, vec3(0.36, 0.20, 0.12), clamp(lines, 0.0, 1.0) * 0.75);
  vec2 cr = craterField(d, 0.07, 1.0);
  a *= 1.0 + 0.5 * cr.y;
  a *= 0.92 + 0.16 * fbm(d * 80.0, 3);
  float h = 0.5 + 0.03 * (n - 0.5) + 0.03 * lines + 0.02 * chaos * fbm(d * 40.0, 3) + 0.03 * cr.x;
  col = vec4(a, 0.0);
  dat = vec4(packH(h), 0.0, 0.0);
}`;

STYLES.ganymede = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float alat = abs(ll.y);
  float n = fbm(d * 3.5 + 1.0, 5), n2 = fbm(d * 10.0, 4);
  float bright = smoothstep(0.48, 0.58, n);
  float groove = 0.5 + 0.5 * sin(80.0 * fbm(d * 5.0 + 9.0, 3));
  vec2 cr = craterField(d, 0.38, 1.0);
  vec3 a = mix(vec3(0.20, 0.165, 0.13), vec3(0.46, 0.43, 0.39), bright);
  a *= 0.88 + 0.24 * mix(n2, groove, bright * 0.6);
  a = mix(a, vec3(0.62, 0.62, 0.62), smoothstep(55.0, 75.0, alat) * 0.7);
  a *= 1.0 + 1.1 * cr.y;
  float h = 0.5 + 0.06 * (n - 0.5) + 0.04 * bright * groove + 0.06 * cr.x;
  col = vec4(a, 0.0);
  dat = vec4(packH(h), 0.0, 0.0);
}`;

STYLES.callisto = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float n = fbm(d * 4.0 + 2.0, 5), n2 = fbm(d * 14.0, 4);
  vec2 cr = craterField(d, 0.7, 1.1);
  vec3 a = mix(vec3(0.115, 0.098, 0.082), vec3(0.19, 0.165, 0.14), n);
  a *= 0.9 + 0.2 * n2;
  float vh = gell(ll, vec4(14.7, -56.0, 12.0, 12.0));      // Valhalla multi-ring basin
  a *= 1.0 + 1.6 * exp(-vh * vh * 3.0) + 0.5 * exp(-pow(fract(vh * 2.0) - 0.5, 2.0) * 30.0) * smoothstep(5.0, 1.5, vh);
  a *= 1.0 + 2.3 * cr.y;
  float h = 0.5 + 0.04 * (n - 0.5) + 0.09 * cr.x;
  col = vec4(a, 0.0);
  dat = vec4(packH(h), 0.0, 0.0);
}`;

STYLES.pluto = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float n = fbm(d * 4.0, 5), n2 = fbm(d * 12.0 + 2.0, 4);
  vec3 a = mix(vec3(0.42, 0.30, 0.22), vec3(0.62, 0.50, 0.40), n);
  float cth = 1.0 - smoothstep(0.7, 1.1, gell(ll, vec4(-12.0, 105.0, 55.0, 14.0)) + 0.3 * (n2 - 0.5));  // Cthulhu Macula
  a = mix(a, vec3(0.20, 0.085, 0.05), cth * 0.85);
  float heart = 1.0 - smoothstep(0.75, 1.0, gell(ll, vec4(22.0, 175.0, 28.0, 24.0)) + 0.35 * (n2 - 0.5)); // Sputnik Planitia / Tombaugh Regio
  a = mix(a, vec3(0.88, 0.82, 0.72), heart);
  a = mix(a, vec3(0.80, 0.74, 0.65), smoothstep(60.0, 85.0, abs(ll.y)) * 0.4);
  vec2 cr = craterField(d, 0.2, 0.9) * (1.0 - heart);
  a *= 1.0 + 0.4 * cr.y;
  a *= 0.9 + 0.2 * fbm(d * 50.0, 3);
  float h = 0.5 + 0.05 * (n - 0.5) + 0.05 * cr.x - 0.05 * heart;
  col = vec4(a, 0.0);
  dat = vec4(packH(h), 0.0, 0.0);
}`;

STYLES.iapetus = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float n = fbm(d * 4.0, 5), n2 = fbm(d * 10.0, 4);
  float dl = mod(ll.x + 90.0 + 180.0, 360.0) - 180.0;      // leading hemisphere centred on 90 W
  float dk = 1.0 - smoothstep(55.0, 100.0, abs(dl) + (n - 0.5) * 60.0 + abs(ll.y) * 0.2);
  vec3 a = mix(vec3(0.50, 0.50, 0.49), vec3(0.045, 0.035, 0.028), dk);
  vec2 cr = craterField(d, 0.55, 1.0);
  a *= 0.85 + 0.3 * n2;
  a *= 1.0 + 1.0 * cr.y * (1.0 - 0.5 * dk);
  float h = 0.5 + 0.05 * (n - 0.5) + 0.09 * cr.x + 0.06 * exp(-pow((ll.y) / 8.0, 2.0)) * 1.0; // equatorial ridge
  col = vec4(a, 0.0);
  dat = vec4(packH(h), 0.0, 0.0);
}`;

STYLES.enceladus = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  float n = fbm(d * 5.0, 5);
  vec2 cr = craterField(d, 0.3, 1.0) * smoothstep(-40.0, 30.0, ll.y);
  vec3 a = mix(vec3(0.90, 0.92, 0.95), vec3(0.97, 0.98, 1.0), n);
  float tiger = smoothstep(-62.0, -80.0, ll.y) * smoothstep(0.72, 0.95, 1.0 - abs(2.0 * fbm(vec3(d.xy * 9.0, d.z * 3.0), 3) - 1.0));
  a = mix(a, vec3(0.45, 0.62, 0.72), tiger * 0.7);
  a *= 1.0 - 0.1 * smoothstep(0.55, 0.8, fbm(d * 12.0, 3));
  float h = 0.5 + 0.03 * (n - 0.5) + 0.04 * cr.x + 0.03 * tiger;
  col = vec4(a, 0.0);
  dat = vec4(packH(h), 0.0, 0.0);
}`;

// Generic cratered rock/ice: uColA dark, uColB bright, uParams (crater density, patchiness, seed).
STYLES.generic = /* glsl */ `
void surf(vec3 d, vec2 ll, out vec4 col, out vec4 dat) {
  vec3 s = d + uParams.z * 3.17;
  float n = fbm(s * 3.0, 5), n2 = fbm(s * 11.0, 4);
  float patchy = smoothstep(0.5 - 0.1, 0.5 + 0.1, fbm(s * 2.2 + 4.0, 4)) * uParams.y;
  vec2 cr = craterField(s, uParams.x, 1.0);
  vec3 a = mix(uColA, uColB, clamp(patchy + 0.35 * (n - 0.5) + 0.25 * cr.y, 0.0, 1.0));
  a *= 0.88 + 0.24 * n2;
  a *= 1.0 + 0.9 * cr.y;
  float h = 0.5 + 0.05 * (n - 0.5) + 0.085 * cr.x;
  col = vec4(a, 0.0);
  dat = vec4(packH(h), 0.0, 0.0);
}`;

const FS_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class TextureGenerator {
  constructor(renderer) {
    this.renderer = renderer;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.materials = new Map();
    this.landTex = null;
  }
  get land() {
    if (!this.landTex) {
      const t = new THREE.DataTexture(decodeLandMask(), LAND_W, LAND_H, THREE.RedFormat, THREE.UnsignedByteType);
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      this.landTex = t;
    }
    return this.landTex;
  }
  #material(style) {
    let m = this.materials.get(style);
    if (!m) {
      m = new THREE.ShaderMaterial({
        vertexShader: FS_VERT, fragmentShader: FRAG_HEAD + (STYLES[style] || STYLES.generic) + FRAG_MAIN,
        uniforms: { tLand: { value: this.land }, uPass: { value: 0 }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uParams: { value: new THREE.Vector3(0.4, 0.5, 0) } },
        depthTest: false, depthWrite: false,
      });
      this.materials.set(style, m);
    }
    return m;
  }
  #target(w, h, srgb) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    rt.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return rt;
  }
  /** spec: { style, colA:[r,g,b] linear, colB, crater, patch, seed }  → { color, data } render targets. */
  generate(style, w, h, spec = {}) {
    const m = this.#material(style);
    const u = m.uniforms;
    u.uColA.value.setRGB(...(spec.colA || [0.1, 0.1, 0.1]), THREE.LinearSRGBColorSpace);
    u.uColB.value.setRGB(...(spec.colB || [0.3, 0.3, 0.3]), THREE.LinearSRGBColorSpace);
    u.uParams.value.set(spec.crater ?? 0.4, spec.patch ?? 0.5, spec.seed ?? 0);
    const r = this.renderer;
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear;
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.autoClear = false;
    this.quad.material = m;
    const color = this.#target(w, h, true), data = this.#target(w, h, false);
    u.uPass.value = 0; r.setRenderTarget(color); r.render(this.scene, this.cam);
    u.uPass.value = 1; r.setRenderTarget(data); r.render(this.scene, this.cam);
    r.setRenderTarget(prevRT); r.autoClear = prevAuto; r.setClearColor(prevClear, prevAlpha);
    return { color, data };
  }
  dispose() { for (const m of this.materials.values()) m.dispose(); this.landTex?.dispose(); }
}

// ---- photographic maps ------------------------------------------------------------------------------------------
// Maps fetched by tools/fetch_textures.py (sources in data/attributions/bodies.json) and described by
// data/textures/manifest.json. Decoded off the main thread with createImageBitmap, flipped so v = 1 is north
// (matching dirToUv in surface.js). Albedo maps are sRGB (or linear greyscale for USGS I/F mosaics); clouds, ocean
// mask and normals are linear; heights are decoded in a worker to half-float km with a hand-built mip chain (packed
// 16-bit heights cannot be mipmapped by the GPU without corrupting the high/low byte split).

const MANIFEST = 'data/textures/manifest.json';
const BIG = new Set(['earth', 'moon', 'mars', 'jupiter']);   // bodies whose colour map may use the tier's full size

const HEIGHT_WORKER = `
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function half(v) {
  f32[0] = v; const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s; if (e > 30) return s | 0x7c00;
  return s | ((e << 10) + ((m + 0x1000) >>> 13));
}
onmessage = async (ev) => {
  try {
    const { buf, offset, scaleKm, maxW } = ev.data;
    const bmp = await createImageBitmap(new Blob([buf]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const w = bmp.width, h = bmp.height;
    const cv = new OffscreenCanvas(w, h), g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0); bmp.close();
    const px = g.getImageData(0, 0, w, h).data;
    let cur = new Float32Array(w * h), cw = w, ch = h;
    for (let j = 0; j < h; j++) {                      // flip rows: texture row 0 = south
      const src = (h - 1 - j) * w * 4, dst = j * w;
      for (let i = 0; i < w; i++) { const k = src + i * 4; cur[dst + i] = ((px[k] << 8 | px[k + 1]) - offset) * scaleKm; }
    }
    const levels = [];
    for (;;) {
      if (cw <= maxW) {
        const d = new Uint16Array(cw * ch);
        for (let i = 0; i < d.length; i++) d[i] = half(cur[i]);
        levels.push({ width: cw, height: ch, data: d });
      }
      if (cw === 1 && ch === 1) break;
      const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1), nx = new Float32Array(nw * nh);
      for (let j = 0; j < nh; j++) {
        const j0 = Math.min(ch - 1, 2 * j) * cw, j1 = Math.min(ch - 1, 2 * j + 1) * cw;
        for (let i = 0; i < nw; i++) {
          const i0 = Math.min(cw - 1, 2 * i), i1 = Math.min(cw - 1, 2 * i + 1);
          nx[j * nw + i] = 0.25 * (cur[j0 + i0] + cur[j0 + i1] + cur[j1 + i0] + cur[j1 + i1]);
        }
      }
      cur = nx; cw = nw; ch = nh;
    }
    postMessage({ levels }, levels.map((l) => l.data.buffer));
  } catch (e) { postMessage({ error: String(e && e.message || e) }); }
};`;

export class PhotoLibrary {
  constructor(renderer, assets) {
    this.renderer = renderer; this.assets = assets;
    this.manifest = null;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.maxSize = renderer.capabilities.maxTextureSize || 4096;
  }
  async init() {
    try { this.manifest = await this.assets.json(MANIFEST); } catch (e) { console.warn('[bodies] texture manifest', e); }
    return this;
  }
  entry(id) { return this.manifest?.bodies?.[id] || null; }

  async #bitmap(path, cap) {
    const buf = await this.assets.buffer(path);
    if (!buf) throw new Error('missing ' + path);
    const blob = new Blob([buf]);
    // Probe the size first so we only ask for a resize when the tier needs a smaller map.
    let bmp = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    if (bmp.width > cap) {
      const w = cap, h = Math.round(cap * bmp.height / bmp.width);
      bmp.close();
      bmp = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    }
    return bmp;
  }
  async #texture(path, cap, { srgb = false, red = false } = {}) {
    const bmp = await this.#bitmap(path, cap);
    const t = new THREE.Texture(bmp);
    t.flipY = false;   // already flipped by createImageBitmap
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (red) t.format = THREE.RedFormat;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
    t.anisotropy = Math.min(16, this.maxAniso);
    t.needsUpdate = true;
    return t;
  }
  #height(path, meta, cap) {
    return this.assets.buffer(path).then((buf) => new Promise((resolve, reject) => {
      if (!buf) { reject(new Error('missing ' + path)); return; }
      const url = URL.createObjectURL(new Blob([HEIGHT_WORKER], { type: 'text/javascript' }));
      const wk = new Worker(url);
      wk.onmessage = (ev) => {
        wk.terminate(); URL.revokeObjectURL(url);
        if (ev.data.error) { reject(new Error(ev.data.error)); return; }
        const L = ev.data.levels, l0 = L[0];
        const t = new THREE.DataTexture(l0.data, l0.width, l0.height, THREE.RedFormat, THREE.HalfFloatType);
        t.mipmaps = L; t.generateMipmaps = false;
        t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
        t.anisotropy = Math.min(8, this.maxAniso);
        t.needsUpdate = true;
        resolve(t);
      };
      wk.onerror = (e) => { wk.terminate(); URL.revokeObjectURL(url); reject(new Error(e.message || 'height worker failed')); };
      wk.postMessage({ buf, offset: meta.offset, scaleKm: meta.scaleKm, maxW: cap }, [buf]);
    }));
  }

  /** Load every map of body `id` for the given tier. Resolves { entry, color, night, clouds, spec, normal, height }. */
  async load(id, tierSettings = {}, tier = 'high') {
    const e = this.entry(id);
    if (!e) throw new Error('no photo maps for ' + id);
    const tierMax = Math.min(tierSettings.maxTexture || 4096, this.maxSize);
    const capCol = BIG.has(id) || tier === 'ultra' ? tierMax : Math.min(tierMax, 4096);
    const capAux = Math.min(tierMax, 4096);
    const m = e.maps, out = { entry: e };
    const jobs = [];
    jobs.push(this.#texture(m.color, capCol, { srgb: !!e.srgb, red: !!e.tint }).then((t) => { out.color = t; }));
    if (m.night) jobs.push(this.#texture(m.night, capAux, { srgb: true }).then((t) => { out.night = t; }));
    if (m.clouds) jobs.push(this.#texture(m.clouds, tierMax, { red: true }).then((t) => { out.clouds = t; }));
    if (m.spec) jobs.push(this.#texture(m.spec, capAux, { red: true }).then((t) => { out.spec = t; }));
    if (m.normal) jobs.push(this.#texture(m.normal, capAux).then((t) => { out.normal = t; }));
    if (m.height && e.height) jobs.push(this.#height(m.height, e.height, capCol).then((t) => { out.height = t; }));
    try { await Promise.all(jobs); } catch (err) {
      for (const k of ['color', 'night', 'clouds', 'spec', 'normal', 'height']) out[k]?.dispose();
      throw err;
    }
    return out;
  }
}
