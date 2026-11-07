// Shared GLSL snippets for the bodies renderer (WebGL2 / GLSL ES 3.00 via THREE.ShaderMaterial).

export const NOISE = /* glsl */ `
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), h = hash13(i + vec3(0, 1, 1)), k = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise(p); p = p * 2.03 + vec3(17.1, 3.7, 9.2); a *= 0.5; }
  return s / (1.0 - pow(0.5, float(oct)));
}
float ridged(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0); s += a * n * n; p = p * 2.07 + vec3(5.3, 11.1, 2.9); a *= 0.5; }
  return s / (1.0 - pow(0.5, float(oct)));
}
// Worley F1/F2 (3D, jittered cell points; w animates the feature points).
vec2 worley(vec3 p, float w) {
  vec3 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 h = hash33(ip + g);
    vec3 o = 0.5 + 0.5 * sin(w + 6.2831853 * h);
    float d = length(g + o - fp);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return vec2(f1, f2);
}
`;

// Pack/unpack a [0,1] height into two 8-bit channels (linear filtering of the pair stays exact).
export const HEIGHT_PACK = /* glsl */ `
vec2 packH(float h) { float v = clamp(h, 0.0, 1.0) * 65535.0; float hi = floor(v / 256.0); return vec2(hi / 255.0, (v - hi * 256.0) / 255.0); }
float unpackH(vec2 c) { return (c.x * 255.0 * 256.0 + c.y * 255.0) / 65535.0; }
`;

export const SPHERE_MATH = /* glsl */ `
const float PI = 3.14159265358979;
vec2 dirToLonLat(vec3 d) { return vec2(atan(d.y, d.x), asin(clamp(d.z, -1.0, 1.0))); }
vec2 dirToUv(vec3 d) { vec2 ll = dirToLonLat(d); return vec2(ll.x / (2.0 * PI) + 0.5, ll.y / PI + 0.5); }
vec3 lonLatToDir(float lon, float lat) { return vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)); }
`;
