// Mean-element orbits for the minor moons and osculating Keplerian elements for the dwarf planets.
//
// Moons: each row is fitted to JPL Horizons satellite ephemerides over 1900-2100 (mean a, e, i, linear
// mean longitude L, linear precession of the longitude of pericentre and node). Angles are measured in
// the parent's equatorial frame (fixed J2000 pole, x = node of the equator on the ICRF equator), so the
// orbit plane precesses about the parent's pole. flip=1 marks orbits retrograde about the IAU north pole
// (Uranus moons, Triton), handled by reflecting the frame so their elements stay well conditioned.
// Rows: [parent, flip, a (m), e, i (deg), L0 (deg at J2000), n (deg/day), varpi0, dvarpi/day, node0, dnode/day]
// For near-circular moons the pericentre/node rates are the analytic J2 values (the fit is ill-defined).
import { AU, DEG } from 'orion/core/units.js';
import { solveKepler, perifocalToEcliptic } from 'orion/ephemeris/kepler.js';
import { equatorFrame } from 'orion/ephemeris/rotation.js';

const MOONS = {
  phobos: ['mars', 0, 9378504.59, 0.015099861, 1.05604352, 220.143062, 1128.84476, 25.6130913, 0.435182372, 167.694398, -0.435751095],
  deimos: ['mars', 0, 23459712.7, 0.000300868766, 1.90933622, 258.586797, 285.161885, 248.528071, 0.0175312244, 52.7211766, -0.0175604758],
  mimas: ['saturn', 0, 186020601.0, 0.0197408313, 1.57595384, 189.409918, 381.983038, 145.866007, 1.00112265, 172.979737, -0.999500283],
  enceladus: ['saturn', 0, 238411041.0, 0.00473636581, 0.00983870855, 182.277205, 262.731897, 171.262994, 0.410467394, 326.097185, -0.410467412],
  tethys: ['saturn', 0, 294975737.0, 0.00104514866, 1.09138852, 188.430395, 190.697924, 187.564036, 0.194472515, 259.850337, -0.194578415],
  dione: ['saturn', 0, 377651242.0, 0.00220573806, 0.0279891441, 176.910069, 131.534931, 305.046939, 0.0818959481, 256.794053, -0.0818959774],
  rhea: ['saturn', 0, 527234325.0, 0.000700296607, 0.33094857, 52.1686152, 79.690046, 194.046512, 0.0254546601, 350.228972, -0.025455934],
  titan: ['saturn', 0, 1221945580.0, 0.0288026188, 0.421732484, 7.55974916, 22.5769762, 204.131767, 0.00134472968, 236.957834, -0.00134483897],
  iapetus: ['saturn', 0, 3561705870.0, 0.0284307672, 15.4505453, 89.8364258, 4.53794966, 240.92365, 0.000287192051, 253.592226, -4.66846355e-05],
  miranda: ['uranus', 1, 129873677.0, 0.00135238372, 4.42753995, 148.483931, 254.69066, 75.6458162, 0.0488744772, 280.911848, -0.0493162116],
  ariel: ['uranus', 1, 190948562.0, 0.00141809204, 0.0291698653, 23.0079641, 142.835652, 229.346123, 0.0128327789, 45.3812617, -0.0128327839],
  umbriel: ['uranus', 1, 266004942.0, 0.00356230698, 0.0943978295, 71.2334402, 86.8688739, 178.701012, 0.00402169191, 12.5033254, -0.00402170828],
  titania: ['uranus', 1, 436316588.0, 0.00155361458, 0.12814866, 101.566816, 41.3514147, 348.772541, 0.000711541157, 206.750051, -0.000711546496],
  oberon: ['uranus', 1, 583535625.0, 0.0015754653, 0.146718063, 172.558561, 26.7394824, 177.66088, 0.000257235, 206.278874, -0.00025723753],
  triton: ['neptune', 1, 354840126.0, 0.000339094835, 22.7270302, 240.711001, 61.2572628, 307.267094, 0.00107543671, 2.13112784, -0.00140800874],
  charon: ['pluto', 0, 19594300.3, 0.000163538621, 0.0830917837, 304.123601, 56.3625304, 156.119634, 0.0, 9.85244201, 0.0],
};
export const MOON_IDS = Object.keys(MOONS);
export const moonParent = (id) => MOONS[id]?.[0];

const frames = {};
const tmp = new Float64Array(3);
// Position of table moon `id` relative to its parent, world (ecliptic J2000) metres.
export function moonRelative(id, jd, out) {
  const m = MOONS[id], d = jd - 2451545.0;
  const F = frames[m[0]] ??= equatorFrame(m[0]);
  const e = m[3], L = m[5] + m[6] * d, vp = m[7] + m[8] * d, node = m[9] + m[10] * d;
  const E = solveKepler((L - vp) * DEG, e), a = m[2];
  perifocalToEcliptic(a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), m[4] * DEG, (vp - node) * DEG, node * DEG, tmp);
  let x = tmp[0], y = tmp[1], z = tmp[2];
  if (m[1]) { y = -y; z = -z; }
  out[0] = x * F[0] + y * F[3] + z * F[6]; out[1] = x * F[1] + y * F[4] + z * F[7]; out[2] = x * F[2] + y * F[5] + z * F[8];
  return out;
}

// Dwarf planets: JPL SBDB osculating elements (ecliptic J2000; a in AU, angles in deg, n in deg/day).
const DWARFS = {
  ceres: { epoch: 2461200.5, a: 2.765552595, e: 0.079692295, i: 10.5880278, node: 80.24862682, w: 73.29421453, M0: 274.41934638, n: 0.2143044506 }, // 1 Ceres (A801 AA)
  vesta: { epoch: 2461200.5, a: 2.361365965, e: 0.090203744, i: 7.14392555, node: 103.70129327, w: 151.46864782, M0: 81.19015608, n: 0.2716183614 }, // 4 Vesta (A807 FA)
  pluto: { epoch: 2457588.5, a: 39.588629385, e: 0.251837878, i: 17.14771141, node: 110.29238405, w: 113.70900152, M0: 38.68366347, n: 0.003956839 }, // 134340 Pluto (1930 BM)
  eris: { epoch: 2461200.5, a: 67.933946879, e: 0.438238535, i: 43.92582795, node: 36.00477044, w: 150.79492358, M0: 211.77443428, n: 0.0017602478 }, // 136199 Eris (2003 UB313)
  haumea: { epoch: 2461200.5, a: 43.060290237, e: 0.194443015, i: 28.20847393, node: 121.78605613, w: 240.69054725, M0: 223.21041188, n: 0.0034880977 }, // 136108 Haumea (2003 EL61)
  makemake: { epoch: 2461200.5, a: 45.570933173, e: 0.158888995, i: 29.02785604, node: 79.29483382, w: 297.09227334, M0: 169.9379962, n: 0.0032038501 }, // 136472 Makemake (2005 FY9)
};
export const DWARF_IDS = Object.keys(DWARFS);
export function dwarfHeliocentric(id, jd, out) {
  const d = DWARFS[id], E = solveKepler((d.M0 + d.n * (jd - d.epoch)) * DEG, d.e);
  perifocalToEcliptic(d.a * (Math.cos(E) - d.e), d.a * Math.sqrt(1 - d.e * d.e) * Math.sin(E), d.i * DEG, d.w * DEG, d.node * DEG, tmp);
  out[0] = tmp[0] * AU; out[1] = tmp[1] * AU; out[2] = tmp[2] * AU;
  return out;
}
