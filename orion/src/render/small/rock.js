// Procedural rock meshes + shared rock material (Lommel–Seeliger lit, noise bump) for asteroids, comet nuclei,
// Phobos/Deimos, Bennu and Eros. Kilometre units, log-depth aware, optional instancing.
import * as THREE from 'three';

const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), u), L(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), u), v),
           L(L(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), u), L(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), u), v), w);
}
const fbm3 = (x, y, z) => 0.5 * vnoise3(x, y, z) + 0.25 * vnoise3(x * 2.1, y * 2.1, z * 2.1) + 0.125 * vnoise3(x * 4.3, y * 4.3, z * 4.3) + 0.0625 * vnoise3(x * 8.7, y * 8.7, z * 8.7);

// Indexed icosphere (shared vertices so computeVertexNormals gives smooth shading).
export function icosphere(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  v = v.map((p) => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; });
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => {
      const key = a < b ? a * 100003 + b : b * 100003 + a;
      let m = cache.get(key);
      if (m === undefined) { const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2], l = Math.hypot(...p); m = v.push([p[0] / l, p[1] / l, p[2] / l]) - 1; cache.set(key, m); }
      return m;
    };
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
}

/** Lumpy rock: axes = semi-axes (km), rough = noise amplitude, pinch = waist (Eros), craters = count. */
export function rockGeometry({ axes = [1, 1, 1], seed = 1, subdiv = 4, rough = 0.18, pinch = 0, craters = 6 } = {}) {
  const { v, f } = icosphere(subdiv);
  const rng = (n) => { const s = Math.sin(seed * 91.7 + n * 12.9898) * 43758.5453; return s - Math.floor(s); };
  const cr = [];
  for (let k = 0; k < craters; k++) {
    const z = rng(k * 4) * 2 - 1, a = rng(k * 4 + 1) * Math.PI * 2, s = Math.sqrt(1 - z * z);
    cr.push({ d: [s * Math.cos(a), s * Math.sin(a), z], r: 0.18 + 0.4 * rng(k * 4 + 2) ** 2, depth: 0.05 + 0.1 * rng(k * 4 + 3) });
  }
  const pos = new Float32Array(v.length * 3);
  for (let i = 0; i < v.length; i++) {
    const [x, y, z] = v[i];
    let r = 1 + rough * (fbm3(x * 1.7 + seed, y * 1.7 + seed * 2, z * 1.7 - seed) * 2 - 0.5 - 0.5);
    for (const c of cr) {
      const d = Math.acos(Math.min(1, x * c.d[0] + y * c.d[1] + z * c.d[2])) / c.r;
      if (d < 1.25) r -= c.depth * (d < 1 ? (1 - d * d) : 0) - (d > 0.9 && d < 1.25 ? 0.2 * c.depth * Math.sin((d - 0.9) / 0.35 * Math.PI) : 0);
    }
    let px = x * r * axes[0], py = y * r * axes[1], pz = z * r * axes[2];
    if (pinch) { const k = 1 - pinch * Math.exp(-((x * r) ** 2) / 0.06); py *= k; pz *= k; }
    pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
  }
  const idx = new Uint32Array(f.length * 3);
  f.forEach((t, i) => { idx[i * 3] = t[0]; idx[i * 3 + 1] = t[1]; idx[i * 3 + 2] = t[2]; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const ROCK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj, vN, vWorld;
void main() {
  vObj = position;
  #ifdef USE_INSTANCING
    mat4 m = modelMatrix * instanceMatrix;
  #else
    mat4 m = modelMatrix;
  #endif
  vN = mat3(m) * normal;
  vec4 wp = m * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const ROCK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir, uAlbedo; uniform float uSunE, uBump, uSeed;
varying vec3 vObj, vN, vWorld;
float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float tex(vec3 p) { return 0.6 * vn(p) + 0.3 * vn(p * 2.7 + 5.0) + 0.1 * vn(p * 7.3 + 9.0); }
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vN);
  // Procedural micro-relief: finite-difference gradient of a noise field in object space.
  vec3 p = vObj * uBump + uSeed; float e = 0.05;
  float t0 = tex(p);
  vec3 g = vec3(tex(p + vec3(e, 0, 0)) - t0, tex(p + vec3(0, e, 0)) - t0, tex(p + vec3(0, 0, e)) - t0) / e;
  N = normalize(N - 0.18 * (g - N * dot(g, N)));
  vec3 L = normalize(uSunDir), V = normalize(-vWorld);
  float mu0 = max(dot(N, L), 0.0), mu = max(dot(N, V), 0.02);
  float ls = 2.0 * mu0 / (mu0 + mu + 1e-4) * step(0.0001, mu0) * 0.5 + 0.5 * mu0; // Lommel–Seeliger blended with Lambert
  vec3 alb = uAlbedo * (0.75 + 0.5 * t0);
  gl_FragColor = vec4(alb * ls * uSunE, 1.0);
}`;

export function rockMaterial({ albedo = [0.1, 0.095, 0.09], bump = 1.0, seed = 0 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunE: { value: 1 }, uAlbedo: { value: new THREE.Vector3(...albedo) },
      uBump: { value: bump }, uSeed: { value: seed },
    },
  });
}
