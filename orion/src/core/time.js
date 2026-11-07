import { DAY, YEAR, MYR } from 'orion/core/units.js';

// Simulation time is a Julian Date in Terrestrial Time, held as a Float64.
export const J2000 = 2451545.0;
export const DELTA_T = 69.184; // s, TT − UTC (fixed; good to ~1 s for 2000–2030)

export const jdFromDate = (date) => date.getTime() / 86400000 + 2440587.5 + DELTA_T / DAY;
export const dateFromJd = (jd) => new Date((jd - 2440587.5 - DELTA_T / DAY) * 86400000);
export const centuriesTT = (jd) => (jd - J2000) / 36525;

// Rate ladder in simulated seconds per real second. Galactic rates unlock at L0–L1.
export const RATES = [
  { label: 'Real time', rate: 1 },
  { label: '1 min/s', rate: 60 },
  { label: '1 h/s', rate: 3600 },
  { label: '1 day/s', rate: DAY },
  { label: '1 month/s', rate: YEAR / 12 },
  { label: '1 yr/s', rate: YEAR },
  { label: '1 kyr/s', rate: 1e3 * YEAR, galactic: true },
  { label: '1 Myr/s', rate: MYR, galactic: true },
];

export class SimTime extends EventTarget {
  constructor() {
    super();
    this.jd = jdFromDate(new Date());
    this.rateIndex = 0;
    this.direction = 1; // −1 runs backwards
    this.paused = false;
  }
  get rate() { return RATES[this.rateIndex].rate * this.direction; }
  // Planet ephemerides are only fitted for 3000 BC – 3000 AD.
  get approximate() { return this.jd < 625673.5 || this.jd > 2816787.5; }
  tick(realDt) { if (!this.paused) this.jd += (this.rate * realDt) / DAY; }
  setJd(jd) { this.jd = jd; this.#emit(); }
  now() { this.jd = jdFromDate(new Date()); this.rateIndex = 0; this.direction = 1; this.#emit(); }
  setRate(i, galacticAllowed = true) {
    const max = galacticAllowed ? RATES.length - 1 : RATES.findIndex((r) => r.galactic) - 1;
    this.rateIndex = Math.max(0, Math.min(max, i)); this.#emit();
  }
  faster(galacticAllowed) { this.setRate(this.rateIndex + 1, galacticAllowed); }
  slower() { this.setRate(this.rateIndex - 1); }
  togglePause() { this.paused = !this.paused; this.#emit(); }
  #emit() { this.dispatchEvent(new Event('change')); }
}
