import * as THREE from 'three';
import { clamp, easeInOutCubic, smoothstep, v3, vcopy, vdist, PC } from 'orion/core/units.js';
import { GAL_TO_ECL } from 'orion/core/frames.js';

// Camera controller: orbit (default), fly, and go-to transitions. All positions Float64 world metres.
// The GPU never sees these: render layers subtract `pos` in double precision each frame.

const MIN_DIST = 10;            // m, for point-like focus targets
const MAX_DIST = 1.2e22;        // m, ~390 kpc
const WHEEL_RATIO = 1.15;       // distance ratio per wheel notch

export function defaultViewDistance(e) {
  if (e.viewDistance) return e.viewDistance;
  if (e.radius > 0) return e.radius * (['planet', 'moon', 'dwarf', 'sun', 'asteroid', 'comet'].includes(e.type) ? 4 : 2.5);
  return e.type === 'star' ? 2e12 : PC;
}
export const minDistance = (e) => (e && e.radius > 0 ? e.radius * (e.surfaceMinFactor ?? 1.01) : e?.minDistance ?? MIN_DIST);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _o = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

export class CameraController extends EventTarget {
  constructor(app) {
    super();
    this.app = app;
    this.mode = 'orbit';
    this.focus = null;
    this.dist = 1e7;
    this.az = 0.6; this.el = 0.35; this.roll = 0;
    this.pan = v3();                 // world-metre offset of the orbit centre from the focus
    this.pos = v3();                 // camera world position (output)
    this.quat = new THREE.Quaternion();
    this.fovY = 50;
    this.upMode = 'ecliptic';
    this.up = new THREE.Vector3(0, 0, 1);
    this.transition = null;
    this.keys = new Set();
    this.nearest = { entry: null, distance: Infinity };
    this._nearestT = 0;
    this._centre = v3();
    this.lastInput = performance.now();
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.#bindInput(app.canvas);
  }

  // ---- public API --------------------------------------------------------------------------
  focusOn(entry, distance) {
    if (typeof entry === 'string') entry = this.app.registry.get(entry);
    if (!entry) return;
    this.focus = entry; this.mode = 'orbit'; this.transition = null;
    this.pan.fill(0);
    this.dist = clamp(distance ?? defaultViewDistance(entry), minDistance(entry), MAX_DIST);
    this.#emitFocus();
  }
  goTo(entry, opts = {}) {
    if (typeof entry === 'string') entry = this.app.registry.get(entry);
    if (!entry) return;
    const jd = this.app.time.jd;
    const c0 = this.mode === 'orbit' ? vcopy(this.centre(jd)) : this.#flyLookPoint();
    if (this.mode === 'fly') this.#azElFromQuat();
    const d0 = Math.max(vdist(this.pos, c0), 1);
    const d1 = clamp(opts.distance ?? defaultViewDistance(entry), minDistance(entry), MAX_DIST);
    const sep = vdist(c0, entry.position(jd, v3()));
    const peak = Math.max(d0, d1, sep * 1.5);
    const L = Math.abs(Math.log10(peak / d0)) + Math.abs(Math.log10(peak / d1));
    const duration = this.reducedMotion ? 0.3 : opts.duration ?? clamp(2 + L * 0.25, 2, 6);
    this.mode = 'orbit'; this.pan.fill(0);
    let az1 = opts.az ?? this.#sunlitAz(entry, jd), el1 = opts.el;
    // An entry may name its preferred camera direction (world-frame unit vector from the object to the camera).
    if (entry.viewDir && opts.az === undefined && opts.el === undefined) {
      this.#basis();
      const [x, y, z] = entry.viewDir;
      const a = Math.atan2(x * _y.x + y * _y.y + z * _y.z, x * _x.x + y * _x.y + z * _x.z);
      az1 = this.az + Math.atan2(Math.sin(a - this.az), Math.cos(a - this.az));
      el1 = Math.asin(clamp(x * this.up.x + y * this.up.y + z * this.up.z, -1, 1));
    }
    this.transition = { entry, c0, d0, d1, peak: this.reducedMotion ? Math.max(d0, d1) : peak, t: 0, duration, el1, az1, az0: this.az, el0: this.el };
    this.focus = entry;
    if (this.reducedMotion) this.dispatchEvent(new Event('crossfade'));
    this.#emitFocus();
    return new Promise((res) => { this.transition.resolve = res; });
  }
  back() {
    const p = this.focus?.parent && this.app.registry.get(this.focus.parent);
    if (p) this.goTo(p);
  }
  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'fly') { this.transition = null; this.mode = 'fly'; this._ride = null; }
    else { this.mode = 'orbit'; const n = this.nearest.entry || this.focus; if (n) { this.focus = n; this.dist = clamp(vdist(this.pos, n.position(this.app.time.jd, v3())), minDistance(n), MAX_DIST); this.pan.fill(0); this.#azElFromQuat(); this.#emitFocus(); } }
    this.dispatchEvent(new Event('mode'));
  }
  setUpMode(m) {
    this.upMode = m;
    if (m === 'galactic') { const g = GAL_TO_ECL; this.up.set(g[2], g[5], g[8]).normalize(); } else this.up.set(0, 0, 1);
    this.dispatchEvent(new Event('upmode'));
  }
  state() { return { focus: this.focus?.id, dist: this.dist, az: this.az, el: this.el, roll: this.roll }; }
  setState(s) { const e = this.app.registry.get(s.focus); if (!e) return; this.focusOn(e, s.dist); this.az = s.az ?? this.az; this.el = s.el ?? this.el; this.roll = s.roll ?? 0; }
  centre(jd, out = this._centre) {
    if (!this.focus) return out.fill(0);
    this.focus.position(jd, out);
    out[0] += this.pan[0]; out[1] += this.pan[1]; out[2] += this.pan[2];
    return out;
  }
  // Rotate / zoom programmatically (used by keyboard and tours).
  orbitBy(daz, del) { if (this.mode === 'fly') return this.#look(daz, del); this.az += daz; this.el = clamp(this.el + del, -1.553, 1.553); }
  zoomBy(ratio) { if (this.mode === 'orbit' && !this.transition) this.dist = clamp(this.dist * ratio, minDistance(this.focus), MAX_DIST); }

  // ---- per frame ---------------------------------------------------------------------------
  update(realDt) {
    const jd = this.app.time.jd;
    this.#keysUpdate(realDt);
    if (this.transition) this.#transitionUpdate(realDt, jd);
    if (this.mode === 'orbit') this.#orbitPose(jd);
    else this.#flyUpdate(realDt);
    this._nearestT -= realDt;
    if (this._nearestT <= 0) { this._nearestT = 0.1; this.nearest = this.app.registry.nearest(this.pos, jd, (e) => e.type !== 'star' || e.radius > 0); }
  }
  #orbitPose(jd) {
    const c = this.centre(jd);
    this.#basis();
    const ce = Math.cos(this.el);
    _o.copy(_x).multiplyScalar(ce * Math.cos(this.az)).addScaledVector(_y, ce * Math.sin(this.az)).addScaledVector(this.up, Math.sin(this.el));
    this.pos[0] = c[0] + _o.x * this.dist; this.pos[1] = c[1] + _o.y * this.dist; this.pos[2] = c[2] + _o.z * this.dist;
    _m.lookAt(_o, _v.set(0, 0, 0), this.up);
    this.quat.setFromRotationMatrix(_m);
    if (this.roll) this.quat.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), this.roll));
  }
  #basis() { // horizontal basis perpendicular to the up axis
    _z.copy(this.up);
    _x.set(1, 0, 0); if (Math.abs(_z.dot(_x)) > 0.9) _x.set(0, 1, 0);
    _y.crossVectors(_z, _x).normalize(); _x.crossVectors(_y, _z).normalize();
  }
  #transitionUpdate(dt, jd) {
    const tr = this.transition;
    tr.t = Math.min(1, tr.t + dt / tr.duration);
    const t = tr.t;
    const c1 = tr.entry.position(jd, v3());
    const s = smoothstep(0.3, 0.7, t);
    const ld0 = Math.log(tr.d0), ld1 = Math.log(tr.d1), lp = Math.log(tr.peak);
    let ld;
    if (tr.peak > Math.max(tr.d0, tr.d1) * 1.01) ld = t < 0.5 ? ld0 + (lp - ld0) * easeInOutCubic(t * 2) : lp + (ld1 - lp) * easeInOutCubic((t - 0.5) * 2);
    else ld = ld0 + (ld1 - ld0) * easeInOutCubic(t);
    if (this.reducedMotion) { ld = ld1; }
    const cs = this.reducedMotion ? 1 : s;
    // Express the interpolated centre as a pan offset from the target focus.
    this.pan[0] = (tr.c0[0] - c1[0]) * (1 - cs); this.pan[1] = (tr.c0[1] - c1[1]) * (1 - cs); this.pan[2] = (tr.c0[2] - c1[2]) * (1 - cs);
    this.dist = Math.exp(ld);
    const e = easeInOutCubic(t);
    if (tr.az1 !== undefined) this.az = tr.az0 + (tr.az1 - tr.az0) * e;
    if (tr.el1 !== undefined) this.el = tr.el0 + (tr.el1 - tr.el0) * e;
    if (t >= 1) { this.pan.fill(0); this.dist = tr.d1; this.transition = null; tr.resolve?.(); this.dispatchEvent(new Event('arrived')); }
  }
  // Radius of a solid body's reference ellipsoid under the camera; fly mode may go down to ~2 m above it.
  surfaceRadius(n) {
    const eph = this.app.shared.ephemeris, a = n.equatorialRadius, b = n.polarRadius;
    if (!n.solid || !a || !b || !eph?.poleVector) return n.radius;
    const c = n.position(this.app.time.jd, v3()), d = vdist(this.pos, c);
    if (!(d > 0)) return n.radius;
    const p = eph.poleVector(n.id, this.app.time.jd, this._pole ??= new Float64Array(3));
    const s = ((this.pos[0] - c[0]) * p[0] + (this.pos[1] - c[1]) * p[1] + (this.pos[2] - c[2]) * p[2]) / d; // sin(latitude)
    const cl = Math.sqrt(Math.max(0, 1 - s * s));
    return (a * b) / Math.hypot(b * cl, a * s);
  }
  // Solar-system bodies are framed from the sunward side, turned ~35° so the terminator shows.
  #sunlitAz(entry, jd) {
    if (!(entry.radius > 0) || entry.id === 'sun') return undefined;
    const p = entry.position(jd, v3()), r = Math.hypot(p[0], p[1], p[2]);
    if (!(r > 0) || r > 1e15) return undefined;
    this.#basis();
    const a = Math.atan2(-(p[0] * _y.x + p[1] * _y.y + p[2] * _y.z), -(p[0] * _x.x + p[1] * _x.y + p[2] * _x.z)) + 0.6;
    return this.az + Math.atan2(Math.sin(a - this.az), Math.cos(a - this.az)); // shortest way round
  }
  #flyLookPoint() {
    _v.set(0, 0, -1).applyQuaternion(this.quat);
    const d = Math.max(this.nearest.distance, 1e3);
    return v3(this.pos[0] + _v.x * d, this.pos[1] + _v.y * d, this.pos[2] + _v.z * d);
  }
  #azElFromQuat() {
    this.#basis();
    _o.set(0, 0, 1).applyQuaternion(this.quat); // camera → backwards = offset direction
    this.el = Math.asin(clamp(_o.dot(this.up), -1, 1));
    this.az = Math.atan2(_o.dot(_y), _o.dot(_x));
    this.roll = 0;
  }
  #look(dyaw, dpitch) {
    this.quat.premultiply(_q.setFromAxisAngle(this.up, dyaw));
    this.quat.multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), dpitch));
  }
  #flyUpdate(dt) {
    const k = this.keys;
    const n0 = this.nearest.entry;
    const alt = n0?.solid ? vdist(this.pos, n0.position(this.app.time.jd, v3())) - this.surfaceRadius(n0) : this.nearest.distance;
    const speed = Math.max(alt, 10) * 0.8 * (k.has('shift') ? 6 : 1);
    _v.set((k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0), (k.has('r') ? 1 : 0) - (k.has('c') ? 1 : 0), (k.has('s') ? 1 : 0) - (k.has('w') ? 1 : 0));
    if (_v.lengthSq() > 0) {
      _v.normalize().applyQuaternion(this.quat).multiplyScalar(speed * dt);
      this.pos[0] += _v.x; this.pos[1] += _v.y; this.pos[2] += _v.z;
    }
    const n = this.nearest.entry;
    if (!n || !(n.radius > 0)) { this._ride = null; return; }
    const jd = this.app.time.jd, c = n.position(jd, v3());
    this.#ride(n, c, jd);
    // Never pass inside a solid body.
    const d = vdist(this.pos, c), m = n.solid ? this.surfaceRadius(n) + 2 : minDistance(n);
    if (d < m) for (let i = 0; i < 3; i++) this.pos[i] = c[i] + ((this.pos[i] - c[i]) * m) / d;
  }
  // Near a body the fly camera rides along with it (orbital motion), and close in also turns with it,
  // so a ground observer stays put while the sky wheels overhead.
  #ride(n, c, jd) {
    const near = vdist(this.pos, c) < n.radius * 1000, spin = near && n.solid && vdist(this.pos, c) < n.radius * 1.5;
    const eph = this.app.shared.ephemeris, r = this._ride;
    const q = spin && eph?.bodyQuaternion ? eph.bodyQuaternion(n.id, jd, new THREE.Quaternion()) : null;
    if (near && r && r.id === n.id) {
      for (let i = 0; i < 3; i++) this.pos[i] += c[i] - r.c[i];
      if (q && r.q) {
        const dq = q.clone().multiply(r.q.clone().invert());
        _v.set(this.pos[0] - c[0], this.pos[1] - c[1], this.pos[2] - c[2]).applyQuaternion(dq);
        this.pos[0] = c[0] + _v.x; this.pos[1] = c[1] + _v.y; this.pos[2] = c[2] + _v.z;
        this.quat.premultiply(dq);
      }
    }
    this._ride = near ? { id: n.id, c: vcopy(c), q } : null;
  }
  #keysUpdate(dt) {
    const k = this.keys, r = 1.4 * dt;
    if (k.has('arrowleft')) this.orbitBy(-r, 0);
    if (k.has('arrowright')) this.orbitBy(r, 0);
    if (k.has('arrowup')) this.orbitBy(0, r);
    if (k.has('arrowdown')) this.orbitBy(0, -r);
    if (k.has('q')) { if (this.mode === 'fly') this.quat.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), r)); else this.roll += r; }
    if (k.has('e')) { if (this.mode === 'fly') this.quat.multiply(_q.setFromAxisAngle(_v.set(0, 0, 1), -r)); else this.roll -= r; }
    if (k.has('+') || k.has('=')) this.zoomBy(Math.pow(WHEEL_RATIO, -dt * 8));
    if (k.has('-') || k.has('_')) this.zoomBy(Math.pow(WHEEL_RATIO, dt * 8));
  }
  #panBy(dx, dy) {
    if (this.mode !== 'orbit' || this.transition) return;
    _x.set(1, 0, 0).applyQuaternion(this.quat); _y.set(0, 1, 0).applyQuaternion(this.quat);
    const s = this.dist * 0.0015;
    for (let i = 0; i < 3; i++) this.pan[i] += (-_x.getComponent(i) * dx + _y.getComponent(i) * dy) * s;
  }
  #emitFocus() { this.dispatchEvent(new CustomEvent('focus', { detail: this.focus })); }

  // ---- input -------------------------------------------------------------------------------
  #bindInput(el) {
    const ptrs = new Map();
    let downAt = null, moved = 0, lastPinch = null;
    const touch = () => { this.lastInput = performance.now(); };
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      touch(); el.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
      if (ptrs.size === 1) { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; moved = 0; }
      lastPinch = null;
    });
    el.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      touch();
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (ptrs.size === 1) {
        if (p.button === 2 || p.shift) this.#panBy(dx, dy);
        else if (this.mode === 'fly') this.#look(-dx * 0.003, -dy * 0.003);
        else { if (this.transition) return; this.orbitBy(-dx * 0.005, dy * 0.005); }
      }
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const cur = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        if (lastPinch) {
          this.zoomBy(lastPinch.d / Math.max(cur.d, 1));
          this.#panBy(cur.cx - lastPinch.cx, cur.cy - lastPinch.cy);
          let da = cur.ang - lastPinch.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
          if (this.mode === 'orbit') this.roll += da;
        }
        lastPinch = cur;
      }
    });
    const up = (e) => {
      const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); lastPinch = null;
      if (p && downAt && moved < 6 && performance.now() - downAt.t < 500 && ptrs.size === 0) {
        const r = el.getBoundingClientRect();
        this.app.events.dispatchEvent(new CustomEvent('pick', { detail: { x: e.clientX - r.left, y: e.clientY - r.top } }));
      }
      if (ptrs.size === 0) downAt = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault(); touch();
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      if (this.mode === 'fly') { _v.set(0, 0, -1).applyQuaternion(this.quat).multiplyScalar(-px * 0.002 * Math.max(this.nearest.distance, 10)); this.pos[0] += _v.x; this.pos[1] += _v.y; this.pos[2] += _v.z; }
      else this.zoomBy(Math.pow(WHEEL_RATIO, clamp(px / 100, -4, 4)));
    }, { passive: false });

    const editable = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    addEventListener('keydown', (e) => {
      if (editable(e.target) || e.metaKey || e.ctrlKey) return;
      touch();
      const k = e.key.toLowerCase();
      if (k === 'f') { this.setMode(this.mode === 'fly' ? 'orbit' : 'fly'); return; }
      if (k === 'escape' || k === 'backspace') { if (this.mode === 'fly') this.setMode('orbit'); else this.back(); e.preventDefault(); return; }
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'q', 'e', '+', '=', '-', '_', 'w', 'a', 's', 'd', 'r', 'c'].includes(k)) {
        if (k.startsWith('arrow') && e.target !== document.body && e.target !== el) return; // let focused controls use arrows
        this.keys.add(k); if (k.startsWith('arrow')) e.preventDefault();
      }
      if (e.shiftKey) this.keys.add('shift');
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); if (!e.shiftKey) this.keys.delete('shift'); });
    addEventListener('blur', () => this.keys.clear());
  }
}
