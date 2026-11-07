// Named irregular bodies drawn as lumpy meshes: Phobos and Deimos (when the ephemeris provides them), Bennu and Eros.
import * as THREE from 'three';
import { AU, DEG } from 'orion/core/units.js';
import { makeElements, elementsToPos } from 'orion/render/small/kepler.js';
import { rockGeometry, rockMaterial } from 'orion/render/small/rock.js';

export const ASTEROID_DEFS = [
  { id: 'bennu', name: '101955 Bennu', aliases: ['Bennu', '1999 RQ36', 'OSIRIS-REx'], radius: 245, axes: [0.2825, 0.2735, 0.2495], albedo: 0.044, spinH: 4.296, subdiv: 5, rough: 0.07, craters: 12,
    el: makeElements({ a: 1.126391025894812, e: 0.2037450762416414, iDeg: 6.03494377024794, omDeg: 2.06086619569642, wDeg: 66.22306084084298, maDeg: 101.703952002457, epoch: 2455562.5 }),
    description: ['Near-Earth carbon-rich rubble pile, about 490 m across, shaped like a spinning top.', 'Sampled by NASA’s OSIRIS-REx in October 2020; samples returned to Earth in 2023.', 'Orbit 0.90–1.36 AU, period 436 days; one of the most hazardous known asteroids.'] },
  { id: 'eros', name: '433 Eros', aliases: ['Eros', 'NEAR Shoemaker'], radius: 8420, axes: [17.2, 5.7, 5.4], albedo: 0.25, spinH: 5.27, subdiv: 6, rough: 0.07, craters: 14, pinch: 0.22,
    el: makeElements({ a: 1.458243716760167, e: 0.2228779627700761, iDeg: 10.82854410314273, omDeg: 304.2679713350896, wDeg: 178.9181319135911, maDeg: 62.51145501986792, epoch: 2461200.5 }),
    description: ['First near-Earth asteroid discovered (1898); elongated stony body about 34 × 11 × 11 km.', 'NEAR Shoemaker orbited it in 2000 and touched down in February 2001.', 'Orbit 1.13–1.78 AU, period 1.76 years; crosses the orbit of Mars.'] },
];
const MARS_MOONS = [
  { id: 'phobos', axes: [13.0 / 2, 11.4 / 2, 9.1 / 2], albedo: 0.07, parent: 'mars', rough: 0.07, craters: 10, seed: 3 },
  { id: 'deimos', axes: [7.8 / 2, 6.0 / 2, 5.1 / 2], albedo: 0.08, parent: 'mars', rough: 0.09, craters: 6, seed: 8 },
];

export function createMinor(app) {
  const eph = app.shared.ephemeris;
  const items = [];
  const mk = (cfg) => {
    const mat = rockMaterial({ albedo: [cfg.albedo, cfg.albedo * 0.96, cfg.albedo * 0.9], seed: cfg.seed ?? 1 });
    const meanR = (cfg.axes[0] + cfg.axes[1] + cfg.axes[2]) / 3;
    mat.uniforms.uBump.value = 3 / meanR;
    const mesh = new THREE.Mesh(rockGeometry({ axes: cfg.axes, seed: cfg.seed ?? 4, subdiv: cfg.subdiv ?? 5, rough: cfg.rough, pinch: cfg.pinch || 0, craters: cfg.craters }), mat);
    mesh.frustumCulled = false; mesh.visible = false; mesh.name = 'rock-' + cfg.id;
    app.layers.system.add(mesh);
    return { ...cfg, mesh, mat, meanR, pos: new Float64Array(3) };
  };
  for (const d of ASTEROID_DEFS) items.push({ ...mk(d), kind: 'asteroid' });
  const haveMars = (id) => { try { return !!eph.getBody?.(id); } catch { return false; } };
  for (const m of MARS_MOONS) if (haveMars(m.id)) items.push({ ...mk(m), kind: 'moon' });

  const marsP = new Float64Array(3), mq = new THREE.Matrix4(), bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();
  function update(frame) {
    const cam = frame.camPos;
    for (const it of items) {
      if (it.kind === 'asteroid') elementsToPos(it.el, frame.jd, it.pos);
      else eph.heliocentric(it.id, frame.jd, it.pos);
      const dx = it.pos[0] - cam[0], dy = it.pos[1] - cam[1], dz = it.pos[2] - cam[2];
      const distKm = Math.hypot(dx, dy, dz) / 1000;
      const px = (it.meanR / Math.max(distKm, 1e-6)) * (frame.viewport.h / (2 * Math.tan((frame.fovY * Math.PI) / 360)));
      it.mesh.visible = px > 0.35 && frame.levels[3] > 0.01;
      if (!it.mesh.visible) continue;
      app.toSystem(it.pos, it.mesh.position);
      const rM = Math.hypot(it.pos[0], it.pos[1], it.pos[2]);
      it.mat.uniforms.uSunDir.value.set(-it.pos[0], -it.pos[1], -it.pos[2]).normalize();
      it.mat.uniforms.uSunE.value = (AU / Math.max(rM, 1e9)) ** 2;
      if (it.kind === 'moon') {
        // Tidally locked: long axis toward Mars, z along the (approximate) orbit normal = ecliptic north.
        eph.heliocentric(it.parent, frame.jd, marsP);
        bx.set(marsP[0] - it.pos[0], marsP[1] - it.pos[1], marsP[2] - it.pos[2]).normalize();
        bz.set(0, 0, 1); by.crossVectors(bz, bx).normalize(); bz.crossVectors(bx, by);
        mq.makeBasis(bx, by, bz); it.mesh.quaternion.setFromRotationMatrix(mq);
      } else {
        it.mesh.rotation.set(0.5, 0.3, ((frame.jd * 24) / it.spinH) * Math.PI * 2);
      }
    }
  }
  return { update, items };
}
