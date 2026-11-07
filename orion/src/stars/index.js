import * as THREE from 'three';
import { PC, AU, LY, R_SUN, DEG, smoothstep, clamp } from 'orion/core/units.js';
import { decodeHyg, describeStar } from 'orion/stars/decode.js';
import { buildColourLUT, bvToTeff, bvToRGB, starRadiusSolar } from 'orion/stars/color.js';
import { STAR_VERT, STAR_FRAG, DISC_VERT, DISC_FRAG } from 'orion/stars/shaders.js';

// Catalogue stars (spec §08): HYG v4.1 within 500 pc as GPU points with true positions, B–V colours, apparent
// magnitude from the real camera distance, energy-conserving PSF; named-star and constellation registry entries;
// optional constellation lines; lit disc when the camera is within 0.1 pc of a star.
// Sky layer is in parsecs. Star positions live as Float64 pc on the CPU; the GPU gets them relative to an anchor
// (the camera position when it last moved > 1 pc) and the Points object is placed at toSky(anchor).

const REBUILD_PC = 1;          // anchor refresh distance
const NEAR_PC = 0.1;           // lit-disc handover
const CANDIDATE_PC = 25;       // radius of the near-star candidate list around the anchor
const SUN_FADE_AU = [1500, 2500];
const LINE_COLOUR = [0.02, 0.42, 0.36]; // [O III] teal

export async function install(app) {
  const [buf, named, cons] = await Promise.all([
    app.assets.buffer('data/hyg.bin'), app.assets.json('data/stars-named.json'), app.assets.json('data/constellations.json'),
  ]);
  const shared = (app.shared.stars = { count: 0, ready: null, catalogue: null });
  if (!buf) { console.warn('[stars] data/hyg.bin missing'); shared.ready = Promise.resolve(); return; }
  const cat = decodeHyg(buf);
  const n = cat.count;
  shared.count = n; shared.catalogue = cat;
  shared.ready = Promise.resolve();

  // ---- GPU objects -------------------------------------------------------------------------------------------
  const rel = new Float32Array(n * 3);
  const posAttr = new THREE.BufferAttribute(rel, 3).setUsage(THREE.DynamicDrawUsage);
  const shell = new Float32Array(n);
  for (let i = 0; i < n; i++) shell[i] = Math.hypot(cat.pos[i * 3], cat.pos[i * 3 + 1], cat.pos[i * 3 + 2]) > 470 ? 1 : 0;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aAbsMag', new THREE.BufferAttribute(cat.absMag, 1));
  geo.setAttribute('aBV', new THREE.BufferAttribute(cat.bv, 1));
  geo.setAttribute('aShell', new THREE.BufferAttribute(shell, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const lutData = buildColourLUT(1024);
  const lut = new THREE.DataTexture(lutData, 1024, 1, THREE.RGBAFormat, THREE.FloatType);
  lut.minFilter = lut.magFilter = THREE.NearestFilter; lut.needsUpdate = true;

  const uniforms = {
    tLut: { value: lut }, uSigma0: { value: 1.3 }, uGain: { value: 1 }, uLevel: { value: 1 }, uSunFade: { value: 1 },
    uShellFade: { value: 1 }, uNearIdx: { value: -1 }, uNearFade: { value: 0 }, uLimit: { value: 1.2e-3 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = 10; points.name = 'catalogue-stars';
  app.layers.sky.add(points);

  // Constellation lines share the position buffer (indexed segments).
  let lines = null;
  if (cons?.length) {
    const idx = [];
    for (const c of cons) for (const [a, b] of c.lines) idx.push(a, b);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', posAttr);
    lg.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    lg.boundingSphere = geo.boundingSphere;
    const lm = new THREE.LineBasicMaterial({
      color: new THREE.Color().setRGB(LINE_COLOUR[0], LINE_COLOUR[1], LINE_COLOUR[2], THREE.LinearSRGBColorSpace),
      transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    });
    lines = new THREE.LineSegments(lg, lm);
    lines.frustumCulled = false; lines.renderOrder = 9; lines.visible = false; lines.name = 'constellation-lines';
    app.layers.sky.add(lines);
  }

  // Lit disc for the nearest star inside NEAR_PC.
  const discMat = new THREE.ShaderMaterial({
    uniforms: { uRadius: { value: 1e-8 }, uColor: { value: new THREE.Vector3(1, 1, 1) }, uBright: { value: 1 }, uEdge: { value: 0.05 }, uAlpha: { value: 0 } },
    vertexShader: DISC_VERT, fragmentShader: DISC_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), discMat);
  disc.frustumCulled = false; disc.visible = false; disc.renderOrder = 11; disc.name = 'star-disc';
  app.layers.sky.add(disc);

  // ---- anchor management --------------------------------------------------------------------------------------
  const anchor = new Float64Array(3), anchorM = new Float64Array(3);
  let anchorValid = false;
  let candidates = new Int32Array(0);
  function rebuild(cx, cy, cz) {
    anchor[0] = cx; anchor[1] = cy; anchor[2] = cz;
    anchorM[0] = cx * PC; anchorM[1] = cy * PC; anchorM[2] = cz * PC;
    const p = cat.pos;
    const near = [];
    for (let i = 0; i < n; i++) {
      const x = p[i * 3] - cx, y = p[i * 3 + 1] - cy, z = p[i * 3 + 2] - cz;
      rel[i * 3] = x; rel[i * 3 + 1] = y; rel[i * 3 + 2] = z;
      if (i > 0 && x * x + y * y + z * z < CANDIDATE_PC * CANDIDATE_PC) near.push(i);
    }
    candidates = Int32Array.from(near);
    posAttr.needsUpdate = true;
    anchorValid = true;
  }

  // ---- registry ----------------------------------------------------------------------------------------------
  const conName = {};
  if (cons) for (const c of cons) conName[c.abbr] = c.name;
  const sunPos = new Float64Array(3);
  if (named) {
    for (const s of named) {
      const i = s.i;
      const wm = new Float64Array([s.pos[0] * PC, s.pos[1] * PC, s.pos[2] * PC]);
      const M = cat.absMag[i];
      const R = s.far ? 0 : starRadiusSolar(M, bvToTeff(cat.bv[i])) * R_SUN;
      const distLy = s.far && s.distPc ? s.distPc * PC / LY : Math.hypot(...s.pos) * PC / LY;
      const trueDistLy = s.distPc ? s.distPc * PC / LY : distLy;
      const entry = {
        id: s.id, name: s.name, aliases: s.aliases, type: 'star', parent: 'orion-spur', level: 2, priority: 40,
        radius: R, surfaceMinFactor: R > 0 ? Math.max(1.01, 1e10 / R) : undefined,
        viewDistance: Math.max(R * 120, 5e10, 2e9),
        position(jd, out) { out[0] = wm[0]; out[1] = wm[1]; out[2] = wm[2]; return out; },
        apparentMag(camPos) {
          const d = Math.max(Math.hypot(wm[0] - camPos[0], wm[1] - camPos[1], wm[2] - camPos[2]) / PC, 1e-12);
          return M + 5 * Math.log10(d / 10);
        },
        info: {
          description: describeStar(s, conName[s.con], trueDistLy),
          spectralType: s.spect || undefined, magnitude: +s.mag.toFixed(2), distanceLy: +trueDistLy.toFixed(trueDistLy < 100 ? 2 : 0),
          kind: 'star',
        },
      };
      if (entry.surfaceMinFactor === undefined) delete entry.surfaceMinFactor;
      app.registry.add(entry);
    }
  }
  if (cons) {
    for (const c of cons) {
      let sx = 0, sy = 0, sz = 0, k = 0;
      const seen = new Set();
      for (const [a, b] of c.lines) for (const i of [a, b]) {
        if (seen.has(i)) continue; seen.add(i);
        const x = cat.pos[i * 3], y = cat.pos[i * 3 + 1], z = cat.pos[i * 3 + 2], d = Math.hypot(x, y, z) || 1;
        sx += x / d; sy += y / d; sz += z / d; k++;
      }
      const L = Math.hypot(sx, sy, sz) || 1;
      const wm = new Float64Array([sx / L * 100 * PC, sy / L * 100 * PC, sz / L * 100 * PC]);
      app.registry.add({
        id: 'constellation-' + c.id, name: c.name, aliases: [c.abbr, c.name + ' constellation'], type: 'constellation',
        parent: 'orion-spur', level: 2, priority: 35, radius: 0, viewDistance: 150 * PC,
        position(jd, out) { out[0] = wm[0]; out[1] = wm[1]; out[2] = wm[2]; return out; },
        info: { description: `The constellation ${c.name} (${c.abbr}), drawn here as a stick figure of ${seen.size} catalogue stars. Lines follow the true 3D positions, so the figure only looks right from the Sun.`, kind: 'constellation' },
      });
    }
  }

  // ---- per-frame ---------------------------------------------------------------------------------------------
  const camPc = new Float64Array(3);
  let discBright = 1;
  app.onFrame((f) => {
    const cm = f.camPos;
    camPc[0] = cm[0] / PC; camPc[1] = cm[1] / PC; camPc[2] = cm[2] / PC;
    if (!anchorValid || Math.hypot(camPc[0] - anchor[0], camPc[1] - anchor[1], camPc[2] - anchor[2]) > REBUILD_PC) rebuild(camPc[0], camPc[1], camPc[2]);

    const lv = f.levels;
    const w = clamp(lv[1] + lv[2] + lv[3] + lv[4], 0, 1);   // catalogue stars live in L1–L4
    const dSunPc = f.dSun / PC;
    uniforms.uLevel.value = w;
    uniforms.uGain.value = Math.max(app.graph?.exposure?.sky ?? 1, 0.03);
    uniforms.uSigma0.value = clamp(1.3 * f.viewport.h / 1080, 1.3, 3.0);
    uniforms.uSunFade.value = smoothstep(SUN_FADE_AU[0] * AU, SUN_FADE_AU[1] * AU, f.dSun);
    uniforms.uShellFade.value = 1 - smoothstep(20, 120, dSunPc);
    points.visible = w > 0.001;
    app.toSky(anchorM, points.position);

    // Constellation lines: only meaningful from near the Sun.
    if (lines) {
      const on = !!app.settings.constellations && w > 0.001;
      lines.visible = on;
      if (on) {
        lines.material.opacity = 0.22 * w * (1 - smoothstep(20, 150, dSunPc));
        lines.visible = lines.material.opacity > 0.002;
        lines.position.copy(points.position);
      }
    }

    // Nearest candidate star → lit disc under NEAR_PC.
    let best = -1, bestD = NEAR_PC;
    const p = cat.pos;
    for (let k = 0; k < candidates.length; k++) {
      const i = candidates[k];
      const d = Math.hypot(p[i * 3] - camPc[0], p[i * 3 + 1] - camPc[1], p[i * 3 + 2] - camPc[2]);
      if (d < bestD) { bestD = d; best = i; }
    }
    let nearFade = 0;
    if (best >= 0 && w > 0.001) {
      const M = cat.absMag[best], bv = cat.bv[best];
      const T = bvToTeff(bv), Rpc = starRadiusSolar(M, T) * R_SUN / PC;
      const pxPerRad = f.viewport.h / (2 * Math.tan(f.fovY * DEG / 2));
      const rPx = Math.atan2(Rpc, bestD) * pxPerRad;
      nearFade = smoothstep(1.0, 3.0, rPx);
      if (nearFade > 0.001 && bestD > Rpc * 1.0005) {
        const m = M + 5 * Math.log10(Math.max(bestD, 1e-12) / 10);
        const flux = Math.pow(10, -0.4 * m);
        const s0 = uniforms.uSigma0.value;
        // same integrated energy as the point sprite: 6π σ0² flux spread over π r²
        discBright = (6 * s0 * s0 * flux) / Math.max(rPx * rPx, 1e-6);
        const du = discMat.uniforms;
        du.uRadius.value = Rpc; du.uBright.value = discBright; du.uAlpha.value = nearFade * w;
        du.uEdge.value = clamp(1.5 / Math.max(rPx, 1), 0.02, 0.6);
        const c = bvToRGB(bv); du.uColor.value.set(c[0], c[1], c[2]);
        disc.position.set(p[best * 3] - camPc[0], p[best * 3 + 1] - camPc[1], p[best * 3 + 2] - camPc[2]);
        disc.visible = true;
      } else disc.visible = false;
    } else disc.visible = false;
    uniforms.uNearIdx.value = disc.visible ? best : -1;
    uniforms.uNearFade.value = disc.visible ? nearFade : 0;
  }, 0);

  shared.nearestStar = () => ({ index: uniforms.uNearIdx.value });
  console.info(`[stars] ${n} catalogue stars, ${named?.length ?? 0} named, ${cons?.length ?? 0} constellations`);
}
