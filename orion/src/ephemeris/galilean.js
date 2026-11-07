// Galilean satellites after Meeus "Astronomical Algorithms" ch. 44 (E2x3 mean longitudes and perijove
// longitudes, with the dominant resonance/eccentricity perturbation terms). Orbits are taken in
// Jupiter's equatorial plane (inclinations <= 0.5 deg are ignored); longitudes are measured from the
// ascending node of Jupiter's equator on the ICRF equator and rotated into the world ecliptic frame.
import { DEG } from 'orion/core/units.js';
import { equatorFrame } from 'orion/ephemeris/rotation.js';

export const GALILEAN = ['io', 'europa', 'ganymede', 'callisto'];
const A = [421.77e6, 671.08e6, 1070.4e6, 1882.7e6]; // semi-major axes, m
const OFFSET = 2.46; // deg, reference-node offset between the Meeus longitude origin and our node (calibrated)
const frame = equatorFrame('jupiter');

const out4 = [0, 0, 0, 0], rad4 = [0, 0, 0, 0];
// Longitude (deg) and radius (m) of each moon in Jupiter's equatorial frame.
export function galileanElements(jd) {
  const d = jd - 2443000.5;
  const l1 = 106.07719 + 203.48895579 * d, l2 = 175.73161 + 101.374724735 * d, l3 = 120.55883 + 50.317609207 * d, l4 = 84.44459 + 21.571071177 * d;
  const p3 = 188.184 + 0.00712734 * d, p4 = 335.2868 + 0.00184 * d;
  const s = (x) => Math.sin(x * DEG), c = (x) => Math.cos(x * DEG);
  const S1 = 0.47259 * s(2 * (l1 - l2)) - 0.03478 * s(p3 - p4);
  const S2 = 1.06476 * s(2 * (l2 - l3)) + 0.04256 * s(l1 - 2 * l2 + p3) + 0.03581 * s(l2 - p3) + 0.02395 * s(l1 - 2 * l2 + p4) + 0.01984 * s(l2 - p4) + 0.00524 * s(2 * (l1 - l2));
  const S3 = 0.1649 * s(l3 - p3) + 0.09081 * s(l3 - p4) - 0.06907 * s(l2 - l3) + 0.03784 * s(p3 - p4) + 0.01846 * s(2 * (l3 - l4));
  const S4 = 0.84109 * s(l4 - p4) + 0.03429 * s(p4 - p3);
  out4[0] = l1 + S1 + OFFSET; out4[1] = l2 + S2 + OFFSET; out4[2] = l3 + S3 + OFFSET; out4[3] = l4 + S4 + OFFSET;
  rad4[0] = A[0] * (1 - 0.004128 * c(2 * (l1 - l2)));
  rad4[1] = A[1] * (1 - 0.009290 * c(2 * (l2 - l3)));
  rad4[2] = A[2] * (1 - 0.001440 * c(l3 - p3));
  rad4[3] = A[3] * (1 - 0.007350 * c(l4 - p4));
  return { lon: out4, r: rad4 };
}

// Position of Galilean moon index 0..3 relative to Jupiter, ecliptic J2000 metres.
export function galileanRelative(index, jd, out) {
  const { lon, r } = galileanElements(jd);
  const x = r[index] * Math.cos(lon[index] * DEG), y = r[index] * Math.sin(lon[index] * DEG);
  out[0] = x * frame[0] + y * frame[3]; out[1] = x * frame[1] + y * frame[4]; out[2] = x * frame[2] + y * frame[5];
  return out;
}
