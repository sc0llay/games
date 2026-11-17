import * as THREE from 'three';
import { TextureGenerator, PhotoLibrary, freeTexture } from 'orion/render/bodies/textures.js';
import { ATMOS, atmosphereUniforms, AtmosphereSystem } from 'orion/render/bodies/atmosphere.js';
import { createSurfaceMaterial, createCloudMaterial, createPhobosMaterial } from 'orion/render/bodies/surface.js';
import { createGiantAurora, hasGiantAurora } from 'orion/render/bodies/giantAurora.js';
import { createSun, createSunGlow } from 'orion/render/bodies/sun.js';
import {
  AU_KM, SUN_RADIUS_KM, MAX_SPOTS, sunspotGroups, solarActivity, solarCyclePhase,
  lambertPhase, reflectedFlux, apparentMagnitude, starPeak, pickOccluders, pixelDiameter,
  nearFrustum, photoStage, COLOR_PX,
} from 'orion/render/bodies/math.js';

// Bodies renderer (spec §09): Sun, planets, moons, dwarf planets with procedural GPU-generated surfaces,
// raymarched atmospheres, an Earth cloud shell, gas-giant bands, eclipses and sub-pixel point sprites.

const J2000 = 2451545;
const SKIP = new Set(['phobos', 'deimos']);
const GAS = { jupiter: [0, 20], saturn: [1, 15], uranus: [2, 40], neptune: [3, 30], venus: [4, 0.35], titan: [5, 20] };
const TEX_STYLE = {
  earth: 'earth', moon: 'moon', mercury: 'mercury', mars: 'mars', io: 'io', europa: 'europa', ganymede: 'ganymede',
  callisto: 'callisto', pluto: 'pluto', iapetus: 'iapetus', enceladus: 'enceladus',
};
const RELIEF = { earth: 11.7, moon: 40, mars: 32 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lin2srgb8 = (c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));

function sphereGeometry(w, h) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.rotateX(Math.PI / 2); // pole along +z (body-fixed north)
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  return g;
}

function placeholder(rgb, srgb) {
  const t = new THREE.DataTexture(new Uint8Array(rgb), 1, 1, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

const SPRITE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aColor;
uniform float uPx;
varying vec3 vCol;
void main() {
  vCol = aColor;
  gl_PointSize = uPx;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const SPRITE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vCol;
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = (gl_PointCoord - 0.5) * 2.0;
  float g = exp(-dot(q, q) * 3.0);
  gl_FragColor = vec4(vCol * g, 0.0);
}`;

export async function install(app) {
  const eph = app.shared.ephemeris;
  if (!eph) throw new Error('bodies: ephemeris module is not installed');
  const scene = app.layers.system;
  const renderer = app.renderer;

  let ringApi = app.shared.ringProfile;
  if (!ringApi?.getRingProfile) {
    try { ringApi = await import('orion/render/small/ringProfile.js'); } catch { ringApi = null; }
  }

  const lods = [sphereGeometry(24, 16), sphereGeometry(48, 32), sphereGeometry(96, 64), sphereGeometry(192, 128), sphereGeometry(256, 160)];
  const shellGeo = sphereGeometry(48, 32);
  const emptyRing = placeholder([0, 0, 0, 0], false);
  let tg = null;
  const photos = await new PhotoLibrary(renderer, app.assets).init();   // photographic maps (procedural fallback)
  const blank = placeholder([0, 0, 0, 255], false);
  const atmos = new AtmosphereSystem(app, scene, shellGeo); // Hillaire LUT atmospheres + Earth aurora

  // ---- body records ---------------------------------------------------------------------------------------------
  const recs = [];
  for (const b of eph.BODIES) {
    if (b.type === 'sun' || SKIP.has(b.id)) continue;
    const req = b.equatorialRadius / 1e3, rpol = b.polarRadius / 1e3;
    const gas = GAS[b.id];
    const kind = gas ? 'gas' : b.id === 'earth' ? 'earth' : 'rock';
    const col = b.colour || [0.4, 0.4, 0.4];
    const U = {
      uRot: { value: new THREE.Matrix3() }, uScale: { value: new THREE.Vector3(req, req, rpol) },
      uSunObj: { value: new THREE.Vector3(1, 0, 0) }, uCamObj: { value: new THREE.Vector3(0, 0, 1e6) },
      uSunDist: { value: AU_KM }, uSunR: { value: SUN_RADIUS_KM }, uIrr: { value: 1 }, uFade: { value: 1 },
      uOccAtm: { value: 0 }, uDrift: { value: 0 }, uRelief: { value: RELIEF[b.id] ?? 0.02 * req }, uExag: { value: b.id === 'earth' ? 2 : 1 },
      uDetail: { value: 0 }, uGasT: { value: gas ? gas[1] : 1 }, uGas: { value: gas ? gas[0] : 0 }, uHasRing: { value: 0 }, uSeed: { value: 0 },
      uOcc: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uAnim: { value: new THREE.Vector4() }, uRingR: { value: new THREE.Vector2(1, 2) }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
      tColor: { value: placeholder([lin2srgb8(col[0]), lin2srgb8(col[1]), lin2srgb8(col[2]), 0], true) },
      tData: { value: placeholder([127, 128, 0, 0], false) },
      tRing: { value: emptyRing },
      // photographic maps (surface.js PHOTO paths)
      tNight: { value: blank }, tClouds: { value: blank }, tSpec: { value: blank }, tNormal: { value: blank }, tHeight: { value: blank },
      uAlbScale: { value: 1 }, uUOff: { value: 0 }, uNormK: { value: 0.35 }, uHTexel: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
      uTintA: { value: new THREE.Vector3(1, 1, 1) }, uTintB: { value: new THREE.Vector3(1, 1, 1) }, uFill: { value: new THREE.Vector3() },
    };
    const atmKey = ATMOS[b.id] ? b.id : null;
    if (atmKey) Object.assign(U, atmosphereUniforms(ATMOS[atmKey]));
    const rec = {
      id: b.id, b, kind, U, req, rpol, atmKey, maps: null, queued: false,
      pos: new Float64Array(3), q: new THREE.Quaternion(), px: 0, lod: -1, vis: false,
      occR: req * (b.id === 'earth' ? 1.015 : b.atmosphere ? 1.01 : 1),
      albedo: Math.min(1, (b.albedo || 0.2) * 1.3), colour: col,
      spriteIdx: recs.length,
    };
    rec.atmoTint = !!atmKey && kind === 'rock' && !!ATMOS[atmKey].tint;
    rec.surface = new THREE.Mesh(lods[0], createSurfaceMaterial(kind, U, rec.atmoTint));
    rec.surface.scale.set(req, req, rpol); rec.surface.frustumCulled = false;
    scene.add(rec.surface);
    if (kind === 'earth') {
      rec.cloud = new THREE.Mesh(lods[0], createCloudMaterial(U));
      rec.cloud.scale.set(req * 1.0015, req * 1.0015, rpol * 1.0015); rec.cloud.frustumCulled = false; rec.cloud.renderOrder = 10;
      scene.add(rec.cloud);
    }
    if (atmKey) atmos.add(rec);
    if (hasGiantAurora(b.id)) { rec.gaur = createGiantAurora(app, U, lods[2], rec); scene.add(rec.gaur.mesh); }
    if (ringApi?.getRingProfile && (b.rings || b.id === 'saturn')) {
      try {
        const rp = ringApi.getRingProfile(b.id);
        if (rp) { U.tRing.value = rp.texture; U.uRingR.value.set(rp.innerKm, rp.outerKm); U.uHasRing.value = 1; }
      } catch (e) { console.warn('[bodies] ring profile', b.id, e); }
    }
    recs.push(rec);
  }

  // ---- Sun ------------------------------------------------------------------------------------------------------
  const sun = createSun(lods[3]);
  sun.mesh.scale.setScalar(SUN_RADIUS_KM);
  sun.corona.scale.setScalar(SUN_RADIUS_KM * 14);
  scene.add(sun.mesh); scene.add(sun.corona);
  const glow = createSunGlow(); scene.add(glow.points);
  const sunPos = new Float64Array(3), sunQ = new THREE.Quaternion();
  const spotBuf = new Float32Array(MAX_SPOTS * 4);

  // ---- sprites (sub-pixel bodies) -------------------------------------------------------------------------------
  const nSpr = recs.length + 1;
  const sprPos = new Float32Array(nSpr * 3), sprCol = new Float32Array(nSpr * 3);
  const sprGeo = new THREE.BufferGeometry();
  sprGeo.setAttribute('position', new THREE.BufferAttribute(sprPos, 3).setUsage(THREE.DynamicDrawUsage));
  sprGeo.setAttribute('aColor', new THREE.BufferAttribute(sprCol, 3).setUsage(THREE.DynamicDrawUsage));
  sprGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e20);
  const sprites = new THREE.Points(sprGeo, new THREE.ShaderMaterial({
    vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG, uniforms: { uPx: { value: 4 } },
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));
  sprites.frustumCulled = false; sprites.renderOrder = 30;
  scene.add(sprites);

  // ---- per-frame --------------------------------------------------------------------------------------------------
  const cands = recs.map((r) => ({ id: r.id, pos: r.pos, radiusKm: r.occR }));
  const occBuf = new Float64Array(16);
  const _m4 = new THREE.Matrix4(), _qi = new THREE.Quaternion(), _v = new THREE.Vector3(), _p = new THREE.Vector3();

  function generateMaps(rec, ts) {
    tg ??= new TextureGenerator(renderer);
    const style = TEX_STYLE[rec.id] || 'generic';
    const big = rec.id === 'earth' || rec.id === 'moon';
    const w = Math.min(big ? 2048 : 1024, ts.maxTexture || 1024), h = w / 2;
    const c = rec.colour;
    const spec = { colA: c.map((x) => x * 0.8), colB: c.map((x) => Math.min(1, x * 1.5)), crater: 0.4, patch: 0.5, seed: rec.id.length * 3.7 };
    // Baked in horizontal bands over several frames (tg.pump from update); bound once complete, unless the photo maps
    // got there first, in which case the procedural targets are never used and are freed at once.
    rec.maps = tg.generate(style, w, h, spec, 4, (maps) => {
      if (rec.maps !== maps) { disposeMaps(maps); return; }
      if (rec.proceduralDone) { disposeMaps(maps); rec.maps = {}; return; }
      rec.U.tColor.value = maps.color.texture; rec.U.tData.value = maps.data.texture;
      rec.U.uTexel.value.set(1 / w, 1 / h);
    });
  }
  const disposeMaps = (m) => { m?.color?.dispose?.(); m?.data?.dispose?.(); };
  // Once photographic colour (and clouds, where the body has a shell) are bound nothing samples the procedural bake.
  function dropProcedural(rec, ph) {
    if (!rec.maps || !rec.maps.color || rec.proceduralDone) return;
    if (!ph.photo || (rec.cloud && !ph.cloudPhoto)) return;
    rec.proceduralDone = true;
    if (rec.maps.ready) { disposeMaps(rec.maps); rec.U.tData.value = placeholder([127, 128, 0, 0], false); rec.maps = {}; }
  }

  // ---- photographic maps ------------------------------------------------------------------------------------------
  // Streamed by on-screen size and visibility: colour map at >= COLOR_PX, secondary maps at >= DETAIL_PX, only while the
  // body is in or near the view. Texture caps follow the quality tier; a tier change evicts hidden bodies at once and
  // reloads visible ones at the new size. Procedural (or placeholder) surfaces stand in until the photo maps arrive.
  const PH_KEYS = ['color', 'night', 'clouds', 'spec', 'normal', 'height'];
  const flatNormal = placeholder([128, 128, 255, 255], false);
  for (const r of recs) r.U.tNormal.value = flatNormal;
  const compileScene = new THREE.Scene();
  // Compile `mat` off the render path (KHR_parallel_shader_compile) so swapping it in does not stall a frame.
  function precompile(mesh, mat) {
    if (typeof renderer.compileAsync !== 'function') return Promise.resolve();
    const t = new THREE.Mesh(mesh.geometry, mat);
    compileScene.add(t);
    return Promise.resolve().then(() => renderer.compileAsync(compileScene, app.cameras.system)).catch(() => {}).then(() => { compileScene.remove(t); });
  }
  function phState(rec) { return rec.ph ??= { gen: 0, busy: false, tex: {}, caps: {}, failed: new Set(), photo: null, entry: photos.entry(rec.id) }; }
  const capSig = (c) => PH_KEYS.map((k) => c[k]).join('/');

  function applyPhotos(rec, ph, ts) {
    const e = ph.entry, U = rec.U, T = ph.tex, mean = e.mean || [0.5, 0.5, 0.5];
    if (!T.color) return;
    const photo = { height: !!T.height, tint: !!e.tint };
    const needMat = !ph.photo || ph.photo.height !== photo.height;
    const needCloud = rec.cloud && T.clouds && !ph.cloudPhoto;
    const mat = needMat ? createSurfaceMaterial(rec.kind, U, rec.atmoTint, photo) : null;
    const cmat = needCloud ? createCloudMaterial(U, true) : null;
    const gen = ph.gen;
    const ready = Promise.all([mat && precompile(rec.surface, mat), cmat && precompile(rec.cloud, cmat)]);
    ready.then(() => {
      if (ph.gen !== gen || rec.ph !== ph) { mat?.dispose(); cmat?.dispose(); return; }   // evicted / superseded while compiling
      U.tColor.value = T.color;
      if (T.night) U.tNight.value = T.night;
      if (T.clouds) U.tClouds.value = T.clouds;
      if (T.spec) U.tSpec.value = T.spec;
      if (T.normal) U.tNormal.value = T.normal;
      if (T.height) { U.tHeight.value = T.height; U.uHTexel.value.set(1 / T.height.userData.hw, 1 / T.height.userData.hh); }
      U.uAlbScale.value = Math.min(e.scale ?? 1, 0.85 / Math.max(...mean, 1e-3));
      rec.uOff0 = -0.5 - (e.lon0 ?? -180) / 360; U.uUOff.value = rec.uOff0;
      if (e.tint) { U.uTintA.value.set(...e.tint[0]); U.uTintB.value.set(...e.tint[1]); }
      if (e.nodata) { const g = e.tint ? mean[0] : 0; e.tint ? U.uFill.value.setScalar(g) : U.uFill.value.set(...mean); }
      rec.grsU = e.grsU;
      if (mat) { rec.surface.material.dispose(); rec.surface.material = mat; ph.photo = photo; }
      if (cmat) { rec.cloud.material.dispose(); rec.cloud.material = cmat; ph.cloudPhoto = true; }
      dropProcedural(rec, ph);
    });
  }

  // Free every GPU texture of a body and put its procedural/placeholder surface back.
  function evictPhotos(rec) {
    const ph = rec.ph; if (!ph) return;
    ph.gen++;                                   // in-flight loads and compiles for the old state are discarded
    for (const k of PH_KEYS) freeTexture(ph.tex[k]);
    const U = rec.U;
    U.tColor.value = placeholder([0, 0, 0, 0], true); U.tNight.value = U.tClouds.value = U.tSpec.value = U.tHeight.value = blank; U.tNormal.value = flatNormal;
    rec.proceduralDone = false;
    if (ph.photo) { rec.surface.material.dispose(); rec.surface.material = createSurfaceMaterial(rec.kind, U, rec.atmoTint); }
    if (ph.cloudPhoto) { rec.cloud.material.dispose(); rec.cloud.material = createCloudMaterial(U); }
    rec.ph = null; rec.uOff0 = undefined;
  }

  // Load whatever `stage` calls for that is missing or at the wrong size. Returns true if a load was started.
  function requestPhotos(rec, stage, ts, tier) {
    const ph = phState(rec), e = ph.entry;
    if (ph.busy || ph.dead) return false;
    const caps = photos.caps(rec.id, ts, tier);
    const keys = PH_KEYS.filter((k) => e.maps[k] && (stage >= 2 || k === 'color') && !ph.failed.has(k) && (!ph.tex[k] || ph.caps[k] !== caps[k]));
    if (!keys.length) return false;
    ph.busy = true;
    const gen = ph.gen;
    photos.loadMaps(rec.id, keys, caps).then(({ tex, errors }) => {
      ph.busy = false;
      if (ph.gen !== gen || rec.ph !== ph) { for (const k in tex) freeTexture(tex[k]); return; }   // superseded: do not leak
      for (const k in errors) {
        console.warn('[bodies] photo map', rec.id, k, 'failed', errors[k]);
        ph.failed.add(k);
        if (k === 'color' && !ph.tex.color) { ph.dead = true; if (rec.kind !== 'gas' && !rec.maps) { rec.maps = {}; generateMaps(rec, ts); } }
      }
      const old = [];
      for (const k in tex) {
        if (ph.tex[k]) old.push(ph.tex[k]);
        ph.tex[k] = tex[k]; ph.caps[k] = caps[k];
        if (k === 'height') { tex[k].userData.hw = tex[k].image.width; tex[k].userData.hh = tex[k].image.height; }
      }
      if (ph.tex.color) applyPhotos(rec, ph, ts);
      // the replaced (old-size) textures are still bound until applyPhotos' swap; free them a little later
      if (old.length) setTimeout(() => { for (const t of old) freeTexture(t); }, 1500);
    });
    return true;
  }
  // Old behaviour for bodies without photographs: procedural maps once the body is a few pixels wide.
  function requestMaps(rec, ts) {
    rec.maps = {}; if (rec.kind !== 'gas') generateMaps(rec, ts);
  }
  app.quality?.addEventListener?.('tier', () => {
    const tier = app.quality.tier, ts = app.quality.settings;
    for (const r of recs) {
      const ph = r.ph; if (!ph) continue;
      const caps = photos.caps(r.id, ts, tier);
      const lowered = PH_KEYS.some((k) => ph.tex[k] && caps[k] < ph.caps[k]);
      // Hidden or tiny bodies are evicted now; visible ones keep their maps and are swapped for the new size in update().
      if (lowered && (!r.surface.visible || r.px < COLOR_PX)) evictPhotos(r);
      else ph.failed.clear();
    }
  });

  // Texture u offset that puts Jupiter's Great Red Spot at its System II longitude (drifts ~21 deg/yr; about
  // 45 deg II in mid 2023). System III - II = 241.65 + 0.266 d deg; body east longitude = -lambda_III.
  function grsOffset(days, grsU) {
    const yr = 2000 + days / 365.25;
    const l2 = 45 + 21 * (yr - 2023.5);
    const l3 = l2 + 241.65 + 0.266 * days;
    const lonE = -l3;
    const u = grsU - (lonE + 180) / 360;
    return u - Math.floor(u);
  }
  // Phobos is drawn by render/small (mesh 'rock-phobos'); give it the photographic map once that mesh exists.
  let phobos = photos.entry('phobos') ? { tries: 0, done: false } : { done: true };
  function phobosMaterial(f) {
    if (phobos.done || (phobos.tries++ % 60)) return;
    const mesh = scene.getObjectByName('rock-phobos');
    if (!mesh) { if (phobos.tries > 60 * 60) phobos.done = true; return; }
    phobos.done = true;
    photos.load('phobos', f.tierSettings, f.tier).then((m) => {
      mesh.material = createPhobosMaterial(mesh.material, m.color, m.entry);
    }).catch((err) => console.warn('[bodies] phobos map', err));
  }

  const earthR = (recs.find((x) => x.id === 'earth') || { occR: -1 }).occR;

  function update(f) {
    tg?.pump(1);
    const jd = f.jd, days = jd - J2000, cam = f.camPos;
    const lvl = Math.min(1, Math.max(0, f.levels[3] + f.levels[4]));
    const hPx = f.viewport.h, fov = f.fovY * Math.PI / 180; // core stores degrees
    const sysE = app.graph.exposure?.sys || 1, skyE = app.graph.exposure?.sky || 1;
    const gain = skyE / sysE;

    // Sun
    eph.heliocentric('sun', jd, sunPos);
    const sdx = sunPos[0] - cam[0], sdy = sunPos[1] - cam[1], sdz = sunPos[2] - cam[2];
    const sKm = Math.hypot(sdx, sdy, sdz) / 1e3;
    const sPx = pixelDiameter(SUN_RADIUS_KM, sKm, fov, hPx);
    const sunVis = lvl > 0.003 && sPx > 0.7;
    sun.mesh.visible = sunVis; sun.corona.visible = lvl > 0.003 && sPx > 3;
    if (sunVis) {
      eph.bodyQuaternion('sun', jd, sunQ);
      app.toSystem(sunPos, sun.mesh.position); sun.mesh.quaternion.copy(sunQ);
      sun.corona.position.copy(sun.mesh.position); sun.corona.quaternion.copy(app.cameras.system.quaternion);
      _qi.copy(sunQ).invert();
      sun.uniforms.uCamObj.value.set(cam[0] - sunPos[0], cam[1] - sunPos[1], cam[2] - sunPos[2]).multiplyScalar(1e-3).applyQuaternion(_qi);
      // Cap the disc's displayed radiance while it is a few px wide (system scale) so the threshold-free bloom stays
      // tight; the cap grows exponentially with size and no longer binds by ~40 px, where the true radiance returns.
      const rMax = 200 * Math.exp(Math.max(0, sPx - 3) / 4);   // displayed radiance cap per pixel
      const kSun = Math.min(1, rMax / (4.6e4 * sysE));
      sun.uniforms.uTime.value = f.time; sun.uniforms.uFade.value = lvl * smooth(0.7, 1.5, sPx) * kSun;
      sunspotGroups(jd, spotBuf);
      const sp = sun.uniforms.uSpots.value;
      for (let i = 0; i < MAX_SPOTS; i++) sp[i].set(spotBuf[i * 4], spotBuf[i * 4 + 1], spotBuf[i * 4 + 2], spotBuf[i * 4 + 3]);
      const cu = sun.coronaUniforms;
      cu.uFade.value = lvl * smooth(3, 8, sPx) * Math.min(1, kSun * 30); cu.uDays.value = days;
      cu.uAct.value = solarActivity(solarCyclePhase(jd));
      // pole direction in camera space (rotate world pole by the inverse camera orientation)
      _v.set(0, 0, 1).applyQuaternion(sunQ).applyQuaternion(_qi.copy(app.cameras.system.quaternion).invert());
      const l2 = Math.hypot(_v.x, _v.y) || 1; cu.uAxis.value.set(_v.x / l2, _v.y / l2);
    }
    // system-scale glow: fixed pixel size and displayed brightness; fades out as the disc and corona take over
    {
      const gw = lvl > 0.003 ? 1 - smooth(12, 40, sPx) : 0;
      glow.points.visible = gw > 0.001;
      if (glow.points.visible) {
        app.toSystem(sunPos, glow.points.position);
        // pull the point in front of the photosphere so the Sun's own depth does not hide it
        const gp = glow.points.position, gl = gp.length();
        if (gl > SUN_RADIUS_KM * 1.02) gp.multiplyScalar(1 - SUN_RADIUS_KM * 1.02 / gl);
        const dpr = renderer.getPixelRatio();
        glow.uniforms.uPx.value = Math.round(72 * dpr);
        glow.uniforms.uCore.value = Math.max(1.0, 0.5 * sPx) * dpr;
        glow.uniforms.uGain.value = gw * lvl / sysE;
      }
    }
    // the Sun's slot in the sub-pixel sprite buffer stays dark: the glow above covers that range
    { const o = (nSpr - 1) * 3; sprCol[o] = sprCol[o + 1] = sprCol[o + 2] = 0; }

    // positions, rotations
    for (const r of recs) { eph.heliocentric(r.id, jd, r.pos); }
    let genBudget = 1;
    phobosMaterial(f);
    for (const r of recs) {
      const dx = r.pos[0] - cam[0], dy = r.pos[1] - cam[1], dz = r.pos[2] - cam[2];
      const dKm = Math.hypot(dx, dy, dz) / 1e3;
      const px = pixelDiameter(r.req, dKm, fov, hPx);
      r.px = px;
      const o = r.spriteIdx * 3;
      // sprite brightness: apparent magnitude from phase and distance
      const sw = lvl > 0.003 ? 1 - smooth(1.0, 2.5, px) : 0;
      if (sw > 0.001 && px < 3) {
        const rS = Math.hypot(r.pos[0], r.pos[1], r.pos[2]) / 1e3;
        const c = ((-r.pos[0]) * (-dx) + (-r.pos[1]) * (-dy) + (-r.pos[2]) * (-dz)) / (rS * 1e3 * dKm * 1e3);
        const alpha = Math.acos(Math.min(1, Math.max(-1, c)));
        const mag = apparentMagnitude(reflectedFlux(r.albedo, r.req, dKm, rS, alpha));
        const a = starPeak(mag) * gain * sw * lvl;
        sprPos[o] = dx / 1e3; sprPos[o + 1] = dy / 1e3; sprPos[o + 2] = dz / 1e3;
        const m = Math.max(r.colour[0], r.colour[1], r.colour[2], 1e-3);
        sprCol[o] = a * r.colour[0] / m; sprCol[o + 1] = a * r.colour[1] / m; sprCol[o + 2] = a * r.colour[2] / m;
      } else sprCol[o] = sprCol[o + 1] = sprCol[o + 2] = 0;

      const show = lvl > 0.003 && px > 0.7;
      r.surface.visible = show;
      if (r.cloud) r.cloud.visible = show;
      if (r.atm) r.atm.visible = show;
      if (r.gaur && !show) r.gaur.mesh.visible = false;
      if (!show) continue;
      const U = r.U;
      // Angular frustum test (against the half-diagonal, 25% margin): bodies outside it keep streaming their maps ready
      // but skip the LUT bake, occluder pick and every draw this frame.
      const ang = Math.asin(Math.min(1, r.req / Math.max(dKm, r.req)));
      _v.set(dx, dy, dz).normalize(); _p.set(0, 0, -1).applyQuaternion(f.camQuat);
      const off = Math.acos(Math.min(1, Math.max(-1, _v.dot(_p))));
      const inView = dKm <= r.req * 1.5 || nearFrustum(off, ang, fov / 2, f.viewport.w / f.viewport.h);
      if (photos.entry(r.id)) {
        const stage = photoStage(px, inView);
        if (stage && genBudget > 0 && requestPhotos(r, stage, f.tierSettings, f.tier)) genBudget--;
      } else if (!r.maps && px > 6 && inView && genBudget > 0) { requestMaps(r, f.tierSettings); genBudget--; }
      if (!inView) {
        r.surface.visible = false;
        if (r.cloud) r.cloud.visible = false;
        if (r.atm) r.atm.visible = false;
        if (r.gaur) r.gaur.mesh.visible = false;
        continue;
      }
      if (r.uOff0 !== undefined) {
        if (r.grsU !== undefined) U.uUOff.value = grsOffset(days, r.grsU);
        else if (r.id === 'venus') { const u = r.uOff0 + 1.30 * days / (2 * Math.PI); U.uUOff.value = u - Math.floor(u); }
      }

      eph.bodyQuaternion(r.id, jd, r.q);
      app.toSystem(r.pos, r.surface.position);
      r.surface.quaternion.copy(r.q);
      if (r.cloud) { r.cloud.position.copy(r.surface.position); r.cloud.quaternion.copy(r.q); }
      if (r.atm) { r.atm.position.copy(r.surface.position); r.atm.quaternion.copy(r.q); }
      U.uRot.value.setFromMatrix4(_m4.makeRotationFromQuaternion(r.q));
      _qi.copy(r.q).invert();
      U.uCamObj.value.set(-dx, -dy, -dz).multiplyScalar(1e-3).applyQuaternion(_qi);
      const sd = Math.hypot(r.pos[0], r.pos[1], r.pos[2]);
      U.uSunObj.value.set(-r.pos[0] / sd, -r.pos[1] / sd, -r.pos[2] / sd).applyQuaternion(_qi);
      U.uSunDist.value = sd / 1e3;
      const ir = AU_KM / (sd / 1e3); U.uIrr.value = ir * ir;
      U.uFade.value = lvl * smooth(0.7, 1.5, px);
      U.uAnim.value.set(days, 0, 0, 0);
      U.uDrift.value = (0.06 * days) % (2 * Math.PI);
      const camR = U.uCamObj.value.length(), alt = camR - r.req;
      U.uDetail.value = r.kind === 'gas' ? 0 : 1 - smooth(0.02, 0.5, alt / r.req);

      // eclipses
      const n = pickOccluders(r.id, r.pos, r.req, cands, occBuf, 4);
      const oc = U.uOcc.value;
      U.uOccAtm.value = 0;
      for (let i = 0; i < 4; i++) {
        if (i < n) {
          _v.set(occBuf[i * 4], occBuf[i * 4 + 1], occBuf[i * 4 + 2]).applyQuaternion(_qi);
          oc[i].set(_v.x, _v.y, _v.z, occBuf[i * 4 + 3]);
          if (i === 0 && r.id !== 'earth' && Math.abs(occBuf[3] - earthR) < 1) U.uOccAtm.value = 1;
        } else oc[i].set(0, 0, 0, 0);
      }

      // LOD by on-screen size
      const lod = px < 24 ? 0 : px < 90 ? 1 : px < 350 ? 2 : px < 1500 ? 3 : 4;
      if (lod !== r.lod) { r.lod = lod; r.surface.geometry = lods[lod]; if (r.cloud) r.cloud.geometry = lods[lod]; }
      if (r.atm) atmos.update(r, f);
      if (r.gaur) r.gaur.update();
    }
    sprGeo.attributes.position.needsUpdate = true; sprGeo.attributes.aColor.needsUpdate = true;
  }

  app.onFrame(update, 10);
  app.shared.bodies = { recs, sun, update };
}
